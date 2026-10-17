import type {
  PermissionLevel,
  ToolDefinition,
  ToolResponse,
} from "./types/tools";

export type RealtimeVoiceState =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";
export interface RealtimeTranscript {
  id: string;
  role: "user" | "assistant";
  text: string;
  final: boolean;
}
export interface RealtimeToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}
export interface RealtimeApproval {
  approved: boolean;
  data?: Record<string, unknown>;
}
export interface RealtimeVoiceOptions {
  /** Calls your authenticated server, which exchanges the offer with OpenAI. */
  createCall?: (request: {
    sdp: string;
    signal: AbortSignal;
  }) => Promise<{ sdp: string }>;
  /** Alternative to createCall. Never return a long-lived API key here. */
  getClientSecret?: (
    signal: AbortSignal,
  ) => Promise<{ value: string; expiresAt: number }>;
  /** Latest active Copilot registry. Only handlers in this registry may execute. */
  getTools?: () => ToolDefinition[];
  getToolPermission?: (name: string) => Promise<PermissionLevel>;
  onApproval?: (
    call: RealtimeToolCall,
    signal: AbortSignal,
  ) => Promise<RealtimeApproval>;
  onToolResult?: (call: RealtimeToolCall, result: ToolResponse) => void;
  onTranscript?: (transcript: RealtimeTranscript) => void;
  onUsage?: (usage: Record<string, unknown>) => void;
  onStateChange?: (state: RealtimeVoiceState) => void;
  onError?: (error: Error) => void;
  onEvent?: (event: Record<string, unknown>) => void;
  /** Attach controls if the browser blocks autoplay. The session owns its srcObject. */
  audioElement?: HTMLAudioElement;
  /** Optional capture adapter. The session stops every returned track on disconnect. */
  getMicrophone?: () => Promise<MediaStream>;
  connectionTimeoutMs?: number;
  toolTimeoutMs?: number;
  maxDurationMs?: number;
  maxToolCalls?: number;
}

function aborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
  });
}
async function readSDP(response: Response): Promise<string> {
  if (Number(response.headers.get("content-length")) > 65_536) {
    void response.body?.cancel().catch(() => {});
    throw new Error("Voice SDP answer exceeds 64 KiB");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty voice SDP answer");
  const decoder = new TextDecoder();
  let size = 0,
    text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65_536) {
        void reader.cancel().catch(() => {});
        throw new Error("Voice SDP answer exceeds 64 KiB");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
/** Browser-only GA Realtime WebRTC session. Constructing it never captures audio. */
export class RealtimeVoiceSession {
  private _state: RealtimeVoiceState = "idle";
  private _muted = false;
  private peer?: RTCPeerConnection;
  private channel?: RTCDataChannel;
  private microphone?: MediaStream;
  private audio?: HTMLAudioElement;
  private controller?: AbortController;
  private durationTimer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private turn = 0;
  private activeResponse = false;
  private playing = false;
  private seenCalls = new Set<string>();
  private transcripts = new Map<string, RealtimeTranscript>();
  constructor(private readonly options: RealtimeVoiceOptions) {
    if (!!options.createCall === !!options.getClientSecret)
      throw new Error("Provide exactly one of createCall or getClientSecret");
    for (const value of [
      options.connectionTimeoutMs,
      options.toolTimeoutMs,
      options.maxDurationMs,
      options.maxToolCalls,
    ])
      if (
        value !== undefined &&
        (!Number.isInteger(value) || value <= 0 || value > 2_147_483_647)
      )
        throw new Error("Realtime limits must be positive integers");
  }
  get state(): RealtimeVoiceState {
    return this._state;
  }
  get muted(): boolean {
    return this._muted;
  }
  private notify<T>(callback: ((value: T) => void) | undefined, value: T) {
    // Application observer exceptions must not prevent resource cleanup.
    try {
      callback?.(value);
    } catch {
      /* observers own their errors */
    }
  }
  private setState(state: RealtimeVoiceState) {
    this._state = state;
    this.notify(this.options.onStateChange, state);
  }
  private alive(generation: number) {
    return generation === this.generation && !this.controller?.signal.aborted;
  }
  private release() {
    const controller = this.controller;
    this.controller = undefined;
    this.generation++;
    controller?.abort(
      new DOMException("Voice session disconnected", "AbortError"),
    );
    clearTimeout(this.durationTimer);
    this.durationTimer = undefined;
    if (this.channel) {
      this.channel.onmessage = null;
      this.channel.onopen = null;
      this.channel.onclose = null;
      this.channel.onerror = null;
      this.channel.close();
    }
    if (this.peer) {
      this.peer.ontrack = null;
      this.peer.onconnectionstatechange = null;
      this.peer.close();
    }
    this.microphone?.getTracks().forEach((track) => track.stop());
    if (this.audio) {
      this.audio.pause();
      this.audio.srcObject = null;
    }
    this.peer = undefined;
    this.channel = undefined;
    this.microphone = undefined;
    this.audio = undefined;
    this.activeResponse = false;
    this.playing = false;
    this.transcripts.clear();
    this.seenCalls.clear();
  }
  private fail(error: Error) {
    this.release();
    this.setState("error");
    this.notify(this.options.onError, error);
  }
  disconnect() {
    this.release();
    this.setState("disconnected");
  }

  /** Call from a user gesture. Resolves after session.created and the data channel open. */
  async connect(): Promise<void> {
    if (this.state === "connecting" || this.state === "connected")
      throw new Error("A voice session is already active");
    if (
      typeof RTCPeerConnection === "undefined" ||
      typeof document === "undefined"
    )
      throw new Error("Realtime voice requires a WebRTC browser");
    const controller = new AbortController();
    this.controller = controller;
    const signal = controller.signal;
    const generation = ++this.generation;
    this.setState("connecting");
    this._muted = false;
    this.turn = 0;
    const timer = setTimeout(
      () =>
        controller.abort(
          new DOMException("Voice connection timed out", "TimeoutError"),
        ),
      this.options.connectionTimeoutMs ?? 30_000,
    );
    const setup = async () => {
      signal.throwIfAborted();
      const stream = await (this.options.getMicrophone?.() ??
        navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        }));
      if (!this.alive(generation) || signal.aborted) {
        stream.getTracks().forEach((track) => track.stop());
        signal.throwIfAborted();
        throw new DOMException("Voice session cancelled", "AbortError");
      }
      this.microphone = stream;
      if (!stream.getAudioTracks().length)
        throw new Error("Microphone returned no audio tracks");
      stream.getAudioTracks().forEach((track) =>
        track.addEventListener?.(
          "ended",
          () => {
            if (this.alive(generation))
              this.fail(new Error("Microphone capture ended"));
          },
          { once: true },
        ),
      );
      const peer = new RTCPeerConnection();
      this.peer = peer;
      const audio =
        this.options.audioElement ?? document.createElement("audio");
      this.audio = audio;
      audio.autoplay = true;
      peer.ontrack = (event) => {
        if (!this.alive(generation)) return;
        audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
        void audio
          .play()
          .catch(() =>
            this.notify(
              this.options.onError,
              new Error(
                "Audio autoplay was blocked; call resumeAudio from a user gesture",
              ),
            ),
          );
      };
      stream.getAudioTracks().forEach((track) => peer.addTrack(track, stream));
      const channel = peer.createDataChannel("oai-events");
      this.channel = channel;
      const ready = new Promise<void>((resolve, reject) => {
        let open = false,
          created = false;
        const check = () => {
          if (open && created) resolve();
        };
        channel.onopen = () => {
          open = true;
          check();
        };
        channel.onmessage = (event) => {
          if (!this.alive(generation)) return;
          try {
            if (typeof event.data !== "string" || event.data.length > 1_048_576)
              throw new Error("Invalid realtime event size");
            const data = JSON.parse(event.data);
            if (!data || typeof data.type !== "string")
              throw new Error("Invalid realtime event");
            if (data.type === "session.created") {
              created = true;
              check();
            }
            this.handle(data, generation);
          } catch {
            const error = new Error("Invalid realtime event");
            reject(error);
            this.fail(error);
          }
        };
        channel.onerror = () => {
          const error = new Error("Voice data channel failed");
          reject(error);
          if (this.alive(generation)) this.fail(error);
        };
        channel.onclose = () => {
          reject(new Error("Voice data channel closed"));
          if (this.alive(generation)) this.disconnect();
        };
      });
      // Install a rejection handler before SDP work, because the channel can close early.
      void ready.catch(() => {});
      peer.onconnectionstatechange = () => {
        if (
          this.alive(generation) &&
          ["failed", "disconnected", "closed"].includes(peer.connectionState)
        )
          this.fail(
            new Error(
              "Voice connection ended; reconnect explicitly to start a new session",
            ),
          );
      };
      const offer = await peer.createOffer();
      signal.throwIfAborted();
      await peer.setLocalDescription(offer);
      signal.throwIfAborted();
      const sdp = peer.localDescription?.sdp ?? offer.sdp;
      if (!sdp) throw new Error("Could not create a voice SDP offer");
      let answer: { sdp: string };
      if (this.options.createCall)
        answer = await this.options.createCall({ sdp, signal });
      else {
        const secret = await this.options.getClientSecret!(signal);
        signal.throwIfAborted();
        if (
          typeof secret.value !== "string" ||
          !secret.value.startsWith("ek_") ||
          !Number.isFinite(secret.expiresAt) ||
          secret.expiresAt <= Date.now() / 1000
        )
          throw new Error(
            "Expected an unexpired ephemeral realtime credential",
          );
        const response = await fetch(
          "https://api.openai.com/v1/realtime/calls",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${secret.value}`,
              "Content-Type": "application/sdp",
            },
            body: sdp,
            signal,
            redirect: "error",
          },
        );
        if (!response.ok) {
          void response.body?.cancel().catch(() => {});
          throw new Error(`Voice setup failed (HTTP ${response.status})`);
        }
        answer = { sdp: await readSDP(response) };
      }
      signal.throwIfAborted();
      if (
        typeof answer.sdp !== "string" ||
        !answer.sdp.startsWith("v=0") ||
        answer.sdp.length > 65_536
      )
        throw new Error("Invalid voice SDP answer");
      await peer.setRemoteDescription({ type: "answer", sdp: answer.sdp });
      await ready;
      signal.throwIfAborted();
    };
    try {
      await Promise.race([setup(), aborted(signal)]);
      signal.throwIfAborted();
      this.setState("connected");
      signal.throwIfAborted();
      this.durationTimer = setTimeout(
        () => this.disconnect(),
        this.options.maxDurationMs ?? 30 * 60_000,
      );
    } catch (error) {
      if (generation === this.generation)
        this.fail(
          error instanceof Error ? error : new Error("Voice connection failed"),
        );
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  private send(event: Record<string, unknown>) {
    if (this.state !== "connected" || this.channel?.readyState !== "open")
      throw new Error("Voice session is not connected");
    const data = JSON.stringify(event);
    if (data.length > 1_048_576 || this.channel.bufferedAmount > 1_048_576)
      throw new Error("Voice data channel size limit exceeded");
    this.channel.send(data);
  }
  setMuted(muted: boolean) {
    if (this.state !== "connected")
      throw new Error("Voice session is not connected");
    this._muted = muted;
    this.microphone?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
    if (muted) this.send({ type: "input_audio_buffer.clear" });
  }
  async resumeAudio() {
    if (!this.audio) throw new Error("Voice session is not connected");
    await this.audio.play();
  }
  interrupt() {
    if (this.state !== "connected")
      throw new Error("Voice session is not connected");
    this.turn++;
    if (this.activeResponse) this.send({ type: "response.cancel" });
    if (this.playing) this.send({ type: "output_audio_buffer.clear" });
  }
  sendText(text: string) {
    if (typeof text !== "string" || !text.trim() || text.length > 32_000)
      throw new Error("Voice text must contain 1–32000 characters");
    this.interrupt();
    this.send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    });
    this.send({ type: "response.create" });
  }
  /** Use only with server turnDetection:null after capturing at least 100ms of audio. */
  commitAudio() {
    this.send({ type: "input_audio_buffer.commit" });
    this.send({ type: "response.create" });
  }
  private handle(event: Record<string, any>, generation: number) {
    this.notify(this.options.onEvent, event);
    if (!this.alive(generation)) return;
    if (event.type === "error") {
      // Provider error messages can echo application data. Expose a stable error only.
      this.notify(
        this.options.onError,
        new Error("Realtime provider reported an error"),
      );
      return;
    }
    if (event.type === "response.created") this.activeResponse = true;
    if (event.type === "output_audio_buffer.started") this.playing = true;
    if (
      ["output_audio_buffer.stopped", "output_audio_buffer.cleared"].includes(
        event.type,
      )
    )
      this.playing = false;
    if (event.type === "input_audio_buffer.speech_started") this.turn++;
    const role = event.type.startsWith(
      "conversation.item.input_audio_transcription.",
    )
      ? "user"
      : "assistant";
    if (event.type === "conversation.item.input_audio_transcription.failed") {
      this.notify(
        this.options.onError,
        new Error("Realtime input transcription failed"),
      );
      return;
    }
    const isTranscript =
      /^conversation\.item\.input_audio_transcription\.(delta|completed)$/.test(
        event.type,
      ) ||
      /^response\.output_(audio_transcript|text)\.(delta|done)$/.test(
        event.type,
      );
    if (isTranscript && typeof event.item_id === "string") {
      const id = `${role}:${event.item_id}`;
      const final =
        event.type.endsWith(".done") || event.type.endsWith(".completed");
      const text = final
        ? (event.transcript ?? event.text)
        : (this.transcripts.get(id)?.text ?? "") + (event.delta ?? "");
      if (typeof text === "string") {
        if (
          text.length > 64_000 ||
          (!this.transcripts.has(id) && this.transcripts.size >= 256)
        )
          throw new Error("Realtime transcript limit exceeded");
        const transcript: RealtimeTranscript = { id, role, text, final };
        if (final) this.transcripts.delete(id);
        else this.transcripts.set(id, transcript);
        this.notify(this.options.onTranscript, transcript);
      }
    }
    if (event.type === "response.done") {
      this.activeResponse = false;
      if (event.response?.usage)
        this.notify(this.options.onUsage, event.response.usage);
      if (event.response?.status === "failed")
        this.notify(
          this.options.onError,
          new Error("Realtime response failed"),
        );
      if (
        event.response?.status === "completed" &&
        Array.isArray(event.response.output)
      ) {
        const calls = event.response.output.filter(
          (item: any) => item.type === "function_call",
        );
        const turn = this.turn;
        if (calls.length)
          void Promise.all(
            calls.map((call: any) => this.execute(call, generation)),
          )
            .then((results) => {
              if (
                results.some(Boolean) &&
                this.alive(generation) &&
                this.state === "connected" &&
                turn === this.turn &&
                !this.activeResponse
              )
                this.send({ type: "response.create" });
            })
            .catch(() => {
              if (this.alive(generation))
                this.fail(new Error("Realtime tool continuation failed"));
            });
      }
    }
  }
  private async execute(
    raw: Record<string, unknown>,
    generation: number,
  ): Promise<boolean> {
    if (
      typeof raw.call_id !== "string" ||
      !raw.call_id ||
      typeof raw.name !== "string"
    )
      throw new Error("Invalid realtime tool call");
    if (this.seenCalls.has(raw.call_id)) return false;
    if (this.seenCalls.size >= (this.options.maxToolCalls ?? 100))
      throw new Error("Voice session tool call limit reached");
    this.seenCalls.add(raw.call_id);
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(String(raw.arguments));
      if (!args || typeof args !== "object" || Array.isArray(args))
        throw new Error();
    } catch {
      this.sendToolOutput(raw.call_id, {
        success: false,
        error: "Invalid tool arguments",
      });
      return true;
    }
    const call: RealtimeToolCall = { id: raw.call_id, name: raw.name, args };
    const parent = this.controller!.signal;
    const controller = new AbortController();
    const cancel = () => controller.abort(parent.reason);
    parent.addEventListener("abort", cancel, { once: true });
    const signal = controller.signal;
    const timer = setTimeout(
      () =>
        controller.abort(new DOMException("Tool timed out", "TimeoutError")),
      this.options.toolTimeoutMs ?? 60_000,
    );
    const perform = async (): Promise<ToolResponse> => {
      const tool = this.options
        .getTools?.()
        .find((t) => t.name === call.name && t.available !== false);
      if (!tool?.handler)
        return {
          success: false,
          error: "Tool unavailable in this voice session",
        };
      const permission =
        (await this.options.getToolPermission?.(tool.name)) ?? "ask";
      signal.throwIfAborted();
      if (permission === "deny_always")
        return { success: false, error: "Tool permission denied" };
      const needsApproval =
        typeof tool.needsApproval === "function"
          ? await tool.needsApproval(args)
          : tool.needsApproval;
      signal.throwIfAborted();
      let approvalData: Record<string, unknown> | undefined;
      if (
        needsApproval &&
        permission !== "allow_always" &&
        permission !== "session"
      ) {
        const approval = await this.options.onApproval?.(call, signal);
        signal.throwIfAborted();
        if (!approval?.approved)
          return { success: false, error: "Tool approval denied" };
        approvalData = approval.data;
      }
      signal.throwIfAborted();
      const current = this.options
        .getTools?.()
        .find((t) => t.name === tool.name && t.available !== false);
      if (!current?.handler || current.needsApproval !== tool.needsApproval)
        return {
          success: false,
          error: "Tool changed while awaiting execution",
        };
      if ((await this.options.getToolPermission?.(tool.name)) === "deny_always")
        return { success: false, error: "Tool permission denied" };
      signal.throwIfAborted();
      return current.handler(args, {
        signal,
        toolCallId: call.id,
        approvalData,
      });
    };
    let result: ToolResponse;
    try {
      result = await Promise.race([perform(), aborted(signal)]);
    } catch {
      result = {
        success: false,
        error: signal.aborted
          ? "Tool cancelled or timed out"
          : "Tool execution failed",
      };
    } finally {
      clearTimeout(timer);
      parent.removeEventListener("abort", cancel);
      controller.abort();
    }
    if (!this.alive(generation) || parent.aborted || this.state !== "connected")
      return false;
    this.sendToolOutput(call.id, result);
    try {
      this.options.onToolResult?.(call, result);
    } catch {
      /* observer */
    }
    return true;
  }
  private sendToolOutput(id: string, result: ToolResponse) {
    let output: string;
    try {
      output = JSON.stringify(result);
      if (!output || output.length > 64_000) throw new Error();
    } catch {
      output = JSON.stringify({
        success: false,
        error: "Tool result must be JSON under 64 KB",
      });
    }
    this.send({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: id, output },
    });
  }
}

/** Convert active Copilot tool definitions for server-side realtime session setup. */
export function realtimeToolDefinitions(tools: ToolDefinition[]) {
  return tools
    .filter((tool) => tool.available !== false)
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: { ...tool.inputSchema, type: "object" as const },
    }));
}
