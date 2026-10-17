// Tests the superseded API on an exact #98 checkout. Failures are merge blockers.
// PR_LLM_ROOT=/path/to/pr98/packages/llm-sdk node --test test/review/pr98-contract.cjs
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const path = require("node:path");
if (!process.env.PR_LLM_ROOT)
  throw new Error("Set PR_LLM_ROOT to the built PR #98 snapshot");
const load = createRequire(path.join(process.env.PR_LLM_ROOT, "package.json"));
const { OpenAIAdapter, AnthropicAdapter } = load("./dist/adapters/index.js");
const { createRuntime } = load("./dist/index.js");
test("Responses wrapper keeps customer prompt at user priority and honors maxTokens", async () => {
  const adapter = new OpenAIAdapter({ apiKey: "fixture", model: "gpt-5" });
  let sent;
  adapter.client = {
    responses: {
      create: async (body) => {
        sent = body;
        return { output: [] };
      },
    },
  };
  await createRuntime({ adapter }).response({
    prompt: "Customer content",
    maxTokens: 256,
  });
  assert.equal(sent.input[0].role, "user");
  assert.equal(sent.max_output_tokens, 256);
});
test("Responses wrapper forwards the token limit", async () => {
  const adapter = new OpenAIAdapter({ apiKey: "fixture", model: "gpt-5" });
  let sent;
  adapter.client = {
    responses: {
      create: async (body) => {
        sent = body;
        return { output: [] };
      },
    },
  };
  await adapter.respond({ prompt: "Customer content", maxTokens: 256 });
  assert.equal(sent.max_output_tokens, 256);
});
test("Anthropic reasoning budget fits inside output token limit", async () => {
  const adapter = new AnthropicAdapter({
    apiKey: "fixture",
    model: "claude-sonnet-4-5",
  });
  let sent;
  adapter.client = {
    beta: {
      messages: {
        create: async (body) => {
          sent = body;
          return { content: [] };
        },
      },
    },
  };
  await adapter.respond({
    prompt: "Customer content",
    reasoningEffort: "high",
  });
  assert.ok(sent.thinking.budget_tokens < sent.max_tokens);
});
test("Anthropic schema is directly inside output_config.format", async () => {
  const adapter = new AnthropicAdapter({
    apiKey: "fixture",
    model: "claude-sonnet-4-5",
  });
  let sent;
  adapter.client = {
    beta: {
      messages: {
        create: async (body) => {
          sent = body;
          return { content: [] };
        },
      },
    },
  };
  const schema = {
    type: "object",
    properties: { ok: { type: "boolean" } },
    required: ["ok"],
    additionalProperties: false,
  };
  await adapter.respond({
    prompt: "Customer content",
    outputSchema: { name: "result", schema },
  });
  assert.deepEqual(sent.output_config.format.schema, schema);
});
