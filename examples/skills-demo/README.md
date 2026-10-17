# Skills and provider demos

This Vite/Express workspace contains the existing Copilot skills demo plus standalone native Decisions and media examples. For a combined feature test UI, use the [Playground Feature Lab](../playground/README.md).

From the repository root, install dependencies and build the local SDK:

```bash
pnpm install
pnpm build:sdk
```

Provide the required provider credentials through your local environment or secret runner. Never commit keys. The Decisions CLI reads process environment variables; it does not load a dotenv file itself.

## Native Decisions

```bash
pnpm --filter skills-demo demo:decisions openai
pnpm --filter skills-demo demo:decisions openrouter
pnpm --filter skills-demo demo:decisions typesafe
pnpm --filter skills-demo demo:decisions cloudflare
```

[`server/decisions.ts`](server/decisions.ts) routes a ticket using native boolean, choice and score answers. It returns provider probabilities and usage. Providers need `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `TYPESAFE_AI_API_KEY`, or `CLOUDFLARE_AUTH_TOKEN` plus `CLOUDFLARE_ACCOUNT_ID`, respectively. The routing threshold is illustrative.

## Realtime voice and images

```bash
pnpm --filter skills-demo demo:media
```

Open [the media demo](http://127.0.0.1:3033/media.html). The local API runs on port 3034 and needs `OPENAI_API_KEY`. [`src/media.tsx`](src/media.tsx) exercises realtime WebRTC with tool approvals and image generation/editing. [`server/media.ts`](server/media.ts) keeps credentials on the server. These local demo endpoints are not a production authentication layer.

## Existing skills demo

```bash
pnpm --filter skills-demo dev
```

Open [the skills demo](http://localhost:3033). The main Express server uses port 3032. See [`server/index.ts`](server/index.ts) and the example markdown skills under [`skills/`](skills).
