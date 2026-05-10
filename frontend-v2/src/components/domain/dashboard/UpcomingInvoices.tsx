import { Link } from "react-router-dom"
import { ChevronRight } from "lucide-react"
import type { DashboardInvoice } from "@/types/dashboard"
import { fmtDate, fmtIDR } from "@/lib/format"
import { StatusBadge } from "@/components/domain/shared/StatusBadge"
import { cn } from "@/lib/utils"

interface UpcomingInvoicesProps {
  items: DashboardInvoice[]
  className?: string
  limit?: number
  /**
   * Filter mode:
   *  - "outstanding": ISSUED / PARTIALLY_PAID / OVERDUE saja (default)
   *  - "all": semua status
   */
  filter?: "outstanding" | "all"
}

export function UpcomingInvoices({
  items,
  className,
  limit,
  filter = "outstanding",
}: UpcomingInvoicesProps) {
  let data = items
  if (filter === "outstanding") {
    data = data.filter(
      (i) => i.status === "ISSUED" || i.status === "PARTIALLY_PAID" || i.status === "OVERDUE",
    )
    // Sort by overdue first, then due date asc
    data = [...data].sort((a, b) => {
      if (a.status === "OVERDUE" && b.status !== "OVERDUE") return -1
      if (b.status === "OVERDUE" && a.status !== "OVERDUE") return 1
      const ad = a.due_date ? new Date(a.due_date).getTime() : Infinity
      const bd = b.due_date ? new Date(b.due_date).getTime() : Infinity
      return ad - bd
    })
  }
  if (limit != null) data = data.slice(0, limit)

  if (data.length === 0) {
    return (
      <div
        className={cn(
          "rounded-md border border-dashed bg-surface-muted p-6 text-center text-[13px] text-ink-500",
          className,
        )}
      >
        Tidak ada invoice yang perlu diperhatikan.
      </div>
    )
  }

  return (
    <ul className={cn("flex flex-col divide-y rounded-md border bg-surface", className)}>
      {data.map((inv) => {
        const pct =
          inv.total > 0 ? Math.min(100, Math.round((inv.paid_amount / inv.total) * 100)) : 0
        return (
          <li key={inv.id}>
            <Link
              to={`/invoices?open=${inv.id}`}
              className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-muted"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="truncate text-sm font-medium text-ink-900">
                    {inv.number}
                  </span>
                  <StatusBadge domain="invoice" status={inv.status} />
                </div>
                <div className="text-[11px] text-ink-500 truncate">
                  {inv.party_name ?? "—"}
                  {inv.due_date && <> · jatuh tempo {fmtDate(inv.due_date)}</>}
                </div>
                {inv.paid_amount > 0 && inv.outstanding_amount > 0 && (
                  <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-ink-100">
                    <div
                      className="h-full bg-warning-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
              </div>
              <div className="text-right">
                <div
                  data-num
                  className="font-mono text-sm font-semibold text-ink-900 [font-variant-numeric:tabular-nums]"
                >
                  {fmtIDR(inv.outstanding_amount)}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-ink-500">
                  sisa
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-ink-300 shrink-0" />
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
