import { generateText, streamText, createRuntime } from "@yourgpt/llm-sdk";
import {
  openai,
  createOpenAI,
  type OpenAIReasoningEffort,
} from "@yourgpt/llm-sdk/openai";
import { createFallbackChain } from "@yourgpt/llm-sdk/fallback";
import { OpenAIAdapter } from "@yourgpt/llm-sdk/adapters";
import { anthropic, createAnthropic } from "@yourgpt/llm-sdk/anthropic";
void generateText({
  model: anthropic("claude-haiku-5-5", {
    thinking: { type: "adaptive", display: "summarized" },
    effort: "low",
  }),
  prompt: "test",
});
void createRuntime({
  provider: createAnthropic({ thinking: { type: "adaptive" }, effort: "low" }),
  model: "claude-haiku-5-5",
});
void generateText({
  model: anthropic("claude-haiku-4-5", {
    thinking: { enabled: true, budgetTokens: 1024 },
  }),
  prompt: "test",
  maxTokens: 2048,
});

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

import {
  experimental_decide,
  type DecisionQuestions,
  type DecisionModel,
} from "@yourgpt/llm-sdk";
import { openaiDecision } from "@yourgpt/llm-sdk/openai";
import { openrouterDecision } from "@yourgpt/llm-sdk/openrouter";
import { typesafeDecision } from "@yourgpt/llm-sdk/typesafe";
import { cloudflareDecision } from "@yourgpt/llm-sdk/cloudflare";
const decisionModels: DecisionModel[] = [
  openaiDecision(),
  openrouterDecision(),
  typesafeDecision(),
  cloudflareDecision(undefined, { accountId: "a".repeat(32) }),
];
const decisionQuestions = {
  urgent: { type: "boolean", instructions: "Urgent?" },
  team: {
    type: "choice",
    instructions: "Which team?",
    criteria: { billing: "Invoices", engineering: "Outages" },
  },
  severity: {
    type: "score",
    instructions: "Impact?",
    criteria: ["None", "Some", "Major"],
  },
} as const satisfies DecisionQuestions;
void experimental_decide({
  model: decisionModels[0],
  state: { ticket: "Test" },
  questions: decisionQuestions,
}).then((result) => {
  if (result.answers.team.type === "choice") {
    const selected: "billing" | "engineering" = result.answers.team.choice;
    const probability: number | undefined =
      result.answers.team.probabilities?.billing;
    // @ts-expect-error Unknown choices must not appear in the inferred answer.
    const impossible: "sales" = result.answers.team.choice;
    // @ts-expect-error Boolean probability is not a choice-answer field.
    result.answers.team.probability;
    void [selected, probability, impossible];
  }
  if (result.answers.urgent.type === "boolean") {
    const probability: number = result.answers.urgent.probability;
    void probability;
  }
  // @ts-expect-error Unknown question IDs are rejected.
  result.answers.unknown;
});
void experimental_decide({
  // @ts-expect-error A chat model is not a native decision model.
  model,
  state: "test",
  questions: decisionQuestions,
});

import {
  generateImage,
  type ImageModel,
  type RealtimeModel,
} from "@yourgpt/llm-sdk";
import {
  openaiImage,
  openaiRealtime,
  type OpenAIImageOptions,
} from "@yourgpt/llm-sdk/openai";
const imageModel: ImageModel = openaiImage();
const imageSettings: OpenAIImageOptions = {
  quality: "xhigh",
  background: "transparent",
};
void generateImage({
  model: imageModel,
  prompt: "blue circle",
  providerOptions: { openai: { ...imageSettings } },
});
const realtimeModel: RealtimeModel = openaiRealtime();
void realtimeModel.createCall({
  sdp: "v=0",
  turnDetection: { type: "semantic_vad", eagerness: "medium" },
});
void realtimeModel.createClientSecret({ expiresAfterSeconds: 60 });
