# Release branches and UI handoff

Snapshot verified on 17 October 2026. This is the preparation plan; integration,
pushes, PR creation and publication have not been performed by this checkpoint.

## Current release

| Branch                            | Purpose                                                                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `main`                            | Production destination; remote head `70606f2` at this check.                                                                                                             |
| `beta`                            | Remote head `321bef0`; source still precedes the published compatibility hotfix. The local `beta` branch is older, so use the fetched remote when preparing the release. |
| `codex/beta-compatibility-hotfix` | Isolated published LLM compatibility fix; head `9ec7e76`, implementation commit `fa2e66f`.                                                                               |
| `codex/production-release`        | Prepared 2.6.0 candidate at `ac72bb8`; it still needs the compatibility hotfix and reconciliation with `main`.                                                           |

The npm beta tags currently point to `@yourgpt/llm-sdk@2.6.0-beta.3` and
`@yourgpt/copilot-sdk@2.5.1-beta.3`. A published npm version does not establish that
its source was merged into `beta`. The production candidate has ten commits from
`main` absent from its ancestry; inspect and reconcile them before promotion.
The candidate's 2.6.0 package versions are preparation, not publication approval.

First integrate the isolated hotfix into the current beta/release path, verify
the reconciled production candidate, and promote that candidate to `main` when
approved. Keep next-beta feature work out of that candidate.

## Next beta

Use `codex/next-beta-decisions` as the shared integration branch. It contains the
next-beta provider/media features, examples and Feature Lab. This checkpoint
records its documentation work separately from the compatibility implementation.

`codex/ankush-pr-compatibility` started at the same next-beta commit, `40fc00d`.
Its checkpoint contains the adapted PR fixes, regression tests, provider evidence
and review report. Integrate that checkpoint into `codex/next-beta-decisions`
before creating the common UI-agent starting point. The standalone GenUI sandbox
patch is a review artifact, not an installed GenUI feature.

These preparation branches are local at this check. Their LLM package version
still reads `2.6.0-beta.2`; do not publish that stale version. Select and confirm
new versions and dist-tags only after integration and release testing.

## UI-agent starting point

1. Wait for the documentation and compatibility checkpoints to be consolidated.
2. Create each UI work branch, using the `codex/` prefix, from that exact
   integration commit in a separate worktree. Record the starting commit.
3. Keep sanitized HTML rendering as the default, literal rendering opt-in,
   consumer theme variables intact, and canonical tool call/result history
   unchanged. Include the cancellation and tool-hook regressions when touching
   those components.
4. Review each UI change back into `codex/next-beta-decisions`; test the combined
   code before promotion to `beta`, then production after beta validation.

Do not import the old alpha, GenUI or single-stream PR branches wholesale. See
`docs/reviews/2026-10-17-ankush/README.md` on the compatibility branch for the
tested adaptations and remaining blockers. Pending work includes single-turn
presentation, full GenUI integration, hosted MCP and the separate #94 shared-tool
counting defect. Direct Jev/Cloudflare live calls and physical realtime voice
across devices remain unverified.

The existing verification evidence belongs to the reviewed source snapshots.
It is not a claim that a future combination, UI change or release is tested.

## Operation boundaries

No branch may import `development`. Each merge, push and PR creation needs fresh
confirmation under the user's Git safety rules. Publishing additionally needs
confirmation of the exact package versions and npm dist-tags. The separate
`yourgpt-docs` repository has its own uncommitted documentation work and is not
included in these Copilot SDK commits.
