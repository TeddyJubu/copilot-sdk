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
    "NODE_ENV",
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
  setEnv(process.env, "NODE_ENV", "development");
  for (const key of Object.values(keyNames)) setEnv(process.env, key, "");
  setEnv(process.env, "CLOUDFLARE_ACCOUNT_ID", "");
});
test("without local mode a request requires the caller's key", async () => {
  setEnv(process.env, "PLAYGROUND_FEATURE_LAB", "0");
  assert.equal(
    (await handleLabRequest(request("parameters"), "parameters")).status,
    401,
  );
});
test("rejects foreign origins and cross-site requests before spending credentials", async () => {
  for (const req of [
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
  assert.match((await response.json()).error, /API keys/);
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

function hostedRequest(
  action,
  body = { provider: "openai" },
  headers = {},
  host = "https://playground.example",
) {
  return new Request(host + "/playground/api/features/" + action, {
    method: "POST",
    headers: { "content-type": "application/json", origin: host, ...headers },
    body: JSON.stringify(body),
  });
}
test("hosted status never advertises configured server credentials", async () => {
  process.env.OPENAI_API_KEY = "fixture-server-value";
  const response = await handleLabRequest(
    new Request("https://playground.example/playground/api/features/status"),
    "status",
  );
  const data = await response.json();
  assert.equal(data.localCredentials, false);
  assert.ok(Object.values(data.providers).every((p) => p.configured === false));
});
test("every hosted feature rejects missing keys even when server credentials exist", async () => {
  process.env.OPENAI_API_KEY = "fixture-server-value";
  process.env.ANTHROPIC_API_KEY = "fixture-server-value";
  for (const [action, body] of [
    ...[
      "parameters",
      "fallback",
      "decisions",
      "responses",
      "tool-images",
      "speech",
      "transcription",
      "image",
    ].map((action) => [action, { provider: "openai" }]),
    ["system-prompt", { provider: "anthropic" }],
    ["chat", { messages: [{ role: "user", content: "hello" }] }],
    ["realtime", { sdp: "v=0" }],
  ])
    assert.equal(
      (await handleLabRequest(hostedRequest(action, body), action)).status,
      401,
      action,
    );
});
test("production builds never use local server keys, even with the opt-in flag", async () => {
  process.env.NODE_ENV = "production";
  process.env.OPENAI_API_KEY = "fixture-server-value";
  assert.equal(
    (await handleLabRequest(request("decisions"), "decisions")).status,
    401,
  );
  const status = await handleLabRequest(new Request(url + "status"), "status");
  assert.equal((await status.json()).providers.openai.configured, false);
});
test("an explicitly empty caller key never falls back to a local server key", async () => {
  process.env.OPENAI_API_KEY = "fixture-server-value";
  const req = request("decisions");
  req.headers.set("x-api-key", " ");
  assert.equal((await handleLabRequest(req, "decisions")).status, 401);
});
test("hosted and docs-proxied requests forward only the caller key", async (t) => {
  process.env.OPENAI_API_KEY = "fixture-server-value";
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (endpoint, init) => {
    calls++;
    assert.equal(endpoint, "https://api.openai.com/v1/decisions");
    assert.equal(
      new Headers(init.headers).get("authorization"),
      "Bearer test-caller-key",
    );
    return Response.json(
      { error: { message: "test-caller-key" } },
      { status: 401 },
    );
  });
  for (const origin of [
    "https://playground.example",
    "https://copilot-sdk.yourgpt.ai",
  ]) {
    const response = await handleLabRequest(
      hostedRequest(
        "decisions",
        { provider: "openai" },
        { "x-api-key": "test-caller-key", origin },
      ),
      "decisions",
    );
    assert.equal(response.status, 401);
    assert.ok(!(await response.text()).includes("test-caller-key"));
  }
  assert.equal(calls, 2);
});
test("Cloudflare uses each caller's account and key without mixing requests or server settings", async (t) => {
  process.env.CLOUDFLARE_ACCOUNT_ID = "c".repeat(32);
  process.env.CLOUDFLARE_AUTH_TOKEN = "fixture-server-cf";
  const observed = [];
  t.mock.method(globalThis, "fetch", async (endpoint, init) => {
    observed.push([
      String(endpoint),
      new Headers(init.headers).get("authorization"),
    ]);
    return Response.json(
      { success: false, errors: [{ message: "denied" }] },
      { status: 401 },
    );
  });
  const responses = await Promise.all(
    ["a", "b"].map((id) =>
      handleLabRequest(
        hostedRequest(
          "decisions",
          { provider: "cloudflare" },
          {
            "x-api-key": "test-caller-" + id,
            "x-cloudflare-account-id": id.repeat(32),
          },
        ),
        "decisions",
      ),
    ),
  );
  assert.ok(responses.every((response) => response.status === 401));
  assert.equal(observed.length, 2);
  for (const id of ["a", "b"])
    assert.ok(
      observed.some(
        ([endpoint, auth]) =>
          endpoint.includes("/accounts/" + id.repeat(32) + "/") &&
          auth === "Bearer test-caller-" + id,
      ),
    );
  const missingAccount = await handleLabRequest(
    hostedRequest(
      "decisions",
      { provider: "cloudflare" },
      { "x-api-key": "fixture-caller" },
    ),
    "decisions",
  );
  assert.equal(missingAccount.status, 400);
  assert.equal(observed.length, 2);
});
