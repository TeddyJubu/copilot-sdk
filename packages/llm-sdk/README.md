# @yourgpt/llm-sdk

Multi-provider LLM SDK with streaming. One API, any provider.

## Installation

```bash
npm install @yourgpt/llm-sdk @anthropic-ai/sdk
```

> For other providers (OpenAI, Google, xAI), see [Providers Documentation](https://copilot-sdk.yourgpt.ai/docs/providers).

## OpenAI reasoning parameters

The SDK normalizes token limits and sampling options for recognized OpenAI model
families, including GPT-6. Reasoning stays enabled by default. An unsupported
`temperature` is omitted with a warning; the SDK does not silently disable
reasoning. Use `onWarning` in the OpenAI provider configuration to handle these
warnings yourself.

For a model that supports non-reasoning mode, select it explicitly when sampling
control is required:

```ts
import { generateText } from "@yourgpt/llm-sdk";
import { openai } from "@yourgpt/llm-sdk/openai";

const result = await generateText({
  model: openai("gpt-6-luna"),
  prompt: "Classify this request.",
  reasoningEffort: "none",
  temperature: 0,
});
```

`reasoningEffort` can also be set on `createOpenAI(...)` or `OpenAIAdapter` and
overridden in a Runtime request's `config`. Unsupported `none`/`minimal` settings
for recognized reasoning models fail before the provider request.

On OpenAI's own endpoint, GPT-5.4+ and GPT-6 tool requests with reasoning use the
existing Responses transport, in both Runtime and modern generation. Custom
endpoints keep Chat routing. Servers with different parameter rules can set
`parameterPolicy: "passthrough"` on the OpenAI provider. Responses requires an
installed OpenAI client that exposes `responses.create`; older clients fail with
an actionable error. This routing does not add the separate Decisions API.

## Compatibility fallback

Transient failures retain bounded retries and fallback. Compatibility errors such
as an unsupported parameter stop by default. To advance to another model for a
specific compatibility error without repeating the same invalid request, use
`fallbackErrors` independently of `retryableErrors`:

```ts
import { createFallbackChain } from "@yourgpt/llm-sdk/fallback";
import { createOpenAI } from "@yourgpt/llm-sdk/openai";

const provider = createOpenAI();
const adapter = createFallbackChain({
  models: [
    provider.languageModel("gpt-6-luna"),
    provider.languageModel("gpt-4o"),
  ],
  retries: 2,
  fallbackErrors(error) {
    const e = error as { status?: number; code?: string; param?: string };
    return (
      e?.status === 400 &&
      e.code === "unsupported_parameter" &&
      e.param === "temperature"
    );
  },
});
```

This is an additional fallback policy for otherwise non-retryable errors. It does
not disable transient retries. Keep the predicate narrow; do not match every 400
or use `retryableErrors: () => true` for compatibility failures. Cancellation and
errors after stream output or tool events never retry or switch models. Provider
status/code/parameter fields survive OpenAI streaming errors; raw error causes
are retained only in-process and omitted from JSON/SSE output.

Stream readers and final-result promises share one execution, including tool
execution. Later readers replay retained stream parts; pass an abort signal to
cancel generation. Cancellation during a tool stops subsequent tools and rejects
the result rather than reporting a successful completion.
`pnpm --filter @yourgpt/llm-sdk test` builds the package and
runs offline provider/fallback regression tests without real API credentials.

## Quick Start

```ts
// app/api/chat/route.ts
import { streamText } from "@yourgpt/llm-sdk";
import { anthropic } from "@yourgpt/llm-sdk/anthropic";

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = await streamText({
    model: anthropic("claude-sonnet-4-20250514"),
    system: "You are a helpful assistant.",
    messages,
  });

  return result.toTextStreamResponse();
}
```

```bash
# .env.local
ANTHROPIC_API_KEY=sk-ant-...
```

## With Copilot SDK

Use `createRuntime` for full Copilot SDK integration with tools support:

```ts
// app/api/chat/route.ts
import { createRuntime } from "@yourgpt/llm-sdk";
import { createAnthropic } from "@yourgpt/llm-sdk/anthropic";

const runtime = createRuntime({
  provider: createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
  model: "claude-sonnet-4-20250514",
  systemPrompt: "You are a helpful assistant.",
});

export async function POST(req: Request) {
  return runtime.stream(await req.json()).toResponse();
}
```

## Selective Tool Loading

`llm-sdk` can now narrow tools before they reach the provider. This is opt-in and works with both local ranking and provider-native hints.

```ts
import { createRuntime, type ToolDefinition } from "@yourgpt/llm-sdk";
import { createOpenAI } from "@yourgpt/llm-sdk/openai";

const tools: ToolDefinition[] = [
  {
    name: "search_docs",
    description: "Search product docs",
    location: "server",
    category: "knowledge",
    profiles: ["support", "research"],
    searchKeywords: ["docs", "kb", "help"],
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
    handler: async ({ query }) => ({ query }),
  },
  {
    name: "get_time",
    description: "Get current time",
    location: "server",
    category: "utility",
    profiles: ["utility"],
    deferLoading: true,
    inputSchema: { type: "object", properties: {} },
    handler: async () => ({ now: new Date().toISOString() }),
  },
];

const runtime = createRuntime({
  provider: createOpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  model: "gpt-4o-mini",
  tools,
  agentLoop: {
    enabled: true,
    toolSelection: {
      enabled: true,
      defaultProfile: "support",
      search: {
        enabled: true,
        maxResults: 4,
        exposeWhenToolCountExceeds: 1,
      },
      dynamicSelection: { enabled: true, maxTools: 2 },
      nativeProviderHints: {
        openai: { toolChoice: "single", parallelToolCalls: false },
      },
    },
  },
});

// Request body can override the active profile:
// { "messages": [...], "toolProfile": "utility" }
```

When `search.enabled` is on, deferred tools can be discovered through a hidden `search_tools` server tool. Matching tools are loaded into the next loop iteration instead of sending every deferred tool definition up front.

## Documentation

Visit **[copilot-sdk.yourgpt.ai](https://copilot-sdk.yourgpt.ai)** for full documentation:

- [All Providers](https://copilot-sdk.yourgpt.ai/docs/providers) - OpenAI, Anthropic, Google, xAI
- [Server Setup](https://copilot-sdk.yourgpt.ai/docs/server) - Runtime, streaming, tools
- [Tools](https://copilot-sdk.yourgpt.ai/docs/tools) - Server-side and client-side tools
- [LLM SDK Reference](https://copilot-sdk.yourgpt.ai/docs/llm-sdk) - streamText, generateText

## License

MIT
