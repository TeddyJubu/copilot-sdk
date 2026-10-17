// Run with RUN_REALTIME_BROWSER_LIVE=1 and OPENAI_API_KEY. Uses synthetic speech, never a physical microphone.
// Set PLAYWRIGHT_MODULE to an installed Playwright package if it is not locally resolvable.
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "../..");
const { generateSpeech } = require(
  path.join(root, "packages/llm-sdk/dist/index.js"),
);
const { openaiRealtime, openaiSpeech } = require(
  path.join(root, "packages/llm-sdk/dist/providers/openai/index.js"),
);
if (
  process.env.RUN_REALTIME_BROWSER_LIVE !== "1" ||
  !process.env.OPENAI_API_KEY
)
  throw new Error("Explicit realtime browser opt-in and OpenAI key required");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const esbuild = require(
  require.resolve("esbuild", {
    paths: [
      fs.realpathSync(path.join(root, "packages/llm-sdk/node_modules/tsup")),
    ],
  }),
);
const dir = process.env.MEDIA_REPORT_DIR || "/tmp/copilot-next-beta-media";
fs.mkdirSync(dir, { recursive: true });
const results = [];
let browser, server, page;
async function check(name, fn) {
  const start = Date.now();
  try {
    const metadata = await fn();
    results.push({
      name,
      passed: true,
      durationMs: Date.now() - start,
      ...metadata,
    });
    console.log("PASS " + name);
  } catch (error) {
    results.push({
      name,
      passed: false,
      durationMs: Date.now() - start,
      error: {
        name: error.name,
        message: String(error.message)
          .replaceAll(process.env.OPENAI_API_KEY, "[REDACTED]")
          .slice(0, 500),
      },
    });
    console.log("FAIL " + name);
    throw error;
  }
}
(async () => {
  const bundle = esbuild.buildSync({
    entryPoints: [path.join(root, "packages/copilot-sdk/src/core/realtime.ts")],
    bundle: true,
    format: "iife",
    globalName: "CopilotVoice",
    platform: "browser",
    write: false,
  }).outputFiles[0].text;
  const speech = await generateSpeech({
    model: openaiSpeech("gpt-4o-mini-tts"),
    text: "Please say the words blue balloon.",
    outputFormat: "wav",
    voice: "alloy",
    signal: AbortSignal.timeout(60000),
  });
  const model = openaiRealtime(
    process.env.REALTIME_MODEL || "gpt-realtime-2.1",
  );
  server = http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.url === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<!doctype html><title>Synthetic realtime SDK test</title><script src="/voice.js"></script>',
      );
      return;
    }
    if (req.url === "/voice.js") {
      res.setHeader("Content-Type", "application/javascript");
      res.end(bundle);
      return;
    }
    if (req.url === "/speech.wav") {
      res.setHeader("Content-Type", "audio/wav");
      res.end(Buffer.from(speech.audio.uint8Array));
      return;
    }
    if (
      req.url === "/call" &&
      req.method === "POST" &&
      req.headers.origin === `http://127.0.0.1:${server.address().port}`
    ) {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 80_000) {
          res.writeHead(413);
          res.end();
          return;
        }
        chunks.push(chunk);
      }
      try {
        const { sdp } = JSON.parse(Buffer.concat(chunks).toString());
        const result = await model.createCall({
          sdp,
          instructions:
            "You are a brief English voice test assistant. If asked for the marker, call get_marker exactly once, then say its returned marker. Otherwise follow the request concisely.",
          transcriptionModel: "gpt-transcribe",
          tools: [
            {
              name: "get_marker",
              description: "Returns the test marker",
              parameters: {
                type: "object",
                properties: {},
                additionalProperties: false,
              },
            },
          ],
        });
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(result));
      } catch (error) {
        res.writeHead(502);
        res.end(JSON.stringify({ status: error.status, code: error.code }));
      }
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  // Do not expose the server's API key to the browser subprocess.
  const browserEnv = Object.fromEntries(
    ["PATH", "HOME", "TMPDIR", "LANG"]
      .filter((k) => process.env[k])
      .map((k) => [k, process.env[k]]),
  );
  browser = await chromium.launch({
    headless: true,
    env: browserEnv,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async () => {
    const RealPeer = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends RealPeer {
      constructor(...args) {
        super(...args);
        window.peer = this;
      }
    };
    window.events = [];
    window.transcripts = [];
    window.errors = [];
    window.toolCount = 0;
    window.usage = [];
    const ctx = new AudioContext();
    await ctx.resume();
    window.audioContext = ctx;
    const destination = ctx.createMediaStreamDestination();
    window.inputStream = destination.stream;
    window.audioDestination = destination;
    // Keep real silence flowing after the finite TTS source ends so server VAD
    // receives an end-of-speech interval, just like a physical microphone.
    const silence = ctx.createConstantSource();
    silence.offset.value = 0;
    silence.connect(destination);
    silence.start();
    window.silenceSource = silence;
    const registeredTools = [
      {
        name: "get_marker",
        inputSchema: { type: "object" },
        needsApproval: true,
        handler: async () => {
          window.toolCount++;
          return { success: true, data: { marker: "blue balloon" } };
        },
      },
    ];
    window.session = new CopilotVoice.RealtimeVoiceSession({
      getMicrophone: async () => destination.stream,
      createCall: async ({ sdp, signal }) => {
        const r = await fetch("/call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sdp }),
          signal,
        });
        if (!r.ok)
          throw new Error("Setup HTTP " + r.status + " " + (await r.text()));
        return r.json();
      },
      getTools: () => registeredTools,
      onApproval: () =>
        new Promise((resolve) => {
          window.approve = () => resolve({ approved: true });
        }),
      onEvent: (event) => {
        window.events.push({
          type: event.type,
          status: event.response?.status,
          code: event.error?.code,
        });
      },
      onTranscript: (value) => window.transcripts.push(value),
      onUsage: (value) => window.usage.push(value),
      onError: (error) => window.errors.push(error.message),
      connectionTimeoutMs: 45000,
      maxDurationMs: 180000,
    });
  });
  await check("real browser WebRTC connection", async () => {
    await page.evaluate(() => window.session.connect());
    return {
      model: model.modelId,
      state: await page.evaluate(() => window.session.state),
    };
  });
  await check(
    "real tool call waits for approval and executes once",
    async () => {
      await page.evaluate(() =>
        window.session.sendText(
          "Get the marker with get_marker and tell me the result.",
        ),
      );
      await page.waitForFunction(
        () => typeof window.approve === "function",
        null,
        { timeout: 45000 },
      );
      assert.equal(await page.evaluate(() => window.toolCount), 0);
      await page.evaluate(() => window.approve());
      await page.waitForFunction(
        () =>
          window.transcripts.some(
            (t) =>
              t.role === "assistant" && t.final && /blue balloon/i.test(t.text),
          ),
        null,
        { timeout: 45000 },
      );
      assert.equal(await page.evaluate(() => window.toolCount), 1);
      return { calls: 1, transcript: "blue balloon" };
    },
  );
  await check(
    "synthetic speech input is transcribed and remote audio is received",
    async () => {
      await page.evaluate(async () => {
        const data = await fetch("/speech.wav").then((r) => r.arrayBuffer());
        const source = window.audioContext.createBufferSource();
        source.buffer = await window.audioContext.decodeAudioData(data);
        source.connect(window.audioDestination);
        source.start();
      });
      await page.waitForFunction(
        () =>
          window.transcripts.some(
            (t) => t.role === "user" && t.final && /blue balloon/i.test(t.text),
          ),
        null,
        { timeout: 45000 },
      );
      const stats = await page.evaluate(async () =>
        [...(await window.peer.getStats()).values()]
          .filter((s) => s.type === "inbound-rtp" && s.kind === "audio")
          .map((s) => ({
            packetsReceived: s.packetsReceived,
            bytesReceived: s.bytesReceived,
            totalAudioEnergy: s.totalAudioEnergy,
          })),
      );
      assert.ok(stats.some((s) => s.bytesReceived > 0));
      return { stats };
    },
  );
  await check(
    "live interruption cancels playback and session remains usable",
    async () => {
      await page.evaluate(() => {
        window.eventStart = window.events.length;
        window.session.sendText(
          "Count slowly from one to thirty, saying every number.",
        );
      });
      await page.waitForFunction(
        () =>
          window.events
            .slice(window.eventStart)
            .some((e) => e.type === "output_audio_buffer.started"),
        null,
        { timeout: 45000 },
      );
      await page.evaluate(() => window.session.interrupt());
      await page.waitForFunction(
        () =>
          window.events
            .slice(window.eventStart)
            .some((e) => e.type === "output_audio_buffer.cleared"),
        null,
        { timeout: 15000 },
      );
      assert.equal(
        await page.evaluate(() => window.session.state),
        "connected",
      );
    },
  );
  await check("mute, usage and disconnect cleanup", async () => {
    const result = await page.evaluate(async () => {
      window.session.setMuted(true);
      const muted = !window.inputStream.getAudioTracks()[0].enabled;
      window.session.disconnect();
      window.silenceSource?.stop();
      window.syntheticTrack?.stop();
      await window.audioContext.close();
      return {
        muted,
        state: window.session.state,
        trackState: window.inputStream.getAudioTracks()[0].readyState,
        peerState: window.peer.connectionState,
        usageEvents: window.usage.length,
        errors: window.errors,
        providerErrors: window.events.filter((event) => event.type === "error"),
      };
    });
    assert.ok(result.muted);
    assert.equal(result.trackState, "ended");
    assert.equal(result.peerState, "closed");
    assert.ok(result.usageEvents > 0);
    return result;
  });
})()
  .catch(async (error) => {
    console.log("Live browser test stopped:", error.name);
    process.exitCode = 1;
    if (page) {
      const diagnostic = await page
        .evaluate(async () => ({
          events: window.events,
          transcripts: window.transcripts,
          errors: window.errors,
          audioState: window.audioContext?.state,
          stats: window.peer
            ? [...(await window.peer.getStats()).values()]
                .filter((s) =>
                  ["outbound-rtp", "inbound-rtp", "media-source"].includes(
                    s.type,
                  ),
                )
                .map((s) => ({
                  type: s.type,
                  kind: s.kind,
                  bytesSent: s.bytesSent,
                  bytesReceived: s.bytesReceived,
                  audioLevel: s.audioLevel,
                  totalAudioEnergy: s.totalAudioEnergy,
                }))
            : [],
        }))
        .catch(() => ({}));
      fs.writeFileSync(
        path.join(dir, "live-realtime-diagnostic.json"),
        JSON.stringify(diagnostic, null, 2),
      );
    }
  })
  .finally(async () => {
    await browser?.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    fs.writeFileSync(
      path.join(dir, "live-realtime-browser.json"),
      JSON.stringify(results, null, 2),
    );
  });
