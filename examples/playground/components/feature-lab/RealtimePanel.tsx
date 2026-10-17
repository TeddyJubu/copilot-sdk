"use client";
import { useState } from "react";
import {
  CopilotProvider,
  useRealtimeVoice,
  useTool,
} from "@yourgpt/copilot-sdk/react";
import {
  Mic,
  MicOff,
  PhoneOff,
  Phone,
  Volume2,
  Hand,
  Wrench,
} from "lucide-react";
import {
  Btn,
  Note,
  Panel,
  PanelHeader,
  StatusWord,
} from "@/components/bench/ui";
import { CodeView } from "@/components/bench/CodeView";
import { cn } from "@/lib/utils";

const schema = { type: "object", properties: {}, additionalProperties: false };

/** A light that breathes with the call: dim idle, pulsing while connecting, lit live. */
function VoiceOrb({ state, muted }: { state: string; muted: boolean }) {
  const live = state === "connected";
  const connecting = state === "connecting";
  return (
    <div aria-hidden className="relative grid size-36 place-items-center">
      {connecting ? (
        <>
          <span className="absolute inset-4 animate-ping rounded-full bg-brand/15 [animation-duration:1.6s]" />
          <span className="absolute inset-8 animate-ping rounded-full bg-brand/20 [animation-duration:1.6s] [animation-delay:400ms]" />
        </>
      ) : null}
      <span
        className={cn(
          "absolute inset-6 rounded-full blur-2xl transition-opacity duration-500",
          live && !muted ? "bg-brand/45 opacity-100" : "opacity-0",
        )}
      />
      <span
        className={cn(
          "relative size-24 rounded-full transition-[transform,filter,opacity] duration-500 ease-out-strong",
          "bg-[radial-gradient(circle_at_32%_28%,oklch(0.95_0.05_284),var(--brand)_45%,oklch(0.3_0.15_284)_100%)]",
          "shadow-[inset_0_-8px_18px_oklch(0_0_0/35%),0_10px_30px_-10px_var(--brand)]",
          live
            ? "scale-100 motion-safe:animate-[orb-breathe_3.2s_ease-in-out_infinite]"
            : "scale-90",
          !live && !connecting && "opacity-45 saturate-50",
          muted && "saturate-0",
        )}
      />
      {muted ? (
        <span className="absolute right-5 bottom-5 grid size-7 place-items-center rounded-full bg-card text-muted-foreground shadow-[var(--shadow-panel)]">
          <MicOff className="size-3.5" />
        </span>
      ) : null}
      <style>{`@keyframes orb-breathe{50%{transform:scale(1.045)}}`}</style>
    </div>
  );
}

