const { test } = require("node:test");
const assert = require("node:assert/strict");
const { generateText, streamText } = require("../dist/index.js");
const { z } = require("zod");

for (const mode of ["generateText", "streamText"]) {
  for (const abortAt of [
    "before-model",
    "after-model",
    "first-tool",
    "tool-error",
  ]) {
    test(`${mode}: cancellation at ${abortAt} prevents later tool execution`, async () => {
      const controller = new AbortController();
      let modelCalls = 0;
      const executed = [];
      const toolCalls = [
        { id: "a", name: "first", args: {} },
        { id: "b", name: "second", args: {} },
      ];
      const model = {
        provider: "test",
        modelId: "abort-fixture",
        capabilities: {},
        async doGenerate() {
          modelCalls++;
          if (abortAt === "after-model") controller.abort();
          return {
            text: "",
            toolCalls,
            finishReason: "tool-calls",
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          };
        },
        async *doStream() {
          modelCalls++;
          for (const toolCall of toolCalls)
            yield { type: "tool-call", toolCall };
          if (abortAt === "after-model") controller.abort();
          yield { type: "finish", finishReason: "tool-calls" };
        },
      };
      const tools = Object.fromEntries(
        ["first", "second"].map((name) => [
          name,
          {
            description: name,
            parameters: z.object({}),
            execute: async () => {
              executed.push(name);
              if (name === "first") {
                controller.abort();
                if (abortAt === "tool-error") throw new Error("tool stopped");
              }
              return "ok";
            },
          },
        ]),
      );
      if (abortAt === "before-model") controller.abort();
      const params = {
        model,
        tools,
        prompt: "test",
        signal: controller.signal,
      };
      if (mode === "generateText") {
        await assert.rejects(generateText(params), /aborted/i);
      } else {
        const result = await streamText(params);
        const readers = await Promise.allSettled([result.text, result.usage]);
        assert.ok(
          readers.every(
            (r) => r.status === "rejected" && /aborted/i.test(r.reason.message),
          ),
        );
      }
      assert.equal(modelCalls, abortAt === "before-model" ? 0 : 1);
      assert.deepEqual(
        executed,
        ["first-tool", "tool-error"].includes(abortAt) ? ["first"] : [],
      );
    });
  }
}
