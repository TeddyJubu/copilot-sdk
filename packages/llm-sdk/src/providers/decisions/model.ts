import { randomUUID } from "node:crypto";
import { type DecisionModel, type DecisionOptions } from "../../core/decisions";
import {
  assertDecisionKeys,
  decisionInputError,
  isDecisionRecord,
  validateDecisionInput,
} from "../../core/decision-validation";
import { postDecision, type DecisionProviderOptions } from "./http";
import { prepareDecisionImages, unsupportedDecision } from "./images";
import { parseDecisionResponse } from "./response";

type Provider = "openai" | "typesafe" | "openrouter" | "cloudflare";
interface NativeConfig extends DecisionProviderOptions {
  provider: Provider;
  keyEnv: string;
  defaultBaseUrl: string;
  path: string;
  bodyModel?: string;
}
function asText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}
function requestOptions(
  options: DecisionOptions,
  provider: Provider,
): Record<string, unknown> {
  for (const key of Object.keys(options.providerOptions ?? {})) {
    if (key !== provider)
      unsupportedDecision(
        "Decision providerOptions must match the selected provider",
      );
  }
  const opts =
    (options.providerOptions as Record<string, unknown> | undefined)?.[
      provider
    ] ?? {};
  if (!isDecisionRecord(opts))
    decisionInputError("Decision provider options must be an object");
  const allowed =
    provider === "openai"
      ? ["safetyIdentifier", "promptCacheKey"]
      : provider === "typesafe"
        ? ["longContext"]
        : provider === "openrouter"
          ? ["sessionId", "provider"]
          : [];
  assertDecisionKeys(opts, allowed, "Decision provider options");
  for (const [key, limit] of [
    ["safetyIdentifier", 128],
    ["promptCacheKey", 64],
    ["sessionId", 256],
  ] as const) {
    if (
      opts[key] !== undefined &&
      (typeof opts[key] !== "string" || opts[key].length > limit)
    )
      decisionInputError("Invalid decision identifier or cache key");
  }
  if (opts.longContext !== undefined && typeof opts.longContext !== "boolean")
    decisionInputError("longContext must be boolean");
  if (opts.provider !== undefined) {
    if (!isDecisionRecord(opts.provider))
      decisionInputError("OpenRouter routing preferences must be an object");
    assertDecisionKeys(
      opts.provider,
      ["order", "allowFallbacks"],
      "OpenRouter routing preferences",
    );
    if (
      opts.provider.allowFallbacks !== undefined &&
      typeof opts.provider.allowFallbacks !== "boolean"
    )
      decisionInputError("allowFallbacks must be boolean");
    if (
      opts.provider.order !== undefined &&
      (!Array.isArray(opts.provider.order) ||
        !opts.provider.order.every(
          (value) => typeof value === "string" && value.length,
        ))
    )
      decisionInputError("Provider order must be an array of provider names");
  }
  return opts;
}
export function nativeDecisionModel(
  modelId: string,
  config: NativeConfig,
): DecisionModel {
  if (typeof modelId !== "string" || !modelId.trim())
    decisionInputError("Decision model ID is required");
  const provider = config.provider;
  return {
    provider,
    modelId,
    async doDecide(options) {
      validateDecisionInput(options);
      options.signal?.throwIfAborted();
      const opts = requestOptions(options, provider);
      const questions = Object.entries(options.questions);
      if (provider === "openai" && questions.length > 200)
        decisionInputError("OpenAI Decisions supports at most 200 questions");
      if (
        provider === "cloudflare" &&
        (questions.length > 64 ||
          questions.some(([id]) => !/^[A-Za-z0-9_.-]{1,100}$/.test(id)))
      )
        decisionInputError(
          "Cloudflare supports 1–64 questions with IDs of 1–100 letters, digits, underscores, dots, or hyphens",
        );
      for (const [, question] of questions) {
        if (
          provider !== "openai" &&
          question.type === "score" &&
          question.criteria.length > 10
        )
          decisionInputError(
            "System One adapters support at most ten score levels",
          );
        if (
          provider === "cloudflare" &&
          typeof question.instructions === "string" &&
          !question.instructions.trim()
        )
          decisionInputError("Cloudflare requires nonempty instructions");
        if (
          provider === "openrouter" &&
          question.type === "boolean" &&
          question.criteria !== undefined &&
          (question.criteria.true === undefined ||
            question.criteria.false === undefined)
        )
          decisionInputError(
            "OpenRouter boolean criteria must describe both true and false when supplied",
          );
      }
      const images = prepareDecisionImages(options.images ?? [], provider);
      const headers: Record<string, string> = Object.fromEntries(
        Object.entries(config.headers ?? {}).filter(
          ([name]) =>
            !["authorization", "content-type"].includes(name.toLowerCase()),
        ),
      );
      headers["Content-Type"] = "application/json";
      const key = config.apiKey ?? process.env[config.keyEnv];
      if (!key?.trim())
        decisionInputError(`Missing ${config.keyEnv} for Decisions`);
      headers.Authorization = `Bearer ${key}`;
      let body: Record<string, unknown>;
      if (provider === "openai") {
        body = {
          model: modelId,
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: asText(options.state) },
                ...images.map((image) => ({
                  type: "input_image",
                  image_url: image.url,
                  ...(image.detail !== undefined && { detail: image.detail }),
                })),
              ],
            },
          ],
          questions: questions.map(([name, question]) => {
            const instructions = asText(question.instructions);
            if (question.type === "boolean")
              return {
                type: "predicate",
                name,
                instructions: [
                  instructions,
                  ...Object.entries(question.criteria ?? {}).map(
                    ([key, value]) => `Criteria for ${key}:\n${asText(value)}`,
                  ),
                ].join("\n\n"),
              };
            if (question.type === "choice")
              return {
                type: "choice",
                name,
                instructions,
                choices: Object.entries(question.criteria).map(
                  ([value, description]) => ({
                    value,
                    ...(description !== null && {
                      description: asText(description),
                    }),
                  }),
                ),
              };
            return {
              type: "score",
              name,
              instructions,
              levels: question.criteria.map((description, index) => ({
                label: String(index),
                description: asText(description),
              })),
            };
          }),
          ...(opts.safetyIdentifier !== undefined && {
            safety_identifier: opts.safetyIdentifier,
          }),
          ...(opts.promptCacheKey !== undefined && {
            prompt_cache_key: opts.promptCacheKey,
          }),
        };
      } else {
        body = {
          model: config.bodyModel ?? modelId,
          state: options.state,
          questions: Object.fromEntries(
            questions.map(([id, question]) => [
              id,
              {
                ...question,
                type: question.type === "boolean" ? "noul" : question.type,
              },
            ]),
          ),
        };
        if (provider === "typesafe") {
          if (opts.longContext)
            headers["TypeSafe-Danger-Zone-Long-Context"] = "true";
          if (images.length) {
            const refs = images.map(() => randomUUID());
            body.state = { state: options.state, images: refs };
            body.assets = Object.fromEntries(
              images.map((image, index) => [
                refs[index],
                {
                  type: "image",
                  data_base64: image.base64,
                  format: image.mediaType === "image/png" ? "png" : "jpeg",
                },
              ]),
            );
            headers["TypeSafe-Danger-Zone-Images"] = "true";
          }
        } else if (provider === "cloudflare" && images.length) {
          body.images = images.map((image) => ({
            content_type: image.mediaType,
            base64: image.base64,
          }));
        } else if (provider === "openrouter") {
          if (opts.sessionId !== undefined) body.session_id = opts.sessionId;
          if (isDecisionRecord(opts.provider))
            body.provider = {
              ...(opts.provider.order !== undefined && {
                order: opts.provider.order,
              }),
              ...(opts.provider.allowFallbacks !== undefined && {
                allow_fallbacks: opts.provider.allowFallbacks,
              }),
            };
        }
      }
      const base = config.baseUrl ?? config.defaultBaseUrl;
      let url: URL;
      try {
        url = new URL(`${base.replace(/\/+$/, "")}${config.path}`);
      } catch {
        decisionInputError("Invalid Decisions base URL");
      }
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        decisionInputError(
          "Decisions base URL must be an HTTP(S) API root without credentials, query, or fragment",
        );
      const response = await postDecision(
        url.href,
        headers,
        body,
        options,
        config.fetch ?? globalThis.fetch,
        (provider === "cloudflare" ? 13 : 32) * 1024 * 1024,
      );
      return parseDecisionResponse(
        response.value,
        provider,
        options.questions,
        response.status,
        response.requestId,
      );
    },
  };
}
