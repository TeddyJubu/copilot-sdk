# Combined production deployment candidate

Prepared on `codex/playground-revamp` from reconciliation commit
`73b0002dedf8ef6743703761c622206c6e370fb7`. This checkpoint adds deployment
configuration and verification to the combined SDK, examples, playground and docs.
It does not record a remote push, main merge, new deployment or npm publication.

## What is included

| Area                             | Included behavior                                                                                                                                                                                   | Evidence and limits                                                                                                                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parameters and fallback          | Model-aware sampling/token parameters, GPT-6 Luna handling, explicit fallback policy and provider-error classification                                                                              | 20 real parameter/fallback cases in the critical-provider audit; fixtures cover rejected parameters. Application `TRAINING_CONFLICT` policy is not changed.                                          |
| System prompts and compatibility | Anthropic system-message normalization/precedence, tolerant unusual system content, duplicate prevention, structured tool results, bounded Responses replay metadata and missing-tool-call handling | Automated compatibility regressions plus recorded live Anthropic and OpenAI checks. Prevents the earlier `[object Object]` conversion regression.                                                    |
| Native Decisions                 | `experimental_decide`, OpenAI, direct TypeSafe/Jev, OpenRouter/Jev and Cloudflare/Clef adapters; boolean, choice and score results                                                                  | Fresh OpenAI 3/3 and OpenRouter/Jev 2/2 cases passed at the combined baseline. Direct TypeSafe and Cloudflare have fixture coverage only. Jev is TypeSafe's model, not Java; no Java SDK was tested. |
| OpenAI Responses                 | Complete/stream paths, tools, stored/stateless continuation and ordered reasoning replay                                                                                                            | 12 recorded live cases; full provider Responses/MCP parity is not claimed.                                                                                                                           |
| Images in function calling       | Native image tool results for OpenAI/Anthropic; vision input can inform JSON tool arguments; persisted call/result history                                                                          | 18 live image-output and 4 image-input/tool-argument cases in the critical-provider audit. Tools receive JSON arguments, not an implicit binary image parameter.                                     |
| TTS and STT                      | OpenAI buffered speech generation and file transcription; browser recording/upload helper                                                                                                           | Recorded live audio checks and recorder/protocol tests. Physical microphone quality and every browser/device are not verified.                                                                       |
| Realtime voice                   | OpenAI GA WebRTC, ephemeral credentials, VAD/transcripts, mute/interruption, tool approval and connection cleanup                                                                                   | Real Chromium call with synthetic speech and incoming audio; protocol/React fixtures. Experimental; no telephone/SIP or other realtime provider claim.                                               |
| Image generation/editing         | OpenAI image generation, edits/masks, output-format controls, bounded downloads and cancellation                                                                                                    | Recorded real PNG generation and WebP edit plus fixture tests. Streaming previews and Responses-hosted image generation remain separate.                                                             |
| Reviewed PR fixes                | HTML rendering policy, code colors, tool registration/availability, cancellation and canonical tool history; OpenRouter reasoning completion/stream/replay                                          | 550 combined automated tests; earlier browser and real provider checks. These are reviewed adaptations, not wholesale merges of the original feature branches.                                       |
| Examples and playground          | Completed UI redesign, shared key settings, chat, ten feature/check views, media/realtime panels and documentation links                                                                            | Browser guide/navigation checks and 12 fixture feature/provider requests pass. The skills demo and other examples are included in the recorded 21-task workspace build.                              |
| Documentation                    | Matching SDK guides, system-prompt/upgrade guidance, feature availability, examples, source references and known limits                                                                             | Documentation production build and generated destination/heading checks pass. New source examples are distinguished from currently published npm exports.                                            |

Research and older live evidence are retained in the
[critical-provider audit](2026-10-17-critical-provider-audit.md),
[Decisions research plan](../plans/2026-10-17-next-beta.md),
[media report](2026-10-17-media-beta.md),
[reviewed PR report](../reviews/2026-10-17-ankush/README.md) and
[playground integration report](2026-10-17-playground-docs.md).
The 59-case critical-provider audit is historical evidence, not 59 new calls in
this deployment checkpoint. Synthetic classification cases establish selected
API behavior, not production guardrail accuracy or universal compatibility.

## Verified deployment configuration

