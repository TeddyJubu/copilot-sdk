# Production candidate: both SDKs 2.6.0, npm publication deferred

Prepared on 17 October 2026 on `codex/production-release`. This is a source and
package-validation record, not a publication receipt. The user requested a
production PR now and npm releases later. No production merge, workflow dispatch
or npm publish is included in this preparation.

## Package targets

| Package                | Verified published beta | Prepared stable version | Proposed future tag |
| ---------------------- | ----------------------- | ----------------------- | ------------------- |
| `@yourgpt/llm-sdk`     | `2.6.0-beta.3`          | `2.6.0`                 | `latest`            |
| `@yourgpt/copilot-sdk` | `2.5.1-beta.3`          | `2.6.0`                 | `latest`            |

These are the existing candidate versions, not a new authorization to publish.
Confirm the exact versions and tags again at the later publication step. No
scaffolder or unrelated package version changes. SDK consumer engines remain
Node.js 18 or newer.

## Source and included fixes

Both SDK runtime source trees match `origin/beta` at `bde8e04`, the merged PR #129
source. The hotfix was carried into the existing candidate while retaining its
prepared stable versions. The original hotfix and publication-record commits are
referenced in the new commits for traceability.

The candidate includes reasoning parameters/fallback, Anthropic system-message
preservation, Responses continuation, image tool results, buffered OpenAI TTS/STT,
and recorded voice input. It also includes the beta.3 structured-tool-content,
Anthropic tolerance/deduplication, Responses continuation-privacy,
malformed-tool-call fallback and optional-tool-call fixes.

Native Decisions, experimental realtime voice, image generation/editing, Feature
Lab, and the later Ankush/UI adaptations remain on the separate next-beta branch.
They are not included in this production promotion.

The upgrade, beta, system-prompt, provider and server-response guides now describe
the beta.3 behavior. Until stable publication, their upgrade instructions identify
the available beta versions rather than claiming 2.6.0 is already on npm.

## Toolchain and release workflow

The candidate retains main's seven-day dependency cooldown and dependency-age
check. Its existing pnpm 11.5.1 upgrade required two corrections found during a
fresh frozen install: the old build-script allowlist was ignored, and CI selected
Node 20. The same six approved build packages now use `allowBuilds`, and the
private workspace/CI use Node 22+. Package consumer requirements do not change.
The CI bootstrap uses pnpm's standalone distribution before setting up Node 22
and its pnpm cache. No dependency versions or lockfile entries were changed.

The Release workflow is now manual-only (`workflow_dispatch`), guarded to `main`
and an explicit Boolean `publish` input whose default is false. Merging this PR
will run CI/deployments but will not dispatch npm publishing. The workflow is not
run as a test: its publish action remains deferred.

References: [pnpm 11 migration](https://pnpm.io/blog/releases/11.0),
[pnpm action bootstrap](https://github.com/pnpm/action-setup/tree/v4), and
[GitHub manual workflow inputs](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch).

## Fresh validation

- Frozen installation succeeds with pnpm 11.5.1 and the corrected allowlist.
- 371 automated tests pass on Node 22.23.3, with no failures or skips.
- All 21 workspace builds pass on both Node 26.7.0 and Node 22.23.3, including docs
  and examples. The Node 22 run bypassed the build cache.
- Both SDK full TypeScript checks and public CJS/ESM declaration checks pass.
- `actionlint` passes for the workflows. No workflow was dispatched.
- The dependency-age gate reports no new dependency versions in the lockfile.
- Both locally packed candidates contain their license and every public export
  target, and contain no `.env` or `.npmrc` files.
- Fresh npm downloads of the two published betas were compared to the candidates:
  all 303 distributed runtime files match byte-for-byte (62 LLM + 241 Copilot).
  Each package manifest differs only in `version`.

Install, build, test, typecheck and dependency-age logs are retained locally.
Candidate archives and downloaded comparisons are retained outside the repository.

The isolated beta.3 release's earlier Node 18/26 tests, 22 live provider checks,
41 packed-consumer regressions and 13 public entry-point imports remain recorded
in [the hotfix report](2026-10-17-beta-compatibility-hotfix.md). Those live calls were
not repeated for this promotion because its runtime files are identical. Physical
microphone coverage, hosted lossless replay, application guardrail evaluation and
the separate Core API response-filter deployment retain their existing limits.

## Delivery path

1. Review the exact candidate and confirm the production-branch push. PR creation
   is requested by the user; the push still requires its own confirmation.
2. Open the PR to `main` and wait for CI, deployment checks and external review.
   Main requires one approving review and approval from someone other than the
   last pusher. Do not bypass those rules.
3. Obtain a separate confirmation before merging the production PR. npm remains
   deferred even after that merge because publication no longer runs on push.
4. At the later release step, recheck npm tags and package contents, confirm exact
   package versions/tags, then publish the approved packages and verify archives.

Preparing or merging the code is not approval to publish npm packages.
