/** Audio models are independent of chat models and chat streaming events. */
export type SpeechFormat = "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm";
export interface AudioResponseMetadata {
  provider: string;
  modelId: string;
  requestId?: string;
  status?: number;
}
export interface AudioWarning {
  code: string;
  message: string;
}
export interface SpeechOptions {
  text: string;
  voice?: string;
  outputFormat?: SpeechFormat;
  speed?: number;
  instructions?: string;
  signal?: AbortSignal;
  providerOptions?: Record<string, Record<string, unknown>>;
}
export interface GeneratedSpeech {
  audio: {
    uint8Array: Uint8Array;
    readonly base64: string;
    mediaType: string;
    format: SpeechFormat;
  };
  response: AudioResponseMetadata;
  warnings: AudioWarning[];
  usage?: Record<string, unknown>;
}
export interface SpeechModel {
  readonly provider: string;
  readonly modelId: string;
  doGenerate(options: SpeechOptions): Promise<GeneratedSpeech>;
}
export interface TranscriptionOptions {
  /** Recorded file bytes, base64, or a Blob. URLs and raw PCM are not fetched/decoded. */
  audio: Uint8Array | ArrayBuffer | Blob | string;
  mediaType?: string;
  filename?: string;
  language?: string;
  prompt?: string;
  signal?: AbortSignal;
  providerOptions?: Record<string, Record<string, unknown>>;
}
export interface TranscriptSegment {
  text: string;
  start: number;
  end: number;
  speaker?: string;
}
export interface TranscriptionResult {
  text: string;
  language?: string;
  durationSeconds?: number;
  segments?: TranscriptSegment[];
  words?: Array<{ word: string; start: number; end: number }>;
  response: AudioResponseMetadata;
  warnings: AudioWarning[];
  usage?: Record<string, unknown>;
  /** Provider-supplied extras, including log probabilities when requested. */
  providerMetadata?: Record<string, unknown>;
}
export interface TranscriptionModel {
  readonly provider: string;
  readonly modelId: string;
  doTranscribe(options: TranscriptionOptions): Promise<TranscriptionResult>;
}
const audioErrorMarker = Symbol.for("@yourgpt/llm-sdk/AudioAPIError");
export class AudioAPIError extends Error {
  readonly [audioErrorMarker] = true;
  static [Symbol.hasInstance](value: unknown): boolean {
    return (
      !!value &&
      typeof value === "object" &&
      (value as Record<symbol, unknown>)[audioErrorMarker] === true
    );
  }
  readonly name = "AudioAPIError";
  constructor(
    message: string,
    readonly code:
      | "invalid_input"
      | "unsupported_option"
      | "provider_error"
      | "invalid_response"
      | "network_error",
    readonly status?: number,
    readonly requestId?: string,
  ) {
    super(message);
  }
}
export async function generateSpeech({
  model,
  ...options
}: SpeechOptions & { model: SpeechModel }): Promise<GeneratedSpeech> {
  options.signal?.throwIfAborted();
  if (typeof options.text !== "string" || !options.text.trim())
    throw new AudioAPIError("Speech text must not be empty", "invalid_input");
  const result = await model.doGenerate(options);
  options.signal?.throwIfAborted();
  if (
    !(result.audio?.uint8Array instanceof Uint8Array) ||
    !result.audio.uint8Array.length
  )
    throw new AudioAPIError(
      "Speech provider returned empty audio",
      "invalid_response",
    );
  return result;
}
export async function transcribe({
  model,
  ...options
}: TranscriptionOptions & {
  model: TranscriptionModel;
}): Promise<TranscriptionResult> {
  options.signal?.throwIfAborted();
  const result = await model.doTranscribe(options);
  options.signal?.throwIfAborted();
  if (typeof result.text !== "string")
    throw new AudioAPIError(
      "Transcription provider returned an invalid transcript",
      "invalid_response",
    );
  return result;
}
