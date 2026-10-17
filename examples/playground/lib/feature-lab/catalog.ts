// Shared UI contract. Provider credentials and SDK model construction stay on the server.
export const providers = [
  "openai",
  "anthropic",
  "openrouter",
  "typesafe",
  "cloudflare",
] as const;
export type LabProvider = (typeof providers)[number];
export type FeatureId =
  | "parameters"
  | "fallback"
  | "decisions"
  | "responses"
  | "tool-images"
  | "system-prompt"
  | "speech"
  | "transcription"
  | "realtime"
  | "image";
export interface LabInput {
  provider: LabProvider;
  text?: string;
  streaming?: boolean;
  reasoning?: "default" | "none";
  file?: { base64: string; mediaType: string; name: string };
}
export interface LabResult {
  feature: FeatureId;
  provider: string;
  model: string;
  text: string;
  checks: Array<{ label: string; passed: boolean }>;
  details?: unknown;
  warnings?: string[];
  durationMs?: number;
  media?: { base64: string; mediaType: string; filename: string };
}
export interface Feature {
  id: FeatureId;
  name: string;
  group: "Core" | "Media";
  /**
   * Compatibility regression check rather than a product feature: it runs in
   * "Run core checks" and is reachable by deep link, but is not listed.
   */
  check?: boolean;
  description: string;
  providers: readonly LabProvider[];
  defaultText?: string;
  upload?: "image" | "audio";
  streaming?: boolean;
  snippet: string;
  source: string;
}
export const BLUE_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAb0lEQVR4nO3PAQkAAAyEwO9feoshgnABdNvJ8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ3I8QUNyPEFDcjxBQ2oPcf88OIhvJ6vAAAAAElFTkSuQmCC";
export const features: readonly Feature[] = [
  {
    id: "parameters",
    check: true,
    name: "Reasoning parameters",
    group: "Core",
    providers: ["openai"],
    streaming: true,
    description:
      "Send temperature zero to GPT-6 Luna. Compare default reasoning with explicit non-reasoning mode and inspect compatibility warnings.",
    defaultText: "Reply with exactly OK.",
    source: "examples/chat.ts → parametersExample",
    snippet: `const warnings: string[] = [];
const model = openai("gpt-6-luna", { onWarning: w => warnings.push(w) });
const result = await generateText({
  model, prompt: "Reply with exactly OK.", temperature: 0,
  // Optional: reasoningEffort: "none"
});`,
  },
  {
    id: "fallback",
    check: true,
    name: "Compatibility fallback",
    group: "Core",
    providers: ["openai"],
    streaming: true,
    description:
      "Deliberately send the unsupported temperature value, then verify a single explicit fallback to GPT-4o with zero retries.",
    source: "examples/chat.ts → fallbackExample",
    snippet: `const chain = createFallbackChain({
  models: [lunaWithPassthrough, gpt4o], retries: 2,
  fallbackErrors: e => e.status === 400 && e.param === "temperature"
    && ["unsupported_value", "unsupported_parameter"].includes(e.code),
});
// Normal SDK requests omit incompatible temperature; passthrough is only for this test.`,
  },
  {
    id: "decisions",
    name: "Native Decisions",
    group: "Core",
    providers: ["openai", "openrouter", "typesafe", "cloudflare"],
    upload: "image",
    description:
      "Evaluate a ticket using native boolean, choice and score questions. Add an image with providers that support image state.",
    defaultText:
      "My invoice has a duplicate charge. The service is working normally; please refund the extra charge.",
    source: "examples/decisions.ts → decisionsExample",
    snippet: `const result = await experimental_decide({
  model: openaiDecision(), // or openrouterDecision(), typesafeDecision(), cloudflareDecision()
  state: { ticket },
  questions: {
    outage: { type: "boolean", instructions: "Are all customers blocked?" },
    team: { type: "choice", instructions: "Who owns this?", criteria: {
      billing: "Invoices and refunds", engineering: "Outages", support: "General help"
    } },
    impact: { type: "score", instructions: "Rate impact", criteria: ["None", "Some", "All"] }
  }
});`,
  },
  {
    id: "responses",
    name: "Responses & replay",
    group: "Core",
    providers: ["openai"],
    streaming: true,
    description:
      "Make two stateless Responses calls. Reuse the complete message history and encrypted reasoning; inspect native usage and cached tokens.",
    defaultText: "The project code is ORCHID-742. Acknowledge briefly.",
    source: "examples/chat.ts → responsesExample",
    snippet: `const model = openai("gpt-6-luna", {
  api: "responses", responses: { store: false, promptCacheKey: "feature-lab" }
});
const first = await generateText({ model, prompt });
const second = await generateText({ model, messages: [
  ...first.response.messages, { role: "user", content: "What was the project code?" }
] });
// Keep response.messages intact: it contains provider replay metadata.`,
  },
  {
    id: "tool-images",
    name: "Images in tool calls",
    group: "Core",
    providers: ["openai", "anthropic"],
    streaming: true,
    upload: "image",
    description:
      "A tool returns an actual image to the model. The default blue fixture checks vision, one tool execution and persisted conversation replay.",
    source: "examples/chat.ts → toolImagesExample",
    snippet: `const result = await generateText({ model, prompt, maxSteps: 3,
  tools: { inspect_image: tool({
    description: "Return the sample image", parameters: z.object({}),
    execute: async () => ({ label: "sample" }),
    toModelOutput: () => ({ type: "content", content: [
      { type: "image", data: imageBytes, mediaType: "image/png" }
    ] })
  }) }
});`,
  },
  {
    id: "system-prompt",
    check: true,
    name: "System prompt compatibility",
    group: "Core",
    providers: ["anthropic"],
    description:
      "Compare systemPrompt with a role: system message. Both should reach Anthropic and produce the same controlled reply.",
    source: "examples/chat.ts → systemPromptExample",
    snippet: `const a = await runtime.chat({ systemPrompt,
  messages: [{ role: "user", content: emailContext }]
});
const b = await runtime.chat({ messages: [
  { role: "system", content: systemPrompt },
  { role: "user", content: emailContext }
] });`,
  },
  {
    id: "speech",
    name: "Voice generation · TTS",
    group: "Media",
    providers: ["openai"],
    description:
      "Generate playable speech and download the WAV file. This voice is AI-generated.",
    defaultText: "Hello Copilot. The blue balloon is ready.",
    source: "examples/media.ts → speechExample",
    snippet: `const result = await generateSpeech({
  model: openaiSpeech(), text, voice: "alloy", outputFormat: "wav"
});
// Send audio bytes from your server; play them in an <audio controls> element.`,
  },
  {
    id: "transcription",
    name: "Voice input · STT",
    group: "Media",
    providers: ["openai"],
    upload: "audio",
    description:
      "Record your microphone or upload audio. With no file, synthesize a short test phrase and verify its transcription.",
    source: "examples/media.ts → transcriptionExample",
    snippet: `const recorder = new VoiceRecorder();
await recorder.start(); // explicit user gesture
const recording = await recorder.stop();
// Send recording.audio to your server:
const result = await transcribe({
  model: openaiTranscription(), audio: bytes, mediaType
});`,
  },
  {
    id: "realtime",
    name: "Realtime voice",
    group: "Media",
    providers: ["openai"],
    description:
      "Start a WebRTC voice conversation, inspect transcripts, interrupt replies and approve a Copilot tool. Replies use an AI-generated voice.",
    source: "components/feature-lab/RealtimePanel.tsx + examples/media.ts",
    snippet: `useTool({ name: "get_demo_status", needsApproval: true, handler });
const voice = useRealtimeVoice({
  createCall: ({ sdp, signal }) => postToYourServer({ sdp }, signal)
});
// Server: openaiRealtime().createCall({ sdp, instructions, tools })
await voice.connect(); // microphone permission from a user gesture`,
  },
  {
    id: "image",
    name: "Image generation & editing",
    group: "Media",
    providers: ["openai"],
    upload: "image",
    description:
      "Generate an image, or attach an image to edit it. View the result and native usage before downloading.",
    defaultText: "A simple blue circle on a white background",
    source: "examples/media.ts → imageExample",
    snippet: `const result = await generateImage({
  model: openaiImage(), prompt, size: "1024x1024",
  // Optional: images: [{ data: imageBytes, mediaType: "image/png" }],
  providerOptions: { openai: { quality: "low" } }
});`,
  },
];
/** Product features shown in the playground navigation. */
export const listedFeatures = features.filter((feature) => !feature.check);
export const defaultFeature: FeatureId = "decisions";
export const coreChecks: Array<{ feature: FeatureId; provider: LabProvider }> =
  [
    { feature: "parameters", provider: "openai" },
    { feature: "fallback", provider: "openai" },
    { feature: "responses", provider: "openai" },
    { feature: "decisions", provider: "openai" },
    { feature: "decisions", provider: "openrouter" },
    { feature: "decisions", provider: "typesafe" },
    { feature: "decisions", provider: "cloudflare" },
    { feature: "tool-images", provider: "openai" },
    { feature: "tool-images", provider: "anthropic" },
    { feature: "system-prompt", provider: "anthropic" },
  ];
