const test = require("node:test");
const assert = require("node:assert/strict");
const { experimental_decide: decide } = require("../dist/index.js");
const { openaiDecision } = require("../dist/providers/openai/index.js");
const { openrouterDecision } = require("../dist/providers/openrouter/index.js");
const { typesafeDecision } = require("../dist/providers/typesafe/index.js");
const { cloudflareDecision } = require("../dist/providers/cloudflare/index.js");

const questions = {
  urgent: {
    type: "boolean",
    instructions: "Is the whole service down?",
    criteria: { true: "All users affected", false: "One user affected" },
  },
  team: {
    type: "choice",
    instructions: "Route this incident",
    criteria: { billing: "Invoices", engineering: { scope: "Outages" } },
  },
  severity: {
    type: "score",
    instructions: "Rate impact",
    criteria: ["None", "Some", "All users blocked"],
  },
};
const state = {
  ticket: "The service is down for everyone",
  context: [1, true, null],
};
const native = () => ({
  model: "jev-1.13.0",
  answers: {
    urgent: { type: "noul", noul: 0.99 },
    team: {
      type: "choice",
      choice: "engineering",
      probabilities: { billing: 0.1, engineering: 0.9 },
      confidence: 0.8,
    },
    severity: {
      type: "score",
      score: 1.8,
      probabilities: { 0: 0, 1: 0.2, 2: 0.8 },
      confidence: 0.7,
      legend: { 0: "None", 1: "Some", 2: "All users blocked" },
    },
  },
  usage: { input_tokens: 45, output_tokens: 12 },
});
const openaiBody = () => ({
  model: "gpt-6-luna",
  answers: [
    { type: "predicate", name: "urgent", probability: 0.99 },
    {
      type: "choice",
      name: "team",
      choice: "engineering",
      probabilities: [
        { value: "billing", probability: 0.1 },
        { value: "engineering", probability: 0.9 },
      ],
      confidence: 0.8,
    },
    {
      type: "score",
      name: "severity",
      score: 1.8,
      probabilities: [
        { value: 0, probability: 0 },
        { value: 1, probability: 0.2 },
        { value: 2, probability: 0.8 },
      ],
      confidence: 0.7,
    },
  ],
  usage: {
    input_tokens: 45,
    input_tokens_details: { cached_tokens: 12, cache_write_tokens: 4 },
    output_tokens: 0,
    total_tokens: 45,
  },
});
const factories = {
  openai: openaiDecision,
  openrouter: openrouterDecision,
  typesafe: typesafeDecision,
  cloudflare: cloudflareDecision,
};
function responseFor(provider) {
  if (provider === "openai") return openaiBody();
  if (provider === "cloudflare")
    return {
      success: true,
      result: { ...native(), model: "clef" },
      errors: [],
      messages: [],
    };
  if (provider === "openrouter")
    return {
      ...native(),
      model: "typesafe/jev-1.13",
      provider: "TypeSafe",
      id: "decision-1",
      usage: { ...native().usage, cost: 0.00001 },
    };
  return native();
}
function stub(
  provider = "openai",
  payload = responseFor(provider),
  extra = {},
) {
  const calls = [];
  const model = factories[provider](undefined, {
    apiKey: "test-only-not-a-real-key",
    accountId: "a".repeat(32),
    fetch: async (url, init) => {
      calls.push({
        url,
        headers: init.headers,
        body: JSON.parse(init.body),
        signal: init.signal,
      });
      return new Response(JSON.stringify(payload), {
        headers: { "x-request-id": "req-test" },
      });
    },
    ...extra,
  });
  return { model, calls };
}
const request = (model, extra = {}) =>
  decide({ model, state, questions, ...extra });
const isCode = (code) => (error) => error.code === code;

