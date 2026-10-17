const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const root = process.env.PR_SOURCE_ROOT || path.resolve(__dirname, "..");
const esbuild = require(
  require.resolve("esbuild", {
    paths: [
      fs.realpathSync(
        path.join(__dirname, "../packages/llm-sdk/node_modules/tsup"),
      ),
    ],
  }),
);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-pr-tests-"));
const outfile = path.join(dir, "chat.cjs");
esbuild.buildSync({
  stdin: {
    contents: `export { ChatWithTools } from './packages/copilot-sdk/src/chat/ChatWithTools';
    export { AbstractChat } from './packages/copilot-sdk/src/chat/classes/AbstractChat';`,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile,
  logLevel: "silent",
});
const { ChatWithTools, AbstractChat } = require(outfile);
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
const toolCall = {
  id: "call-1",
  type: "function",
  function: { name: "lookup", arguments: "{}" },
};
function transport() {
  const calls = [];
  return {
    calls,
    abort() {},
    send: async (request) => {
      calls.push(request);
      return new Response(
        JSON.stringify({
          message: { role: "assistant", content: "done" },
          content: "done",
        }),
        {
          headers: { "content-type": "application/json" },
        },
      );
    },
    parseResponse: async (response) => response.json(),
  };
}
test("stop during tool-result render yield does not send another request", async () => {
  const network = transport();
  const chat = new AbstractChat({
    runtimeUrl: "https://fixture.invalid",
    transport: network,
    initialMessages: [
      { id: "a", role: "assistant", content: "", toolCalls: [toolCall] },
    ],
  });
  const promise = chat.continueWithToolResults([
    { toolCallId: "call-1", result: { nested: [1, { ok: true }] } },
  ]);
  chat.stop();
  await promise;
  assert.equal(network.calls.length, 0);
  assert.equal(chat.status, "ready");
  const result = chat.messages.find((m) => m.role === "tool");
  assert.deepEqual(JSON.parse(result.content), { nested: [1, { ok: true }] });
  chat.dispose();
});
test("stop while a client tool is resolving keeps its result without restarting", async () => {
  const network = transport();
  let resolveTool, started;
  const began = new Promise((resolve) => {
    started = resolve;
  });
  const chat = new ChatWithTools({
    runtimeUrl: "https://fixture.invalid",
    transport: network,
    initialMessages: [
      { id: "a", role: "assistant", content: "", toolCalls: [toolCall] },
    ],
    tools: [
      {
        name: "lookup",
        description: "lookup",
        inputSchema: { type: "object", properties: {} },
        location: "client",
        handler: () => {
          started();
          return new Promise((resolve) => {
            resolveTool = resolve;
          });
        },
      },
    ],
  });
  // The real internal event enters the same coordinator used by streamed client calls.
  chat.chat.emit("toolCalls", { toolCalls: [toolCall] });
  await began;
  chat.stop();
  resolveTool({ success: true, data: { code: "ORBIT-42" } });
  await tick();
  assert.equal(network.calls.length, 0);
  assert.equal(chat.isLoading, false);
  assert.ok(
    chat.messages.some((m) => m.role === "tool" && m.toolCallId === "call-1"),
  );
  chat.dispose();
});
test("late cancelled tool cannot restart or overwrite a newer user turn", async () => {
  let resolveTool, started;
  const began = new Promise((resolve) => {
    started = resolve;
  });
  const calls = [];
  const chat = new ChatWithTools({
    runtimeUrl: "https://fixture.invalid",
    transport: {
      abort() {},
      isStreaming: () => false,
      async send(request) {
        calls.push(request);
        return { messages: [{ role: "assistant", content: "New answer" }] };
      },
    },
    initialMessages: [
      { id: "a", role: "assistant", content: "", toolCalls: [toolCall] },
    ],
    tools: [
      {
        name: "lookup",
        description: "lookup",
        inputSchema: { type: "object", properties: {} },
        location: "client",
        toModelOutput(result) {
          if (!result.data) throw new Error("mapper requires successful data");
        },
        handler: () => {
          started();
          return new Promise((resolve) => {
            resolveTool = resolve;
          });
        },
      },
    ],
  });
  chat.chat.emit("toolCalls", { toolCalls: [toolCall] });
  await began;
  chat.stop();
  assert.ok(chat.messages.some((m) => m.role === "tool"));
  await chat.sendMessage("New turn");
  resolveTool({ success: true, data: "late old result" });
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(chat.messages.at(-1).content, "New answer");
  assert.ok(!JSON.stringify(chat.messages).includes("late old result"));
  chat.dispose();
});
for (const streamMode of [undefined, "single-turn"]) {
  for (const hidden of [false, true]) {
    test(`server tool replay retains call-before-result ordering (${streamMode ?? "default"}, hidden=${hidden})`, async () => {
      const originalResult = {
        success: true,
        data: { nested: [1, { marker: "ORBIT-42" }] },
      };
      const doneMessages = [
        { role: "assistant", content: "Checking.", tool_calls: [toolCall] },
        {
          role: "tool",
          tool_call_id: "call-1",
          content: JSON.stringify(originalResult),
        },
        { role: "assistant", content: "Done." },
      ];
      const chat = new AbstractChat({
        runtimeUrl: "https://fixture.invalid",
        streamMode,
        transport: {
          isStreaming: () => true,
          abort() {},
          async *send() {
            yield { type: "message:start", id: "server-a" };
            yield { type: "message:delta", content: "Checking." };
            yield {
              type: "action:start",
              id: "call-1",
              name: "lookup",
              hidden,
            };
            yield {
              type: "action:args",
              id: "call-1",
              name: "lookup",
              args: "{}",
            };
            yield {
              type: "action:end",
              id: "call-1",
              name: "lookup",
              result: originalResult,
            };
            yield { type: "message:end" };
            yield { type: "message:start", id: "server-b" };
            yield { type: "message:delta", content: "Done." };
            yield { type: "message:end" };
            yield { type: "done", messages: doneMessages };
          },
        },
      });
      try {
        await chat.sendMessage("Look it up");
        assert.equal(chat.error, undefined);
        if (hidden)
          assert.ok(
            chat.messages.some(
              (message) =>
                message.metadata?.toolCallsHidden?.["call-1"] === true,
            ),
          );
        const seen = new Set();
        let results = 0;
        for (const message of chat.buildRequest().messages) {
          for (const call of message.tool_calls ?? []) seen.add(call.id);
          if (message.role === "tool") {
            assert.ok(
              seen.has(message.tool_call_id),
              "tool result must follow its assistant call",
            );
            assert.deepEqual(JSON.parse(message.content), originalResult);
            results++;
          }
        }
        // Server executions may be serialized as an assistant summary instead of role:tool.
        // Both representations must retain the result and never emit an orphan tool message.
        assert.ok(results <= 1);
        assert.match(JSON.stringify(chat.buildRequest().messages), /ORBIT-42/);
        assert.equal(
          chat.messages
            .filter((m) => m.role === "assistant")
            .map((m) => m.content)
            .join(""),
          "Checking.Done.",
        );
      } finally {
        chat.dispose();
      }
    });
  }
}
