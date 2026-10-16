const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");

const llmRoot =
  process.env.COMPAT_LLM_ROOT || path.resolve(__dirname, "../packages/llm-sdk");
const llmRequire = createRequire(path.join(llmRoot, "package.json"));
const { createRuntime } = llmRequire("./dist/index.js");
const { createOpenAI } = llmRequire("./dist/providers/openai/index.js");
const { ReactChat } = require("../packages/copilot-sdk/dist/react/index.cjs");

// Exercise the real Copilot chat state, HTTP transport, Runtime, adapters and
// SSE serialization. Only the provider response and network hop are fixtures.
const originalFetch = global.fetch;
const originalPosts = new Map();
let runtime, requests, finished, scenario;
const screenshot = {
  type: "image",
  mimeType: "image/png",
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/3sAAAAASUVORK5CYII=",
};
const schema = {
  type: "object",
  properties: { id: { type: "string" } },
  required: ["id"],
  additionalProperties: false,
};
const chatUsage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
const responseUsage = { input_tokens: 10, output_tokens: 5, total_tokens: 15 };
const definitions = ["lookup", "display"].map((name) => ({
  name,
  description: name,
  inputSchema: schema,
}));

function chunks(values) {
  const stream = (async function* () {
    yield* values;
  })();
  stream.controller = new AbortController();
  return stream;
}
function providerReply(endpoint, { body }) {
  if (scenario === "error")
    throw Object.assign(new Error("401 test authentication failure"), {
      status: 401,
      code: "invalid_api_key",
    });
  const isResponses = endpoint === "/responses";
  assert.ok(isResponses || endpoint === "/chat/completions");
  const replayed = isResponses
    ? body.input.some((item) => item.type === "function_call_output")
    : body.messages.some((message) => message.role === "tool");
  const tools =
    scenario === "text" || replayed
      ? []
      : scenario === "mixed"
        ? definitions
        : definitions.slice(0, 1);
  const calls = tools.map((tool, index) => ({
    id: `call-${index}`,
    name: tool.name,
    arguments: JSON.stringify({ id: "check" }),
  }));
  const text = calls.length ? "" : "Checked: ORBIT-42";
  if (isResponses) {
    const output = calls.length
      ? calls.map((call) => ({
          type: "function_call",
          call_id: call.id,
          name: call.name,
          arguments: call.arguments,
        }))
      : [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text }],
          },
        ];
    if (!body.stream)
      return {
        id: "response-test",
        status: "completed",
        output,
        usage: responseUsage,
      };
    return chunks([
      ...(calls.length
        ? calls.map((call, output_index) => ({
            type: "response.output_item.added",
            output_index,
            item: {
              type: "function_call",
              call_id: call.id,
              name: call.name,
              arguments: "",
            },
          }))
        : [{ type: "response.output_text.delta", delta: text }]),
      ...calls.map((call, output_index) => ({
        type: "response.function_call_arguments.delta",
        output_index,
        delta: call.arguments,
      })),
      {
        type: "response.completed",
        response: { status: "completed", output, usage: responseUsage },
      },
    ]);
  }
  const tool_calls = calls.map((call) => ({
    id: call.id,
    type: "function",
    function: { name: call.name, arguments: call.arguments },
  }));
  if (!body.stream)
    return {
      choices: [
        {
          message: { content: text, ...(calls.length ? { tool_calls } : {}) },
          finish_reason: calls.length ? "tool_calls" : "stop",
        },
      ],
      usage: chatUsage,
    };
  return chunks([
    {
      choices: [
        {
          delta: calls.length
            ? {
                tool_calls: tool_calls.map((call, index) => ({
                  ...call,
                  index,
                  function: { ...call.function, arguments: '{"id":' },
                })),
              }
            : { content: text },
          finish_reason: null,
        },
      ],
    },
    ...(calls.length
      ? [
          {
            choices: [
              {
                delta: {
                  tool_calls: calls.map((call, index) => ({
                    index,
                    function: { arguments: '"check"}' },
                  })),
                },
                finish_reason: null,
              },
            ],
          },
        ]
      : []),
    {
      choices: [
        { delta: {}, finish_reason: calls.length ? "tool_calls" : "stop" },
      ],
    },
    { choices: [], usage: chatUsage },
  ]);
}

