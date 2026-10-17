import { nativeDecisionModel } from "../decisions/model";
import type { DecisionProviderOptions } from "../decisions/http";
export interface OpenRouterDecisionProviderOptions extends DecisionProviderOptions {
  siteUrl?: string;
  appName?: string;
}
/** Native alpha Decisions endpoint; its base URL differs from OpenRouter chat. */
export function openrouterDecision(
  modelId = "typesafe/jev-1.13",
  options: OpenRouterDecisionProviderOptions = {},
) {
  return nativeDecisionModel(modelId, {
    ...options,
    headers: {
      ...options.headers,
      ...(options.siteUrl && { "HTTP-Referer": options.siteUrl }),
      ...(options.appName && { "X-Title": options.appName }),
    },
    provider: "openrouter",
    keyEnv: "OPENROUTER_API_KEY",
    defaultBaseUrl: "https://openrouter.ai/api/alpha",
    path: "/decisions",
  });
}
