// Only the explicitly opted-in BYOK tests place caller keys in an ephemeral
// browser context. Chromium's process environment never receives API keys.
exports.browserEnvironment = () =>
  Object.fromEntries(
    ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "NODE_EXTRA_CA_CERTS"]
      .filter((name) => process.env[name] !== undefined)
      .map((name) => [name, process.env[name]]),
  );
exports.installCallerKeys = async (page, url) => {
  if (process.env.FEATURE_LAB_CALLER_KEYS !== "1") return;
  const origin = new URL(url).origin;
  if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname))
    throw new Error("Caller-key tests require a local server");
  const keys = Object.fromEntries(
    ["openai", "anthropic", "openrouter"].map((provider) => [
      provider,
      process.env[provider.toUpperCase() + "_API_KEY"] || "",
    ]),
  );
  await page.addInitScript(
    ({ origin, keys }) => {
      if (location.origin === origin)
        localStorage.setItem(
          "copilot-playground-api-keys",
          JSON.stringify({ google: "", xai: "", ...keys }),
        );
    },
    { origin, keys },
  );
};
