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