for (const provider of Object.keys(factories)) {
  test(`${provider}: all three questions, identity, confidence and raw usage survive`, async () => {
    const { model, calls } = stub(provider);
    const result = await request(model);
    assert.deepEqual(Object.keys(result.answers), Object.keys(questions));
    assert.equal(result.answers.urgent.probability, 0.99);
    assert.equal(result.answers.team.choice, "engineering");
    assert.equal(result.answers.team.confidence, 0.8);
    assert.equal(result.answers.severity.score, 1.8);
    assert.equal(result.response.requestId, "req-test");
    assert.equal(result.usage.inputTokens, 45);
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].headers.Authorization,
      "Bearer test-only-not-a-real-key",
    );
    assert.equal(calls[0].body.temperature, undefined);
    if (provider === "openai") {
      assert.equal(calls[0].url, "https://api.openai.com/v1/decisions");
      assert.deepEqual(
        JSON.parse(calls[0].body.input[0].content[0].text),
        state,
      );
      assert.equal(calls[0].body.questions[0].type, "predicate");
      assert.match(
        calls[0].body.questions[0].instructions,
        /Criteria for true/,
      );
      assert.equal(result.usage.cachedInputTokens, 12);
      assert.equal(result.usage.outputTokens, 0);
    } else {
      assert.deepEqual(calls[0].body.state, state);
      assert.equal(calls[0].body.questions.urgent.type, "noul");
      if (provider === "openrouter") {
        assert.equal(calls[0].url, "https://openrouter.ai/api/alpha/decisions");
        assert.equal(result.usage.costUsd, 0.00001);
      }
      if (provider === "typesafe")
        assert.equal(calls[0].url, "https://api.typesafe.ai/v1/systemone");
      if (provider === "cloudflare") {
        assert.match(
          calls[0].url,
          /accounts\/a{32}\/ai\/run\/@cf\/cloudflare\/clef$/,
        );
        assert.equal(calls[0].body.model, "clef");
      }
    }
    assert.deepEqual(result.response.body, responseFor(provider));
  });
}

test("named refusal preserves other answers, without inventing an answer", async () => {
  const body = openaiBody();
  body.answers[1] = { name: "team", type: "refusal" };
  const result = await request(stub("openai", body).model);
  assert.deepEqual(result.answers.team, { type: "refusal" });
  assert.equal(result.answers.urgent.probability, 0.99);
});
test("unnamed refusal is a distinct error", async () => {
  const body = openaiBody();
  body.answers[0] = { name: null, type: "refusal" };
  await assert.rejects(request(stub("openai", body).model), isCode("refusal"));
});
const malformed = {
  duplicate: (b) => b.answers.push(b.answers[0]),
  missing: (b) => b.answers.pop(),
  unknown: (b) => (b.answers[0].name = "unrequested"),
  "missing identity": (b) => delete b.answers[0].name,
  "wrong type": (b) => (b.answers[0].type = "choice"),
  "invalid probability": (b) => (b.answers[0].probability = 1.1),
  "wrong choice": (b) => (b.answers[1].choice = "sales"),
  "typed choice collision": (b) => (b.answers[1].probabilities[0].value = true),
  "duplicate probability": (b) =>
    b.answers[1].probabilities.push(b.answers[1].probabilities[0]),
  "missing probability": (b) => b.answers[1].probabilities.pop(),
  "negative probability": (b) =>
    (b.answers[1].probabilities[0].probability = -0.1),
  "distribution sum": (b) => (b.answers[1].probabilities[0].probability = 0.5),
  "lower probability choice": (b) => (b.answers[1].choice = "billing"),
  "score out of bounds": (b) => (b.answers[2].score = 3),
  "score mismatch": (b) => (b.answers[2].score = 0.8),
  "noninteger score index": (b) => (b.answers[2].probabilities[0].value = 0.5),
  "unknown score index": (b) => (b.answers[2].probabilities[0].value = 3),
  "invalid confidence": (b) => (b.answers[2].confidence = 1.5),
  "invalid usage": (b) => (b.usage.input_tokens = -1),
  "missing model": (b) => delete b.model,
};
for (const [label, mutate] of Object.entries(malformed))
  test(`reject malformed upstream: ${label}`, async () => {
    const body = openaiBody();
    mutate(body);
    await assert.rejects(
      request(stub("openai", body).model),
      isCode("invalid_response"),
    );
  });
