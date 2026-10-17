import { textToolOutput } from "../../core/tool-output";
/**
 * OpenRouter Provider - Modern Pattern
 *
 * OpenRouter provides a unified API to access 500+ AI models from 60+ providers
 * (OpenAI, Anthropic, Google, Meta, Mistral, etc.) through a single endpoint.
 *
 * @example
 * ```ts
 * import { openrouter } from '@yourgpt/llm-sdk/openrouter';
 * import { generateText } from '@yourgpt/llm-sdk';
 *
 * const result = await generateText({
 *   model: openrouter('anthropic/claude-3.5-sonnet'),
 *   prompt: 'Hello!',
 * });
 * ```
 */

import type {
  LanguageModel,
  DoGenerateParams,
  DoGenerateResult,
  StreamChunk,
  ToolCall,
  FinishReason,
  CoreMessage,
} from "../../core/types";
import { toOpenAIResponseFormat } from "../../adapters/base";

// ============================================
// Model Configuration
// ============================================

/**
 * OpenRouter supports 500+ models dynamically.
 * Use fetchOpenRouterModels() to get live model list with accurate capabilities.
 * This default config is used as fallback for all models.
 */
const DEFAULT_MODEL_CONFIG = {
  vision: true,
  tools: true,
  jsonMode: true,
  maxTokens: 128000,
};

// ============================================
// Provider Options
// ============================================

export interface OpenRouterReasoningOptions {
  effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens?: number;
  enabled?: boolean;
  exclude?: boolean;
}

export interface OpenRouterProviderOptions {
  /** Omit to preserve the selected model's reasoning defaults. */
  reasoning?: OpenRouterReasoningOptions;
  /** API key (defaults to OPENROUTER_API_KEY env var) */
  apiKey?: string;
  /** Base URL for API (defaults to https://openrouter.ai/api/v1) */
  baseURL?: string;
  /** Your site URL for OpenRouter rankings (HTTP-Referer header) */
  siteUrl?: string;
  /** Your app name for OpenRouter rankings (X-Title header) */
  appName?: string;
  /** Provider preferences for routing */
  providerPreferences?: {
    /** Preferred providers (e.g., ['anthropic', 'openai']) */
    allow?: string[];
    /** Blocked providers */
    deny?: string[];
    /** Order preference: 'price' | 'latency' | 'throughput' */
    order?: "price" | "latency" | "throughput";
  };
}

// ============================================
// Provider Implementation
// ============================================

/**
 * Create an OpenRouter language model
 *
 * OpenRouter provides access to 500+ models through a single API.
 * Model IDs follow the format: provider/model-name
 *
 * @param modelId - Model ID (e.g., 'anthropic/claude-3.5-sonnet', 'openai/gpt-4o')
 * @param options - Provider options
 * @returns LanguageModel instance
 *
 * @example
 * ```ts
 * // Basic usage
 * const model = openrouter('anthropic/claude-3.5-sonnet');
 *
 * // With custom options
 * const model = openrouter('openai/gpt-4o', {
 *   apiKey: 'sk-or-...',
 *   siteUrl: 'https://myapp.com',
 *   appName: 'My App',
 * });
 *
 * // Use auto model selection
 * const model = openrouter('openrouter/auto');
 * ```
 */
