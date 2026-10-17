import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CopilotProvider,
  useRealtimeVoice,
  useTool,
} from "@yourgpt/copilot-sdk/react";

const demoToolSchema = { type: "object", properties: {} };
function MediaDemo() {
  const [prompt, setPrompt] = useState(
    "A simple blue circle on a white background",
  );
  const [image, setImage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [controller, setController] = useState<AbortController>();
  useEffect(() => () => controller?.abort(), [controller]);
  useTool({
    name: "get_demo_status",
    description: "Read the local demo status",
    inputSchema: demoToolSchema,
    needsApproval: true,
    handler: async () => ({
      success: true,
      data: { status: "Blue balloon ready" },
    }),
  });
  const voice = useRealtimeVoice({
    createCall: async ({ sdp, signal }) => {
      const response = await fetch("/media-api/realtime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sdp }),
        signal,
      });
      if (!response.ok) throw new Error("Voice setup failed");
      return response.json();
    },
  });
  const perform = (action: () => void | Promise<void>) => {
    try {
      Promise.resolve(action()).catch((e) => setError(e.message));
    } catch (e) {
      setError(String(e));
    }
  };
  async function makeImage() {
    const request = new AbortController();
    setController(request);
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch("/media-api/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
        signal: request.signal,
      });
      if (!response.ok) throw new Error("Image generation failed");
      const result = await response.json();
      setImage(`data:${result.mediaType};base64,${result.base64}`);
    } catch (e) {
      if (!request.signal.aborted) setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main
      style={{
        fontFamily: "system-ui",
        maxWidth: 760,
        margin: "48px auto",
        padding: 24,
      }}
    >
      <h1>Copilot SDK media beta</h1>
      <p>
        Experimental OpenAI voice calls and image generation. Replies use an
        AI-generated voice.
      </p>
      <h2>Voice call</h2>
      <p role="status">
        {voice.state}
        {voice.muted ? " · Microphone muted" : ""}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button
          disabled={voice.state === "connecting" || voice.state === "connected"}
          onClick={() => perform(voice.connect)}
        >
          Start call
        </button>
        <button onClick={voice.disconnect}>End call</button>
        <button
          disabled={voice.state !== "connected"}
          onClick={() => perform(() => voice.setMuted(!voice.muted))}
        >
          {voice.muted ? "Unmute" : "Mute"}
        </button>
        <button
          disabled={voice.state !== "connected"}
          onClick={() => perform(voice.interrupt)}
        >
          Interrupt
        </button>
        <button
          disabled={voice.state !== "connected"}
          onClick={() => perform(voice.resumeAudio)}
        >
          Enable audio
        </button>
        <button
          disabled={voice.state !== "connected"}
          onClick={() =>
            perform(() => voice.sendText("What is the demo status?"))
          }
        >
          Test approved tool
        </button>
      </div>
      {voice.pendingApprovals.map((call) => (
        <div key={call.id}>
          <p>Allow {call.name}?</p>
          <button onClick={() => call.approve()}>Allow</button>{" "}
          <button onClick={call.reject}>Deny</button>
        </div>
      ))}
      <div aria-live="polite">
        {voice.transcripts.map((item) => (
          <p key={item.id}>
            <strong>{item.role}:</strong> {item.text}
          </p>
        ))}
      </div>
      <h2>Generate an image</h2>
      <label>
        Image prompt{" "}
        <input
          value={prompt}
          maxLength={1000}
          onChange={(event) => setPrompt(event.target.value)}
          style={{ width: "100%", padding: 8 }}
        />
      </label>
      <p>
        <button disabled={busy} onClick={makeImage}>
          {busy ? "Generating…" : "Generate image"}
        </button>{" "}
        {busy ? (
          <button onClick={() => controller?.abort()}>Cancel</button>
        ) : null}
      </p>
      {image ? (
        <img src={image} alt={prompt} style={{ maxWidth: "100%" }} />
      ) : null}
      {error || voice.error ? (
        <p role="alert">{error ?? voice.error?.message}</p>
      ) : null}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CopilotProvider runtimeUrl="/api/chat">
      <MediaDemo />
    </CopilotProvider>
  </StrictMode>,
);
