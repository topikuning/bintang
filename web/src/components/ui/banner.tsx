import { AlertTriangle, CheckCircle2, Info, XCircle, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type BannerTone = "success" | "error" | "warning" | "info";

const TONE: Record<BannerTone, { icon: LucideIcon; wrap: string; ikon: string }> = {
  success: { icon: CheckCircle2, wrap: "bg-success-soft border-success-border", ikon: "text-success" },
  error: { icon: XCircle, wrap: "bg-danger-soft border-danger-border", ikon: "text-danger" },
  warning: { icon: AlertTriangle, wrap: "bg-warning-soft border-warning-border", ikon: "text-warning" },
  info: { icon: Info, wrap: "bg-info-soft border-info-border", ikon: "text-info" },
};

export function Banner({
  tone,
  title,
  description,
  action,
  className,
}: {
  tone: BannerTone;
  title: string;
  description?: ReactNode;
  /** Satu tombol/tautan yang membawa orang ke tempat masalahnya diselesaikan. */
  action?: ReactNode;
  className?: string;
}) {
  const t = TONE[tone];
  const Ikon = t.icon;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("flex flex-wrap items-start gap-2.5 rounded-lg border px-3.5 py-3", t.wrap, className)}
    >
      <Ikon aria-hidden className={cn("mt-0.5 size-4 shrink-0", t.ikon)} />
      <div className="min-w-[12rem] flex-1 text-sm">
        <p className="font-semibold text-ink">{title}</p>
        {description ? <div className="mt-0.5 text-[13px] text-ink-muted">{description}</div> : null}
      </div>
      {action ? <div className="min-w-0">{action}</div> : null}
    </div>
  );
}
