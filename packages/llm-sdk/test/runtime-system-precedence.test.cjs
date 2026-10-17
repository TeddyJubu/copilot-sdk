const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createRuntime } = require(
  path.join(
    process.env.PR_LLM_ROOT || path.resolve(__dirname, ".."),
    "dist/index.js",
  ),
);
for (const streaming of [false, true]) {
  test(`per-request system prompt continues to override runtime default (${streaming ? "stream" : "complete"})`, async () => {
    let prompt;
    const runtime = createRuntime({
      systemPrompt: "SERVER_DEFAULT",
      adapter: {
        provider: "fixture",
        model: "fixture",
        capabilities: {},
        async complete(request) {
          prompt = request.systemPrompt;
          return { content: "ok", toolCalls: [] };
        },
        async *stream(request) {
          prompt = request.systemPrompt;
          yield { type: "message:delta", content: "ok" };
          yield { type: "done" };
        },
      },
    });
    await runtime.chat({
      messages: [{ role: "user", content: "test" }],
      systemPrompt: "REQUEST_OVERRIDE",
      streaming,
    });
    assert.equal(prompt, "REQUEST_OVERRIDE");
    await runtime.chat({
      messages: [{ role: "user", content: "test" }],
      streaming,
    });
    assert.equal(prompt, "SERVER_DEFAULT");
  });
}
