# Image tool results and recorded audio

These APIs are additive. Chat configuration, ordinary JSON/string tool results, and the existing screenshot `addAsUserMessage` attachment path retain their behavior. Native image tool output requires OpenAI **Responses** or Anthropic. TTS and recorded-file STT currently have an OpenAI implementation; other providers can implement the separate `SpeechModel` / `TranscriptionModel` contracts.

## Tools that return images

A tool still receives schema-validated JSON arguments. Pass an authorized image ID, URL, or crop reference in those arguments; resolve the actual bytes inside your handler. Do not ask the model to reproduce image base64 in function arguments.

```ts
import { generateText, tool } from "@yourgpt/llm-sdk";
import { openai } from "@yourgpt/llm-sdk/openai";
import { z } from "zod";

const result = await generateText({
  model: openai("gpt-5.2", { api: "responses", responses: { store: false } }),
  prompt: "Inspect image sample.",
  maxSteps: 3,
  tools: {
    inspect_image: tool({
      description: "Read an image the caller is authorized to access",
      parameters: z.object({ imageId: z.string() }),
      execute: async ({ imageId }) => loadAuthorizedImage(imageId),
      toModelOutput: (image) => ({
        type: "content",
        content: [
          { type: "text", text: image.caption },
          { type: "image", data: image.bytes, mediaType: "image/png" },
        ],
      }),
    }),
  },
});
// result.toolResults keeps the raw handler result for your application.
// result.response.messages retains the model-facing content for the next turn.
```

`toModelOutput` is a synchronous mapper, called once when a tool completes. It is also available on Runtime and Copilot tool definitions. For existing Runtime/Copilot handlers, returning `{ success: true, _aiContent: [...] }` uses the same native path. Explicit `toModelOutput` takes precedence. MCP image results keep their accompanying text in order.

Supported image parts:

| Part                                            | OpenAI Responses                    | Anthropic |
| ----------------------------------------------- | ----------------------------------- | --------- |
| `{ type: 'image', data, mediaType }`            | Yes                                 | Yes       |
| `{ type: 'image', url: 'https://…' }`           | Yes                                 | Yes       |
| `{ type: 'image', fileId, provider: 'openai' }` | Yes, with an accessible OpenAI file | Rejected  |

`data` accepts `Uint8Array`, canonical base64, or a base64 data URL matching `mediaType`. Supported media types: PNG, JPEG, WebP, GIF. Images are limited to 20 MiB each; provider/model aggregate limits can be smaller. The SDK does not download URLs or upload files implicitly. URL fetching happens at the selected provider. File references remain scoped to that provider/account.

OpenAI Chat Completions, Gemini, Ollama, Azure Chat and other compatible endpoints reject native image tool output clearly. Text-only mapped content still works. Custom OpenAI endpoints require explicit Responses selection and their own compatibility validation. Arbitrary array-shaped JSON results are never assumed to contain images.

Native output is carried as `modelOutput` next to the tool message's text. Preserve it when storing/restoring messages, along with `tool_call_id` / `toolCallId` and assistant tool calls. The Runtime storage helper places it at `StorageMessage.metadata.modelOutput`; a custom loader must map it back to `modelOutput`. Copilot's serialized `UIMessage` history preserves it directly, including server results in streaming execution metadata. Do not truncate image base64 or substitute it with text. Context pruning can remove complete older tool exchanges.

If an existing screenshot handler explicitly uses `addAsUserMessage`, it continues to add an attachment. When native model output is also supplied, the native output takes precedence and no extra attachment turn is created. General image generation is separate and is not implemented here.

## Speech generation on the server

```ts
import { generateSpeech } from "@yourgpt/llm-sdk";
import { openaiSpeech } from "@yourgpt/llm-sdk/openai";

const speech = await generateSpeech({
  model: openaiSpeech("gpt-4o-mini-tts"), // reads server OPENAI_API_KEY
  text: "Hello from Copilot.",
  voice: "alloy",
  outputFormat: "wav",
  instructions: "Speak clearly and warmly.",
  speed: 1,
  signal: request.signal,
});
return new Response(new Uint8Array(speech.audio.uint8Array), {
  headers: {
    "Content-Type": speech.audio.mediaType,
    "Cache-Control": "no-store",
  },
});
```

Returns audio bytes, a lazy `audio.base64` getter, media type/format, warnings, and provider/model/request metadata. Usage is optional and is not invented when the endpoint does not return it. This helper buffers the audio; it is not a realtime voice session or streamed audio API.