export function openrouter(
  modelId: string,
  options: OpenRouterProviderOptions = {},
): LanguageModel {
  function reasoning(params: DoGenerateParams) {
    const configured = options.reasoning;
    if (!configured && params.reasoningEffort === undefined) return {};
    const effort = params.reasoningEffort ?? configured?.effort;
    const budget = configured?.maxTokens;
    if (effort !== undefined && budget !== undefined) {
      throw new Error(
        "OpenRouter reasoning accepts effort or maxTokens, not both",
      );
    }
    if (
      budget !== undefined &&
      (!Number.isSafeInteger(budget) || budget <= 0)
    ) {
      throw new Error(
        "OpenRouter reasoning maxTokens must be a positive integer",
      );
    }
    return {
      reasoning: {
        ...(effort !== undefined ? { effort } : {}),
        ...(budget !== undefined ? { max_tokens: budget } : {}),
        ...(configured?.enabled !== undefined
          ? { enabled: configured.enabled }
          : {}),
        ...(configured?.exclude !== undefined
          ? { exclude: configured.exclude }
          : {}),
      },
    };
  }
  const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY;
  const baseURL = options.baseURL ?? "https://openrouter.ai/api/v1";

  // Build headers
  const headers: Record<string, string> = {};
  if (options.siteUrl) {
    headers["HTTP-Referer"] = options.siteUrl;
  }
  if (options.appName) {
    headers["X-Title"] = options.appName;
  }

  // Lazy-load OpenAI client (OpenRouter uses OpenAI-compatible API)
  let client: any = null;
  async function getClient(): Promise<any> {
    if (!client) {
      const { default: OpenAI } = await import("openai");
      client = new OpenAI({
        apiKey,
        baseURL,
        defaultHeaders: headers,
      });
    }
    return client;
  }

  // Use default config for all models
  // Use fetchOpenRouterModels() to get accurate model-specific capabilities
  const modelConfig = DEFAULT_MODEL_CONFIG;

  return {
    provider: "openrouter",
    modelId,

    capabilities: {
      supportsVision: modelConfig.vision,
      supportsTools: modelConfig.tools,
      supportsStreaming: true,
      supportsJsonMode: modelConfig.jsonMode,
      supportsThinking: options.reasoning !== undefined,
      supportsPDF: false,
      maxTokens: modelConfig.maxTokens,
      supportedImageTypes: modelConfig.vision
        ? ["image/png", "image/jpeg", "image/gif", "image/webp"]
        : [],
    },

    async doGenerate(params: DoGenerateParams): Promise<DoGenerateResult> {
      const client = await getClient();

      const messages = formatMessagesForOpenRouter(params.messages);

      // Build request body
      const requestBody: any = {
        model: modelId,
        messages,
        temperature: params.temperature,
        max_tokens: params.maxTokens,
        ...reasoning(params),
      };

      // Add tools if provided
      if (params.tools) {
        requestBody.tools = params.tools;
      }

      // Add provider preferences if configured
      if (options.providerPreferences) {
        requestBody.provider = options.providerPreferences;
      }

      const responseFormat = toOpenAIResponseFormat(params.responseFormat);
      if (responseFormat) {
        requestBody.response_format = responseFormat;
      }

      const response = await client.chat.completions.create(requestBody, {
        signal: params.signal,
      });

      const choice = response.choices[0];
      const message = choice.message;

      // Parse tool calls
      const toolCalls: ToolCall[] = (message.tool_calls ?? []).map(
        (tc: any) => ({
          id: tc.id,
          name: tc.function.name,
          args: JSON.parse(tc.function.arguments || "{}"),
        }),
      );

      return {
        text: message.content ?? "",
        ...(reasoningTextFor(message)
          ? { reasoningText: reasoningTextFor(message) }
          : {}),
        ...reasoningMetadata(message.reasoning_details),
        toolCalls,
        finishReason: mapFinishReason(choice.finish_reason),
        usage: {
          promptTokens: response.usage?.prompt_tokens ?? 0,
          completionTokens: response.usage?.completion_tokens ?? 0,
          totalTokens: response.usage?.total_tokens ?? 0,
        },
        rawResponse: response,
      };
    },

    async *doStream(params: DoGenerateParams): AsyncGenerator<StreamChunk> {
      const client = await getClient();

      const messages = formatMessagesForOpenRouter(params.messages);

      // Build request body
      const requestBody: any = {
        model: modelId,
        messages,
        temperature: params.temperature,
        max_tokens: params.maxTokens,
        ...reasoning(params),
        stream: true,
        stream_options: { include_usage: true },
      };

      // Add tools if provided
      if (params.tools) {
        requestBody.tools = params.tools;
      }

      // Add provider preferences if configured
      if (options.providerPreferences) {
        requestBody.provider = options.providerPreferences;
      }

      const responseFormat = toOpenAIResponseFormat(params.responseFormat);
      if (responseFormat) {
        requestBody.response_format = responseFormat;
      }

      const stream = await client.chat.completions.create(requestBody, {
        signal: params.signal,
      });

      // Keep parallel tool argument streams separate by their provider index.
      const calls = new Map<
        number,
        { id: string; name: string; arguments: string }
      >();
      const details: Record<string, any>[] = [];
      let finishReason: FinishReason = "unknown";
      let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      for await (const chunk of stream) {
        if (params.signal?.aborted)
          throw params.signal.reason ?? new Error("Aborted");
        const choice = chunk.choices?.[0];
        const delta = choice?.delta;
        if (chunk.usage)
          usage = {
            promptTokens: chunk.usage.prompt_tokens ?? 0,
            completionTokens: chunk.usage.completion_tokens ?? 0,
            totalTokens:
              chunk.usage.total_tokens ??
              (chunk.usage.prompt_tokens ?? 0) +
                (chunk.usage.completion_tokens ?? 0),
          };
        const reasoningText = reasoningTextFor(delta);
        if (typeof reasoningText === "string" && reasoningText) {
          yield { type: "reasoning-delta", text: reasoningText };
        }
        for (const detail of delta?.reasoning_details ?? []) {
          const last = details.at(-1);
          const field =
            detail.type === "reasoning.text"
              ? "text"
              : detail.type === "reasoning.summary"
                ? "summary"
                : undefined;
          // Indices can repeat across distinct blocks. Encrypted data is opaque;
          // concatenate only adjacent text/summary deltas, never signatures/blobs.
          if (
            field &&
            last &&
            last.type === detail.type &&
            (!detail.id || !last.id || detail.id === last.id)
          ) {
            last[field] = (last[field] ?? "") + (detail[field] ?? "");
            last.signature ??= detail.signature;
            last.format ??= detail.format;
          } else details.push({ ...detail });
        }
        if (delta?.content) yield { type: "text-delta", text: delta.content };
        for (const tc of delta?.tool_calls ?? []) {
          const index = tc.index ?? 0;
          const call = calls.get(index) ?? { id: "", name: "", arguments: "" };
          if (tc.id) call.id = tc.id;
          if (tc.function?.name) call.name = tc.function.name;
          if (tc.function?.arguments) call.arguments += tc.function.arguments;
          calls.set(index, call);
        }
        if (choice?.finish_reason)
          finishReason = mapFinishReason(choice.finish_reason);
      }
      // Parse all calls before yielding any, so malformed arguments cannot partially execute.
      const parsed = [...calls.values()].map((call) => ({
        id: call.id,
        name: call.name,
        args: JSON.parse(call.arguments || "{}"),
      }));
      for (const toolCall of parsed) yield { type: "tool-call", toolCall };
      yield {
        type: "finish",
        finishReason,
        usage,
        ...reasoningMetadata(details),
      };
    },
  };
}

