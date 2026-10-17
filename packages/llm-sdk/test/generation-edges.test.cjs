const { test } = require("node:test");
const assert = require("node:assert/strict");
const { z } = require("zod");
const { OpenAIAdapter } = require("../dist/adapters/index.js");
const { createFallbackChain } = require("../dist/fallback/index.js");
const {
  generateText,
  streamText,
  createRuntime,
  runAgentLoop,
} = require("../dist/index.js");

const call = (id, name = "first", args = {}) => ({ id, name, args });
const usage = { promptTokens: 1, completionTokens: 1, totalTokens: 2 };
function events(calls) {
  return calls.flatMap((c) => [
    { type: "action:start", id: c.id, name: c.name },
    { type: "action:args", id: c.id, args: JSON.stringify(c.args) },
    { type: "action:end", id: c.id, name: c.name },
  ]);
}
function runtimeFixture(
  firstEvents,
  calls = [call("a")],
  handler = async () => "OK",
) {
  let requests = 0;
  const executed = [];
  const adapter = {
    provider: "fixture",
    model: "fixture",
    async complete() {
      return ++requests === 1
        ? { content: "", toolCalls: calls }
        : { content: "OK", toolCalls: [] };
    },
    async *stream() {
      if (++requests === 1) yield* firstEvents;
      else yield { type: "message:delta", content: "OK" };
      yield { type: "done" };
    },
  };
  const runtime = createRuntime({
    adapter,
    tools: ["first", "second"].map((name) => ({
      name,
      description: name,
      location: "server",
      inputSchema: { type: "object" },
      handler: async (args, ctx) => {
        executed.push([name, args]);
        return handler(args, ctx);
      },
    })),
  });
  return { runtime, executed, requests: () => requests };
}
const request = (streaming) => ({
  messages: [{ role: "user", content: "test" }],
  streaming,
});

