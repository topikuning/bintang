import { Calendar, FileText, Hash, ShoppingCart, User } from "lucide-react"
import type { Project, PurchaseOrder } from "@/types/api"
import { fmtDate, fmtDateTime, fmtIDR } from "@/lib/format"
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
