import {
  DecisionAPIError,
  type DecisionOptions,
  type DecisionQuestions,
  type DecisionResult,
} from "./decisions";

export function decisionInputError(message: string): never {
  throw new DecisionAPIError(message, "invalid_input");
}
export function decisionResponseError(message: string): never {
  throw new DecisionAPIError(message, "invalid_response");
}
export function isDecisionRecord(
  value: unknown,
): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function json(value: unknown, seen = new Set<object>(), depth = 0): boolean {
  if (depth > 64) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (
    typeof value !== "object" ||
    (!Array.isArray(value) && !isDecisionRecord(value)) ||
    seen.has(value)
  )
    return false;
  seen.add(value);
  const valid =
    Object.getOwnPropertySymbols(value).length === 0 &&
    (Array.isArray(value) ? Array.from(value) : Object.values(value)).every(
      (item) => json(item, seen, depth + 1),
    );
  seen.delete(value);
  return valid;
}
function input(value: unknown): boolean {
  return (
    (typeof value === "string" ||
      Array.isArray(value) ||
      isDecisionRecord(value)) &&
    json(value)
  );
}
export function assertDecisionKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    decisionInputError(`${label} contains an unsupported field`);
}
export function validateDecisionInput(options: DecisionOptions): void {
  if (!isDecisionRecord(options))
    decisionInputError("Decisions options must be an object");
  assertDecisionKeys(
    options,
    ["state", "questions", "images", "signal", "timeoutMs", "providerOptions"],
    "Decisions options",
  );
  if (!input(options.state))
    decisionInputError(
      "state must be finite, acyclic JSON text, object, or array (maximum depth 64)",
    );
  if (
    !isDecisionRecord(options.questions) ||
    Object.keys(options.questions).length === 0
  )
    decisionInputError("questions must be a nonempty map");
  for (const [id, question] of Object.entries(options.questions)) {
    if (
      !id.length ||
      !isDecisionRecord(question) ||
      !input(question.instructions)
    )
      decisionInputError(
        "Every question needs a nonempty ID and JSON-compatible instructions",
      );
    assertDecisionKeys(
      question,
      ["type", "instructions", "criteria"],
      "Question",
    );
    if (question.type === "boolean") {
      if (
        question.criteria !== undefined &&
        (!isDecisionRecord(question.criteria) ||
          Object.entries(question.criteria).some(
            ([key, value]) => !["true", "false"].includes(key) || !input(value),
          ))
      )
        decisionInputError("Boolean criteria may describe only true and false");
    } else if (question.type === "choice") {
      if (
        !isDecisionRecord(question.criteria) ||
        Object.keys(question.criteria).length < 2 ||
        Object.keys(question.criteria).length > 255 ||
        Object.entries(question.criteria).some(
          ([key, value]) => !key.length || (value !== null && !input(value)),
        )
      )
        decisionInputError(
          "Choice criteria require 2–255 named options with JSON descriptions or null",
        );
    } else if (question.type === "score") {
      if (
        !Array.isArray(question.criteria) ||
        question.criteria.length < 2 ||
        !Array.from(question.criteria).every(input)
      )
        decisionInputError(
          "Score criteria require at least two ordered JSON descriptions",
        );
    } else
      decisionInputError("Question type must be boolean, choice, or score");
  }
  if (
    options.timeoutMs !== undefined &&
    (!Number.isInteger(options.timeoutMs) ||
      options.timeoutMs < 1 ||
      options.timeoutMs > 2_147_483_647)
  )
    decisionInputError("timeoutMs must be a positive 32-bit integer");
  if (
    options.providerOptions !== undefined &&
    (!isDecisionRecord(options.providerOptions) ||
      !json(options.providerOptions))
  )
    decisionInputError("providerOptions must be a JSON object");
  if (
    options.images !== undefined &&
    (!Array.isArray(options.images) ||
      !Array.from(options.images).every(
        (image) => isDecisionRecord(image) && image.data instanceof Uint8Array,
      ))
  )
    decisionInputError(
      "Decision images must contain encoded bytes; hosted image URLs are unsupported",
    );
}
function probability(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}
export function validateDecisionResult(
  questions: DecisionQuestions,
  result: DecisionResult,
): void {
  if (
    !isDecisionRecord(result) ||
    !isDecisionRecord(result.answers) ||
    !exactKeys(result.answers, Object.keys(questions))
  )
    decisionResponseError(
      "Decisions must return exactly one answer per question",
    );
  const rounding = result.rounding;
  let pError = 0,
    sError = 0;
  if (rounding !== undefined) {
    if (
      !isDecisionRecord(rounding) ||
      ![rounding.probabilityDecimals, rounding.scoreDecimals].every(
        (v) =>
          typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 15,
      )
    )
      decisionResponseError("Invalid decision rounding precision");
    pError = 0.5 * 10 ** -rounding.probabilityDecimals;
    sError = 0.5 * 10 ** -rounding.scoreDecimals;
  }
  const epsilon = 1e-6;
  for (const [id, question] of Object.entries(questions)) {
    const answer: unknown = result.answers[id];
    if (!isDecisionRecord(answer))
      decisionResponseError("Invalid decision answer");
    if (answer.type === "refusal") continue;
    if (answer.type !== question.type)
      decisionResponseError("Decision answer type does not match its question");
    if (answer.confidence !== undefined && !probability(answer.confidence))
      decisionResponseError(
        "Confidence must be finite and between zero and one",
      );
    if (question.type === "boolean") {
      if (!probability(answer.probability))
        decisionResponseError(
          "Boolean probability must be between zero and one",
        );
      continue;
    }
    const keys =
      question.type === "choice"
        ? Object.keys(question.criteria)
        : question.criteria.map((_, index) => String(index));
    if (
      question.type === "choice" &&
      (typeof answer.choice !== "string" || !keys.includes(answer.choice))
    )
      decisionResponseError("Decision selected an unknown choice");
    if (
      question.type === "score" &&
      (typeof answer.score !== "number" ||
        !Number.isFinite(answer.score) ||
        answer.score < 0 ||
        answer.score > keys.length - 1)
    )
      decisionResponseError("Decision score is outside its ordered levels");
    if (answer.probabilities === undefined) continue;
    const distribution = answer.probabilities;
    if (
      !isDecisionRecord(distribution) ||
      !exactKeys(distribution, keys) ||
      !Object.values(distribution).every(probability)
    )
      decisionResponseError(
        "Decision distribution must contain every option exactly once with finite probabilities",
      );
    const values = Object.values(distribution) as number[];
    if (
      Math.abs(values.reduce((a, b) => a + b, 0) - 1) >
      epsilon + keys.length * pError
    )
      decisionResponseError("Decision probabilities do not sum to one");
    if (question.type === "choice") {
      if (
        values.some(
          (v) =>
            v >
            (distribution[answer.choice as string] as number) +
              epsilon +
              2 * pError,
        )
      )
        decisionResponseError(
          "Decision choice is not a highest-probability option",
        );
    } else {
      const mean = keys.reduce(
        (sum, key) => sum + Number(key) * (distribution[key] as number),
        0,
      );
      const tolerance =
        epsilon +
        sError +
        pError * keys.reduce((sum, key) => sum + Number(key), 0);
      if (Math.abs((answer.score as number) - mean) > tolerance)
        decisionResponseError(
          "Decision score does not match its probability-weighted levels",
        );
    }
  }
}
