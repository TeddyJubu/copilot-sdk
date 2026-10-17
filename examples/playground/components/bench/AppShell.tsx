"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
import {
  BookOpen,
  FlaskConical,
  Github,
  KeyRound,
  MessagesSquare,
  Moon,
  Sun,
} from "lucide-react";
import CopilotSDKLogo from "@/components/CopilotSDKLogo";
import { cn } from "@/lib/utils";
import { useKeys } from "./keys";
import { Btn, Kbd, Led, linkButtonClass } from "./ui";
import type { ApiKeys } from "@/lib/types";
import { DOCS_URL } from "@/lib/documentation";

const GITHUB_URL =
  "https://github.com/YourGPT/copilot-sdk/tree/main/examples/playground";

const keyProviders: Array<{ id: keyof ApiKeys; name: string }> = [
  { id: "openai", name: "OpenAI" },
  { id: "anthropic", name: "Anthropic" },
  { id: "google", name: "Google" },
  { id: "xai", name: "xAI" },
  { id: "openrouter", name: "OpenRouter" },
  { id: "typesafe", name: "TypeSafe / Jev" },
  { id: "cloudflare", name: "Cloudflare" },
];

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <button
      type="button"
      aria-label="Toggle theme"
      title="Toggle theme (⌘J)"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className="press relative grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <Sun className="size-4 scale-100 rotate-0 transition-[transform,opacity] duration-300 ease-out-strong dark:scale-50 dark:-rotate-90 dark:opacity-0" />
      <Moon className="absolute size-4 scale-50 rotate-90 opacity-0 transition-[transform,opacity] duration-300 ease-out-strong dark:scale-100 dark:rotate-0 dark:opacity-100" />
    </button>
  );
}

function KeyStatusList() {
  const { keys, hydrated, serverKeys, openKeys } = useKeys();
  return (
    <div className="hidden px-3 pb-3 lg:block">
      <div className="mb-1.5 flex items-center justify-between px-2">
        <span className="eyebrow">Your keys</span>
        <button
          type="button"
          onClick={openKeys}
          className="text-[11px] text-faint underline-offset-2 hover:text-foreground hover:underline"
        >
          Manage
        </button>
      </div>
      <ul className="space-y-px">
        {keyProviders.map((provider) => {
          const browser = hydrated && !!keys[provider.id]?.trim();
          const server = !browser && !!serverKeys[provider.id];
          const set = browser || server;
          return (
            <li
              key={provider.id}
              className="flex h-6 items-center gap-2 rounded-md px-2 text-[12px]"
            >
              <Led tone={set ? "ready" : "idle"} />
              <span className={set ? "text-foreground" : "text-faint"}>
                {provider.name}
              </span>
              <span
                className="num ml-auto text-[10.5px] text-faint"
                title={
                  server ? "Key from the local server environment" : undefined
                }
              >
                {browser ? "saved" : server ? "local env" : "—"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PrimaryNav({ active }: { active: "chat" | "lab" }) {
  const items = [
    { id: "chat", href: "/", label: "Copilot chat", icon: MessagesSquare },
    { id: "lab", href: "/features", label: "Feature lab", icon: FlaskConical },
  ] as const;
  return (
    <nav
      aria-label="Playground"
      className="flex gap-1 px-3 lg:flex-col lg:gap-px"
    >
      {items.map((item) => {
        const current = item.id === active;
        return (
          <Link
            key={item.id}
            href={item.href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "press flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium",
              current
                ? "bg-card text-foreground shadow-[0_0_0_1px_var(--line-strong),0_1px_2px_oklch(0_0_0/10%)]"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <item.icon
              aria-hidden
              className={cn("size-4", current ? "text-brand" : "text-faint")}
            />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({
  active,
  crumb,
  rail,
  children,
  fixedHeight = false,
  docsPath = "",
}: {
  active: "chat" | "lab";
  crumb?: React.ReactNode;
  /** Page-specific rail content: the feature list. Renders horizontally on small screens. */
  rail?: React.ReactNode;
  children: React.ReactNode;
  /** Pin the workspace to the viewport (the chat page scrolls its own panes). */
  fixedHeight?: boolean;
  docsPath?: string;
}) {
  const { isReady, openKeys } = useKeys();
  const keyCount = keyProviders.filter((provider) =>
    isReady(provider.id),
  ).length;

  return (
    <div className="min-h-dvh bg-canvas lg:grid lg:grid-cols-[236px_minmax(0,1fr)]">
      <aside className="flex min-w-0 flex-col border-b border-line bg-surface lg:sticky lg:top-0 lg:h-dvh lg:border-r lg:border-b-0">
        <div className="flex h-12 items-center gap-2.5 px-5 lg:h-14">
          <CopilotSDKLogo aria-hidden className="size-[22px]" />
          <div className="leading-none">
            <p className="text-[13.5px] font-semibold tracking-[-0.015em]">
              Copilot SDK
            </p>
            <p className="eyebrow mt-1 !text-[9.5px]">Playground</p>
          </div>
        </div>
        <PrimaryNav active={active} />
        {rail ? (
          <div className="min-h-0 flex-1 pt-2 pb-2 lg:overflow-y-auto lg:pt-5">
            {rail}
          </div>
        ) : (
          <div className="hidden flex-1 lg:block" />
        )}
        <KeyStatusList />
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-12 items-center justify-between gap-3 border-b border-line bg-canvas/80 px-4 backdrop-blur-md sm:px-6">
          <div className="flex min-w-0 items-center gap-2 text-[12.5px]">
            {crumb}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <a
              href={`${DOCS_URL}${docsPath}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open documentation for this page"
              className={linkButtonClass("ghost", "sm")}
            >
              <BookOpen aria-hidden />
              <span className="hidden sm:inline">Docs</span>
            </a>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub"
              className={cn(
                linkButtonClass("ghost", "sm"),
                "hidden sm:inline-flex",
              )}
            >
              <Github aria-hidden />
              <span className="hidden md:inline">GitHub</span>
            </a>
            <ThemeToggle />
            <span aria-hidden className="mx-1 h-5 w-px bg-line-strong" />
            <Btn
              size="sm"
              variant={keyCount ? "outline" : "primary"}
              onClick={openKeys}
            >
              <KeyRound aria-hidden />
              API keys
              <span aria-hidden className="num ml-0.5 text-[10.5px] opacity-70">
                {keyCount}/{keyProviders.length}
              </span>
            </Btn>
          </div>
        </header>
        <main
          className={cn(
            "relative min-w-0 flex-1",
            fixedHeight && "lg:h-[calc(100dvh-3rem)] lg:overflow-hidden",
          )}
        >
          <div
            aria-hidden
            className="bench-grid pointer-events-none absolute inset-x-0 top-0 h-[420px]"
          />
          <div className={cn("relative", fixedHeight && "lg:h-full")}>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

export function Crumbs({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="flex min-w-0 items-center gap-1.5">
      {items.map((item, index) => (
        <li
          key={index}
          className={cn(
            "flex min-w-0 items-center gap-1.5",
            index < items.length - 1 && "hidden sm:flex",
          )}
        >
          {index > 0 ? (
            <span aria-hidden className="hidden text-faint/70 sm:inline">
              /
            </span>
          ) : null}
          <span
            className={cn(
              "truncate",
              index === items.length - 1
                ? "font-medium text-foreground"
                : "text-muted-foreground",
            )}
          >
            {item}
          </span>
        </li>
      ))}
    </ol>
  );
}

export { Kbd };
