// Opt-in paid API tests with synthetic inputs. Never writes credentials or raw setup responses.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { generateImage } = require("../../dist/index.js");
const {
  openaiImage,
  openaiRealtime,
} = require("../../dist/providers/openai/index.js");
if (process.env.RUN_MEDIA_LIVE !== "1" || !process.env.OPENAI_API_KEY)
  throw new Error("Explicit live media opt-in and OPENAI_API_KEY required");
const dir = process.env.MEDIA_REPORT_DIR || "/tmp/copilot-next-beta-media";
fs.mkdirSync(dir, { recursive: true });
const results = [];
let image;
async function check(name, fn) {
  const start = Date.now();
  try {
    const metadata = await fn();
    results.push({
      name,
      passed: true,
      durationMs: Date.now() - start,
      ...metadata,
    });
    console.log("PASS " + name);
  } catch (error) {
    results.push({
      name,
      passed: false,
      durationMs: Date.now() - start,
      error: { name: error.name, code: error.code, status: error.status },
    });
    console.log("FAIL " + name);
  }
}
(async () => {
  const model = openaiImage(process.env.IMAGE_MODEL || "gpt-image-2.5-flare");
  await check("real image generation PNG", async () => {
    image = await generateImage({
      model,
      prompt: "One simple blue circle centered on a white background. No text.",
      size: "1024x1024",
      providerOptions: { openai: { quality: "low" } },
    });
    assert.equal(image.image.mediaType, "image/png");
    assert.ok(image.image.uint8Array.length > 100);
    assert.ok(image.response.requestId);
    fs.writeFileSync(path.join(dir, "generated.png"), image.image.uint8Array);
    return {
      model: model.modelId,
      bytes: image.image.uint8Array.length,
      usage: image.usage,
      requestId: image.response.requestId,
    };
  });
  await check("real image edit WebP", async () => {
    assert.ok(image);
    const result = await generateImage({
      model,
      prompt:
        "Change the blue circle to green. Preserve the plain white background.",
      images: [{ data: image.image.uint8Array, mediaType: "image/png" }],
      size: "1024x1024",
      providerOptions: {
        openai: { quality: "low", outputFormat: "webp", outputCompression: 80 },
      },
    });
    assert.equal(result.image.mediaType, "image/webp");
    assert.ok(result.image.uint8Array.length > 100);
    fs.writeFileSync(path.join(dir, "edited.webp"), result.image.uint8Array);
    return {
      model: model.modelId,
      bytes: result.image.uint8Array.length,
      usage: result.usage,
      requestId: result.response.requestId,
    };
  });
  await check("real realtime ephemeral client secret", async () => {
    const model = openaiRealtime(
      process.env.REALTIME_MODEL || "gpt-realtime-2.1",
    );
    const secret = await model.createClientSecret({
      instructions: "Be concise.",
      transcriptionModel: "gpt-transcribe",
      expiresAfterSeconds: 60,
    });
    assert.ok(secret.value.startsWith("ek_"));
    assert.ok(secret.expiresAt > Date.now() / 1000);
    return {
      model: model.modelId,
      expiresInSeconds: Math.floor(secret.expiresAt - Date.now() / 1000),
    };
  });
  fs.writeFileSync(
    path.join(dir, "live-media.json"),
    JSON.stringify(results, null, 2),
  );
  if (results.some((r) => !r.passed)) process.exitCode = 1;
})();
