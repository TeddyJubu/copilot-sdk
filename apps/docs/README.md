# Copilot SDK documentation

This is the dedicated SDK documentation application for
[copilot-sdk.yourgpt.ai](https://copilot-sdk.yourgpt.ai). It uses Next.js and
Fumadocs. MDX pages live in `content/docs`; each folder's `meta.json` controls
navigation. This app is separate from the YourGPT hosted-widget documentation
project in `yourgpt-docs`.

## Develop and validate

From the workspace root, with Node.js 20.9+ and pnpm:

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

## Beta documentation

Start at [Beta upgrades and compatibility](content/docs/llm-sdk/beta-upgrade.mdx).
It distinguishes the published hotfix from the unreleased Decisions, realtime
and image-generation APIs. The next-beta release number is not assigned yet.

Dedicated guides cover parameters/fallback, Responses and caching, system prompt
compatibility, images in tool results, TTS/STT, Decisions, realtime and image
generation. The [Feature Lab guide](content/docs/feature-lab.mdx) documents manual
checks and exact live-versus-fixture coverage.

These source updates and the Feature Lab have not been deployed. Do not describe
an npm package, branch push or successful build as a documentation deployment.

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
