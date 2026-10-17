const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const target = process.env.PR_LLM_ROOT || path.resolve(__dirname, "..");
const load = createRequire(path.join(target, "package.json"));
const { openrouter } = load("./dist/providers/openrouter/index.js");
const { generateText, streamText } = load("./dist/index.js");
let requests, reply;
const originals = new Map();
before(async () => {
  const clients = [
    load("openai").default,
    (
      await import(
        pathToFileURL(load.resolve("openai").replace(/index\.js$/, "index.mjs"))
      )
    ).default,
  ];
  for (const Client of new Set(clients)) {
    originals.set(Client, Client.prototype.post);
    Client.prototype.post = async function (endpoint, options) {
      requests.push({
        endpoint,
        body: structuredClone(options.body),
        signal: options.signal,
      });
      return reply(options.body);
    };
  }
});
after(() => {
  for (const [Client, original] of originals) Client.prototype.post = original;
});
beforeEach(() => {
  requests = [];
  reply = () => ({
    choices: [{ message: { content: "answer" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
  });
});
const model = (options = {}) =>
  openrouter("anthropic/fixture", { apiKey: "fixture", ...options });
test("OpenRouter default request leaves reasoning budget and endpoint unchanged", async () => {
  await generateText({ model: model(), prompt: "hello" });
  assert.equal(requests[0].endpoint, "/chat/completions");
  assert.equal(requests[0].body.reasoning, undefined);
});
test("explicit reasoning uses the same controls for complete and streaming", async () => {
  await generateText({
    model: model({ reasoning: { effort: "low", exclude: false } }),
    prompt: "hello",
  });
  assert.deepEqual(requests[0].body.reasoning, {
    effort: "low",
    exclude: false,
  });
  reply = () =>
    (async function* () {
      yield { choices: [{ delta: {}, finish_reason: "stop" }] };
    })();
  await (
    await streamText({
      model: model({ reasoning: { maxTokens: 2048 } }),
      prompt: "hello",
    })
  ).text;
  assert.deepEqual(requests[1].body.reasoning, { max_tokens: 2048 });
});
test("reasoning survives public fullStream while textStream stays answer-only", async () => {
  reply = () =>
    (async function* () {
      yield { choices: [{ delta: { reasoning: "Provider summary." } }] };
      yield {
        choices: [{ delta: { content: "answer" }, finish_reason: "stop" }],
      };
      yield {
        choices: [],
        usage: { prompt_tokens: 4, completion_tokens: 5, total_tokens: 9 },
      };
    })();
  const result = await streamText({ model: model(), prompt: "hello" });
  const parts = [];
  for await (const part of result.fullStream) parts.push(part);
  assert.deepEqual(
    parts.filter((p) => p.type === "reasoning-delta"),
    [{ type: "reasoning-delta", text: "Provider summary." }],
  );
  assert.equal(await result.text, "answer");
  assert.deepEqual(await result.usage, {
    promptTokens: 4,
    completionTokens: 5,
    totalTokens: 9,
  });
});
test("reasoning replay preserves opaque details without usage or raw response", async () => {
  const details = [
    {
      type: "reasoning.encrypted",
      data: "opaque-signature",
      id: "r1",
      index: 0,
    },
  ];
  reply = () => ({
    choices: [
      {
        message: {
          content: "answer",
          reasoning: "Summary.",
          reasoning_details: details.map((detail) => ({
            ...detail,
            usage: { total_tokens: 99 },
            diagnostic: "never replay",
          })),
        },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 4, completion_tokens: 5, total_tokens: 9 },
    secretDiagnostic: "never replay",
  });
  const first = await generateText({ model: model(), prompt: "hello" });
  assert.equal(first.reasoningText, "Summary.");
  const replay = first.response.messages.at(-1);
  assert.deepEqual(replay.providerMetadata, {
    openrouter: { reasoningDetails: details },
  });
  await generateText({
    model: model(),
    messages: [
      ...first.response.messages,
      { role: "user", content: "continue" },
    ],
  });
  assert.deepEqual(
    requests[1].body.messages.find((m) => m.role === "assistant")
      .reasoning_details,
    details,
  );
  assert.ok(!JSON.stringify(requests[1].body).includes("secretDiagnostic"));
});
test("parallel tool argument deltas do not corrupt each other", async () => {
  reply = () =>
    (async function* () {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "a",
                  function: { name: "first", arguments: '{"value":' },
                },
                {
                  index: 1,
                  id: "b",
                  function: { name: "second", arguments: '{"value":' },
                },
              ],
            },
          },
        ],
      };
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 1, function: { arguments: "2}" } },
                { index: 0, function: { arguments: "1}" } },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      };
    })();
  const parts = [];
  for await (const part of model().doStream({
    messages: [{ role: "user", content: "hello" }],
  }))
    parts.push(part);
  assert.deepEqual(
    parts.filter((p) => p.type === "tool-call").map((p) => p.toolCall),
    [
      { id: "a", name: "first", args: { value: 1 } },
      { id: "b", name: "second", args: { value: 2 } },
    ],
  );
});
test("image URLs remain URLs and structured tool output remains JSON", async () => {
  await generateText({
    model: model(),
    messages: [
      {
        role: "user",
        content: [{ type: "image", image: "https://example.com/image.png" }],
      },
      {
        role: "assistant",
        content: null,
        toolCalls: [{ id: "a", name: "first", args: {} }],
      },
      {
        role: "tool",
        toolCallId: "a",
        content: { data: [1, { code: "ORBIT-42" }] },
      },
    ],
  });
  assert.equal(
    requests[0].body.messages[0].content[0].image_url.url,
    "https://example.com/image.png",
  );
  assert.deepEqual(requests[0].body.messages.at(-1).content, {
    data: [1, { code: "ORBIT-42" }],
  });
});
test("abort signal reaches the network call", async () => {
  const controller = new AbortController();
  await model().doGenerate({
    messages: [{ role: "user", content: "hello" }],
    signal: controller.signal,
  });
  assert.equal(requests[0].signal, controller.signal);
});
test("conflicting reasoning controls fail before sending a request", async () => {
  await assert.rejects(
    generateText({
      model: model({ reasoning: { maxTokens: 20, effort: "high" } }),
      prompt: "hello",
    }),
    /effort or maxTokens/,
  );
  assert.equal(requests.length, 0);
});
test("reasoning blocks keep order when providers reuse indices", async () => {
  reply = () =>
    (async function* () {
      for (const detail of [
        { type: "reasoning.text", index: 0, text: "First " },
        { type: "reasoning.text", index: 0, text: "block", signature: "sig" },
        { type: "reasoning.text", index: 0, signature: "sig" },
        { type: "reasoning.encrypted", index: 0, id: "opaque1", data: "blob1" },
        { type: "reasoning.encrypted", index: 0, id: "opaque2", data: "blob2" },
        { type: "reasoning.summary", index: 0, summary: "Summary " },
        { type: "reasoning.summary", index: 0, summary: "done" },
      ])
        yield { choices: [{ delta: { reasoning_details: [detail] } }] };
      yield {
        choices: [{ delta: { content: "answer" }, finish_reason: "stop" }],
      };
    })();
  const result = await streamText({ model: model(), prompt: "hello" });
  const parts = [];
  for await (const part of result.fullStream) parts.push(part);
  assert.equal(
    parts
      .filter((part) => part.type === "reasoning-delta")
      .map((part) => part.text)
      .join(""),
    "First blockSummary done",
  );
  const details = (await result.providerMetadata).openrouter.reasoningDetails;
  assert.equal(details.length, 4);
  assert.equal(details[0].text, "First block");
  assert.equal(details[0].signature, "sig");
  assert.equal(details[1].data, "blob1");
  assert.equal(details[2].data, "blob2");
  assert.equal(details[3].summary, "Summary done");
});
