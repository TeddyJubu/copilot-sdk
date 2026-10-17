// RUN_PR_COMPAT_LIVE=1, plus only the OpenAI/Anthropic/OpenRouter keys.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");
const { z } = require(
  require("node:module")
    .createRequire(path.join(root, "packages/llm-sdk/package.json"))
    .resolve("zod"),
);
const { generateText, streamText, createRuntime } = require(
  path.join(root, "packages/llm-sdk/dist/index.js"),
);
const { openrouter } = require(
  path.join(root, "packages/llm-sdk/dist/providers/openrouter/index.js"),
);
const { openai } = require(
  path.join(root, "packages/llm-sdk/dist/providers/openai/index.js"),
);
const { createAnthropic } = require(
  path.join(root, "packages/llm-sdk/dist/providers/anthropic/index.js"),
);
if (process.env.RUN_PR_COMPAT_LIVE !== "1")
  throw new Error("Explicit live opt-in required");
const results = [];
async function check(name, fn) {
  if (process.env.PR_LIVE_ONLY && !name.includes(process.env.PR_LIVE_ONLY))
    return;
  try {
    const detail = await fn();
    results.push({ name, passed: true, ...detail });
    console.log("PASS " + name);
  } catch (error) {
    results.push({
      name,
      passed: false,
      error: error.name,
      status: error.status,
      detail: String(error.message)
        .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]")
        .slice(0, 300),
    });
    console.log("FAIL " + name + " (" + error.name + ")");
  }
}
(async () => {
  const model = openrouter("anthropic/claude-sonnet-4.5", {
    reasoning: { maxTokens: 1024 },
  });
  let history;
  await check(
    "OpenRouter reasoning complete and safe replay state",
    async () => {
      const result = await generateText({
        model,
        prompt: "Compute 17 * 19. Reply with only the number.",
        maxTokens: 1800,
        signal: AbortSignal.timeout(60000),
      });
      assert.match(result.text, /323/);
      assert.ok(
        result.reasoningText ||
          result.providerMetadata?.openrouter?.reasoningDetails?.length,
      );
      history = result.response.messages;
      assert.ok(!JSON.stringify(history).includes("prompt_tokens"));
      return { usage: result.usage, reasoningReturned: true };
    },
  );
  await check("OpenRouter reasoning stream and continuation", async () => {
    assert.ok(history, "complete probe must establish history");
    const result = await streamText({
      model,
      messages: [
        ...history,
        {
          role: "user",
          content: "Add 7 to your previous answer. Reply only with the number.",
        },
      ],
      maxTokens: 1800,
      signal: AbortSignal.timeout(60000),
    });
    let reasoningParts = 0;
    for await (const part of result.fullStream) {
      if (part.type === "error") throw part.error;
      if (part.type === "reasoning-delta") reasoningParts++;
    }
    assert.match(await result.text, /330/);
    const usage = await result.usage;
    assert.ok(usage.totalTokens > 0);
    return { reasoningParts, usage };
  });
  await check(
    "OpenRouter reasoning tool execution and signed continuation",
    async () => {
      let executions = 0;
      const result = await generateText({
        model,
        prompt:
          "Call lookup to get the marker. Then reply with only that marker.",
        tools: {
          lookup: {
            description: "Returns the required marker",
            parameters: z.object({}),
            execute: async () => {
              executions++;
              return { nested: [{ marker: "ORBIT-42" }] };
            },
          },
        },
        maxSteps: 3,
        maxTokens: 1800,
        signal: AbortSignal.timeout(60000),
      });
      assert.equal(executions, 1);
      assert.match(result.text, /ORBIT-42/);
      return { executions, steps: result.steps.length, usage: result.usage };
    },
  );
  await check(
    "OpenAI Responses preserves user prompt and structured tool history",
    async () => {
      const result = await generateText({
        model: openai("gpt-4.1-mini", { api: "responses" }),
        messages: [
          {
            role: "system",
            content:
              "Return the marker from the tool result, with no other text.",
          },
          { role: "user", content: "Read the lookup result." },
          {
            role: "assistant",
            content: null,
            toolCalls: [{ id: "call_probe", name: "lookup", args: {} }],
          },
          {
            role: "tool",
            toolCallId: "call_probe",
            content: JSON.stringify({ nested: [{ marker: "ORBIT-42" }] }),
          },
        ],
        maxTokens: 64,
        signal: AbortSignal.timeout(60000),
      });
      assert.match(result.text, /ORBIT-42/);
      return { usage: result.usage };
    },
  );
  for (const streaming of [false, true])
    await check(
      "Anthropic request system precedence " +
        (streaming ? "stream" : "complete"),
      async () => {
        const runtime = createRuntime({
          provider: createAnthropic(),
          model: "claude-haiku-4-5-20251001",
          systemPrompt: "Reply only SERVER_DEFAULT.",
        });
        const result = await runtime.chat({
          systemPrompt: "Reply only REQUEST_OVERRIDE.",
          messages: [{ role: "user", content: "State your required token." }],
          streaming,
          config: { maxTokens: 64 },
          signal: AbortSignal.timeout(60000),
        });
        assert.match(result.text, /REQUEST_OVERRIDE/);
        assert.ok(!result.text.includes("SERVER_DEFAULT"));
        return { text: result.text };
      },
    );
  if (process.env.PR_REPORT)
    fs.writeFileSync(process.env.PR_REPORT, JSON.stringify(results, null, 2));
  if (results.some((result) => !result.passed)) process.exitCode = 1;
})().catch((error) => {
  console.error(error.name);
  process.exitCode = 1;
});
