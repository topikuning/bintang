import { useEffect, useMemo, useState } from "react"
import { CheckCircle2, Inbox, Link2, Loader2 } from "lucide-react"
import {
  useAllocatableTransactions,
  useApplyInvoiceAllocations,
} from "@/hooks/useAllocations"
import { apiErrorMessage } from "@/lib/api"
import { fmtCompact, fmtDate, fmtIDR } from "@/lib/format"
import { useBreakpoint } from "@/lib/breakpoint"
import { cn } from "@/lib/utils"
import type { AllocatableTransactionRow, Invoice } from "@/types/api"
import { AmountInput } from "@/components/forms/AmountInput"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { DraggableSheet } from "@/components/ui/draggable-sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/sonner"

interface AllocationManagerProps {
  open: boolean
  onClose: () => void
  invoice: Invoice
  /** Dipanggil setelah berhasil apply, parent bisa refresh kalau perlu. */
  onApplied?: () => void
}

interface SelectionRow {
  transactionId: number
  amount: number
  /** Nilai max yang boleh diisi (= min(remaining_invoice, remaining_txn)). */
  maxAmount: number
}

/**
 * Sheet untuk sambungkan transaksi pembayaran ke invoice.
 * - Ambil daftar transaksi yg masih remaining via GET allocatable.
 * - User pilih checkbox + auto-fill nominal default = min(sisa invoice, sisa txn).
 * - User boleh edit per row, total selected ditampilkan live.
 * - Submit batch -> backend auto-cap, response: applied list + leftover.
 *
 * Layout:
 *   - Mobile: DraggableSheet (full content scrollable, tombol submit sticky)
 *   - Desktop: Sheet side-right max-w-xl
 */
