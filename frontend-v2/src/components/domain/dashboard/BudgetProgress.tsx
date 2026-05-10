import type { ProjectBudget } from "@/types/dashboard"
import { fmtIDR, fmtPct } from "@/lib/format"
import { cn } from "@/lib/utils"

interface BudgetProgressProps {
  budget: ProjectBudget
  className?: string
}

const STATUS_LABEL = {
  budget_aman: "Aman",
  mendekati_batas: "Mendekati batas",
  overbudget: "Over budget",
  no_budget: "Tanpa budget",
} as const

export function BudgetProgress({ budget, className }: BudgetProgressProps) {
  if (budget.status === "no_budget" || !budget.amount) {
    return (
      <div
        className={cn(
          "rounded-md border bg-surface p-4 text-[13px] text-ink-500",
          className,
        )}
      >
        Proyek belum punya budget. Set di pengaturan proyek.
      </div>
    )
  }

  const usage = Math.min(100, Math.max(0, budget.usage_pct))
  const tone =
    budget.status === "overbudget"
      ? "danger"
      : budget.status === "mendekati_batas"
        ? "warning"
        : "success"
  const barColor = {
    success: "bg-success-500",
    warning: "bg-warning-500",
    danger: "bg-danger-500",
  }[tone]
  const textColor = {
    success: "text-success-700",
    warning: "text-warning-700",
    danger: "text-danger-700",
  }[tone]

  return (
    <div className={cn("rounded-md border bg-surface p-4 space-y-2", className)}>
      <div className="flex items-baseline justify-between">
        <span className="text-[12px] uppercase tracking-wider text-ink-500">
          Realisasi Budget
        </span>
        <span className={cn("text-[12px] font-semibold", textColor)}>
          {STATUS_LABEL[budget.status]}
        </span>
      </div>
      <div className="flex items-baseline gap-2">
        <span
          data-num
          className="font-mono text-2xl font-bold [font-variant-numeric:tabular-nums]"
        >
          {fmtPct(budget.usage_pct / 100)}
        </span>
        <span className="text-[12px] text-ink-500">
          dari budget
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-ink-100">
        <div
          className={cn("h-full transition-all", barColor)}
          style={{ width: `${budget.status === "overbudget" ? 100 : usage}%` }}
        />
      </div>
      <div className="grid grid-cols-3 gap-2 text-[11px] text-ink-500 pt-1">
        <div>
          <div>Budget</div>
          <div data-num className="font-mono text-ink-900 [font-variant-numeric:tabular-nums]">
            {fmtIDR(budget.amount)}
          </div>
        </div>
        <div>
          <div>Terpakai</div>
          <div data-num className="font-mono text-ink-900 [font-variant-numeric:tabular-nums]">
            {fmtIDR(budget.spent)}
          </div>
        </div>
        <div className="text-right">
          <div>{budget.remaining < 0 ? "Lewat" : "Sisa"}</div>
          <div
            data-num
            className={cn(
              "font-mono [font-variant-numeric:tabular-nums]",
              budget.remaining < 0 ? "text-danger-700 font-semibold" : "text-ink-900",
            )}
          >
            {fmtIDR(Math.abs(budget.remaining))}
          </div>
        </div>
      </div>
    </div>
  )
}
