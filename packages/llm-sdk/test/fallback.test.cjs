const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  createFallbackChain,
  FallbackExhaustedError,
} = require("../dist/fallback/index.js");
async function collect(stream) {
  const out = [];
  for await (const x of stream) out.push(x);
  return out;
}
const request = {
  messages: [],
  config: { responseFormat: { type: "json_object" }, temperature: 0 },
};
const compatibility = (e) =>
  e.status === 400 &&
  ["unsupported_parameter", "unsupported_value"].includes(e.code) &&
  e.param === "temperature";
const unsupported = () =>
  Object.assign(new Error("unsupported temperature"), {
    status: 400,
    code: "unsupported_parameter",
    param: "temperature",
  });
function setup(error, config = {}, partial = null, errorEvent = false) {
  const calls = [0, 0],
    seen = [],
    retries = [],
    fallbacks = [];
  const adapters = [0, 1].map((i) => ({
    provider: "test",
    model: `model-${i}`,
    async complete(req) {
      calls[i]++;
      seen.push(req);
      if (i === 0) throw error;
      return { content: "ok", toolCalls: [], rawResponse: {} };
    },
    async *stream(req) {
      calls[i]++;
      seen.push(req);
      yield { type: "message:start", id: `m-${i}` };
      if (i === 0) {
        if (partial) yield partial;
        if (errorEvent) {
          yield {
            type: "error",
            message: error.message,
            status: error.status,
            providerCode: error.code,
            param: error.param,
          };
          return;
        }
        throw error;
      }
      yield { type: "message:delta", content: "ok" };
      yield { type: "done" };
    },
  }));
  const chain = createFallbackChain({
    models: adapters,
    retries: 2,
    retryDelay: 0,
    onRetry: (x) => retries.push(x),
    onFallback: (x) => fallbacks.push(x),
    ...config,
  });
  return { chain, calls, seen, retries, fallbacks };
}
for (const mode of ["complete", "stream"]) {
  const invoke = (chain, req = request) =>
    mode === "stream" ? collect(chain.stream(req)) : chain.complete(req);
  test(`${mode}: compatibility fallback advances once with no retry and preserves request/schema`, async () => {
    const t = setup(unsupported(), { fallbackErrors: compatibility });
    await invoke(t.chain);
    assert.deepEqual(t.calls, [1, 1]);
    assert.equal(t.retries.length, 0);
    assert.equal(t.fallbacks.length, 1);
    assert.ok(t.seen.every((r) => r === request));
  });
  test(`${mode}: compatibility fallback remains opt-in`, async () => {
    const t = setup(unsupported());
    await assert.rejects(invoke(t.chain), /unsupported temperature/);
    assert.deepEqual(t.calls, [1, 0]);
  });
  test(`${mode}: actual OpenAI unsupported_value temperature code requires explicit fallback`, async () => {
    for (const enabled of [false, true]) {
      const error = Object.assign(unsupported(), { code: "unsupported_value" });
      const t = setup(error, enabled ? { fallbackErrors: compatibility } : {});
      if (enabled) await invoke(t.chain);
      else await assert.rejects(invoke(t.chain), /unsupported temperature/);
      assert.deepEqual(t.calls, enabled ? [1, 1] : [1, 0]);
      assert.equal(t.retries.length, 0);
    }
  });
  for (const status of [401, 403, 404, 400]) {
    test(`${mode}: unrelated ${status} errors stop without fallback`, async () => {
      const error = Object.assign(new Error("invalid request"), {
        status,
        code: "invalid_json_schema",
        param: "response_format",
      });
      const t = setup(error, { fallbackErrors: compatibility });
      await assert.rejects(invoke(t.chain), /invalid request/);
      assert.deepEqual(t.calls, [1, 0]);
    });
  }
  for (const status of [429, 503]) {
    test(`${mode}: ${status} retains bounded transient retries then fallback`, async () => {
      const t = setup(
        Object.assign(new Error("transient failure"), { status }),
        { fallbackErrors: compatibility },
      );
      await invoke(t.chain);
      assert.deepEqual(t.calls, [3, 1]);
      assert.deepEqual(
        t.retries.map((r) => r.retryAttempt),
        [1, 2],
      );
    });
  }
  test(`${mode}: abort stops even with unconditional predicates`, async () => {
    const t = setup(
      Object.assign(new Error("cancelled"), { name: "AbortError" }),
      { retryableErrors: () => true, fallbackErrors: () => true },
    );
    await assert.rejects(invoke(t.chain), { name: "AbortError" });
    assert.deepEqual(t.calls, [1, 0]);
  });
  test(`${mode}: cancellation during backoff prevents the next attempt`, async () => {
    const controller = new AbortController();
    const t = setup(Object.assign(new Error("server error"), { status: 503 }), {
      retryDelay: 60000,
      onRetry: () => controller.abort(),
    });
    await assert.rejects(
      invoke(t.chain, { ...request, signal: controller.signal }),
      { name: "AbortError" },
    );
    assert.deepEqual(t.calls, [1, 0]);
  });
  test(`${mode}: pre-aborted request makes no model call`, async () => {
    const controller = new AbortController();
    controller.abort();
    const t = setup(unsupported(), { fallbackErrors: compatibility });
    await assert.rejects(
      invoke(t.chain, { ...request, signal: controller.signal }),
      { name: "AbortError" },
    );
    assert.deepEqual(t.calls, [0, 0]);
  });
}

for (const partial of [
  { type: "message:delta", content: "partial" },
  { type: "action:end", id: "side-effect", name: "write" },
]) {
  for (const errorEvent of [false, true]) {
    test(`stream: no retry/fallback after ${partial.type}, errorEvent=${errorEvent}`, async () => {
      const t = setup(
        Object.assign(new Error("server failed"), { status: 503 }),
        { fallbackErrors: () => true },
        partial,
        errorEvent,
      );
      await assert.rejects(collect(t.chain.stream(request)), /server failed/);
      assert.deepEqual(t.calls, [1, 0]);
      assert.equal(t.fallbacks.length, 0);
    });
  }
}
test("stream: serialized errors retain status/code/param for compatibility policy", async () => {
  const t = setup(unsupported(), { fallbackErrors: compatibility }, null, true);
  await collect(t.chain.stream(request));
  assert.deepEqual(t.calls, [1, 1]);
  assert.equal(t.fallbacks[0].error.param, "temperature");
});
test("exhausted compatibility failures preserve per-model errors and zero retries", async () => {
  const error = unsupported();
  const model = {
    provider: "test",
    model: "unavailable",
    async complete() {
      throw error;
    },
  };
  const chain = createFallbackChain({
    models: [model, model],
    retries: 2,
    fallbackErrors: compatibility,
  });
  await assert.rejects(
    chain.complete(request),
    (e) =>
      e instanceof FallbackExhaustedError &&
      e.failures.length === 2 &&
      e.failures.every((f) => f.error === error && f.retriesAttempted === 0),
  );
});
