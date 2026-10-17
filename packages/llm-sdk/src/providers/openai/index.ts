/**
 * OpenAI Provider
 *
 * Modern pattern: openai('gpt-4o') returns a LanguageModel
 * Legacy pattern: createOpenAI({ apiKey }) returns an AIProvider
 */

// NEW: Modern pattern - openai() function
export { openai, createOpenAI as createOpenAIModel } from "./provider";
export { openaiDecision } from "./decisions";
export type { OpenAIDecisionProviderOptions } from "./decisions";
export type { OpenAIProviderOptions } from "./provider";

import { createOpenAIAdapter } from "../../adapters/openai";
import {
  createCallableProvider,
  type AIProvider,
  type ProviderCapabilities,
  type OpenAIProviderConfig,
} from "../types";

// ============================================
// Model Definitions
// ============================================

interface ModelCapabilities {
  vision: boolean;
  tools: boolean;
  audio: boolean;
  jsonMode: boolean;
  maxTokens: number;
}

const OPENAI_MODELS: Record<string, ModelCapabilities> = {
  // GPT-4o series
  "gpt-4o": {
    vision: true,
    tools: true,
    audio: true,
    jsonMode: true,
    maxTokens: 128000,
  },
  "gpt-5.2": {
    vision: true,
    tools: true,
    audio: false,
    jsonMode: true,
    maxTokens: 128000,
  },
  "gpt-4o-2024-11-20": {
    vision: true,
    tools: true,
    audio: true,
    jsonMode: true,
    maxTokens: 128000,
  },
  "gpt-4o-2024-08-06": {
    vision: true,
    tools: true,
    audio: false,
    jsonMode: true,
    maxTokens: 128000,
  },

  // GPT-4 Turbo series
  "gpt-4-turbo": {
    vision: true,
    tools: true,
    audio: false,
    jsonMode: true,
    maxTokens: 128000,
  },
  "gpt-4-turbo-preview": {
    vision: false,
    tools: true,
    audio: false,
    jsonMode: true,
    maxTokens: 128000,
  },

  // GPT-4 series
  "gpt-4": {
    vision: false,
    tools: true,
    audio: false,
    jsonMode: false,
    maxTokens: 8192,
  },
  "gpt-4-32k": {
    vision: false,
    tools: true,
    audio: false,
    jsonMode: false,
    maxTokens: 32768,
  },

  // GPT-3.5 series
  "gpt-3.5-turbo": {
    vision: false,
    tools: true,
    audio: false,
    jsonMode: true,
    maxTokens: 16385,
  },
  "gpt-3.5-turbo-16k": {
    vision: false,
    tools: true,
    audio: false,
    jsonMode: true,
    maxTokens: 16385,
  },

  // O1 reasoning series
  o1: {
    vision: true,
    tools: false, // O1 doesn't support tools yet
    audio: false,
    jsonMode: false,
    maxTokens: 128000,
  },
  "o1-mini": {
    vision: true,
    tools: false,
    audio: false,
    jsonMode: false,
    maxTokens: 128000,
  },
  "o1-preview": {
    vision: true,
    tools: false,
    audio: false,
    jsonMode: false,
    maxTokens: 128000,
  },

  // O3 reasoning series
  "o3-mini": {
    vision: true,
    tools: false,
    audio: false,
    jsonMode: false,
    maxTokens: 128000,
  },
};

// ============================================
// Provider Implementation
// ============================================

/**
 * Create an OpenAI provider (callable, Vercel AI SDK style)
 *
 * @example
 * ```typescript
 * import { createOpenAI } from '@yourgpt/llm-sdk/openai';
 *
 * const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
 *
 * // Callable - Vercel AI SDK style
 * const model = openai('gpt-4o');
 *
 * // Also works with createRuntime (backward compatible)
 * const runtime = createRuntime({
 *   provider: openai,
 *   model: 'gpt-4o',
 * });
 *
 * // Check capabilities
 * const caps = openai.getCapabilities('gpt-4o');
 * ```
 */
export function createOpenAI(config: OpenAIProviderConfig = {}): AIProvider {
  const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY ?? "";

  // Create the callable function
  const providerFn = (modelId: string) => {
    return createOpenAIAdapter({
      apiKey,
      model: modelId,
      baseUrl: config.baseUrl,
      reasoningEffort: config.reasoningEffort,
      api: config.api,
      responses: config.responses,
      parameterPolicy: config.parameterPolicy,
      onWarning: config.onWarning,
    });
  };

  // Get capabilities helper
  const getCapabilities = (modelId: string): ProviderCapabilities => {
    const model = OPENAI_MODELS[modelId] ?? OPENAI_MODELS["gpt-4o"];

    return {
      supportsVision: model.vision,
      supportsTools: model.tools,
      supportsThinking: false,
      supportsStreaming: true,
      supportsPDF: false,
      supportsAudio: model.audio,
      supportsVideo: false,
      maxTokens: model.maxTokens,
      supportedImageTypes: model.vision
        ? ["image/png", "image/jpeg", "image/gif", "image/webp"]
        : [],
      supportedAudioTypes: model.audio
        ? ["audio/mp3", "audio/wav", "audio/webm"]
        : [],
      supportsJsonMode: model.jsonMode,
      supportsSystemMessages: true,
    };
  };

  return createCallableProvider(providerFn, {
    name: "openai",
    supportedModels: Object.keys(OPENAI_MODELS),
    getCapabilities,
  });
}

// Alias for consistency
export const createOpenAIProvider = createOpenAI;

export type {
  OpenAIReasoningEffort,
  OpenAIParameterOptions,
} from "../../core/openai-parameters";

export type {
  OpenAITransportOptions,
  OpenAIResponsesOptions,
  OpenAIResponseItem,
  OpenAIResponseMetadata,
  ProviderMetadata,
} from "../../core/openai-responses";

export { openaiSpeech, openaiTranscription } from "./audio";
export type {
  OpenAIAudioProviderOptions,
  OpenAITranscriptionOptions,
} from "./audio";
