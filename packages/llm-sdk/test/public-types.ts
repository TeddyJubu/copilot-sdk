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

import { tool, type ToolModelOutput } from "@yourgpt/llm-sdk";
import { z } from "zod";
const imageTool = tool({
  description: "Inspect an authorized image",
  parameters: z.object({ imageId: z.string() }),
  execute: async ({ imageId }) => ({ imageId, bytes: new Uint8Array([1, 2]) }),
  toModelOutput: (result): ToolModelOutput => ({
    type: "content",
    content: [{ type: "image", data: result.bytes, mediaType: "image/png" }],
  }),
});
void generateText({ model, prompt: "inspect", tools: { inspect: imageTool } });

import { generateSpeech, transcribe, AudioAPIError } from "@yourgpt/llm-sdk";
import { openaiSpeech, openaiTranscription } from "@yourgpt/llm-sdk/openai";
void generateSpeech({
  model: openaiSpeech(),
  text: "Hello",
  outputFormat: "wav",
}).then((result) => result.audio.uint8Array);
void transcribe({
  model: openaiTranscription(),
  audio: new Uint8Array([1]),
  mediaType: "audio/wav",
}).then((result) => result.text);
const audioError: Error = new AudioAPIError("failed", "provider_error", 429);
