"use client";

import { Info } from "lucide-react";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { CodeSnippet } from "./CodeSnippet";
import type { ToolMetadata } from "@/lib/types";

interface ToolInfoHoverCardProps {
  metadata: ToolMetadata;
}

export function ToolInfoHoverCard({ metadata }: ToolInfoHoverCardProps) {
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
              {metadata.description}
            </p>
          </div>

          {/* Suggested Query */}
          <div>
            <p className="eyebrow mb-1.5">Try asking</p>
            <div className="rounded-lg border border-line bg-surface px-3 py-2">
              <p className="num text-[11.5px] text-foreground/90">
                &quot;{metadata.suggestedQuery}&quot;
              </p>
            </div>
          </div>

          {/* Code Snippet */}
          <div>
            <p className="eyebrow mb-1.5">Registration</p>
            <CodeSnippet code={metadata.codeSnippet} className="max-h-48" />
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
