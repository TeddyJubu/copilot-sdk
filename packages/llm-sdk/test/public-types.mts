import { generateText, type GenerateTextParams } from "@yourgpt/llm-sdk";
import { openai, type OpenAIReasoningEffort } from "@yourgpt/llm-sdk/openai";
import {
  createFallbackChain,
  type FallbackChainConfig,
} from "@yourgpt/llm-sdk/fallback";
import { OpenAIAdapter } from "@yourgpt/llm-sdk/adapters";
const effort: OpenAIReasoningEffort = "high";
const params: GenerateTextParams = {
  model: openai("gpt-6-luna"),
  prompt: "test",
  reasoningEffort: effort,
};
const config: FallbackChainConfig = {
  models: [new OpenAIAdapter({ apiKey: "test" })],
  fallbackErrors: () => false,
};
void generateText(params);
void createFallbackChain(config);