test("question IDs and choices named __proto__ are ordinary keys", async () => {
  const qs = JSON.parse(
    '{"__proto__":{"type":"choice","instructions":"Choose","criteria":{"__proto__":null,"constructor":null}}}',
  );
  const b = {
    model: "gpt-6-luna",
    answers: [
      {
        type: "choice",
        name: "__proto__",
        choice: "__proto__",
        probabilities: [
          { value: "__proto__", probability: 1 },
          { value: "constructor", probability: 0 },
        ],
      },
    ],
  };
  const r = await request(stub("openai", b).model, { questions: qs });
  assert.equal(
    Object.getOwnPropertyDescriptor(r.answers, "__proto__").value.choice,
    "__proto__",
  );
  assert.equal({}.polluted, undefined);
});
test("TypeSafe rounded distributions are preserved; OpenAI is not given that tolerance", async () => {
  const qs = {
    x: { type: "score", instructions: "Rate", criteria: ["a", "b", "c"] },
  };
  const answer = {
    type: "score",
    score: 1,
    probabilities: { 0: 0.33, 1: 0.33, 2: 0.33 },
  };
  const r = await request(
    stub("typesafe", { model: "jev-1.13", answers: { x: answer } }).model,
    { questions: qs },
  );
  assert.deepEqual(r.answers.x.probabilities, answer.probabilities);
  await assert.rejects(
    request(
      stub("openai", {
        model: "gpt-6-luna",
        answers: [
          {
            ...answer,
            name: "x",
            probabilities: Object.entries(answer.probabilities).map(
              ([value, probability]) => ({ value: Number(value), probability }),
            ),
          },
        ],
      }).model,
      { questions: qs },
    ),
    isCode("invalid_response"),
  );
});
test("gateway may omit distributions and confidence; nothing is fabricated", async () => {
  const b = responseFor("openrouter");
  delete b.answers.team.probabilities;
  delete b.answers.team.confidence;
  const result = await request(stub("openrouter", b).model);
  assert.deepEqual(result.answers.team, {
    type: "choice",
    choice: "engineering",
  });
});
const invalidInputs = {
  "empty questions": { questions: {} },
  "unknown question": { questions: { q: { type: "tool", instructions: "" } } },
  "one choice": {
    questions: {
      q: { type: "choice", instructions: "", criteria: { a: null } },
    },
  },
  "one score level": {
    questions: { q: { type: "score", instructions: "", criteria: ["one"] } },
  },
  "nonfinite state": { state: { n: Infinity } },
  "nonplain state": { state: new Date() },
  "undefined state value": { state: { n: undefined } },
  "unknown sampling option": { temperature: 0 },
  "invalid timeout": { timeoutMs: 0 },
  "invalid boolean criteria": {
    questions: {
      q: { type: "boolean", instructions: "yes?", criteria: { maybe: "yes" } },
    },
  },
};
for (const [label, input] of Object.entries(invalidInputs))
  test(`reject input before calling provider: ${label}`, async () => {
    const { model, calls } = stub();
    await assert.rejects(request(model, input), isCode("invalid_input"));
    assert.equal(calls.length, 0);
  });
