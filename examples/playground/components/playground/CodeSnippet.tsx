"use client";

import { CodeView } from "@/components/bench/CodeView";
import { cn } from "@/lib/utils";

interface CodeSnippetProps {
  code: string;
  className?: string;
}

export function CodeSnippet({ code, className = "" }: CodeSnippetProps) {
  return (
    <CodeView
      code={code}
      className={cn(
        "rounded-lg bg-surface px-3 py-2.5 text-[11px] shadow-[inset_0_0_0_1px_var(--line)]",
        className,
      )}
    />
  );
}
