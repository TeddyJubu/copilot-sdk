// Opt-in live compatibility checks. Uses synthetic data and never records keys or raw responses.
// RUN_PROVIDER_MATRIX=1 PROVIDER_MODELS='openai:gpt-6-luna,anthropic:claude-haiku-5-5' node test/live/provider-matrix.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { z } = require("zod");
const {
  generateText,
  streamText,
  createRuntime,
} = require("../../dist/index.js");
const {
  openai,
  createOpenAI,
} = require("../../dist/providers/openai/index.js");
const {
  anthropic,
  createAnthropic,
} = require("../../dist/providers/anthropic/index.js");
if (process.env.RUN_PROVIDER_MATRIX !== "1")
  throw new Error("Live opt-in required");
if (!process.env.PROVIDER_MODELS)
  throw new Error("Set PROVIDER_MODELS explicitly to bound live cost");
const models = process.env.PROVIDER_MODELS.split(",").map((value) =>
  value.split(":"),
);
const results = [];
const schema = {
  type: "object",
  properties: { marker: { type: "string" }, count: { type: "integer" } },
  required: ["marker", "count"],
  additionalProperties: false,
};
const cases = (
  process.env.PROVIDER_CASES || "text,json,schema,tools,tools-schema"
).split(",");
const surfaces = (process.env.PROVIDER_SURFACES || "modern,runtime").split(",");
const modes = (process.env.PROVIDER_MODES || "complete,stream").split(",");
const transports = (process.env.PROVIDER_TRANSPORTS || "auto").split(",");
const cleanError = (error) => {
  let message = String(error?.message ?? error);
  for (const key of [process.env.OPENAI_API_KEY, process.env.ANTHROPIC_API_KEY])
    if (key) message = message.replaceAll(key, "[redacted]");
  return message.replace(/sk-[\w-]+/g, "[redacted]").slice(0, 600);
};
const assertUsage = (usage) => {
  assert.ok(usage?.promptTokens > 0, "prompt token usage missing");
  assert.ok(usage?.completionTokens > 0, "completion token usage missing");
  assert.equal(usage.totalTokens, usage.promptTokens + usage.completionTokens);
};
async function run({ provider, modelId, surface, mode, scenario, transport }) {
  const streaming = mode === "stream";
  const hasTools = scenario.includes("tools");
  const callsTool = scenario.startsWith("tools");
  const structured = scenario.includes("schema") || scenario === "json";
  const nested = scenario === "nested-schema";
  const expected = nested
    ? {
        minimum: 7,
        oneOf: "literal",
        details: { pattern: "ORBIT-742", values: [1, 2], note: null },
      }
    : { marker: "ORBIT-742", count: 7 };
  const selectedSchema = nested
    ? {
        type: "object",
        properties: {
          minimum: { type: "integer" },
          oneOf: { type: "string", enum: ["literal"] },
          details: {
            type: "object",
            properties: {
              pattern: { type: "string" },
              values: { type: "array", items: { type: "integer" } },
              note: { type: ["string", "null"] },
            },
            required: ["pattern", "values", "note"],
            additionalProperties: false,
          },
        },
        required: ["minimum", "oneOf", "details"],
        additionalProperties: false,
      }
    : schema;
  const responseFormat = scenario.includes("schema")
    ? {
        type: "json_schema",
        json_schema: {
          name: "audit_result",
          strict: true,
          schema: selectedSchema,
        },
      }
    : scenario === "json"
      ? { type: "json_object" }
      : undefined;
  let executions = 0;
  const execute = async ({ id }) => {
    assert.equal(id, "sample");
    executions++;
    return { nested: [{ marker: "ORBIT-742", count: 7 }] };
  };
  const prompt = callsTool
    ? "Call lookup with id sample exactly once. Read the nested result. " +
      (structured
        ? "Return only a JSON object with marker and count from the result."
        : "Reply only with its marker.")
    : structured
      ? nested
        ? `Return only this JSON object: ${JSON.stringify(expected)}`
        : 'Return only a JSON object with marker "ORBIT-742" and count 7.'
      : "Do not call tools. Reply only ORBIT-742.";
  const config = {
    maxTokens: 1600,
    temperature: 0,
    responseFormat,
    ...(provider === "openai"
      ? {
          openai: {
            api: transport,
            ...(transport === "responses"
              ? { responses: { store: false } }
              : {}),
          },
        }
      : {}),
    ...(process.env.PROVIDER_EFFORT
      ? { reasoningEffort: process.env.PROVIDER_EFFORT }
      : {}),
  };
  const signal = AbortSignal.timeout(90000);
  let text,
    finalText,
    usage,
    chunks = 0;
  if (surface === "modern") {
    const thinkingOptions =
      process.env.PROVIDER_THINKING === "1"
        ? { thinking: { type: "enabled", budgetTokens: 1024 } }
        : {};
    const model =
      provider === "openai"
        ? openai(modelId)
        : anthropic(modelId, thinkingOptions);
    const params = {
      model,
      prompt,
      ...config,
      signal,
      maxSteps: 3,
      tools: hasTools
        ? {
            lookup: {
              description: "Read the marker and count for a sample.",
              parameters: z.object({ id: z.enum(["sample"]) }),
              execute,
            },
          }
        : undefined,
    };
    if (streaming) {
      const result = await streamText(params);
      // Attach rejection handlers immediately so a failed stream cannot leave unhandled promises.
      const outcome = Promise.all([result.text, result.usage]);
      outcome.catch(() => {});
      for await (const part of result.fullStream) {
        if (part.type === "error") throw part.error;
        if (part.type === "text-delta") chunks++;
      }
      [text, usage] = await outcome;
      finalText = (await result.response).messages
        .filter((m) => m.role === "assistant")
        .at(-1)?.content;
      assert.ok(chunks > 0, "stream returned no text deltas");
    } else {
      const result = await generateText(params);
      assert.notEqual(result.finishReason, "length", "response truncated");
      ({ text, usage } = result);
      finalText = result.response.messages
        .filter((m) => m.role === "assistant")
        .at(-1)?.content;
    }
  } else {
    const runtime = createRuntime({
      provider:
        provider === "openai"
          ? createOpenAI()
          : createAnthropic(
              process.env.PROVIDER_THINKING === "1"
                ? { thinkingBudget: 1024 }
                : {},
            ),
      model: modelId,
      maxIterations: 3,
      tools: hasTools
        ? [
            {
              name: "lookup",
              description: "Read the marker and count for a sample.",
              location: "server",
              inputSchema: {
                type: "object",
                properties: { id: { type: "string", enum: ["sample"] } },
                required: ["id"],
                additionalProperties: false,
              },
              handler: execute,
            },
          ]
        : undefined,
    });
    const result = await runtime.chat(
      { messages: [{ role: "user", content: prompt }], config, streaming },
      { signal },
    );
    const errors = result.events.filter((e) => e.type === "error");
    assert.equal(errors.length, 0, errors.map((e) => e.message).join("; "));
    ({ text, usage } = result);
    finalText = result.messages
      .filter((m) => m.role === "assistant")
      .at(-1)?.content;
    usage = usage && {
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens:
        usage.total_tokens ?? usage.prompt_tokens + usage.completion_tokens,
    };
    // chat() is server-side and deliberately collects usage. HTTP serializers are checked separately.
    assert.ok(
      !JSON.stringify(result.messages).includes('"input_tokens"'),
      "raw usage leaked to replay",
    );
    if (streaming) {
      chunks = result.events.filter((e) => e.type === "message:delta").length;
      assert.ok(chunks > 0, "runtime stream returned no text deltas");
    }
  }
  assertUsage(usage);
  assert.ok(
    finalText && text.includes(finalText),
    "final assistant text missing from collected output",
  );
  if (structured) assert.deepEqual(JSON.parse(finalText), expected);
  else
    assert.match(
      finalText.trim(),
      /^ORBIT-742[.!]?$/,
      "model must return the marker without unrelated text",
    );
  assert.equal(
    executions,
    callsTool ? 1 : 0,
    "unexpected tool execution count",
  );
  return { usage, executions, chunks };
}
const jobs = [];
for (const [provider, modelId] of models) {
  assert.ok(["openai", "anthropic"].includes(provider), "Unknown provider");
  assert.ok(
    process.env[provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"],
    "Required provider key missing",
  );
  for (const surface of surfaces)
    for (const mode of modes)
      for (const scenario of cases)
        for (const transport of provider === "openai"
          ? transports
          : ["messages"])
          jobs.push({ provider, modelId, surface, mode, scenario, transport });
}
const save = () => {
  if (process.env.PROVIDER_REPORT)
    fs.writeFileSync(
      process.env.PROVIDER_REPORT,
      JSON.stringify({ testedAt: new Date().toISOString(), results }, null, 2),
      { mode: 0o600 },
    );
};
async function worker() {
  while (jobs.length) {
    const job = jobs.shift(),
      start = Date.now();
    try {
      const detail = await run(job);
      results.push({
        ...job,
        passed: true,
        durationMs: Date.now() - start,
        ...detail,
      });
      console.log("PASS", Object.values(job).join(" / "));
    } catch (error) {
      results.push({
        ...job,
        passed: false,
        durationMs: Date.now() - start,
        error: cleanError(error),
      });
      console.log("FAIL", Object.values(job).join(" / "), cleanError(error));
    }
    save();
  }
}
Promise.all([worker(), worker()]).then(() => {
  console.log(
    JSON.stringify({
      passed: results.filter((r) => r.passed).length,
      failed: results.filter((r) => !r.passed).length,
    }),
  );
  if (results.some((r) => !r.passed)) process.exitCode = 1;
});
