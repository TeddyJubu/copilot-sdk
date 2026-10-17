// Opt-in, bounded live workflow: text model -> tool -> native Decision -> JSON Schema.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { z } = require("zod");
const {
  generateText,
  streamText,
  createRuntime,
  experimental_decide,
} = require("../../dist/index.js");
const {
  openai,
  createOpenAI,
  openaiDecision,
} = require("../../dist/providers/openai/index.js");
const {
  anthropic,
  createAnthropic,
} = require("../../dist/providers/anthropic/index.js");
if (process.env.RUN_DECISION_TOOLS !== "1")
  throw new Error("Explicit live opt-in required");
const questions = {
  team: {
    type: "choice",
    instructions: "Which team should handle this support ticket?",
    criteria: {
      billing: "Duplicate charges and invoices",
      engineering: "Technical failures and outages",
    },
  },
};
const schema = {
  type: "object",
  properties: {
    team: { type: "string", enum: ["billing", "engineering"] },
    marker: { type: "string" },
  },
  required: ["team", "marker"],
  additionalProperties: false,
};
const responseFormat = {
  type: "json_schema",
  json_schema: { name: "route", strict: true, schema },
};
const prompt =
  "Call classify_ticket exactly once with ticketId sample. The result contains the team and marker. Return those two values as JSON. Do not invent a tool result.";
const checks = [];
(async () => {
  for (const [provider, modelId] of [
    ["openai", "gpt-6-luna"],
    ["anthropic", "claude-haiku-5-5"],
  ])
    for (const surface of ["modern", "runtime"])
      for (const streaming of [false, true]) {
        const label = `${provider}/${surface}/${streaming}`;
        let executions = 0;
        try {
          const execute = async ({ ticketId }, context) => {
            assert.equal(ticketId, "sample");
            executions++;
            const result = await experimental_decide({
              model: openaiDecision(),
              state: {
                ticket:
                  "I was charged twice. All product features work normally. Please refund the duplicate charge.",
              },
              questions,
              signal: context.abortSignal ?? context.signal,
            });
            assert.equal(result.answers.team.type, "choice");
            assert.equal(result.answers.team.choice, "billing");
            assert.ok(result.usage.inputTokens > 0);
            // Return only the decision needed by the model, never raw provider diagnostics.
            return { team: result.answers.team.choice, marker: "ROUTE-742" };
          };
          let result;
          const signal = AbortSignal.timeout(60000);
          if (surface === "modern") {
            result = await (streaming ? streamText : generateText)({
              model:
                provider === "openai" ? openai(modelId) : anthropic(modelId),
              prompt,
              responseFormat,
              maxTokens: 1800,
              maxSteps: 3,
              signal,
              tools: {
                classify_ticket: {
                  description:
                    "Classify a support ticket using native Decisions",
                  parameters: z.object({ ticketId: z.string() }),
                  execute,
                },
              },
            });
          } else {
            const runtime = createRuntime({
              provider:
                provider === "openai" ? createOpenAI() : createAnthropic(),
              model: modelId,
              tools: [
                {
                  name: "classify_ticket",
                  description:
                    "Classify a support ticket using native Decisions",
                  location: "server",
                  inputSchema: {
                    type: "object",
                    properties: { ticketId: { type: "string" } },
                    required: ["ticketId"],
                  },
                  handler: execute,
                },
              ],
            });
            result = await runtime.chat(
              {
                messages: [{ role: "user", content: prompt }],
                config: { responseFormat, maxTokens: 1800 },
                streaming,
              },
              { signal },
            );
            assert.equal(result.error, undefined);
          }
          const messages =
            surface === "modern"
              ? (await result.response).messages
              : result.messages;
          const last = messages.filter((m) => m.role === "assistant").at(-1);
          assert.deepEqual(JSON.parse(last.content), {
            team: "billing",
            marker: "ROUTE-742",
          });
          assert.equal(executions, 1);
          checks.push({ label, passed: true, modelId, executions });
          console.log("PASS " + label);
        } catch (e) {
          checks.push({
            label,
            passed: false,
            modelId,
            executions,
            error: { name: e.name, code: e.code, status: e.status },
          });
          console.log("FAIL " + label);
        }
      }
  if (process.env.DECISION_TOOLS_REPORT)
    fs.writeFileSync(
      process.env.DECISION_TOOLS_REPORT,
      JSON.stringify({ checks }, null, 2),
    );
  console.log(
    JSON.stringify({
      passed: checks.filter((c) => c.passed).length,
      total: checks.length,
    }),
  );
  if (checks.some((c) => !c.passed)) process.exitCode = 1;
})().catch((e) => {
  console.error(JSON.stringify({ name: e.name, code: e.code }));
  process.exitCode = 1;
});
