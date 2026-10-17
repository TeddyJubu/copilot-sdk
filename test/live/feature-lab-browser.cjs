// Start the local Feature Lab with server-side credentials before running.
// RUN_FEATURE_LAB_LIVE=1 PLAYWRIGHT_MODULE=/path/to/playwright node test/live/feature-lab-browser.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const {
  browserEnvironment,
  installCallerKeys,
} = require("./feature-lab-credentials.cjs");
if (process.env.RUN_FEATURE_LAB_LIVE !== "1")
  throw new Error("Live opt-in required");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const url =
  process.env.FEATURE_LAB_URL || "http://127.0.0.1:3035/playground/features";
if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname))
  throw new Error("Use a local lab server");
const dir = process.env.FEATURE_LAB_REPORT_DIR || "/tmp/copilot-feature-lab";
fs.mkdirSync(dir, { recursive: true });
const report = [];
async function check(name, fn) {
  const start = Date.now();
  try {
    const detail = await fn();
    report.push({
      name,
      passed: true,
      durationMs: Date.now() - start,
      ...detail,
    });
    console.log("PASS " + name);
  } catch (error) {
    report.push({ name, passed: false, error: error.message });
    throw error;
  } finally {
    fs.writeFileSync(
      `${dir}/browser-results.json`,
      JSON.stringify(report, null, 2),
    );
  }
}
(async () => {
  const browser = await chromium.launch({
    env: browserEnvironment(),
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    await installCallerKeys(page, url);
    page.setDefaultTimeout(180000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url);
    if (process.env.FEATURE_LAB_SKIP_CORE !== "1")
      await check("core checks through browser", async () => {
        const downloadPromise = page.waitForEvent("download");
        await page
          .getByRole("button", { name: "Run core checks", exact: true })
          .click();
        await page.waitForFunction(
          () =>
            document.querySelectorAll(
              'section[aria-label="Run history"] tbody tr',
            ).length === 10,
        );
        await page.getByRole("button", { name: "Export results" }).click();
        const download = await downloadPromise;
        await download.saveAs(`${dir}/core-results.json`);
        const results = JSON.parse(
          fs.readFileSync(`${dir}/core-results.json`, "utf8"),
        );
        assert.equal(results.runs.length, 10);
        assert.equal(
          results.runs.filter((r) => r.status === "failed").length,
          0,
          JSON.stringify(results.runs.filter((r) => r.status === "failed")),
        );
        assert.ok(
          results.runs.filter((r) => r.status === "passed").length >= 1,
        );
        await page.screenshot({ path: `${dir}/desktop.png`, fullPage: true });
        return {
          passed: true,
          runs: results.runs.map(({ feature, provider, status }) => ({
            feature,
            provider,
            status,
          })),
        };
      });
    async function select(name) {
      await page
        .getByRole("navigation", { name: "Feature examples" })
        .getByRole("button", { name })
        .click();
    }
    async function run() {
      const responsePromise = page.waitForResponse(
        (r) =>
          r.url().includes("/api/features/") && r.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Run example" }).click();
      const response = await responsePromise;
      assert.ok(response.ok(), `Example HTTP ${response.status()}`);
      const data = await response.json();
      assert.ok(
        data.checks.every((c) => c.passed),
        JSON.stringify(data.checks),
      );
      await page
        .getByRole("button", { name: "Run example" })
        .waitFor({ state: "visible" });
      await page.waitForFunction(
        () =>
          !Array.from(document.querySelectorAll("button")).find((b) =>
            b.textContent.includes("Run example"),
          )?.disabled,
      );
      return data;
    }
    await check("non-reasoning parameters", async () => {
      await select("Reasoning parameters");
      await page
        .getByRole("combobox", { name: "Reasoning", exact: true })
        .selectOption("none");
      await run();
    });
    await check("non-streaming Responses replay", async () => {
      await select("Responses & replay");
      await page.getByRole("checkbox").uncheck();
      await run();
    });
    let audio;
    await check("TTS audio playback", async () => {
      await select("Voice generation");
      const data = await run();
      audio = data.media;
      await page.locator("audio").evaluate(async (element) => {
        await element.play();
      });
      assert.ok(
        await page.locator("audio").evaluate((element) => !element.paused),
      );
      await page.locator("audio").evaluate((element) => element.pause());
    });
    await check("STT round trip", async () => {
      await select("Voice input");
      await run();
    });
    await check("STT audio upload", async () => {
      await page.locator('input[type="file"]').setInputFiles({
        name: "speech.wav",
        mimeType: "audio/wav",
        buffer: Buffer.from(audio.base64, "base64"),
      });
      await page.getByText("speech.wav", { exact: true }).waitFor();
      await run();
    });
    await check("image generation", async () => {
      await select("Image generation & editing");
      await run();
      await page
        .getByAltText("Generated result")
        .evaluate((img) => img.decode());
    });
    await check("image editing upload", async () => {
      // Use a tiny real fixture, not a remote image URL.
      const source = fs.readFileSync(
        "examples/playground/lib/feature-lab/catalog.ts",
        "utf8",
      );
      const base64 = source.match(/export const BLUE_PNG\s*=\s*"([^"]+)"/)[1];
      await page.locator('input[type="file"]').setInputFiles({
        name: "blue.png",
        mimeType: "image/png",
        buffer: Buffer.from(base64, "base64"),
      });
      await page.getByText("blue.png", { exact: true }).waitFor();
      await page
        .getByRole("textbox", { name: "Prompt or text", exact: true })
        .fill("Add a white circle in the middle of this blue image.");
      await run();
      await page
        .getByAltText("Generated result")
        .evaluate((img) => img.decode());
    });
    await check("mobile layout and no browser errors", async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await select("Reasoning parameters");
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.screenshot({ path: `${dir}/mobile.png`, fullPage: true });
      assert.deepEqual(errors, []);
    });
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
