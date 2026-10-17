# Beta documentation audit — 17 October 2026

Updated the dedicated SDK docs in `apps/docs`, the shipped package guides and
READMEs, and the SDK entry points in the separate `yourgpt-docs` project.
No runtime implementation, package version, npm tag or deployment changed.

## Coverage

| Area                                                     | Documentation                                                                  |
| -------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Published versions, beta.3 fixes and upgrade boundary    | [Beta upgrades](../../apps/docs/content/docs/llm-sdk/beta-upgrade.mdx)         |
| Reasoning parameters, fallback and TRAINING_CONFLICT     | [Parameters](../../apps/docs/content/docs/llm-sdk/parameters-and-fallback.mdx) |
| Responses, replay, caching, persistence and diagnostics  | [Responses](../../apps/docs/content/docs/llm-sdk/responses.mdx)                |
| Image arguments, native tool output and history          | [Image tools](../../apps/docs/content/docs/llm-sdk/tool-images.mdx)            |
| TTS, STT and reviewable microphone input                 | [Audio](../../apps/docs/content/docs/llm-sdk/audio.mdx)                        |
| Native Decisions and direct-provider test limitations    | [Decisions](../../apps/docs/content/docs/llm-sdk/decisions.mdx)                |
| Realtime setup, permissions and lifecycle                | [Realtime](../../apps/docs/content/docs/llm-sdk/realtime.mdx)                  |
| Image generation and editing                             | [Images](../../apps/docs/content/docs/llm-sdk/image-generation.mdx)            |
| Each manual test, expected results and deployment status | [Feature Lab](../../apps/docs/content/docs/feature-lab.mdx)                    |

The LLM sidebar and overview expose all guides. Provider, server, generation,
tool and playground pages cross-link the relevant contracts. Package docs no
longer describe implemented realtime/image work as unimplemented. The hotfix
release record now reflects the separately published artifact and its isolated
validation counts, rather than the larger next-beta suite.

In `yourgpt-docs`, `content/chatbot/developer-guide/getting-started/sdks.mdx`
links to the dedicated SDK site and explains release availability.
`content/chatbot/developer-guide/widget/ai-copilot.mdx` explicitly identifies the
hosted widget and its Agent Mode requirement, avoiding confusion with the
standalone Copilot SDK.

## Validation

- Queried npm: LLM `beta` is `2.6.0-beta.3`, `latest` is `2.5.1-beta.1`;
  Copilot `beta` is `2.5.1-beta.3`, `latest` is `2.5.0`.
- Checked new examples against the local SDK contracts and published-hotfix
  source. Eight complete TypeScript examples compiled without executing calls.
- Both documentation production builds passed, including MDX compilation and
  application type checking. All six new guide routes were generated.
- Checked 21 internal links in new guides and both modified navigation files;
  no missing targets. `git diff --check` passed in both repositories.
- Reused the recorded live-provider evidence in the
  [Feature Lab verification](2026-10-17-feature-lab.md); documentation changes
  did not rerun or claim new live API tests.

Build logs are retained locally, outside the repository. Registry values are a dated snapshot, not an
automatic guarantee about future tags. OpenAI conversation-state and speech
references were rechecked against the official documentation; implementation
and Vercel research pins remain in the existing feature plans/package guides.

## Still pending

These changes are local. The docs sites and Feature Lab require deployment and
public-URL verification. Next-beta package versions, publication and production
rollout remain separate. Direct Jev/Cloudflare live access and physical voice
quality across browsers/devices remain unverified and are labeled accordingly.
