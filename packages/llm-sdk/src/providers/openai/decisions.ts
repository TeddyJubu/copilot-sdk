import { nativeDecisionModel } from "../decisions/model";
import type { DecisionProviderOptions } from "../decisions/http";
export interface OpenAIDecisionProviderOptions extends DecisionProviderOptions {
  organization?: string;
  project?: string;
}
/** Native /v1/decisions. Independent of the optional OpenAI npm client. */
export function openaiDecision(
  modelId = "gpt-6-luna",
  options: OpenAIDecisionProviderOptions = {},
) {
  return nativeDecisionModel(modelId, {
    ...options,
    headers: {
      ...options.headers,
      ...(options.organization && {
        "OpenAI-Organization": options.organization,
      }),
      ...(options.project && { "OpenAI-Project": options.project }),
    },
    provider: "openai",
    keyEnv: "OPENAI_API_KEY",
    defaultBaseUrl: "https://api.openai.com/v1",
    path: "/decisions",
  });
}
