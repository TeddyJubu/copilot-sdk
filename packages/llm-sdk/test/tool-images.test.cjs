const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { z } = require("zod");
const {
  generateText,
  streamText,
  tool,
  createRuntime,
} = require("../dist/index.js");
const { openai, createOpenAI } = require("../dist/providers/openai/index.js");
const { anthropic } = require("../dist/providers/anthropic/index.js");
const {
  OpenAIAdapter,
  AnthropicAdapter,
} = require("../dist/adapters/index.js");
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/3sAAAAASUVORK5CYII=";
const image = { type: "image", data: png, mediaType: "image/png" };
const modelOutput = {
  type: "content",
  content: [{ type: "text", text: "Inspect this image" }, image],
};
const originals = new Map();
let requests, reply;
before(async () => {
  for (const Client of new Set([
    require("openai").default,
    (await import("openai")).default,
    require("@anthropic-ai/sdk").default,
    (await import("@anthropic-ai/sdk")).default,
  ])) {
    originals.set(Client, Client.prototype.post);
    Client.prototype.post = function (path, options) {
      requests.push({ path, ...options });
      const p = Promise.resolve().then(() => reply(path, options));
      p._thenUnwrap = (fn) => p.then(fn);
      return p;
    };
  }
});
after(() => {
  for (const [Client, post] of originals) Client.prototype.post = post;
});
const response = (output) => ({
  id: "resp_image",
  status: "completed",
  output,
  usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
});
const call = (id) => ({
  type: "function_call",
  call_id: id,
  name: "inspect",
  arguments: '{"imageId":"authorized-image"}',
  status: "completed",
});
const text = {
  type: "message",
  role: "assistant",
  content: [{ type: "output_text", text: "Seen", annotations: [] }],
};
async function* events(r) {
  for (const item of r.output)
    yield { type: "response.output_item.done", item };
  yield { type: "response.completed", response: r };
}
beforeEach(() => {
  requests = [];
  reply = (path, { body }) => {
    const r = response([text]);
    return body.stream ? events(r) : r;
  };
});

