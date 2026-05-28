import { ChevronRight, Coins, Paperclip, Receipt, Wallet } from "lucide-react"
import type { Transaction } from "@/types/api"
import { fmtCompact, fmtDate, fmtIDR } from "@/lib/format"
import { AmountDisplay } from "@/components/domain/shared/AmountDisplay"
import { Badge } from "@/components/ui/badge"
import { StatusBadge } from "@/components/domain/shared/StatusBadge"
import { cn } from "@/lib/utils"

interface TransactionCardProps {
  transaction: Transaction
  /** Nama proyek (lookup dari proj_map di parent). */
  projectName?: string
  /** Nama kategori (lookup dari cat_map di parent). */
  categoryName?: string
  hasAttachment?: boolean
  onClick?: () => void
  className?: string
}

export function TransactionCard({
  transaction: t,
  projectName,
  categoryName,
  hasAttachment,
  onClick,
  className,
}: TransactionCardProps) {
  const isIn = t.type === "IN"
  const remaining = Number(t.remaining_amount ?? 0)
  const allocated = Number(t.allocated_amount ?? 0)
  // Audit 2026-05-27: DIRECT_EXPENSE by design tdk dialokasi ke invoice.
  const showAllocBadge =
    t.type === "OUT" && t.kind !== "DIRECT_EXPENSE" && remaining > 0
  const isFullUnalloc = showAllocBadge && allocated === 0
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
      {/* Row 1: tanggal + ID + nominal. ID dipakai sbg referensi di
          WhatsApp/Telegram (mis. '/hapus 123') -- mudahkan user copy. */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col leading-tight">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[12px] text-ink-500">{fmtDate(t.tx_date)}</span>
            <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-mono text-ink-700 tabular-nums">
              #{t.id}
            </span>
          </div>
          <span className="text-[11px] uppercase tracking-wider text-ink-400 mt-0.5">
            {isIn ? "Pemasukan" : "Pengeluaran"}
          </span>
        </div>
        <div className="flex flex-col items-end gap-1">
          <AmountDisplay
            value={t.amount}
            type={t.type}
            colored
            size="lg"
          />
          {showAllocBadge && (
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                isFullUnalloc
                  ? "bg-danger-100 text-danger-800"
                  : "bg-warning-100 text-warning-800",
              )}
              title={
                isFullUnalloc
                  ? "Belum dialokasi sama sekali"
                  : `Sudah dialokasi ${fmtIDR(allocated)} · sisa ${fmtIDR(remaining)}`
              }
            >
              {isFullUnalloc
                ? "Belum dialokasi"
                : `Sisa ${fmtCompact(remaining)}`}
            </span>
          )}
        </div>
      </div>

      {/* Row 2: pihak / proyek */}
      <div className="flex flex-col gap-0.5 min-w-0">
        <div className="text-sm font-medium text-ink-900 truncate">
          {t.party_name || "—"}
        </div>
        <div className="text-[12px] text-ink-500 truncate">
          {projectName ? `${projectName}${categoryName ? ` · ${categoryName}` : ""}` : categoryName || "—"}
        </div>
      </div>

      {/* Row 3: deskripsi (kalau ada, max 1 baris) */}
      {t.description && (
        <div className="text-[12px] text-ink-600 line-clamp-1">{t.description}</div>
      )}

      {/* Row 3b: invoice yg dibayar (kalau ada allocation). Bidirectional
          link supaya user gampang trace 'TX ini bayar invoice mana'. */}
      {t.allocations && t.allocations.length > 0 && (
        <div className="text-[11px] text-ink-500 flex items-center gap-1 flex-wrap">
          <Receipt className="h-3 w-3 shrink-0" />
          <span>Bayar invoice:</span>
          {t.allocations.slice(0, 2).map((a, i) => (
            <span key={a.id} className="font-mono text-brand-700">
              {i > 0 && ", "}
              {a.invoice_number ?? `#${a.invoice_id}`}
            </span>
          ))}
          {t.allocations.length > 2 && (
            <span className="text-ink-500">+{t.allocations.length - 2} lagi</span>
          )}
        </div>
      )}

      {/* Footer: status + kind + attachment + chevron */}
      <div className="flex items-center justify-between mt-1">
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge domain="transaction" status={t.status} />
          {t.kind === "CASH_ADVANCE" && (
            <Badge tone={t.settlement_status === "SETTLED" ? "success" : "warning"}>
              <Wallet className="h-3 w-3" />
              {t.settlement_status === "SETTLED" ? "Dana Ops (settled)" : "Dana Ops"}
            </Badge>
          )}
          {t.kind === "DIRECT_EXPENSE" && (
            <Badge tone="neutral">
              <Receipt className="h-3 w-3" />
              Beban Langsung{t.items?.length ? ` (${t.items.length})` : ""}
            </Badge>
          )}
          {t.parent_advance_tx_id && (
            <Badge tone="info" title="Top-up dari pertanggungjawaban">
              <Coins className="h-3 w-3" />
              Top-up
            </Badge>
          )}
          {hasAttachment && <Paperclip className="h-3.5 w-3.5 text-ink-400" />}
        </div>
        <ChevronRight className="h-4 w-4 text-ink-300 group-hover:text-ink-500" />
      </div>
    </button>
  )
}
