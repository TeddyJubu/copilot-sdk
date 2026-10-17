import { generateSpeech, transcribe, generateImage } from "@yourgpt/llm-sdk";
import {
  openaiSpeech,
  openaiTranscription,
  openaiImage,
  openaiRealtime,
} from "@yourgpt/llm-sdk/openai";
import { features, type LabInput, type LabResult } from "../catalog";
const defaults = (id: string) =>
  features.find((f) => f.id === id)!.defaultText!;

export async function speechExample(
  input: LabInput,
  apiKey: string,
  signal: AbortSignal,
): Promise<LabResult> {
  const result = await generateSpeech({
    model: openaiSpeech(undefined, { apiKey }),
    text: input.text || defaults("speech"),
    voice: "alloy",
    outputFormat: "wav",
    signal,
  });
  return {
    feature: "speech",
    provider: "openai",
    model: result.response.modelId,
    text: "AI-generated speech is ready to play.",
    checks: [
      {
        label: "Nonempty encoded audio returned",
        passed: result.audio.uint8Array.length > 100,
      },
    ],
    warnings: result.warnings.map((w) => w.message),
    details: { bytes: result.audio.uint8Array.length, usage: result.usage },
    media: {
      base64: result.audio.base64,
      mediaType: result.audio.mediaType,
      filename: "copilot-speech.wav",
    },
  };
}
export async function transcriptionExample(
  input: LabInput,
  apiKey: string,
  signal: AbortSignal,
): Promise<LabResult> {
  // A reproducible TTS→STT round trip is available when no microphone/file is supplied.
  const sample = input.file
    ? undefined
    : await generateSpeech({
        model: openaiSpeech(undefined, { apiKey }),
        text: defaults("speech"),
        voice: "alloy",
        outputFormat: "wav",
        signal,
      });
  const result = await transcribe({
    model: openaiTranscription(undefined, { apiKey }),
    audio: input.file
      ? Buffer.from(input.file.base64, "base64")
      : sample!.audio.uint8Array,
    mediaType: input.file?.mediaType ?? "audio/wav",
    filename: input.file?.name ?? "sample.wav",
    language: "en",
    signal,
  });
  return {
    feature: "transcription",
    provider: "openai",
    model: result.response.modelId,
    text: result.text,
    checks: [
      {
        label: input.file ? "Audio transcribed" : "Synthetic phrase recognized",
        passed: input.file
          ? !!result.text.trim()
          : /blue balloon/i.test(result.text),
      },
    ],
    details: {
      source: input.file
        ? "Uploaded or recorded file"
        : "Synthetic speech round trip",
      durationSeconds: result.durationSeconds,
      usage: result.usage,
    },
    warnings: result.warnings.map((w) => w.message),
  };
}
export async function imageExample(
  input: LabInput,
  apiKey: string,
  signal: AbortSignal,
): Promise<LabResult> {
  const result = await generateImage({
    model: openaiImage(undefined, { apiKey }),
    prompt: input.text || defaults("image"),
    size: "1024x1024",
    signal,
    ...(input.file && {
      images: [
        {
          data: Buffer.from(input.file.base64, "base64"),
          mediaType: input.file.mediaType as
            | "image/png"
            | "image/jpeg"
            | "image/webp",
        },
      ],
    }),
    providerOptions: { openai: { quality: "low" } },
  });
  return {
    feature: "image",
    provider: "openai",
    model: result.response.modelId,
    text: input.file ? "Edited image ready." : "Generated image ready.",
    checks: [
      {
        label: "Nonempty image returned",
        passed: result.image.uint8Array.length > 100,
      },
    ],
    details: { bytes: result.image.uint8Array.length, usage: result.usage },
    media: {
      base64: result.image.base64,
      mediaType: result.image.mediaType,
      filename: "copilot-image.png",
    },
  };
}
export const realtimeTool = {
  name: "get_demo_status",
  description: "Read the local demo status after user approval",
  parameters: { type: "object", properties: {}, additionalProperties: false },
};
export async function realtimeExample(
  sdp: string,
  apiKey: string,
  signal: AbortSignal,
) {
  return openaiRealtime(undefined, { apiKey }).createCall({
    sdp,
    signal,
    transcriptionModel: "gpt-transcribe",
    instructions:
      "You are the Copilot SDK feature lab. Speak briefly. Replies use an AI voice. When asked for demo status, call get_demo_status and read its returned status. Do not invent a tool result.",
    tools: [realtimeTool],
  });
}
