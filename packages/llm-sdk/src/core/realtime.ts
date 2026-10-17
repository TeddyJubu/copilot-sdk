export interface RealtimeToolDefinition {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}
export interface RealtimeSessionOptions {
  instructions?: string;
  voice?: string;
  transcriptionModel?: string;
  language?: string;
  outputModality?: "audio" | "text";
  turnDetection?:
    | {
        type: "server_vad";
        threshold?: number;
        silenceDurationMs?: number;
        prefixPaddingMs?: number;
      }
    | { type: "semantic_vad"; eagerness?: "auto" | "low" | "medium" | "high" }
    | null;
  tools?: RealtimeToolDefinition[];
  maxOutputTokens?: number | "inf";
  safetyIdentifier?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}
/** Short-lived credential, not a persisted session or a server authorization policy. */
export interface RealtimeClientSecret {
  value: string;
  expiresAt: number;
  modelId: string;
}
export interface RealtimeModel {
  readonly provider: string;
  readonly modelId: string;
  createClientSecret(
    options?: RealtimeSessionOptions & { expiresAfterSeconds?: number },
  ): Promise<RealtimeClientSecret>;
  /** Exchange a browser SDP offer on your authenticated server. Returns no credentials. */
  createCall(
    options: RealtimeSessionOptions & { sdp: string },
  ): Promise<{ sdp: string }>;
}
