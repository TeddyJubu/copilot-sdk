"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type Tone =
  | "passed"
  | "failed"
  | "skipped"
  | "cancelled"
  | "running"
  | "ready"
  | "idle";

/** A status light. Decorative; pair it with a visible word. */
export function Led({
  tone = "idle",
  className,
}: {
  tone?: Tone;
  className?: string;
}) {
  return <span aria-hidden className={cn("led", className)} data-tone={tone} />;
}

const buttonStyles = {
  primary:
    "bg-brand text-brand-foreground shadow-[0_1px_0_0_oklch(1_0_0/18%)_inset,0_1px_2px_oklch(0_0_0/20%)] hover:brightness-110",
  solid: "bg-primary text-primary-foreground hover:bg-primary/90",
  outline:
    "bg-card text-foreground shadow-[0_0_0_1px_var(--line-strong)] hover:bg-accent",
  ghost: "text-muted-foreground hover:text-foreground hover:bg-accent",
  danger:
    "text-danger shadow-[0_0_0_1px_color-mix(in_oklch,var(--danger)_35%,transparent)] hover:bg-danger/10",
} as const;

const buttonSizes = {
  xs: "h-6 px-2 text-[11.5px] gap-1 rounded-md [&_svg]:size-3",
  sm: "h-7 px-2.5 text-[12px] gap-1.5 rounded-md [&_svg]:size-3.5",
  md: "h-8 px-3 text-[12.5px] gap-1.5 rounded-lg [&_svg]:size-3.5",
  lg: "h-9 px-3.5 text-[13px] gap-2 rounded-lg [&_svg]:size-4",
  icon: "size-8 rounded-lg [&_svg]:size-4",
} as const;

export interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof buttonStyles;
  size?: keyof typeof buttonSizes;
}

export const Btn = React.forwardRef<HTMLButtonElement, BtnProps>(function Btn(
  { variant = "outline", size = "md", className, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "press inline-flex shrink-0 items-center justify-center whitespace-nowrap font-medium select-none",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-45 [&_svg]:shrink-0",
        buttonStyles[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    />
  );
});

/** Same look as Btn for anchors (links to docs, downloads). */
export function linkButtonClass(
  variant: keyof typeof buttonStyles = "outline",
  size: keyof typeof buttonSizes = "md",
) {
  return cn(
    "press inline-flex shrink-0 items-center justify-center whitespace-nowrap font-medium",
    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring [&_svg]:shrink-0",
    buttonStyles[variant],
    buttonSizes[size],
  );
}

export function Kbd({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <kbd aria-hidden className={cn("kbd", className)}>
      {children}
    </kbd>
  );
}

export function Panel({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <section className={cn("panel relative", className)} {...props}>
      {children}
    </section>
  );
}

export function PanelHeader({
  title,
  meta,
  actions,
  className,
  id,
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-11 items-center justify-between gap-3 border-b border-line px-4 py-2",
        className,
      )}
    >
      <div className="flex min-w-0 items-baseline gap-2.5">
        <h3 id={id} className="text-[13px] font-semibold tracking-[-0.01em]">
          {title}
        </h3>
        {meta ? (
          <span className="num truncate text-[11px] text-faint">{meta}</span>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
      ) : null}
    </div>
  );
}

/** Label text above a control; keeps the control's accessible name intact. */
export function FieldLabel({
  children,
  hint,
}: {
  children: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <span className="mb-1.5 flex items-baseline justify-between gap-3 text-[12px] font-medium text-muted-foreground">
      <span>{children}</span>
      {hint ? (
        <span className="num text-[10.5px] font-normal text-faint">{hint}</span>
      ) : null}
    </span>
  );
}

/** Quiet note: hairline, no tinted fill, tone colours only the text marker. */
export function Note({
  tone,
  children,
  className,
  role,
}: {
  tone?: "danger" | "warning" | "brand";
  children: React.ReactNode;
  className?: string;
  role?: string;
}) {
  return (
    <div
      role={role}
      className={cn(
        "flex gap-2.5 rounded-lg border border-line bg-surface px-3 py-2.5 text-[12.5px] leading-relaxed text-muted-foreground",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full",
          tone === "danger"
            ? "bg-danger"
            : tone === "warning"
              ? "bg-warning"
              : tone === "brand"
                ? "bg-brand"
                : "bg-faint",
        )}
      />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Two to four mutually exclusive options. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled,
  className,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: React.ReactNode }>;
  onChange: (value: T) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "inline-flex rounded-lg bg-muted p-0.5 shadow-[inset_0_0_0_1px_var(--line)]",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "press h-7 flex-1 rounded-md px-2.5 text-[12px] font-medium whitespace-nowrap",
              active
                ? "bg-card text-foreground shadow-[0_0_0_1px_var(--line-strong),0_1px_2px_oklch(0_0_0/12%)]"
                : "text-muted-foreground hover:text-foreground",
              "disabled:opacity-50",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Small status word with a light; never a tinted chip. */
export function StatusWord({
  tone,
  children,
}: {
  tone: Tone;
  children: React.ReactNode;
}) {
  const color =
    tone === "passed" || tone === "ready"
      ? "text-success"
      : tone === "failed"
        ? "text-danger"
        : tone === "skipped" || tone === "cancelled"
          ? "text-warning"
          : tone === "running"
            ? "text-brand"
            : "text-faint";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[12px] font-medium",
        color,
      )}
    >
      <Led tone={tone} />
      {children}
    </span>
  );
}
