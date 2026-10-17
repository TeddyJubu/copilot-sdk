# Next beta: realtime voice and image generation

Requested after the native Decisions milestone. Work stays on
`codex/next-beta-decisions`; the production candidate is unchanged.

## Research checked before implementation

OpenAI official documentation was read on 2026-10-17:

- [Realtime](https://developers.openai.com/api/docs/guides/realtime),
  [WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?api=realtime),
  [client-secret schema](https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create),
  and [conversation events](https://developers.openai.com/api/docs/guides/realtime-conversations).
  Use GA endpoints, nested audio configuration, `response.output_*` events and
  function outputs correlated by call ID. Realtime and GPT-Live are separate
  protocols. WebRTC supports server SDP exchange and ephemeral credentials;
  the backend owns long-lived keys. WebRTC manages interruption truncation.
- [Images](https://developers.openai.com/api/docs/guides/image-generation): current
  GPT Image 2.5 Flare/Sunburst support generation, edits, masks, formats,
  transparency, compression and usage. Defaults use Flare; retired DALL-E is excluded.

The older local competitor clone was not used as current evidence. The fresh Vercel
snapshot was checked against GitHub main:
[`fce9210c6405c0ad8452fee3f50717e8ea910b97`](https://github.com/vercel/ai/tree/fce9210c6405c0ad8452fee3f50717e8ea910b97),
2026-10-16, with `@ai-sdk/openai` 4.0.96 / `ai` 7.0.143.

| Vercel evidence                                                                                                                                                                                                                                      | What applies here                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| [OpenAI changelog](https://github.com/vercel/ai/blob/fce9210c6405c0ad8452fee3f50717e8ea910b97/packages/openai/CHANGELOG.md), `5fb2a64`, `8487955`, `525efc5`                                                                                         | GPT Image 2.5 IDs, xhigh/max quality, file/mask capabilities.                                                |
| [Image model](https://github.com/vercel/ai/blob/fce9210c6405c0ad8452fee3f50717e8ea910b97/packages/openai/src/image/openai-image-model.ts)                                                                                                            | Separate image model/helper; JSON generations and multipart edits, bytes, usage.                             |
| [Realtime model](https://github.com/vercel/ai/blob/fce9210c6405c0ad8452fee3f50717e8ea910b97/packages/openai/src/realtime/openai-realtime-model.ts)                                                                                                   | GA client secrets, explicit expiry anchor, provider configuration.                                           |
| [Realtime core](https://github.com/vercel/ai/tree/fce9210c6405c0ad8452fee3f50717e8ea910b97/packages/ai/src/realtime) and [React hook](https://github.com/vercel/ai/blob/fce9210c6405c0ad8452fee3f50717e8ea910b97/packages/react/src/use-realtime.ts) | Lifecycle belongs in core/framework integration. Tools need explicit application approval and replay policy. |

## Implementation decisions

1. Add `generateImage` / `openaiImage` and independent model/result types. Keep chat
   contracts unchanged. Include bytes, edits/masks and output controls; no implicit
   URL fetches or automatic retry of paid requests.
2. Add `openaiRealtime` server setup with both SDP exchange and short-lived secrets.
   Start with one provider as issue #126 specifies. Do not label Realtime as GPT-Live.
3. Add a browser WebRTC session and React integration using existing Copilot tools
   and permissions, opt-in capture, transcripts, interruption, usage and cleanup.
   Bound sessions and buffers; explicitly reconnect with a fresh conversation.
4. Exercise protocol failures deterministically, then real image and browser voice
   calls with the available OpenAI credential and synthetic audio. Keep credentials
   on the server and out of browser subprocess environments.

## Readiness targets

For beta: no leaked tracks/peer connections after disconnect, no execution before
required approval, no duplicate execution within a connection, and successful real
audio input/output with tool continuation. Record setup/API timings rather than
claiming a universal latency result. Before production voice readiness, evaluate
p95 first-audio latency under 1.5 seconds after speech end, interruption under
300 ms, and task completion/recognition quality on representative microphones,
languages, networks and supported browsers. These are targets, not measured claims.

GPT-Live server delegation, telephony/SIP, additional realtime providers, streaming
image previews and Responses-hosted image generation remain separately scoped
extensions. They are not needed to supply the requested realtime calls and image
generation via the first supported provider.