// ============================================
// Helper Functions
// ============================================

/**
 * Map OpenRouter finish reason to our FinishReason type
 */
function mapFinishReason(reason: string | null): FinishReason {
  switch (reason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "tool_calls":
    case "function_call":
      return "tool-calls";
    case "content_filter":
      return "content-filter";
    default:
      return "unknown";
  }
}

/**
 * Format CoreMessage[] for OpenRouter API (OpenAI-compatible)
 */
function formatMessagesForOpenRouter(messages: CoreMessage[]): any[] {
  return messages.map((msg) => {
    switch (msg.role) {
      case "system":
        return { role: "system", content: msg.content };

      case "user":
        if (typeof msg.content === "string") {
          return { role: "user", content: msg.content };
        }
        // Handle multimodal content
        return {
          role: "user",
          content: msg.content.map((part) => {
            if (part.type === "text") {
              return { type: "text", text: part.text };
            }
            if (part.type === "image") {
              const imageData =
                typeof part.image === "string"
                  ? part.image
                  : Buffer.from(part.image).toString("base64");
              const url = /^(data:|https?:\/\/)/.test(imageData)
                ? imageData
                : `data:${part.mimeType ?? "image/png"};base64,${imageData}`;
              return { type: "image_url", image_url: { url, detail: "auto" } };
            }
            return { type: "text", text: "" };
          }),
        };

      case "assistant":
        const assistantMsg: any = {
          role: "assistant",
          content: msg.content,
        };
        const details = (
          msg.providerMetadata?.openrouter as
            | { reasoningDetails?: unknown[] }
            | undefined
        )?.reasoningDetails;
        if (Array.isArray(details) && details.length)
          assistantMsg.reasoning_details = details;
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          assistantMsg.tool_calls = msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.args),
            },
          }));
        }
        return assistantMsg;

      case "tool":
        return {
          role: "tool",
          tool_call_id: msg.toolCallId,
          content: textToolOutput(msg.modelOutput, msg.content),
        };

      default:
        return msg;
    }
  });
}