before(async () => {
  const esm = pathToFileURL(
    path.join(path.dirname(llmRequire.resolve("openai")), "index.mjs"),
  ).href;
  for (const Client of new Set([
    llmRequire("openai").default,
    (await import(esm)).default,
    llmRequire("@anthropic-ai/sdk").default,
    (
      await import(
        pathToFileURL(
          path.join(
            path.dirname(llmRequire.resolve("@anthropic-ai/sdk")),
            "index.mjs",
          ),
        ).href
      )
    ).default,
  ])) {
    originalPosts.set(Client, Client.prototype.post);
    Client.prototype.post = function (endpoint, options) {
      requests.push({ endpoint, body: options.body });
      const result = Promise.resolve().then(() =>
        providerReply(endpoint, options),
      );
      result._thenUnwrap = (fn) => result.then(fn);
      return result;
    };
  }
  global.fetch = async (url, init) => {
    assert.equal(url, "https://copilot.test/api/chat");
    return runtime.handleRequest(new Request(url, init), {
      onFinish(result) {
        finished.push(result);
      },
    });
  };
});
after(() => {
  global.fetch = originalFetch;
  for (const [Client, post] of originalPosts) Client.prototype.post = post;
});
beforeEach(() => {
  requests = [];
  finished = [];
});

const models = process.env.COMPAT_LEGACY_ONLY
  ? ["gpt-4o", "gpt-5.2"]
  : ["gpt-4o", "gpt-5.2", "gpt-6-luna"];
for (const model of models)
  for (const streaming of [false, true]) {
    for (const kind of ["text", "server", "client", "mixed", "screenshot"]) {
      test(`Copilot ${model} ${streaming ? "SSE" : "JSON"}: ${kind}`, async () => {
        scenario = kind;
        const executed = [];
        const serverTools =
          kind === "server" || kind === "mixed"
            ? [
                {
                  ...definitions[0],
                  location: "server",
                  handler: async (args) => {
                    executed.push(args);
                    return { success: true, data: { code: "ORBIT-42" } };
                  },
                },
              ]
            : [];
        runtime = createRuntime({
          provider: createOpenAI({ apiKey: "test-only", onWarning() {} }),
          model,
          tools: serverTools,
          maxIterations: 3,
          systemPrompt: "Keep the existing prompt.",
        });
        const chat = new ReactChat({
          runtimeUrl: "https://copilot.test/api/chat",
          streaming,
          threadId: "existing-thread",
          llm: { temperature: 0, maxTokens: 256 },
        });
        const pending = [];
        chat.onToolCalls((event) => pending.push(event));
        if (["client", "mixed", "screenshot"].includes(kind))
          chat.setTools([
            { ...definitions[kind === "mixed" ? 1 : 0], location: "client" },
          ]);
        try {
          assert.equal(await chat.sendMessage("Check the code."), true);
          if (["client", "mixed", "screenshot"].includes(kind)) {
            assert.equal(pending.length, 1);
            const calls = pending[0].toolCalls;
            assert.equal(calls.length, 1);
            assert.deepEqual(
              calls[0].args ?? JSON.parse(calls[0].function.arguments),
              { id: "check" },
            );
            await chat.continueWithToolResults(
              calls.map((call) => ({
                toolCallId: call.id,
                result:
                  kind === "screenshot"
                    ? {
                        success: true,
                        addAsUserMessage: true,
                        data: { attachment: screenshot },
                      }
                    : { success: true, data: { code: "ORBIT-42" } },
              })),
            );
          }
          assert.equal(chat.status, "ready");
          assert.equal(chat.error, undefined);
          assert.equal(chat.messages.at(-1).content, "Checked: ORBIT-42");
          assert.equal(
            new Set(chat.messages.map((message) => message.id)).size,
            chat.messages.length,
          );
          assert.equal(requests.length, kind === "text" ? 1 : 2);
          if (kind === "screenshot") {
            const request = requests[1];
            const parts = (request.body.input ?? request.body.messages).flatMap(
              (message) =>
                Array.isArray(message.content) ? message.content : [],
            );
            const image = parts.find((part) =>
              ["input_image", "image_url"].includes(part.type),
            );
            assert.ok(
              image,
              "existing screenshot continuation must retain its image",
            );
            assert.equal(
              typeof image.image_url === "string"
                ? image.image_url
                : image.image_url.url,
              `data:image/png;base64,${screenshot.data}`,
            );
          }
          assert.equal(executed.length, serverTools.length);
          if (executed.length) assert.deepEqual(executed[0], { id: "check" });
          const expectedTools = kind === "text" ? 0 : kind === "mixed" ? 2 : 1;
          // Streaming server-only results live on tool cards; client/mixed turns
          // retain tool messages so the next request has complete call history.
          const historyTools =
            streaming && kind === "server" ? 0 : expectedTools;
          assert.equal(
            chat.messages.filter((message) => message.role === "tool").length,
            historyTools,
          );
          if (streaming && kind === "server")
            assert.ok(
              chat.messages.some(
                (message) => message.metadata?.toolExecutions?.length === 1,
              ),
            );
          assert.ok(finished.length > 0);
          assert.ok(finished.at(-1).usage.totalTokens > 0);
          if (model !== "gpt-6-luna")
            assert.ok(
              requests.every(
                (request) => request.endpoint === "/chat/completions",
              ),
            );
        } finally {
          chat.dispose();
        }
      });
    }
    test(`Copilot ${model} ${streaming ? "SSE" : "JSON"}: provider errors reach chat state`, async () => {
      scenario = "error";
      runtime = createRuntime({
        provider: createOpenAI({ apiKey: "test-only", onWarning() {} }),
        model,
      });
      const chat = new ReactChat({
        runtimeUrl: "https://copilot.test/api/chat",
        streaming,
      });
      try {
        await chat.sendMessage("test");
        assert.equal(chat.status, "error");
        assert.match(chat.error.message, /401/);
        assert.equal(requests.length, 1);
      } finally {
        chat.dispose();
      }
    });
  }

