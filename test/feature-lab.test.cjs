const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const root = path.resolve(__dirname, "..");
const esbuild = require(
  require.resolve("esbuild", {
    paths: [
      fs.realpathSync(path.join(root, "packages/llm-sdk/node_modules/tsup")),
    ],
  }),
);
const filename = path.join(root, "examples/playground/.feature-lab-test.cjs");
const bundle = esbuild.buildSync({
  entryPoints: [
    path.join(root, "examples/playground/lib/feature-lab/server.ts"),
  ],
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  write: false,
});
const compiled = new Module(filename, module);
compiled.filename = filename;
compiled.paths = Module._nodeModulePaths(path.dirname(filename));
compiled._compile(bundle.outputFiles[0].text, filename);
const { handleLabRequest, keyNames } = compiled.exports;
const url = "http://127.0.0.1:3035/playground/api/features/";
function request(action, body = { provider: "openai" }, extra = {}) {
  return new Request(url + action, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://127.0.0.1:3035",
    },
    body: JSON.stringify(body),
    ...extra,
  });
}
function setEnv(_env, name, value) {
  process.env[name] = value;
}
test.beforeEach((t) => {
  const names = [
    "PLAYGROUND_FEATURE_LAB",
    "CLOUDFLARE_ACCOUNT_ID",
    ...Object.values(keyNames),
  ];
  const saved = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  t.after(() => {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected network request");
  });
  setEnv(process.env, "PLAYGROUND_FEATURE_LAB", "1");
  for (const key of Object.values(keyNames)) setEnv(process.env, key, "");
  setEnv(process.env, "CLOUDFLARE_ACCOUNT_ID", "");
});
test("lab is disabled without its explicit local flag", async (t) => {
  setEnv(process.env, "PLAYGROUND_FEATURE_LAB", "0");
  assert.equal(
    (await handleLabRequest(request("parameters"), "parameters")).status,
    403,
  );
});
test("rejects public hosts, foreign origins and cross-site requests before spending credentials", async () => {
  for (const req of [
    new Request("https://public.example/playground/api/features/status"),
    request(
      "parameters",
      {},
      { headers: { origin: "https://elsewhere.example" } },
    ),
    request("parameters", {}, { headers: { "sec-fetch-site": "cross-site" } }),
  ])
    assert.equal((await handleLabRequest(req, "status")).status, 403);
});
test("availability exposes booleans and variable names, never credentials", async (t) => {
  setEnv(process.env, "OPENAI_API_KEY", "fixture-private-value");
  setEnv(process.env, "CLOUDFLARE_AUTH_TOKEN", "fixture-cf-value");
  const response = await handleLabRequest(
    new Request(url + "status"),
    "status",
  );
  const text = await response.text();
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.ok(!text.includes("fixture-"));
  assert.equal(JSON.parse(text).providers.openai.configured, true);
  assert.equal(JSON.parse(text).providers.cloudflare.configured, false);
});
test("reports missing credentials without network calls", async () => {
  const response = await handleLabRequest(request("parameters"), "parameters");
  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /OPENAI_API_KEY/);
});
test("rejects malformed, oversized and non-JSON bodies", async () => {
  for (const [req, status] of [
    [request("decisions", {}, { body: "{" }), 400],
    [request("decisions", {}, { body: "x".repeat(7_000_001) }), 413],
    [
      request("decisions", {}, { headers: { "content-type": "text/plain" } }),
      415,
    ],
  ])
    assert.equal((await handleLabRequest(req, "decisions")).status, status);
});
test("validates provider support, strict options and file formats", async () => {
  const invalid = [
    ["parameters", { provider: "anthropic" }],
    ["parameters", { provider: "openai", apiKey: "not-accepted" }],
    [
      "parameters",
      {
        provider: "openai",
        file: { base64: "YQ==", mediaType: "image/png", name: "a.png" },
      },
    ],
    [
      "tool-images",
      {
        provider: "openai",
        file: { base64: "!invalid!", mediaType: "image/png", name: "a.png" },
      },
    ],
    [
      "tool-images",
      {
        provider: "openai",
        file: { base64: "YQ==", mediaType: "image/svg+xml", name: "a.svg" },
      },
    ],
    [
      "decisions",
      {
        provider: "openrouter",
        file: { base64: "YQ==", mediaType: "image/png", name: "a.png" },
      },
    ],
    ["realtime", { sdp: "x".repeat(64001) }],
    ["chat?provider=openrouter", {}],
  ];
  for (const [action, body] of invalid)
    assert.equal(
      (await handleLabRequest(request(action, body), action.split("?")[0]))
        .status,
      400,
      action,
    );
});
test("sanitizes provider failure messages", async (t) => {
  setEnv(process.env, "OPENAI_API_KEY", "fixture-private-value");
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          error: {
            message: "fixture-private-value",
            type: "invalid_request_error",
          },
        }),
        { status: 401 },
      ),
  );
  const response = await handleLabRequest(request("decisions"), "decisions");
  assert.equal(response.status, 401);
  assert.ok(!(await response.text()).includes("fixture-private-value"));
});
test("native Decisions result reaches the lab with provider probabilities intact", async (t) => {
  setEnv(process.env, "OPENAI_API_KEY", "fixture-private-value");
  t.mock.method(globalThis, "fetch", async (endpoint, init) => {
    assert.equal(endpoint, "https://api.openai.com/v1/decisions");
    assert.equal(JSON.parse(init.body).questions.length, 3);
    return Response.json({
      model: "gpt-6-luna",
      answers: [
        { type: "predicate", name: "outage", probability: 0.01 },
        {
          type: "choice",
          name: "team",
          choice: "billing",
          probabilities: [
            { value: "billing", probability: 0.98 },
            { value: "engineering", probability: 0.01 },
            { value: "support", probability: 0.01 },
          ],
        },
        {
          type: "score",
          name: "impact",
          score: 0.1,
          probabilities: [
            { value: 0, probability: 0.9 },
            { value: 1, probability: 0.1 },
            { value: 2, probability: 0 },
          ],
        },
      ],
      usage: { input_tokens: 40, output_tokens: 0, total_tokens: 40 },
    });
  });
  const response = await handleLabRequest(request("decisions"), "decisions");
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.details.answers.team.probabilities.billing, 0.98);
  assert.equal(result.details.route, "billing");
  assert.ok(result.checks.every((c) => c.passed));
});