export function AllocationManager({
  open,
  onClose,
  invoice,
  onApplied,
}: AllocationManagerProps) {
  const bp = useBreakpoint()
  const q = useAllocatableTransactions(invoice.id, { enabled: open })
  const apply = useApplyInvoiceAllocations()

  const remaining = Number(invoice.outstanding_amount ?? invoice.remaining ?? 0)
  const [selections, setSelections] = useState<Record<number, SelectionRow>>({})
  const [note, setNote] = useState("")

  // Reset saat sheet dibuka
  useEffect(() => {
    if (open) {
      setSelections({})
      setNote("")
    }
  }, [open, invoice.id])

  const totalSelected = useMemo(
    () => Object.values(selections).reduce((s, r) => s + r.amount, 0),
    [selections],
  )

  const wouldExceed = totalSelected > remaining

  const onToggle = (txn: AllocatableTransactionRow, checked: boolean) => {
    setSelections((prev) => {
      const next = { ...prev }
      if (!checked) {
        delete next[txn.id]
      } else {
        const txnRem = Number(txn.remaining_amount)
        // Sisa kapasitas invoice setelah selection lain (kecuali row ini)
        const otherSum = Object.entries(prev)
          .filter(([id]) => Number(id) !== txn.id)
          .reduce((s, [, r]) => s + r.amount, 0)
        const invoiceCap = Math.max(0, remaining - otherSum)
        const defaultAmount = Math.min(txnRem, invoiceCap)
        next[txn.id] = {
          transactionId: txn.id,
          amount: defaultAmount,
          maxAmount: txnRem, // batas dari sisi transaksi (invoice cap dijaga lewat warning)
        }
      }
      return next
    })
  }

  const onAmountChange = (txnId: number, amount: number | null) => {
    setSelections((prev) => {
      const cur = prev[txnId]
      if (!cur) return prev
      return { ...prev, [txnId]: { ...cur, amount: Math.max(0, amount ?? 0) } }
    })
  }

  const handleSubmit = async () => {
    const items = Object.values(selections)
      .filter((r) => r.amount > 0)
      .map((r) => ({
        transaction_id: r.transactionId,
        requested_amount: r.amount,
      }))
    if (items.length === 0) {
      toast.error("Pilih minimal 1 transaksi dgn nominal > 0")
      return
    }
    try {
      const res = await apply.mutateAsync({
        invoiceId: invoice.id,
        items,
        note: note.trim() || undefined,
      })
      const applied = Number(res.total_applied)
      const leftover = Number(res.leftover_requested)
      toast.success(`${fmtIDR(applied)} dialokasikan ke invoice`, {
        description:
          leftover > 0
            ? `Sisa permintaan ${fmtIDR(leftover)} tidak terpakai (auto-cap).`
            : `Sisa tagihan invoice: ${fmtIDR(res.invoice_outstanding)}.`,
      })
      onApplied?.()
      onClose()
    } catch (err) {
      toast.error("Gagal alokasi pembayaran", { description: apiErrorMessage(err) })
    }
  }

  const body = (
    <div className="flex flex-col">
      {/* Ringkasan invoice -- selalu visible */}
      <div className="bg-surface-muted border-b px-4 py-3 sm:px-5">
        <div className="text-[11px] uppercase tracking-wider text-ink-500">
          Sambungkan ke Invoice
        </div>
        <div className="mt-0.5 font-mono text-sm font-semibold">{invoice.number}</div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
          <div>
            <div className="text-ink-500">Total invoice</div>
            <div
              data-num
              className="font-mono font-semibold text-ink-900 [font-variant-numeric:tabular-nums]"
            >
              {fmtIDR(invoice.total)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-ink-500">Sisa tagihan</div>
            <div
              data-num
              className="font-mono font-semibold text-warning-700 [font-variant-numeric:tabular-nums]"
            >
              {fmtIDR(remaining)}
            </div>
          </div>
        </div>
      </div>

      {/* List transaksi available */}
      <div className="px-3 py-3 sm:px-5">
        <div className="mb-2 text-[12px] uppercase tracking-wider text-ink-500">
          Transaksi Pembayaran Tersedia
        </div>
        {q.isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        )}
        {q.error && (
          <div className="rounded-md border border-danger-200 bg-danger-50 p-3 text-[13px] text-danger-700">
            {apiErrorMessage(q.error)}
          </div>
        )}
        {!q.isLoading && q.data && q.data.length === 0 && (
          <div className="rounded-md border border-dashed bg-surface-muted p-6 text-center text-[13px] text-ink-500">
            <Inbox className="mx-auto mb-2 h-7 w-7 text-ink-400" />
            Tidak ada transaksi yang bisa dialokasikan.
            <div className="mt-1 text-[11px]">
              Buat transaksi {invoice.type === "IN" ? "OUT (pengeluaran)" : "IN (pemasukan)"}{" "}
              di proyek yang sama, lalu kembali ke sini.
            </div>
          </div>
        )}
        <div className="space-y-2">
          {q.data?.map((txn) => {
            const sel = selections[txn.id]
            const checked = !!sel
            return (
              <AllocationRow
                key={txn.id}
                txn={txn}
                checked={checked}
                amount={sel?.amount ?? 0}
                maxAmount={sel?.maxAmount ?? Number(txn.remaining_amount)}
                onToggle={(c) => onToggle(txn, c)}
                onAmountChange={(v) => onAmountChange(txn.id, v)}
              />
            )
          })}
        </div>
      </div>

      {/* Catatan */}
      <div className="px-3 pb-3 sm:px-5">
        <label className="text-[12px] uppercase tracking-wider text-ink-500">
          Catatan (opsional)
        </label>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="mt-1.5"
          placeholder="Mis. Pembayaran termin 1, transfer Bank Jatim…"
        />
      </div>
    </div>
  )

  const footer = (
    <div className="border-t bg-surface px-3 py-3 sm:px-5 space-y-2 pb-safe">
      {wouldExceed && (
        <div className="rounded border border-warning-300 bg-warning-50 px-2 py-1.5 text-[11px] text-warning-800">
          Total alokasi melebihi sisa tagihan {fmtIDR(remaining)}. Backend
          akan auto-cap saat submit.
        </div>
      )}
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="text-ink-600">Total dialokasikan</span>
        <span
          data-num
          className={cn(
            "font-mono text-base font-bold [font-variant-numeric:tabular-nums]",
            wouldExceed ? "text-warning-700" : "text-success-700",
          )}
        >
          {fmtIDR(totalSelected)}
        </span>
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={onClose}
          className="flex-1"
          disabled={apply.isPending}
        >
          Batal
        </Button>
        <Button
          type="button"
          onClick={handleSubmit}
          className="flex-1"
          disabled={apply.isPending || totalSelected <= 0}
        >
          {apply.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          <CheckCircle2 className="h-4 w-4" />
          Sambungkan
        </Button>
      </div>
    </div>
  )

  if (bp === "mobile") {
    return (
      <DraggableSheet
        open={open}
        onOpenChange={(o) => !o && onClose()}
        title="Sambungkan Pembayaran"
        maxHeight="92vh"
        footer={footer}
      >
        {body}
      </DraggableSheet>
    )
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-xl flex flex-col p-0">
        <SheetHeader className="border-b py-3 px-5">
          <SheetTitle>
            <Link2 className="inline h-4 w-4 mr-1.5 text-brand-600" />
            Sambungkan Pembayaran
          </SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto">{body}</div>
        {footer}
      </SheetContent>
    </Sheet>
  )
}

// ---------- Row component ----------

function AllocationRow({
  txn,
  checked,
  amount,
  maxAmount,
  onToggle,
  onAmountChange,
}: {
  txn: AllocatableTransactionRow
  checked: boolean
  amount: number
  maxAmount: number
  onToggle: (checked: boolean) => void
  onAmountChange: (v: number | null) => void
}) {
  const total = Number(txn.total_amount)
  const allocated = Number(txn.allocated_amount)
  const remaining = Number(txn.remaining_amount)

  return (
    <div
      className={cn(
        "rounded-md border bg-surface p-3 transition-colors",
        checked && "border-brand-400 bg-brand-50/40",
      )}
    >
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onToggle(e.target.checked)}
          className="mt-1 h-4 w-4 accent-brand-600 cursor-pointer"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">
                {txn.party_name || txn.description || "—"}
              </div>
              <div className="text-[11px] text-ink-500 truncate">
                {fmtDate(txn.tx_date)} · {txn.payment_method}
                {txn.reference_no && ` · ${txn.reference_no}`}
              </div>
            </div>
            <span
              data-num
              className="font-mono text-sm font-semibold text-ink-900 [font-variant-numeric:tabular-nums]"
            >
              {fmtCompact(total)}
            </span>
          </div>

          <div className="mt-1.5 grid grid-cols-2 gap-2 text-[11px]">
            <div className="text-ink-500">
              Teralokasi:{" "}
              <span className="font-mono text-ink-700 [font-variant-numeric:tabular-nums]">
                {fmtCompact(allocated)}
              </span>
            </div>
            <div className="text-right text-success-700">
              Sisa:{" "}
              <span className="font-mono font-semibold [font-variant-numeric:tabular-nums]">
                {fmtCompact(remaining)}
              </span>
            </div>
          </div>
        </div>
      </label>

      {checked && (
        <div className="mt-3 space-y-1.5 pl-7">
          <label className="text-[11px] uppercase tracking-wider text-ink-500">
            Nominal Alokasi
          </label>
          <div className="flex items-center gap-2">
            <AmountInput
              value={amount || null}
              onChange={onAmountChange}
              className="flex-1"
            />
            <button
              type="button"
              onClick={() => onAmountChange(maxAmount)}
              className="text-[11px] font-semibold text-brand-600 hover:underline whitespace-nowrap"
            >
              Maks
            </button>
          </div>
          {amount > maxAmount && (
            <p className="text-[11px] text-warning-700">
              Melebihi sisa transaksi ({fmtIDR(maxAmount)}). Backend akan auto-cap.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
