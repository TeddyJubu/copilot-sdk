// Offline test of #88's isolated GenUI dependency. CDNs are fixtures; no API keys.
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
const root = process.env.PR_SOURCE_ROOT;
if (!root) throw new Error("PR_SOURCE_ROOT must name the PR #88 snapshot");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const esbuild = require(
  require.resolve("esbuild", {
    paths: [
      fs.realpathSync(
        path.join(__dirname, "../../packages/llm-sdk/node_modules/tsup"),
      ),
    ],
  }),
);
const source = `import React from 'react'; import {createRoot} from 'react-dom/client';
import {GenUIFrame} from './packages/copilot-sdk/src/experimental/renderers/GenUIFrame';
window.calls=[]; const root=createRoot(document.getElementById('root'));
window.renderCase=props=>root.render(<GenUIFrame {...props} onSendMessage={message=>window.calls.push(message)}/>);`;
const bundle = esbuild.buildSync({
  stdin: { contents: source, loader: "tsx", resolveDir: root },
  bundle: true,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  write: false,
  nodePaths: [path.join(root, "packages/copilot-sdk/node_modules")],
  define: { "process.env.NODE_ENV": '"development"' },
  logLevel: "silent",
}).outputFiles[0].text;
let browser, server;
(async () => {
  server = http.createServer((req, res) => {
    res.setHeader(
      "content-type",
      req.url === "/bundle.js" ? "application/javascript" : "text/html",
    );
    res.end(
      req.url === "/bundle.js"
        ? bundle
        : '<div id="root"></div><script src="/bundle.js"></script>',
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.route("https://**/*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: "window.Chart={defaults:{plugins:{legend:{labels:{}}}}};",
    }),
  );
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const html =
    '<div id="content">Rendered</div><script>try {parent.document.body.dataset.escape="yes"} catch(e) {} window.copilot.sendMessage("BRIDGE_OK");</script>';
  await page.evaluate(
    (html) =>
      window.renderCase({
        html,
        themeVars: {
          "--chart-1": "rgb(12, 34, 56)",
          "--foreground": "rgb(1, 2, 3)",
        },
      }),
    html,
  );
  await page.waitForFunction(() => window.calls.includes("BRIDGE_OK"));
  const escaped = await page.evaluate(
    () => document.body.dataset.escape === "yes",
  );
  assert.equal(
    escaped,
    false,
    "generated scripts must not read or mutate the parent document",
  );
  console.log("PASS iframe isolates parent DOM and retains postMessage bridge");
  const frame = page.frames().find((frame) => frame !== page.mainFrame());
  assert.match(await frame.evaluate(() => window._chartColors[0]), /^rgb\(/);
  console.log("PASS theme colors resolve inside isolated frame");
})()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
    server?.close();
  });
