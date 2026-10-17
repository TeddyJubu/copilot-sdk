# Next beta: images and realtime voice

Implemented on `codex/next-beta-decisions` after the native Decisions commit.
No version bump, npm release, push or PR is included. The production candidate
remains separate on `codex/production-release`.

## Added

- `generateImage` / `openaiImage`: GPT Image generation, image edits and masks,
  PNG/JPEG/WebP output, quality/transparency/compression, bytes/base64 and usage.
  Input validation, bounded reads, timeouts, cancellation and sanitized errors.
- `openaiRealtime`: OpenAI GA Realtime server SDP exchange and short-lived client
  secrets. Typed session configuration, VAD, transcription, tools and expiry.
- `RealtimeVoiceSession`: browser WebRTC microphone/audio, transcripts, mute,
  text input, interruption, manual audio commit, usage and disconnect cleanup.
- `useRealtimeVoice`: current CopilotProvider integration, active registered
  handlers, approval controls, optional application permission resolver, and
  unmount cleanup. The provider adds an optional `getRegisteredTools` reader so
  tools registered before the first chat message are available immediately.
- Tool deduplication per connection, denied/conditional approvals, cancellation,
  timeouts and guarded continuation after interruption. No automatic reconnect
  or tool replay.
- A local media demo in `examples/skills-demo`, public documentation pages, a
  shipped package guide, protocol tests and opt-in real API/browser tests.

Existing chat, Responses, Decisions, TTS/STT and image tool result implementations
were not changed. The provider's existing registration/update behavior is retained;
the new registry reader is additive. No claim of zero possible regressions is made.

## Verification

| Check                                                      | Result                                                                                    |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Automated SDK and Copilot regression suite                 | 439 passed (67 new image/realtime tests)                                                  |
| New tests on Node 18.20.8 and 20.20.2                      | 67 passed on each runtime                                                                 |
| CJS/ESM public declarations and SDK TypeScript             | Passed                                                                                    |
| Packed packages on Node 18                                 | CJS/ESM image/realtime factories, core session, React hook and shipped guide passed       |
| Complete workspace build                                   | 21 tasks passed, including documentation and examples                                     |
| React demo under StrictMode with browser protocol fixtures | Connect, active registry, approval, denial, mute, disconnect with approval pending passed |
| Real GPT Image 2.5 Flare generation                        | PNG returned, 757999 bytes, usage and request ID captured                                 |
| Real GPT Image 2.5 Flare edit                              | WebP returned, 29276 bytes, usage and request ID captured                                 |
| Real OpenAI realtime client secret                         | Valid 60-second ephemeral credential returned; credential not logged                      |
| Real Chromium WebRTC call, gpt-realtime-2.1                | Connected, required tool approval waited, handler ran once and spoken answer continued    |
| Real synthetic audio input/output                          | User speech transcribed; incoming audio packets and nonzero audio energy verified         |
| Real interruption and cleanup                              | Playback buffer cleared; mute, usage events, ended track and closed peer verified         |

The successful real browser run took about 1.8 seconds to connect; its full
synthetic phrase/transcription check took about 4 seconds. These are individual
smoke-test timings, not production latency benchmarks. The final run had no
provider error events. One earlier interruption run reported a transient provider
error; the explicit recheck passed without it.

The first synthetic input attempts timed out after successful connection/tool
checks. The test harness needed continuous silence after its finite speech clip
for server VAD to see the end of speech. After fixing that fixture, the real
input/output and interruption checks passed. Initial React demo testing caught
the legacy-context reference and stale registry snapshot; both were corrected and
the UI smoke test was rerun successfully.

Evidence is under `/tmp/copilot-next-beta-media`: `all-tests.log`,
`node18-tests.log`, `node20-tests.log`, `workspace-build-final.log`,
`public-types.log`, `react-test.log`, `live-media.json`,
`live-realtime-browser.json`, and retained initial failure reports. Only synthetic
inputs were used; no physical microphone was recorded, and the browser subprocess
did not receive a long-lived API key.

## Limits and remaining release work

Realtime is experimental and currently supports OpenAI GA Realtime over browser
WebRTC. GPT-Live's distinct delegation protocol, telephone/SIP, other realtime
providers, streaming image previews and Responses-hosted image generation are
separate extensions. Physical microphone/speaker quality, Safari/Firefox/mobile
behavior and production p95 latency still need evaluation. Targets are recorded
in the [research plan](../plans/2026-10-17-media-beta.md).

Direct Jev/Cloudflare live validation remains unavailable without those providers'
credentials; earlier Decisions fixture coverage and OpenRouter checks still apply.
Before shipping, review the branch, obtain the required push/PR approval, and
confirm exact package versions/npm tags separately.