for (const streaming of [false, true])
  for (const kind of ["server", "client", "mixed"])
    test(`Responses replay ${streaming ? "SSE" : "JSON"}: ${kind} tools, persisted restore and next user turn`, async () => {
      const originalReply = providerReply;
      let executed = 0;
      const calls = (
        kind === "mixed" ? definitions : definitions.slice(0, 1)
      ).map((tool, i) => ({
        type: "function_call",
        id: `fc_${i}`,
        call_id: `call_${i}`,
        name: tool.name,
        arguments: '{"id":"check"}',
        status: "completed",
      }));
      const reasoning = {
        type: "reasoning",
        id: "rs_turn1",
        summary: [],
        encrypted_content: "complete-encrypted-state",
      };
      providerReply = (endpoint, { body }) => {
        assert.equal(endpoint, "/responses");
        assert.equal(body.store, false);
        if (requests.length > 1) {
          assert.deepEqual(
            body.input.find((item) => item.type === "reasoning"),
            reasoning,
          );
          const replayedCalls = body.input.filter(
            (item) => item.type === "function_call",
          );
          const replayedResults = body.input.filter(
            (item) => item.type === "function_call_output",
          );
          assert.equal(replayedCalls.length, calls.length);
          assert.equal(replayedResults.length, calls.length);
          assert.deepEqual(
            replayedResults.map((item) => item.call_id).sort(),
            calls.map((item) => item.call_id).sort(),
          );
          for (const result of replayedResults) {
            assert.ok(
              body.input.findIndex(
                (item) =>
                  item.type === "function_call" &&
                  item.call_id === result.call_id,
              ) < body.input.indexOf(result),
            );
          }
        }
        const output =
          requests.length === 1
            ? [reasoning, ...calls]
            : [
                {
                  type: "message",
                  id: `msg_${requests.length}`,
                  role: "assistant",
                  status: "completed",
                  content: [
                    { type: "output_text", text: "done", annotations: [] },
                  ],
                },
              ];
        const result = {
          id: `resp_${requests.length}`,
          status: "completed",
          output,
          usage: responseUsage,
          store: false,
        };
        if (!body.stream) return result;
        return chunks([
          ...output.flatMap((item, output_index) => [
            { type: "response.output_item.added", output_index, item },
            ...(item.type === "message"
              ? [{ type: "response.output_text.delta", delta: "done" }]
              : []),
            { type: "response.output_item.done", output_index, item },
          ]),
          { type: "response.completed", response: result },
        ]);
      };
      runtime = createRuntime({
        provider: createOpenAI({
          apiKey: "test-only",
          api: "responses",
          responses: { store: false },
        }),
        model: "gpt-4o",
        maxIterations: 3,
        tools:
          kind === "client"
            ? []
            : [
                {
                  ...definitions[0],
                  location: "server",
                  handler: async () => {
                    executed++;
                    return { success: true, data: { code: "ORBIT-42" } };
                  },
                },
              ],
      });
      const init = {
        runtimeUrl: "https://copilot.test/api/chat",
        streaming,
        threadId: "existing-thread",
      };
      const chat = new ReactChat(init);
      let restored;
      const pending = [];
      chat.onToolCalls((event) => pending.push(event));
      if (kind !== "server")
        chat.setTools([
          { ...definitions[kind === "mixed" ? 1 : 0], location: "client" },
        ]);
      try {
        assert.equal(await chat.sendMessage("Inspect"), true);
        if (kind !== "server") {
          assert.equal(pending.length, 1);
          await chat.continueWithToolResults(
            pending[0].toolCalls.map((call) => ({
              toolCallId: call.id,
              result: { success: true, data: { code: "ORBIT-42" } },
            })),
          );
        }
        assert.equal(chat.error, undefined);
        assert.equal(chat.status, "ready");
        assert.equal(requests.length, 2);
        assert.ok(
          chat.messages.some((message) =>
            message.providerMetadata?.openai?.response?.output?.some(
              (item) => item.id === "rs_turn1",
            ),
          ),
        );
        restored = new ReactChat({
          ...init,
          initialMessages: JSON.parse(JSON.stringify(chat.messages)),
        });
        assert.equal(await restored.sendMessage("What was done?"), true);
        assert.equal(restored.error, undefined);
        assert.equal(restored.status, "ready");
        assert.equal(requests.length, 3);
        assert.equal(executed, kind === "client" ? 0 : 1);
      } finally {
        providerReply = originalReply;
        chat.dispose();
        restored?.dispose();
      }
    });