for (const args of ["{", "null", "[]", "42"]) {
  test(`Runtime never executes malformed tool arguments: ${args}`, async () => {
    const t = runtimeFixture([
      { type: "action:start", id: "a", name: "first" },
      { type: "action:args", id: "a", args },
      { type: "action:end", id: "a", name: "first" },
    ]);
    const result = await t.runtime.chat(request(true));
    assert.deepEqual(t.executed, []);
    assert.ok(result.error);
  });
}
for (const scenario of [
  "missing-args",
  "missing-end",
  "wrong-name",
  "duplicate-end",
]) {
  test(`Runtime rejects invalid tool event sequence: ${scenario}`, async () => {
    const initial = events([call("a")]);
    if (scenario === "missing-args") initial.splice(1, 1);
    if (scenario === "missing-end") initial.pop();
    if (scenario === "wrong-name") initial[2].name = "second";
    if (scenario === "duplicate-end") initial.push(initial[2]);
    const t = runtimeFixture(initial);
    const result = await t.runtime.chat(request(true));
    assert.equal(t.executed.length, scenario === "duplicate-end" ? 1 : 0);
    assert.ok(result.error);
  });
}
test("Runtime matches interleaved argument events by ID", async () => {
  const a = events([call("a", "first", { value: 11 })]);
  const b = events([call("b", "second", { value: 22 })]);
  const t = runtimeFixture([a[0], b[0], a[1], b[1], b[2], a[2]]);
  const result = await t.runtime.chat(request(true));
  assert.equal(result.error, undefined);
  assert.deepEqual(t.executed, [
    ["second", { value: 22 }],
    ["first", { value: 11 }],
  ]);
});
for (const streaming of [false, true]) {
  for (const throws of [false, true])
    test(`Runtime cancellation during a tool stops later tools: ${streaming}/${throws}`, async () => {
      const controller = new AbortController();
      const calls = [call("a"), call("b", "second")];
      const t = runtimeFixture(events(calls), calls, async (_, ctx) => {
        assert.equal(ctx.signal, controller.signal);
        controller.abort();
        if (throws) throw new Error("tool stopped");
        return "OK";
      });
      const result = await t.runtime.chat(request(streaming), {
        signal: controller.signal,
      });
      assert.equal(t.executed.length, 1);
      assert.equal(t.requests(), 1);
      assert.match(result.error?.message ?? "", /abort/i);
    });
  test(`Runtime rejects duplicate tool IDs before executing a batch: ${streaming}`, async () => {
    const calls = [call("a"), call("a", "second")];
    const t = runtimeFixture(events(calls), calls);
    const result = await t.runtime.chat(request(streaming));
    assert.equal(t.executed.length, streaming ? 1 : 0);
    assert.ok(result.error);
  });
}
function coreFixture(toolCalls = []) {
  const requests = [];
  return {
    requests,
    provider: "fixture",
    modelId: "fixture",
    capabilities: {},
    async doGenerate(params) {
      requests.push(structuredClone(params.messages));
      return {
        text: "OK",
        toolCalls: requests.length === 1 ? toolCalls : [],
        finishReason:
          requests.length === 1 && toolCalls.length ? "tool-calls" : "stop",
        usage,
      };
    },
    async *doStream(params) {
      const r = await this.doGenerate(params);
      yield { type: "text-delta", text: r.text };
      for (const toolCall of r.toolCalls) yield { type: "tool-call", toolCall };
      yield { type: "finish", finishReason: r.finishReason, usage };
    },
  };
}
for (const fn of [generateText, streamText]) {
  for (const maxSteps of [0, -1, 1.5, NaN, Infinity])
    test(`${fn.name} rejects invalid maxSteps ${maxSteps} before requesting`, async () => {
      const model = coreFixture();
      await assert.rejects(fn({ model, prompt: "test", maxSteps }), /maxSteps/);
      assert.equal(model.requests.length, 0);
    });
  for (const output of [undefined, false, 0, null])
    test(`${fn.name} preserves empty and falsy tool results: ${String(output)}`, async () => {
      const model = coreFixture([call("a")]);
      const result = await fn({
        model,
        prompt: "test",
        maxSteps: 2,
        tools: {
          first: {
            description: "first",
            parameters: z.object({}),
            execute: async () => output,
          },
        },
      });
      await result.text;
      assert.equal(
        model.requests[1].find((m) => m.role === "tool").content,
        JSON.stringify(output ?? null),
      );
    });
}
test("generateText returns unexecuted calls and stops when no tools are supplied", async () => {
  const model = coreFixture([call("a")]);
  const result = await generateText({ model, prompt: "test", maxSteps: 3 });
  assert.equal(model.requests.length, 1);
  assert.deepEqual(result.toolCalls, [call("a")]);
});
test("streamText does not execute tools from an interrupted stream", async () => {
  let executions = 0;
  const model = coreFixture();
  model.doStream = async function* () {
    yield { type: "tool-call", toolCall: call("a") };
  };
  const result = await streamText({
    model,
    prompt: "test",
    tools: {
      first: {
        description: "first",
        parameters: z.object({}),
        execute: async () => executions++,
      },
    },
  });
  await assert.rejects(result.text, /finish|ended|incomplete/i);
  assert.equal(executions, 0);
});
test("streamText SSE errors retain a readable message", async () => {
  const model = coreFixture();
  model.doStream = async function* () {
    yield { type: "error", error: new Error("fixture failure") };
  };
  const result = await streamText({ model, prompt: "test" });
  const body = await result.toDataStreamResponse().text();
  assert.match(body, /fixture failure/);
  assert.doesNotMatch(body, /\[DONE\]/);
});

for (const format of ["toTextStreamResponse", "toDataStreamResponse"])
  test(`cancelling ${format} aborts the provider without aborting the caller signal`, async () => {
    const controller = new AbortController();
    let providerSignal;
    const model = coreFixture();
    model.doStream = async function* ({ signal }) {
      providerSignal = signal;
      yield { type: "text-delta", text: "partial" };
      await new Promise((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", resolve, { once: true });
      });
    };
    const result = await streamText({
      model,
      prompt: "test",
      signal: controller.signal,
    });
    const reader = result[format]().body.getReader();
    // The data stream has a step-start event before the first provider chunk.
    while (!providerSignal) await reader.read();
    await reader.cancel("client disconnected");
    assert.equal(providerSignal.aborted, true);
    assert.equal(controller.signal.aborted, false);
    await assert.rejects(result.text, /abort/i);
  });

