import { Link } from "react-router-dom"
import { ArrowDownLeft, ArrowUpRight, ChevronRight } from "lucide-react"
import type { DashboardRecentTransaction } from "@/types/dashboard"
import { fmtDate, fmtIDR } from "@/lib/format"
import { StatusBadge } from "@/components/domain/shared/StatusBadge"
import { cn } from "@/lib/utils"

interface RecentTransactionsProps {
  items: DashboardRecentTransaction[]
  className?: string
  /** Maks tampil; default 5 di mobile, 8 di desktop. Caller bisa override. */
  limit?: number
}

export function RecentTransactions({ items, className, limit }: RecentTransactionsProps) {
  const data = limit != null ? items.slice(0, limit) : items
  if (data.length === 0) {
    return (
      <div
        className={cn(
          "rounded-md border border-dashed bg-surface-muted p-6 text-center text-[13px] text-ink-500",
          className,
        )}
      >
        Belum ada transaksi.
      </div>
    )
  }
  return (
    <ul className={cn("flex flex-col divide-y rounded-md border bg-surface", className)}>
      {data.map((t) => (
        <li key={t.id}>
          <Link
            to={`/transactions?open=${t.id}`}
            className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-muted"
          >
            <span
              className={
                t.type === "IN"
                  ? "flex h-8 w-8 items-center justify-center rounded-full bg-success-50 text-success-700"
                  : "flex h-8 w-8 items-center justify-center rounded-full bg-danger-50 text-danger-700"
              }
            >
              {t.type === "IN" ? (
                <ArrowDownLeft className="h-4 w-4" />
              ) : (
                <ArrowUpRight className="h-4 w-4" />
              )}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="truncate text-sm font-medium text-ink-900">
                  {t.party || t.description || "—"}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-ink-500">
                <span>{fmtDate(t.date)}</span>
                <StatusBadge domain="transaction" status={t.status} />
              </div>
            </div>
            <span
              data-num
              className={
                t.type === "IN"
                  ? "font-mono text-sm font-semibold text-success-700 [font-variant-numeric:tabular-nums]"
                  : "font-mono text-sm font-semibold text-danger-700 [font-variant-numeric:tabular-nums]"
              }
            >
              {t.type === "OUT" ? "−" : ""}
              {fmtIDR(t.amount)}
            </span>
            <ChevronRight className="h-4 w-4 text-ink-300 shrink-0" />
          </Link>
        </li>
      ))}
    </ul>
  )
}
