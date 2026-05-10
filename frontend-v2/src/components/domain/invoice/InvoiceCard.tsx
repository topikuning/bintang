import { ChevronRight, FileMinus, FilePlus, Paperclip } from "lucide-react"
import type { Invoice } from "@/types/api"
import { fmtCompact, fmtDate, fmtIDR } from "@/lib/format"
import { StatusBadge } from "@/components/domain/shared/StatusBadge"
import { cn } from "@/lib/utils"

interface InvoiceCardProps {
  invoice: Invoice
  projectName?: string
  hasAttachment?: boolean
  onClick?: () => void
  className?: string
}

/**
 * Card invoice utk mobile. Layout:
 *  Row 1: nomor invoice + status badge besar
 *  Row 2: nama vendor/klien
 *  Row 3: total + (jika partial) progress bar pembayaran
 *  Row 4: due date + tanggal invoice + attachment indicator
 */
export function InvoiceCard({
  invoice: inv,
  projectName,
  hasAttachment,
  onClick,
  className,
}: InvoiceCardProps) {
  const isInbound = inv.type === "IN" // hutang (vendor menagih kita)
  const total = Number(inv.total || 0)
  const paid = Number(inv.paid_amount ?? 0)
  const remaining = Number(inv.outstanding_amount ?? inv.remaining ?? total - paid)
  const pct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0
  const showProgress = inv.status === "PARTIALLY_PAID" || (paid > 0 && remaining > 0)

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
      {/* Row 1: nomor + tipe + status besar */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {isInbound ? (
            <FileMinus className="h-3.5 w-3.5 text-warning-600 shrink-0" />
          ) : (
            <FilePlus className="h-3.5 w-3.5 text-info-600 shrink-0" />
          )}
          <span className="font-mono text-[13px] font-semibold truncate">
            {inv.number}
          </span>
        </div>
        <StatusBadge domain="invoice" status={inv.status} />
      </div>

      {/* Row 2: vendor / pihak */}
      <div className="flex flex-col gap-0.5 min-w-0">
        <div className="text-sm font-medium text-ink-900 truncate">
          {inv.party_name || "—"}
        </div>
        {projectName && (
          <div className="text-[11px] text-ink-500 truncate">{projectName}</div>
        )}
      </div>

      {/* Row 3: total + progress (kalau partial) */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] uppercase tracking-wider text-ink-500">
            Total
          </span>
          <span
            data-num
            className="font-mono text-base font-bold text-ink-900 [font-variant-numeric:tabular-nums]"
          >
            {fmtIDR(total)}
          </span>
        </div>
        {showProgress && (
          <>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
              <div
                className="h-full bg-warning-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-success-700 font-mono [font-variant-numeric:tabular-nums]">
                Terbayar {fmtCompact(paid)}
              </span>
              <span className="text-warning-700 font-mono [font-variant-numeric:tabular-nums]">
                Sisa {fmtCompact(remaining)}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Footer: tanggal + attachment + chevron */}
      <div className="flex items-center justify-between text-[11px] text-ink-500">
        <div className="flex items-center gap-2">
          <span>{fmtDate(inv.invoice_date)}</span>
          {inv.due_date && (
            <span>· jt. {fmtDate(inv.due_date)}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {hasAttachment && <Paperclip className="h-3 w-3 text-ink-400" />}
          <ChevronRight className="h-4 w-4 text-ink-300 group-hover:text-ink-500" />
        </div>
      </div>
    </button>
  )
}