for (const fn of [generateText, streamText])
  for (const failure of ["arguments", "handler", "unknown"])
    test(`${fn.name}: ${failure} failure becomes one tool result without re-execution`, async () => {
      const model = coreFixture([
        call("a", failure === "unknown" ? "toString" : "first", {
          value: "bad",
        }),
      ]);
      let executions = 0;
      const result = await fn({
        model,
        prompt: "test",
        maxSteps: 2,
        tools: {
          first: {
            description: "first",
            parameters:
              failure === "arguments"
                ? z.object({ value: z.number() })
                : z.object({ value: z.string() }),
            execute: async () => {
              executions++;
              throw new Error("fixture tool error");
            },
          },
        },
      });
      await result.text;
      assert.equal(executions, failure === "handler" ? 1 : 0);
      assert.equal(model.requests.length, 2);
      const messages = model.requests[1].filter((m) => m.role === "tool");
      assert.equal(messages.length, 1);
      assert.equal(typeof JSON.parse(messages[0].content).error, "string");
    });

for (const scenario of ["cancel", "invalid", "normal"])
  test(`public runAgentLoop handles ${scenario} without hidden executions`, async () => {
    const controller = new AbortController();
    let requests = 0;
    const executed = [],
      collected = [];
    for await (const event of runAgentLoop({
      provider: { name: "openai" },
      messages: [{ role: "user", content: "test" }],
      signal: controller.signal,
      tools: ["first", "second"].map((name) => ({
        name,
        description: name,
        location: "server",
        inputSchema: { type: "object" },
        handler: async (_, ctx) => {
          executed.push(name);
          assert.equal(ctx.signal, controller.signal);
          if (scenario === "cancel") controller.abort();
          return { success: true };
        },
      })),
      callLLM: async () => ({
        choices: [
          {
            finish_reason: ++requests === 1 ? "tool_calls" : "stop",
            message: {
              content: requests === 1 ? "" : "OK",
              tool_calls:
                requests === 1
                  ? ["first", "second"].map((name) => ({
                      id: name,
                      type: "function",
                      function: {
                        name,
                        arguments: scenario === "invalid" ? "{" : "{}",
                      },
                    }))
                  : [],
            },
          },
        ],
      }),
    }))
      collected.push(event);
    assert.deepEqual(
      executed,
      scenario === "normal"
        ? ["first", "second"]
        : scenario === "cancel"
          ? ["first"]
          : [],
    );
    if (scenario === "normal") {
      assert.equal(
        collected.filter((e) => e.type === "action:start").length,
        2,
      );
      assert.equal(collected.filter((e) => e.type === "action:end").length, 2);
    } else assert.ok(collected.some((e) => e.type === "error"));
  });

