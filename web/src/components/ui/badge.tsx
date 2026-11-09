import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { Tone } from "@/lib/lifecycle";

const TONE: Record<Tone, string> = {
  neutral: "bg-surface-inset text-ink-muted border-border",
  success: "bg-success-soft text-success border-success-border",
  warning: "bg-warning-soft text-warning border-warning-border",
  danger: "bg-danger-soft text-danger border-danger-border",
  info: "bg-info-soft text-info border-info-border",
};

const DOT: Record<Tone, string> = {
  neutral: "bg-ink-faint",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

export function Badge({
  tone = "neutral",
  children,
  className,
  dot = false,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        TONE[tone],
        className,
      )}
    >
      {dot ? <span aria-hidden className={cn("size-1.5 rounded-full", DOT[tone])} /> : null}
      {children}
    </span>
  );
}
