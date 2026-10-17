// Verifies real cache writes, cache reads and normalized billing totals with synthetic context.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const {
  anthropic,
  createAnthropic,
} = require("../../dist/providers/anthropic/index.js");
if (process.env.RUN_ANTHROPIC_CACHE !== "1" || !process.env.ANTHROPIC_API_KEY)
  throw new Error("Live opt-in and Anthropic key required");
const results = [];
(async () => {
  for (const surface of ["modern", "adapter"]) {
    const model = "claude-haiku-5-5";
    const subject =
      surface === "modern"
        ? anthropic(model, { cacheControl: true })
        : createAnthropic({ cacheControl: true }).languageModel(model);
    const context =
      `${surface} compatibility cache fixture ${Date.now()}.\n` +
      Array.from(
        { length: 180 },
        (_, i) =>
          `Record ${i}: the sample is synthetic, the marker is ORBIT-742, and the count is seven.`,
      ).join("\n");
    for (const step of ["write", "read"]) {
      try {
        const messages = [
          { role: "user", content: context + "\nReply only ORBIT-742." },
        ];
        const result =
          surface === "modern"
            ? await subject.doGenerate({
                messages,
                maxTokens: 800,
                signal: AbortSignal.timeout(60000),
              })
            : await subject.complete({
                messages: [],
                rawMessages: messages,
                config: { maxTokens: 800 },
                signal: AbortSignal.timeout(60000),
              });
        const raw = result.rawResponse.usage;
        assert.ok(
          raw[
            step === "read"
              ? "cache_read_input_tokens"
              : "cache_creation_input_tokens"
          ] > 0,
          `missing cache ${step}`,
        );
        assert.equal(
          result.usage.promptTokens,
          raw.input_tokens +
            raw.cache_read_input_tokens +
            raw.cache_creation_input_tokens,
        );
        assert.equal(
          result.usage.totalTokens,
          result.usage.promptTokens + result.usage.completionTokens,
        );
        assert.match(result.text ?? result.content, /ORBIT-742/);
        results.push({
          surface,
          step,
          passed: true,
          usage: result.usage,
          cachedTokens: raw.cache_read_input_tokens,
          cacheWriteTokens: raw.cache_creation_input_tokens,
        });
        console.log("PASS", surface, step);
      } catch (error) {
        results.push({
          surface,
          step,
          passed: false,
          error: String(error.message)
            .replaceAll(process.env.ANTHROPIC_API_KEY, "[redacted]")
            .slice(0, 300),
        });
        console.log("FAIL", surface, step);
      }
    }
  }
  if (process.env.CACHE_REPORT)
    fs.writeFileSync(
      process.env.CACHE_REPORT,
      JSON.stringify(results, null, 2),
      { mode: 0o600 },
    );
  if (results.some((r) => !r.passed)) process.exitCode = 1;
})();
