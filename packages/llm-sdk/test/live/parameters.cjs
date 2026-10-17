// Opt-in live regression: synthetic prompts; reports never contain keys or headers.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { openai } = require("../../dist/providers/openai/index.js");
const { OpenAIAdapter } = require("../../dist/adapters/index.js");
const { createFallbackChain } = require("../../dist/fallback/index.js");
if (process.env.RUN_PARAMETERS_LIVE !== "1" || !process.env.OPENAI_API_KEY)
  throw new Error("Explicit live opt-in and OPENAI_API_KEY required");
const key = process.env.OPENAI_API_KEY;
const checks = [];
const requests = [];
const originals = new Map();
const schema = {
  type: "object",
  properties: { id: { type: "string", enum: ["sample"] } },
  required: ["id"],
  additionalProperties: false,
};
const definition = {
  name: "inspect",
  description: "Inspect the sample",
  location: "server",
  inputSchema: schema,
};
const tool = {
  type: "function",
  function: {
    name: "inspect",
    description: definition.description,
    parameters: schema,
  },
};
async function collect(stream) {
  const events = [];
  for await (const event of stream) {
    if (event.type === "error")
      throw (
        event.error ??
        event.cause ??
        Object.assign(new Error(event.message), {
          status: event.status,
          code: event.providerCode,
          param: event.param,
        })
      );
    events.push(event);
  }
  return events;
}
async function check(name, fn) {
  if (
    process.env.PARAMETERS_LIVE_FILTER &&
    !new RegExp(process.env.PARAMETERS_LIVE_FILTER).test(name)
  )
    return;
  const start = requests.length;
  try {
    const details = await fn();
    checks.push({
      name,
      passed: true,
      requests: requests.slice(start),
      ...details,
    });
    console.log("PASS " + name);
  } catch (error) {
    checks.push({
      name,
      passed: false,
      requests: requests.slice(start),
      error: {
        name: error.name,
        status: error.status,
        code: error.code,
        param: error.param,
        message: String(error.message)
          .replaceAll(key, "[REDACTED]")
          .slice(0, 350),
      },
    });
    console.log("FAIL " + name);
  }
}
(async () => {
  // Observe real requests without replacing the transport or recording authorization.
  for (const Client of new Set([
    require("openai").default,
    (await import("openai")).default,
  ])) {
    const post = Client.prototype.post;
    originals.set(Client, post);
    Client.prototype.post = function (path, options) {
      const b = options.body;
      requests.push({
        path,
        model: b.model,
        temperature: b.temperature,
        max_tokens: b.max_tokens,
        max_completion_tokens: b.max_completion_tokens,
        max_output_tokens: b.max_output_tokens,
        reasoning: b.reasoning,
        reasoning_effort: b.reasoning_effort,
        include: b.include,
        stream: !!b.stream,
      });
      return post.call(this, path, options);
    };
  }
  try {
    for (const modern of [true, false])
      for (const streaming of [false, true]) {
        for (const scenario of [
          "default chat",
          "reasoning tools",
          "none tools",
          "Responses logprobs",
        ]) {
          await check(
            `${modern ? "modern" : "adapter"} ${streaming ? "stream" : "complete"}: ${scenario}`,
            async () => {
              const hasTools = scenario.endsWith("tools");
              const none = scenario === "none tools";
              const logprobs = scenario === "Responses logprobs";
              const warnings = [];
              const options = {
                apiKey: key,
                onWarning: (w) => warnings.push(w),
                ...(none && { reasoningEffort: "none" }),
                ...(logprobs && {
                  api: "responses",
                  responses: {
                    store: false,
                    include: ["message.output_text.logprobs"],
                  },
                }),
              };
              const messages = [
                {
                  role: "user",
                  content: hasTools
                    ? 'Call inspect exactly once with id="sample". Do not answer without calling the tool.'
                    : "Reply with exactly OK.",
                },
              ];
              const config = { temperature: 0, maxTokens: 1024 };
              let result;
              if (modern) {
                const model = openai("gpt-6-luna", options);
                const params = {
                  messages,
                  ...config,
                  tools: hasTools ? [tool] : undefined,
                  signal: AbortSignal.timeout(60000),
                };
                result = streaming
                  ? await collect(model.doStream(params))
                  : await model.doGenerate(params);
              } else {
                const adapter = new OpenAIAdapter({
                  model: "gpt-6-luna",
                  ...options,
                });
                const request = {
                  messages: messages.map((m) => ({ id: "synthetic", ...m })),
                  config,
                  toolDefinitions: hasTools ? [definition] : undefined,
                  signal: AbortSignal.timeout(60000),
                };
                result = streaming
                  ? await collect(adapter.stream(request))
                  : await adapter.complete(request);
              }
              const sent = requests.at(-1);
              const responses = logprobs || (hasTools && !none);
              assert.equal(
                sent.path,
                responses ? "/responses" : "/chat/completions",
              );
              assert.equal(sent.temperature, none ? 0 : undefined);
              assert.equal(
                sent[responses ? "max_output_tokens" : "max_completion_tokens"],
                1024,
              );
              assert.equal(sent.max_tokens, undefined);
              if (logprobs) {
                assert.deepEqual(sent.include, ["reasoning.encrypted_content"]);
                assert.ok(warnings.some((w) => w.includes("logprobs")));
              }
              if (hasTools) {
                const calls = streaming
                  ? result
                      .filter((e) =>
                        ["tool-call", "action:start"].includes(e.type),
                      )
                      .map((e) => e.toolCall ?? e)
                  : result.toolCalls;
                assert.equal(calls.length, 1);
                assert.equal(calls[0].name, "inspect");
              } else {
                const text = streaming
                  ? result.map((e) => e.text ?? e.content ?? "").join("")
                  : (result.text ?? result.content);
                assert.match(text, /OK/);
              }
              return { warnings: warnings.length };
            },
          );
        }
      }
    for (const streaming of [false, true])
      for (const allowFallback of [false, true]) {
        await check(
          `${streaming ? "stream" : "complete"}: real temperature 400, fallback ${allowFallback ? "enabled" : "disabled"}`,
          async () => {
            let retries = 0,
              fallbacks = 0,
              observed;
            const start = requests.length;
            const compatibility = (error) =>
              error.status === 400 &&
              error.param === "temperature" &&
              ["unsupported_parameter", "unsupported_value"].includes(
                error.code,
              );
            const chain = createFallbackChain({
              models: [
                new OpenAIAdapter({
                  model: "gpt-6-luna",
                  apiKey: key,
                  parameterPolicy: "passthrough",
                }),
                new OpenAIAdapter({ model: "gpt-4o", apiKey: key }),
              ],
              retries: 2,
              retryDelay: 0,
              ...(allowFallback && { fallbackErrors: compatibility }),
              onRetry: () => retries++,
              onFallback: ({ error }) => {
                fallbacks++;
                observed = error;
              },
            });
            const request = {
              messages: [
                { id: "synthetic", role: "user", content: "Reply exactly OK." },
              ],
              config: { temperature: 0 },
              signal: AbortSignal.timeout(60000),
            };
            const invoke = () =>
              streaming
                ? collect(chain.stream(request))
                : chain.complete(request);
            if (allowFallback) {
              const result = await invoke();
              assert.match(
                streaming
                  ? result.map((e) => e.content ?? "").join("")
                  : result.content,
                /OK/,
              );
            } else
              await assert.rejects(invoke(), (error) => {
                observed = error;
                return compatibility(error);
              });
            assert.equal(retries, 0);
            assert.equal(fallbacks, allowFallback ? 1 : 0);
            assert.equal(requests.length - start, allowFallback ? 2 : 1);
            return {
              status: observed.status,
              code: observed.code,
              param: observed.param,
              retries,
              fallbacks,
            };
          },
        );
      }
  } finally {
    for (const [Client, post] of originals) Client.prototype.post = post;
  }
  const report = {
    timestamp: new Date().toISOString(),
    checks,
    passed: checks.filter((c) => c.passed).length,
    failed: checks.filter((c) => !c.passed).length,
  };
  if (process.env.PARAMETERS_LIVE_REPORT)
    fs.writeFileSync(
      process.env.PARAMETERS_LIVE_REPORT,
      JSON.stringify(report, null, 2) + "\n",
    );
  console.log(JSON.stringify({ passed: report.passed, failed: report.failed }));
  process.exitCode = report.failed ? 1 : 0;
})().catch((error) => {
  console.error(String(error.message).replaceAll(key, "[REDACTED]"));
  process.exitCode = 1;
});