for (const streaming of [false, true]) {
  test(`modern ${streaming ? "stream" : "complete"}: two image results, raw result, mapped bytes, replay and single execution`, async () => {
    let executions = 0,
      mappings = 0;
    reply = (path, { body }) => {
      assert.equal(path, "/responses");
      const outputs = body.input.filter(
        (x) => x.type === "function_call_output",
      );
      if (outputs.length) {
        assert.deepEqual(
          outputs.map((x) => x.call_id),
          ["call-a", "call-b"],
        );
        for (const output of outputs)
          assert.deepEqual(output.output, [
            { type: "input_text", text: "Inspect this image" },
            {
              type: "input_image",
              image_url: `data:image/png;base64,${png}`,
              detail: "auto",
            },
          ]);
      }
      const r = response(
        outputs.length ? [text] : [call("call-a"), call("call-b")],
      );
      return body.stream ? events(r) : r;
    };
    const params = {
      model: openai("gpt-4o", { apiKey: "fixture", api: "responses" }),
      prompt: "inspect",
      maxSteps: 3,
      tools: {
        inspect: tool({
          description: "inspect",
          parameters: z.object({ imageId: z.literal("authorized-image") }),
          execute: async (args) => {
            assert.equal(args.imageId, "authorized-image");
            executions++;
            return { privateUi: "raw-data" };
          },
          toModelOutput: (raw) => {
            assert.equal(raw.privateUi, "raw-data");
            mappings++;
            return {
              ...modelOutput,
              content: [
                modelOutput.content[0],
                { ...image, data: new Uint8Array(Buffer.from(png, "base64")) },
              ],
            };
          },
        }),
      },
    };
    const result = streaming
      ? await streamText(params)
      : await generateText(params);
    assert.equal(await result.text, "Seen");
    const history = (await result.response).messages;
    assert.equal(executions, 2);
    assert.equal(mappings, 2);
    assert.equal(
      history.filter((x) => x.role === "tool")[0].modelOutput.content[1].data,
      png,
    );
    if (streaming) {
      const parts = [];
      for await (const part of result.fullStream) parts.push(part);
      assert.equal(
        parts.filter((x) => x.type === "tool-result")[0].result.privateUi,
        "raw-data",
      );
      assert.equal(executions, 2);
    } else assert.equal(result.toolResults[0].result.privateUi, "raw-data");
    const restored = JSON.parse(JSON.stringify(history));
    await generateText({
      model: params.model,
      messages: [...restored, { role: "user", content: "again" }],
    });
    assert.equal(requests.length, 3);
  });
  test(`Runtime ${streaming ? "SSE" : "JSON"} preserves image output and tool-call ID`, async () => {
    reply = (path, { body }) => {
      const outputs = body.input.filter(
        (x) => x.type === "function_call_output",
      );
      if (outputs.length)
        assert.equal(outputs[0].output[1].type, "input_image");
      const r = response(outputs.length ? [text] : [call("runtime-image")]);
      return body.stream ? events(r) : r;
    };
    const runtime = createRuntime({
      provider: createOpenAI({ apiKey: "fixture", api: "responses" }),
      model: "gpt-4o",
      tools: [
        {
          name: "inspect",
          description: "inspect",
          location: "server",
          handler: async () => ({
            success: true,
            _aiContent: modelOutput.content,
          }),
        },
      ],
    });
    const result = streaming
      ? runtime.stream({ messages: [{ role: "user", content: "inspect" }] })
      : runtime.chat({
          messages: [{ role: "user", content: "inspect" }],
          streaming: false,
        });
    const collected = await result; // Runtime chat returns one of the two result wrappers.
    if (streaming) {
      const ev = [];
      for await (const e of collected) ev.push(e);
      assert.ok(ev.some((x) => x.type === "action:end" && x.modelOutput));
    } else {
      assert.equal(
        (await collected.messages).find((x) => x.role === "tool").modelOutput
          .content[1].data,
        png,
      );
    }
    assert.equal(requests.length, 2);
  });
}
const rawHistory = [
  {
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id: "img-call",
        type: "function",
        function: { name: "inspect", arguments: "{}" },
      },
    ],
  },
  {
    role: "tool",
    tool_call_id: "img-call",
    content: "raw UI text",
    modelOutput,
  },
];
for (const form of [
  image,
  { ...image, data: `data:image/png;base64,${png}` },
  { type: "image", url: "https://example.com/image.png" },
  { type: "image", fileId: "file-123", provider: "openai" },
])
  test(`Responses image form ${"url" in form ? "URL" : "fileId" in form ? "file ID" : form.data.startsWith("data:") ? "data URL" : "base64"}`, async () => {
    await new OpenAIAdapter({
      apiKey: "fixture",
      model: "gpt-4o",
      api: "responses",
    }).complete({
      messages: [],
      rawMessages: [
        rawHistory[0],
        { ...rawHistory[1], modelOutput: { type: "content", content: [form] } },
      ],
    });
    const output = requests[0].body.input.find(
      (x) => x.type === "function_call_output",
    );
    assert.equal(output.call_id, "img-call");
    assert.equal(output.output[0].type, "input_image");
    if ("fileId" in form) assert.equal(output.output[0].file_id, form.fileId);
  });