Both Vercel projects connect to `YourGPT/copilot-sdk`, deploy production from
`main`, and currently use Node 24.x. The observed live production commit is
`70606f261cddcf455d1f7674f5b4ee1bc5b7039c` for both projects.

| Project              | Repository root       | Public destination                                | Observed current deployment        |
| -------------------- | --------------------- | ------------------------------------------------- | ---------------------------------- |
| `copilot-playground` | `examples/playground` | <https://copilot-sdk-wheat.vercel.app/playground> | `dpl_6zVqrY8jEMo94GSJS7ejuxL3s2hi` |
| `copilot-sdk-docs`   | `apps/docs`           | <https://copilot-sdk.yourgpt.ai/docs>             | `dpl_9QdzZmGfdHfdzNbXuSgYemJbySkz` |

The documentation site's `/playground` paths proxy to the playground project.
Its configured `PLAYGROUND_URL` is `https://copilot-sdk-wheat.vercel.app` for
production, preview and development. Both direct sites and the public docs proxy
returned HTTP 200 in Chromium. These were checks of the existing production
deployment, not the new candidate.

This checkpoint adds a `vercel.json` in each project root. Both use frozen pnpm
11.5.1 installation. Docs build through Turbo; playground builds both workspace
SDK packages before Next.js. Turbo caches `.next` output and hashes/passes
`PLAYGROUND_URL`. The default docs proxy URL now matches the public project
domain. The OpenRouter model-list route uses Node because its SDK provider bundle
imports Node modules; its earlier Edge build warning is gone.

