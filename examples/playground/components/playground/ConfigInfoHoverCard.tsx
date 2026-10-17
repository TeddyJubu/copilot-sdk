"use client";

import { Info } from "lucide-react";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { CodeSnippet } from "./CodeSnippet";

interface ConfigInfoHoverCardProps {
  description: string;
  tip?: string;
  codeSnippet?: string;
  codeLabel?: string;
}

export function ConfigInfoHoverCard({
  description,
  tip,
  codeSnippet,
  codeLabel = "Example",
}: ConfigInfoHoverCardProps) {
  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-label="More information"
          className="press grid size-6 place-items-center rounded-md text-faint hover:bg-accent hover:text-foreground"
          onClick={(e) => e.stopPropagation()}
        >
          <Info aria-hidden className="size-3.5" />
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        className="w-80 overflow-hidden rounded-xl border-0 p-0 shadow-[var(--shadow-panel)]"
        side="right"
        align="start"
        sideOffset={8}
      >
        <div className="p-4 space-y-3">
          {/* Description */}
          <div>
            <p className="eyebrow mb-1.5">Description</p>
            <p className="text-[12.5px] leading-relaxed text-foreground/90">
              {description}
            </p>
          </div>

          {/* Tip */}
          {tip && (
            <div>
              <p className="eyebrow mb-1.5">Tip</p>
              <div className="rounded-lg border border-line bg-surface px-3 py-2">
                <p className="text-[12px] leading-relaxed text-muted-foreground">
                  {tip}
                </p>
              </div>
            </div>
          )}

          {/* Code Snippet */}
          {codeSnippet && (
            <div>
              <p className="eyebrow mb-1.5">{codeLabel}</p>
              <CodeSnippet code={codeSnippet} className="max-h-48" />
            </div>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