for (const streaming of [false, true])
  for (const kind of ["server", "client", "mixed"])
    test(`Image tool results ${streaming ? "SSE" : "JSON"}: ${kind} tools, persisted restore and next user turn`, async () => {
      const originalReply = providerReply;
      let executed = 0;
      const calls = (
        kind === "mixed" ? definitions : definitions.slice(0, 1)
      ).map((tool, i) => ({
        type: "function_call",
        id: `fc_${i}`,
        call_id: `call_${i}`,
        name: tool.name,
        arguments: '{"id":"check"}',
        status: "completed",
      }));
      const reasoning = {
        type: "reasoning",
        id: "rs_turn1",
        summary: [],
        encrypted_content: "complete-encrypted-state",
      };
      providerReply = (endpoint, { body }) => {
        assert.equal(endpoint, "/responses");
        assert.equal(body.store, false);
        if (requests.length > 1) {
          assert.deepEqual(
            body.input.find((item) => item.type === "reasoning"),
            reasoning,
          );
          const replayedCalls = body.input.filter(
            (item) => item.type === "function_call",
          );
          const replayedResults = body.input.filter(
            (item) => item.type === "function_call_output",
          );
          assert.equal(replayedCalls.length, calls.length);
          assert.equal(replayedResults.length, calls.length);
          assert.deepEqual(
            replayedResults.map((item) => item.call_id).sort(),
            calls.map((item) => item.call_id).sort(),
          );
          for (const result of replayedResults) {
            assert.deepEqual(result.output, [
              { type: "input_text", text: "read image" },
              {
                type: "input_image",
                image_url: `data:image/png;base64,${screenshot.data}`,
                detail: "auto",
              },
            ]);
            assert.ok(
              body.input.findIndex(
                (item) =>
                  item.type === "function_call" &&
                  item.call_id === result.call_id,
              ) < body.input.indexOf(result),
            );
          }
        }
        const output =
          requests.length === 1
            ? [reasoning, ...calls]
            : [
                {
                  type: "message",
                  id: `msg_${requests.length}`,
                  role: "assistant",
                  status: "completed",
                  content: [
                    { type: "output_text", text: "done", annotations: [] },
                  ],
                },
              ];
        const result = {
          id: `resp_${requests.length}`,
          status: "completed",
          output,
          usage: responseUsage,
          store: false,
        };
        if (!body.stream) return result;
        return chunks([
          ...output.flatMap((item, output_index) => [
            { type: "response.output_item.added", output_index, item },
            ...(item.type === "message"
              ? [{ type: "response.output_text.delta", delta: "done" }]
              : []),
            { type: "response.output_item.done", output_index, item },
          ]),
          { type: "response.completed", response: result },
        ]);
      };
      runtime = createRuntime({
        provider: createOpenAI({
          apiKey: "test-only",
          api: "responses",
          responses: { store: false },
        }),
        model: "gpt-4o",
        maxIterations: 3,
        tools:
          kind === "client"
            ? []
            : [
                {
                  ...definitions[0],
                  location: "server",
                  handler: async () => {
                    executed++;
                    return {
                      success: true,
                      _aiContent: [
                        { type: "text", text: "read image" },
                        {
                          type: "image",
                          data: screenshot.data,
                          mediaType: screenshot.mimeType,
                        },
                      ],
                    };
                  },
                },
              ],
      });
      const init = {
        runtimeUrl: "https://copilot.test/api/chat",
        streaming,
        threadId: "existing-thread",
      };
      const chat = new ReactChat(init);
      let restored;
      const pending = [];
      chat.onToolCalls((event) => pending.push(event));
      if (kind !== "server")
        chat.setTools([
          { ...definitions[kind === "mixed" ? 1 : 0], location: "client" },
        ]);
      try {
        assert.equal(await chat.sendMessage("Inspect"), true);
        if (kind !== "server") {
          assert.equal(pending.length, 1);
          await chat.continueWithToolResults(
            pending[0].toolCalls.map((call) => ({
              toolCallId: call.id,
              result: {
                success: true,
                _aiContent: [
                  { type: "text", text: "read image" },
                  {
                    type: "image",
                    data: screenshot.data,
                    mediaType: screenshot.mimeType,
                  },
                ],
              },
            })),
          );
        }
        assert.equal(chat.error, undefined);
        assert.equal(chat.status, "ready");
        assert.equal(requests.length, 2);
        assert.equal(chat.messages.filter((m) => m.role === "user").length, 1);
        assert.ok(
          chat.messages.some((message) =>
            message.providerMetadata?.openai?.response?.output?.some(
              (item) => item.id === "rs_turn1",
            ),
          ),
        );
        restored = new ReactChat({
          ...init,
          initialMessages: JSON.parse(JSON.stringify(chat.messages)),
        });
        assert.equal(await restored.sendMessage("What was done?"), true);
        assert.equal(restored.error, undefined);
        assert.equal(restored.status, "ready");
        assert.equal(requests.length, 3);
        assert.equal(executed, kind === "client" ? 0 : 1);
      } finally {
        providerReply = originalReply;
        chat.dispose();
        restored?.dispose();
      }
    });

