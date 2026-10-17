# Copilot SDK documentation

This is the dedicated SDK documentation application for
[copilot-sdk.yourgpt.ai](https://copilot-sdk.yourgpt.ai). It uses Next.js and
Fumadocs. MDX pages live in `content/docs`; each folder's `meta.json` controls
navigation. This app is separate from the YourGPT hosted-widget documentation
project in `yourgpt-docs`.

## Develop and validate

Use Node.js 22 or newer and the pinned pnpm 11.5.1 for this workspace.
Published SDK packages retain Node.js 18+ support. From the workspace root:

```bash
pnpm install
pnpm --filter @yourgpt/copilot-sdk-docs dev
```

Open [localhost:3002](http://localhost:3002/docs).

```bash
pnpm --filter @yourgpt/copilot-sdk-docs build
```

The production build compiles MDX, checks application types and generates the
static documentation routes. SDK package guides are in `packages/llm-sdk/docs`;
keep their API contracts consistent with the public pages. Release verification
records live under the repository's `docs/releases` directory.

## Feature documentation

Start at [Versions and compatibility](content/docs/llm-sdk/beta-upgrade.mdx).
It records published package versions and distinguishes their exports from
the features available in source on `main`.

Dedicated guides cover parameters/fallback, Responses and caching, system prompt
compatibility, images in tool results, TTS/STT, Decisions, realtime and image
generation. The [Feature Lab guide](content/docs/feature-lab.mdx) documents manual
checks and exact live-versus-fixture coverage.

The documentation and Feature Lab deploy from `main`. npm publication remains
separate from those website deployments.

## Playground proxy

The existing `examples/playground` application supplies the playground.
`next.config.mjs` forwards `/playground` and `/playground/:path*` to
`PLAYGROUND_URL`, including `/playground/features` and its API routes. To preview
the local playground through this documentation app, supply
`PLAYGROUND_URL=http://127.0.0.1:3035` before starting the docs server.

Deploy the documentation and existing playground projects separately. After
both deploy, verify the public documentation routes and the playground's key
entry, core checks, chat and media controls. Hosted feature calls require the
caller's provider key; they do not use shared environment keys.

## Release and deployment

The [2.6.0 upgrade guide](content/docs/release-2-6.mdx) describes the combined
SDK features and compatibility changes. A website deployment does not publish npm packages.
The Release workflow is manual, with publishing disabled by default. Exact npm
versions and dist-tags must be approved separately.

Machine-readable routes (`/llms.txt`, `/llms-full.txt`, `/llms.mdx/docs/...`)
derive from the same pages. Keep public API imports, limitations and validation
status consistent between these pages and package guides.
