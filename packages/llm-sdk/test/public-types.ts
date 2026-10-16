import { generateText, streamText, createRuntime } from "@yourgpt/llm-sdk";
import {
  openai,
  createOpenAI,
  type OpenAIReasoningEffort,
} from "@yourgpt/llm-sdk/openai";
import { createFallbackChain } from "@yourgpt/llm-sdk/fallback";
import { OpenAIAdapter } from "@yourgpt/llm-sdk/adapters";

const effort: OpenAIReasoningEffort = "none";
const model = openai("gpt-6-luna", {
  reasoningEffort: effort,
  onWarning: console.warn,
});
void generateText({
  model,
  prompt: "test",
  reasoningEffort: effort,
  temperature: 0,
});
void streamText({ model, prompt: "test", reasoningEffort: "high" });
const adapter = new OpenAIAdapter({
  apiKey: "test",
  model: "gpt-6-luna",
  parameterPolicy: "openai",
});
const chain = createFallbackChain({
  models: [
    adapter,
    createOpenAI({ reasoningEffort: effort }).languageModel("gpt-6-luna"),
  ],
  fallbackErrors: (error) => {
    const value = error as { code?: string };
    return value.code === "unsupported_parameter";
  },
});
void createRuntime({ adapter: chain }).chat({
  messages: [],
  config: { reasoningEffort: effort },
});
