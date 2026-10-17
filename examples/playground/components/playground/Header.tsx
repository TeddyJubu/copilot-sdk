"use client";

import { memo } from "react";
import Link from "next/link";
import { Moon, Sun, Check, AlertCircle, BookOpen, Github } from "lucide-react";
import { useTheme } from "next-themes";
import CopilotSDKLogo from "@/components/CopilotSDKLogo";

const DOCS_URL = "https://copilot-sdk.yourgpt.ai/docs";
const GITHUB_URL = "https://github.com/YourGPT/copilot-sdk";

interface HeaderProps {
  hasApiKey: boolean;
  onOpenApiKeyModal: () => void;
}

function HeaderComponent({ hasApiKey, onOpenApiKeyModal }: HeaderProps) {
  const { theme, setTheme } = useTheme();

  return (
    <header className="relative z-10 px-5 py-3 flex items-center justify-between backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <CopilotSDKLogo className="h-7 w-7" />
        <div>
          <h1 className="text-sm font-semibold tracking-tight">
            Copilot SDK Playground
          </h1>
          <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
            Interactive Demo
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Link
          href="/features"
          className="px-3 py-1.5 rounded-lg text-xs font-medium text-teal-700 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950"
        >
          Feature lab
        </Link>
        {/* Docs Link */}
        <a
          href={DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        >
          <BookOpen className="h-4 w-4" />
          <span className="text-xs font-medium">Docs</span>
        </a>

        {/* GitHub Link */}
        <a
          href={`${GITHUB_URL}/tree/main/examples/playground`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
        >
          <Github className="h-4 w-4" />
          <span className="text-xs font-medium">GitHub</span>
        </a>

        {/* Divider */}
        <div className="w-px h-6 bg-zinc-200 dark:bg-zinc-700 mx-1" />

        {/* API Key Status & Button */}
        <button
          onClick={onOpenApiKeyModal}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-colors ${
            hasApiKey
              ? "bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-400"
              : "bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-400"
          }`}
        >
          {hasApiKey ? (
            <>
              <Check className="h-3 w-3" />
              <span className="text-[10px] font-mono">API Key Set</span>
            </>
          ) : (
            <>
              <AlertCircle className="h-3 w-3" />
              <span className="text-[10px] font-mono">Add API Key</span>
            </>
          )}
        </button>

        {/* Theme Toggle */}
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="p-2 rounded-lg bg-zinc-200/50 dark:bg-zinc-800/50 border border-zinc-300/50 dark:border-zinc-700/50 hover:bg-zinc-300/50 dark:hover:bg-zinc-700/50 transition-colors"
        >
          {theme === "dark" ? (
            <Sun className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
          ) : (
            <Moon className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
          )}
        </button>
      </div>
    </header>
  );
}

export const Header = memo(HeaderComponent);
