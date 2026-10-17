# Next-beta examples and playground verification

Work remains on `codex/next-beta-decisions`. This completes interactive examples
for the SDK features already implemented on that branch. The compatibility hotfix
was released separately as `@yourgpt/llm-sdk@2.6.0-beta.3`; this playground and the
other next-beta features are not included in that published package.

## Available examples

The [Playground Feature Lab](../../examples/playground/README.md) now runs against
the local workspace SDKs instead of the previously pinned `2.1.8` packages.

- Reasoning parameters and deliberate, explicitly configured compatibility fallback.
- Native Decisions for OpenAI, OpenRouter, direct TypeSafe/Jev and Cloudflare,
  with configured-provider status, probabilities, refusals and image upload where supported.
- Responses conversation replay and images returned by tools.
- Anthropic `systemPrompt` and system-role message compatibility.
- TTS playback/download and STT upload, browser recording or synthetic round trip.
- Realtime WebRTC with registered tools, approval/denial, mute and cleanup.
- Image generation and uploaded-image editing.
- An embedded Copilot chat for OpenAI/Anthropic, with JSON/SSE and multi-turn history.

Examples are ordinary exported functions under `examples/playground/lib/feature-lab/examples`.
The lab includes a sequential core runner, run history and JSON export. Missing
credentials produce skipped results. Local routes require the explicit lab flag,
loopback hostnames and matching browser origins. Keys remain on the server.

## Observed verification

- **526 automated tests passed on Node 26:** the existing 518 SDK/Copilot tests
  plus eight new route/input/access/error tests. All 518 SDK/Copilot tests also
  passed on Node 18. The playground itself requires Node 20.9+.
- **Core browser runner:** eight live examples passed; direct Jev and Cloudflare
  were skipped because credentials are unavailable, following the user's instruction.
- **Nine browser checks passed:** the core runner, explicit non-reasoning parameters,
  non-streaming replay, TTS playback, STT round trip/upload, image generation/editing,
  and mobile layout without browser runtime errors.
- **Seven integration checks passed:** OpenAI/Anthropic image tools and conversation
  memory through Copilot in both JSON and SSE modes; real browser recording and STT;
  live playground WebRTC; and no browser runtime errors.
- The live call waited for approval before executing the tool once. Synthetic
  speech was transcribed, incoming audio had nonzero energy, mute changed the
  outgoing track, and disconnect ended the track and closed the peer. No provider
  error events occurred.
- Browser protocol fixtures also verified denied tools and ending a call while
  an approval was pending, under React StrictMode.
- Playground TypeScript, scoped ESLint and frozen-lockfile installation passed.
  Desktop and mobile screenshots were inspected.
- The complete workspace build passed all 21 tasks, including documentation and
  every example. The eight browser checks after the media cleanup change passed.

The earlier test harness failures were an exact-label selector mismatch, Chromium
not retaining a consumed SSE response body, and comparing raw Markdown to rendered
text. The harness now uses accessible control roles, a cloned response stream and
semantic answer checks. Initial failure reports were retained. Lint also identified
an unnecessary media-preview render; blob URLs now attach to media/download refs
and are revoked on replacement/unmount. Playback and image checks were rerun after
that change.

Synthetic-only evidence is under `/tmp/copilot-feature-lab-resumed/`, including
`core-results.json`, `browser-results.json`, `integration-results.json`, screenshots,
and build/test logs. No physical microphone was recorded. Physical audio quality,
Safari/Firefox/mobile-device behavior and direct Jev/Cloudflare account access
remain unverified. These are functional smoke checks, not production accuracy or
latency guarantees.

No next-beta version bump, push, PR or publication is included in this work.
