import {
  requiresOpenAIResponses,
  type OpenAIParameterOptions,
} from "./openai-parameters";

/** Responses-only options. Omitted values retain the API's defaults. */
export interface OpenAIResponsesOptions {
  store?: boolean;
  /** Send only new input after this stored response; do not also resend its history. */
  previousResponseId?: string;
  include?: string[];
  reasoningSummary?: "auto" | "concise" | "detailed";
  promptCacheKey?: string;
  /** Legacy retention option for models that support it. */
  promptCacheRetention?: "in_memory" | "24h";
  /** GPT-5.6+ cache mode and minimum lifetime; provider/model support varies. */
  promptCacheOptions?: { mode?: "implicit" | "explicit"; ttl?: "30m" };
}

export interface OpenAITransportOptions {
  /** auto preserves existing routing; responses also works without function tools. */
  api?: "auto" | "chat" | "responses";
  responses?: OpenAIResponsesOptions;
}

/** Opaque provider items: retain their complete contents and order for replay. */
export interface OpenAIResponseItem {
  type: string;
  [key: string]: unknown;
}

export interface OpenAIResponseMetadata {
  id?: string;
  model?: string;
  status?: string;
  output: OpenAIResponseItem[];
  usage?: Record<string, unknown>;
  store?: boolean;
  refusals: string[];
}

export interface ProviderMetadata {
  openai?: { response?: OpenAIResponseMetadata };
  [provider: string]: unknown;
}

export function resolveOpenAITransport(
  defaults: OpenAITransportOptions,
  overrides?: OpenAITransportOptions,
): OpenAITransportOptions {
  return {
    api: overrides?.api ?? defaults.api ?? "auto",
    responses:
      defaults.responses !== undefined || overrides?.responses !== undefined
        ? { ...defaults.responses, ...overrides?.responses }
        : undefined,
  };
}

export function useOpenAIResponses(
  model: string,
  baseURL: string | undefined,
  parameters: OpenAIParameterOptions,
  transport: OpenAITransportOptions,
  hasTools: boolean,
  hasReplay: boolean,
  nativeToolSearch = false,
): boolean {
  const api = transport.api ?? "auto";
  if (!["auto", "chat", "responses"].includes(api)) {
    throw new Error(`Unknown OpenAI API selection: ${api}`);
  }
  if (api === "chat") {
    if (transport.responses !== undefined || nativeToolSearch) {
      throw new Error(
        "Responses options and native tool search require the Responses API",
      );
    }
    return false;
  }
  let officialEndpoint = !baseURL;
  try {
    officialEndpoint =
      !baseURL || new URL(baseURL).hostname === "api.openai.com";
  } catch {
    /* Custom/invalid endpoints retain legacy routing. */
  }
  return (
    api === "responses" ||
    transport.responses !== undefined ||
    (hasReplay && officialEndpoint) ||
    nativeToolSearch ||
    (hasTools && requiresOpenAIResponses(model, baseURL, parameters))
  );
}

export function responseMetadata(response: any): ProviderMetadata {
  const output: OpenAIResponseItem[] = Array.isArray(response?.output)
    ? response.output
    : [];
  return {
    openai: {
      response: {
        id: response?.id,
        model: response?.model,
        status: response?.status,
        output,
        usage: response?.usage,
        store: response?.store,
        refusals: output.flatMap((item: any) =>
          item?.type === "message" && Array.isArray(item.content)
            ? item.content
                .filter(
                  (part: any) =>
                    part?.type === "refusal" &&
                    typeof part.refusal === "string",
                )
                .map((part: any) => part.refusal)
            : [],
        ),
      },
    },
  };
}

export function getResponseReplay(
  metadata: unknown,
): OpenAIResponseItem[] | undefined {
  const response = (metadata as ProviderMetadata | undefined)?.openai?.response;
  if (response === undefined) return undefined;
  if (
    !Array.isArray(response.output) ||
    response.output.some((item) => !item || typeof item.type !== "string")
  ) {
    throw new Error(
      "Invalid OpenAI Responses replay metadata: output must contain typed items",
    );
  }
  return response.output;
}
