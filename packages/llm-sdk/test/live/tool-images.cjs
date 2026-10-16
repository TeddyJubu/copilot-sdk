// Opt-in provider test: synthetic image, no user data. Never prints credentials.
const assert = require("node:assert/strict");
const fs = require("node:fs");
fs.mkdirSync("/tmp/copilot-sdk-audit", { recursive: true });
const { z } = require("zod");
const {
  generateText,
  streamText,
  tool,
  createRuntime,
} = require("../../dist/index.js");
const provider = process.env.IMAGE_TEST_PROVIDER;
if (
  process.env.RUN_IMAGES_LIVE !== "1" ||
  !["openai", "anthropic"].includes(provider)
)
  throw new Error("Explicit live provider opt-in required");
const key =
  process.env[provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"];
if (!key) throw new Error("Provider key is missing");
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAb0lEQVR4nO3PAQkAAAyEwO9feoshgnABdNvJ8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ2oPcf88OIhvJ6vAAAAAElFTkSuQmCC";
const providerModule = require(`../../dist/providers/${provider}/index.js`);
const modelId = provider === "openai" ? "gpt-5.2" : "claude-sonnet-4-5";
const options = {
  apiKey: key,
  ...(provider === "openai"
    ? { api: "responses", responses: { store: false }, reasoningEffort: "low" }
    : {}),
};
const model = providerModule[provider](modelId, options);
const output = {
  type: "content",
  content: [
    {
      type: "text",
      text: "The authorized image follows. Identify its dominant color.",
    },
    { type: "image", data: png, mediaType: "image/png" },
  ],
};
const prompt =
  'Call inspect_image once with imageId="sample" to obtain the image. Then answer only its dominant color in one English word. The color is not known until you inspect the returned image.';
const checks = [];
async function check(name, fn) {
  if (
    process.env.IMAGE_LIVE_FILTER &&
    !name.includes(process.env.IMAGE_LIVE_FILTER)
  )
    return;
  try {
    await fn();
    checks.push({ name, passed: true });
    console.log("PASS " + name);
  } catch (e) {
    checks.push({
      name,
      passed: false,
      error: {
        name: e.name,
        status: e.status,
        message: String(e.message).replaceAll(key, "[REDACTED]").slice(0, 350),
      },
    });
    console.log("FAIL " + name);
  }
}
(async () => {
  for (const streaming of [false, true]) {
    await check(
      `${provider} modern ${streaming ? "stream" : "complete"} image recognition and saved replay`,
      async () => {
        let executions = 0;
        const params = {
          model,
          prompt,
          maxSteps: 3,
          maxTokens: 1024,
          signal: AbortSignal.timeout(60000),
          tools: {
            inspect_image: tool({
              description: "Return the image identified by imageId.",
              parameters: z.object({ imageId: z.literal("sample") }),
              execute: async () => {
                executions++;
                return { displayLabel: "sample" };
              },
              toModelOutput: () => output,
            }),
          },
        };
        const result = await (streaming
          ? streamText(params)
          : generateText(params));
        assert.match(await result.text, /\bblue\b/i);
        assert.equal(executions, 1);
        const messages = JSON.parse(
          JSON.stringify((await result.response).messages),
        );
        const follow = await generateText({
          model,
          messages: [
            ...messages,
            {
              role: "user",
              content: "What color did the tool image show? Answer one word.",
            },
          ],
          maxTokens: 1024,
          signal: AbortSignal.timeout(60000),
        });
        assert.match(follow.text, /\bblue\b/i);
      },
    );
    await check(
      `${provider} Runtime ${streaming ? "stream" : "complete"} image recognition`,
      async () => {
        let executions = 0;
        const runtime = createRuntime({
          provider:
            providerModule[
              provider === "openai" ? "createOpenAI" : "createAnthropic"
            ](options),
          model: modelId,
          maxIterations: 3,
          tools: [
            {
              name: "inspect_image",
              description: "Return the image.",
              location: "server",
              inputSchema: {
                type: "object",
                properties: { imageId: { type: "string" } },
                required: ["imageId"],
              },
              handler: async () => {
                executions++;
                return { success: true, _aiContent: output.content };
              },
            },
          ],
        });
        const result = await runtime.chat(
          {
            messages: [{ role: "user", content: prompt }],
            streaming,
            config: { maxTokens: 1024 },
          },
          AbortSignal.timeout(60000),
        );
        assert.match(result.text, /\bblue\b/i);
        assert.equal(executions, 1);
      },
    );
  }

  for (const streaming of [false, true])
    await check(
      `${provider} Copilot ${streaming ? "SSE" : "JSON"} mixed image tools and restored history`,
      async () => {
        const {
          ReactChat,
        } = require("../../../copilot-sdk/dist/react/index.cjs");
        const schema = {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        };
        let serverCalls = 0,
          clientCalls = 0;
        const runtime = createRuntime({
          provider:
            providerModule[
              provider === "openai" ? "createOpenAI" : "createAnthropic"
            ](options),
          model: modelId,
          maxIterations: 4,
          tools: [
            {
              name: "server_image",
              description: "Return the server image. Call once.",
              location: "server",
              inputSchema: schema,
              handler: async () => {
                serverCalls++;
                return { success: true, _aiContent: output.content };
              },
            },
          ],
        });
        const originalFetch = global.fetch;
        global.fetch = (url, init) =>
          String(url) === "https://copilot.test/api/chat"
            ? runtime.handleRequest(new Request(url, init))
            : originalFetch(url, init);
        const init = {
          runtimeUrl: "https://copilot.test/api/chat",
          streaming,
          threadId: "synthetic-image-check",
          llm: { maxTokens: 1024 },
        };
        const chat = new ReactChat(init);
        let restored;
        const pending = [];
        chat.setTools([
          {
            name: "client_image",
            description: "Return the client image. Call once.",
            location: "client",
            inputSchema: schema,
          },
        ]);
        chat.onToolCalls((e) => pending.push(e));
        try {
          await chat.sendMessage(
            "Call server_image and client_image once each to see their images. Then name the dominant color of each image. Do not guess before calling both tools.",
          );
          while (pending.length) {
            assert.ok(clientCalls < 3);
            const event = pending.shift();
            await chat.continueWithToolResults(
              event.toolCalls.map((call) => {
                clientCalls++;
                return {
                  toolCallId: call.id,
                  result: { success: true, _aiContent: output.content },
                };
              }),
            );
          }
          assert.equal(chat.error, undefined);
          assert.equal(serverCalls, 1);
          assert.equal(clientCalls, 1);
          assert.match(
            chat.messages.filter((m) => m.role === "assistant").at(-1).content,
            /blue/i,
          );
          restored = new ReactChat({
            ...init,
            initialMessages: JSON.parse(JSON.stringify(chat.messages)),
          });
          await restored.sendMessage(
            "What color were both tool images? Answer with one word.",
          );
          assert.equal(restored.error, undefined);
          assert.match(
            restored.messages.filter((m) => m.role === "assistant").at(-1)
              .content,
            /blue/i,
          );
        } finally {
          chat.dispose();
          restored?.dispose();
          global.fetch = originalFetch;
        }
      },
    );
  fs.writeFileSync(
    process.env.IMAGE_LIVE_REPORT ||
      `/tmp/copilot-sdk-audit/images-live-${provider}.json`,
    JSON.stringify({ provider, model: modelId, checks }, null, 2),
  );
  if (checks.some((x) => !x.passed)) process.exitCode = 1;
})();
