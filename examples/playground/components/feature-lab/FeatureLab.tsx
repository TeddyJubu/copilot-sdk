"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  ArrowUpRight,
  BookOpen,
  Check,
  Download,
  FileAudio,
  FileImage,
  MessagesSquare,
  Mic,
  Play,
  Square,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { featureHeaders, hasFeatureKey } from "@/lib/feature-lab/credentials";
import {
  VoiceRecorder,
  type VoiceRecordingState,
} from "@yourgpt/copilot-sdk/core";
import {
  features,
  listedFeatures,
  defaultFeature,
  coreChecks,
  BLUE_PNG,
  type FeatureId,
  type LabProvider,
  type LabInput,
  type LabResult,
} from "@/lib/feature-lab/catalog";
import { AppShell, Crumbs } from "@/components/bench/AppShell";
import { FeatureNav, featureIcons } from "@/components/bench/FeatureNav";
import { CodeView, CopyButton } from "@/components/bench/CodeView";
import { useKeys } from "@/components/bench/keys";
import {
  Btn,
  FieldLabel,
  Kbd,
  Led,
  Note,
  Panel,
  PanelHeader,
  StatusWord,
  linkButtonClass,
  type Tone,
} from "@/components/bench/ui";
import { cn } from "@/lib/utils";
import { DOCS_URL, featureDocs } from "@/lib/documentation";

const RealtimePanel = dynamic(() => import("./RealtimePanel"), { ssr: false });
const ChatPanel = dynamic(() => import("./ChatPanel"), { ssr: false });

type Availability = Partial<
  Record<LabProvider, { configured: boolean; requires: string[] }>
>;
type Run = {
  feature: FeatureId;
  provider: LabProvider;
  status: "passed" | "failed" | "skipped" | "cancelled";
  result?: LabResult;
  error?: string;
  timestamp: string;
};
const maxBytes = 4 * 1024 * 1024;
const providerNames: Record<LabProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  openrouter: "OpenRouter",
  typesafe: "TypeSafe / Jev",
  cloudflare: "Cloudflare",
};
const chatFeatures: FeatureId[] = [
  "parameters",
  "responses",
  "tool-images",
  "system-prompt",
];

