export type AnthropicThinking =
  | { type: "enabled"; budgetTokens?: number }
  | { type: "adaptive"; display?: "summarized" | "omitted" }
  | { type: "disabled" }
  | { type: "between_tools" };

export function anthropicMaxTokens(
  maxTokens: number | undefined,
  thinking: Record<string, unknown> | undefined,
): number {
  return maxTokens ?? Math.max(4096, Number(thinking?.budget_tokens ?? 0) + 1);
}

/** Model rules shared by the modern provider and the Copilot runtime adapter. */
export function anthropicModelRules(model: string) {
  const match =
    /^claude-(opus|sonnet|haiku)-(\d+)(?:-(\d{1,2})(?=-|$))?(?:-|$)/i.exec(
      model,
    );
  const family = match?.[1]?.toLowerCase();
  const major = Number(match?.[2] ?? 0);
  const minor = Number(match?.[3] ?? 0);
  const adaptive = major >= 5 || (major === 4 && minor >= 6);
  return {
    structured: major >= 5 || (major === 4 && minor >= 5),
    thinking: major >= 4 || /^claude-3-7-/.test(model),
    adaptive,
    rejectsSampling:
      major >= 5 || (family === "opus" && major === 4 && minor >= 7),
  };
}

export function anthropicInputTokens(
  usage:
    | {
        input_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      }
    | undefined,
): number {
  return (
    (usage?.input_tokens ?? 0) +
    (usage?.cache_creation_input_tokens ?? 0) +
    (usage?.cache_read_input_tokens ?? 0)
  );
}

export function anthropicThinking(
  model: string,
  thinking: AnthropicThinking | undefined,
): Record<string, unknown> | undefined {
  if (!thinking) return undefined;
  if (thinking.type === "enabled") {
    if (anthropicModelRules(model).adaptive) {
      console.warn(
        `[llm-sdk] ${model}: using adaptive thinking instead of a legacy token budget.`,
      );
      return { type: "adaptive" };
    }
    return { type: "enabled", budget_tokens: thinking.budgetTokens ?? 10000 };
  }
  return { ...thinking };
}

export function anthropicTemperature(
  model: string,
  temperature: number | undefined,
  thinking = false,
): Record<string, unknown> {
  if (temperature === undefined) return {};
  if (thinking || anthropicModelRules(model).rejectsSampling) {
    console.warn(
      `[llm-sdk] ${model}: omitted temperature because this model or thinking mode does not support it.`,
    );
    return {};
  }
  return { temperature };
}
