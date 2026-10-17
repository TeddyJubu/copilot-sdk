// Run against the local Feature Lab with server-side OpenAI/Anthropic credentials.
// Browser audio is synthetic. No physical microphone or API key enters Chromium.
const assert = require("node:assert/strict");
const fs = require("node:fs");
if (process.env.RUN_FEATURE_LAB_LIVE !== "1")
  throw new Error("Live opt-in required");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const url =
  process.env.FEATURE_LAB_URL || "http://127.0.0.1:3035/playground/features";
if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname))
  throw new Error("Use a local lab server");
const dir = process.env.FEATURE_LAB_REPORT_DIR || "/tmp/copilot-feature-lab";
fs.mkdirSync(dir, { recursive: true });
const results = [];
async function check(name, fn) {
  const start = Date.now();
  try {
    const detail = await fn();
    results.push({
      name,
      passed: true,
      durationMs: Date.now() - start,
      ...detail,
    });
    console.log("PASS " + name);
  } catch (error) {
    results.push({ name, passed: false, error: error.message });
    throw error;
  } finally {
    fs.writeFileSync(
      `${dir}/integration-results.json`,
      JSON.stringify(results, null, 2),
    );
  }
}
(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    page.setDefaultTimeout(60000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.labTest = { contexts: [], streams: [], events: [], chats: [] };
      const nativeFetch = window.fetch;
      window.fetch = async (...args) => {
        const response = await nativeFetch(...args);
        if (String(args[0]).includes("/api/features/chat?")) {
          response
            .clone()
            .text()
            .then((body) =>
              window.labTest.chats.push({
                body,
                type: response.headers.get("content-type"),
              }),
            );
        }
        return response;
      };
      navigator.mediaDevices.getUserMedia = async () => {
        const context = new AudioContext();
        await context.resume();
        const destination = context.createMediaStreamDestination();
        const silence = context.createOscillator();
        const gain = context.createGain();
        gain.gain.value = 0;
        silence.connect(gain).connect(destination);
        silence.start();
        window.labTest.contexts.push(context);
        window.labTest.streams.push(destination.stream);
        window.labTest.play = async (base64) => {
          const source = context.createBufferSource();
          source.buffer = await context.decodeAudioData(
            Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer,
          );
          source.connect(destination);
          await new Promise((resolve) => {
            source.onended = resolve;
            source.start();
          });
        };
        return destination.stream;
      };
      const NativePeer = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends NativePeer {
        constructor(...args) {
          super(...args);
          window.labTest.peer = this;
        }
        createDataChannel(...args) {
          const channel = super.createDataChannel(...args);
          channel.addEventListener("message", ({ data }) => {
            const event = JSON.parse(data);
            window.labTest.events.push({
              type: event.type,
              code: event.error?.code,
            });
          });
          return channel;
        }
      };
    });
    await page.goto(url);
    async function select(name) {
      await page
        .getByRole("navigation", { name: "Feature examples" })
        .getByRole("button", { name })
        .click();
    }
    async function chatTurn(text, expected) {
      const before = await page.evaluate(() => window.labTest.chats.length);
      const pending = page.waitForResponse(
        (r) =>
          r.url().includes("/api/features/chat?") &&
          r.request().method() === "POST",
      );
      const input = page.getByTestId("lab-chat").getByRole("textbox");
      await input.fill(text);
      await input.press("Enter");
      const response = await pending;
      assert.ok(response.ok(), `Chat HTTP ${response.status()}`);
      // Chromium does not reliably retain the body of a consumed SSE response.
      // Inspect a cloned fetch stream in the browser, alongside the real UI consumer.
      await page.waitForFunction(
        (count) => window.labTest.chats.length > count,
        before,
      );
      const { body, type } = await page.evaluate(() =>
        window.labTest.chats.at(-1),
      );
      let answer;
      if (type.includes("text/event-stream")) {
        const events = body
          .split("\n")
          .filter(
            (line) => line.startsWith("data: ") && line !== "data: [DONE]",
          )
          .map((line) => JSON.parse(line.slice(6)));
        assert.deepEqual(
          events.filter((e) => e.type === "error"),
          [],
        );
        answer = events
          .filter((e) => e.type === "message:delta")
          .map((e) => e.content)
          .join("");
      } else {
        const result = JSON.parse(body);
        assert.equal(result.success, true);
        answer = result.content;
      }
      await page
        .getByTestId("lab-chat")
        .locator(".csdk-assistant-message")
        .last()
        .filter({ hasText: expected })
        .waitFor();
      return answer;
    }
    for (const provider of ["openai", "anthropic"]) {
      for (const streaming of [true, false]) {
        await check(
          `${provider} Copilot ${streaming ? "SSE" : "JSON"}: image tool and multi-turn memory`,
          async () => {
            await select("Images in tool calls");
            await page
              .getByRole("combobox", { name: "Provider", exact: true })
              .selectOption(provider);
            await page
              .getByRole("checkbox", { name: "Streaming", exact: true })
              .setChecked(streaming);
            await page
              .getByRole("button", { name: "Open Copilot chat", exact: true })
              .click();
            const first = await chatTurn(
              "The project code is ORCHID-742. Inspect the sample image with the tool and tell me its color.",
              /blue/i,
            );
            assert.match(first, /blue/i);
            const second = await chatTurn(
              "What project code did I give you? Reply only with the code.",
              /ORCHID-742/,
            );
            assert.match(second, /ORCHID-742/);
            return {
              provider,
              streaming,
              imageRecognized: true,
              memoryRetained: true,
            };
          },
        );
      }
    }
    let speech;
    await check(
      "browser microphone recorder and real transcription with synthetic audio",
      async () => {
        await select("Voice input");
        speech = await page.evaluate(async () => {
          const r = await fetch("/playground/api/features/speech", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              provider: "openai",
              text: "Please say the words blue balloon.",
            }),
          });
          if (!r.ok) throw new Error(`Synthetic speech HTTP ${r.status}`);
          return (await r.json()).media.base64;
        });
        await page
          .getByRole("button", { name: "Record microphone", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Stop recording", exact: true })
          .waitFor();
        await page.evaluate((base64) => window.labTest.play(base64), speech);
        await page
          .getByRole("button", { name: "Stop recording", exact: true })
          .click();
        await page.getByText("recording.webm", { exact: true }).waitFor();
        assert.equal(
          await page.evaluate(
            () => window.labTest.streams.at(-1).getAudioTracks()[0].readyState,
          ),
          "ended",
        );
        const pending = page.waitForResponse(
          (r) =>
            r.url().endsWith("/api/features/transcription") &&
            r.request().method() === "POST",
        );
        await page
          .getByRole("button", { name: "Run example", exact: true })
          .click();
        const response = await pending;
        assert.ok(response.ok());
        const result = await response.json();
        assert.match(result.text, /blue balloon/i);
        await page
          .getByTestId("feature-result")
          .getByText(result.text, { exact: true })
          .waitFor();
      },
    );
    await check(
      "playground realtime: live approval, audio input/output, mute and cleanup",
      async () => {
        await select("Realtime voice");
        await page
          .getByRole("button", { name: "Start voice call", exact: true })
          .click();
        await page
          .getByRole("status")
          .filter({ hasText: /^connected$/ })
          .waitFor();
        await page
          .getByRole("button", { name: "Ask for demo status", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Allow tool", exact: true })
          .waitFor();
        assert.equal(
          await page.getByTestId("voice-executions").innerText(),
          "0",
        );
        await page
          .getByRole("button", { name: "Allow tool", exact: true })
          .click();
        await page
          .getByLabel("Voice transcripts", { exact: true })
          .getByText(/Blue balloon ready/i)
          .waitFor();
        assert.equal(
          await page.getByTestId("voice-executions").innerText(),
          "1",
        );
        await page.evaluate((base64) => window.labTest.play(base64), speech);
        await page
          .getByLabel("Voice transcripts", { exact: true })
          .locator("p")
          .filter({ hasText: /user.*blue balloon/i })
          .waitFor();
        const stats = await page.evaluate(async () =>
          [...(await window.labTest.peer.getStats()).values()]
            .filter((s) => s.type === "inbound-rtp" && s.kind === "audio")
            .map(({ bytesReceived, totalAudioEnergy }) => ({
              bytesReceived,
              totalAudioEnergy,
            })),
        );
        assert.ok(
          stats.some((s) => s.bytesReceived > 0 && s.totalAudioEnergy > 0),
        );
        await page.getByRole("button", { name: "Mute", exact: true }).click();
        assert.equal(
          await page.evaluate(
            () => window.labTest.streams.at(-1).getAudioTracks()[0].enabled,
          ),
          false,
        );
        await page.getByRole("button", { name: "Unmute", exact: true }).click();
        await page
          .getByRole("button", { name: "End call", exact: true })
          .click();
        const state = await page.evaluate(async () => {
          const result = {
            track: window.labTest.streams.at(-1).getAudioTracks()[0].readyState,
            peer: window.labTest.peer.connectionState,
            providerErrors: window.labTest.events.filter(
              (e) => e.type === "error",
            ),
          };
          await Promise.all(
            window.labTest.contexts.map((context) => context.close()),
          );
          return result;
        });
        assert.equal(state.track, "ended");
        assert.equal(state.peer, "closed");
        assert.deepEqual(state.providerErrors, []);
        return { stats, ...state };
      },
    );
    await check("no browser runtime errors", async () => {
      assert.deepEqual(errors, []);
    });
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
