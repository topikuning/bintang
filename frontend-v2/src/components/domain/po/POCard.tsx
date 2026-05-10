import { ChevronRight, ShoppingCart } from "lucide-react"
import type { PurchaseOrder } from "@/types/api"
import { fmtDate, fmtIDR } from "@/lib/format"
import { StatusBadge } from "@/components/domain/shared/StatusBadge"
import { cn } from "@/lib/utils"

interface POCardProps {
  po: PurchaseOrder
  projectName?: string
  onClick?: () => void
  className?: string
}

export function POCard({ po, projectName, onClick, className }: POCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex w-full flex-col gap-2 rounded-md border bg-surface p-3 text-left transition-colors active:bg-ink-100",
        "hover:bg-surface-muted hover:border-border-strong",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <ShoppingCart className="h-3.5 w-3.5 text-info-600 shrink-0" />
          <span className="font-mono text-[13px] font-semibold truncate">
            {po.number}
          </span>
        </div>
        <StatusBadge domain="po" status={po.status} />
      </div>

      <div className="flex flex-col gap-0.5 min-w-0">
        <div className="text-sm font-medium text-ink-900 truncate">
          {po.vendor_name || "—"}
        </div>
        {projectName && (
          <div className="text-[11px] text-ink-500 truncate">{projectName}</div>
        )}
      </div>

      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wider text-ink-500">
          Total
        </span>
        <span
          data-num
          className="font-mono text-base font-bold text-ink-900 [font-variant-numeric:tabular-nums]"
        >
          {fmtIDR(po.total)}
        </span>
      </div>

      <div className="flex items-center justify-between text-[11px] text-ink-500">
        <div className="flex items-center gap-2">
          <span>{fmtDate(po.po_date)}</span>
          {po.needed_date && <span>· butuh {fmtDate(po.needed_date)}</span>}
        </div>
        <ChevronRight className="h-4 w-4 text-ink-300 group-hover:text-ink-500" />
      </div>
    </button>
  )
}
