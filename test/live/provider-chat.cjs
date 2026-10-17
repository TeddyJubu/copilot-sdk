// Real provider calls through Copilot's ReactChat, HTTP adapter, Runtime, and SSE/JSON serializers.
// RUN_PROVIDER_CHAT=1 PROVIDER_MODELS='openai:gpt-6-luna,anthropic:claude-haiku-5-5' node test/live/provider-chat.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createRuntime } = require("../../packages/llm-sdk/dist/index.js");
const {
  createOpenAI,
} = require("../../packages/llm-sdk/dist/providers/openai/index.js");
const {
  createAnthropic,
} = require("../../packages/llm-sdk/dist/providers/anthropic/index.js");
const {
  ReactChat,
} = require("../../packages/copilot-sdk/dist/react/index.cjs");
if (process.env.RUN_PROVIDER_CHAT !== "1" || !process.env.PROVIDER_MODELS)
  throw new Error("Explicit live opt-in and model list required");
const originalFetch = global.fetch;
const results = [];
const definition = {
  name: "lookup",
  description: "Returns the required marker.",
  inputSchema: {
    type: "object",
    properties: { id: { type: "string", enum: ["sample"] } },
    required: ["id"],
  },
};
async function check(provider, model, streaming, kind) {
  let chat;
  try {
    let executions = 0;
    const finished = [],
      responses = [];
    const runtime = createRuntime({
      provider: provider === "openai" ? createOpenAI() : createAnthropic(),
      model,
      maxIterations: 3,
      tools:
        kind === "server"
          ? [
              {
                ...definition,
                location: "server",
                handler: async (args) => {
                  assert.equal(args.id, "sample");
                  executions++;
                  return { nested: [{ marker: "ORBIT-742" }] };
                },
              },
            ]
          : [],
    });
    global.fetch = async (url, init) => {
      if (url !== "https://copilot.test/api/chat")
        return originalFetch(url, init);
      const response = await runtime.handleRequest(new Request(url, init), {
        onFinish: (result) => finished.push(result),
      });
      responses.push(response.clone().text());
      return response;
    };
    chat = new ReactChat({
      runtimeUrl: "https://copilot.test/api/chat",
      streaming,
      llm: { temperature: 0, maxTokens: 1600 },
    });
    const pending = [];
    chat.onToolCalls((event) => pending.push(event));
    if (kind === "client")
      chat.setTools([{ ...definition, location: "client" }]);
    const sent = await chat.sendMessage(
      kind === "text"
        ? "Reply only ORBIT-742."
        : "Call lookup with id sample exactly once, then reply only with its nested marker.",
    );
    assert.equal(sent, true);
    if (kind === "client") {
      assert.equal(pending.length, 1);
      assert.equal(pending[0].toolCalls.length, 1);
      const call = pending[0].toolCalls[0];
      assert.equal(
        (call.args ?? JSON.parse(call.function.arguments)).id,
        "sample",
      );
      await chat.continueWithToolResults([
        { toolCallId: call.id, result: { nested: [{ marker: "ORBIT-742" }] } },
      ]);
    }
    assert.equal(chat.error, undefined);
    assert.equal(chat.status, "ready");
    assert.match(chat.messages.at(-1).content, /ORBIT-742/);
    assert.equal(
      new Set(chat.messages.map((m) => m.id)).size,
      chat.messages.length,
    );
    assert.equal(executions, kind === "server" ? 1 : 0);
    assert.ok(finished.every((r) => r.usage?.totalTokens > 0));
    const wire = (await Promise.all(responses)).join("\n");
    assert.ok(
      !/"(?:usage|input_tokens|prompt_tokens|completion_tokens)"\s*:/.test(
        wire,
      ),
      "billing usage reached HTTP clients",
    );
    assert.ok(
      !wire.includes(process.env.OPENAI_API_KEY || "unused-key-marker"),
    );
    assert.ok(
      !wire.includes(process.env.ANTHROPIC_API_KEY || "unused-key-marker"),
    );
    results.push({
      provider,
      model,
      streaming,
      kind,
      passed: true,
      requests: responses.length,
      usage: finished.map((r) => r.usage),
    });
    console.log("PASS", provider, model, streaming, kind);
  } catch (error) {
    let detail = String(error.message);
    for (const key of [
      process.env.OPENAI_API_KEY,
      process.env.ANTHROPIC_API_KEY,
    ])
      if (key) detail = detail.replaceAll(key, "[redacted]");
    results.push({
      provider,
      model,
      streaming,
      kind,
      passed: false,
      detail: detail.replace(/sk-[\w-]+/g, "[redacted]").slice(0, 400),
    });
    console.log("FAIL", provider, model, streaming, kind);
  } finally {
    chat?.dispose();
    global.fetch = originalFetch;
  }
  if (process.env.PROVIDER_CHAT_REPORT)
    fs.writeFileSync(
      process.env.PROVIDER_CHAT_REPORT,
      JSON.stringify(results, null, 2),
      { mode: 0o600 },
    );
}
(async () => {
  for (const pair of process.env.PROVIDER_MODELS.split(",")) {
    const [provider, model] = pair.split(":");
    assert.ok(["openai", "anthropic"].includes(provider));
    for (const streaming of [false, true])
      for (const kind of ["text", "server", "client"])
        await check(provider, model, streaming, kind);
  }
  console.log(
    JSON.stringify({
      passed: results.filter((r) => r.passed).length,
      failed: results.filter((r) => !r.passed).length,
    }),
  );
  if (results.some((r) => !r.passed)) process.exitCode = 1;
})();
