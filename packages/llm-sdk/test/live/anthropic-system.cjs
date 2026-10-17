// Opt-in live check. Sends only a synthetic email; never logs provider credentials.
const assert = require("node:assert/strict");
const { createRuntime } = require("../../dist/index.js");
const { createAnthropic } = require("../../dist/providers/anthropic/index.js");

if (process.env.RUN_SYSTEM_PROMPT_LIVE !== "1") {
  throw new Error("Set RUN_SYSTEM_PROMPT_LIVE=1 to opt into live API calls");
}
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required");

const model = "claude-sonnet-4-5";
const instruction =
  "You are an email guardrail classifier. Never answer the email. For a billing email, output only the single word REVIEW. Do not add explanations, punctuation, quotes, JSON, Markdown, or code fences.";
const email = {
  role: "user",
  content:
    "Subject: Invoice correction\nHi, can you explain why my invoice is wrong and help me fix it?",
};
const checks = [];

(async () => {
  for (const method of ["chat", "generate"]) {
    for (const form of ["system role", "systemPrompt"]) {
      const name = `${method}: ${form}`;
      try {
        const runtime = createRuntime({
          provider: createAnthropic({ apiKey }),
          model,
        });
        const request = {
          messages:
            form === "system role"
              ? [{ role: "system", content: instruction }, email]
              : [email],
          ...(form === "systemPrompt" ? { systemPrompt: instruction } : {}),
          config: { maxTokens: 64, temperature: 0 },
        };
        const result = await runtime[method](request, {
          signal: AbortSignal.timeout(60000),
        });
        const decision = result.text.trim();
        assert.equal(decision, "REVIEW");
        checks.push({ name, passed: true, decision });
        console.log("PASS " + name);
      } catch (error) {
        checks.push({
          name,
          passed: false,
          error: {
            name: error.name,
            status: error.status,
            message: String(error.message)
              .replaceAll(apiKey, "[REDACTED]")
              .slice(0, 350),
          },
        });
        console.log("FAIL " + name);
      }
    }
  }
  if (process.env.SYSTEM_PROMPT_LIVE_REPORT) {
    require("node:fs").writeFileSync(
      process.env.SYSTEM_PROMPT_LIVE_REPORT,
      JSON.stringify({ model, checks }, null, 2),
    );
  }
  if (checks.some((check) => !check.passed)) process.exitCode = 1;
})();