test("circular and sparse JSON are rejected rather than silently rewritten", async () => {
  const cycle = {};
  cycle.self = cycle;
  for (const value of [cycle, Array(2), { n: BigInt(2) }])
    await assert.rejects(
      request(stub().model, { state: value }),
      isCode("invalid_input"),
    );
});
test("provider-specific limits and incompatible options fail before fetch", async () => {
  for (const [provider, extra] of [
    ["cloudflare", { questions: { "bad id": questions.urgent } }],
    [
      "cloudflare",
      {
        questions: Object.fromEntries(
          Array.from({ length: 65 }, (_, i) => [String(i), questions.urgent]),
        ),
      },
    ],
    [
      "openai",
      {
        questions: Object.fromEntries(
          Array.from({ length: 201 }, (_, i) => [String(i), questions.urgent]),
        ),
      },
    ],
    [
      "typesafe",
      {
        questions: {
          q: {
            type: "score",
            instructions: "Rate",
            criteria: Array(11).fill("level"),
          },
        },
      },
    ],
    [
      "openrouter",
      { questions: { q: { ...questions.urgent, criteria: { true: "yes" } } } },
    ],
    ["openai", { providerOptions: { openai: { temperature: 0 } } }],
  ]) {
    const { model, calls } = stub(provider);
    await assert.rejects(request(model, extra));
    assert.equal(calls.length, 0);
  }
});
test("provider options are mapped explicitly", async () => {
  const a = stub();
  await request(a.model, {
    providerOptions: {
      openai: { safetyIdentifier: "user-1", promptCacheKey: "support" },
    },
  });
  assert.equal(a.calls[0].body.prompt_cache_key, "support");
  assert.equal(a.calls[0].body.safety_identifier, "user-1");
  const o = stub("openrouter");
  await request(o.model, {
    providerOptions: {
      openrouter: {
        sessionId: "s",
        provider: { order: ["TypeSafe"], allowFallbacks: false },
      },
    },
  });
  assert.deepEqual(o.calls[0].body.provider, {
    order: ["TypeSafe"],
    allow_fallbacks: false,
  });
  const t = stub("typesafe");
  await request(t.model, {
    providerOptions: { typesafe: { longContext: true } },
  });
  assert.equal(t.calls[0].headers["TypeSafe-Danger-Zone-Long-Context"], "true");
});
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/nWQAAAAASUVORK5CYII=",
  "base64",
);
test("native image formats: OpenAI data URL, Jev referenced assets, Cloudflare base64", async () => {
  for (const provider of ["openai", "typesafe", "cloudflare"]) {
    const { model, calls } = stub(provider);
    await request(model, { images: [{ data: png, mediaType: "image/png" }] });
    const body = calls[0].body;
    if (provider === "openai")
      assert.match(
        body.input[0].content[1].image_url,
        /^data:image\/png;base64,/,
      );
    if (provider === "typesafe") {
      assert.deepEqual(body.state.state, state);
      const ref = body.state.images[0];
      assert.equal(body.assets[ref].data_base64, png.toString("base64"));
      assert.equal(calls[0].headers["TypeSafe-Danger-Zone-Images"], "true");
    }
    if (provider === "cloudflare")
      assert.deepEqual(body.images, [
        { content_type: "image/png", base64: png.toString("base64") },
      ]);
  }
});
test("OpenAI forwards URLs and detail without downloading them", async () => {
  const { model, calls } = stub();
  await request(model, {
    images: [{ data: new URL("https://example.com/test.png"), detail: "low" }],
  });
  assert.deepEqual(calls[0].body.input[0].content[1], {
    type: "input_image",
    image_url: "https://example.com/test.png",
    detail: "low",
  });
  assert.equal(calls.length, 1);
});
test("unsupported and oversized images are never silently dropped", async () => {
  for (const [provider, images] of [
    ["openrouter", [{ data: png }]],
    ["typesafe", [{ data: new URL("https://example.com/a.png") }]],
    ["cloudflare", Array(5).fill({ data: png })],
    [
      "cloudflare",
      [{ data: Buffer.concat([png, Buffer.alloc(4 * 1024 * 1024)]) }],
    ],
    ["openai", [{ data: png, mediaType: "image/jpeg" }]],
    ["typesafe", [{ data: png, detail: "low" }]],
    ["openai", [{ data: new URL("file:///tmp/image.png") }]],
    ["openai", [{ data: Buffer.from("not an image") }]],
  ]) {
    const { model, calls } = stub(provider);
    await assert.rejects(request(model, { images }));
    assert.equal(calls.length, 0);
  }
});
for (const status of [400, 401, 429, 500, 529])
  test(`HTTP ${status}: sanitized error and no automatic retry`, async () => {
    let count = 0;
    const model = openaiDecision(undefined, {
      apiKey: "secret-test",
      fetch: async () => {
        count++;
        return new Response("secret-test sensitive prompt", { status });
      },
    });
    await assert.rejects(
      request(model),
      (error) =>
        error.code === "http_error" &&
        error.status === status &&
        !error.message.includes("secret-test") &&
        error.retryable === (status >= 500 || status === 429),
    );
    assert.equal(count, 1);
  });