for (const streaming of [false, true])
  for (const scenario of [
    "malformed",
    "array",
    "null",
    "duplicate",
    "missing-id",
    "truncated",
  ])
    test(`OpenAI Chat ${streaming}/${scenario}: invalid calls fall back before any execution`, async () => {
      const adapter = new OpenAIAdapter({
        apiKey: "fixture",
        model: "gpt-4.1-mini",
        api: "chat",
      });
      const calls = [
        {
          id: scenario === "missing-id" ? "" : "a",
          type: "function",
          function: {
            name: "first",
            arguments:
              scenario === "malformed"
                ? "{"
                : scenario === "array"
                  ? "[]"
                  : scenario === "null"
                    ? "null"
                    : "{}",
          },
        },
      ];
      if (scenario === "duplicate") calls.push({ ...calls[0] });
      const finish_reason = scenario === "truncated" ? "length" : "tool_calls";
      adapter.client = {
        chat: {
          completions: {
            create: async (body) =>
              body.stream
                ? (async function* () {
                    yield {
                      choices: [
                        {
                          delta: {
                            tool_calls: calls.map((call, index) => ({
                              ...call,
                              index,
                            })),
                          },
                          finish_reason,
                        },
                      ],
                    };
                  })()
                : {
                    choices: [
                      {
                        message: { content: "", tool_calls: calls },
                        finish_reason,
                      },
                    ],
                  },
          },
        },
      };
      let executions = 0,
        fallbacks = 0;
      const backup = {
        provider: "fixture",
        model: "backup",
        complete: async () => {
          fallbacks++;
          return { content: "recovered", toolCalls: [] };
        },
        stream: async function* () {
          fallbacks++;
          yield { type: "message:delta", content: "recovered" };
          yield { type: "done" };
        },
      };
      const runtime = createRuntime({
        adapter: createFallbackChain({ models: [adapter, backup] }),
        tools: [
          {
            name: "first",
            description: "first",
            location: "server",
            inputSchema: { type: "object" },
            handler: async () => {
              executions++;
              return "OK";
            },
          },
        ],
      });
      const result = await runtime.chat(request(streaming));
      assert.equal(executions, 0);
      assert.equal(fallbacks, 1);
      assert.equal(result.text, "recovered");
    });

for (const fn of [generateText, streamText])
  test(`${fn.name}: tool schemas preserve nullable, integer, union and refined inputs`, async () => {
    const model = coreFixture();
    let schema;
    const generate = model.doGenerate;
    model.doGenerate = async function (params) {
      schema = params.tools[0].function.parameters;
      return generate.call(this, params);
    };
    const result = await fn({
      model,
      prompt: "test",
      tools: {
        first: {
          description: "first",
          parameters: z.object({
            nullable: z.string().nullable(),
            integer: z.number().int(),
            union: z.union([z.string(), z.number()]),
            optional: z.string().nullable().optional(),
            refined: z
              .object({ id: z.string() })
              .refine((v) => v.id.length > 0),
          }),
          execute: async () => "OK",
        },
      },
    });
    await result.text;
    assert.deepEqual(schema.required, [
      "nullable",
      "integer",
      "union",
      "refined",
    ]);
    assert.deepEqual(
      schema.properties.nullable.anyOf.map((s) => s.type),
      ["string", "null"],
    );
    assert.equal(schema.properties.integer.type, "integer");
    assert.deepEqual(
      schema.properties.union.anyOf.map((s) => s.type),
      ["string", "number"],
    );
    assert.equal(schema.properties.refined.properties.id.type, "string");
  });

test("public runAgentLoop emits client arguments before waiting for their result", async () => {
  const seen = [];
  let requests = 0;
  for await (const event of runAgentLoop({
    provider: { name: "openai" },
    messages: [{ role: "user", content: "test" }],
    tools: [
      {
        name: "confirm",
        description: "confirm",
        location: "client",
        inputSchema: { type: "object" },
      },
    ],
    callLLM: async () => ({
      choices: [
        {
          finish_reason: ++requests === 1 ? "tool_calls" : "stop",
          message: {
            content: requests === 1 ? "" : "OK",
            tool_calls:
              requests === 1
                ? [
                    {
                      id: "a",
                      type: "function",
                      function: { name: "confirm", arguments: "{}" },
                    },
                  ]
                : [],
          },
        },
      ],
    }),
    waitForClientToolResult: async (id) => {
      assert.ok(
        seen.some((event) => event.type === "action:start" && event.id === id),
      );
      assert.ok(
        seen.some((event) => event.type === "action:args" && event.id === id),
      );
      return { success: true };
    },
  }))
    seen.push(event);
  assert.equal(requests, 2);
  assert.equal(seen.filter((event) => event.type === "action:end").length, 1);
  assert.ok(!seen.some((event) => event.type === "error"));
});
