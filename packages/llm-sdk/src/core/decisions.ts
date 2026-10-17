import {
  validateDecisionInput,
  validateDecisionResult,
} from "./decision-validation";

export type DecisionJSON =
  | null
  | boolean
  | number
  | string
  | readonly DecisionJSON[]
  | { readonly [key: string]: DecisionJSON };
/** Native structured state, not a chat message list. JSON arrays remain JSON arrays. */
export type DecisionInput =
  | string
  | readonly DecisionJSON[]
  | { readonly [key: string]: DecisionJSON };
export type DecisionQuestion =
  | {
      readonly type: "boolean";
      readonly instructions: DecisionInput;
      readonly criteria?: {
        readonly true?: DecisionInput;
        readonly false?: DecisionInput;
      };
    }
  | {
      readonly type: "choice";
      readonly instructions: DecisionInput;
      readonly criteria: Readonly<Record<string, DecisionInput | null>>;
    }
  | {
      readonly type: "score";
      readonly instructions: DecisionInput;
      readonly criteria: readonly DecisionInput[];
    };
export type DecisionQuestions = Readonly<Record<string, DecisionQuestion>>;
export interface DecisionImage {
  /** Encoded file bytes or a public HTTP(S) URL. Only OpenAI accepts URLs. */
  data: Uint8Array | URL;
  mediaType?: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  /** OpenAI image detail. Other providers reject this setting. */
  detail?: "auto" | "low" | "high" | "original";
}
export interface DecisionOptions {
  state: DecisionInput;
  questions: DecisionQuestions;
  /** Images are supplied alongside shared state; no remote downloads are performed. */
  images?: readonly DecisionImage[];
  signal?: AbortSignal;
  /** Whole request, including reading its response. Defaults to 60 seconds. */
  timeoutMs?: number;
  providerOptions?: {
    openai?: { safetyIdentifier?: string; promptCacheKey?: string };
    typesafe?: { longContext?: boolean };
    openrouter?: {
      sessionId?: string;
      provider?: { order?: readonly string[]; allowFallbacks?: boolean };
    };
  };
}
export type DecisionAnswer =
  | { type: "boolean"; probability: number }
  | {
      type: "choice";
      choice: string;
      probabilities?: Record<string, number>;
      confidence?: number;
    }
  | {
      type: "score";
      score: number;
      probabilities?: Record<string, number>;
      confidence?: number;
    }
  | { type: "refusal" };
type AnswerFor<Q extends DecisionQuestion> =
  | Extract<DecisionAnswer, { type: "refusal" }>
  | (Q extends { type: "choice"; criteria: infer C }
      ? {
          type: "choice";
          choice: Extract<keyof C, string>;
          probabilities?: Record<Extract<keyof C, string>, number>;
          confidence?: number;
        }
      : Extract<DecisionAnswer, { type: Q["type"] }>);
export interface DecisionResult<
  Q extends DecisionQuestions = DecisionQuestions,
> {
  answers: { [K in keyof Q]: AnswerFor<Q[K]> };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    cachedInputTokens?: number;
    cacheWriteTokens?: number;
    costUsd?: number;
  };
  response: {
    provider: string;
    modelId: string;
    requestId?: string;
    status?: number;
    body?: unknown;
  };
  /** Only supplied by adapters whose upstream is known to round its values. */
  rounding?: { probabilityDecimals: number; scoreDecimals: number };
}
/** Separate from LanguageModel: native decisions do not generate text or execute tools. */
export interface DecisionModel {
  readonly provider: string;
  readonly modelId: string;
  doDecide(options: DecisionOptions): Promise<DecisionResult>;
}
export type DecisionErrorCode =
  | "invalid_input"
  | "unsupported_option"
  | "invalid_response"
  | "refusal"
  | "http_error"
  | "network_error";
const decisionErrorMarker = Symbol.for("yourgpt.llm-sdk.DecisionAPIError");
export class DecisionAPIError extends Error {
  readonly name = "DecisionAPIError";
  private readonly [decisionErrorMarker] = true;
  /** Works across CJS/ESM and separately bundled provider entry points. */
  static isInstance(error: unknown): error is DecisionAPIError {
    return (
      typeof error === "object" &&
      error !== null &&
      Symbol.for("yourgpt.llm-sdk.DecisionAPIError") in error
    );
  }
  constructor(
    message: string,
    readonly code: DecisionErrorCode,
    readonly status?: number,
    readonly requestId?: string,
  ) {
    super(message);
  }
  /** Advisory only: this SDK does not retry Decisions automatically. */
  get retryable(): boolean {
    return (
      this.code === "network_error" ||
      (this.code === "http_error" &&
        (this.status === 408 ||
          this.status === 429 ||
          (this.status != null && this.status >= 500)))
    );
  }
}

/** Experimental: native provider contracts can change during this beta. */
export async function experimental_decide<const Q extends DecisionQuestions>(
  options: Omit<DecisionOptions, "questions"> & {
    model: DecisionModel;
    questions: Q;
  },
): Promise<DecisionResult<Q>> {
  const { model, ...request } = options;
  validateDecisionInput(request);
  request.signal?.throwIfAborted();
  const result = await model.doDecide(request);
  request.signal?.throwIfAborted();
  validateDecisionResult(request.questions, result);
  return result as DecisionResult<Q>;
}