async function encodeFile(
  blob: Blob,
  name: string,
): Promise<NonNullable<LabInput["file"]>> {
  if (blob.size > maxBytes) throw new Error("Choose a file up to 4 MiB.");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.onload = () =>
      resolve({
        base64: String(reader.result).split(",")[1],
        mediaType:
          blob.type ||
          (name.endsWith(".wav") ? "audio/wav" : "application/octet-stream"),
        name,
      });
    reader.readAsDataURL(blob);
  });
}
function saveReport(runs: Run[]) {
  const text = JSON.stringify(
    {
      timestamp: new Date().toISOString(),
      runs: runs.map((run) => ({
        ...run,
        result: run.result
          ? {
              ...run.result,
              media: run.result.media
                ? {
                    mediaType: run.result.media.mediaType,
                    filename: run.result.media.filename,
                  }
                : undefined,
            }
          : undefined,
      })),
    },
    null,
    2,
  );
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "copilot-feature-lab.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function formatSeconds(ms?: number) {
  return ms ? `${(ms / 1000).toFixed(1)}s` : "—";
}
function formatClock(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function MediaResult({ result }: { result: LabResult }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const downloadRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (!result.media) return;
    const bytes = Uint8Array.from(atob(result.media.base64), (c) =>
      c.charCodeAt(0),
    );
    const next = URL.createObjectURL(
      new Blob([bytes], { type: result.media.mediaType }),
    );
    // Blob URLs are browser resources; attach them after commit and release them
    // when the result changes, including during StrictMode's setup/cleanup cycle.
    const media = audioRef.current ?? imageRef.current;
    const download = downloadRef.current;
    if (media) media.src = next;
    if (download) download.href = next;
    return () => {
      if (media instanceof HTMLAudioElement) media.pause();
      media?.removeAttribute("src");
      download?.removeAttribute("href");
      URL.revokeObjectURL(next);
    };
  }, [result.media]);
  if (!result.media) return null;
  const audio = result.media.mediaType.startsWith("audio/");
  return (
    <div className="enter space-y-2.5">
      {audio ? (
        <audio
          ref={audioRef}
          controls
          aria-label="Generated AI speech"
          className="h-10 w-full"
        />
      ) : (
        <div className="overflow-hidden rounded-lg bg-[repeating-conic-gradient(var(--muted)_0_25%,transparent_0_50%)] bg-[length:16px_16px] shadow-[inset_0_0_0_1px_var(--line)]">
          {/* Blob previews are local browser resources, not optimizable remote images. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imageRef}
            alt="Generated result"
            className="mx-auto max-h-[360px] w-auto"
          />
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <span className="num truncate text-[11px] text-faint">
          {result.media.filename} · {result.media.mediaType}
        </span>
        <a
          ref={downloadRef}
          className={linkButtonClass("outline", "sm")}
          download={result.media.filename}
        >
          <Download aria-hidden />
          Download {audio ? "audio" : "image"}
        </a>
      </div>
    </div>
  );
}

function CoreMeter({ runs, busyKey }: { runs: Run[]; busyKey?: string }) {
  const cells = coreChecks.map((check) => {
    const last = [...runs]
      .reverse()
      .find(
        (r) => r.feature === check.feature && r.provider === check.provider,
      );
    const key = `${check.feature}:${check.provider}`;
    const tone: Tone = busyKey === key ? "running" : (last?.status ?? "idle");
    const name = features.find((f) => f.id === check.feature)!.name;
    return { key, tone, label: `${name} · ${providerNames[check.provider]}` };
  });
  const passed = cells.filter((c) => c.tone === "passed").length;
  return (
    <div className="flex items-center gap-3">
      <div className="text-right leading-tight">
        <p className="num text-[15px] font-medium">
          {passed}
          <span className="text-faint">/{cells.length}</span>
        </p>
        <p className="eyebrow !text-[9.5px]">Core checks</p>
      </div>
      <ol
        className="flex h-7 items-end gap-[3px]"
        aria-label="Core check status"
      >
        {cells.map((cell) => (
          <li
            key={cell.key}
            title={`${cell.label}: ${cell.tone === "idle" ? "not run" : cell.tone}`}
            className={cn(
              "w-[5px] rounded-full transition-[height,background-color] duration-300 ease-out-strong",
              cell.tone === "passed"
                ? "h-7 bg-success"
                : cell.tone === "failed"
                  ? "h-7 bg-danger"
                  : cell.tone === "skipped" || cell.tone === "cancelled"
                    ? "h-4 bg-warning"
                    : cell.tone === "running"
                      ? "h-5 animate-pulse bg-brand"
                      : "h-2.5 bg-line-strong",
            )}
          >
            <span className="sr-only">
              {cell.label}: {cell.tone === "idle" ? "not run" : cell.tone}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function UploadField({
  kind,
  file,
  disabled,
  inputKey,
  onFile,
  onError,
  onClear,
}: {
  kind: "image" | "audio";
  file?: LabInput["file"];
  disabled: boolean;
  inputKey: string;
  onFile: (file: NonNullable<LabInput["file"]>) => void;
  onError: (message: string) => void;
  onClear: () => void;
}) {
  const [over, setOver] = useState(false);
  async function take(next?: File | null) {
    if (!next) return;
    try {
      onFile(await encodeFile(next, next.name));
    } catch (err) {
      onError(err instanceof Error ? err.message : "Invalid file");
    }
  }
  const Icon = kind === "image" ? FileImage : FileAudio;
  if (file)
    return (
      <div className="enter flex items-center gap-3 rounded-lg bg-surface px-3 py-2.5 shadow-[inset_0_0_0_1px_var(--line-strong)]">
        <span className="grid size-8 place-items-center rounded-md bg-brand-soft text-brand">
          <Icon aria-hidden className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-medium">{file.name}</p>
          <p className="num text-[10.5px] text-faint">
            {file.mediaType} ·{" "}
            {Math.max(1, Math.round((file.base64.length * 3) / 4 / 1024))} KB
          </p>
        </div>
        <Btn size="sm" variant="ghost" disabled={disabled} onClick={onClear}>
          <X aria-hidden />
          Remove file
        </Btn>
      </div>
    );
  return (
    <label
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled) take(e.dataTransfer.files?.[0]);
      }}
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-lg border border-dashed px-3 py-3 transition-colors duration-150",
        over
          ? "border-brand bg-brand-soft"
          : "border-line-strong hover:border-faint hover:bg-surface",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <span className="grid size-8 place-items-center rounded-md bg-muted text-faint">
        <Upload aria-hidden className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-medium">
          {kind === "image"
            ? "Drop an image or browse"
            : "Drop audio or browse"}
        </span>
        <span className="num block text-[10.5px] text-faint">
          {kind === "image" ? "PNG · JPEG · WebP" : "Any browser audio"} · up to
          4 MiB
        </span>
      </span>
      <input
        key={inputKey}
        type="file"
        className="sr-only"
        aria-label={kind === "image" ? "Upload image" : "Upload audio"}
        accept={
          kind === "image" ? "image/png,image/jpeg,image/webp" : "audio/*"
        }
        disabled={disabled}
        onChange={(e) => take(e.target.files?.[0])}
      />
    </label>
  );
}

export default function FeatureLab() {
  const { keys: apiKeys, openKeys, keysOpen } = useKeys();
  const [selected, setSelected] = useState<FeatureId>(defaultFeature);
  const feature = features.find((item) => item.id === selected)!;
  const [provider, setProvider] = useState<LabProvider>("openai");
  const [availability, setAvailability] = useState<Availability>({});
  const [localCredentials, setLocalCredentials] = useState(false);
  const [setupError, setSetupError] = useState<string>();
  const [text, setText] = useState(feature.defaultText ?? "");
  const [streaming, setStreaming] = useState(true);
  const [reasoning, setReasoning] = useState<"default" | "none">("default");
  const [file, setFile] = useState<LabInput["file"]>();
  const [busy, setBusy] = useState<string>();
  const [busyKey, setBusyKey] = useState<string>();
  const [error, setError] = useState<string>();
  const [runs, setRuns] = useState<Run[]>([]);
  const [chat, setChat] = useState(false);
  const [recording, setRecording] = useState<VoiceRecordingState>("idle");
  const abort = useRef<AbortController | null>(null);
  const recorder = useRef<VoiceRecorder | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/playground/api/features/status", { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setAvailability(data.providers);
        setLocalCredentials(!!data.localCredentials);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setSetupError(e.message);
      });
    return () => {
      controller.abort();
      abort.current?.abort();
      recorder.current?.cancel();
    };
  }, []);
  const select = useCallback(
    (id: FeatureId) => {
      if (busy) return;
      recorder.current?.cancel();
      setRecording("idle");
      const next = features.find((item) => item.id === id)!;
      setSelected(id);
      setProvider((current) =>
        next.providers.includes(current) ? current : next.providers[0],
      );
      setText(next.defaultText ?? "");
      setFile(undefined);
      setError(undefined);
      setChat(false);
      try {
        window.history.replaceState(null, "", `?feature=${id}`);
      } catch {
        // URL sync is a convenience only.
      }
    },
    [busy],
  );
  // Deep links from the dashboard rail: /features?feature=decisions
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("feature");
    if (id && features.some((f) => f.id === id) && id !== defaultFeature)
      select(id as FeatureId);
    // Only on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function execute(
    id: FeatureId,
    input: LabInput,
    controller: AbortController,
  ) {
    const response = await fetch(`/playground/api/features/${id}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...featureHeaders(apiKeys, input.provider),
      },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error ?? `Request failed (${response.status})`);
    return data as LabResult;
  }
  async function runExample() {
    const controller = new AbortController();
    abort.current = controller;
    setBusy(feature.name);
    setBusyKey(`${selected}:${provider}`);
    setError(undefined);
    try {
      const result = await execute(
        selected,
        { provider, text, streaming, reasoning, file },
        controller,
      );
      setRuns((previous) => [
        ...previous,
        {
          feature: selected,
          provider,
          status: result.checks.every((c) => c.passed) ? "passed" : "failed",
          result,
          timestamp: new Date().toISOString(),
        },
      ]);
    } catch (e) {
      const message = controller.signal.aborted
        ? "Cancelled"
        : e instanceof Error
          ? e.message
          : "Request failed";
      setError(message);
      setRuns((previous) => [
        ...previous,
        {
          feature: selected,
          provider,
          status: controller.signal.aborted ? "cancelled" : "failed",
          error: message,
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      if (abort.current === controller) {
        abort.current = null;
        setBusy(undefined);
        setBusyKey(undefined);
      }
    }
  }
  async function runCoreChecks() {
    const controller = new AbortController();
    abort.current = controller;
    setError(undefined);
    setChat(false);
    for (const item of coreChecks) {
      if (controller.signal.aborted) break;
      if (!providerReady(item.provider)) {
        setRuns((previous) => [
          ...previous,
          {
            ...item,
            status: "skipped",
            error: "Provider key not configured",
            timestamp: new Date().toISOString(),
          },
        ]);
        continue;
      }
      setBusy(
        `${features.find((f) => f.id === item.feature)!.name} · ${providerNames[item.provider]}`,
      );
      setBusyKey(`${item.feature}:${item.provider}`);
      try {
        const result = await execute(
          item.feature,
          { provider: item.provider, streaming: true },
          controller,
        );
        setRuns((previous) => [
          ...previous,
          {
            ...item,
            status: result.checks.every((c) => c.passed) ? "passed" : "failed",
            result,
            timestamp: new Date().toISOString(),
          },
        ]);
      } catch (e) {
        setRuns((previous) => [
          ...previous,
          {
            ...item,
            status: controller.signal.aborted ? "cancelled" : "failed",
            error: controller.signal.aborted
              ? "Cancelled"
              : e instanceof Error
                ? e.message
                : "Request failed",
            timestamp: new Date().toISOString(),
          },
        ]);
      }
    }
    if (abort.current === controller) {
      abort.current = null;
      setBusy(undefined);
      setBusyKey(undefined);
    }
  }
  async function record() {
    setError(undefined);
    try {
      if (recording === "recording") {
        const result = await recorder.current!.stop();
        const extension = result.mediaType.includes("mp4")
          ? "m4a"
          : result.mediaType.includes("ogg")
            ? "ogg"
            : "webm";
        setFile(await encodeFile(result.audio, `recording.${extension}`));
      } else {
        recorder.current = new VoiceRecorder({
          maxBytes,
          maxDurationMs: 30_000,
          onStateChange: setRecording,
          onError: (e) => setError(e.message),
        });
        await recorder.current.start();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Recording failed");
    }
  }
  function providerReady(id: LabProvider) {
    // Gate browser storage behind the status fetch so SSR and hydration agree.
    if (!availability[id]) return false;
    if (apiKeys[id]?.trim()) return hasFeatureKey(apiKeys, id);
    return !!availability[id]?.configured;
  }
  const ready = providerReady(provider);
  const canRun =
    ready && !busy && recording === "idle" && selected !== "realtime";
  const runtimeHeaders = useMemo(
    () => featureHeaders(apiKeys, provider),
    [apiKeys, provider],
  );
  const current = [...runs]
    .reverse()
    .find((run) => run.feature === selected && run.provider === provider);
  const result = current?.result;
  const running = busyKey === `${selected}:${provider}`;
  // Rail light per feature: the latest run of each provider, failures first.
  const navStatus = useMemo(() => {
    const latest = new Map<string, Run>();
    for (const run of runs) latest.set(`${run.feature}:${run.provider}`, run);
    const status: Partial<Record<FeatureId, Tone>> = {};
    const rank: Record<Run["status"], number> = {
      failed: 3,
      passed: 2,
      cancelled: 1,
      skipped: 0,
    };
    for (const run of latest.values()) {
      const previous = status[run.feature] as Run["status"] | undefined;
      if (!previous || rank[run.status] > rank[previous])
        status[run.feature] = run.status;
    }
    if (busyKey) status[busyKey.split(":")[0] as FeatureId] = "running";
    return status;
  }, [runs, busyKey]);
  const passedRuns = runs.filter((run) => run.status === "passed").length;

  // ⌘/Ctrl + Enter runs the focused example. No animation: it's a keyboard action.
  const runRef = useRef(runExample);
  runRef.current = runExample;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key !== "Enter") return;
      if (keysOpen || !canRun) return;
      e.preventDefault();
      runRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canRun, keysOpen]);

  const featureIndex = listedFeatures.findIndex((f) => f.id === selected) + 1;
  const Icon = featureIcons[selected];
  const keyState = ready
    ? hasFeatureKey(apiKeys, provider)
      ? "● Your key ready"
      : "● Local server key ready"
    : "○ Key not configured";

  return (
    <AppShell
      active="lab"
      docsPath={featureDocs[selected]}
      crumb={<Crumbs items={["Playground", "Feature lab", feature.name]} />}
      rail={
        <FeatureNav
          mode="buttons"
          selected={selected}
          status={navStatus}
          disabled={!!busy}
          onSelect={select}
        />
      }
    >
      <div className="mx-auto w-full max-w-[1200px] space-y-4 px-4 py-6 sm:px-6 lg:py-8">
        {/* Feature header */}
        <header className="flex flex-col gap-5 pb-2 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0 max-w-[640px]">
            <p className="eyebrow flex items-center gap-2">
              {feature.check ? (
                <span className="text-brand">Compatibility check</span>
              ) : (
                <>
                  <span className="text-brand">Feature</span>
                  <span aria-hidden>·</span>
                  <span className="num">
                    {String(featureIndex).padStart(2, "0")}/
                    {String(listedFeatures.length).padStart(2, "0")}
                  </span>
                </>
              )}
            </p>
            <h1
              id="feature-title"
              className="mt-2 flex items-center gap-3 text-[24px] leading-tight font-semibold tracking-[-0.025em]"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-card text-brand shadow-[var(--shadow-panel)]">
                <Icon aria-hidden className="size-[18px]" />
              </span>
              {feature.name}
            </h1>
            <p className="mt-2.5 text-[13.5px] leading-relaxed text-muted-foreground">
              {feature.description}
            </p>
            <a
              href={`${DOCS_URL}${featureDocs[selected]}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${feature.name} documentation`}
              className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-brand underline-offset-4 hover:underline"
            >
              <BookOpen aria-hidden className="size-3.5" />
              Read guide
              <ArrowUpRight aria-hidden className="size-3.5" />
            </a>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-4">
            <CoreMeter runs={runs} busyKey={busyKey} />
            <div className="flex items-center gap-1.5">
              <Btn
                size="md"
                variant="ghost"
                disabled={!runs.length || !!busy}
                onClick={() => saveReport(runs)}
              >
                <Download aria-hidden />
                Export results
              </Btn>
              <Btn
                size="md"
                variant="solid"
                disabled={
                  !!busy ||
                  !Object.keys(availability).some((id) =>
                    providerReady(id as LabProvider),
                  ) ||
                  selected === "realtime"
                }
                onClick={runCoreChecks}
              >
                <Play aria-hidden className="fill-current" />
                Run core checks
              </Btn>
            </div>
          </div>
        </header>

        {setupError ? (
          <Note tone="danger" role="alert">
            {setupError}
          </Note>
        ) : null}

        {/* Provider strip */}
        <Panel className="flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3">
          <label className="flex items-center gap-2.5 text-[12.5px] font-medium text-muted-foreground">
            Provider
            <select
              className="control w-auto min-w-[150px]"
              value={provider}
              disabled={!!busy}
              onChange={(e) => {
                setProvider(e.target.value as LabProvider);
                setFile(undefined);
                setError(undefined);
                setChat(false);
              }}
            >
              {feature.providers.map((p) => (
                <option key={p} value={p}>
                  {providerNames[p]}
                </option>
              ))}
            </select>
          </label>
          <span
            className={cn(
              "num text-[11.5px]",
              ready ? "text-success" : "text-faint",
            )}
          >
            {keyState}
          </span>
          {!ready ? (
            <Btn size="xs" variant="outline" onClick={openKeys}>
              Add {providerNames[provider]} key
            </Btn>
          ) : null}
          <div className="ml-auto flex items-center gap-4">
            <span className="num hidden text-[11px] text-faint sm:inline">
              {feature.providers.length} provider
              {feature.providers.length > 1 ? "s" : ""} ·{" "}
              {feature.providers.map((p) => providerNames[p]).join(", ")}
            </span>
            {feature.streaming ? (
              <label className="flex cursor-pointer items-center gap-2 text-[12.5px] font-medium">
                <input
                  type="checkbox"
                  className="switch"
                  checked={streaming}
                  disabled={!!busy}
                  onChange={(e) => setStreaming(e.target.checked)}
                />
                Streaming
              </label>
            ) : null}
          </div>
        </Panel>

        {!ready ? (
          <Note tone="brand">
            Add your {providerNames[provider]} key in API keys
            {provider === "cloudflare" ? " together with your account ID" : ""}.
            {localCredentials
              ? " Local development also supports server environment keys."
              : " The playground uses your key for these requests."}
          </Note>
        ) : null}

        {selected === "realtime" ? (
          <RealtimePanel enabled={ready} headers={runtimeHeaders} />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)]">
            {/* Request */}
            <Panel aria-labelledby="request-title" className="flex flex-col">
              <PanelHeader
                id="request-title"
                title="Request"
                meta={feature.source.split(" → ")[1]}
              />
              <div className="flex flex-1 flex-col gap-4 p-4">
                {feature.defaultText ? (
                  <div>
                    <label className="block">
                      <FieldLabel>
                        {selected === "decisions"
                          ? "Ticket / shared state"
                          : "Prompt or text"}
                      </FieldLabel>
                      <textarea
                        className="control min-h-[112px]"
                        rows={4}
                        value={text}
                        maxLength={2000}
                        disabled={!!busy}
                        onChange={(e) => setText(e.target.value)}
                      />
                    </label>
                    <p
                      aria-hidden
                      className="num mt-1 text-right text-[10.5px] text-faint"
                    >
                      {text.length}/2000
                    </p>
                  </div>
                ) : (
                  <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                    This example sends a fixed prompt so results stay comparable
                    between runs.
                    {feature.upload ? "" : " Nothing to configure."}
                  </p>
                )}
                {selected === "parameters" ? (
                  <label className="block">
                    <FieldLabel>Reasoning</FieldLabel>
                    <select
                      className="control"
                      value={reasoning}
                      disabled={!!busy}
                      onChange={(e) =>
                        setReasoning(e.target.value as "default" | "none")
                      }
                    >
                      <option value="default">
                        Model default · temperature omitted
                      </option>
                      <option value="none">
                        None · temperature zero retained
                      </option>
                    </select>
                  </label>
                ) : null}
                {feature.upload ? (
                  <div className="space-y-2.5">
                    <FieldLabel
                      hint={
                        selected === "decisions" && provider === "openrouter"
                          ? "text only"
                          : "optional"
                      }
                    >
                      {feature.upload === "image" ? "Image" : "Audio"}
                    </FieldLabel>
                    <UploadField
                      kind={feature.upload}
                      file={file}
                      inputKey={`${selected}-${provider}`}
                      disabled={
                        !!busy ||
                        recording !== "idle" ||
                        (selected === "decisions" && provider === "openrouter")
                      }
                      onFile={(next) => {
                        setError(undefined);
                        setFile(next);
                      }}
                      onError={setError}
                      onClear={() => setFile(undefined)}
                    />
                    {!file ? (
                      <p className="text-[12px] leading-relaxed text-faint">
                        {selected === "tool-images"
                          ? "Uses the built-in blue image when no file is selected."
                          : selected === "transcription"
                            ? "No file? Run a synthetic speech → transcription round trip."
                            : selected === "image"
                              ? "Add a file to switch from generation to editing."
                              : provider === "openrouter"
                                ? "OpenRouter Decisions accepts text only."
                                : "An attached image adds a color question."}
                      </p>
                    ) : null}
                    {selected === "tool-images" && !file ? (
                      <div className="flex items-center gap-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          className="size-12 rounded-lg shadow-[0_0_0_1px_var(--line-strong)]"
                          src={`data:image/png;base64,${BLUE_PNG}`}
                          alt="Blue sample fixture"
                        />
                        <span className="num text-[11px] text-faint">
                          sample · 64×64 PNG
                        </span>
                      </div>
                    ) : null}
                    {selected === "transcription" ? (
                      <Btn
                        variant={
                          recording === "recording" ? "danger" : "outline"
                        }
                        disabled={
                          !!busy ||
                          ["requesting", "stopping"].includes(recording)
                        }
                        onClick={record}
                      >
                        {recording === "recording" ? (
                          <Square aria-hidden className="fill-current" />
                        ) : (
                          <Mic aria-hidden />
                        )}
                        {recording === "recording"
                          ? "Stop recording"
                          : recording === "requesting"
                            ? "Requesting microphone…"
                            : "Record microphone"}
                        {recording === "recording" ? (
                          <Led tone="failed" className="animate-pulse" />
                        ) : null}
                      </Btn>
                    ) : null}
                  </div>
                ) : null}
                <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line pt-4">
                  <Btn
                    variant="primary"
                    size="lg"
                    disabled={!ready || !!busy || recording !== "idle"}
                    onClick={runExample}
                  >
                    Run example
                    <Kbd className="ml-1 border-white/30">⌘↵</Kbd>
                  </Btn>
                  {busy ? (
                    <Btn
                      size="lg"
                      variant="ghost"
                      onClick={() => abort.current?.abort()}
                    >
                      Cancel run
                    </Btn>
                  ) : null}
                  {busy ? (
                    <p
                      role="status"
                      className="num ml-auto flex items-center gap-2 truncate text-[11.5px] text-muted-foreground"
                    >
                      <Led tone="running" />
                      Running {busy}…
                    </p>
                  ) : null}
                </div>
                {error ? (
                  <Note tone="danger" role="alert">
                    {error}
                  </Note>
                ) : null}
              </div>
            </Panel>

            {/* Response */}
            <Panel
              aria-labelledby="response-title"
              className="flex min-h-[340px] flex-col"
            >
              {running ? <div className="run-beam" /> : null}
              <PanelHeader
                id="response-title"
                title="Response"
                meta={
                  result
                    ? `${result.model} · ${formatSeconds(result.durationMs)}`
                    : providerNames[provider]
                }
                actions={
                  running ? (
                    <StatusWord tone="running">running</StatusWord>
                  ) : current ? (
                    <StatusWord tone={current.status}>
                      {current.status}
                    </StatusWord>
                  ) : (
                    <span className="text-[12px] text-faint">Not run</span>
                  )
                }
              />
              <div
                className="flex flex-1 flex-col gap-4 p-4"
                aria-live="polite"
                data-testid="feature-result"
              >
                {result ? (
                  <div key={current?.timestamp} className="enter space-y-4">
                    <p className="text-[14px] leading-relaxed whitespace-pre-wrap">
                      {result.text}
                    </p>
                    <ul className="stagger space-y-1.5" aria-label="Checks">
                      {result.checks.map((check) => (
                        <li
                          key={check.label}
                          data-passed={check.passed}
                          className="flex items-start gap-2.5 text-[12.5px] leading-snug"
                        >
                          <span
                            aria-hidden
                            className={cn(
                              "mt-px grid size-4 shrink-0 place-items-center rounded-full",
                              check.passed
                                ? "bg-success/15 text-success"
                                : "bg-danger/15 text-danger",
                            )}
                          >
                            {check.passed ? (
                              <Check className="size-2.5" strokeWidth={3} />
                            ) : (
                              <X className="size-2.5" strokeWidth={3} />
                            )}
                          </span>
                          <span className={check.passed ? "" : "text-danger"}>
                            {check.label}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {result.warnings?.map((warning) => (
                      <Note key={warning} tone="warning">
                        {warning}
                      </Note>
                    ))}
                    <MediaResult result={result} />
                    {result.details ? (
                      <details className="group rounded-lg shadow-[inset_0_0_0_1px_var(--line)]">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-[12px] font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
                          Response details & usage
                          <span
                            aria-hidden
                            className="num text-[10.5px] text-faint group-open:hidden"
                          >
                            JSON
                          </span>
                        </summary>
                        <div className="relative border-t border-line">
                          <div className="absolute top-1.5 right-1.5">
                            <CopyButton
                              text={JSON.stringify(result.details, null, 2)}
                              label="Copy response details"
                            />
                          </div>
                          <CodeView
                            code={JSON.stringify(result.details, null, 2)}
                            className="max-h-[320px] overflow-y-auto text-[11.5px]"
                          />
                        </div>
                      </details>
                    ) : null}
                  </div>
                ) : (
                  <div className="m-auto max-w-[300px] py-6 text-center">
                    <span className="mx-auto mb-3 grid size-10 place-items-center rounded-full bg-muted text-faint">
                      <ArrowUpRight aria-hidden className="size-4" />
                    </span>
                    <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                      {current?.error ??
                        "Run the example to see the model response, validation checks and timing."}
                    </p>
                    {!current ? (
                      <p className="mt-2 text-[11px] text-faint">
                        Press <Kbd>⌘↵</Kbd> to run
                      </p>
                    ) : null}
                  </div>
                )}
              </div>
            </Panel>
          </div>
        )}

        {/* Code */}
        <Panel aria-labelledby="code-title">
          <PanelHeader
            id="code-title"
            title="Example code"
            meta={feature.source}
            actions={<CopyButton text={feature.snippet} />}
          />
          <CodeView code={feature.snippet} />
        </Panel>

        {/* Copilot */}
        {selected !== "realtime" && chatFeatures.includes(selected) ? (
          <Panel aria-labelledby="copilot-title" className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="grid size-8 place-items-center rounded-lg bg-brand-soft text-brand">
                  <MessagesSquare aria-hidden className="size-4" />
                </span>
                <div>
                  <h3 id="copilot-title" className="text-[13px] font-semibold">
                    Try the Copilot experience
                  </h3>
                  <p className="text-[12px] text-muted-foreground">
                    Image tool calls and conversation continuation through the
                    real <span className="num text-[11px]">CopilotChat</span>{" "}
                    UI.
                  </p>
                </div>
              </div>
              <Btn
                variant={chat ? "ghost" : "outline"}
                disabled={!ready || !!busy}
                onClick={() => setChat(!chat)}
              >
                {chat ? "Close Copilot chat" : "Open Copilot chat"}
              </Btn>
            </div>
            {chat ? (
              <div className="enter border-t border-line bg-surface p-3">
                <div className="overflow-hidden rounded-xl bg-card shadow-[var(--shadow-panel)]">
                  <ChatPanel
                    provider={provider === "anthropic" ? "anthropic" : "openai"}
                    streaming={streaming}
                    headers={runtimeHeaders}
                  />
                </div>
              </div>
            ) : null}
          </Panel>
        ) : null}

        {/* History */}
        <Panel aria-label="Run history" className="overflow-hidden">
          <PanelHeader
            title="Run history"
            meta={
              runs.length
                ? `${runs.length} run${runs.length > 1 ? "s" : ""} · ${passedRuns} passed`
                : "this session"
            }
            actions={
              <Btn
                size="sm"
                variant="ghost"
                disabled={!!busy || !runs.length}
                onClick={() => setRuns([])}
              >
                <Trash2 aria-hidden />
                Clear results
              </Btn>
            }
          />
          {runs.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-[12.5px]">
                <thead>
                  <tr className="eyebrow border-b border-line">
                    <th className="px-4 py-2 font-normal">Feature</th>
                    <th className="px-4 py-2 font-normal">Provider</th>
                    <th className="px-4 py-2 font-normal">Result</th>
                    <th className="px-4 py-2 text-right font-normal">Time</th>
                    <th className="px-4 py-2 text-right font-normal">At</th>
                  </tr>
                </thead>
                <tbody>
                  {[...runs].reverse().map((run, i) => (
                    <tr
                      key={`${run.timestamp}-${i}`}
                      className="border-b border-line last:border-0 hover:bg-surface"
                    >
                      <td className="px-4 py-2.5 font-medium">
                        {features.find((f) => f.id === run.feature)?.name ??
                          run.feature}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {providerNames[run.provider]}
                      </td>
                      <td
                        className="max-w-[360px] px-4 py-2.5"
                        data-status={run.status}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <StatusWord tone={run.status}>
                            {run.status}
                          </StatusWord>
                          {run.error ? (
                            <span className="truncate text-[11.5px] text-faint">
                              {run.error}
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td className="num px-4 py-2.5 text-right text-muted-foreground">
                        {formatSeconds(run.result?.durationMs)}
                      </td>
                      <td className="num px-4 py-2.5 text-right text-faint">
                        {formatClock(run.timestamp)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-4 py-4 text-[12.5px] text-muted-foreground">
              Runs stay in this browser session. Export the report to keep a
              record; audio and image bytes are excluded.
            </p>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}
