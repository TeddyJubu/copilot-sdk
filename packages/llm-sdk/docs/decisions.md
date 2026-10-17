# Native Decisions — next beta (unreleased)

This API is on `codex/next-beta-decisions`. It is not in the published
`@yourgpt/llm-sdk@2.6.0-beta.2` package. The production release candidate is separate.

Use Decisions to classify or score shared state with native decision models.
Chat generation, Responses, and tool execution keep their existing APIs.

```ts
import { experimental_decide } from "@yourgpt/llm-sdk";
import { openaiDecision } from "@yourgpt/llm-sdk/openai";

const result = await experimental_decide({
  model: openaiDecision("gpt-6-luna"), // server-side OPENAI_API_KEY
  state: { ticket: "Every customer is unable to sign in." },
  questions: {
    outage: {
      type: "boolean",
      instructions: "Does the ticket report a service outage?",
    },
    team: {
      type: "choice",
      instructions: "Which team should handle this?",
      criteria: {
        billing: "Invoices and refunds",
        engineering: "Service outages",
      },
    },
    impact: {
      type: "score",
      instructions: "How much service is unavailable?",
      criteria: ["None", "Some features or users", "All users"],
    },
  },
  timeoutMs: 60_000,
});

if (result.answers.team.type === "refusal") {
  // Route to your application's review or error path.
} else {
  const team: "billing" | "engineering" = result.answers.team.choice;
  console.log(team, result.answers.team.probabilities);
}
```

Question IDs and choice keys are preserved and inferred in TypeScript. Boolean
answers contain `probability` (P(true)); scores are fractional, zero-based positions
along the ordered criteria. Choice/score `confidence` is present only when supplied
by the provider. Confidence and probability are different signals; neither promises
task accuracy. Define and evaluate application-specific routing thresholds yourself.

## Providers

| Factory / import                        | Default model         | Environment                                      | Native endpoint                        |
| --------------------------------------- | --------------------- | ------------------------------------------------ | -------------------------------------- |
| `openaiDecision` from `/openai`         | `gpt-6-luna`          | `OPENAI_API_KEY`                                 | `/v1/decisions`                        |
| `typesafeDecision` from `/typesafe`     | `jev-latest`          | `TYPESAFE_AI_API_KEY`                            | `/v1/systemone`                        |
| `openrouterDecision` from `/openrouter` | `typesafe/jev-1.13`   | `OPENROUTER_API_KEY`                             | `/api/alpha/decisions`                 |
| `cloudflareDecision` from `/cloudflare` | `@cf/cloudflare/clef` | `CLOUDFLARE_AUTH_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Account-scoped Workers AI run endpoint |

Factories also accept `{ apiKey, baseUrl, fetch, headers }` as their second argument.
Cloudflare accepts `accountId` and the `@cf/cloudflare/clef-flash` model. The
OpenRouter Decisions base URL is `https://openrouter.ai/api/alpha`; do not pass its
chat `/api/v1` base. Cloudflare's custom base must include the account's `/ai/run`
path. Supply keys on the server; these factories do not require upgrading the
optional OpenAI npm client.

No Anthropic native Decisions adapter is provided. Continue using its existing
chat/structured-output APIs where appropriate; they are not silently substituted
for native Decisions.

## Inputs and limits

`state` and `instructions` accept text, JSON objects, or JSON arrays. Arrays remain
structured JSON. Numbers must be finite; cycles, undefined values, and nesting
beyond 64 levels are rejected. Unknown request options, such as `temperature`,
tools, streaming, or audio, fail explicitly.

- Boolean criteria may describe `true` and/or `false`. OpenRouter requires both
  descriptions if criteria are provided.
- Choice criteria require 2–255 distinct string keys. Native OpenAI boolean-valued
  choices are outside this common API; use a boolean question instead.
- Score criteria require at least two levels. System One adapters accept up to ten.
- OpenAI accepts at most 200 questions. Cloudflare accepts at most 64 and requires
  IDs of 1–100 letters, digits, underscores, dots, or hyphens.
