const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  generateSpeech,
  transcribe,
  AudioAPIError,
} = require("../dist/index.js");
const {
  openaiSpeech,
  openaiTranscription,
} = require("../dist/providers/openai/index.js");
const wav = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([4, 0, 0, 0]),
  Buffer.from("WAVEfmt "),
  Buffer.alloc(30),
]);
const encoded = {
  mp3: Buffer.from("ID3test-audio"),
  opus: Buffer.from("OggStest-audio"),
  wav,
  flac: Buffer.from("fLaCtest-audio"),
  aac: Buffer.from([0xff, 0xf1, 1, 2]),
  pcm: Buffer.from([0, 1, 2, 3]),
};
for (const outputFormat of Object.keys(encoded))
  test(`TTS ${outputFormat}: binary response, base64, metadata, exact options`, async () => {
    let count = 0;
    const model = openaiSpeech("gpt-4o-mini-tts", {
      apiKey: "fixture",
      fetch: async (url, init) => {
        count++;
        assert.equal(url, "https://api.openai.com/v1/audio/speech");
        assert.deepEqual(init.headers.Authorization.split(" "), [
          "Bearer",
          "fixture",
        ]);
        assert.equal(init.redirect, "error");
        assert.deepEqual(JSON.parse(init.body), {
          model: "gpt-4o-mini-tts",
          input: "hello",
          voice: "coral",
          response_format: outputFormat,
          speed: 1.25,
          instructions: "Clear",
        });
        return new Response(encoded[outputFormat], {
          headers: {
            "content-type": "application/octet-stream",
            "x-request-id": "req-test",
          },
        });
      },
    });
    const result = await generateSpeech({
      model,
      text: "hello",
      voice: "coral",
      outputFormat,
      speed: 1.25,
      instructions: "Clear",
    });
    assert.deepEqual(
      Buffer.from(result.audio.uint8Array),
      encoded[outputFormat],
    );
    assert.equal(result.audio.base64, encoded[outputFormat].toString("base64"));
    assert.equal(result.response.requestId, "req-test");
    assert.equal(result.audio.format, outputFormat);
    assert.equal(count, 1);
  });
for (const options of [
  { text: "" },
  { text: "x".repeat(4097) },
  { text: "hi", speed: 0 },
  { text: "hi", speed: NaN },
  { text: "hi", voice: "" },
  { text: "hi", outputFormat: "exe" },
  { text: "hi", providerOptions: { openai: { temperature: 0 } } },
])
  test(`TTS validation ${Object.keys(options).join(",")} ${String(options.speed)}`, async () => {
    let count = 0;
    await assert.rejects(
      () =>
        generateSpeech({
          model: openaiSpeech(undefined, {
            apiKey: "fixture",
            fetch: async () => {
              count++;
            },
          }),
          ...options,
        }),
      AudioAPIError,
    );
    assert.equal(count, 0);
  });
test("TTS legacy model rejects instructions before sending", async () => {
  await assert.rejects(
    () =>
      generateSpeech({
        model: openaiSpeech("tts-1", {
          apiKey: "fixture",
          fetch: async () => assert.fail("request"),
        }),
        text: "hi",
        instructions: "soft",
      }),
    { code: "unsupported_option" },
  );
});
for (const kind of ["empty", "json", "bad-signature", "oversize"])
  test(`TTS rejects ${kind} response`, async () => {
    await assert.rejects(
      () =>
        generateSpeech({
          model: openaiSpeech(undefined, {
            apiKey: "fixture",
            fetch: async () =>
              new Response(
                kind === "empty" ? null : kind === "json" ? "{}" : "garbage",
                {
                  headers: {
                    "content-type":
                      kind === "json" ? "application/json" : "audio/wav",
                    ...(kind === "oversize"
                      ? { "content-length": "30000000" }
                      : {}),
                  },
                },
              ),
          }),
          text: "hi",
          outputFormat: "wav",
        }),
      { code: "invalid_response" },
    );
  });
for (const format of ["bytes", "arraybuffer", "blob", "base64"])
  test(`STT ${format}: multipart binary, language, metadata`, async () => {
    let count = 0;
    const signal = new AbortController().signal;
    const model = openaiTranscription(undefined, {
      apiKey: "fixture",
      fetch: async (url, init) => {
        count++;
        assert.equal(url, "https://api.openai.com/v1/audio/transcriptions");
        assert.equal(init.signal, signal);
        assert.equal(init.headers["Content-Type"], undefined);
        assert.equal(init.body.get("model"), "gpt-4o-mini-transcribe");
        assert.equal(init.body.get("response_format"), "json");
        assert.equal(init.body.get("language"), "en");
        assert.equal(init.body.get("prompt"), "Copilot");
        const file = init.body.get("file");
        assert.equal(file.type, "audio/wav");
        assert.deepEqual(Buffer.from(await file.arrayBuffer()), wav);
        return Response.json(
          { text: "Hello Copilot", usage: { type: "tokens", total_tokens: 5 } },
          { headers: { "x-request-id": "stt-id" } },
        );
      },
    });
    const audio =
      format === "blob"
        ? new Blob([wav], { type: "audio/wav" })
        : format === "base64"
          ? wav.toString("base64")
          : format === "arraybuffer"
            ? new Uint8Array(wav).buffer
            : wav;
    const result = await transcribe({
      model,
      audio,
      mediaType: format === "blob" ? undefined : "audio/wav",
      language: "en",
      prompt: "Copilot",
      signal,
    });
    assert.equal(result.text, "Hello Copilot");
    assert.equal(result.usage.total_tokens, 5);
    assert.equal(result.response.requestId, "stt-id");
    assert.equal(count, 1);
  });
