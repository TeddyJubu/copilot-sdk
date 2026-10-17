"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { highlight } from "sugar-high";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

export function CopyButton({
  text,
  label = "Copy code",
}: {
  text: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1400);
        } catch {
          setCopied(false);
        }
      }}
      className="press relative grid size-7 place-items-center rounded-md text-faint hover:bg-accent hover:text-foreground"
    >
      <Copy
        className={cn(
          "absolute size-3.5 transition-[opacity,transform,filter] duration-200",
          copied ? "scale-75 opacity-0 blur-[2px]" : "scale-100 opacity-100",
        )}
      />
      <Check
        className={cn(
          "absolute size-3.5 text-success transition-[opacity,transform,filter] duration-200",
          copied ? "scale-100 opacity-100" : "scale-75 opacity-0 blur-[2px]",
        )}
      />
    </button>
  );
}

export function CodeView({
  code,
  className,
  wrap = false,
}: {
  code: string;
  className?: string;
  wrap?: boolean;
}) {
  const html = useMemo(() => highlight(code), [code]);
  return (
    <pre
      className={cn(
        "code overflow-x-auto px-4 py-3.5 text-foreground/90",
        wrap && "break-words whitespace-pre-wrap",
        className,
      )}
    >
      <code dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  );
}
