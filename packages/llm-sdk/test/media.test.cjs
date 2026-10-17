const { test } = require("node:test");
const assert = require("node:assert/strict");
const { generateImage, MediaAPIError } = require("../dist/index.js");
const {
  openaiImage,
  openaiRealtime,
} = require("../dist/providers/openai/index.js");
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1cAAAAASUVORK5CYII=",
  "base64",
);
const json = (value) =>
  new Response(JSON.stringify(value), {
    headers: { "x-request-id": "req-fixture" },
  });
const imageReply = () =>
  json({
    data: [{ b64_json: png.toString("base64") }],
    usage: { total_tokens: 12 },
  });
test("image generation returns bytes, base64, usage and request metadata", async () => {
  const result = await generateImage({
    model: openaiImage(undefined, {
      apiKey: "fixture",
      fetch: async (url, init) => {
        assert.equal(url, "https://api.openai.com/v1/images/generations");
        assert.deepEqual(init.headers.Authorization.split(" "), ["Bearer", "fixture"]);
        assert.equal(init.redirect, "error");
        assert.deepEqual(JSON.parse(init.body), {
          model: "gpt-image-2.5-flare",
          prompt: "blue square",
          n: 1,
          size: "1024x1024",
          quality: "low",
          background: "transparent",
          output_format: "png",
          safety_identifier: "user-hash",
        });
        return imageReply();
      },
    }),
    prompt: "blue square",
    size: "1024x1024",
    providerOptions: {
      openai: {
        quality: "low",
        background: "transparent",
        safetyIdentifier: "user-hash",
      },
    },
  });
  assert.deepEqual(Buffer.from(result.image.uint8Array), png);
  assert.equal(result.image.base64, png.toString("base64"));
  assert.equal(result.usage.total_tokens, 12);
  assert.equal(result.response.requestId, "req-fixture");
});
test("image editing sends multipart files and mask without content-type override", async () => {
  await generateImage({
    model: openaiImage(undefined, {
      apiKey: "fixture",
      fetch: async (url, init) => {
        assert.match(url, /\/images\/edits$/);
        assert.equal(init.headers["Content-Type"], undefined);
        assert.equal(init.body.getAll("image[]").length, 2);
        assert.equal(init.body.get("mask").type, "image/png");
        assert.deepEqual(
          Buffer.from(await init.body.get("image[]").arrayBuffer()),
          png,
        );
        return imageReply();
      },
    }),
    prompt: "edit",
    images: [
      { data: png, mediaType: "image/png" },
      { data: new Blob([png]), mediaType: "image/png" },
    ],
    mask: { data: png, mediaType: "image/png" },
  });
});
const invalidOptions = [
  { prompt: "" },
  { n: 0 },
  { n: 1.5 },
  { n: 11 },
  { size: "512x512" },
  { size: "bad" },
  { size: "1025x1024" },
  { images: [] },
  { mask: { data: png, mediaType: "image/png" } },
  { images: [{ data: png, mediaType: "image/jpeg" }] },
  { providerOptions: { openai: { outputFormat: "gif" } } },
  {
    providerOptions: {
      openai: { background: "transparent", outputFormat: "jpeg" },
    },
  },
  { providerOptions: { openai: { outputCompression: 50 } } },
  { providerOptions: { openai: { inputFidelity: "high" } } },
  { providerOptions: { openai: { seed: 1 } } },
  { providerOptions: { other: {} } },
  { timeoutMs: 0 },
];
invalidOptions.forEach((options, i) =>
  test(`image input rejected before request ${i + 1}`, async () => {
    let calls = 0;
    await assert.rejects(
      generateImage({
        model: openaiImage(undefined, {
          apiKey: "fixture",
          fetch: async () => {
            calls++;
            return imageReply();
          },
        }),
        prompt: "blue square",
        ...options,
      }),
      MediaAPIError,
    );
    assert.equal(calls, 0);
  }),
);
for (const data of [
  { data: [] },
  { data: [{ url: "https://example.com/image" }] },
  { data: [{ b64_json: "!!!!" }] },
  { data: [{ b64_json: Buffer.from("not-image").toString("base64") }] },
])
  test("malformed image response is rejected without URL downloads", async () => {
    await assert.rejects(
      generateImage({
        model: openaiImage(undefined, {
          apiKey: "fixture",
          fetch: async () => json(data),
        }),
        prompt: "hi",
      }),
      { code: "invalid_response" },
    );
  });