test("STT whisper timestamp options and validated segments/words", async () => {
  const model = openaiTranscription("whisper-1", {
    apiKey: "fixture",
    fetch: async (url, { body }) => {
      assert.equal(body.get("response_format"), "verbose_json");
      assert.deepEqual(body.getAll("timestamp_granularities[]"), [
        "word",
        "segment",
      ]);
      return Response.json({
        text: "hello",
        language: "english",
        duration: 1,
        segments: [{ text: "hello", start: 0, end: 1 }],
        words: [{ word: "hello", start: 0, end: 1 }],
      });
    },
  });
  const result = await transcribe({
    model,
    audio: wav,
    mediaType: "audio/wav",
    providerOptions: {
      openai: { timestampGranularities: ["word", "segment"] },
    },
  });
  assert.equal(result.durationSeconds, 1);
  assert.equal(result.words[0].word, "hello");
  assert.equal(result.segments[0].start, 0);
});
test("STT diarized result preserves speakers and uses automatic chunking", async () => {
  const model = openaiTranscription("gpt-4o-transcribe-diarize", {
    apiKey: "fixture",
    fetch: async (url, { body }) => {
      assert.equal(body.get("response_format"), "diarized_json");
      assert.equal(body.get("chunking_strategy"), "auto");
      return Response.json({
        text: "hi",
        segments: [{ text: "hi", start: 0, end: 1, speaker: "A" }],
        usage: { seconds: 1 },
      });
    },
  });
  const result = await transcribe({
    model,
    audio: wav,
    mediaType: "audio/wav",
  });
  assert.equal(result.segments[0].speaker, "A");
});
for (const [modelId, options] of [
  [
    "gpt-4o-mini-transcribe",
    { providerOptions: { openai: { timestampGranularities: ["word"] } } },
  ],
  ["whisper-1", { providerOptions: { openai: { includeLogprobs: true } } }],
  ["gpt-4o-transcribe-diarize", { prompt: "bad" }],
  ["gpt-realtime-whisper", {}],
])
  test(`STT incompatible options ${modelId}`, async () => {
    await assert.rejects(
      () =>
        transcribe({
          model: openaiTranscription(modelId, {
            apiKey: "fixture",
            fetch: async () => assert.fail("request"),
          }),
          audio: wav,
          mediaType: "audio/wav",
          ...options,
        }),
      { code: "unsupported_option" },
    );
  });
for (const options of [
  { audio: new Uint8Array() },
  { audio: "https://example.com/audio.wav" },
  { audio: "not base64" },
  { audio: Buffer.from("wrong header") },
  { audio: new Blob([wav], { type: "audio/webm" }) },
  { audio: Buffer.alloc(25_000_001) },
  { filename: "../private.wav" },
  { filename: "audio.mp3" },
  { language: "english" },
])
  test(`STT invalid input ${Object.keys(options).join(",")}`, async () => {
    await assert.rejects(
      () =>
        transcribe({
          model: openaiTranscription(undefined, {
            apiKey: "fixture",
            fetch: async () => assert.fail("request"),
          }),
          audio: wav,
          mediaType: "audio/wav",
          ...options,
        }),
      { code: "invalid_input" },
    );
  });
for (const value of [
  {},
  { text: 1 },
  { text: "ok", segments: [{ text: "x", start: 5, end: 1 }] },
])
  test("STT malformed provider response", async () => {
    await assert.rejects(
      () =>
        transcribe({
          model: openaiTranscription(undefined, {
            apiKey: "fixture",
            fetch: async () => Response.json(value),
          }),
          audio: wav,
          mediaType: "audio/wav",
        }),
      { code: "invalid_response" },
    );
  });
for (const kind of ["tts", "stt"]) {
  test(`${kind} HTTP failure is structured and does not echo provider body`, async () => {
    const config = {
      apiKey: "fixture",
      fetch: async () =>
        new Response("secret-echo", {
          status: 429,
          headers: { "x-request-id": "req-fail" },
        }),
    };
    const run = () =>
      kind === "tts"
        ? generateSpeech({ model: openaiSpeech(undefined, config), text: "hi" })
        : transcribe({
            model: openaiTranscription(undefined, config),
            audio: wav,
            mediaType: "audio/wav",
          });
    await assert.rejects(
      run,
      (e) =>
        e.code === "provider_error" &&
        e.status === 429 &&
        e.requestId === "req-fail" &&
        !e.message.includes("secret-echo"),
    );
  });
  test(`${kind} cancellation before and during fetch`, async () => {
    for (const pre of [true, false]) {
      const controller = new AbortController();
      let requests = 0;
      const config = {
        apiKey: "fixture",
        fetch: async () => {
          requests++;
          controller.abort();
          throw new Error("aborted transport");
        },
      };
      if (pre) controller.abort();
      await assert.rejects(
        () =>
          kind === "tts"
            ? generateSpeech({
                model: openaiSpeech(undefined, config),
                text: "hi",
                signal: controller.signal,
              })
            : transcribe({
                model: openaiTranscription(undefined, config),
                audio: wav,
                mediaType: "audio/wav",
                signal: controller.signal,
              }),
        { name: "AbortError" },
      );
      assert.equal(requests, pre ? 0 : 1);
    }
  });
}
