import {
  AudioAPIError,
  type SpeechModel,
  type SpeechFormat,
  type SpeechOptions,
  type TranscriptionModel,
  type TranscriptionOptions,
  type TranscriptionResult,
} from "../../core/audio";

export interface OpenAIAudioProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  organization?: string;
  project?: string;
  /** Custom fetch for proxies and tests. */
  fetch?: typeof globalThis.fetch;
}
export interface OpenAITranscriptionOptions {
  timestampGranularities?: Array<"word" | "segment">;
  includeLogprobs?: boolean;
  chunkingStrategy?: "auto";
}
const formats: Record<SpeechFormat, string> = {
  mp3: "audio/mpeg",
  opus: "audio/ogg",
  aac: "audio/aac",
  flac: "audio/flac",
  wav: "audio/wav",
  pcm: "audio/pcm",
};
const extensions: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "video/mp4": "mp4",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
  "video/webm": "webm",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
};
const MAX_AUDIO = 25_000_000;
function hasAudioHeader(data: Uint8Array, format: string): boolean {
  const head = Buffer.from(data.subarray(0, 12)).toString("latin1");
  if (format === "wav")
    return head.startsWith("RIFF") && head.slice(8, 12) === "WAVE";
  if (format === "mp3" || format === "mpeg" || format === "mpga")
    return (
      head.startsWith("ID3") || (data[0] === 0xff && (data[1] & 0xe0) === 0xe0)
    );
  if (format === "opus" || format === "ogg") return head.startsWith("OggS");
  if (format === "flac") return head.startsWith("fLaC");
  if (format === "aac") return data[0] === 0xff && (data[1] & 0xf6) === 0xf0;
  if (format === "webm")
    return (
      data[0] === 0x1a &&
      data[1] === 0x45 &&
      data[2] === 0xdf &&
      data[3] === 0xa3
    );
  if (format === "m4a" || format === "mp4") return head.slice(4, 8) === "ftyp";
  return format === "pcm" && data.length > 0 && data.length % 2 === 0;
}
function invalid(message: string): never {
  throw new AudioAPIError(message, "invalid_input");
}
function unsupported(message: string): never {
  throw new AudioAPIError(message, "unsupported_option");
}
function providerOptions(
  value: Record<string, Record<string, unknown>> | undefined,
  allowed: string[],
): Record<string, unknown> {
  for (const [provider, options] of Object.entries(value ?? {})) {
    if (provider !== "openai")
      unsupported(
        `Provider options for ${provider} cannot be used with OpenAI audio`,
      );
    for (const key of Object.keys(options))
      if (!allowed.includes(key))
        unsupported(`Unsupported OpenAI audio option: ${key}`);
  }
  return value?.openai ?? {};
}
async function readBody(
  response: Response,
  limit: number,
): Promise<Uint8Array> {
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw new AudioAPIError(
      "Audio API response exceeds the size limit",
      "invalid_response",
    );
  }
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) {
        await reader.cancel();
        throw new AudioAPIError(
          "Audio API response exceeds the size limit",
          "invalid_response",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const data = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  return data;
}
function transport(config: OpenAIAudioProviderOptions) {
  return async (
    path: string,
    body: string | FormData,
    signal?: AbortSignal,
  ) => {
    signal?.throwIfAborted();
    const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) invalid("OpenAI audio requires an API key on the server");
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
    };
    if (typeof body === "string") headers["Content-Type"] = "application/json";
    if (config.organization)
      headers["OpenAI-Organization"] = config.organization;
    if (config.project) headers["OpenAI-Project"] = config.project;
    let response: Response;
    try {
      response = await (config.fetch ?? globalThis.fetch)(
        `${(config.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "")}${path}`,
        { method: "POST", headers, body, signal, redirect: "error" },
      );
    } catch {
      signal?.throwIfAborted();
      throw new AudioAPIError("OpenAI audio request failed", "network_error");
    }
    if (!response.ok) {
      // Do not retain provider bodies: they can echo prompts/audio or credentials.
      await response.body?.cancel();
      throw new AudioAPIError(
        `OpenAI audio request failed (HTTP ${response.status})`,
        "provider_error",
        response.status,
        response.headers.get("x-request-id") ?? undefined,
      );
    }
    return response;
  };
}

