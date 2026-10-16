/** Recorded microphone input. Start only from an explicit user gesture. */
export type VoiceRecordingState =
  | "idle"
  | "requesting"
  | "recording"
  | "stopping";
export interface VoiceRecording {
  audio: Blob;
  mediaType: string;
  durationMs: number;
}
export interface VoiceRecorderOptions {
  mimeTypes?: string[];
  maxBytes?: number;
  maxDurationMs?: number;
  onStateChange?: (state: VoiceRecordingState) => void;
  onError?: (error: Error) => void;
}

export class VoiceRecorder {
  private generation = 0;
  private recorder?: MediaRecorder;
  private stream?: MediaStream;
  private chunks: Blob[] = [];
  private bytes = 0;
  private startedAt = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private resolveStop?: (value: VoiceRecording) => void;
  private rejectStop?: (error: Error) => void;
  private stopping?: Promise<VoiceRecording>;
  private _state: VoiceRecordingState = "idle";
  constructor(private options: VoiceRecorderOptions = {}) {
    if (
      options.maxBytes !== undefined &&
      (!Number.isFinite(options.maxBytes) || options.maxBytes <= 0)
    )
      throw new Error("maxBytes must be positive");
    if (
      options.maxDurationMs !== undefined &&
      (!Number.isFinite(options.maxDurationMs) || options.maxDurationMs <= 0)
    )
      throw new Error("maxDurationMs must be positive");
  }
  get state(): VoiceRecordingState {
    return this._state;
  }
  private stateChanged(state: VoiceRecordingState) {
    this._state = state;
    this.options.onStateChange?.(state);
  }
  private release() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    if (this.recorder) {
      this.recorder.ondataavailable = null;
      this.recorder.onstop = null;
      this.recorder.onerror = null;
    }
    this.recorder = undefined;
    this.chunks = [];
    this.bytes = 0;
  }
  private fail(error: Error) {
    const reject = this.rejectStop;
    this.resolveStop = undefined;
    this.rejectStop = undefined;
    this.generation++;
    const recorder = this.recorder;
    this.release();
    if (recorder && recorder.state !== "inactive") recorder.stop();
    this.stopping = undefined;
    this.stateChanged("idle");
    reject?.(error);
    this.options.onError?.(error);
  }
  async start(): Promise<void> {
    if (this.state !== "idle")
      throw new Error("A voice recording is already active");
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    )
      throw new Error("Microphone recording is unavailable in this browser");
    const mimeType = (
      this.options.mimeTypes ?? [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ]
    ).find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType)
      throw new Error("No supported audio recording format is available");
    const generation = ++this.generation;
    this.stateChanged("requesting");
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (generation !== this.generation)
        throw new DOMException("Recording cancelled", "AbortError");
      this.stream = stream;
      this.recorder = new MediaRecorder(stream, { mimeType });
      this.startedAt = Date.now();
      this.recorder.ondataavailable = (event) => {
        if (generation !== this.generation || !event.data.size) return;
        this.bytes += event.data.size;
        if (this.bytes > (this.options.maxBytes ?? 20_000_000)) {
          this.fail(new Error("Recording exceeded the size limit"));
          return;
        }
        this.chunks.push(event.data);
      };
      this.recorder.onerror = () => {
        if (generation === this.generation)
          this.fail(new Error("Microphone recording failed"));
      };
      this.recorder.onstop = () => {
        if (generation !== this.generation) return;
        const resolve = this.resolveStop;
        const reject = this.rejectStop;
        const actualType = this.recorder?.mimeType || mimeType;
        const audio = new Blob(this.chunks, { type: actualType });
        const durationMs = Date.now() - this.startedAt;
        this.resolveStop = undefined;
        this.rejectStop = undefined;
        this.stopping = undefined;
        this.release();
        this.stateChanged("idle");
        if (audio.size) resolve?.({ audio, mediaType: actualType, durationMs });
        else {
          const error = new Error("Recording contained no audio");
          reject?.(error);
          this.options.onError?.(error);
        }
      };
      this.recorder.start(250);
      this.stateChanged("recording");
      this.timer = setTimeout(
        () => this.fail(new Error("Recording exceeded the duration limit")),
        this.options.maxDurationMs ?? 60_000,
      );
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      if (generation === this.generation) {
        this.release();
        this.stateChanged("idle");
      }
      throw error;
    }
  }
  stop(): Promise<VoiceRecording> {
    if (this.stopping) return this.stopping;
    if (this.state !== "recording" || !this.recorder)
      return Promise.reject(new Error("No active recording to stop"));
    this.stopping = new Promise((resolve, reject) => {
      this.resolveStop = resolve;
      this.rejectStop = reject;
    });
    const pending = this.stopping;
    this.stateChanged("stopping");
    try {
      this.recorder.stop();
    } catch {
      this.fail(new Error("Could not stop recording"));
    }
    return pending;
  }
  cancel(): void {
    this.generation++;
    const reject = this.rejectStop;
    const recorder = this.recorder;
    this.resolveStop = undefined;
    this.rejectStop = undefined;
    this.stopping = undefined;
    this.release();
    if (recorder && recorder.state !== "inactive") recorder.stop();
    this.stateChanged("idle");
    reject?.(new DOMException("Recording cancelled", "AbortError"));
  }
  dispose(): void {
    this.cancel();
  }
}

export interface VoiceTranscript {
  text: string;
  provenance: {
    source: "recorded_audio";
    mediaType: string;
    durationMs: number;
    provider?: string;
    modelId?: string;
  };
}
/** Upload to your own authenticated server route. Does not submit a chat message. */
export async function transcribeRecording(
  recording: VoiceRecording,
  options: {
    url: string;
    signal?: AbortSignal;
    fetch?: typeof globalThis.fetch;
    headers?: HeadersInit;
  },
): Promise<VoiceTranscript> {
  options.signal?.throwIfAborted();
  if (!recording.audio.size || recording.audio.size > 25_000_000)
    throw new Error("Recording must contain 1 byte to 25 MB");
  const mediaType = recording.audio.type || recording.mediaType;
  const extension = mediaType.startsWith("audio/webm")
    ? "webm"
    : mediaType.startsWith("audio/mp4")
      ? "m4a"
      : mediaType.startsWith("audio/ogg")
        ? "ogg"
        : undefined;
  if (!extension) throw new Error("Unsupported recording format");
  const headers = new Headers(options.headers);
  headers.delete("content-type");
  const form = new FormData();
  form.append("file", recording.audio, `recording.${extension}`);
  const response = await (options.fetch ?? globalThis.fetch)(options.url, {
    method: "POST",
    body: form,
    headers,
    signal: options.signal,
  });
  if (!response.ok)
    throw new Error(`Transcription upload failed (HTTP ${response.status})`);
  const value = await response.json();
  options.signal?.throwIfAborted();
  if (!value || typeof value.text !== "string")
    throw new Error("Server returned an invalid transcript");
  return {
    text: value.text,
    provenance: {
      source: "recorded_audio",
      mediaType,
      durationMs: recording.durationMs,
      provider:
        typeof value.response?.provider === "string"
          ? value.response.provider
          : undefined,
      modelId:
        typeof value.response?.modelId === "string"
          ? value.response.modelId
          : undefined,
    },
  };
}
