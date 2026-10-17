import { nativeDecisionModel } from "../decisions/model";
import type { DecisionProviderOptions } from "../decisions/http";
export type TypeSafeDecisionProviderOptions = DecisionProviderOptions;
/** Native Jev System One API; credentials are separate from OpenRouter. */
export function typesafeDecision(
  modelId = "jev-latest",
  options: TypeSafeDecisionProviderOptions = {},
) {
  return nativeDecisionModel(modelId, {
    ...options,
    provider: "typesafe",
    keyEnv: "TYPESAFE_AI_API_KEY",
    defaultBaseUrl: "https://api.typesafe.ai/v1",
    path: "/systemone",
  });
}