/** Server-side, buffered text-to-speech. No microphone or realtime session. */
export function openaiSpeech(
  modelId = "gpt-4o-mini-tts",
  config: OpenAIAudioProviderOptions = {},
): SpeechModel {
  const request = transport(config);
  return {
    provider: "openai",
    modelId,
    async doGenerate(options: SpeechOptions) {
      const {
        text,
        voice = "alloy",
        outputFormat = "mp3",
        speed,
        instructions,
        signal,
      } = options;
      signal?.throwIfAborted();
      providerOptions(options.providerOptions, []);
      if (typeof text !== "string" || !text.trim() || text.length > 4096)
        invalid("Speech text must contain 1–4096 characters");
      if (!Object.prototype.hasOwnProperty.call(formats, outputFormat))
        unsupported("Unsupported OpenAI speech output format");
      if (typeof voice !== "string" || !voice.trim())
        invalid("Speech voice must not be empty");
      if (
        speed !== undefined &&
        (!Number.isFinite(speed) || speed < 0.25 || speed > 4)
      )
        invalid("Speech speed must be between 0.25 and 4");
      if (instructions !== undefined) {
        if (typeof instructions !== "string" || instructions.length > 4096)
          invalid(
            "Speech instructions must be a string of at most 4096 characters",
          );
        if (modelId === "tts-1" || modelId === "tts-1-hd")
          unsupported("Instructions are not supported by tts-1 or tts-1-hd");
      }
      const response = await request(
        "/audio/speech",
        JSON.stringify({
          model: modelId,
          input: text,
          voice,
          response_format: outputFormat,
          speed,
          instructions,
        }),
        signal,
      );
      const mediaType = response.headers
        .get("content-type")
        ?.split(";")[0]
        .trim();
      if (
        mediaType &&
        !mediaType.startsWith("audio/") &&
        mediaType !== "application/octet-stream"
      ) {
        await response.body?.cancel();
        throw new AudioAPIError(
          "Speech endpoint returned a non-audio response",
          "invalid_response",
        );
      }
      const data = await readBody(response, MAX_AUDIO);
      signal?.throwIfAborted();
      if (!data.length || !hasAudioHeader(data, outputFormat))
        throw new AudioAPIError(
          "Speech endpoint returned empty or invalid audio",
          "invalid_response",
        );
      return {
        audio: {
          uint8Array: data,
          get base64() {
            return Buffer.from(data).toString("base64");
          },
          mediaType: formats[outputFormat],
          format: outputFormat,
        },
        warnings: [],
        response: {
          provider: "openai",
          modelId,
          requestId: response.headers.get("x-request-id") ?? undefined,
          status: response.status,
        },
      };
    },
  };
}

async function audioBytes(
  options: TranscriptionOptions,
): Promise<{ bytes: Uint8Array; mediaType: string; extension: string }> {
  const blob =
    typeof Blob !== "undefined" && options.audio instanceof Blob
      ? options.audio
      : undefined;
  if (blob && blob.size > MAX_AUDIO)
    invalid("Transcription file exceeds 25 MB");
  const declared = options.mediaType?.split(";")[0].trim();
  const blobType = blob?.type.split(";")[0].trim();
  if (declared && blobType && declared !== blobType)
    invalid("Transcription mediaType does not match the Blob type");
  const mediaType = declared || blobType || "";
  const extension = extensions[mediaType];
  if (!extension)
    unsupported(
      "Unsupported transcription media type; provide an encoded audio file",
    );
  let bytes: Uint8Array;
  if (blob) bytes = new Uint8Array(await blob.arrayBuffer());
  else if (options.audio instanceof Uint8Array) bytes = options.audio;
  else if (options.audio instanceof ArrayBuffer)
    bytes = new Uint8Array(options.audio);
  else if (typeof options.audio === "string") {
    const base64 = options.audio;
    if (base64.length > (MAX_AUDIO * 4) / 3 + 4)
      invalid("Transcription file exceeds 25 MB");
    if (
      !base64 ||
      base64.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)
    )
      invalid(
        "Audio must be bytes, a Blob, or valid base64; URLs are not fetched",
      );
    bytes = Buffer.from(base64, "base64");
    if (Buffer.from(bytes).toString("base64") !== base64)
      invalid("Invalid audio base64");
  } else invalid("Audio must be bytes, a Blob, or base64");
  if (!bytes.length || bytes.length > MAX_AUDIO)
    invalid("Transcription file must contain 1 byte to 25 MB");
  if (!hasAudioHeader(bytes, extension))
    invalid("Audio header does not match the declared media type");
  return { bytes, mediaType, extension };
}