for (const streaming of [false, true])
  for (const kind of ["server", "client", "mixed"])
    test(`Anthropic image ${streaming ? "SSE" : "JSON"} ${kind}: continued and restored history`, async () => {
      const originalReply = providerReply;
      let executed = 0;
      const selected = kind === "mixed" ? definitions : definitions.slice(0, 1);
      const imageResult = {
        success: true,
        _aiContent: [
          { type: "text", text: "read image" },
          {
            type: "image",
            data: screenshot.data,
            mediaType: screenshot.mimeType,
          },
        ],
      };
      providerReply = (endpoint, { body }) => {
        assert.equal(endpoint, "/v1/messages");
        if (requests.length > 1) {
          const results = body.messages
            .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
            .filter((x) => x.type === "tool_result");
          assert.equal(results.length, selected.length);
          for (const result of results)
            assert.deepEqual(result.content, [
              { type: "text", text: "read image" },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: screenshot.data,
                },
              },
            ]);
        }
        const content =
          requests.length === 1
            ? selected.map((d, i) => ({
                type: "tool_use",
                id: "ant-call-" + i,
                name: d.name,
                input: { id: "check" },
              }))
            : [{ type: "text", text: "done" }];
        if (!body.stream)
          return {
            content,
            stop_reason: requests.length === 1 ? "tool_use" : "end_turn",
            usage: { input_tokens: 10, output_tokens: 5 },
          };
        return chunks([
          {
            type: "message_start",
            message: {
              id: "ant-message",
              type: "message",
              role: "assistant",
              model: "claude-sonnet-4-5",
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 10, output_tokens: 0 },
            },
          },
          ...content.flatMap((part, index) => [
            {
              type: "content_block_start",
              index,
              content_block: {
                ...part,
                ...(part.type === "tool_use" ? { input: {} } : { text: "" }),
              },
            },
            {
              type: "content_block_delta",
              index,
              delta:
                part.type === "tool_use"
                  ? {
                      type: "input_json_delta",
                      partial_json: JSON.stringify(part.input),
                    }
                  : { type: "text_delta", text: part.text },
            },
            { type: "content_block_stop", index },
          ]),
          {
            type: "message_delta",
            delta: {
              stop_reason: requests.length === 1 ? "tool_use" : "end_turn",
            },
            usage: { output_tokens: 5 },
          },
          { type: "message_stop" },
        ]);
      };
      const { createAnthropic } = llmRequire(
        "./dist/providers/anthropic/index.js",
      );
      runtime = createRuntime({
        provider: createAnthropic({ apiKey: "fixture" }),
        model: "claude-sonnet-4-5",
        maxIterations: 3,
        tools:
          kind === "client"
            ? []
            : [
                {
                  ...definitions[0],
                  location: "server",
                  handler: async () => {
                    executed++;
                    return imageResult;
                  },
                },
              ],
      });
      const init = {
        runtimeUrl: "https://copilot.test/api/chat",
        streaming,
        threadId: "existing-thread",
      };
      const chat = new ReactChat(init);
      let restored;
      const pending = [];
      chat.onToolCalls((e) => pending.push(e));
      if (kind !== "server")
        chat.setTools([
          { ...definitions[kind === "mixed" ? 1 : 0], location: "client" },
        ]);
      try {
        assert.equal(await chat.sendMessage("inspect"), true);
        if (kind !== "server") {
          assert.equal(pending.length, 1);
          await chat.continueWithToolResults(
            pending[0].toolCalls.map((call) => ({
              toolCallId: call.id,
              result: imageResult,
            })),
          );
        }
        assert.equal(chat.error, undefined);
        assert.equal(requests.length, 2);
        restored = new ReactChat({
          ...init,
          initialMessages: JSON.parse(JSON.stringify(chat.messages)),
        });
        assert.equal(
          await restored.sendMessage("what was in the image?"),
          true,
        );
        assert.equal(restored.error, undefined);
        assert.equal(requests.length, 3);
        assert.equal(executed, kind === "client" ? 0 : 1);
      } finally {
        providerReply = originalReply;
        chat.dispose();
        restored?.dispose();
      }
    });

test("MCP image output keeps accompanying text in order", () => {
  const {
    MCPToolAdapter,
  } = require("../packages/copilot-sdk/dist/mcp/index.cjs");
  const result = new MCPToolAdapter("fixture").convertResult({
    content: [
      { type: "text", text: "before" },
      { type: "image", data: screenshot.data, mimeType: "image/png" },
      { type: "text", text: "after" },
    ],
  });
  assert.deepEqual(result._aiContent, [
    { type: "text", text: "before" },
    { type: "image", data: screenshot.data, mediaType: "image/png" },
    { type: "text", text: "after" },
  ]);
  assert.equal(result.message, "before\nafter");
});
