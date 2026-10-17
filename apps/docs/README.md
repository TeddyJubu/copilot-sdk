# Copilot SDK documentation

The documentation site lives here: Next.js, Fumadocs, and MDX in `content/docs`.

## Run locally

Use Node.js 22 or newer and the workspace's pinned pnpm 11.5.1. This is the
repository toolchain requirement; the published SDK packages retain Node.js 18+
support. From the repository root, after installing workspace dependencies:

```bash
pnpm --filter @yourgpt/copilot-sdk-docs dev
```

Open [localhost:3002](http://localhost:3002). The production build command is:

```bash
pnpm --filter @yourgpt/copilot-sdk-docs build
```

The build compiles MDX and generates the documentation routes. It may need network
access for configured web fonts. `pnpm --filter @yourgpt/copilot-sdk-docs start`
serves the built application with Next.js's default production port.

## Edit documentation

- Pages: `content/docs/**/*.mdx`, with `title` and `description` frontmatter.
- Sidebar order: the `meta.json` in each content directory.
- Content source: `source.config.ts` and `lib/source.ts`.
- Shared MDX components: `mdx-components.tsx`.
- Machine-readable routes: `/llms.txt`, `/llms-full.txt`, and `/llms.mdx/docs/...`.
  These derive from the same source; do not maintain a separate feature list there.

For a new API, document the public import, exact option/result shape, supported
providers, error/cancellation behavior, and persistence implications. Check code
examples against the SDK declarations and run the docs build after editing.

## Release documentation

The [2.6.0 upgrade guide](content/docs/release-2-6.mdx) covers stable promotion.
The [beta guide](content/docs/beta.mdx) records the 17 October 2026 releases:
LLM SDK `2.6.0-beta.2` and Copilot SDK `2.5.1-beta.3`. Feature pages identify their
minimum beta versions. Keep pending APIs and validation gaps distinct from shipped
behavior. Untagged installation examples use npm's `latest` channel; historical beta examples
specify an exact prerelease version. Features promoted to stable are listed in the
2.6.0 guide.

The [release record](../../docs/releases/2026-10-17-beta.md) and
[GitHub roadmap](https://github.com/YourGPT/copilot-sdk/issues/111) provide status.
`alpha-docs/` contains historical working notes and design drafts; it is not the
published API reference. Documentation edits do not promote npm tags or deploy the
website automatically from a local checkout.
