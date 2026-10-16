// Opt-in synthetic speech round trip. No microphone or user audio is recorded.
const fs = require("node:fs");
fs.mkdirSync("/tmp/copilot-sdk-audit", { recursive: true });
const assert = require("node:assert/strict");
const { generateSpeech, transcribe } = require("../../dist/index.js");
const {
  openaiSpeech,
  openaiTranscription,
} = require("../../dist/providers/openai/index.js");
if (process.env.RUN_AUDIO_LIVE !== "1" || !process.env.OPENAI_API_KEY)
  throw new Error("Explicit live audio opt-in and provider key required");
const key = process.env.OPENAI_API_KEY;
const checks = [];
const audio = {};
async function check(name, fn) {
  try {
    await fn();
    checks.push({ name, passed: true });
    console.log("PASS " + name);
  } catch (e) {
    checks.push({
      name,
      passed: false,
      error: {
        name: e.name,
        status: e.status,
        code: e.code,
        message: String(e.message).replaceAll(key, "[REDACTED]").slice(0, 350),
      },
    });
    console.log("FAIL " + name);
  }
}
(async () => {
  for (const format of ["wav", "mp3"]) {
    await check(`TTS ${format} binary audio`, async () => {
      const result = await generateSpeech({
        model: openaiSpeech("gpt-4o-mini-tts", { apiKey: key }),
        text: "Hello Copilot. The blue balloon is ready.",
        voice: "alloy",
        outputFormat: format,
        instructions: "Speak clearly in English.",
        signal: AbortSignal.timeout(60000),
      });
      assert.ok(result.audio.uint8Array.length > 100);
      assert.ok(result.response.requestId);
      audio[format] = result.audio;
    });
    await check(`STT ${format} real generated audio`, async () => {
      assert.ok(audio[format]);
      const result = await transcribe({
        model: openaiTranscription("gpt-4o-mini-transcribe", { apiKey: key }),
        audio: audio[format].uint8Array,
        mediaType: audio[format].mediaType,
        language: "en",
        signal: AbortSignal.timeout(60000),
      });
      assert.match(result.text, /blue balloon/i);
      assert.ok(result.response.requestId);
    });
  }
  await check("Whisper segment and word timestamps", async () => {
    const result = await transcribe({
      model: openaiTranscription("whisper-1", { apiKey: key }),
      audio: audio.wav.uint8Array,
      mediaType: "audio/wav",
      language: "en",
      providerOptions: {
        openai: { timestampGranularities: ["word", "segment"] },
      },
      signal: AbortSignal.timeout(60000),
    });
    assert.match(result.text, /blue balloon/i);
    assert.ok(result.segments.length);
    assert.ok(result.words.length);
    assert.ok(result.durationSeconds > 0);
  });
  await check("Diarized transcription speaker segments", async () => {
    const result = await transcribe({
      model: openaiTranscription("gpt-4o-transcribe-diarize", { apiKey: key }),
      audio: audio.wav.uint8Array,
      mediaType: "audio/wav",
      language: "en",
      signal: AbortSignal.timeout(60000),
    });
    assert.match(result.text, /blue balloon/i);
    assert.ok(result.segments.some((x) => typeof x.speaker === "string"));
  });
  fs.writeFileSync(
    "/tmp/copilot-sdk-audit/audio-live.json",
    JSON.stringify({ checks }, null, 2),
  );
  if (checks.some((x) => !x.passed)) process.exitCode = 1;
})();
