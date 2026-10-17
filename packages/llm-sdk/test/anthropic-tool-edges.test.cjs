const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { z } = require("zod");
const { generateText, streamText, createRuntime } = require("../dist/index.js");
const {
  anthropic,
  createAnthropic,
} = require("../dist/providers/anthropic/index.js");
let server, baseURL;
before(async () => {
  server = http.createServer(async (req, res) => {
    let input = "";
    for await (const chunk of req) input += chunk;
    const body = JSON.parse(input),
      scenario = req.url.split("/")[1];
    const args = scenario === "array" ? [] : {};
    const content = [{ type: "tool_use", id: "a", name: "first", input: args }];
    if (scenario === "duplicate") content.push({ ...content[0] });
    const stop_reason = scenario === "truncated" ? "max_tokens" : "tool_use";
    const message = {
      id: "msg_fixture",
      type: "message",
      role: "assistant",
      model: body.model,
      content,
      stop_reason,
      usage: { input_tokens: 5, output_tokens: 3 },
    };
    if (!body.stream) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(message));
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    const send = (event) =>
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    send({
      type: "message_start",
      message: { ...message, content: [], stop_reason: null },
    });
    content.forEach((block, index) => {
      send({
        type: "content_block_start",
        index,
        content_block: { ...block, input: {} },
      });
      send({
        type: "content_block_delta",
        index,
        delta: {
          type: "input_json_delta",
          partial_json: JSON.stringify(block.input),
        },
      });
      send({ type: "content_block_stop", index });
    });
    if (scenario !== "eof") {
      send({
        type: "message_delta",
        delta: { stop_reason },
        usage: { output_tokens: 3 },
      });
      send({ type: "message_stop" });
    }
    res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseURL = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));
for (const surface of ["modern", "runtime"])
  for (const streaming of [false, true])
    for (const scenario of [
      "array",
      "duplicate",
      "truncated",
      ...(streaming ? ["eof"] : []),
    ])
      test(`${surface}/${streaming}: Claude ${scenario} calls never reach a tool handler`, async () => {
        let executed = 0,
          error;
        const execute = async () => {
          executed++;
          return "OK";
        };
        try {
          if (surface === "modern") {
            const result = await (streaming ? streamText : generateText)({
              model: anthropic("claude-haiku-5-5", {
                apiKey: "fixture",
                baseURL: `${baseURL}/${scenario}`,
              }),
              prompt: "test",
              tools: {
                first: { description: "first", parameters: z.any(), execute },
              },
            });
            await result.text;
          } else {
            const runtime = createRuntime({
              provider: createAnthropic({
                apiKey: "fixture",
                baseUrl: `${baseURL}/${scenario}`,
              }),
              model: "claude-haiku-5-5",
              maxIterations: 1,
              tools: [
                {
                  name: "first",
                  location: "server",
                  description: "first",
                  inputSchema: { type: "object" },
                  handler: execute,
                },
              ],
            });
            error = (
              await runtime.chat({
                messages: [{ role: "user", content: "test" }],
                streaming,
              })
            ).error;
          }
        } catch (e) {
          error = e;
        }
        assert.equal(executed, 0);
        assert.ok(error, "incomplete or invalid tool output must be reported");
      });
