import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"

export interface SummaryCardProps {
  label: string
  /** Bisa string siap-pakai (mis. "Rp 1,2 M") atau elemen kustom. */
  value: React.ReactNode
  /** Sub-text di bawah value (mis. "12 transaksi"). */
  hint?: React.ReactNode
  icon?: LucideIcon
  /** Tone warna value -- default neutral. */
  tone?: "neutral" | "success" | "danger" | "warning"
  /** Membuat card jadi clickable -- diberi cursor + hover state. */
  onClick?: () => void
  className?: string
}

export function SummaryCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
  onClick,
  className,
}: SummaryCardProps) {
  const toneClasses = {
    neutral: "text-ink-900",
    success: "text-success-700",
    danger: "text-danger-700",
    warning: "text-warning-700",
  }[tone]

  const Wrapper: React.ElementType = onClick ? "button" : "div"
  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "relative flex min-h-28 flex-col gap-2 overflow-hidden rounded-xl border border-white/80 bg-surface p-4 text-left shadow-[var(--app-shadow)] ring-1 ring-ink-200/60 sm:p-5",
        onClick && "transition-all hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-lg",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        {Icon && <span className="grid h-8 w-8 place-items-center rounded-lg bg-ink-100"><Icon className="h-4 w-4 text-ink-600" /></span>}
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-ink-500">
          {label}
        </span>
      </div>
      <div data-num className={cn("font-mono text-xl font-bold leading-tight tracking-tight sm:text-2xl", toneClasses)}>
        {value}
      </div>
      {hint && (
        <div className="text-[12px] text-ink-500 leading-tight">{hint}</div>
      )}
    </Wrapper>
  )
}

interface SummaryCardGridProps {
  children: React.ReactNode
  className?: string
}

/** Grid responsif 1 kolom mobile -> 2 tablet -> 4 desktop default. */
export function SummaryCardGrid({ children, className }: SummaryCardGridProps) {
  return (
    <div
      className={cn(
        "grid gap-3 grid-cols-2 lg:grid-cols-4",
        className,
      )}
    >
      {children}
    </div>
  )
}
