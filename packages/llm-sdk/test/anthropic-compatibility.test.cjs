const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { z } = require("zod");
const { generateText, streamText, createRuntime } = require("../dist/index.js");
const {
  anthropic,
  createAnthropic,
} = require("../dist/providers/anthropic/index.js");
let server, baseURL, requests, cached, requestHeaders;
const thought = {
  type: "thinking",
  thinking: "A brief summary",
  signature: "opaque-test-signature",
};
before(async () => {
  server = http.createServer(async (req, res) => {
    let input = "";
    for await (const part of req) input += part;
    const body = JSON.parse(input);
    requests.push(body);
    requestHeaders.push(req.headers);
    const hasResult = body.messages.some(
      (m) =>
        Array.isArray(m.content) &&
        m.content.some((b) => b.type === "tool_result"),
    );
    const content = [
      thought,
      body.tools?.length && !hasResult
        ? {
            type: "tool_use",
            id: "call_fixture",
            name: "lookup",
            input: { id: "sample" },
          }
        : { type: "text", text: "OK" },
    ];
    const message = {
      id: "msg_fixture",
      type: "message",
      role: "assistant",
      model: body.model,
      content,
      stop_reason: content[1].type === "tool_use" ? "tool_use" : "end_turn",
      stop_sequence: null,
      usage: {
        input_tokens: 12,
        output_tokens: 8,
        ...(cached
          ? { cache_read_input_tokens: 5, cache_creation_input_tokens: 3 }
          : {}),
      },
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
    for (const [index, block] of content.entries()) {
      send({
        type: "content_block_start",
        index,
        content_block:
          block.type === "tool_use"
            ? { ...block, input: {} }
            : block.type === "thinking"
              ? { ...block, thinking: "", signature: "" }
              : { ...block, text: "" },
      });
      if (block.type === "thinking") {
        send({
          type: "content_block_delta",
          index,
          delta: { type: "thinking_delta", thinking: block.thinking },
        });
        send({
          type: "content_block_delta",
          index,
          delta: { type: "signature_delta", signature: block.signature },
        });
      } else
        send({
          type: "content_block_delta",
          index,
          delta:
            block.type === "tool_use"
              ? {
                  type: "input_json_delta",
                  partial_json: JSON.stringify(block.input),
                }
              : { type: "text_delta", text: block.text },
        });
      send({ type: "content_block_stop", index });
    }
    send({
      type: "message_delta",
      delta: { stop_reason: message.stop_reason },
      usage: { output_tokens: 8 },
    });
    send({ type: "message_stop" });
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseURL = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));
beforeEach(() => {
  requests = [];
  requestHeaders = [];
  cached = false;
});
for (const surface of ["modern", "runtime"])
  for (const streaming of [false, true]) {
    async function run(modelId, options = {}, extra = {}) {
      if (surface === "runtime") {
        const runtime = createRuntime({
          provider: createAnthropic({
            apiKey: "fixture",
            baseUrl: baseURL,
            ...options,
          }),
          model: modelId,
        });
        return runtime.chat({
          messages: [{ role: "user", content: "hello" }],
          config: { temperature: 0, ...extra },
          streaming,
        });
      }
      const params = {
        model: anthropic(modelId, { apiKey: "fixture", baseURL, ...options }),
        prompt: "hello",
        temperature: 0,
        ...extra,
      };
      const result = await (streaming
        ? streamText(params)
        : generateText(params));
      await result.text;
      return result;
    }
    for (const modelId of [
      "claude-haiku-5-5",
      "claude-sonnet-5-5",
      "claude-opus-5-5",
      "claude-opus-4-7",
      "claude-haiku-4-5-20251001",
    ]) {
      test(`${surface}/${streaming}: sampling parameters for ${modelId}`, async () => {
        await run(modelId);
        assert.equal(requests.length, 1, "custom endpoint must be honored");
        assert.equal(
          requests[0].temperature,
          modelId.includes("4-5") ? 0 : undefined,
        );
      });
    }
    test(`${surface}/${streaming}: schema-less JSON instruction reaches Claude`, async () => {
      await run(
        "claude-haiku-5-5",
        {},
        { responseFormat: { type: "json_object" } },
      );
      assert.match(requests[0].system, /single JSON object/);
    });
    test(`${surface}/${streaming}: cache reads and writes count toward total input usage`, async () => {
      cached = true;
      const result = await run("claude-haiku-5-5");
      assert.deepEqual(
        await result.usage,
        surface === "modern"
          ? { promptTokens: 20, completionTokens: 8, totalTokens: 28 }
          : { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
      );
    });
    test(`${surface}/${streaming}: automatic caching is explicitly enabled`, async () => {
      await run("claude-haiku-5-5", { cacheControl: true });
      assert.deepEqual(requests[0].cache_control, { type: "ephemeral" });
      await run("claude-haiku-5-5", { cacheControl: false });
      assert.equal(requests[1].cache_control, undefined);
    });
    if (surface === "runtime")
      test(`runtime/${streaming}: factory headers reach the configured endpoint`, async () => {
        await run("claude-haiku-5-5", {
          headers: { "x-compatibility-probe": "fixture" },
        });
        assert.equal(requestHeaders[0]["x-compatibility-probe"], "fixture");
      });
    test(`${surface}/${streaming}: schema property names and enum values are not keywords`, async () => {
      const schema = {
        type: "object",
        properties: {
          minimum: { type: "number", minimum: 1 },
          oneOf: { type: "string" },
          nested: {
            type: "object",
            properties: { pattern: { type: "string" } },
            required: ["pattern"],
          },
        },
        required: ["minimum", "oneOf", "nested"],
      };
      await run(
        "claude-haiku-5-5",
        {},
        {
          responseFormat: {
            type: "json_schema",
            json_schema: { name: "reserved", schema },
          },
        },
      );
      const sent = requests[0].output_config.format.schema;
      assert.deepEqual(Object.keys(sent.properties), [
        "minimum",
        "oneOf",
        "nested",
      ]);
      assert.equal(sent.properties.minimum.type, "number");
      assert.equal(sent.properties.minimum.minimum, undefined);
      assert.equal(sent.properties.nested.properties.pattern.type, "string");
      assert.equal(
        schema.properties.minimum.minimum,
        1,
        "caller schema must remain unchanged",
      );
    });
    test(`${surface}/${streaming}: adaptive thinking keeps schema and effort`, async () => {
      await run(
        "claude-sonnet-5-5",
        { thinking: { type: "enabled", budgetTokens: 1024 }, effort: "low" },
        {
          responseFormat: {
            type: "json_schema",
            json_schema: {
              name: "answer",
              schema: {
                type: "object",
                properties: { answer: { type: "string" } },
                required: ["answer"],
              },
            },
          },
        },
      );
      assert.deepEqual(requests[0].thinking, { type: "adaptive" });
      assert.equal(requests[0].output_config.effort, "low");
      assert.equal(
        requests[0].output_config.format.schema.properties.answer.type,
        "string",
      );
    });
    test(`${surface}/${streaming}: legacy manual thinking has a valid default token limit`, async () => {
      await run("claude-haiku-4-5-20251001", {
        thinking: { type: "enabled", budgetTokens: 10000 },
      });
      assert.equal(requests[0].thinking.budget_tokens, 10000);
      assert.ok(requests[0].max_tokens > 10000);
      await run(
        "claude-haiku-4-5-20251001",
        { thinking: { type: "enabled", budgetTokens: 1024 } },
        { maxTokens: 1600 },
      );
      assert.equal(
        requests[1].max_tokens,
        1600,
        "explicit caller token limit is preserved",
      );
    });
    test(`${surface}/${streaming}: signed thinking survives tool continuation without usage metadata`, async () => {
      let executions = 0;
      const execute = async () => {
        executions++;
        return { value: "OK" };
      };
      let result;
      if (surface === "modern") {
        const params = {
          model: anthropic("claude-sonnet-5-5", {
            apiKey: "fixture",
            baseURL,
            thinking: { type: "adaptive" },
          }),
          prompt: "lookup",
          maxSteps: 3,
          tools: {
            lookup: {
              description: "lookup",
              parameters: z.object({ id: z.string() }),
              execute,
            },
          },
        };
        result = await (streaming ? streamText(params) : generateText(params));
      } else {
        const runtime = createRuntime({
          provider: createAnthropic({
            apiKey: "fixture",
            baseUrl: baseURL,
            thinking: { type: "adaptive" },
          }),
          model: "claude-sonnet-5-5",
          tools: [
            {
              name: "lookup",
              description: "lookup",
              location: "server",
              inputSchema: {
                type: "object",
                properties: { id: { type: "string" } },
              },
              handler: execute,
            },
          ],
        });
        result = await runtime.chat({
          messages: [{ role: "user", content: "lookup" }],
          streaming,
        });
      }
      assert.equal(await result.text, "OK");
      assert.equal(executions, 1);
      assert.equal(requests.length, 2);
      const assistant = requests[1].messages.find(
        (m) => m.role === "assistant",
      );
      assert.deepEqual(assistant.content[0], thought);
      assert.equal(assistant.content[1].type, "tool_use");
      assert.ok(!JSON.stringify(assistant).includes("input_tokens"));
      assert.deepEqual(
        await result.usage,
        surface === "modern"
          ? { promptTokens: 24, completionTokens: 16, totalTokens: 40 }
          : { prompt_tokens: 24, completion_tokens: 16, total_tokens: 40 },
      );
    });
  }
