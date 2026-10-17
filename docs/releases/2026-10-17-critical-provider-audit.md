# Critical provider audit — 2026-10-17

Audited `codex/next-beta-decisions`, starting at `9be63b4`. This is a fresh review
of parameter handling, native Decisions, Responses, and images in function calls.
The production branch and npm versions were not changed.

## Findings and corrections

1. **Responses log probabilities with reasoning:** the SDK already removed
   unsupported temperature, but still forwarded `message.output_text.logprobs` in
   `include`. It now removes that entry with a warning when reasoning is enabled,
   retaining encrypted reasoning and other includes. Explicit supported `none`,
   legacy models, and `parameterPolicy: "passthrough"` keep their existing behavior.
   Added 16 regression cases covering modern/adapter and complete/stream paths.
2. **OpenAI Decisions image URLs:** the initial beta accepted hosted URLs. Native
   Decisions requires inline image data. The public type now requires encoded
   bytes; all native adapters reject URLs before any request. Updated the package
   and site guides, added four provider regression cases and a public type check.
   This restriction does not apply to image tool outputs on Responses.
3. **Compatibility fallback example:** a real rejected GPT-6 Luna temperature
   request returned `400 / unsupported_value / temperature`. The example only
   matched `unsupported_parameter`. It now matches both codes narrowly. Added two
   regression cases; live complete and streaming tests confirmed no retry and
   exactly one model switch only when explicitly configured.
4. **Responses replay:** expanded existing tests to retain multiple encrypted
   reasoning items and assistant `phase`, in original order. No implementation
   correction was needed for this case.

