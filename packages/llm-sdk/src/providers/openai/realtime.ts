import { MediaAPIError } from "../../core/image";
import type {
  RealtimeModel,
  RealtimeSessionOptions,
} from "../../core/realtime";
import {
  invalidMedia,
  mediaJSON,
  postMedia,
  type OpenAIMediaProviderOptions,
} from "./media-http";

function buildSession(model: string, o: RealtimeSessionOptions) {
  if (
    o.instructions !== undefined &&
    (typeof o.instructions !== "string" || o.instructions.length > 100_000)
  )
    invalidMedia(
      "Realtime instructions must be a string up to 100000 characters",
    );
  for (const value of [o.voice, o.transcriptionModel])
    if (
      value !== undefined &&
      (typeof value !== "string" || !value.trim() || value.length > 100)
    )
      invalidMedia("Invalid realtime voice or transcription model");
  if (o.language !== undefined && !/^[a-z]{2}$/.test(o.language))
    invalidMedia("Realtime language must be a two-letter code");
  if (o.language && !o.transcriptionModel)
    invalidMedia("language requires a transcription model");
  if (
    o.outputModality !== undefined &&
    !["audio", "text"].includes(o.outputModality)
  )
    invalidMedia("Invalid realtime output modality");
  if (
    o.maxOutputTokens !== undefined &&
    o.maxOutputTokens !== "inf" &&
    (!Number.isInteger(o.maxOutputTokens) ||
      o.maxOutputTokens < 1 ||
      o.maxOutputTokens > 4096)
  )
    invalidMedia("maxOutputTokens must be 1–4096 or inf");
  if (
    o.safetyIdentifier !== undefined &&
    (typeof o.safetyIdentifier !== "string" ||
      !/^[\x21-\x7e]{1,128}$/.test(o.safetyIdentifier))
  )
    invalidMedia(
      "safetyIdentifier must contain 1–128 printable ASCII characters",
    );
  const names = new Set<string>();
  if (o.tools && (!Array.isArray(o.tools) || o.tools.length > 128))
    invalidMedia("Realtime supports up to 128 tools");
  const tools = o.tools?.map((tool) => {
    if (
      !tool ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(tool.name) ||
      names.has(tool.name) ||
      !tool.parameters ||
      tool.parameters.type !== "object"
    )
      invalidMedia(
        "Realtime tools require unique names and object parameter schemas",
      );
    names.add(tool.name);
    return {
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    };
  });
  let turn: Record<string, unknown> | null;
  const td = o.turnDetection;
  if (td === null) turn = null;
  else if (td?.type === "semantic_vad") {
    if (
      td.eagerness !== undefined &&
      !["auto", "low", "medium", "high"].includes(td.eagerness)
    )
      invalidMedia("Invalid semantic VAD eagerness");
    turn = {
      type: td.type,
      eagerness: td.eagerness,
      create_response: true,
      interrupt_response: true,
    };
  } else {
    if (td && td.type !== "server_vad")
      invalidMedia("Invalid realtime turn detection");
    if (
      td?.threshold !== undefined &&
      (!Number.isFinite(td.threshold) || td.threshold < 0 || td.threshold > 1)
    )
      invalidMedia("VAD threshold must be 0–1");
    for (const value of [td?.silenceDurationMs, td?.prefixPaddingMs])
      if (
        value !== undefined &&
        (!Number.isInteger(value) || value < 0 || value > 10000)
      )
        invalidMedia("VAD durations must be 0–10000 milliseconds");
    turn = {
      type: "server_vad",
      threshold: td?.threshold,
      silence_duration_ms: td?.silenceDurationMs,
      prefix_padding_ms: td?.prefixPaddingMs,
      create_response: true,
      interrupt_response: true,
    };
  }
  return {
    type: "realtime",
    model,
    instructions: o.instructions,
    output_modalities: [o.outputModality ?? "audio"],
    max_output_tokens: o.maxOutputTokens,
    audio: {
      input: {
        turn_detection: turn,
        ...(o.transcriptionModel
          ? {
              transcription: {
                model: o.transcriptionModel,
                language: o.language,
              },
            }
          : {}),
      },
      output: { voice: o.voice ?? "marin" },
    },
    tools,
  };
}

/** OpenAI GA Realtime. GPT-Live has a different protocol and is intentionally rejected. */
export function openaiRealtime(
  modelId = "gpt-realtime-2.1",
  config: OpenAIMediaProviderOptions = {},
): RealtimeModel {
  if (!modelId.startsWith("gpt-realtime"))
    invalidMedia("openaiRealtime requires a gpt-realtime model");
  return {
    provider: "openai",
    modelId,
    async createClientSecret(options = {}) {
      const ttl = options.expiresAfterSeconds ?? 60;
      if (!Number.isInteger(ttl) || ttl < 10 || ttl > 7200)
        invalidMedia("Client secret lifetime must be 10–7200 seconds");
      const session = buildSession(modelId, options);
      const response = await postMedia(
        config,
        "/realtime/client_secrets",
        JSON.stringify({
          session,
          expires_after: { anchor: "created_at", seconds: ttl },
        }),
        { ...options, timeoutMs: options.timeoutMs ?? 30_000 },
      );
      const data = mediaJSON(response.text);
      if (
        typeof data.value !== "string" ||
        !data.value.startsWith("ek_") ||
        !Number.isFinite(data.expires_at) ||
        data.expires_at <= Date.now() / 1000
      )
        throw new MediaAPIError(
          "Realtime returned an invalid or expired client secret",
          "invalid_response",
        );
      return { value: data.value, expiresAt: data.expires_at, modelId };
    },
    async createCall(options) {
      if (
        typeof options.sdp !== "string" ||
        !options.sdp.startsWith("v=0") ||
        options.sdp.length > 65_536
      )
        invalidMedia("A valid SDP offer up to 64 KiB is required");
      const form = new FormData();
      form.set("sdp", options.sdp);
      form.set("session", JSON.stringify(buildSession(modelId, options)));
      const response = await postMedia(config, "/realtime/calls", form, {
        ...options,
        timeoutMs: options.timeoutMs ?? 30_000,
        maxResponseBytes: 65_536,
      });
      if (!response.text.startsWith("v=0"))
        throw new MediaAPIError(
          "Realtime returned an invalid SDP answer",
          "invalid_response",
        );
      return { sdp: response.text };
    },
  };
}
