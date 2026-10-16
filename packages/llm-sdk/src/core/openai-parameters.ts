/** OpenAI reasoning controls. Omit to retain the model's default effort. */
export type OpenAIReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export interface OpenAIParameterOptions {
  reasoningEffort?: OpenAIReasoningEffort;
  /** Use passthrough for compatible servers with different model rules. */
  parameterPolicy?: "openai" | "passthrough";
  /** Receives omitted-option warnings; defaults to console.warn. */
  onWarning?: (message: string) => void;
}

function capabilities(model: string) {
  const gpt = /^gpt-(\d+)(?:\.(\d+))?(?:-(.+))?$/i.exec(model);
  const major = Number(gpt?.[1] ?? 0);
  const minor = Number(gpt?.[2] ?? 0);
  const chat = gpt?.[3]?.startsWith("chat") ?? false;
  const reasoning = /^o\d+(?:-|$)/i.test(model) || (major >= 5 && !chat);
  const supportsNone =
    (major === 5 && minor >= 1 && !chat) ||
    /^gpt-6-(?:sol|luna)(?:-\d{4}-\d{2}-\d{2})?$/i.test(model);
  return { major, minor, reasoning, supportsNone };
}

export function isOpenAIReasoningModel(model: string | undefined): boolean {
  return capabilities(model ?? "").reasoning;
}

export function requiresOpenAIResponses(
  model: string,
  baseUrl: string | undefined,
  options: OpenAIParameterOptions = {},
): boolean {
  if (options.parameterPolicy === "passthrough") return false;
  const c = capabilities(model);
  if (!c.reasoning || options.reasoningEffort === "none") return false;
  if (!(c.major >= 6 || (c.major === 5 && c.minor >= 4))) return false;
  if (!baseUrl) return true;
  try {
    return new URL(baseUrl).hostname === "api.openai.com";
  } catch {
    return false;
  }
}

export function buildOpenAIParameters(
  model: string | undefined,
  maxTokens: number | undefined,
  temperature: number | undefined,
  options: OpenAIParameterOptions = {},
  api: "chat" | "responses" = "chat",
): Record<string, unknown> {
  const c = capabilities(model ?? "");
  const normalize = options.parameterPolicy !== "passthrough";
  const effort = options.reasoningEffort;
  if (normalize && c.reasoning && effort === "none" && !c.supportsNone) {
    throw new Error(`${model} does not support reasoningEffort: none`);
  }
  if (normalize && c.major >= 6 && effort === "minimal") {
    throw new Error(`${model} does not support reasoningEffort: minimal`);
  }
  const result: Record<string, unknown> = {
    [api === "responses"
      ? "max_output_tokens"
      : normalize && c.reasoning
        ? "max_completion_tokens"
        : "max_tokens"]: maxTokens,
  };
  if (effort !== undefined) {
    if (api === "responses") result.reasoning = { effort };
    else result.reasoning_effort = effort;
  }
  if (temperature !== undefined) {
    if (!normalize || !c.reasoning || (effort === "none" && c.supportsNone)) {
      result.temperature = temperature;
    } else {
      (options.onWarning ?? console.warn)(
        `[llm-sdk] ${model}: omitted temperature because reasoning is enabled.`,
      );
    }
  }
  return result;
}