OpenAI's [GPT-6 parameter guidance](https://developers.openai.com/api/docs/guides/latest-model)
and [Decisions image contract](https://developers.openai.com/api/docs/guides/decisions)
were checked directly. Vercel's pinned
[Responses implementation](https://github.com/vercel/ai/blob/fce9210c6405c0ad8452fee3f50717e8ea910b97/packages/openai/src/responses/openai-responses-language-model.ts)
also filters incompatible log probabilities; its
[native Decisions adapter](https://github.com/vercel/ai/blob/fce9210c6405c0ad8452fee3f50717e8ea910b97/packages/openai/src/openai-decision-model.ts)
requires inline image data.

## Evidence by feature

| Area                              | What was checked                                                                                                                                                                    | Fresh live result                                                                              | Limits                                                                                                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parameters and fallback           | GPT-6 Luna default reasoning, temperature zero, token-limit naming, automatic tool routing, explicit `none`, logprob omission; deliberate real 400 errors with fallback off/on      | 20 cases passed across modern and adapter complete/stream paths                                | This verifies named scenarios, not every model/parameter combination. The invalid requests were deliberate tests using passthrough.                 |
| Decisions                         | Native boolean, choice and ordered score, probabilities/confidence/usage, image decisions; schema, malformed answers, refusals, timeout, cancellation and HTTP failures in fixtures | OpenAI: 3 cases passed. Jev through OpenRouter: 2 cases passed                                 | Direct Jev and Cloudflare have no live coverage. Native OpenRouter images are explicitly unsupported.                                               |
| Responses                         | Stateless and stored continuation, ordered encrypted reasoning, tool continuation, streaming, Runtime and Copilot persisted history                                                 | 12 cases passed on GPT-6 Luna                                                                  | Advanced provider features such as background jobs, native MCP approvals and ordered additional-tools updates are not covered by this integration.  |
| Image tool outputs                | Actual inline PNG image returned to model, mixed tool results, one execution, saved history, JSON and SSE Copilot paths                                                             | OpenAI GPT-5.2: 6 cases. OpenAI GPT-6 Luna: 6 cases. Anthropic Sonnet 4.5: 6 cases. All passed | Hosted URLs and OpenAI file IDs have fixture coverage, not fresh live coverage. Other chat providers are not claimed to support image tool outputs. |
| Image input with function calling | A user-supplied blue image determines the JSON `color` argument of a tool, then the model confirms the recorded result                                                              | GPT-6 Luna: 2 cases. Anthropic Sonnet 4.5: 2 cases. All passed                                 | Tools still receive JSON arguments; an image can inform those arguments or be passed by an application-managed reference.                           |

Total: **59 distinct live cases passed** with the existing OpenAI, Anthropic and
OpenRouter credentials. Synthetic prompts and images were used. No credentials
were written to source, reports, or logs. The first version of the new live test
collector read `textDelta` instead of the SDK's `text` field in two assertions;
the collector was corrected and both cases passed on recheck.

The full automated suite passed **461 tests**, including **22 added cases**, on
Node 26.7.0 and Node 18.20.8. SDK typechecks, public CJS/ESM declaration checks,
the SDK build, and the full workspace build (21 tasks) passed. Build results and
sanitized per-case evidence are in
[the evidence record](./2026-10-17-critical-provider-audit.json).

## Competitor and provider cross-check

This review read current source and changelogs; it did not execute or benchmark
competitor packages. The old competitor folders were located locally, but current
upstream sources were used for the API comparison.

| Source            | Pin / reference                                                                                                                                                                                                                                                     | Relevant comparison                                                                                                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel AI SDK     | Commit `fce9210c6405c0ad8452fee3f50717e8ea910b97`, verified current main; [ai 7.0.143 release](https://github.com/vercel/ai/releases/tag/ai%407.0.143) and [OpenAI 4.0.96 release](https://github.com/vercel/ai/releases/tag/%40ai-sdk/openai%404.0.96), October 16 | Native Decisions, inline images, refusals, model-dependent parameters, image tool output and ordered Responses replay.                                                                                                              |
| LangChain JS      | Commit `84eca2b11c0900a67775dca258ebec04f8e852a2`, verified current main; [OpenAI changelog](https://github.com/langchain-ai/langchainjs/blob/84eca2b11c0900a67775dca258ebec04f8e852a2/libs/providers/langchain-openai/CHANGELOG.md)                                | Version 1.5.14 added GPT-6 recognition and native image tool outputs. 1.5.13 fixed multiple-reasoning-item replay. Our tests cover those failure modes. 1.6.2 includes additional-tools support, which remains separate scope here. |
| OpenAI Agents SDK | [AI SDK integration](https://openai.github.io/openai-agents-js/extensions/ai-sdk/)                                                                                                                                                                                  | Typed image results preserve media instead of converting image bytes to plain JSON text.                                                                                                                                            |
| Anthropic         | [Tool result contract](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls)                                                                                                                                                             | Nested image blocks in `tool_result`; tool IDs and immediate result ordering. Both input vision and returned-image flows passed live.                                                                                               |
| TypeSafe / Jev    | [API contract](https://docs.typesafe.ai/api), [image contract](https://docs.typesafe.ai/images)                                                                                                                                                                     | System One `noul`/choice/score, JSON state, referenced image assets and image opt-in header. Native Jev transport has fixture coverage; gateway execution passed live.                                                              |
| OpenRouter        | [Native alpha Decisions contract](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request)                                                                                                                                           | Uses `/api/alpha/decisions`, not chat. Named System One answers and provider/model identity preserved. No image field in the documented schema.                                                                                     |
| Cloudflare        | [Clef](https://developers.cloudflare.com/workers-ai/models/clef/), [input schema](https://developers.cloudflare.com/workers-ai/models/clef/schema-input.json), [output schema](https://developers.cloudflare.com/workers-ai/models/clef/schema-output.json)         | Account-scoped Workers AI endpoint, `clef` model selector, result envelope, question/image limits and native probabilities. Schema and fixture checks passed; live account verification remains pending.                            |

Vercel source comparison additionally covered its
[OpenAI changelog](https://github.com/vercel/ai/blob/fce9210c6405c0ad8452fee3f50717e8ea910b97/packages/openai/CHANGELOG.md)
and [TypeSafe changelog](https://github.com/vercel/ai/blob/fce9210c6405c0ad8452fee3f50717e8ea910b97/packages/typesafe-ai/CHANGELOG.md).
Vercel's experimental box questions and other broader capabilities are not part of
our current boolean/choice/score contract. No native Vercel OpenRouter/Cloudflare
Decisions adapter was found in this snapshot; those adapters follow provider docs.

## Guardrail behavior and remaining verification

`TRAINING_CONFLICT` belongs to the application, not this SDK. A transport error,
refusal or malformed decision must stay distinct from a successful decision.
Do not turn those failures into `respond` or invent a confidence score. The
application must define its review/error outcome and validate decision thresholds
against labeled examples before production use. No application guardrail logic
was changed by this audit.

Direct Jev and Cloudflare tests remain pending until their account credentials
are available. This follows the user's instruction to continue with the available
keys. Gateway testing cannot establish direct-provider authentication, quotas,
image decoding or account access. The successful tests above establish API
conformance for their fixtures, not classifier accuracy or a guarantee of no
regressions under all production workloads.

## Reproduce

```sh
pnpm build:sdk
node --test packages/llm-sdk/test/*.test.cjs test/copilot-compatibility.test.cjs test/voice-input.test.cjs test/realtime-voice.test.cjs
pnpm --filter @yourgpt/llm-sdk typecheck
pnpm --filter @yourgpt/copilot-sdk typecheck
pnpm --filter @yourgpt/llm-sdk test:types
pnpm build
```

Live runners are in `packages/llm-sdk/test/live/`: `parameters.cjs`,
`responses.cjs`, `decisions.cjs`, and `tool-images.cjs`. Supply only the relevant
provider credential privately and use each runner's explicit opt-in flag.
`IMAGE_TEST_MODEL=gpt-6-luna` exercises the new OpenAI model. The live Responses
runner deletes the synthetic stored responses it creates. Local detailed logs
for this audit are under `/tmp/copilot-critical-audit/`.
