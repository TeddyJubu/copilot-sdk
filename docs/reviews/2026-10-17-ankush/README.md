# Ankush PR verification and compatibility fixes

17 October 2026. Reviewed the five open Ankush PRs at the exact heads recorded in
[evidence.json](./evidence.json). Work is isolated on
`codex/ankush-pr-compatibility`, based on feature commit `40fc00d`. No development
branch was imported. No PR was approved, merged, closed or edited, and nothing was
pushed or published. The original checkout and its documentation edits are intact.

## Conclusion

All five PRs address legitimate bugs or feature needs. That does **not** make all
five implementations safe to merge. Several include outdated implementations,
inherited feature branches, or failures that a successful build alone misses.
The current branch contains the compatible fixes below; the GenUI fix is supplied
as a separate tested patch because that experimental renderer is absent from the
current beta base. Single-turn aggregation and hosted MCP remain withheld.

| PR                                                      | Exact head | Tests and findings                                                                                                                                                                                                                                                                                                                | Disposition                                                                                                                                                                                                                                                    |
| ------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#110](https://github.com/YourGPT/copilot-sdk/pull/110) | `6f17c8e`  | Copilot build succeeds. Actual Chromium tests confirm literal HTML, GFM, policy switches, compound/default layouts and code-color fixes. Same-length **inline** HTML remains stale on the PR. Its default changes existing HTML rendering.                                                                                        | Adapted the useful changes, fixed stale inline edits, kept sanitized `render` as the default; `literal` is opt-in. This adaptation is ready for review, not an approval of the original head.                                                                  |
| [#98](https://github.com/YourGPT/copilot-sdk/pull/98)   | `71d6213`  | LLM build succeeds, but four request-contract probes fail: prompt becomes `developer`, `maxTokens` is lost, Anthropic thinking budget exceeds output budget, and the structured-output schema is nested incorrectly.                                                                                                              | Superseded. Retain the newer tested Responses path. Do not introduce the old `runtime.response()` wrapper. Hosted MCP remains separate work.                                                                                                                   |
| [#92](https://github.com/YourGPT/copilot-sdk/pull/92)   | `1d0e08d`  | LLM build succeeds. Public streaming drops its `thinking:*` events; settings differ between complete/stream; opaque replay is missing. Interleaved tool arguments, image URL formatting and abort propagation also fail focused probes.                                                                                           | Extracted modern OpenRouter reasoning support using current contracts, preserving default transport and model defaults. Do not import the 191-file alpha diff wholesale.                                                                                       |
| [#88](https://github.com/YourGPT/copilot-sdk/pull/88)   | `4128769`  | LLM build succeeds. Copilot declaration build fails because `@streamdown/math` is missing from the installed dependency baseline. Both prompt-precedence probes fail. Its cancellation fix drops the result, leaving an incomplete conversation. Its inherited GenUI iframe permits generated code to access the parent document. | Adapted cancellation and hook fixes without changing prompt precedence. Supplied and browser-tested a separate GenUI sandbox patch. Math/dependency integration, GenUI adoption, and single-turn behavior still require reconciliation on their target branch. |
| [#78](https://github.com/YourGPT/copilot-sdk/pull/78)   | `8790f9a`  | Copilot build succeeds. Default replay can duplicate assistant content; single-turn replay sends an orphan tool result before the assistant call.                                                                                                                                                                                 | Do not merge. Keep canonical message history and redesign aggregation as presentation behavior. No public single-turn mode has been added to this branch.                                                                                                      |

The original-head test harnesses also expose inherited baseline problems; a test
failure is not automatically attributed to that PR's author. For example, #110's
hook-availability failure is inherited, while the PR-specific inline HTML bug is
in its new literal-rendering behavior. #92's author-specific changes after #88
span five files; the much larger inherited alpha diff was inventoried, not
certified through exhaustive end-to-end testing.

## Changes prepared on this branch

1. HTML policy through `Markdown`, `MessageContent`, normal chat and
   `Chat.MessageList`. Existing sanitized HTML stays the default. Literal mode
   preserves snippets, including scripts as text. Both block and inline
   same-length edits update. Fenced code, GFM and sanitization remain covered.
2. Code-block CSS accepts complete color tokens, respects consumer variables,
   and switches actual highlighted tokens between light and dark mode.
3. `useTools` refreshes registration when availability changes and invokes the
   latest handler. The provider's `registeredTools` updates when registrations
   change, instead of waiting for a tool execution.
4. Stopping during the render yield or a running tool does not restart the
   request. Pending calls receive cancellation results before another user turn
   starts. Late handlers cannot overwrite/resume a newer turn. Cancellation
   bypasses success-only model-output mappers.
5. Ordinary streamed server-tool results now retain the assistant call needed
   for replay. Previously that was done only for image `modelOutput`. Hidden-tool
   flags survive completion. Regression tests check outbound ordering and data.
6. Modern `openrouter()` accepts optional reasoning controls; returns optional
   `reasoningText`; exposes typed `reasoning-delta` parts; retains ordered opaque
   reasoning state for continuation. It handles parallel argument deltas,
   trailing usage chunks, HTTP image URLs, and abort signals. It does not inject
   an 8,000-token budget or automatically switch endpoints.
7. OpenRouter replay includes only documented reasoning-state fields, not raw
   provider output or usage. Text/summary fragments concatenate; signatures and
   encrypted blocks remain opaque. Repeated indices do not overwrite distinct
   blocks. The normal text stream remains answer-only.

The reasoning option is on the modern factory, not the legacy Runtime factory.
Consumers that exhaustively switch on `fullStream` event types should handle the
new `reasoning-delta` variant. This is an additive beta API change, not a promise
that every possible downstream TypeScript switch compiles unchanged.

The [GenUI patch](./pr88-genui-sandbox.patch) removes `allow-same-origin` from the
script-enabled sandbox and accepts child-frame messages only from its parent.
In a fresh Chromium context, a synthetic generated script could mutate the parent
before the patch and could not afterward. The postMessage bridge and resolved
chart colors still worked. No user page, cookies or real browser keys were used.
This is a focused boundary test, not a complete security certification.

## Verification

- Both SDK production builds and both full TypeScript checks pass.
- Public CJS/ESM declaration-consumer checks pass.
- **550 automated tests pass on Node 26.7.0.**
- **536 SDK/Copilot tests pass on Node 18.20.8.** The remaining 14 tests exercise
  the playground, whose runtime requires newer Node.
- **11 Chromium regression checks pass** on the prepared branch, including actual
  light/dark highlighted-token colors and both chat layouts.
- **2 separate GenUI checks pass** against the patched #88 renderer.
- The documentation production build passes.
- Existing raw structured-tool-content, unusual Anthropic system content,
  Responses diagnostics/replay isolation, malformed-call fallback and omitted
  tool-call regressions remain in the passing SDK suite. This specifically
  protects against the earlier `[object Object]` regression.
- Six live checks passed using existing local OpenAI, Anthropic and OpenRouter
  credentials: reasoning completion, reasoning stream/continuation, reasoning
  tool execution with signed continuation, OpenAI Responses tool history, and
  Anthropic request-system precedence in complete/stream modes.
- After the final reasoning replay changes, the three OpenRouter live checks
  were repeated and passed, including a real tool invocation and second model
  response. Credentials were loaded only into the provider test process; none
  were copied into this branch or printed.

One **initial** Anthropic streaming output assertion failed. Its exact text was
not retained in that first attempt, so the cause is not established. A diagnostic
repeat and the complete final six-check run passed. This is retained in the
[evidence](./evidence.json), rather than reporting every live attempt as green.

Original-head builds used the shared installed workspace dependency baseline,
not five independently reinstalled historical dependency trees. A lockfile-only
#88 check prompted for module-directory replacement and did not establish a clean
install result; it was not forced. Vercel preview authorization still needs
resolution before any GitHub merge.

## Comparison with upstream

- [Vercel tool usage](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage): typed
  tool parts, explicit tool output and approvals. A single visual message does
  not justify losing the model's call/result ordering.
- [OpenRouter's Vercel provider](https://github.com/OpenRouterTeam/ai-sdk-provider/blob/1b22b05352cb0f9243a6c3fdd326038dd3705544/src/chat/index.ts): verified its handling
  of reasoning events and ordered reasoning-detail replay. In particular,
  repeated indices are not a safe identity for encrypted reasoning blocks.
- [OpenRouter reasoning controls](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens): optional reasoning settings, model-specific support and
  output-budget accounting. Defaults must not silently enable a fixed budget.
- [Claude structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs): the schema belongs directly under
  `output_config.format.schema`, confirming #98's payload defect.
- [Streamdown security](https://streamdown.ai/docs/security): retained the existing
  sanitized rendering path; literal rendering is an explicit alternative.

Current Vercel core reference remains `ai@7.0.143`, pinned source
`fce9210c6405c0ad8452fee3f50717e8ea910b97`. The older saved competitor clones were
not treated as the latest implementation.

## Remaining work before merging these PRs

1. Review the prepared compatibility changes against the feature integration base.
2. Integrate the sandbox patch only with the GenUI feature and its dependency work.
3. Reimplement single-turn presentation while preserving canonical history,
   branching, approvals, cancellation and persistence. #78/#88 remain blocked.
4. Re-scope hosted MCP from #99/#98 with the current provider contracts; do not
   bring back the superseded Responses wrapper.
5. Resolve preview authorization and test the actual reconciled GitHub heads.
   The separate #94 shared-tool counting defect and #99 conflict from the earlier
   audit are unchanged; those are not Ankush-authored PRs and were not fixed here.

Reproduction commands live in `test/pr-compatibility.test.cjs`,
`test/browser/pr-compatibility.cjs`, `test/review/`, and the two new LLM test files.
Detailed logs and exact-head snapshots are retained locally, outside the
repository. This review establishes concrete fixes and
merge blockers; it does not certify all historical feature-branch code or all
provider/model/browser combinations.
