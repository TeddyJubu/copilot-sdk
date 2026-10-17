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

import {
  generateSpeech,
  transcribe,
  type SpeechModel,
  type ToolModelOutput,
} from "@yourgpt/llm-sdk";
import { openaiSpeech, openaiTranscription } from "@yourgpt/llm-sdk/openai";
const speechModel: SpeechModel = openaiSpeech();
void generateSpeech({ model: speechModel, text: "Hello" });
void transcribe({
  model: openaiTranscription(),
  audio: new Uint8Array([1]),
  mediaType: "audio/wav",
});
const imageOutput: ToolModelOutput = {
  type: "content",
  content: [{ type: "image", url: "https://example.com/image.png" }],
};

import { experimental_decide, type DecisionModel } from "@yourgpt/llm-sdk";
import { openaiDecision } from "@yourgpt/llm-sdk/openai";
import { openrouterDecision } from "@yourgpt/llm-sdk/openrouter";
import { typesafeDecision } from "@yourgpt/llm-sdk/typesafe";
import { cloudflareDecision } from "@yourgpt/llm-sdk/cloudflare";
const decisions: DecisionModel[] = [
  openaiDecision(),
  openrouterDecision(),
  typesafeDecision(),
  cloudflareDecision(undefined, { accountId: "a".repeat(32) }),
];
void experimental_decide({
  model: decisions[0],
  state: "test",
  questions: { flag: { type: "boolean", instructions: "Test?" } },
}).then((result) => {
  if (result.answers.flag.type === "boolean") {
    const p: number = result.answers.flag.probability;
    void p;
  }
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
