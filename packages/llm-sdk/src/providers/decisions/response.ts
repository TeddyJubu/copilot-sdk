import {
  DecisionAPIError,
  type DecisionAnswer,
  type DecisionQuestions,
  type DecisionResult,
} from "../../core/decisions";
import {
  decisionResponseError,
  isDecisionRecord,
  validateDecisionResult,
} from "../../core/decision-validation";

function distribution(value: unknown, score: boolean): Record<string, number> {
  if (!Array.isArray(value))
    decisionResponseError(
      "OpenAI Decisions omitted its probability distribution",
    );
  const entries: Array<[string, number]> = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (
      !isDecisionRecord(item) ||
      (score
        ? typeof item.value !== "number" ||
          !Number.isInteger(item.value) ||
          item.value < 0
        : typeof item.value !== "string")
    )
      decisionResponseError("Invalid decision probability option");
    const key = String(item.value);
    if (seen.has(key))
      decisionResponseError("Duplicate option in decision probabilities");
    seen.add(key);
    entries.push([key, item.probability as number]);
  }
  return Object.fromEntries(entries);
}
export function parseDecisionResponse(
  raw: unknown,
  provider: string,
  questions: DecisionQuestions,
  status: number,
  requestId?: string,
): DecisionResult {
  if (!isDecisionRecord(raw))
    decisionResponseError("Decision response must be an object");
  let payload = raw;
  if (provider === "cloudflare") {
    if (raw.success === false)
      throw new DecisionAPIError(
        "Cloudflare reported an unsuccessful decision request",
        "http_error",
        status,
        requestId,
      );
    if (raw.success !== true || !isDecisionRecord(raw.result))
      decisionResponseError(
        "Cloudflare Decisions returned an invalid result envelope",
      );
    payload = raw.result;
  }
  if (typeof payload.model !== "string" || !payload.model)
    decisionResponseError("Decision response omitted its model identity");
  const entries: Array<[string, unknown]> = [];
  if (provider === "openai") {
    if (!Array.isArray(payload.answers))
      decisionResponseError("OpenAI Decisions answers must be an array");
    const seen = new Set<string>();
    for (const answer of payload.answers) {
      if (!isDecisionRecord(answer))
        decisionResponseError("Invalid OpenAI decision answer");
      if (answer.type === "refusal" && answer.name == null)
        throw new DecisionAPIError(
          "OpenAI refused an unnamed decision question",
          "refusal",
          status,
          requestId,
        );
      if (typeof answer.name !== "string" || seen.has(answer.name))
        decisionResponseError(
          "OpenAI decision answers have missing or duplicate question identities",
        );
      seen.add(answer.name);
      entries.push([answer.name, answer]);
    }
  } else {
    if (!isDecisionRecord(payload.answers))
      decisionResponseError("Decisions answers must be a named map");
    entries.push(...Object.entries(payload.answers));
  }
  const answers = Object.fromEntries(
    entries.map(([id, value]): [string, DecisionAnswer] => {
      if (!isDecisionRecord(value))
        decisionResponseError("Invalid decision answer");
      if (value.type === "refusal" && provider === "openai")
        return [id, { type: "refusal" }];
      const booleanType = provider === "openai" ? "predicate" : "noul";
      if (value.type === booleanType)
        return [
          id,
          {
            type: "boolean",
            probability: (provider === "openai"
              ? value.probability
              : value.noul) as number,
          },
        ];
      if (value.type !== "choice" && value.type !== "score")
        decisionResponseError(
          "Provider returned an unsupported decision answer type",
        );
      if (provider !== "openrouter" && value.probabilities == null)
        decisionResponseError(
          "Provider omitted a required decision distribution",
        );
      const probabilities =
        provider === "openai"
          ? distribution(value.probabilities, value.type === "score")
          : value.probabilities;
      const fields = {
        ...(probabilities !== undefined && {
          probabilities: probabilities as Record<string, number>,
        }),
        ...(value.confidence != null && {
          confidence: value.confidence as number,
        }),
      };
      return [
        id,
        value.type === "choice"
          ? { type: "choice", choice: value.choice as string, ...fields }
          : { type: "score", score: value.score as number, ...fields },
      ];
    }),
  );
  const result: DecisionResult = {
    answers,
    response: {
      provider,
      modelId: payload.model,
      status,
      requestId:
        requestId ?? (typeof payload.id === "string" ? payload.id : undefined),
      body: raw,
    },
  };
  const typesafe =
    provider === "typesafe" ||
    (provider === "openrouter" &&
      (payload.model.startsWith("typesafe/") ||
        payload.provider === "TypeSafe"));
  if (typesafe) result.rounding = { probabilityDecimals: 2, scoreDecimals: 2 };
  if (payload.usage != null) {
    if (!isDecisionRecord(payload.usage))
      decisionResponseError("Invalid decision usage");
    const usage = payload.usage;
    const details = isDecisionRecord(usage.input_tokens_details)
      ? usage.input_tokens_details
      : {};
    result.usage = {};
    const mapped = {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      totalTokens: usage.total_tokens,
      cachedInputTokens: details.cached_tokens,
      cacheWriteTokens: details.cache_write_tokens,
      costUsd: usage.cost,
    };
    for (const [key, value] of Object.entries(mapped)) {
      if (value == null) continue;
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < 0 ||
        (key !== "costUsd" && !Number.isInteger(value))
      )
        decisionResponseError("Invalid decision usage count");
      (result.usage as Record<string, number>)[key] = value;
    }
  }
  validateDecisionResult(questions, result);
  return result;
}
