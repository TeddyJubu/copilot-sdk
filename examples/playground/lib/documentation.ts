import type { FeatureId } from "./feature-lab/catalog";

export const DOCS_URL = "https://copilot-sdk.yourgpt.ai/docs";

export const featureDocs: Record<FeatureId, string> = {
  parameters: "/llm-sdk/parameters-and-fallback",
  fallback: "/llm-sdk/parameters-and-fallback",
  decisions: "/llm-sdk/decisions",
  responses: "/llm-sdk/responses",
  "tool-images": "/llm-sdk/tool-images",
  "system-prompt":
    "/llm-sdk/beta-upgrade#which-system-prompt-field-should-i-use",
  speech: "/llm-sdk/audio#generate-speech",
  transcription: "/llm-sdk/audio#transcribe-a-file",
  realtime: "/llm-sdk/realtime",
  image: "/llm-sdk/image-generation",
};