test("media errors preserve status but redact provider body and do not retry", async () => {
  let calls = 0;
  await assert.rejects(
    generateImage({
      model: openaiImage(undefined, {
        apiKey: "fixture-secret",
        fetch: async () => {
          calls++;
          return new Response("fixture-secret prompt", { status: 429 });
        },
      }),
      prompt: "hi",
    }),
    (e) =>
      e instanceof MediaAPIError &&
      e.status === 429 &&
      !e.message.includes("secret"),
  );
  assert.equal(calls, 1);
});
test("media timeout interrupts a stalled custom fetch", async () => {
  await assert.rejects(
    generateImage({
      model: openaiImage(undefined, {
        apiKey: "fixture",
        fetch: () => new Promise(() => {}),
      }),
      prompt: "hi",
      timeoutMs: 10,
    }),
    { name: "TimeoutError" },
  );
});
test("media abort cancels a stalled response body", async () => {
  let cancelled = false;
  const controller = new AbortController();
  const pending = generateImage({
    model: openaiImage(undefined, {
      apiKey: "fixture",
      fetch: async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
        ),
    }),
    prompt: "hi",
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(cancelled, true);
});
test("realtime secret uses GA session, TTL, safety header and strips raw session", async () => {
  const result = await openaiRealtime(undefined, {
    apiKey: "fixture",
    fetch: async (url, init) => {
      assert.match(url, /\/realtime\/client_secrets$/);
      assert.equal(init.headers["OpenAI-Beta"], undefined);
      assert.equal(init.headers["OpenAI-Safety-Identifier"], "user-hash");
      const body = JSON.parse(init.body);
      assert.deepEqual(body.expires_after, {
        anchor: "created_at",
        seconds: 60,
      });
      assert.equal(body.session.type, "realtime");
      assert.equal(body.session.model, "gpt-realtime-2.1");
      assert.equal(
        body.session.audio.input.turn_detection.interrupt_response,
        true,
      );
      assert.equal(
        body.session.audio.input.transcription.model,
        "gpt-transcribe",
      );
      assert.equal(body.session.tools[0].type, "function");
      return json({
        value: "ek_fixture",
        expires_at: Date.now() / 1000 + 60,
        session: { instructions: "private" },
      });
    },
  }).createClientSecret({
    safetyIdentifier: "user-hash",
    transcriptionModel: "gpt-transcribe",
    tools: [{ name: "lookup", parameters: { type: "object" } }],
  });
  assert.equal(result.value, "ek_fixture");
  assert.equal(result.session, undefined);
});
test("realtime unified call sends SDP and server-controlled session config", async () => {
  const result = await openaiRealtime(undefined, {
    apiKey: "fixture",
    fetch: async (url, init) => {
      assert.match(url, /\/realtime\/calls$/);
      assert.equal(init.body.get("sdp"), "v=0\r\no=fixture");
      const config = JSON.parse(init.body.get("session"));
      assert.equal(config.audio.input.turn_detection, null);
      assert.deepEqual(config.output_modalities, ["text"]);
      return new Response("v=0\r\no=answer");
    },
  }).createCall({
    sdp: "v=0\r\no=fixture",
    turnDetection: null,
    outputModality: "text",
  });
  assert.equal(result.sdp, "v=0\r\no=answer");
});
for (const options of [
  { expiresAfterSeconds: 9 },
  { expiresAfterSeconds: 7201 },
  { maxOutputTokens: 0 },
  { turnDetection: { type: "invalid" } },
  { turnDetection: { type: "server_vad", threshold: 2 } },
  { language: "eng" },
  { safetyIdentifier: "a\nb" },
  { tools: [{ name: "bad name", parameters: {} }] },
])
  test("invalid realtime options never reach API", async () => {
    let calls = 0;
    await assert.rejects(
      openaiRealtime(undefined, {
        apiKey: "fixture",
        fetch: async () => {
          calls++;
        },
      }).createClientSecret(options),
      { code: "invalid_input" },
    );
    assert.equal(calls, 0);
  });
test("realtime rejects GPT-Live and expired secrets", async () => {
  assert.throws(() => openaiRealtime("gpt-live-1"), MediaAPIError);
  await assert.rejects(
    openaiRealtime(undefined, {
      apiKey: "fixture",
      fetch: async () => json({ value: "ek_old", expires_at: 1 }),
    }).createClientSecret(),
    { code: "invalid_response" },
  );
});
