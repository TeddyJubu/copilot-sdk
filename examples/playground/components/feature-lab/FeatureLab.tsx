"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  VoiceRecorder,
  type VoiceRecordingState,
} from "@yourgpt/copilot-sdk/core";
import {
  features,
  coreChecks,
  BLUE_PNG,
  type FeatureId,
  type LabProvider,
  type LabInput,
  type LabResult,
} from "@/lib/feature-lab/catalog";
import styles from "./feature-lab.module.css";
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
  return (
    <div className={styles.media}>
      {result.media.mediaType.startsWith("audio/") ? (
        <audio ref={audioRef} controls aria-label="Generated AI speech" />
      ) : (
        <>
          {/* Blob previews are local browser resources, not optimizable remote images. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={imageRef} alt="Generated result" />
        </>
      )}
      <a
        ref={downloadRef}
        className={styles.button}
        download={result.media.filename}
      >
        Download{" "}
        {result.media.mediaType.startsWith("audio/") ? "audio" : "image"}
      </a>
    </div>
  );
}
export default function FeatureLab() {
  const [selected, setSelected] = useState<FeatureId>("parameters");
  const feature = features.find((item) => item.id === selected)!;
  const [provider, setProvider] = useState<LabProvider>("openai");
  const [availability, setAvailability] = useState<Availability>({});
  const [setupError, setSetupError] = useState<string>();
  const [text, setText] = useState(feature.defaultText ?? "");
  const [streaming, setStreaming] = useState(true);
  const [reasoning, setReasoning] = useState<"default" | "none">("default");
  const [file, setFile] = useState<LabInput["file"]>();
  const [busy, setBusy] = useState<string>();
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
  function select(id: FeatureId) {
    if (busy) return;
    recorder.current?.cancel();
    setRecording("idle");
    const next = features.find((item) => item.id === id)!;
    setSelected(id);
    setProvider(
      next.providers.includes(provider) ? provider : next.providers[0],
    );
    setText(next.defaultText ?? "");
    setFile(undefined);
    setError(undefined);
    setChat(false);
  }
  async function execute(
    id: FeatureId,
    input: LabInput,
    controller: AbortController,
  ) {
    const response = await fetch(`/playground/api/features/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
      if (!availability[item.provider]?.configured) {
        setRuns((previous) => [
          ...previous,
          {
            ...item,
            status: "skipped",
            error: "Server credential not configured",
            timestamp: new Date().toISOString(),
          },
        ]);
        continue;
      }
      setBusy(
        `${features.find((f) => f.id === item.feature)!.name} · ${item.provider}`,
      );
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
  const ready = !!availability[provider]?.configured;
  const current = [...runs]
    .reverse()
    .find((run) => run.feature === selected && run.provider === provider);
  const result = current?.result;
  const passed = runs.filter((run) => run.status === "passed").length;
  return (
    <main className={styles.lab}>
      <header className={styles.header}>
        <Link href="/" className={styles.back}>
          ← Playground
        </Link>
        <span className={styles.eyebrow}>COPILOT SDK / NEXT BETA</span>
        <div className={styles.actions}>
          <button
            className={styles.button}
            disabled={!runs.length || !!busy}
            onClick={() => saveReport(runs)}
          >
            Export results
          </button>
          <button
            className={styles.primary}
            disabled={
              !!busy ||
              !Object.values(availability).some((a) => a?.configured) ||
              selected === "realtime"
            }
            onClick={runCoreChecks}
          >
            Run core checks
          </button>
        </div>
      </header>
      <div className={styles.intro}>
        <div>
          <h1>
            Feature lab<span>.</span>
          </h1>
          <p>Run a real example. Inspect the response. Try it in Copilot.</p>
        </div>
        <div className={styles.score}>
          <strong>{passed.toString().padStart(2, "0")}</strong>
          <span>
            successful runs
            <br />
            this session
          </span>
        </div>
      </div>
      {setupError ? (
        <p className={styles.notice} role="alert">
          {setupError}
        </p>
      ) : null}
      <div className={styles.shell}>
        <nav className={styles.nav} aria-label="Feature examples">
          {(["Core", "Media"] as const).map((group) => (
            <div key={group}>
              <h2>{group}</h2>
              {features
                .filter((f) => f.group === group)
                .map((item, index) => (
                  <button
                    key={item.id}
                    aria-pressed={selected === item.id}
                    disabled={!!busy}
                    onClick={() => select(item.id)}
                  >
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    {item.name}
                  </button>
                ))}
            </div>
          ))}
          <p className={styles.navNote}>
            Core checks make real provider requests. Missing providers are
            skipped. Media runs separately.
          </p>
        </nav>
        <section className={styles.workspace} aria-labelledby="feature-title">
          <div className={styles.featureHeader}>
            <span className={styles.eyebrow}>
              {feature.group} / {feature.id}
            </span>
            <h2 id="feature-title">{feature.name}</h2>
            <p>{feature.description}</p>
          </div>
          <div className={styles.config}>
            <label>
              Provider
              <select
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
                    {p === "typesafe" ? "TypeSafe / Jev" : p}
                  </option>
                ))}
              </select>
            </label>
            <span className={ready ? styles.ready : styles.unavailable}>
              {ready ? "● Server key ready" : "○ Key not configured"}
            </span>
            {feature.streaming ? (
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={streaming}
                  disabled={!!busy}
                  onChange={(e) => setStreaming(e.target.checked)}
                />
                Streaming
              </label>
            ) : null}
          </div>
          {!ready ? (
            <p className={styles.notice}>
              Configure{" "}
              {availability[provider]?.requires.join(" and ") ??
                "this provider’s credentials"}{" "}
              in the server environment, then restart. Keys stay on the server.
            </p>
          ) : null}
          {selected === "realtime" ? (
            <RealtimePanel enabled={ready} />
          ) : (
            <div className={styles.columns}>
              <div className={styles.stack}>
                {feature.defaultText ? (
                  <label className={styles.field}>
                    {selected === "decisions"
                      ? "Ticket / shared state"
                      : "Prompt or text"}
                    <textarea
                      rows={5}
                      value={text}
                      maxLength={2000}
                      disabled={!!busy}
                      onChange={(e) => setText(e.target.value)}
                    />
                  </label>
                ) : null}
                {selected === "parameters" ? (
                  <label className={styles.field}>
                    Reasoning
                    <select
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
                  <div className={styles.upload}>
                    <label className={styles.field}>
                      {feature.upload === "image"
                        ? "Optional image · PNG, JPEG, WebP"
                        : "Optional audio · up to 4 MiB"}
                      <input
                        key={`${selected}-${provider}`}
                        type="file"
                        aria-label={
                          feature.upload === "image"
                            ? "Upload image"
                            : "Upload audio"
                        }
                        accept={
                          feature.upload === "image"
                            ? "image/png,image/jpeg,image/webp"
                            : "audio/*"
                        }
                        disabled={
                          !!busy ||
                          recording !== "idle" ||
                          (selected === "decisions" &&
                            provider === "openrouter")
                        }
                        onChange={async (e) => {
                          const next = e.target.files?.[0];
                          setError(undefined);
                          try {
                            setFile(
                              next
                                ? await encodeFile(next, next.name)
                                : undefined,
                            );
                          } catch (err) {
                            setError(
                              err instanceof Error
                                ? err.message
                                : "Invalid file",
                            );
                          }
                        }}
                      />
                    </label>
                    {file ? (
                      <div className={styles.actions}>
                        <span className={styles.muted}>{file.name}</span>
                        <button
                          className={styles.button}
                          disabled={!!busy}
                          onClick={() => setFile(undefined)}
                        >
                          Remove file
                        </button>
                      </div>
                    ) : (
                      <p className={styles.muted}>
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
                    )}
                    {selected === "tool-images" && !file ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          className={styles.sample}
                          src={`data:image/png;base64,${BLUE_PNG}`}
                          alt="Blue sample fixture"
                        />
                      </>
                    ) : null}
                    {selected === "transcription" ? (
                      <button
                        className={styles.button}
                        disabled={
                          !!busy ||
                          ["requesting", "stopping"].includes(recording)
                        }
                        onClick={record}
                      >
                        {recording === "recording"
                          ? "Stop recording"
                          : recording === "requesting"
                            ? "Requesting microphone…"
                            : "Record microphone"}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                <div className={styles.actions}>
                  <button
                    className={styles.primary}
                    disabled={!ready || !!busy || recording !== "idle"}
                    onClick={runExample}
                  >
                    Run example <span aria-hidden>↗</span>
                  </button>
                  {busy ? (
                    <button
                      className={styles.button}
                      onClick={() => abort.current?.abort()}
                    >
                      Cancel run
                    </button>
                  ) : null}
                </div>
                {busy ? (
                  <p role="status" className={styles.muted}>
                    Running {busy}…
                  </p>
                ) : null}
                {error ? (
                  <p role="alert" className={styles.error}>
                    {error}
                  </p>
                ) : null}
                <details className={styles.snippet}>
                  <summary>Example code</summary>
                  <p className={styles.muted}>{feature.source}</p>
                  <pre className={styles.code}>{feature.snippet}</pre>
                </details>
              </div>
              <div
                className={styles.result}
                aria-live="polite"
                data-testid="feature-result"
              >
                <div className={styles.resultHeading}>
                  <h3>Result</h3>
                  {current ? (
                    <span
                      className={
                        current.status === "passed"
                          ? styles.ready
                          : styles.unavailable
                      }
                    >
                      {current.status}
                    </span>
                  ) : (
                    <span className={styles.muted}>Not run</span>
                  )}
                </div>
                {result ? (
                  <>
                    <div className={styles.resultMeta}>
                      {result.model} ·{" "}
                      {((result.durationMs ?? 0) / 1000).toFixed(1)}s
                    </div>
                    <p className={styles.answer}>{result.text}</p>
                    <ul className={styles.checks}>
                      {result.checks.map((check) => (
                        <li key={check.label} data-passed={check.passed}>
                          <span>{check.passed ? "✓" : "!"}</span>
                          {check.label}
                        </li>
                      ))}
                    </ul>
                    {result.warnings?.map((warning) => (
                      <p key={warning} className={styles.notice}>
                        {warning}
                      </p>
                    ))}
                    <MediaResult result={result} />
                    {result.details ? (
                      <details>
                        <summary>Response details & usage</summary>
                        <pre className={styles.code}>
                          {JSON.stringify(result.details, null, 2)}
                        </pre>
                      </details>
                    ) : null}
                  </>
                ) : (
                  <p className={styles.empty}>
                    {current?.error ??
                      "Run the example to see the model response, validation checks and timing."}
                  </p>
                )}
              </div>
            </div>
          )}
          {selected !== "realtime" &&
          ["parameters", "responses", "tool-images", "system-prompt"].includes(
            selected,
          ) ? (
            <section className={styles.chat}>
              <div className={styles.resultHeading}>
                <div>
                  <h3>Try the Copilot experience</h3>
                  <p className={styles.muted}>
                    Image tool calls and conversation continuation through the
                    actual chat UI.
                  </p>
                </div>
                <button
                  className={styles.button}
                  disabled={!ready || !!busy}
                  onClick={() => setChat(!chat)}
                >
                  {chat ? "Close Copilot chat" : "Open Copilot chat"}
                </button>
              </div>
              {chat ? (
                <ChatPanel
                  provider={provider === "anthropic" ? "anthropic" : "openai"}
                  streaming={streaming}
                />
              ) : null}
            </section>
          ) : null}
        </section>
      </div>
      <section className={styles.history} aria-label="Run history">
        <div className={styles.resultHeading}>
          <h2>Run history</h2>
          <button
            className={styles.button}
            disabled={!!busy || !runs.length}
            onClick={() => setRuns([])}
          >
            Clear results
          </button>
        </div>
        {runs.length ? (
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>Feature</th>
                  <th>Provider</th>
                  <th>Result</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {[...runs].reverse().map((run, i) => (
                  <tr key={`${run.timestamp}-${i}`}>
                    <td>{run.feature}</td>
                    <td>{run.provider}</td>
                    <td data-status={run.status}>
                      {run.status}
                      {run.error ? ` · ${run.error}` : ""}
                    </td>
                    <td>
                      {run.result?.durationMs
                        ? `${(run.result.durationMs / 1000).toFixed(1)}s`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.muted}>
            Runs stay in this browser session. Export the report to keep a
            record; audio and image bytes are excluded.
          </p>
        )}
      </section>
    </main>
  );
}
