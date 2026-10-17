"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  RealtimeVoiceSession,
  type RealtimeApproval,
  type RealtimeToolCall,
  type RealtimeTranscript,
  type RealtimeVoiceOptions,
  type RealtimeVoiceState,
} from "../../core/realtime";
import { useCopilot } from "../provider/CopilotProvider";

export type UseRealtimeVoiceOptions = Omit<RealtimeVoiceOptions, "getTools">;
export interface RealtimePendingApproval extends RealtimeToolCall {
  approve(data?: Record<string, unknown>): void;
  reject(): void;
}
/** @experimental Uses CopilotProvider's tools/needsApproval and an optional application permission resolver. */
export function useRealtimeVoice(options: UseRealtimeVoiceOptions) {
  const context = useCopilot();
  const latest = useRef({ context, options });
  latest.current = { context, options };
  const sessionRef = useRef<RealtimeVoiceSession>();
  const mounted = useRef(false);
  const [state, setState] = useState<RealtimeVoiceState>("idle");
  const [muted, setMutedState] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [transcripts, setTranscripts] = useState<RealtimeTranscript[]>([]);
  const [pendingApprovals, setPending] = useState<RealtimePendingApproval[]>(
    [],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sessionRef.current?.disconnect();
      sessionRef.current = undefined;
    };
  }, []);
  const connect = useCallback(async () => {
    if (
      sessionRef.current &&
      ["connecting", "connected"].includes(sessionRef.current.state)
    )
      throw new Error("A voice session is already active");
    setError(null);
    setMutedState(false);
    setTranscripts([]);
    setPending([]);
    const config = latest.current.options;
    const session = new RealtimeVoiceSession({
      ...config,
      getTools: () =>
        latest.current.context.getRegisteredTools?.() ??
        latest.current.context.registeredTools,
      getToolPermission: (name) =>
        latest.current.options.getToolPermission?.(name) ??
        Promise.resolve("ask"),
      onStateChange: (value) => {
        if (mounted.current) setState(value);
        latest.current.options.onStateChange?.(value);
      },
      onError: (value) => {
        if (mounted.current) setError(value);
        latest.current.options.onError?.(value);
      },
      onTranscript: (value) => {
        if (mounted.current)
          setTranscripts((previous) => {
            const index = previous.findIndex((item) => item.id === value.id);
            return index < 0
              ? [...previous.slice(-199), value]
              : previous.map((item, i) => (i === index ? value : item));
          });
        latest.current.options.onTranscript?.(value);
      },
      onUsage: (value) => latest.current.options.onUsage?.(value),
      onEvent: (value) => latest.current.options.onEvent?.(value),
      onToolResult: (call, result) =>
        latest.current.options.onToolResult?.(call, result),
      onApproval: (call, signal) => {
        if (latest.current.options.onApproval)
          return latest.current.options.onApproval(call, signal);
        return new Promise<RealtimeApproval>((resolve) => {
          let settled = false;
          const finish = (answer: RealtimeApproval) => {
            if (settled) return;
            settled = true;
            signal.removeEventListener("abort", cancel);
            if (mounted.current)
              setPending((previous) =>
                previous.filter((item) => item.id !== call.id),
              );
            resolve(answer);
          };
          const cancel = () => finish({ approved: false });
          if (signal.aborted) return cancel();
          signal.addEventListener("abort", cancel, { once: true });
          if (mounted.current)
            setPending((previous) => [
              ...previous,
              {
                ...call,
                approve: (data) => finish({ approved: true, data }),
                reject: cancel,
              },
            ]);
          else cancel();
        });
      },
    });
    sessionRef.current = session;
    await session.connect();
  }, []);
  const disconnect = useCallback(() => {
    sessionRef.current?.disconnect();
  }, []);
  const current = useCallback(() => {
    if (!sessionRef.current) throw new Error("Voice session has not started");
    return sessionRef.current;
  }, []);
  const setMuted = useCallback(
    (value: boolean) => {
      current().setMuted(value);
      setMutedState(value);
    },
    [current],
  );
  const sendText = useCallback(
    (text: string) => current().sendText(text),
    [current],
  );
  const interrupt = useCallback(() => current().interrupt(), [current]);
  const resumeAudio = useCallback(() => current().resumeAudio(), [current]);
  const commitAudio = useCallback(() => current().commitAudio(), [current]);
  return {
    state,
    muted,
    error,
    transcripts,
    pendingApprovals,
    connect,
    disconnect,
    setMuted,
    sendText,
    interrupt,
    resumeAudio,
    commitAudio,
  };
}