Formats: MP3, Opus/Ogg, AAC, FLAC, WAV, and raw PCM. OpenAI PCM is 24 kHz, signed 16-bit little-endian without a container header; use WAV/MP3 for ordinary browser playback. Text/instructions are bounded at 4096 characters, speed at 0.25–4. `tts-1` and `tts-1-hd` reject instructions. Unsupported options fail explicitly. Responses are bounded at 25 MB and checked for a matching audio header; the helper does not perform full codec decoding.

Browser playback, from a user click:

```ts
const response = await fetch("/api/speech", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text: "Hello from Copilot." }),
});
if (!response.ok) throw new Error("Speech generation failed");
const url = URL.createObjectURL(await response.blob());
const player = new Audio(url);
const release = () => URL.revokeObjectURL(url);
player.addEventListener("ended", release, { once: true });
player.addEventListener("error", release, { once: true });
try {
  await player.play();
} catch (error) {
  release();
  throw error;
}
// On component disposal: player.pause(); release();
```

Label generated speech as AI-generated. Keep provider keys and authentication/rate limiting in your server route.

## File transcription on the server

```ts
import { transcribe } from "@yourgpt/llm-sdk";
import { openaiTranscription } from "@yourgpt/llm-sdk/openai";

// POST /api/transcribe, behind your application's authentication.
const form = await request.formData();
const file = form.get("file");
if (!(file instanceof Blob))
  return new Response("Audio file required", { status: 400 });
const transcript = await transcribe({
  model: openaiTranscription("gpt-4o-mini-transcribe"),
  audio: file,
  language: "en",
  signal: request.signal,
});
return Response.json(transcript);
```

Accepts a Blob, bytes/ArrayBuffer, or base64; bytes/base64 require `mediaType`. A filename is generated from the type unless supplied. No remote URL fetch occurs. Encoded files are limited to 25 MB and require a matching container header and filename extension. Accepted containers: MP3/MPEG/MPGA, MP4/M4A, WAV, WebM, Ogg, and FLAC. Raw PCM belongs to a separately configured realtime transcription protocol.

`text`, provider metadata and usage are returned. Segments, word timestamps, speakers, language and duration are preserved when supplied by the provider. An empty transcript is a valid outcome for silence; missing/non-string text is an invalid response.

For timestamps use `openaiTranscription('whisper-1')` with `providerOptions: { openai: { timestampGranularities: ['word', 'segment'] } }`. For speaker labels use `openaiTranscription('gpt-4o-transcribe-diarize')`; it selects `diarized_json` and automatic chunking. Diarization does not accept prompts or timestamp granularity options. Compatible GPT-4o transcription models can request `includeLogprobs: true`. The initial slice does not expose all options of the newer `gpt-transcribe` model (for example keyword lists or multiple language hints).

Both audio helpers accept `signal`, preserve cancellation, and expose `AudioAPIError` with a stable `code`, HTTP `status` and provider `requestId` when available. They do not log audio/text or retain provider error bodies. There are no automatic chargeable retries.

## Copilot microphone recording and review

`VoiceRecorder` is framework-independent and exported from `@yourgpt/copilot-sdk/core`. It makes no permission request until `start()` is called. Call it from a user gesture on HTTPS/localhost.

```ts
import { VoiceRecorder, transcribeRecording } from "@yourgpt/copilot-sdk/core";

const recorder = new VoiceRecorder({
  onStateChange: (state) => updateRecordingIndicator(state),
  onError: (error) => showError(error.message),
});
let upload: AbortController | undefined;

// Record button:
await recorder.start();

// Stop button:
const recording = await recorder.stop();
upload = new AbortController();
const transcript = await transcribeRecording(recording, {
  url: "/api/transcribe",
  signal: upload.signal,
});
setChatDraft(transcript.text); // Review/edit, then submit through the usual chat flow.
// transcript.provenance identifies recorded audio and the server provider/model.

// Cancel button or component disposal:
upload?.abort();
recorder.dispose();
```

The recorder negotiates supported WebM/Opus, MP4, or Ogg/Opus containers. Stop, cancel, permission races, recorder errors and disposal release microphone tracks. Defaults: 20 MB and 60 seconds; exceeding either discards the recording and invokes `onError`. No automatic message submission, voice cloning, telephony, live transcription, or bidirectional voice call is included.

## Verification sources

Provider formats were checked against [OpenAI function outputs](https://developers.openai.com/api/docs/guides/function-calling), [Anthropic tool results](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls), [OpenAI speech](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create), and [OpenAI transcription](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create). Vercel comparisons use its [tool output guidance](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling), [speech](https://ai-sdk.dev/docs/ai-sdk-core/speech), [transcription](https://ai-sdk.dev/docs/ai-sdk-core/transcription), and source checkout `8a5233b15b1e69573d63faee6cd0014559252ee4` (2026-10-15).
