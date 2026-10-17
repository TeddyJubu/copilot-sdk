// Exercise the files and dependency ranges consumers receive, outside the workspace lockfile.
// Run after building both SDK packages. This installs public dependencies but never publishes.
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = mkdtempSync(join(tmpdir(), "copilot-package-install-"));
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const run = (command, args, cwd) =>
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
    timeout: 180_000,
  });

try {
  for (const name of ["llm-sdk", "copilot-sdk"])
    run(
      pnpm,
      ["pack", "--pack-destination", temporary],
      join(root, "packages", name),
    );
  const archives = readdirSync(temporary)
    .filter((name) => name.endsWith(".tgz"))
    .map((name) => join(temporary, name));
  if (archives.length !== 2)
    throw new Error("Expected exactly two SDK archives");

  for (const reactVersion of ["18", "19"]) {
    const consumer = join(temporary, `react-${reactVersion}`);
    mkdirSync(consumer);
    writeFileSync(
      join(consumer, "package.json"),
      JSON.stringify({
        name: "copilot-package-check",
        version: "1.0.0",
        private: true,
      }),
    );
    run(
      npm,
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--package-lock=false",
        ...archives,
        `react@${reactVersion}`,
        `react-dom@${reactVersion}`,
      ],
      consumer,
    );
    copyFileSync(
      join(root, "test", "fixtures", "package-consumer.cjs"),
      join(consumer, "smoke.cjs"),
    );
    run(process.execPath, ["smoke.cjs"], consumer);
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