- Request bodies are limited to 32 MiB by this SDK, or 13 MiB for Cloudflare.

Optional provider settings are checked rather than silently ignored:

```ts
const providerOptions = {
  openai: { safetyIdentifier: "user-123", promptCacheKey: "support-v1" },
};
// Jev: { typesafe: { longContext: true } }
// OpenRouter: { openrouter: { sessionId: "session-1",
//   provider: { order: ["TypeSafe"], allowFallbacks: false } } }
```

Only pass the namespace matching the selected provider. Long-context support is
experimental and depends on the Jev model/account. Cache hits are not guaranteed.

## Image state

```ts
import { readFile } from "node:fs/promises";

const images = [
  {
    data: await readFile("./sample.png"),
    mediaType: "image/png" as const,
  },
];
// Pass `images` alongside `state` and `questions` to experimental_decide.
```

OpenAI accepts PNG, JPEG, WebP, and GIF bytes, or public HTTP(S) `URL` objects, with
optional `detail`. This SDK limits inline files to 20 MiB and 128 images. It never
downloads URLs itself. Jev accepts PNG/JPEG bytes up to 16 MiB each using referenced
native image assets and its required experimental image header. The original state
is retained under `state` and image references under `images` in the native Jev
request. Cloudflare accepts at most four PNG/JPEG/WebP files, 4 MiB each and 8 MiB
total. Remote URLs and OpenAI-specific detail settings fail on Jev/Cloudflare.

Byte format headers and size limits are checked locally. Providers perform full
image decoding, dimension and animation validation. Jev requires still images with
each dimension between 280 and 1568 pixels; Cloudflare limits each image to 16
megapixels. Prepare images before sending; this SDK does not resize them.
OpenRouter's documented native Decisions request has no image field, so this
adapter rejects image inputs.

## Results, refusals, and errors

The SDK rejects missing/extra answers, duplicate OpenAI answer IDs, unknown choices,
incomplete distributions, invalid probabilities, and scores inconsistent with their
ordered levels. Values are never renormalized. TypeSafe's documented rounding is
allowed for direct Jev and confirmed TypeSafe responses through OpenRouter.

A named OpenAI refusal remains `{ type: "refusal" }` under that question; other
answers remain available. An unnamed refusal throws `DecisionAPIError` with code
`refusal`. HTTP, network, malformed-response, unsupported-option, and input errors
are separate. Errors do not include raw provider error bodies or credentials.
Use `DecisionAPIError.isInstance(error)` to recognize these errors across separately
bundled provider imports, CommonJS, and ES modules.

Pass `signal` to cancel. The timeout covers the response body too, and defaults to
60 seconds. Errors expose `status`, `requestId` when available, and a `retryable`
hint. There are **no automatic retries or chat fallbacks**. `TRAINING_CONFLICT` and
existing guardrail behavior are unchanged; evaluate a migration separately.

Normalized token/cache/cost usage is in `usage`; absent fields remain absent.
`response.body` retains the original provider response, including gateway metadata
and native score legends. Avoid logging it if your state contains private data.
Responses larger than 8 MiB are rejected.

## Example and verification

The existing skills demo includes `server/decisions.ts`. With the required provider
key already in your process environment, run from `examples/skills-demo`:

```sh
pnpm demo:decisions openai
pnpm demo:decisions openrouter
```

The example uses a synthetic ticket and a review route for uncertain/refused
answers. It does not load a `.env` file automatically or change the chat server.
Opt-in live tests are in `test/live/decisions.cjs`; select a provider with
`DECISION_TEST_PROVIDER` and enable `RUN_DECISIONS_LIVE=1` with its key configured
privately. Direct Jev/Cloudflare live checks require their own credentials.

Research and source pins: [next-beta plan](../../../docs/plans/2026-10-17-next-beta.md).
