// Opt-in native API checks. Synthetic inputs only; prints no keys or raw HTTP errors.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { experimental_decide } = require("../../dist/index.js");
const provider = process.env.DECISION_TEST_PROVIDER;
const configs = {
  openai: ["OPENAI_API_KEY", "openaiDecision"],
  openrouter: ["OPENROUTER_API_KEY", "openrouterDecision"],
  typesafe: ["TYPESAFE_AI_API_KEY", "typesafeDecision"],
  cloudflare: ["CLOUDFLARE_AUTH_TOKEN", "cloudflareDecision"],
};
if (process.env.RUN_DECISIONS_LIVE !== "1" || !configs[provider])
  throw new Error("Explicit live provider opt-in required");
const [keyName, factory] = configs[provider];
if (!process.env[keyName]) throw new Error(`Missing ${keyName}`);
const model = require(`../../dist/providers/${provider}/index.js`)[factory](
  process.env.DECISION_TEST_MODEL,
  { apiKey: process.env[keyName] },
);
const questions = {
  outage: {
    type: "boolean",
    instructions:
      "Does this ticket report the service is unavailable for all users?",
    criteria: {
      true: "All users cannot use the service",
      false: "A billing or individual issue without a service outage",
    },
  },
  team: {
    type: "choice",
    instructions: "Which team should handle this ticket?",
    criteria: {
      billing: "Invoices, charges, refunds",
      engineering: "Service outages, bugs, technical failures",
    },
  },
  impact: {
    type: "score",
    instructions: "How much does this issue affect use of the service?",
    criteria: [
      "No interruption to using the service",
      "Some features or users blocked",
      "All users completely blocked",
    ],
  },
};
const checks = [];
async function check(name, fn) {
  if (
    process.env.DECISION_LIVE_FILTER &&
    !new RegExp(process.env.DECISION_LIVE_FILTER).test(name)
  )
    return;
  try {
    const evidence = await fn();
    checks.push({ name, passed: true, ...evidence });
    console.log("PASS " + name);
  } catch (e) {
    checks.push({
      name,
      passed: false,
      error: { name: e.name, code: e.code, status: e.status },
    });
    console.log("FAIL " + name);
  }
}
(async () => {
  for (const [label, ticket, expected, outage] of [
    [
      "billing",
      "I was charged twice for my subscription. Everything works normally. Please refund the duplicate charge.",
      "billing",
      false,
    ],
    [
      "outage",
      "The service is completely unavailable. All customers get an error on every request. Nobody can sign in or use any feature.",
      "engineering",
      true,
    ],
  ])
    await check(`${provider}: ${label}, three native questions`, async () => {
      const result = await experimental_decide({
        model,
        state: { ticket },
        questions,
      });
      assert.equal(result.answers.team.type, "choice");
      assert.equal(result.answers.team.choice, expected);
      assert.equal(result.answers.outage.type, "boolean");
      assert.ok(
        outage
          ? result.answers.outage.probability > 0.8
          : result.answers.outage.probability < 0.2,
      );
      assert.equal(result.answers.impact.type, "score");
      assert.ok(
        outage
          ? result.answers.impact.score > 1.5
          : result.answers.impact.score < 0.5,
      );
      assert.ok(result.usage.inputTokens > 0);
      return {
        model: result.response.modelId,
        answers: result.answers,
        usage: result.usage,
      };
    });
  if (provider === "openai")
    await check("openai: native image decision", async () => {
      const blue = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAb0lEQVR4nO3PAQkAAAyEwO9feoshgnABdNvJ8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ2oPcf88OIhvJ6vAAAAAElFTkSuQmCC",
        "base64",
      );
      const result = await experimental_decide({
        model,
        state: "Identify the dominant color in the supplied image.",
        images: [{ data: blue, mediaType: "image/png", detail: "low" }],
        questions: {
          color: {
            type: "choice",
            instructions: "What is the dominant color?",
            criteria: { red: "Red", blue: "Blue", green: "Green" },
          },
        },
      });
      assert.equal(result.answers.color.type, "choice");
      assert.equal(result.answers.color.choice, "blue");
      return {
        model: result.response.modelId,
        answers: result.answers,
        usage: result.usage,
      };
    });
  const report = {
    provider,
    requestedModel: model.modelId,
    timestamp: new Date().toISOString(),
    checks,
    passed: checks.every((c) => c.passed),
  };
  if (process.env.DECISION_TEST_REPORT)
    fs.writeFileSync(
      process.env.DECISION_TEST_REPORT,
      JSON.stringify(report, null, 2) + "\n",
    );
  console.log(JSON.stringify(report));
  if (!report.passed) process.exitCode = 1;
})().catch((e) => {
  console.error(
    JSON.stringify({ name: e.name, code: e.code, status: e.status }),
  );
  process.exitCode = 1;
});
