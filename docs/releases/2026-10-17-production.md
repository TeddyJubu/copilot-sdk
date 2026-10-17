# Production release candidate: both SDKs 2.6.0

Status: prepared locally; not pushed, merged, or published. Exact versions and
publication require user confirmation. Main requires a PR approval from a reviewer
other than the author/last pusher before merging.

## Package targets

| Package                | Tested beta    | Proposed stable version | Target npm tag |
| ---------------------- | -------------- | ----------------------- | -------------- |
| `@yourgpt/llm-sdk`     | `2.6.0-beta.2` | `2.6.0`                 | `latest`       |
| `@yourgpt/copilot-sdk` | `2.5.1-beta.3` | `2.6.0`                 | `latest`       |

Both receive a minor stable version because this release adds public APIs. Existing
`beta` and `alpha` tags are retained. No scaffolder or unrelated package version is
changed. Native Decisions, realtime voice, and image generation are outside this
promotion and remain next-beta/deferred work.

## Source and behavior

The candidate starts at tested/published beta commit
`321bef0be10df9bf2b9fdbf102ebbaf9c94301ef`. SDK runtime source is unchanged from that
commit. Only package versions, release notes, and documentation change on this
release branch. The full main-to-beta diff also includes the earlier beta fixes
for structured output, token usage, mixed tool turns, and tool-loop cancellation.

The [upgrade guide](../../apps/docs/content/docs/release-2-6.mdx) documents the
included features and compatibility changes. The [beta release record](2026-10-17-beta.md)
contains the existing live validation evidence. Physical microphone verification,
hosted lossless metadata replay, and application guardrail evaluation remain known
limits, not completed production certifications.

## Candidate validation

- 314 automated regression tests passed; no failures or skips.
- 21/21 workspace builds passed, including the documentation site.
- Both SDK typechecks and public CJS/ESM declaration checks passed.
- 21 new documentation examples typechecked; 149 local documentation links resolved.
- Packed output is byte-identical to the tested beta for all 303 distributed build
  files (62 LLM SDK + 241 Copilot SDK). Only versions, documentation, and the
  unchanged repository MIT license differ. `pnpm pack` includes that license.
- Package contents passed a redacted secret scan. Npm authentication works; neither
  proposed 2.6.0 version existed when the candidate was prepared.

These are candidate checks, not a statement that main has merged or npm has published.

## Delivery path

1. Validate the exact candidate and inspect package contents against the published beta.
2. Obtain fresh confirmation to push `codex/production-release` and create its PR to `main`.
3. Wait for PR CI and the required external review, then obtain explicit merge confirmation.
4. The main release workflow can publish unpublished stable package versions through
   Changesets. Confirm both exact 2.6.0 versions for `latest` before merging, or publishing manually.
5. Verify npm archive integrity and tags after publication, and verify documentation deployment.
6. Continue remaining features on beta after the production release is verified.

No production merge or publication is implied by preparing this document.
