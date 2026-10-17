"use client";
import { useState } from "react";
import {
  CopilotProvider,
  useRealtimeVoice,
  useTool,
} from "@yourgpt/copilot-sdk/react";
import styles from "./feature-lab.module.css";
const schema = { type: "object", properties: {}, additionalProperties: false };
function Session({ enabled }: { enabled: boolean }) {
  const [executions, setExecutions] = useState(0);
  const [error, setError] = useState<string>();
  const [events, setEvents] = useState<string[]>([]);
  useTool({
    name: "get_demo_status",
    description: "Read the local demo status",
    inputSchema: schema,
    needsApproval: true,
    handler: async () => {
      setExecutions((n) => n + 1);
      return { success: true, data: { status: "Blue balloon ready" } };
    },
  });
  const voice = useRealtimeVoice({
    createCall: async ({ sdp, signal }) => {
      const response = await fetch("/playground/api/features/realtime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sdp }),
        signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Voice setup failed");
      return data;
    },
    onEvent: (event) => {
      if (typeof event.type === "string") {
        const type = event.type;
        setEvents((previous) => [...previous.slice(-24), type]);
      }
    },
  });
  async function perform(action: () => void | Promise<void>) {
    setError(undefined);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Voice action failed");
    }
  }
  const active = voice.state === "connected";
  return (
    <div className={styles.stack}>
      <div className={styles.voiceStatus}>
        <span className={active ? styles.dotLive : styles.dot} />
        <strong role="status">{voice.state}</strong>
        <span>
          {voice.muted
            ? "Microphone muted"
            : "Microphone activates when you start"}
        </span>
      </div>
      <div className={styles.actions}>
        <button
          className={styles.primary}
          disabled={!enabled || active || voice.state === "connecting"}
          onClick={() => perform(voice.connect)}
        >
          Start voice call
        </button>
        <button
          className={styles.button}
          disabled={!active && voice.state !== "connecting"}
          onClick={voice.disconnect}
        >
          End call
        </button>
        <button
          className={styles.button}
          disabled={!active}
          onClick={() => perform(() => voice.setMuted(!voice.muted))}
        >
          {voice.muted ? "Unmute" : "Mute"}
        </button>
        <button
          className={styles.button}
          disabled={!active}
          onClick={() => perform(voice.interrupt)}
        >
          Interrupt reply
        </button>
        <button
          className={styles.button}
          disabled={!active}
          onClick={() => perform(voice.resumeAudio)}
        >
          Enable audio
        </button>
      </div>
      <button
        className={styles.button}
        disabled={!active}
        onClick={() =>
          perform(() =>
            voice.sendText("What is the demo status? Use the tool."),
          )
        }
      >
        Ask for demo status
      </button>
      <p className={styles.muted}>
        Tool executions:{" "}
        <strong data-testid="voice-executions">{executions}</strong>. Each call
        requires your approval.
      </p>
      {voice.pendingApprovals.map((call) => (
        <div className={styles.notice} key={call.id}>
          <strong>Allow {call.name}?</strong>
          <div className={styles.actions}>
            <button className={styles.primary} onClick={() => call.approve()}>
              Allow tool
            </button>
            <button className={styles.button} onClick={call.reject}>
              Deny tool
            </button>
          </div>
        </div>
      ))}
      {error || voice.error ? (
        <p className={styles.error} role="alert">
          {error ?? voice.error?.message}
        </p>
      ) : null}
      <div
        className={styles.transcript}
        aria-live="polite"
        aria-label="Voice transcripts"
      >
        {voice.transcripts.length ? (
          voice.transcripts.map((item) => (
            <p key={item.id}>
              <strong>{item.role}</strong> {item.text}
            </p>
          ))
        ) : (
          <p className={styles.muted}>
            Transcripts will appear here during the call.
          </p>
        )}
      </div>
      <details>
        <summary>Realtime event types</summary>
        <pre className={styles.code}>
          {events.join("\n") || "No events yet"}
        </pre>
      </details>
    </div>
  );
}
export default function RealtimePanel({ enabled }: { enabled: boolean }) {
  return (
    <CopilotProvider runtimeUrl="/playground/api/features/chat">
      <Session enabled={enabled} />
    </CopilotProvider>
  );
}