function Session({
  enabled,
  headers,
}: {
  enabled: boolean;
  headers: Record<string, string>;
}) {
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
        headers: { "Content-Type": "application/json", ...headers },
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
  const connecting = voice.state === "connecting";
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      <Panel aria-labelledby="call-title" className="flex flex-col">
        {connecting ? <div className="run-beam" /> : null}
        <PanelHeader
          id="call-title"
          title="Voice call"
          meta="WebRTC · OpenAI Realtime"
          actions={
            <StatusWord
              tone={active ? "passed" : connecting ? "running" : "idle"}
            >
              <strong role="status" className="font-medium">
                {voice.state}
              </strong>
            </StatusWord>
          }
        />
        <div className="flex flex-col items-center gap-5 px-4 pt-6 pb-5">
          <VoiceOrb state={voice.state} muted={voice.muted} />
          <p className="text-center text-[12.5px] text-muted-foreground">
            {voice.muted
              ? "Microphone muted"
              : "Microphone activates when you start"}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {active || connecting ? (
              <Btn variant="danger" size="lg" onClick={voice.disconnect}>
                <PhoneOff aria-hidden />
                End call
              </Btn>
            ) : (
              <Btn
                variant="primary"
                size="lg"
                disabled={!enabled}
                onClick={() => perform(voice.connect)}
              >
                <Phone aria-hidden />
                Start voice call
              </Btn>
            )}
            <Btn
              size="lg"
              disabled={!active}
              onClick={() => perform(() => voice.setMuted(!voice.muted))}
            >
              {voice.muted ? <Mic aria-hidden /> : <MicOff aria-hidden />}
              {voice.muted ? "Unmute" : "Mute"}
            </Btn>
          </div>
          <div className="flex flex-wrap justify-center gap-1.5">
            <Btn
              size="sm"
              variant="ghost"
              disabled={!active}
              onClick={() => perform(voice.interrupt)}
            >
              <Hand aria-hidden />
              Interrupt reply
            </Btn>
            <Btn
              size="sm"
              variant="ghost"
              disabled={!active}
              onClick={() => perform(voice.resumeAudio)}
            >
              <Volume2 aria-hidden />
              Enable audio
            </Btn>
          </div>
        </div>
        <div className="mt-auto space-y-3 border-t border-line p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="grid size-7 place-items-center rounded-md bg-muted text-faint">
                <Wrench aria-hidden className="size-3.5" />
              </span>
              <div className="leading-tight">
                <p className="num text-[12px]">get_demo_status</p>
                <p className="text-[11.5px] text-faint">
                  Tool executions:{" "}
                  <strong
                    data-testid="voice-executions"
                    className="num text-foreground"
                  >
                    {executions}
                  </strong>
                  . Each call requires your approval.
                </p>
              </div>
            </div>
            <Btn
              size="sm"
              disabled={!active}
              onClick={() =>
                perform(() =>
                  voice.sendText("What is the demo status? Use the tool."),
                )
              }
            >
              Ask for demo status
            </Btn>
          </div>
          {voice.pendingApprovals.map((call) => (
            <div
              key={call.id}
              className="enter flex flex-wrap items-center justify-between gap-3 rounded-lg bg-brand-soft px-3 py-2.5 shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--brand)_30%,transparent)]"
            >
              <strong className="text-[12.5px] font-medium">
                Allow {call.name}?
              </strong>
              <div className="flex gap-1.5">
                <Btn size="sm" variant="primary" onClick={() => call.approve()}>
                  Allow tool
                </Btn>
                <Btn size="sm" variant="ghost" onClick={call.reject}>
                  Deny tool
                </Btn>
              </div>
            </div>
          ))}
          {error || voice.error ? (
            <Note tone="danger" role="alert">
              {error ?? voice.error?.message}
            </Note>
          ) : null}
        </div>
      </Panel>

      <Panel
        aria-labelledby="transcript-title"
        className="flex min-h-[420px] flex-col"
      >
        <PanelHeader
          id="transcript-title"
          title="Transcript"
          meta={`${voice.transcripts.length} turn${voice.transcripts.length === 1 ? "" : "s"}`}
        />
        <div
          className="flex max-h-[440px] flex-1 flex-col gap-2 overflow-y-auto p-4"
          aria-live="polite"
          aria-label="Voice transcripts"
        >
          {voice.transcripts.length ? (
            voice.transcripts.map((item) => {
              const user = item.role === "user";
              return (
                <p
                  key={item.id}
                  className={cn(
                    "enter max-w-[85%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed",
                    user
                      ? "self-end rounded-br-md bg-brand text-brand-foreground"
                      : "self-start rounded-bl-md bg-muted",
                  )}
                >
                  <strong
                    className={cn(
                      "num mr-1.5 text-[10px] font-normal tracking-wide uppercase",
                      user ? "text-brand-foreground/70" : "text-faint",
                    )}
                  >
                    {item.role}
                  </strong>{" "}
                  {item.text}
                </p>
              );
            })
          ) : (
            <p className="m-auto max-w-[260px] text-center text-[12.5px] text-muted-foreground">
              Transcripts will appear here during the call.
            </p>
          )}
        </div>
        <details className="group border-t border-line">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-[12px] font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
            Realtime event types
            <span className="num text-[10.5px] text-faint">
              {events.length}
            </span>
          </summary>
          <CodeView
            code={events.join("\n") || "No events yet"}
            className="max-h-[220px] overflow-y-auto border-t border-line text-[11.5px]"
          />
        </details>
      </Panel>
    </div>
  );
}

export default function RealtimePanel({
  enabled,
  headers,
}: {
  enabled: boolean;
  headers: Record<string, string>;
}) {
  return (
    <CopilotProvider runtimeUrl="/playground/api/features/chat">
      <Session enabled={enabled} headers={headers} />
    </CopilotProvider>
  );
}