These settings override the dashboard's old docs `npm install` / `npm run build`
commands, following [Vercel project configuration](https://vercel.com/docs/project-configuration/vercel-json)
and [Turborepo deployment guidance](https://vercel.com/docs/monorepos/turborepo).
The preview builds must still establish that Vercel executes them successfully.

The playground uses workspace SDK dependencies. A main merge deploys the source
in that commit; it does **not** wait for a new npm version. The two projects deploy
independently, so a merge is not an atomic switch of both sites. Preview docs also
point to the production playground unless their `PLAYGROUND_URL` is overridden;
test each new preview directly before merging.

## Validation at this checkpoint

- Frozen pnpm 11.5.1 installation passes on Node 24.22.0.
- Both exact deployment build commands pass on Node 24.22.0. The initial
  playground build exposed the Edge import warning; the final build is clear.
- 427 LLM tests and 123 Copilot/playground tests pass: **550 total, zero failures
  or skips**. The combined baseline also passed 550 tests on Node 22.23.3.
- The combined baseline passed all 21 uncached workspace builds, both SDK
  typechecks, CJS/ESM public declaration checks, workflow lint and dependency-age
  checks. No dependency versions changed in this checkpoint.
- On the final Node 24 production build, ten contextual guide destinations,
  heading anchors, mobile Docs and three chat guides pass with no page errors.
  Saved-key/dialog checks and twelve fixture feature/provider requests pass.
- The Node model-list route returns HTTP 200 and 34 matching Claude models from
  real OpenRouter data, without an API key. This is not a paid inference test.
- Feature Lab reports `localCredentials: false` in production mode. No shared
  provider API-key environment variables are configured on the Vercel playground
  project. Keep them unset: the legacy chat example routes still support server
  environment credentials, unlike Feature Lab's local-only credential fallback.
- Both package tarballs were created locally and inspected: all declared export
  targets and licenses exist; no `.env`, `.env.local`, `.npmrc` or credentials
  store files are included. This is packaging inspection, not npm publication.
- SDK runtime source is unchanged from the tested next-beta/UI baseline by the
  reconciliation and this deployment checkpoint.

See [sanitized checkpoint evidence](2026-10-17-production-readiness.json).
Local commands reproduce deployment builds from their corresponding app roots:

```sh
cd ../..
npx --yes pnpm@11.5.1 install --frozen-lockfile
npx --yes pnpm@11.5.1 exec turbo run build --filter=@yourgpt/copilot-sdk-docs
npx --yes pnpm@11.5.1 exec turbo run build --filter=playground...
node --test packages/llm-sdk/test/*.test.cjs test/*.test.cjs
```

## Merge and deployment checklist

1. Obtain fresh authorization to push this branch and create the combined PR to
   `main`. It includes #130's production candidate ancestry; #130 is not a second
   required merge. Keep the original PR available until the combined PR is settled.
2. Require green GitHub CI and both Vercel previews for the final pushed commit.
   Check the preview build logs for pinned pnpm and workspace SDK build ordering.
   Inspect both preview domains directly; absolute documentation links target the
   production domain and cannot prove the new preview documentation is deployed.
3. Obtain the required independent approving review. The effective `main` ruleset
   requires one approval, dismisses stale reviews on push and requires approval of
   the latest push by someone other than its pusher. Once approved, anyone with
   merge permission may merge; do not bypass protection. Obtain fresh merge
   authorization when the exact combined PR is ready.
4. Merge into `main`, then verify **both** production deployment records are
   `READY` and identify the resulting main merge commit. Check the public docs,
   direct playground and docs `/playground` proxy again. Check assets, navigation,
   browser errors and API routes; a green GitHub merge alone is insufficient.
5. Run the post-deployment checks below using caller-owned keys. Record the two
   deployment URLs/IDs, merge commit, test results and any failing scenarios.
6. Separately confirm exact package versions and npm tags. The manifests currently
   contain prepared `2.6.0` values for both SDKs; they are not approval to publish.
   The combined release workflow is manual (`workflow_dispatch`, `publish: false`
   by default), so merging this candidate does not publish npm packages.
7. After authorized publication, verify registry versions/tags and run a clean
   consumer install against those exact versions. Check documented imports,
   CJS/ESM/types and representative provider flows, then update publication notes.

If one website fails after merge, preserve its logs and deployment ID and decide
whether to fix forward or restore its previously verified production deployment.
The previous IDs are above; a rollback is a separate authorized action. Do not
reset or force-push main as a deployment workaround.

### Post-deployment feature checks

| View / flow            | Check on the deployed commit                                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parameters / fallback  | GPT-6 Luna normal request succeeds; explicit invalid-parameter case follows configured fallback without duplicate tool execution.                                   |
| System prompt          | Both supported prompt entry points produce intended behavior; duplicate/unusual system content and structured tool results retain tested behavior.                  |
| Decisions              | OpenAI and OpenRouter/Jev boolean/choice/score cases succeed; missing direct-provider credentials are reported rather than claimed tested.                          |
| Responses              | Stream and complete, tool call/result ordering, second turn and saved-history continuation work; raw provider output/usage is not smuggled through replay metadata. |
| Tool images            | OpenAI and Anthropic can interpret an image tool result; each handler executes once; continuation remains valid.                                                    |
| Speech / transcription | Generate playable speech; upload it and obtain a transcript; clear missing-key/error feedback and cancellation.                                                     |
| Realtime               | Explicit connect, mic permission, transcript/audio, tool approval, mute, interrupt and disconnect; verify browser tracks are released.                              |
| Image generation/edit  | View generated output and complete a small edit; cancellation and invalid-input feedback work.                                                                      |
| Chat / reviewed fixes  | Ordinary chat/tools, cancellation followed by a new turn, dynamic tool availability, HTML modes and code colors.                                                    |
| Docs / keys / mobile   | All contextual guides and anchors, responsive navigation, caller-key reuse and header transport; no shared provider keys added to Vercel.                           |

## Pending scope

- Direct TypeSafe/Jev and Cloudflare account testing needs their credentials.
- Physical microphone/speaker quality, Safari/Firefox/mobile coverage and
  production latency evaluation remain pending; realtime stays experimental.
- Native Decisions box questions, broader conversation/cache controls and hosted
  URL inputs in the common SDK interface are not implemented. Follow the documented
  per-provider image support; do not assume Vercel feature parity.
- Full hosted MCP/Responses parity, hosted lossless reasoning replay and
  single-turn presentation/history reconciliation remain separate work.
- #110, #92 and parts of #88 have adapted fixes here; #98 is superseded. The
  original PRs have not all been merged or approved. #78, #99 and #94 retain the
  blockers recorded in the PR audits. The #88 GenUI sandbox patch is a review
  artifact, not an integrated GenUI implementation.
- Separate changes in `yourgpt-docs` and `yourgpt-core-apis` are not in this
  repository or this deployment. Downstream applications do not automatically
  upgrade their npm dependency when this repository's main branch changes.

The currently observed npm tags remain LLM `latest: 2.5.1-beta.1`,
`beta: 2.6.0-beta.3`; Copilot `latest: 2.5.0`, `beta: 2.5.1-beta.3`.
Do not equate the combined source with those published package contents.