/** Recorded-file transcription. Timestamp and diarization options are model-gated. */
export function openaiTranscription(
  modelId = "gpt-4o-mini-transcribe",
  config: OpenAIAudioProviderOptions = {},
): TranscriptionModel {
  const request = transport(config);
  return {
    provider: "openai",
    modelId,
    async doTranscribe(
      options: TranscriptionOptions,
    ): Promise<TranscriptionResult> {
      options.signal?.throwIfAborted();
      if (modelId.includes("realtime"))
        unsupported(
          "Realtime models require a realtime session; use a file transcription model",
        );
      const opts = providerOptions(options.providerOptions, [
        "timestampGranularities",
        "includeLogprobs",
        "chunkingStrategy",
      ]);
      const timestamps = opts.timestampGranularities;
      if (
        timestamps !== undefined &&
        (!Array.isArray(timestamps) ||
          !timestamps.length ||
          timestamps.some((x) => x !== "word" && x !== "segment"))
      )
        invalid("timestampGranularities must contain word or segment");
      if (timestamps !== undefined && modelId !== "whisper-1")
        unsupported("Timestamp granularities require whisper-1");
      if (
        opts.includeLogprobs !== undefined &&
        typeof opts.includeLogprobs !== "boolean"
      )
        invalid("includeLogprobs must be boolean");
      if (
        opts.includeLogprobs &&
        !/^gpt-4o-(mini-)?transcribe(?:-\d{4}-\d{2}-\d{2})?$/.test(modelId)
      )
        unsupported(
          "Log probabilities require a supported gpt-4o transcription model",
        );
      const diarize = modelId === "gpt-4o-transcribe-diarize";
      if (
        opts.chunkingStrategy !== undefined &&
        opts.chunkingStrategy !== "auto"
      )
        unsupported("Only automatic audio chunking is supported");
      if (diarize && options.prompt !== undefined)
        unsupported("Prompts are not supported by the diarization model");
      if (
        options.language !== undefined &&
        !/^[a-z]{2}$/.test(options.language)
      )
        invalid("language must be a two-letter ISO-639-1 code");
      if (options.prompt !== undefined && typeof options.prompt !== "string")
        invalid("Transcription prompt must be a string");
      const { bytes, mediaType, extension } = await audioBytes(options);
      options.signal?.throwIfAborted();
      const fileName = options.filename ?? `audio.${extension}`;
      if (!/^[^/\\\r\n\x00]+\.[a-z0-9]+$/i.test(fileName))
        invalid("Transcription filename must be a filename with an extension");
      const allowedExt =
        mediaType === "audio/mpeg"
          ? ["mp3", "mpeg", "mpga"]
          : mediaType === "audio/mp4"
            ? ["m4a", "mp4"]
            : [extension];
      if (!allowedExt.includes(fileName.split(".").at(-1)!.toLowerCase()))
        invalid("Transcription filename extension does not match mediaType");
      const form = new FormData();
      form.append(
        "file",
        new Blob([new Uint8Array(bytes)], { type: mediaType }),
        fileName,
      );
      form.append("model", modelId);
      form.append(
        "response_format",
        diarize ? "diarized_json" : timestamps ? "verbose_json" : "json",
      );
      if (options.language) form.append("language", options.language);
      if (options.prompt) form.append("prompt", options.prompt);
      if (timestamps)
        for (const value of timestamps as string[])
          form.append("timestamp_granularities[]", value);
      if (opts.includeLogprobs) form.append("include[]", "logprobs");
      if (diarize || opts.chunkingStrategy)
        form.append("chunking_strategy", "auto");
      const response = await request(
        "/audio/transcriptions",
        form,
        options.signal,
      );
      let value: any;
      try {
        value = JSON.parse(
          Buffer.from(await readBody(response, 5 * 1024 * 1024)).toString(
            "utf8",
          ),
        );
      } catch (error) {
        options.signal?.throwIfAborted();
        if (error instanceof AudioAPIError) throw error;
        throw new AudioAPIError(
          "Transcription endpoint returned invalid JSON",
          "invalid_response",
        );
      }
      options.signal?.throwIfAborted();
      if (!value || typeof value.text !== "string")
        throw new AudioAPIError(
          "Transcription response is missing text",
          "invalid_response",
        );
      function timed(items: unknown, word = false) {
        if (items === undefined) return undefined;
        if (
          !Array.isArray(items) ||
          items.some(
            (x) =>
              !x ||
              typeof x[word ? "word" : "text"] !== "string" ||
              !Number.isFinite(x.start) ||
              !Number.isFinite(x.end) ||
              x.start < 0 ||
              x.end < x.start,
          )
        )
          throw new AudioAPIError(
            "Invalid transcription timestamps",
            "invalid_response",
          );
        return items.map((x) =>
          word
            ? { word: x.word, start: x.start, end: x.end }
            : {
                text: x.text,
                start: x.start,
                end: x.end,
                ...(typeof x.speaker === "string"
                  ? { speaker: x.speaker }
                  : {}),
              },
        );
      }
      return {
        text: value.text,
        language:
          typeof value.language === "string" ? value.language : undefined,
        durationSeconds:
          typeof value.duration === "number" ? value.duration : undefined,
        segments: timed(value.segments) as TranscriptionResult["segments"],
        words: timed(value.words, true) as TranscriptionResult["words"],
        usage: value.usage,
        providerMetadata: {
          openai: { ...(value.logprobs ? { logprobs: value.logprobs } : {}) },
        },
        warnings: [],
        response: {
          provider: "openai",
          modelId,
          status: response.status,
          requestId: response.headers.get("x-request-id") ?? undefined,
        },
      };
    },
  };
}
