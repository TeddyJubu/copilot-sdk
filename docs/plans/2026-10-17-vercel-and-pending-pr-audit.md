# Vercel parity and pending Copilot PR audit

Checked on 17 October 2026 against local SDK commit `40fc00d`, the current
documentation edits, GitHub PR heads/comments/checks, and current Vercel source.
This is a source/issue audit, not approval to merge or a new release.

## Reference freshness

- GitHub's current `vercel/ai` main is
  [`fce9210c6405c0ad8452fee3f50717e8ea910b97`](https://github.com/vercel/ai/tree/fce9210c6405c0ad8452fee3f50717e8ea910b97),
  dated 16 October. The latest core release checked is
  [`ai@7.0.143`](https://github.com/vercel/ai/releases/tag/ai%407.0.143).
- Downloaded six changelogs from that exact GitHub commit and compared them
  byte-for-byte with the research snapshot. All match: core `7.0.143`, OpenAI
  `4.0.96`, Anthropic `4.0.82`, Google `4.0.99`, MCP `2.0.78`, TypeSafe `3.0.21`.
- The saved competitor directories are older: `competitors/ai-main` contains
  core `6.0.3`; `competitors/vercel-ai` contains `7.0.0-canary.124`. Those were
  not used as the current feature baseline.
- Remote Copilot `beta` remains `321bef0`. The next-beta implementation is local,
  and the separately published LLM `2.6.0-beta.3` hotfix still needs source
  integration into remote beta. npm publication and Git branch state differ.

## Already covered

Do not reopen these as wholly missing: model-aware OpenAI parameters and narrow
compatibility fallback; explicit Responses selection and stored/stateless replay;
OpenAI/Anthropic image tool output; Anthropic system instructions; TTS and
recorded-file STT. Native Decisions, OpenAI WebRTC voice, image generation/editing
and the Feature Lab are implemented on the next-beta branch but unpublished.

OpenAI and OpenRouter Decisions passed live checks. Direct TypeSafe/Jev and
Cloudflare are implemented with fixtures but lack live credential validation.
Realtime was tested with a real provider connection and synthetic audio; physical
devices and wider browsers remain separate validation. See the
[Feature Lab evidence](../releases/2026-10-17-feature-lab.md).

## Highest-priority remaining capabilities

These priorities are recommendations based on our code and use cases, rather
than an instruction to copy every upstream feature.

| Priority | Gap in our SDK                                                                                                                                       | Current Vercel/provider evidence                                                                                                                                                                                                                             | Existing issue                                                                                                                      |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Correct Anthropic cached-input accounting; expose normalized cache reads/writes, then add model-aware cache controls across providers                | [Vercel usage conversion](https://github.com/vercel/ai/blob/fce9210c6405c0ad8452fee3f50717e8ea910b97/packages/anthropic/src/convert-anthropic-usage.ts), [Claude caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)              | [#104](https://github.com/YourGPT/copilot-sdk/issues/104), [#114](https://github.com/YourGPT/copilot-sdk/issues/114)                |
| P1       | Complete Anthropic reasoning: adaptive/budget controls, signed/redacted replay, and consistent modern/Runtime behavior                               | [Anthropic changelog](https://github.com/vercel/ai/blob/fce9210c6405c0ad8452fee3f50717e8ea910b97/packages/anthropic/CHANGELOG.md), including preserved thinking, tool-choice compatibility and signed compaction                                             | [#118](https://github.com/YourGPT/copilot-sdk/issues/118), [#113](https://github.com/YourGPT/copilot-sdk/issues/113)                |
| P1       | Provider-hosted MCP, approvals and provider-executed tool lifecycle; normalized sources/citations; ordered additional tools                          | [OpenAI 4.0.96/4.0.92 changelog](https://github.com/vercel/ai/blob/fce9210c6405c0ad8452fee3f50717e8ea910b97/packages/openai/CHANGELOG.md); Anthropic 4.0.79 citation changes                                                                                 | [#119](https://github.com/YourGPT/copilot-sdk/issues/119), useful portions of [#99](https://github.com/YourGPT/copilot-sdk/pull/99) |
| P1       | Modern Google transport, native Interactions, thought-signature replay and native multimodal behavior                                                | [Google changelog](https://github.com/vercel/ai/blob/fce9210c6405c0ad8452fee3f50717e8ea910b97/packages/google/CHANGELOG.md), [official Interactions guide](https://ai.google.dev/gemini-api/docs/interactions-overview)                                      | [#117](https://github.com/YourGPT/copilot-sdk/issues/117)                                                                           |
| P1       | Typed, validated structured output with partial-object/array streaming, plus Anthropic tool-based fallback where native schema output is unavailable | [Current structured-output guide](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data), [Anthropic implementation](https://github.com/vercel/ai/blob/fce9210c6405c0ad8452fee3f50717e8ea910b97/packages/anthropic/src/anthropic-language-model.ts) | [#97](https://github.com/YourGPT/copilot-sdk/issues/97), [#96](https://github.com/YourGPT/copilot-sdk/issues/96)                    |

### Cached usage defect reproduced in this audit

An offline transport fixture exercised the actual built `AnthropicAdapter` in
complete and streaming modes. Provider usage was 100 uncached input tokens,
200 cache-write tokens, 300 cache-read tokens and 10 output tokens. Expected
total input was **600**. Both paths reported **100** input and **110** total.
This is a confirmed remaining accounting bug, not a failed live API call.

Source: `packages/llm-sdk/src/adapters/anthropic.ts` maps only `input_tokens`;
the modern Anthropic provider does the same. The common token contract still
has only aggregate prompt/completion/total counts. OpenAI Responses cache options
and raw usage already exist, so #114 is partly implemented. Do not apply the
Anthropic addition formula blindly to providers whose input totals already
include cached tokens. Cost calculations also require the separate read/write
categories, not just a corrected total.

### Structured-output RFC needs a direction update

Issue #97 describes separate `generateObject`/`streamObject` functions as current
Vercel direction. Current Vercel instead recommends `generateText`/`streamText`
with `output: Output.object(...)`, validated final results, partial output and
array-element streams. Its old functions are explicitly deprecated in
[generateObject source](https://github.com/vercel/ai/blob/fce9210c6405c0ad8452fee3f50717e8ea910b97/packages/ai/src/generate-object/generate-object.ts)
and [streamObject source](https://github.com/vercel/ai/blob/fce9210c6405c0ad8452fee3f50717e8ea910b97/packages/ai/src/generate-object/stream-object.ts).
Keep our existing `responseFormat` compatible while designing the typed layer;
do not implement the old RFC wording without revising it.

## Other relevant gaps

| Capability                                      | What exists here / what remains                                                                                                                                                                                                                                                    |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider-native compaction and durable state    | Application summarization exists. Native OpenAI compaction, Anthropic signed compaction and durable remote-state lifecycle remain [#120](https://github.com/YourGPT/copilot-sdk/issues/120). Hosted YourGPT storage does not yet guarantee lossless Responses replay after reload. |
| Low-memory streaming                            | Our shared stream intentionally retains parts for multiple readers. Vercel `7.0.143` adds opt-in single-consumer `experimental_lowMemory`. An equivalent bounded-memory mode is absent; keep existing replay behavior as the default.                                              |
| Resumable chat transport                        | Vercel `7.0.135` adds persistent WebSocket chat with sequence-based resume; later releases repair replay, approval and lifecycle behavior. Our SSE and saved history are not an equivalent resumable transport.                                                                    |
| Configurable local tool concurrency             | Vercel `7.0.140` adds a concurrency limit. Our native `parallelCalls` setting is not a general bounded local-executor scheduler. Concurrent chat threads in PR #94 are a different capability.                                                                                     |
| Richer Decisions                                | Common boolean/choice/score and native image input are implemented. TypeSafe `box` questions added in core `7.0.143` / TypeSafe `3.0.21` are absent. Ordered mixed state and richer image-reference parity need a separate contract decision.                                      |
| More audio/media providers                      | Current speech, transcription, realtime and generated-image implementations are OpenAI-first. Google audio response modalities, native speech/Live integration, incremental transcription and streaming audio remain broader work.                                                 |
| Partial/generated image events inside Responses | Standalone generation/editing works. Streaming image previews and the provider-hosted Responses image tool are not covered by that helper.                                                                                                                                         |
| Wider SDK surface                               | No matching top-level embedding/reranking, batch, translation, video or durable workflow API was found in the inspected exports. These are discovery items, not prerequisites for shipping the requested next-beta scope.                                                          |

Core release details above come from the
[pinned core changelog](https://github.com/vercel/ai/blob/fce9210c6405c0ad8452fee3f50717e8ea910b97/packages/ai/CHANGELOG.md).
These changes are a mix of existing upstream capabilities and recent additions;
they are not all new October features.

## All seven open PRs

Five are authored by Ankush. Four target beta. No submitted formal reviews or
inline review comments were returned; #110 has substantial issue-comment review
discussion. GitHub mergeability below is against each PR's remote target branch,
not a guarantee against our unpublished next-beta work.

| PR / author                                                                                          | Head / base                                    | Assessment and next action                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#110](https://github.com/YourGPT/copilot-sdk/pull/110) — Ankush, HTML/code rendering                | `6f17c8e` → `beta`; mergeable, checks unstable | First review candidate. Current source includes handler-based literal HTML, policy remount, same-length edit fix, default/compound chat forwarding, CSS changes and docs. No new code blocker established here. Add actual component regression coverage, update stale PR description, authorize previews and test the final head. |
| [#99](https://github.com/YourGPT/copilot-sdk/pull/99) — Sahil, hosted MCP/reasoning/response wrapper | `9938f21` → `beta`; conflicting                | Its basic Responses/reasoning work overlaps our implementation. Salvage unique hosted MCP/Anthropic work into the current contracts. Advertised modern-provider options are not consumed by `providers/*/provider.ts`; existing May previews do not certify today's branch. Do not merge wholesale.                                |
| [#98](https://github.com/YourGPT/copilot-sdk/pull/98) — Ankush, original Responses implementation    | `71d6213` → `beta`; mechanically mergeable     | #99 explicitly supersedes it. Source still promotes user input to `developer` and contains request-shape/token-budget problems documented in #112. Do not merge as-is; reconcile unique scope and propose closure as superseded.                                                                                                   |
| [#94](https://github.com/YourGPT/copilot-sdk/pull/94) — Gourav, concurrent threads/post-tool text    | `fe57417` → `beta`; mechanically mergeable     | Shared-tool reference-count bug remains at the same head. New threads seed each tool once; every unmount decrements all instances, dropping a still-registered tool from later threads. Fix it, document scope and add thread/approval/cancellation/post-tool-text regressions before merging.                                     |
| [#92](https://github.com/YourGPT/copilot-sdk/pull/92) — Ankush, reasoning/OpenRouter                 | `1d0e08d` → `release/alpha`                    | Outside beta queue; actual diff spans 191 files and exceeds GitHub's diff limit. Source has overlap with current OpenAI work and potentially unique OpenRouter work. Inventory/targeted review only; not exhaustively reviewed or approved. Extract any needed behavior rather than porting this whole branch.                     |
| [#88](https://github.com/YourGPT/copilot-sdk/pull/88) — Ankush, stream/UI fixes                      | `4128769` → `feat/generative-ui-v2`            | Broader than its title: stream mode, GenUI styling, hook changes and server-system-prompt precedence. The latter makes server defaults override request prompts, unlike our current documented contract. Review and split needed fixes; do not silently import that precedence change.                                             |
| [#78](https://github.com/YourGPT/copilot-sdk/pull/78) — Ankush, single-stream                        | `8790f9a` → `feat/stream-mode`                 | Small single-turn config/reconciliation patch; overlaps the stream-mode work in #88. Current beta lacks that complete public mode. Evaluate together rather than merging both independently.                                                                                                                                       |

The six unstable PRs have Vercel **contributor authorization** failures. Their
status is not evidence of a compiler failure. #99 has successful previews from
May. None of these heads has a fresh green current-beta regression run recorded
in its checks. Beta CI is now enabled in `.github/workflows/ci.yml`, so the old
claim in #112 that CI only targets main is stale.

Ankush's [latest substantive #110 reply](https://github.com/YourGPT/copilot-sdk/pull/110#issuecomment-5698666693)
explicitly leaves regression tests and Vercel authorization pending. His
[later comment](https://github.com/YourGPT/copilot-sdk/pull/110#issuecomment-5709397610)
and current diff confirm documentation was subsequently added. The body still
describes the older remark-plugin implementation; don't repeat that as the
implementation at the current head.

Fetched each PR head for read-only comparison. No head is an ancestor of the
current local branch, and `git cherry` found no exact patch-equivalent commits.
That does **not** rule out substantial semantic overlap. The earlier
[PR audit #112](https://github.com/YourGPT/copilot-sdk/issues/112) contains focused
probes for #98 and #94; their head SHAs and offending code remain unchanged.
This turn did not build or run every PR head and does not claim merge readiness.

## Reconcile the 30 open issues

| Issues                                             | Actual state / proposed disposition                                                                                                                                                                                                                         |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #111, #112                                         | Keep roadmap/reconciliation open; update dated release statements and the now-completed beta-CI item after review.                                                                                                                                          |
| #122, #123, #124, #125                             | Main requested slices shipped: parameters/fallback, image tools, TTS, recorded STT. Reconcile acceptance and close or split residual provider/browser scope; do not rebuild them.                                                                           |
| #115                                               | Core Responses/replay slice shipped. Keep broader native-tool/provider parity separate rather than treating Responses as absent.                                                                                                                            |
| #116, #126                                         | Decisions and realtime implemented locally; wait for next-beta integration/publication. Direct Jev/Cloudflare and physical audio remain validation gaps.                                                                                                    |
| #121                                               | Selected release tests passed and regressions were added. Production/device/storage/application-policy gates remain; distinguish them from completed beta gates.                                                                                            |
| #104, #113, #114, #117, #118, #119, #120, #96, #97 | Real remaining provider/API work; priorities and direction corrections are above.                                                                                                                                                                           |
| #74 — Ankush                                       | Custom message-type renderer registry remains absent. `renderMessage`/`messageView` customization exists but is not the proposed registration API. Keep the request, with a separate typed presentation discriminator rather than arbitrary provider roles. |
| #66 — Ankush                                       | Branching, regenerate/switch operations and message-action components already exist. Compare each acceptance item and persistence behavior before closing; this is not wholly unimplemented.                                                                |
| #76                                                | Fallback plus priority/round-robin routing already exists. Reconcile remaining acceptance and close/split stale scope.                                                                                                                                      |
| #81, #82                                           | Duplicate TogetherAI requests. Native provider exists; separate any real batch/enterprise scope from the already-built provider.                                                                                                                            |
| #67, #69, #70, #72                                 | #72 explicitly consolidates the other three. Tool profiles, search, budgets and result controls have implementation; audit acceptance gaps rather than create duplicate features.                                                                           |
| #68, #71                                           | History strategies, summarization and budget structures exist. Verify runtime enforcement and remaining acceptance; keep native provider compaction tracked in #120.                                                                                        |

No issue or PR was closed, edited, commented on, approved or merged. No branch
was pushed. Existing documentation edits were preserved. Detailed snapshots and
the fresh cache-accounting fixture are retained locally, outside the repository.

## Recommended sequence

1. Fix #104 accounting and validate the missing cache cases; preserve a clear
   distinction between aggregate tokens, cache categories and monetary cost.
2. Integrate the already-published hotfix source, then finish #110's regression
   and preview validation. Review #94 only after its concrete registry defect is fixed.
3. Prepare the existing next-beta implementation and docs for the approved Git
   and npm release steps, retaining the explicit live-test limitations.
4. Use existing #118/#119/#117/#97/#96 for the next provider work. Re-scope #99's
   useful additions against today's implementation and retire superseded work
   only after an explicit disposition decision.