// ============================================
// Models API - Fetch available models
// ============================================

/**
 * OpenRouter model information from the API
 */
export interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  pricing: {
    prompt: string;
    completion: string;
  };
  context_length: number;
  architecture?: {
    modality?: string;
    tokenizer?: string;
    instruct_type?: string | null;
  };
  top_provider?: {
    context_length: number;
    max_completion_tokens: number;
    is_moderated: boolean;
  };
  per_request_limits?: {
    prompt_tokens?: string;
    completion_tokens?: string;
  };
}

/**
 * Fetch available models from OpenRouter API
 *
 * @param apiKey - Optional API key (not required for listing models)
 * @returns Array of available models
 *
 * @example
 * ```ts
 * const models = await fetchOpenRouterModels();
 * console.log(models.map(m => m.id));
 * ```
 */
export async function fetchOpenRouterModels(
  apiKey?: string,
): Promise<OpenRouterModel[]> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const response = await fetch("https://openrouter.ai/api/v1/models", {
    headers,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch models: ${response.statusText}`);
  }

  const data = (await response.json()) as { data?: OpenRouterModel[] };
  return data.data || [];
}

/**
 * Search OpenRouter models by name, ID, or provider
 *
 * @param query - Search query
 * @param apiKey - Optional API key
 * @returns Filtered models matching the query
 *
 * @example
 * ```ts
 * const claudeModels = await searchOpenRouterModels('claude');
 * const gptModels = await searchOpenRouterModels('gpt');
 * ```
 */
export async function searchOpenRouterModels(
  query: string,
  apiKey?: string,
): Promise<OpenRouterModel[]> {
  const models = await fetchOpenRouterModels(apiKey);
  const lowerQuery = query.toLowerCase();

  return models.filter(
    (model) =>
      model.id.toLowerCase().includes(lowerQuery) ||
      model.name.toLowerCase().includes(lowerQuery),
  );
}

// Also export as createOpenRouter for backward compatibility
export { openrouter as createOpenRouter };

// Keep replay state separate from the raw response. Known reasoning fields only;
// provider diagnostics must not become conversation metadata.
function reasoningMetadata(details: unknown) {
  if (!Array.isArray(details) || !details.length) return {};
  const fields = [
    "type",
    "text",
    "summary",
    "data",
    "signature",
    "id",
    "format",
    "index",
  ];
  const reasoningDetails = details
    .filter((detail) => detail && typeof detail === "object")
    .map((detail) =>
      Object.fromEntries(
        fields
          .filter((key) => detail[key] !== undefined)
          .map((key) => [key, structuredClone(detail[key])]),
      ),
    );
  return { providerMetadata: { openrouter: { reasoningDetails } } };
}

function reasoningTextFor(message: any): string | undefined {
  const text = message?.reasoning ?? message?.reasoning_content;
  if (typeof text === "string" && text) return text;
  if (!Array.isArray(message?.reasoning_details)) return undefined;
  const parts = message.reasoning_details.flatMap((detail: any) => {
    const value =
      detail?.type === "reasoning.text"
        ? detail.text
        : detail?.type === "reasoning.summary"
          ? detail.summary
          : undefined;
    return typeof value === "string" ? [value] : [];
  });
  return parts.length ? parts.join("") : undefined;
}
