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

import type {
  OpenAIResponsesOptions,
  ProviderMetadata,
} from "@yourgpt/llm-sdk";
const responses: OpenAIResponsesOptions = {
  store: false,
  reasoningSummary: "auto",
};
const responsesModel = openai("gpt-6-luna", { api: "responses", responses });
void generateText({
  model: responsesModel,
  prompt: "test",
  openai: { responses: { previousResponseId: "resp_test" } },
}).then((result) => {
  const metadata: ProviderMetadata | undefined = result.providerMetadata;
  return generateText({
    model: responsesModel,
    messages: result.response.messages,
  });
});
void streamText({ model: responsesModel, prompt: "test" }).then(
  async (result) => {
    const metadata: ProviderMetadata | undefined =
      await result.providerMetadata;
    return (await result.response).messages;
  },
);
void createRuntime({
  provider: createOpenAI({ api: "responses", responses }),
  model: "gpt-6-luna",
}).chat({ messages: [], config: { openai: { api: "responses", responses } } });
