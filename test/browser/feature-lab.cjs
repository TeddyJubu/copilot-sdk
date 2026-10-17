// Start the playground dev server first. All API calls are fixtures; no keys or physical microphone.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      window.tracksStopped = 0;
      window.commands = [];
      window.callSeq = 0;
      Object.defineProperty(navigator, "mediaDevices", {
        value: {
          getUserMedia: async () => {
            const track = {
              enabled: true,
              stop() {
                window.tracksStopped++;
              },
            };
            return { getTracks: () => [track], getAudioTracks: () => [track] };
          },
        },
      });
      HTMLMediaElement.prototype.pause = function () {};
      HTMLMediaElement.prototype.play = async function () {};
      window.RTCPeerConnection = class {
        constructor() {
          window.peer = this;
          this.connectionState = "new";
        }
        addTrack() {}
        createDataChannel() {
          const peer = this;
          return (this.dc = {
            readyState: "connecting",
            bufferedAmount: 0,
            close() {
              this.readyState = "closed";
            },
            send(raw) {
              const e = JSON.parse(raw);
              window.commands.push(e);
              if (e.item?.type === "message") {
                setTimeout(
                  () =>
                    peer.emit({
                      type: "response.done",
                      response: {
                        status: "completed",
                        output: [
                          {
                            type: "function_call",
                            call_id: "test-" + ++window.callSeq,
                            name: "get_demo_status",
                            arguments: "{}",
                          },
                        ],
                      },
                    }),
                  0,
                );
              }
              if (e.item?.type === "function_call_output") {
                setTimeout(
                  () =>
                    peer.emit({
                      type: "response.output_audio_transcript.done",
                      item_id: "out-" + window.callSeq,
                      transcript: e.item.output,
                    }),
                  0,
                );
              }
            },
          });
        }
        async createOffer() {
          return { type: "offer", sdp: "v=0\r\no=test" };
        }
        async setLocalDescription(o) {
          this.localDescription = o;
        }
        async setRemoteDescription() {
          this.connectionState = "connected";
          this.dc.readyState = "open";
          this.dc.onopen();
          this.emit({ type: "session.created" });
        }
        close() {
          this.connectionState = "closed";
        }
        emit(e) {
          this.dc.onmessage?.({ data: JSON.stringify(e) });
        }
      };
    });
    await page.route("**/playground/api/features/realtime", (r) =>
      r.fulfill({ json: { sdp: "v=0\r\no=answer" } }),
    );
    await page.route("**/playground/api/features/status", (r) =>
      r.fulfill({
        json: { providers: { openai: { configured: true, requires: [] } } },
      }),
    );
    await page.goto(
      process.env.FEATURE_LAB_URL ||
        "http://127.0.0.1:3035/playground/features",
    );
    await page.getByRole("button", { name: "Realtime voice" }).click();
    await page
      .getByRole("button", { name: "Start voice call", exact: true })
      .click();
    await page.getByRole("status").filter({ hasText: "connected" }).waitFor();
    await page.getByRole("button", { name: "Ask for demo status" }).click();
    await page
      .getByRole("button", { name: "Allow tool", exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(
        () =>
          window.commands.filter((e) => e.item?.type === "function_call_output")
            .length,
      ),
      0,
    );
    await page.getByRole("button", { name: "Allow tool", exact: true }).click();
    await page.getByText(/Blue balloon ready/).waitFor();
    const output = await page.evaluate(
      () =>
        window.commands.find((e) => e.item?.type === "function_call_output")
          .item.output,
    );
    assert.equal(JSON.parse(output).success, true);
    await page.getByRole("button", { name: "Mute", exact: true }).click();
    await page.getByRole("button", { name: "Unmute", exact: true }).waitFor();
    await page.getByRole("button", { name: "Ask for demo status" }).click();
    await page.getByRole("button", { name: "Deny tool", exact: true }).click();
    await page.getByText(/Tool approval denied/).waitFor();
    await page.getByRole("button", { name: "Ask for demo status" }).click();
    await page
      .getByRole("button", { name: "Allow tool", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "End call", exact: true }).click();
    await page
      .getByRole("button", { name: "Allow tool", exact: true })
      .waitFor({ state: "hidden" });
    assert.equal(await page.evaluate(() => window.tracksStopped), 1);
    assert.deepEqual(errors, []);
    console.log(
      "PASS React StrictMode: connect, registry, approval, denial, mute, pending-approval disconnect cleanup",
    );
    if (process.env.FEATURE_LAB_SCREENSHOT)
      await page.screenshot({
        path: process.env.FEATURE_LAB_SCREENSHOT,
        fullPage: true,
      });
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
