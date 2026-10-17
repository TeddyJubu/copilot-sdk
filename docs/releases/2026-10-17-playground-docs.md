# Playground documentation and Decisions recheck

Prepared on `codex/playground-revamp`, based on `b75d51d`. The user confirmed
the UI agent's working changes were finished and should be included.

The redesign now links each of the ten feature/check views to its matching guide.
The page-level Docs link follows the selected feature and remains visible on
mobile. Copilot chat links to getting started, tool calling and the Feature Lab.
The link destinations use the production documentation hostname; their pages and
anchor IDs were verified against the generated documentation build.

## Validation

- Playground TypeScript check, playground production build and docs build pass.
- All 550 automated tests pass with no failures or skips.
- Browser checks pass for ten feature destinations, heading anchors, mobile Docs,
  and three chat guides, with no page errors.
- Existing browser key-flow checks pass: modal, persisted keys, twelve fixture
  feature/provider requests, embedded chat and dashboard navigation.
- Fresh real OpenAI Decisions calls pass billing, outage and image cases.
- Fresh real Jev-through-OpenRouter calls pass billing and outage cases.
- Direct Jev and Cloudflare remain fixture-tested only. No Java SDK was tested.

See [sanitized evidence](2026-10-17-playground-docs.json). These synthetic cases
verify selected API behaviors, not the accuracy of production guardrail policies.
The browser guide probe initially stopped at the welcome dialog; it passed after
the probe explicitly dismissed that expected dialog. No application fix was needed.

## Documentation correction

The current [OpenAI Decisions reference](https://developers.openai.com/api/reference/resources/decisions/methods/create)
permits hosted image URLs, conversation-shaped inputs and explicit cache options.
Our current common interface does not expose all of these. The guide now correctly
describes byte-only images as an SDK limit, not an upstream API restriction.
The native-provider interface follows the separate Decisions design in
[Vercel's documentation](https://ai-sdk.dev/docs/ai-sdk-core/decisions), but does
not claim complete feature parity. Source pins and implementation references
remain in [the research plan](../plans/2026-10-17-next-beta.md).

## Deployment preparation

The user approved local reconciliation with `codex/production-release`, preserving
its manual npm workflow, supply-chain policy, compatibility fixes and Node 22
workspace setup. The read-only merge preview identified seven documentation
conflicts and one `generate-text.ts` conflict; preserve reasoning text
alongside the existing missing-tool-calls fix. The combined tree passed a fresh frozen pnpm 11.5.1 install, all 550 tests,
all 21 uncached workspace builds on Node 22.23.3, both SDK typechecks, public
CJS/ESM declarations and the dependency-age gate. No lockfile versions changed.
CI now also runs the Feature Lab and adapted PR regression suites.
GitHub requires an approving review from someone other than the last pusher.
The reconciliation preserves the runtime source from the feature integration branch. Package versions remain
the production branch’s prepared 2.6.0 values; final npm versions require separate
approval. No push, remote main merge, deployment or npm publication is recorded
by this checkpoint.