for (const modern of [false, true])
  for (const source of ["data", "url"])
    test(`Anthropic ${modern ? "modern" : "adapter"} ${source} nested tool image`, async () => {
      reply = (path, { body }) => {
        const result = body.messages.at(-1).content[0];
        assert.equal(result.type, "tool_result");
        assert.equal(result.tool_use_id, "img-call");
        assert.equal(
          result.content[1].source.type,
          source === "data" ? "base64" : "url",
        );
        return {
          content: [{ type: "text", text: "seen" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 10, output_tokens: 2 },
        };
      };
      const output = {
        ...modelOutput,
        content: [
          modelOutput.content[0],
          source === "data"
            ? image
            : { type: "image", url: "https://example.com/image.png" },
        ],
      };
      if (modern)
        await anthropic("claude-sonnet-4-5", { apiKey: "fixture" }).doGenerate({
          messages: [
            {
              role: "assistant",
              content: null,
              toolCalls: [{ id: "img-call", name: "inspect", args: {} }],
            },
            {
              role: "tool",
              toolCallId: "img-call",
              content: "raw",
              modelOutput: output,
            },
          ],
        });
      else
        await new AnthropicAdapter({
          apiKey: "fixture",
          model: "claude-sonnet-4-5",
        }).complete({
          messages: [],
          rawMessages: [
            rawHistory[0],
            { ...rawHistory[1], modelOutput: output },
          ],
        });
    });
for (const part of [
  { ...image, data: "invalid!" },
  { ...image, mediaType: "image/svg+xml" },
  { ...image, data: "data:image/jpeg;base64," + png },
  { ...image, url: "https://example.com" },
  { type: "image", url: "file:///tmp/a.png" },
  { type: "image", fileId: "file-x", provider: "other" },
])
  test(`invalid image rejected before request ${JSON.stringify(part).slice(0, 85)}`, async () => {
    await assert.rejects(
      () =>
        new OpenAIAdapter({ apiKey: "fixture", api: "responses" }).complete({
          messages: [],
          rawMessages: [
            {
              ...rawHistory[1],
              modelOutput: { type: "content", content: [part] },
            },
          ],
        }),
      /Tool image|tool image|Invalid|Unsupported/,
    );
    assert.equal(requests.length, 0);
  });
test("Chat endpoint rejects images explicitly, text-only output remains supported", async () => {
  const adapter = new OpenAIAdapter({ apiKey: "fixture", api: "chat" });
  await assert.rejects(
    () => adapter.complete({ messages: [], rawMessages: rawHistory }),
    /Image tool results require/,
  );
  assert.equal(requests.length, 0);
  reply = () => ({
    choices: [{ message: { content: "seen" }, finish_reason: "stop" }],
  });
  await adapter.complete({
    messages: [],
    rawMessages: [
      rawHistory[0],
      {
        ...rawHistory[1],
        modelOutput: {
          type: "content",
          content: [{ type: "text", text: "only text" }],
        },
      },
    ],
  });
  assert.equal(requests[0].body.messages.at(-1).content, "only text");
  assert.equal(requests[0].body.messages.at(-1).modelOutput, undefined);
});
test("Anthropic rejects OpenAI file references before network", async () => {
  await assert.rejects(
    () =>
      new AnthropicAdapter({ apiKey: "fixture" }).complete({
        messages: [],
        rawMessages: [
          rawHistory[0],
          {
            ...rawHistory[1],
            modelOutput: {
              type: "content",
              content: [
                { type: "image", fileId: "file-x", provider: "openai" },
              ],
            },
          },
        ],
      }),
    /cannot be sent/,
  );
  assert.equal(requests.length, 0);
});
test("cancelled tool never starts image continuation", async () => {
  const controller = new AbortController();
  reply = (path, { body }) => response([call("cancelled")]);
  await assert.rejects(
    () =>
      generateText({
        model: openai("gpt-4o", { apiKey: "fixture", api: "responses" }),
        prompt: "inspect",
        signal: controller.signal,
        maxSteps: 3,
        tools: {
          inspect: tool({
            description: "inspect",
            parameters: z.object({ imageId: z.string() }),
            execute: async () => {
              controller.abort();
              return { _aiContent: modelOutput.content };
            },
          }),
        },
      }),
    { name: "AbortError" },
  );
  assert.equal(requests.length, 1);
});
