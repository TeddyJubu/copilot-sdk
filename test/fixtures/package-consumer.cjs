const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
(async () => {
  let entrypoints = 0;
  const versions = [];
  for (const name of ["@yourgpt/llm-sdk", "@yourgpt/copilot-sdk"]) {
    const manifest = JSON.parse(
      fs.readFileSync(path.join("node_modules", name, "package.json"), "utf8"),
    );
    versions.push(`${name}@${manifest.version}`);
    for (const subpath of Object.keys(manifest.exports)) {
      if (subpath.endsWith(".css")) continue;
      const specifier = subpath === "." ? name : name + subpath.slice(1);
      console.log(`Checking ${specifier}`);
      const cjs = require(specifier);
      const esm = await import(specifier);
      assert.ok(Object.keys(cjs).length, specifier);
      assert.ok(Object.keys(esm).length, specifier);
      entrypoints++;
    }
  }
  const {
    generateText,
    streamText,
    createRuntime,
    experimental_decide,
  } = require("@yourgpt/llm-sdk");
  const { z } = require("zod");
  assert.equal(typeof createRuntime, "function");
  assert.equal(typeof experimental_decide, "function");
  for (const generate of [generateText, streamText]) {
    let requests = 0,
      executions = 0;
    const model = {
      provider: "release-fixture",
      modelId: "release-fixture",
      capabilities: {},
      async doGenerate(params) {
        requests++;
        if (requests === 1) {
          const schema = params.tools[0].function.parameters;
          assert.deepEqual(
            schema.properties.id.anyOf.map((s) => s.type),
            ["string", "null"],
          );
          assert.deepEqual(schema.required, ["id"]);
          return {
            text: "",
            toolCalls: [{ id: "tool-1", name: "lookup", args: { id: null } }],
            finishReason: "tool-calls",
            usage: { promptTokens: 2, completionTokens: 2, totalTokens: 4 },
          };
        }
        const result = params.messages.find((m) => m.role === "tool");
        assert.deepEqual(JSON.parse(result.content), {
          marker: "release-ok",
          nested: { count: 0 },
        });
        return {
          text: "release-ok",
          toolCalls: [],
          finishReason: "stop",
          usage: { promptTokens: 2, completionTokens: 2, totalTokens: 4 },
        };
      },
      async *doStream(params) {
        const r = await this.doGenerate(params);
        if (r.text) yield { type: "text-delta", text: r.text };
        for (const toolCall of r.toolCalls)
          yield { type: "tool-call", toolCall };
        yield { type: "finish", finishReason: r.finishReason, usage: r.usage };
      },
    };
    const result = await generate({
      model,
      prompt: "fixture",
      maxSteps: 2,
      tools: {
        lookup: {
          description: "lookup",
          parameters: z.object({ id: z.string().nullable() }),
          execute: async ({ id }) => {
            assert.equal(id, null);
            executions++;
            return { marker: "release-ok", nested: { count: 0 } };
          },
        },
      },
    });
    assert.equal(await result.text, "release-ok");
    assert.equal((await result.usage).totalTokens, 8);
    assert.equal(executions, 1);
    assert.equal(requests, 2);
  }
  console.log(
    JSON.stringify({
      versions,
      react: require("react").version,
      entrypoints,
      moduleFormats: ["CommonJS", "ESM"],
      generationModes: ["complete", "stream"],
      toolResultAndNullableSchema: "passed",
    }),
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
