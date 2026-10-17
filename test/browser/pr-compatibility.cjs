// Offline browser regression suite. PR_SOURCE_ROOT can point at an exact PR snapshot.
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
const root = process.env.PR_SOURCE_ROOT || path.resolve(__dirname, "../..");
const ownRoot = path.resolve(__dirname, "../..");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const esbuild = require(
  require.resolve("esbuild", {
    paths: [
      fs.realpathSync(path.join(ownRoot, "packages/llm-sdk/node_modules/tsup")),
    ],
  }),
);
const source = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Markdown } from './packages/copilot-sdk/src/ui/components/ui/markdown';
import { Chat } from './packages/copilot-sdk/src/ui/components/composed/chat/chat';
import { MessageList } from './packages/copilot-sdk/src/ui/components/composed/chat/message-list';
import { CopilotProvider, useCopilot } from './packages/copilot-sdk/src/react/provider/CopilotProvider';
import { useTools } from './packages/copilot-sdk/src/react/hooks/useTool';
const roots = new Map();
function Tools({ available, value }) {
 useTools({ lookup: { description: 'lookup', available, inputSchema: { type: 'object', properties: {} },
   handler: () => ({ success: true, data: value }) } });
 const context = useCopilot(); window.context = context;
 return <div>{context.registeredTools.map(t => t.name + ':' + t.available).join(',')}</div>;
}
window.renderCase = (id, kind, props) => {
 let root = roots.get(id);
 if (!root) { const el = document.createElement('div'); el.id = id; document.body.append(el); root = createRoot(el); roots.set(id, root); }
 let element;
 if (kind === 'tools') element = <CopilotProvider runtimeUrl='/fixture'><Tools {...props}/></CopilotProvider>;
 else if (kind === 'chat') element = <Chat messages={props.messages} markdown={props.markdown} onSendMessage={() => {}}>{props.compound ? <MessageList/> : undefined}</Chat>;
 else element = <div className='csdk-message-content'><Markdown {...props}/></div>;
 root.render(element);
};
window.unmountCase = id => { roots.get(id)?.unmount(); roots.delete(id); document.getElementById(id)?.remove(); };
`;
const bundle = esbuild.buildSync({
  stdin: { contents: source, resolveDir: root, loader: "tsx" },
  bundle: true,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  write: false,
  nodePaths: [path.join(root, "packages/copilot-sdk/node_modules")],
  define: { "process.env.NODE_ENV": '"development"' },
  logLevel: "silent",
}).outputFiles[0].text;
const results = [];
let server, browser;
(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/bundle.js") {
      res.setHeader("content-type", "application/javascript");
      res.end(bundle);
    } else if (req.url === "/styles.css") {
      res.setHeader("content-type", "text/css");
      res.end(
        fs.readFileSync(
          path.join(root, "packages/copilot-sdk/src/ui/styles/base.css"),
        ),
      );
    } else {
      res.setHeader("content-type", "text/html");
      res.end(
        '<html><head><link rel="stylesheet" href="/styles.css"></head><body><script src="/bundle.js"></script></body></html>',
      );
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(2500);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  async function render(id, kind, props) {
    await page.evaluate(
      ({ id, kind, props }) => window.renderCase(id, kind, props),
      { id, kind, props },
    );
    await page.waitForTimeout(100);
  }
  async function check(name, fn) {
    try {
      await fn();
      results.push({ name, passed: true });
      console.log("PASS " + name);
    } catch (e) {
      results.push({ name, passed: false, error: e.message });
      console.log("FAIL " + name + ": " + e.message);
    }
  }
  await check("legacy default keeps sanitized HTML", async () => {
    await render("default", "markdown", {
      children: "<strong>legacy</strong><script>window.injected=1</script>",
    });
    assert.equal(
      await page.locator('#default [data-streamdown="strong"]').textContent(),
      "legacy",
    );
    assert.equal(await page.evaluate(() => window.injected), undefined);
  });
  await check(
    "literal HTML preserves script, multiline and inline snippets",
    async () => {
      const children = "<script>window.injected=2</script>\n<div>alpha</div>";
      await render("literal", "markdown", { children, rawHtml: "literal" });
      assert.equal(
        (await page.locator("#literal").innerText()).trim(),
        children,
      );
      assert.equal(await page.locator("#literal script").count(), 0);
      await render("inline", "markdown", {
        children: "before <b>alpha</b> after",
        rawHtml: "literal",
      });
      assert.match(
        await page.locator("#inline").textContent(),
        /before <b>alpha<\/b> after/,
      );
    },
  );
  await check("same-length block and inline HTML edits update", async () => {
    await render("literal", "markdown", {
      children: "<div>alpha</div>",
      rawHtml: "literal",
    });
    await render("literal", "markdown", {
      children: "<div>bravo</div>",
      rawHtml: "literal",
    });
    assert.match(await page.locator("#literal").textContent(), /bravo/);
    await render("inline", "markdown", {
      children: "before <b>bravo</b> after",
      rawHtml: "literal",
    });
    assert.match(await page.locator("#inline").textContent(), /bravo/);
  });
  await check(
    "switching HTML policy remounts the processor output",
    async () => {
      await render("flip", "markdown", {
        children: "<strong>hello</strong>",
        rawHtml: "literal",
      });
      assert.equal(
        await page.locator('#flip [data-streamdown="strong"]').count(),
        0,
      );
      await render("flip", "markdown", {
        children: "<strong>hello</strong>",
        rawHtml: "render",
      });
      assert.equal(
        await page.locator('#flip [data-streamdown="strong"]').count(),
        1,
      );
      await render("flip", "markdown", {
        children: "<strong>hello</strong>",
        rawHtml: "literal",
      });
      assert.equal(
        await page.locator('#flip [data-streamdown="strong"]').count(),
        0,
      );
    },
  );
  await check(
    "GFM tables, tasks, links and fenced code survive literal mode",
    async () => {
      await render("gfm", "markdown", {
        rawHtml: "literal",
        children:
          "| A | B |\n| - | - |\n| 1 | 2 |\n\n- [x] done\n\n~~removed~~ https://example.com\n\n\x60\x60\x60html\n<b>code</b>\n\x60\x60\x60",
      });
      assert.equal(await page.locator("#gfm table").count(), 1);
      assert.equal(await page.locator("#gfm input[type=checkbox]").count(), 1);
      assert.equal(await page.locator("#gfm del").textContent(), "removed");
      assert.match(
        await page.locator("#gfm pre").textContent(),
        /<b>code<\/b>/,
      );
    },
  );
  for (const compound of [false, true])
    await check(
      "HTML policy reaches user and assistant " +
        (compound ? "compound" : "default") +
        " messages",
      async () => {
        const id = compound ? "compound" : "chat";
        await render(id, "chat", {
          compound,
          markdown: { rawHtml: "literal" },
          messages: [
            { id: "u", role: "user", content: "<b>USER_SNIPPET</b>" },
            { id: "a", role: "assistant", content: "<b>ASSISTANT_SNIPPET</b>" },
          ],
        });
        assert.match(
          await page.locator("#" + id).textContent(),
          /<b>USER_SNIPPET<\/b>/,
        );
        assert.match(
          await page.locator("#" + id).textContent(),
          /<b>ASSISTANT_SNIPPET<\/b>/,
        );
      },
    );
  await check(
    "useTools availability updates and handler reads latest props",
    async () => {
      await render("tools", "tools", { available: true, value: 1 });
      await render("tools", "tools", { available: false, value: 2 });
      assert.equal(
        await page.evaluate(
          () =>
            window.context.registeredTools.find((t) => t.name === "lookup")
              ?.available,
        ),
        false,
      );
      await render("tools", "tools", { available: true, value: 3 });
      await render("tools", "tools", { available: true, value: 4 });
      assert.deepEqual(
        await page.evaluate(() =>
          window.context.registeredTools
            .find((t) => t.name === "lookup")
            .handler({}, {}),
        ),
        { success: true, data: 4 },
      );
    },
  );
  await check(
    "code colors respect full CSS tokens and consumer overrides",
    async () => {
      await page.evaluate(() => {
        document.documentElement.style.setProperty("--card", "rgb(10, 20, 30)");
        document.documentElement.style.setProperty(
          "--card-foreground",
          "rgb(220, 230, 240)",
        );
      });
      const pre = page.locator('#gfm [data-streamdown="code-block-body"]');
      assert.equal(
        await pre.evaluate((el) => getComputedStyle(el).backgroundColor),
        "rgb(10, 20, 30)",
      );
      await page
        .locator("#gfm")
        .evaluate((el) =>
          el.style.setProperty("--csdk-code-body-bg", "rgb(40, 50, 60)"),
        );
      assert.equal(
        await pre.evaluate((el) => getComputedStyle(el).backgroundColor),
        "rgb(40, 50, 60)",
      );
    },
  );
  await check(
    "real highlighted tokens switch correctly between light and dark",
    async () => {
      const token = page
        .locator(
          '#gfm [data-streamdown="code-block-body"] span[style*="--shiki-dark:"]',
        )
        .first();
      await token.waitFor();
      const light = await token.evaluate((el) => getComputedStyle(el).color);
      await page.evaluate(() => document.documentElement.classList.add("dark"));
      const colors = await token.evaluate((el) => {
        const probe = document.createElement("span");
        probe.style.color = el.style.getPropertyValue("--shiki-dark");
        document.body.append(probe);
        const expected = getComputedStyle(probe).color;
        probe.remove();
        return { expected, actual: getComputedStyle(el).color };
      });
      assert.equal(colors.actual, colors.expected);
      await page.evaluate(() =>
        document.documentElement.classList.remove("dark"),
      );
      assert.equal(
        await token.evaluate((el) => getComputedStyle(el).color),
        light,
      );
    },
  );
  await check("browser has no uncaught component errors", () =>
    assert.deepEqual(errors, []),
  );
  if (process.env.PR_REPORT)
    fs.writeFileSync(process.env.PR_REPORT + ".html", await page.content());
  console.log(
    JSON.stringify(
      {
        tests: results.length,
        passed: results.filter((r) => r.passed).length,
        results,
      },
      null,
      2,
    ),
  );
  if (process.env.PR_REPORT)
    fs.writeFileSync(process.env.PR_REPORT, JSON.stringify(results, null, 2));
  if (results.some((r) => !r.passed)) process.exitCode = 1;
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await browser?.close();
    server?.close();
  });
