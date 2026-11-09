import { ChevronRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// ─── PageHeader ──────────────────────────────────────────────

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  back,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Tautan kembali ringkas (ponsel lebih butuh ini daripada breadcrumb). */
  back?: { href: string; label: string };
  className?: string;
}) {
  return (
    <div className={cn("mb-5", className)}>
      {back ? (
        <Link
          href={back.href}
          className="mb-2 inline-flex items-center gap-1 text-[13px] font-medium text-ink-muted hover:text-ink"
        >
          <ChevronRight aria-hidden className="size-3.5 rotate-180" />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow ? (
            <div className="text-xs font-medium tracking-wide text-ink-faint uppercase">{eyebrow}</div>
          ) : null}
          <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">{title}</h1>
          {description ? <div className="mt-1 text-sm text-ink-muted">{description}</div> : null}
        </div>
        {actions ? <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

// ─── EmptyState ──────────────────────────────────────────────

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed border-border-strong bg-surface px-6 py-12 text-center",
        className,
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-primary-50">
        <Icon aria-hidden className="size-6 text-primary-600" />
      </div>
      <p className="mt-3 text-sm font-semibold text-ink">{title}</p>
      {description ? <div className="mt-1 max-w-sm text-[13px] text-ink-muted">{description}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

// ─── KPI ─────────────────────────────────────────────────────

export type KpiTone = "default" | "masuk" | "keluar" | "warning" | "danger" | "primary";

const KPI_TONE: Record<KpiTone, string> = {
  default: "text-ink",
  masuk: "text-masuk",
  keluar: "text-keluar",
  warning: "text-warning",
  danger: "text-danger",
  primary: "text-primary",
};

export function Kpi({
  label,
  value,
  sub,
  tone = "default",
  href,
  icon: Icon,
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: KpiTone;
  href?: string;
  icon?: LucideIcon;
  className?: string;
}) {
  const isi = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold tracking-wide text-ink-muted uppercase">{label}</p>
        {Icon ? <Icon aria-hidden className="size-4 text-ink-faint" /> : null}
      </div>
      <p className={cn("tabular mt-1 text-lg leading-tight font-semibold sm:text-xl", KPI_TONE[tone])}>{value}</p>
      {sub ? <div className="mt-0.5 text-xs leading-snug text-ink-muted">{sub}</div> : null}
    </>
  );
  const base = cn("block min-w-0 rounded-lg border border-border bg-surface px-3.5 py-3 shadow-(--shadow-card)", className);
  return href ? (
    <Link href={href} className={cn(base, "transition-colors hover:border-border-strong hover:bg-surface-muted")}>
      {isi}
    </Link>
  ) : (
    <div className={base}>{isi}</div>
  );
}

// ─── ProgressBar ─────────────────────────────────────────────

export function ProgressBar({
  value,
  tone = "primary",
  className,
  label,
}: {
  /** 0–100+ (di atas 100 tetap penuh, warnanya yang bicara). */
  value: number;
  tone?: "primary" | "success" | "warning" | "danger";
  className?: string;
  label?: string;
}) {
  const warna = {
    primary: "bg-primary-600",
    success: "bg-success",
    warning: "bg-gold",
    danger: "bg-danger",
  }[tone];
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      aria-label={label}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-surface-inset", className)}
    >
      <div className={cn("h-full rounded-full transition-[width]", warna)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

// ─── Avatar ──────────────────────────────────────────────────

const WARNA_AVATAR = [
  "bg-primary-100 text-primary-800",
  "bg-emerald-100 text-emerald-800",
  "bg-amber-100 text-amber-800",
  "bg-rose-100 text-rose-800",
  "bg-sky-100 text-sky-800",
  "bg-violet-100 text-violet-800",
];

export function Avatar({ name, size = "md", className }: { name: string; size?: "sm" | "md"; className?: string }) {
  const inisial =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase())
      .join("") || "?";
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        size === "sm" ? "size-6 text-[10px]" : "size-8 text-xs",
        WARNA_AVATAR[h % WARNA_AVATAR.length],
        className,
      )}
    >
      {inisial}
    </span>
  );
}

// ─── Deskripsi (pasangan label–nilai) ────────────────────────

export function DescList({ items, className }: { items: { label: string; value: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2", className)}>
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-xs font-medium text-ink-muted">{it.label}</dt>
          <dd className="mt-0.5 text-sm break-words text-ink">{it.value ?? "–"}</dd>
        </div>
      ))}
    </dl>
  );
}

// ─── Uang ────────────────────────────────────────────────────

export function Uang({
  nilai,
  arah,
  className,
}: {
  nilai: string;
  /** "masuk" hijau, "keluar" merah. */
  arah?: "masuk" | "keluar";
  className?: string;
}) {
  return (
    <span
      className={cn("tabular font-medium whitespace-nowrap", arah === "masuk" && "text-masuk", arah === "keluar" && "text-keluar", className)}
    >
      {nilai}
    </span>
  );
}
