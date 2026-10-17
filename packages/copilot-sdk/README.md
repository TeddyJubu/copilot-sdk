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

## Features and versions

Copilot supports tool execution, Responses conversation state, native image tool
results, microphone recording, and experimental realtime voice with
`RealtimeVoiceSession` and `useRealtimeVoice`. See the
[2.6.0 upgrade guide](https://copilot-sdk.yourgpt.ai/docs/release-2-6),
[image tools](https://copilot-sdk.yourgpt.ai/docs/tools/image-results),
[voice input](https://copilot-sdk.yourgpt.ai/docs/chat/voice-input), and
[realtime voice](https://copilot-sdk.yourgpt.ai/docs/llm-sdk/realtime) for examples
and support limits.

This README describes source on `main`. Check
[versions and compatibility](https://copilot-sdk.yourgpt.ai/docs/llm-sdk/beta-upgrade)
for the features exported by each published npm version.

## Quick Start

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
