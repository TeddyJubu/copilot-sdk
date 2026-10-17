"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import {
  AudioLines,
  Brain,
  GitFork,
  Image as ImageIcon,
  ImagePlus,
  Mic,
  Radio,
  Repeat,
  ScrollText,
  Scale,
} from "lucide-react";
import { listedFeatures, type FeatureId } from "@/lib/feature-lab/catalog";
import { cn } from "@/lib/utils";
import { Led, type Tone } from "./ui";

export const featureIcons: Record<FeatureId, typeof Brain> = {
  parameters: Brain,
  fallback: GitFork,
  decisions: Scale,
  responses: Repeat,
  "tool-images": ImageIcon,
  "system-prompt": ScrollText,
  speech: AudioLines,
  transcription: Mic,
  realtime: Radio,
  image: ImagePlus,
};

/**
 * The beta feature list. On the lab page items are buttons that switch the
 * bench in place; elsewhere they are links into the lab.
 */
export function FeatureNav({
  mode,
  selected,
  status,
  disabled,
  onSelect,
}: {
  mode: "buttons" | "links";
  selected?: FeatureId;
  status?: Partial<Record<FeatureId, Tone>>;
  disabled?: boolean;
  onSelect?: (id: FeatureId) => void;
}) {
  const navRef = useRef<HTMLElement>(null);
  // On small screens the list is a horizontal strip: keep the current item in view.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav || nav.scrollWidth <= nav.clientWidth) return;
    const current = nav.querySelector<HTMLElement>("[aria-pressed='true']");
    if (current)
      nav.scrollTo({
        left:
          current.offsetLeft - nav.clientWidth / 2 + current.offsetWidth / 2,
      });
  }, [selected]);
  return (
    <nav
      ref={navRef}
      aria-label={mode === "buttons" ? "Feature examples" : "Beta features"}
      className="scroll-fade-x relative flex gap-1 overflow-x-auto px-3 pb-1 lg:block lg:overflow-visible lg:pb-0 lg:[mask-image:none]"
    >
      <p className="eyebrow hidden px-2 pb-1.5 lg:flex lg:items-center lg:justify-between">
        Beta
        <span className="num normal-case tracking-normal">
          {listedFeatures.length}
        </span>
      </p>
      {listedFeatures.map((feature) => {
        const Icon = featureIcons[feature.id];
        const current = feature.id === selected;
        const tone = status?.[feature.id] ?? "idle";
        const className = cn(
          "press group flex h-8 shrink-0 items-center gap-2.5 rounded-lg px-2.5 text-left text-[12.5px] whitespace-nowrap lg:w-full",
          current
            ? "bg-brand-soft text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--brand)_28%,transparent)]"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
          "disabled:cursor-not-allowed disabled:opacity-60",
        );
        const inner = (
          <>
            <Icon
              aria-hidden
              className={cn(
                "size-[15px] shrink-0",
                current
                  ? "text-brand"
                  : "text-faint group-hover:text-muted-foreground",
              )}
            />
            <span className="truncate">{feature.name}</span>
            {tone !== "idle" ? <Led tone={tone} className="ml-auto" /> : null}
          </>
        );
        return mode === "buttons" ? (
          <button
            key={feature.id}
            type="button"
            aria-pressed={current}
            disabled={disabled}
            onClick={() => onSelect?.(feature.id)}
            className={className}
          >
            {inner}
          </button>
        ) : (
          <Link
            key={feature.id}
            href={`/features?feature=${feature.id}`}
            className={className}
          >
            {inner}
          </Link>
        );
      })}
    </nav>
  );
}
