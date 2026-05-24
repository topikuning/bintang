import { useState } from "react"
import { Link as RouterLink } from "react-router-dom"
import {
  Calendar,
  Copy,
  ExternalLink,
  FileText,
  Hash,
  Loader2,
  Receipt,
  ShoppingCart,
  Sparkles,
  User,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/sonner"
import { useGeneratePOCover } from "@/hooks/useAI"
import { apiErrorMessage } from "@/lib/api"
import type { Project, PurchaseOrder } from "@/types/api"
import { fmtDate, fmtDateTime, fmtIDR } from "@/lib/format"
import { usePOLinkedTransactions } from "@/hooks/usePOs"
import { StatusBadge } from "@/components/domain/shared/StatusBadge"
import { Skeleton } from "@/components/ui/skeleton"

interface PODetailProps {
  po: PurchaseOrder | null | undefined
  isLoading?: boolean
  project?: Project | null
}

export function PODetail({ po, isLoading, project }: PODetailProps) {
  if (isLoading || !po) {
    return (
      <div className="flex flex-col gap-3 p-5">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  const subtotal = Number(po.subtotal || 0)
  const tax = Number(po.tax || 0)
  const discount = Number(po.discount || 0)
  const total = Number(po.total || 0)

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2 p-5 bg-surface-muted border-b">
        <div className="flex items-center gap-2 flex-wrap">
          <ShoppingCart className="h-4 w-4 text-info-600" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
            Purchase Order
          </span>
          <StatusBadge domain="po" status={po.status} />
        </div>
        <div className="font-mono text-base font-semibold text-ink-900">{po.number}</div>
        <div
          data-num
          className="font-mono text-2xl font-bold text-ink-900 [font-variant-numeric:tabular-nums]"
        >
          {fmtIDR(total)}
        </div>
        <div className="text-[12px] text-ink-500">
          {fmtDate(po.po_date, { fullMonth: true })}
          {po.needed_date && <> · butuh tgl {fmtDate(po.needed_date, { fullMonth: true })}</>}
        </div>
      </div>

      <dl className="divide-y">
        <Field label="Vendor" icon={User} value={po.vendor_name || "—"} />
        <Field
          label="Proyek"
          value={project ? `${project.name} (${project.code})` : "—"}
        />
        <Field label="Termin Pembayaran" value={po.payment_terms || "—"} />
        <Field label="Catatan" icon={FileText} value={po.notes || "—"} />
        <Field label="Dibuat pada" icon={Calendar} value={fmtDateTime(po.created_at)} />
        {po.approved_at && (
          <Field label="Disetujui pada" value={fmtDateTime(po.approved_at)} />
        )}
        {po.cancel_reason && (
          <Field label="Alasan Pembatalan" value={po.cancel_reason} />
        )}
      </dl>

      {po.items && po.items.length > 0 && (
        <div className="p-5 border-t">
          <div className="mb-2 flex items-center gap-1.5 text-[12px] uppercase tracking-wider text-ink-500">
            <Hash className="h-3.5 w-3.5" />
            <span>Rincian Item ({po.items.length})</span>
          </div>
          <div className="overflow-x-auto rounded-md border bg-surface">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-[11px] uppercase tracking-wider text-ink-600">
                <tr className="border-b">
                  <th className="px-3 py-2 text-left">Deskripsi</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Harga Satuan</th>
                  <th className="px-3 py-2 text-right">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {po.items.map((it) => (
                  <tr key={it.id} className="border-b last:border-b-0">
                    <td className="px-3 py-2">{it.description}</td>
                    <td className="px-3 py-2 text-right font-mono text-[13px] [font-variant-numeric:tabular-nums]">
                      {it.quantity} {it.unit ?? ""}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-[13px] [font-variant-numeric:tabular-nums]">
                      {fmtIDR(it.unit_price)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-[13px] font-semibold [font-variant-numeric:tabular-nums]">
                      {fmtIDR(it.subtotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-surface-muted">
                <tr className="border-t">
                  <td colSpan={3} className="px-3 py-2 text-right text-[12px] text-ink-600">
                    Subtotal
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[13px] [font-variant-numeric:tabular-nums]">
                    {fmtIDR(subtotal)}
                  </td>
                </tr>
                {discount > 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-2 text-right text-[12px] text-ink-600">
                      Diskon
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-[13px] text-danger-700 [font-variant-numeric:tabular-nums]">
                      − {fmtIDR(discount)}
                    </td>
                  </tr>
                )}
                {tax > 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-2 text-right text-[12px] text-ink-600">
                      Pajak
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-[13px] [font-variant-numeric:tabular-nums]">
                      {fmtIDR(tax)}
                    </td>
                  </tr>
                )}
                <tr className="border-t-2 border-ink-300">
                  <td colSpan={3} className="px-3 py-2 text-right text-sm font-semibold">
                    TOTAL
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-base font-bold [font-variant-numeric:tabular-nums]">
                    {fmtIDR(total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* AI Cover Letter generator -- audit 2026-05-23 AI-2. */}
      <POCoverGeneratorPanel poId={po.id} />

      {/* Procurement chain: TX yg dibayar pakai PO ini + invoice yg
          dibayar lewat TX tsb. Standar finance pro -- audit trail
          procurement. */}
      <LinkedTransactionsSection poId={po.id} />
    </div>
  )
}

function LinkedTransactionsSection({ poId }: { poId: number }) {
  const q = usePOLinkedTransactions(poId)
  if (q.isLoading) {
    return (
      <div className="p-5 border-t">
        <Skeleton className="h-24" />
      </div>
    )
  }
  if (!q.data) return null
  const d = q.data
  const txs = d.transactions ?? []
  if (txs.length === 0) {
    return (
      <div className="p-5 border-t">
        <div className="mb-2 flex items-center gap-1.5 text-[12px] uppercase tracking-wider text-ink-500">
          <ExternalLink className="h-3.5 w-3.5" />
          <span>Transaksi terkait PO</span>
        </div>
        <p className="text-[12px] text-ink-500 italic">
          Belum ada transaksi yang menggunakan PO ini.
        </p>
      </div>
    )
  }
  // Aggregate semua invoice yg dibayar via tx2 di atas (de-duplicated)
  const invoiceSet = new Map<
    number,
    { number: string | null; status: string; total: number }
  >()
  for (const t of txs) {
    for (const a of t.allocations ?? []) {
      const existing = invoiceSet.get(a.invoice_id)
      invoiceSet.set(a.invoice_id, {
        number: a.invoice_number,
        status: a.invoice_status,
        total: (existing?.total ?? 0) + a.allocated_amount,
      })
    }
  }
  const invoices = Array.from(invoiceSet.entries())
  return (
    <div className="p-5 border-t space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 text-[12px] uppercase tracking-wider text-ink-500">
          <ExternalLink className="h-3.5 w-3.5" />
          <span>Procurement Chain</span>
        </div>
        <div className="text-[11px] text-ink-500">
          <span className="font-semibold text-ink-700">
            {txs.length}
          </span>{" "}
          transaksi · <span className="font-semibold text-ink-700">
            {invoices.length}
          </span>{" "}
          invoice ·{" "}
          <span className="font-mono font-semibold text-ink-900">
            {fmtIDR(d.total_paid)}
          </span>
        </div>
      </div>

      {/* TX list dgn drilldown ke invoice yg dibayar */}
      <div className="rounded border bg-surface divide-y">
        {txs.map((t) => (
          <div key={t.id} className="px-3 py-2 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <RouterLink
                  to={`/transactions/${t.id}`}
                  className="font-medium text-brand-700 hover:underline truncate inline-block"
                >
                  Tx #{t.id} ·{" "}
                  {t.description || t.party_name || "(tanpa deskripsi)"}
                </RouterLink>
                <div className="text-[11px] text-ink-500">
                  {t.tx_date && fmtDate(t.tx_date)} · {t.kind ?? t.type}{" "}
                  · {t.status}
                </div>
              </div>
              <span className="font-mono text-sm tabular-nums shrink-0">
                {fmtIDR(t.amount)}
              </span>
            </div>
            {/* Allocations: invoice yg dibayar oleh tx ini */}
            {t.allocations.length > 0 && (
              <div className="mt-1.5 pl-3 border-l-2 border-info-200 space-y-0.5">
                {t.allocations.map((a) => (
                  <div
                    key={a.allocation_id}
                    className="text-[11px] flex items-center justify-between gap-2"
                  >
                    <RouterLink
                      to={`/invoices/${a.invoice_id}`}
                      className="text-info-700 hover:underline inline-flex items-center gap-1 truncate"
                    >
                      <Receipt className="h-3 w-3 shrink-0" />
                      <span className="font-mono truncate">
                        {a.invoice_number ?? `Invoice #${a.invoice_id}`}
                      </span>
                      <span className="text-ink-400 normal-case">
                        ({a.invoice_status})
                      </span>
                    </RouterLink>
                    <span className="font-mono tabular-nums text-ink-600 shrink-0">
                      {fmtIDR(a.allocated_amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}


function Field({
  label,
  icon: Icon,
  value,
}: {
  label: string
  icon?: React.ComponentType<{ className?: string }>
  value: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-3 gap-3 px-5 py-3">
      <dt className="col-span-1 flex items-center gap-1.5 text-[12px] uppercase tracking-wider text-ink-500">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        <span>{label}</span>
      </dt>
      <dd className="col-span-2 text-sm">{value}</dd>
    </div>
  )
}


/**
 * Panel AI-2: generate cover letter PO. Audit 2026-05-23.
 * Click -> call /ai/generate-po-cover -> tampil preview + copy button.
 */
function POCoverGeneratorPanel({ poId }: { poId: number }) {
  const generate = useGeneratePOCover()
  const [text, setText] = useState<string>("")
  const handleClick = async () => {
    try {
      const result = await generate.mutateAsync({ po_id: poId, tone: "formal" })
      setText(result.text)
      toast.success(
        `Surat pengantar dibuat (${result._meta.cached ? "cache" : result._meta.model})`,
      )
    } catch (err) {
      toast.error("Gagal generate", { description: apiErrorMessage(err) })
    }
  }
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success("Disalin ke clipboard")
    } catch {
      toast.error("Gagal copy ke clipboard")
    }
  }
  return (
    <div className="rounded-md border bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-brand-600" />
          Surat Pengantar (AI)
        </div>
        <Button
          type="button"
          variant={text ? "outline" : "primary"}
          size="sm"
          onClick={handleClick}
          disabled={generate.isPending}
          className="gap-1.5"
        >
          {generate.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {text ? "Generate Ulang" : "Generate"}
        </Button>
      </div>
      {text && (
        <div className="mt-3 flex flex-col gap-2">
          <pre className="whitespace-pre-wrap rounded border bg-ink-50 p-3 text-sm text-ink-800">
            {text}
          </pre>
          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              className="gap-1.5"
            >
              <Copy className="h-3.5 w-3.5" />
              Salin
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
