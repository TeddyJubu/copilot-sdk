# Images and realtime voice

Generate and edit images with OpenAI, or connect browser voice calls to Copilot
tools over WebRTC. Realtime voice is experimental. See
[package availability](https://copilot-sdk.yourgpt.ai/docs/llm-sdk/beta-upgrade)
for the versions that expose these APIs.

## Image generation and editing

```ts
import { generateImage } from "@yourgpt/llm-sdk";
import { openaiImage } from "@yourgpt/llm-sdk/openai";

const result = await generateImage({
  model: openaiImage("gpt-image-2.5-flare"), // reads OPENAI_API_KEY on the server
  prompt: "A simple blue circle on a white background",
  size: "1024x1024",
  providerOptions: { openai: { quality: "low", outputFormat: "png" } },
});
// result.image.uint8Array, result.image.base64, result.image.mediaType
// result.images, result.usage, result.response.requestId

const edit = await generateImage({
  model: openaiImage("gpt-image-2.5-flare"),
  prompt: "Change the circle to green",
  images: [{ data: result.image.uint8Array, mediaType: "image/png" }],
  providerOptions: { openai: { outputFormat: "webp", outputCompression: 80 } },
});
```

`images` selects the Images edit endpoint. Inputs accept bytes, ArrayBuffer or Blob
with a PNG/JPEG/WebP media type. An optional PNG `mask` applies to the first image;
match its dimensions to that image. No remote URLs are fetched automatically.
`n` is 1–10; editing accepts 1–16 images. Each input must be below 50 MB, and the
SDK limits total input to 100 MB and the encoded response to 128 MiB.

OpenAI options: `quality`, `background`, `outputFormat`, `outputCompression`,
`inputFidelity` (edits), `moderation` (generation), and `safetyIdentifier`.
GPT Image 2.5 supports `xhigh`/`max` quality and custom dimensions within its
documented limits. Transparent output requires PNG or WebP. Compression requires
JPEG or WebP. Unsupported options fail explicitly. Retired DALL-E models are not
supported. Streaming partial images and the Responses-hosted image tool are
separate APIs, not part of this helper.

`signal` cancels requests; `timeoutMs` defaults to 120 seconds (maximum 10 minutes).
Requests are not automatically retried. Aborting locally cannot guarantee that a
provider has stopped a billable generation. `MediaAPIError` includes `code`,
optional HTTP `status`, and `requestId`; it omits provider error bodies.

## Realtime voice: server setup

OpenAI GA Realtime is a turn-based speech conversation over WebRTC. It is distinct
from GPT-Live's continuous/delegated protocol. The SDK supports OpenAI Realtime
browser calls, not GPT-Live, telephony/SIP, or other realtime providers.

Authenticate and authorize your session endpoint, apply quotas/rate limits, and
set `Cache-Control: no-store`. Keep the long-lived key on your server. The easiest
flow exchanges the browser's SDP offer on that server:

```ts
import { openaiRealtime } from "@yourgpt/llm-sdk/openai";

// Inside your authenticated POST handler. Only accept the SDP from the browser.
const answer = await openaiRealtime("gpt-realtime-2.1").createCall({
  sdp: requestBody.sdp,
  instructions: "You are a helpful assistant. Keep spoken answers brief.",
  voice: "marin",
  transcriptionModel: "gpt-transcribe",
  tools: [
    {
      name: "get_status",
      description: "Read the application status",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  ],
  signal: requestSignal,
});
// Return answer as JSON: { sdp: "..." }. No provider key is returned.
```

Alternatively, `createClientSecret({ expiresAfterSeconds: 60, ...sessionOptions })`
returns `{ value, expiresAt, modelId }`. Give only that short-lived credential to
the browser's `getClientSecret` callback. The TTL applies to establishing sessions,
not to an already connected call; a token can establish multiple calls until it
expires. Session options attached to a token can be overridden by the client.
Neither flow substitutes for authentication/authorization on business tool APIs.

Optional server settings include `outputModality: "text" | "audio"`,
`maxOutputTokens`, `language` with a transcription model, and `safetyIdentifier`.
Setup requests time out after 30 seconds and are never retried automatically.
Server VAD with automatic replies/interruption is enabled by default. Select
semantic VAD with `turnDetection: { type: "semantic_vad", eagerness: "medium" }`,
or use `turnDetection: null` with explicit `commitAudio()` after capturing audio.

## Browser and React

Use `useRealtimeVoice` inside `CopilotProvider`. It reads the active tool registry
and `needsApproval` policy from that provider. Supply `getToolPermission` to reuse
your application’s stored permissions; otherwise approval-required tools ask on every call. Start capture from a user gesture:

```tsx
import { useRealtimeVoice } from "@yourgpt/copilot-sdk/react";

function VoiceControls() {
  const voice = useRealtimeVoice({
    createCall: async ({ sdp, signal }) => {
      const response = await fetch("/api/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sdp }),
        signal,
      });
      if (!response.ok) throw new Error("Voice setup failed");
      return response.json();
    },
  });
  return (
    <>
      <button onClick={() => void voice.connect().catch(console.error)}>
        Start call
      </button>
      <button onClick={voice.disconnect}>End call</button>
      <button onClick={() => voice.setMuted(!voice.muted)}>
        Toggle microphone
      </button>
      {voice.pendingApprovals.map((call) => (
        <div key={call.id}>
          Allow {call.name}?
          <button onClick={() => call.approve()}>Allow</button>
          <button onClick={call.reject}>Deny</button>
        </div>
      ))}
    </>
  );
}
```

Also available: `state`, `muted`, `error`, `transcripts`, `sendText`, `interrupt`,
`commitAudio`, and `resumeAudio` (for browsers that block autoplay). Unmounting
disconnects and releases capture. The hook retains at most 200 transcript items.
Connection configuration is captured when connecting; tool handlers, the optional permission resolver,
and observer callbacks use the latest React values.

Framework-independent apps can construct `RealtimeVoiceSession` from
`@yourgpt/copilot-sdk/core`, with `getTools`, `getToolPermission` and `onApproval`.
`realtimeToolDefinitions(tools)` converts Copilot tools to the server setup shape;
the server must independently choose which tools it permits. Credentials and
session instructions must not be accepted blindly from browser input.

`needsApproval` (including conditional callbacks) is respected. `deny_always`
blocks execution; `allow_always`/`session` permit it. Without an approval callback,
the core class denies required approval. The React hook exposes pending approvals
unless you provide your own callback. Tool handlers receive `signal`, `toolCallId`
and approved `approvalData`. Business handlers still validate their arguments and
enforce server-side authorization. These are voice approval controls, not the
text-chat pending-approval queue.

Duplicate call IDs execute at most once within a connection. Completed tool batches
resume the model once; a user interruption suppresses stale follow-up speech while
retaining tool output in the active conversation. Failed/timed-out tools produce
one error result. A disconnect cancels pending approvals and signals running tools;
handlers must honor cancellation themselves. There is no automatic reconnect or
tool replay. Reconnecting creates a fresh provider conversation; persist application
state separately if needed. This is not a cross-session exactly-once guarantee.

## Limits and observability

- HTTPS or localhost and a WebRTC browser are required. The default microphone
  adapter uses browser permission; an optional `getMicrophone` adapter can supply
  synthetic audio. The session owns and stops all tracks returned by that adapter.
- Audio travels as WebRTC media tracks with negotiated codecs/rates, not as an SDK
  PCM stream. Use browser `RTCPeerConnection.getStats()` for actual negotiated media
  metrics. WebRTC's server buffer handles VAD interruption and truncation.
- `onTranscript`, `onUsage`, `onEvent`, `onToolResult`, `onStateChange`, and `onError`
  provide observations. Raw events can contain conversation content: log selectively.
- Defaults: 30-second connection timeout, 60-second tool/approval timeout,
  30-minute call duration, 100 tool calls, 1 MiB event/send buffer, 64 KB tool result.
  Limits are configurable through `RealtimeVoiceOptions` where exposed.
- Network loss closes the session and stops capture. Browser autoplay failures
  keep the call available for `resumeAudio()`. Clearly disclose AI-generated voice.

Run the local demo in `examples/skills-demo` with `pnpm demo:media`, then visit
`http://localhost:3033/media.html`. Existing `.env` keys are read only by the server;
never prefix them with `VITE_`. Its server binds to loopback and checks the origin;
that local-only guard is not production authentication.

## Research and validation

Provider contracts: [Realtime getting started](https://developers.openai.com/api/docs/guides/realtime),
[WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?api=realtime),
[client secrets](https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create),
[conversations/tools](https://developers.openai.com/api/docs/guides/realtime-conversations),
[image generation](https://developers.openai.com/api/docs/guides/image-generation).
Compared with [Vercel realtime](https://ai-sdk.dev/docs/ai-sdk-core/realtime) and
[image generation](https://ai-sdk.dev/docs/ai-sdk-core/image-generation), including
source and changelog snapshot `fce9210c6405c0ad8452fee3f50717e8ea910b97` (2026-10-16).
See the repository's media implementation and validation records for exact validation results.
