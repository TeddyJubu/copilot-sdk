// Fixture-only checks for the existing playground's shared API-key UI.
const assert = require("node:assert/strict");
const unlisted = {
  "Reasoning parameters": "parameters",
  "Compatibility fallback": "fallback",
  "System prompt compatibility": "system-prompt",
};
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { browserEnvironment } = require("../live/feature-lab-credentials.cjs");
const url =
  process.env.FEATURE_LAB_URL || "http://127.0.0.1:3035/playground/features";
(async () => {
  const browser = await chromium.launch({
    headless: true,
    env: browserEnvironment(),
  });
  try {
    const page = await browser.newPage();
    const errors = [],
      recorded = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const keys = {
      openai: "fixture-openai",
      anthropic: "fixture-anthropic",
      openrouter: "fixture-openrouter",
      typesafe: "fixture-typesafe",
      cloudflare: "fixture-cloudflare",
    };
    await page.route("**/playground/api/features/**", async (route) => {
      const request = route.request();
      const action = new URL(request.url()).pathname.split("/").at(-1);
      if (action === "status")
        return route.fulfill({
          json: {
            localCredentials: false,
            providers: Object.fromEntries(
              Object.keys(keys).map((provider) => [
                provider,
                { configured: false, requires: [] },
              ]),
            ),
          },
        });
      const data = request.postDataJSON();
      const provider =
        action === "chat"
          ? new URL(request.url()).searchParams.get("provider")
          : data.provider;
      assert.equal(request.headers()["x-api-key"], keys[provider]);
      assert.ok(!request.url().includes("fixture-"));
      assert.ok(!request.postData().includes("fixture-"));
      if (provider === "cloudflare")
        assert.equal(
          request.headers()["x-cloudflare-account-id"],
          "a".repeat(32),
        );
      else
        assert.equal(request.headers()["x-cloudflare-account-id"], undefined);
      recorded.push({ action, provider });
      if (action === "chat")
        return route.fulfill({
          json: {
            success: true,
            content: "Caller key works.",
            messages: [
              ...data.messages,
              {
                id: "fixture-answer",
                role: "assistant",
                content: "Caller key works.",
              },
            ],
            requiresAction: false,
          },
        });
      return route.fulfill({
        json: {
          feature: action,
          provider,
          model: "fixture",
          text: "Caller key works.",
          checks: [{ label: "Fixture", passed: true }],
        },
      });
    });
    await page.goto(url);
    assert.equal(
      await page
        .getByRole("button", { name: "Run example", exact: true })
        .isDisabled(),
      true,
    );
    await page.getByRole("button", { name: "API keys", exact: true }).click();
    for (const [label, value] of [
      ["OpenAI", keys.openai],
      ["Anthropic", keys.anthropic],
      ["OpenRouter", keys.openrouter],
      ["TypeSafe / Jev API key", keys.typesafe],
      ["Cloudflare API token", keys.cloudflare],
      ["Cloudflare account ID", "a".repeat(32)],
    ])
      await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByRole("button", { name: "Save Keys", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    for (const [name, provider] of [
      ["Reasoning parameters", "openai"],
      ["Compatibility fallback", "openai"],
      ...["openai", "openrouter", "typesafe", "cloudflare"].map((provider) => [
        "Native Decisions",
        provider,
      ]),
      ["Responses & replay", "openai"],
      ["Images in tool calls", "anthropic"],
      ["System prompt compatibility", "anthropic"],
      ["Voice generation", "openai"],
      ["Voice input", "openai"],
      ["Image generation & editing", "openai"],
    ]) {
      // Compatibility checks are not listed in the navigation; open them by link.
      if (unlisted[name]) await page.goto(`${url}?feature=${unlisted[name]}`);
      else
        await page
          .getByRole("navigation", { name: "Feature examples" })
          .getByRole("button", { name })
          .click();
      await page
        .getByRole("combobox", { name: "Provider", exact: true })
        .selectOption(provider);
      const pending = page.waitForResponse(
        (r) =>
          r.url().includes("/api/features/") && r.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Run example", exact: true })
        .click();
      await pending;
      await page
        .getByRole("button", { name: "Cancel run", exact: true })
        .waitFor({ state: "hidden" });
    }
    await page
      .getByRole("navigation", { name: "Feature examples" })
      .getByRole("button", { name: "Responses & replay" })
      .click();
    await page
      .getByRole("checkbox", { name: "Streaming", exact: true })
      .uncheck();
    await page
      .getByRole("button", { name: "Open Copilot chat", exact: true })
      .click();
    const input = page.getByTestId("lab-chat").getByRole("textbox");
    await input.fill("Hello");
    await input.press("Enter");
    await page
      .getByTestId("lab-chat")
      .getByText("Caller key works.", { exact: true })
      .waitFor();
    await page.goto(url.replace(/\/features$/, ""));
    await page.getByRole("link", { name: "Feature lab", exact: true }).click();
    await page.getByText("● Your key ready", { exact: true }).waitFor();
    await page.getByRole("button", { name: "API keys", exact: true }).click();
    assert.equal(
      await page.getByLabel("OpenAI", { exact: true }).inputValue(),
      keys.openai,
    );
    assert.equal(
      await page
        .getByLabel("Cloudflare account ID", { exact: true })
        .inputValue(),
      "a".repeat(32),
    );
    assert.equal(recorded.length, 13);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: existing API-key modal, saved-key reuse, 12 feature/provider requests, embedded chat and dashboard navigation; keys stay out of bodies and URLs.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
