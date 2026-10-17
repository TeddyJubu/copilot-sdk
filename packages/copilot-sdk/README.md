<a href="https://copilot-sdk.yourgpt.ai">
  <img src="https://copilot-sdk.yourgpt.ai/images/yourgpt-copilot-sdk-npm.png" alt="YourGPT Copilot SDK" width="100%" />
</a>

# Copilot SDK

[![npm version](https://img.shields.io/npm/v/@yourgpt/copilot-sdk)](https://www.npmjs.com/package/@yourgpt/copilot-sdk)
[![npm downloads](https://img.shields.io/npm/dm/@yourgpt/copilot-sdk)](https://www.npmjs.com/package/@yourgpt/copilot-sdk)
[![License](https://img.shields.io/npm/l/@yourgpt/copilot-sdk)](https://github.com/YourGPT/copilot-sdk/blob/main/LICENSE)

Build AI Copilots for Your Product.

Production-ready AI Copilots for any product. Connect any LLM, deploy on your infrastructure, own your data.

**Documentation:** [copilot-sdk.yourgpt.ai](https://copilot-sdk.yourgpt.ai)

## Installation

```bash
npm install @yourgpt/copilot-sdk @yourgpt/llm-sdk
```

## Version 2.6.0

The isolated production baseline is prepared as 2.6.0; npm publication is a separate step.
This combined checkout also contains unreleased next-beta APIs and playground work.
The package version is a preparation value, not confirmation of an npm release.
Until it is published, use Copilot SDK `2.5.1-beta.3` and LLM SDK `2.6.0-beta.3`.

```bash
npm install @yourgpt/copilot-sdk@2.5.1-beta.3 @yourgpt/llm-sdk@2.6.0-beta.3
```

The isolated production baseline promotes the runtime implementation tested in Copilot SDK
`2.5.1-beta.3` and LLM SDK `2.6.0-beta.3`, including Responses provider-state
preservation, native image tool results, microphone helpers, and the Anthropic
system-prompt fix. See the [2.6.0 upgrade guide](https://copilot-sdk.yourgpt.ai/docs/release-2-6),
[image tools](https://copilot-sdk.yourgpt.ai/docs/tools/image-results), and
[voice input](https://copilot-sdk.yourgpt.ai/docs/chat/voice-input) for examples and
support limits. Realtime voice and image generation are separate, unreleased next-beta work.

## Quick Start

For beta integrations, see the [compatibility and release guide](../../apps/docs/content/docs/llm-sdk/beta-upgrade.mdx).
The published Copilot beta remains `2.5.1-beta.3`; the LLM compatibility hotfix is
`2.6.0-beta.3`. Image tool output and recorded microphone helpers are available
in those packages. `RealtimeVoiceSession` and `useRealtimeVoice` are implemented
on the next-beta branch and are **not published yet**. Their setup and lifecycle
are documented in the [media guide](../llm-sdk/docs/media.md).

```tsx
import { CopilotProvider } from "@yourgpt/copilot-sdk/react";
import { CopilotChat } from "@yourgpt/copilot-sdk/ui";

function App() {
  return (
    <CopilotProvider runtimeUrl="/api/chat">
      <YourApp />
      <CopilotChat />
    </CopilotProvider>
  );
}
```

## Subpath Exports

| Subpath  | Description                    |
| -------- | ------------------------------ |
| `/react` | React hooks and provider       |
| `/ui`    | Pre-built UI components        |
| `/core`  | Types, utilities, tool helpers |

## Examples

Explore real-world implementations and demo projects.

### Debug Assistant

AI-powered debugging companion that captures console logs, takes screenshots, and provides intelligent analysis.

<a href="https://copilot-sdk.yourgpt.ai/docs/examples">
  <img src="https://copilot-sdk.yourgpt.ai/images/debug-assistant-demo.webp" alt="Debug Assistant" width="100%" style="border-radius: 12px;" />
</a>

### Support Ticket System

AI-powered customer support with intelligent ticket routing, automatic escalation, and context-aware responses.

<a href="https://copilot-sdk.yourgpt.ai/docs/examples">
  <img src="https://copilot-sdk.yourgpt.ai/images/copilot-sdk-support-demo.png" alt="Support Ticket System" width="100%" style="border-radius: 12px;" />
</a>

### SaaS Application

SaaS template with AI copilot integration. Includes subscription handling, billing management, and intelligent assistance.

<a href="https://copilot-sdk.yourgpt.ai/docs/examples">
  <img src="https://copilot-sdk.yourgpt.ai/images/saas-demo.webp" alt="SaaS Application" width="100%" style="border-radius: 12px;" />
</a>

**[View all examples →](https://copilot-sdk.yourgpt.ai/docs/examples)**

## License

MIT
