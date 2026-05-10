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

  const Wrapper: any = onClick ? "button" : "div"
  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "flex flex-col gap-1.5 rounded-md border bg-surface p-3 text-left sm:p-4",
        onClick && "transition-colors hover:bg-surface-muted hover:border-border-strong",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        {Icon && <Icon className="h-3.5 w-3.5 text-ink-500" />}
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
          {label}
        </span>
      </div>
      <div data-num className={cn("font-mono text-lg font-bold leading-tight sm:text-xl", toneClasses)}>
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