test("network errors are sanitized", async () => {
  const model = openaiDecision(undefined, {
    apiKey: "secret-test",
    fetch: async () => {
      throw new Error("secret-test");
    },
  });
  await assert.rejects(
    request(model),
    (error) =>
      error.code === "network_error" &&
      error.retryable &&
      !error.message.includes("secret-test"),
  );
});
test("malformed JSON and Cloudflare failed/invalid envelopes are rejected", async () => {
  const model = openaiDecision(undefined, {
    apiKey: "test",
    fetch: async () => new Response("<html>wrong</html>"),
  });
  await assert.rejects(request(model), isCode("invalid_response"));
  await assert.rejects(
    request(
      stub("cloudflare", { success: false, errors: [{ message: "private" }] })
        .model,
    ),
    isCode("http_error"),
  );
  await assert.rejects(
    request(stub("cloudflare", native()).model),
    isCode("invalid_response"),
  );
});
test("abort before fetch and during response preserves caller reason", async () => {
  const controller = new AbortController();
  const reason = new Error("caller cancelled");
  controller.abort(reason);
  const { model, calls } = stub();
  await assert.rejects(
    request(model, { signal: controller.signal }),
    (error) => error === reason,
  );
  assert.equal(calls.length, 0);
  const during = new AbortController();
  let cancelled = false;
  const pending = openaiDecision(undefined, {
    apiKey: "test",
    fetch: async () =>
      new Response(
        new ReadableStream({
          start() {
            setTimeout(() => during.abort(reason), 10);
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
  });
  await assert.rejects(
    request(pending, { signal: during.signal }),
    (error) => error === reason,
  );
  assert.equal(cancelled, true);
});
test("timeout covers a stalled fetch and response body, without retrying", async () => {
  const stalled = openaiDecision(undefined, {
    apiKey: "test",
    fetch: async () => new Promise(() => {}),
  });
  await assert.rejects(request(stalled, { timeoutMs: 15 }), {
    name: "TimeoutError",
  });
  let cancelled = false;
  const body = openaiDecision(undefined, {
    apiKey: "test",
    fetch: async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
      ),
  });
  await assert.rejects(request(body, { timeoutMs: 15 }), {
    name: "TimeoutError",
  });
  assert.equal(cancelled, true);
});
test("response-size limit cancels the body", async () => {
  let cancelled = false;
  const model = openaiDecision(undefined, {
    apiKey: "test",
    fetch: async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(8 * 1024 * 1024 + 1));
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
  });
  await assert.rejects(request(model), isCode("invalid_response"));
  assert.equal(cancelled, true);
});
test("custom DecisionModel output receives the same validation", async () => {
  const model = {
    provider: "custom",
    modelId: "x",
    doDecide: async () => ({
      answers: { urgent: { type: "boolean", probability: NaN } },
      response: { provider: "custom", modelId: "x" },
    }),
  };
  await assert.rejects(
    request(model, { questions: { urgent: questions.urgent } }),
    isCode("invalid_response"),
  );
});

test("errors are identifiable across root, provider, CJS and ESM bundles", async () => {
  const { DecisionAPIError } = require("../dist/index.js");
  const esm = await import("../dist/index.mjs");
  const esmProvider = await import("../dist/providers/openai/index.mjs");
  const model = esmProvider.openaiDecision(undefined, {
    apiKey: "test",
    fetch: async () => new Response("", { status: 429 }),
  });
  await assert.rejects(
    request(model),
    (error) =>
      DecisionAPIError.isInstance(error) &&
      esm.DecisionAPIError.isInstance(error),
  );
});
test("auth and content type cannot be accidentally duplicated by header casing", async () => {
  const { model, calls } = stub("openai", openaiBody(), {
    headers: {
      authorization: "old-test",
      "content-type": "text/plain",
      "X-Trace": "t",
    },
  });
  await request(model);
  const headers = new Headers(calls[0].headers);
  assert.equal(headers.get("authorization"), "Bearer test-only-not-a-real-key");
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(headers.get("x-trace"), "t");
});
