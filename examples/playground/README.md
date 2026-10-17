# Copilot SDK Playground

This is the existing [deployed Copilot playground](https://copilot-sdk.yourgpt.ai/playground). The dashboard compares providers and exercises Copilot tools. Its **Feature lab** link adds focused examples for the next beta, sharing the same **API keys** dialog and saved keys. Both pages use the workspace SDK packages built from this repository.

The Feature Lab is currently local; it has not been deployed to that public URL.
The [step-by-step testing guide](../../apps/docs/content/docs/feature-lab.mdx)
covers every control and expected result. See [release availability](../../apps/docs/content/docs/llm-sdk/beta-upgrade.mdx)
for the distinction between the published hotfix and next-beta source.

## Use the hosted playground

After deploying this branch to the existing playground project, open **Feature lab** from the dashboard, choose **API keys**, and select an example. Existing saved OpenAI, Anthropic and OpenRouter keys work on both pages. The same dialog also accepts direct TypeSafe/Jev and Cloudflare credentials, including the Cloudflare account ID.

Hosted requests use your selected provider's key. Keys are saved in browser storage and forwarded in request headers to the playground server for the selected provider call; they are not placed in URLs, example reports or server configuration. Hosted feature routes never fall back to shared server keys.

## Run locally

Requires Node.js 22+ and the workspace's pinned pnpm 11.5.1. From the repository root:

```bash
pnpm install
pnpm build:sdk
pnpm --filter playground dev:features
```

Open [the Feature Lab](http://127.0.0.1:3035/playground/features), or follow **Feature lab** from [the playground](http://127.0.0.1:3035/playground).

The same API-key dialog works locally. Alternatively, `dev:features` enables local server credentials from your secret runner or an ignored `examples/playground/.env.local`. These keys are never returned to the browser. A key entered in the dialog takes precedence. Do not commit credentials.

| Variable                                          | Enables                                                                                                  |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`                                  | Parameters, fallback, Decisions, Responses, image tools, TTS, STT, realtime and image generation/editing |
| `ANTHROPIC_API_KEY`                               | Image tools and system prompt compatibility                                                              |
| `OPENROUTER_API_KEY`                              | Native Decisions through OpenRouter                                                                      |
| `TYPESAFE_AI_API_KEY`                             | Direct Jev/TypeSafe Decisions                                                                            |
| `CLOUDFLARE_AUTH_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Decisions                                                                                     |

The normal dashboard also supports `GOOGLE_API_KEY` and `XAI_API_KEY`. See [.env.example](.env.example) for configuration names.

## Examples and expected results

Select an example, choose a configured provider and click **Run example**. Each run displays the response, checks, timing and available native usage. **Example code** shows the SDK call; the full implementations are ordinary exported server functions under [`lib/feature-lab/examples`](lib/feature-lab/examples).

| Example                     | What it exercises                                                                                             | Source                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Reasoning parameters        | GPT-6 Luna with temperature zero; warning/omission under default reasoning, preservation with explicit `none` | [`parametersExample`](lib/feature-lab/examples/chat.ts)                                                             |
| Compatibility fallback      | Deliberate passthrough error, one opt-in fallback to GPT-4o and zero retries of invalid parameters            | [`fallbackExample`](lib/feature-lab/examples/chat.ts)                                                               |
| Native Decisions            | Boolean, choice and score questions; actual probabilities, refusals and usage; optional inline image state    | [`decisionsExample`](lib/feature-lab/examples/decisions.ts)                                                         |
| Responses & replay          | Two calls with `store: false`, full saved message replay, native usage and optional encrypted reasoning       | [`responsesExample`](lib/feature-lab/examples/chat.ts)                                                              |
| Images in tool calls        | A real image returned via `toModelOutput`, one tool execution, color recognition and saved-history replay     | [`toolImagesExample`](lib/feature-lab/examples/chat.ts)                                                             |
| System prompt compatibility | Anthropic receives both `systemPrompt` and a `role: "system"` message; each returns `SYSTEM_OK`               | [`systemPromptExample`](lib/feature-lab/examples/chat.ts)                                                           |
| Voice generation / TTS      | Play and download generated WAV speech                                                                        | [`speechExample`](lib/feature-lab/examples/media.ts)                                                                |
| Voice input / STT           | Upload audio, record with `VoiceRecorder`, or run a reproducible synthetic TTS→STT check                      | [`transcriptionExample`](lib/feature-lab/examples/media.ts)                                                         |
| Realtime voice              | WebRTC connection, transcripts, mute, interrupt, tool approval/denial and disconnect cleanup                  | [`RealtimePanel`](components/feature-lab/RealtimePanel.tsx), [`realtimeExample`](lib/feature-lab/examples/media.ts) |
| Image generation & editing  | Generate an image or upload one to edit; preview and download                                                 | [`imageExample`](lib/feature-lab/examples/media.ts)                                                                 |

**Run core checks** runs ten configured cases in sequence, including both image-tool providers and all four Decisions providers. Missing credentials produce **skipped**, never passed. TTS, STT, realtime and image generation are separate explicit actions. Real provider calls consume your provider quota.

**Open Copilot chat** exercises the actual `CopilotProvider` / `CopilotChat` UI with server tools and saved conversation history. Where supported, toggle **Streaming** to compare SSE and JSON paths. The focused example runner gathers streamed SDK results into one report; the Copilot panel shows the interactive stream.

The image tool example supplies a blue fixture by default. Uploads are limited to 4 MiB. OpenRouter's native Decisions endpoint accepts text state, not image state; select OpenAI, direct Jev or Cloudflare for image Decisions. A successful custom-image run verifies transport and a model response, not semantic accuracy. For Decisions, the displayed 0.9 routing threshold is illustrative and must be calibrated for a real application. Prompt caching depends on provider eligibility and prompt length: the lab shows usage and does not treat a cache miss as a failure.

**Export results** downloads a JSON report with checks, answers and timing. Audio/image bytes are excluded. Reports can contain your prompts and model outputs. Run history stays in this page's memory and clears when you reload. Realtime has its own transcript/event panel and is not included in the report.

## Deployment and local credentials

`dev:features` enables `PLAYGROUND_FEATURE_LAB=1` and binds to `127.0.0.1:3035`. Shared environment keys require that flag, loopback hostnames, a matching browser origin and a development build. A production build always requires caller-supplied keys, even if the flag is set. Public status responses do not expose whether server keys are configured. Requests with foreign browser origins are rejected; the existing docs proxy origin is supported explicitly.

Build the SDK dependencies and playground together from the repository root:

```bash
pnpm exec turbo run build --filter=playground...
```

Deploy the existing `examples/playground` project using that workspace build. The docs application's existing `/playground/:path*` rewrite also covers the new `/features` page and API routes. No second application is needed. The deployed site changes only after the branch is deployed.

The main dashboard still runs with `pnpm --filter playground dev` at `/playground`. Its provider routes are unchanged.

## Verification

```bash
pnpm --filter playground typecheck
node --test test/feature-lab.test.cjs
pnpm --filter playground build

# Start dev:features separately, then run live Chromium tests.
# Set PLAYWRIGHT_MODULE only if Playwright is installed outside this repository.
RUN_FEATURE_LAB_LIVE=1 node test/live/feature-lab-browser.cjs
RUN_FEATURE_LAB_LIVE=1 node test/live/feature-lab-integration.cjs

# Realtime UI lifecycle checks using fixtures, without provider credentials.
node test/browser/feature-lab.cjs
node test/browser/feature-lab-keys.cjs
```

The first live script makes real provider requests, verifies core results, exercises media playback/uploads and checks desktop/mobile layout. The integration script tests Copilot chat with OpenAI and Anthropic over JSON and SSE, browser recording with synthetic speech, and a real WebRTC call with tool approval and cleanup. It never opens a physical microphone. Both write reports to `/tmp/copilot-feature-lab` by default; use `FEATURE_LAB_REPORT_DIR` to choose another directory. Missing core-provider keys are recorded as skips; media requires OpenAI access, and the integration script requires both OpenAI and Anthropic. Physical microphone quality and other browsers need separate manual testing.

For production-mode verification, start the built app locally with `pnpm --filter playground start --hostname 127.0.0.1 --port 3036`. Run the live scripts with `FEATURE_LAB_URL=http://127.0.0.1:3036/playground/features` and `FEATURE_LAB_CALLER_KEYS=1`, supplying only the required provider keys privately to the test runner. This opt-in seeds those caller keys in an ephemeral browser context and exercises the same header flow as the hosted playground. Chromium's process environment receives no API keys. The fixture-only key test checks the shared dialog, saved-key reuse, provider headers and dashboard navigation without real credentials.

For standalone examples, see the [Decisions CLI and realtime/image demo](../skills-demo/README.md). For broader Copilot UI scenarios, see the [experimental examples](../experimental/README.md). SDK contract tests and the provider audit remain separate from this interactive lab.
