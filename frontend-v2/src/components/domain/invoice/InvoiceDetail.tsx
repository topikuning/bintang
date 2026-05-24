import { useState } from "react"
import { Link as RouterLink } from "react-router-dom"
import {
  Calendar,
  FileMinus,
  FilePlus,
  FileText,
  Hash,
  Loader2,
  Paperclip,
  Trash2,
  User,
} from "lucide-react"
import type { Invoice, InvoicePayment, Project } from "@/types/api"
import { useDeleteInvoiceAttachment } from "@/hooks/useInvoiceMutations"
import { useDeleteAllocation } from "@/hooks/useAllocations"
import { useAuthStore } from "@/store/auth"
import { apiErrorMessage } from "@/lib/api"
import { fmtDate, fmtDateTime, fmtIDR } from "@/lib/format"
import { AttachmentList } from "@/components/domain/shared/AttachmentList"
import { StatusBadge } from "@/components/domain/shared/StatusBadge"
import { AttachmentUploader } from "@/components/forms/AttachmentUploader"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "@/components/ui/sonner"
import { useUploadInvoiceAttachment, useLinkInvoiceAttachment } from "@/hooks/useInvoiceMutations"
import { cn } from "@/lib/utils"

interface InvoiceDetailProps {
  invoice: Invoice | null | undefined
  isLoading?: boolean
  project?: Project | null
}

export function InvoiceDetail({ invoice, isLoading, project }: InvoiceDetailProps) {
  if (isLoading || !invoice) {
    return (
      <div className="flex flex-col gap-3 p-5">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  const inv = invoice
  const isInbound = inv.type === "IN"
  const total = Number(inv.total || 0)
  const paid = Number(inv.paid_amount ?? 0)
  const remaining = Number(inv.outstanding_amount ?? inv.remaining ?? total - paid)
  const pct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex flex-col gap-2 p-5 bg-surface-muted border-b">
        <div className="flex items-center gap-2 flex-wrap">
          {isInbound ? (
            <FileMinus className="h-4 w-4 text-warning-600" />
          ) : (
            <FilePlus className="h-4 w-4 text-info-600" />
          )}
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
            {isInbound ? "Invoice Masuk (Hutang)" : "Invoice Keluar (Piutang)"}
          </span>
          <StatusBadge domain="invoice" status={inv.status} />
        </div>
        <div className="font-mono text-base font-semibold text-ink-900">{inv.number}</div>
        <div
          data-num
          className="font-mono text-2xl font-bold text-ink-900 [font-variant-numeric:tabular-nums]"
        >
          {fmtIDR(inv.total)}
        </div>
        <div className="text-[12px] text-ink-500">
          {fmtDate(inv.invoice_date, { fullMonth: true })}
          {inv.due_date && (
            <>
              {" "}
              · jatuh tempo{" "}
              <span
                className={
                  inv.status === "OVERDUE"
                    ? "font-semibold text-danger-700"
                    : "text-ink-700"
                }
              >
                {fmtDate(inv.due_date, { fullMonth: true })}
              </span>
            </>
          )}
        </div>

        {/* Progress pembayaran */}
        {(paid > 0 || inv.status === "PARTIALLY_PAID") && (
          <div className="mt-2 space-y-1.5">
            <div className="h-2 w-full overflow-hidden rounded-full bg-ink-100">
              <div
                className={
                  inv.status === "PAID" ? "h-full bg-success-500" : "h-full bg-warning-500"
                }
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex flex-wrap justify-between gap-2 text-[12px]">
              <span className="text-success-700 font-mono [font-variant-numeric:tabular-nums]">
                Terbayar {fmtIDR(paid)} ({pct}%)
              </span>
              <span
                className={cn(
                  "font-mono [font-variant-numeric:tabular-nums]",
                  remaining > 0 ? "text-warning-700" : "text-success-700",
                )}
              >
                {remaining > 0 ? `Sisa ${fmtIDR(remaining)}` : "Lunas"}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Field info */}
      <dl className="divide-y">
        <Field label="Pihak" icon={User} value={inv.party_name || "—"} />
        <Field
          label="Proyek"
          value={project ? `${project.name} (${project.code})` : "—"}
        />
        <Field label="Catatan" icon={FileText} value={inv.notes || "—"} />
        <Field label="Dibuat pada" icon={Calendar} value={fmtDateTime(inv.created_at)} />
      </dl>

      {/* Items breakdown */}
      {inv.items && inv.items.length > 0 && (
        <>
          <Separator />
          <div className="p-5">
            <div className="mb-2 flex items-center gap-1.5 text-[12px] uppercase tracking-wider text-ink-500">
              <Hash className="h-3.5 w-3.5" />
              <span>Rincian Item ({inv.items.length})</span>
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
                  {inv.items.map((it) => (
                    <tr key={it.id} className="border-b last:border-b-0">
                      <td className="px-3 py-2">{it.description}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-right font-mono text-[13px] [font-variant-numeric:tabular-nums]">
                        {it.quantity} {it.unit ?? ""}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-right font-mono text-[13px] [font-variant-numeric:tabular-nums]">
                        {fmtIDR(it.unit_price)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-right font-mono text-[13px] font-semibold [font-variant-numeric:tabular-nums]">
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
                    <td className="px-3 py-2 whitespace-nowrap text-right font-mono text-[13px] [font-variant-numeric:tabular-nums]">
                      {fmtIDR(inv.subtotal)}
                    </td>
                  </tr>
                  {Number(inv.tax) > 0 && (
                    <tr>
                      <td colSpan={3} className="px-3 py-2 text-right text-[12px] text-ink-600">
                        Pajak
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-right font-mono text-[13px] [font-variant-numeric:tabular-nums]">
                        {fmtIDR(inv.tax)}
                      </td>
                    </tr>
                  )}
                  <tr className="border-t-2 border-ink-300">
                    <td colSpan={3} className="px-3 py-2 text-right text-sm font-semibold">
                      TOTAL
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-right font-mono text-base font-bold [font-variant-numeric:tabular-nums]">
                      {fmtIDR(inv.total)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Pembayaran (allocations) */}
      {inv.payments && inv.payments.length > 0 && (
        <>
          <Separator />
          <PaymentsSection invoice={inv} payments={inv.payments} />
        </>
      )}

      {/* Lampiran */}
      <Separator />
      <AttachmentSection invoice={inv} />
    </div>
  )
}

function AttachmentSection({ invoice }: { invoice: Invoice }) {
  const role = useAuthStore((s) => s.user?.role)
  const isSuperAdmin = role === "SUPERADMIN"
  const isReadOnly = role === "EXECUTIVE"

  // Lock kalau sudah PAID/CANCELLED, kecuali SUPERADMIN -- konsisten dgn rule
  // VERIFIED transaksi: dokumen yg sudah closed tidak boleh diutak-atik.
  const lockedByStatus =
    (invoice.status === "PAID" || invoice.status === "CANCELLED") && !isSuperAdmin
  const canModify = !isReadOnly && !lockedByStatus

  const upload = useUploadInvoiceAttachment()
  const link = useLinkInvoiceAttachment()
  const del = useDeleteInvoiceAttachment()
  const attachments = invoice.attachments ?? []

  const handleDelete = async (attId: number) => {
    try {
      await del.mutateAsync({ invoiceId: invoice.id, attachmentId: attId })
      toast.success("Lampiran dihapus")
    } catch (err) {
      toast.error("Gagal menghapus lampiran", { description: apiErrorMessage(err) })
    }
  }

  return (
    <div className="p-5 space-y-3">
      <div className="flex items-center gap-2 text-[12px] uppercase tracking-wider text-ink-500">
        <Paperclip className="h-3.5 w-3.5" />
        <span>Lampiran</span>
        {attachments.length > 0 && (
          <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] font-semibold text-ink-700 normal-case">
            {attachments.length}
          </span>
        )}
      </div>

      <AttachmentList
        attachments={attachments}
        canDelete={canModify}
        onDelete={(a) => handleDelete(a.id)}
        deletingId={del.isPending ? del.variables?.attachmentId ?? null : null}
        emptyMessage={
          canModify ? "Belum ada lampiran. Tambah file/link di bawah." : "Belum ada lampiran."
        }
      />

      {canModify && (
        <AttachmentUploader
          uploadFile={(file, onProgress) =>
            upload.mutateAsync({ invoiceId: invoice.id, file, onProgress }).then(() => undefined)
          }
          linkExternal={(url, label) =>
            link.mutateAsync({ invoiceId: invoice.id, url, label }).then(() => undefined)
          }
          isLinking={link.isPending}
        />
      )}

      {lockedByStatus && (
        <p className="text-[11px] text-ink-500">
          Invoice sudah {invoice.status === "PAID" ? "lunas" : "dibatalkan"}.
          Hanya SUPERADMIN yang dapat memodifikasi lampiran.
        </p>
      )}
    </div>
  )
}

/**
 * List riwayat pembayaran (allocations) dgn tombol delete per row.
 * Permission delete: admin (require_admin) -- backend allocations
 * delete butuh akses ke project, frontend gating sederhana role.
 * Locked saat invoice PAID/CANCELLED kecuali SUPERADMIN.
 */
function PaymentsSection({
  invoice,
  payments,
}: {
  invoice: Invoice
  payments: InvoicePayment[]
}) {
  const role = useAuthStore((s) => s.user?.role)
  const isSuperAdmin = role === "SUPERADMIN"
  const isAdmin = role === "SUPERADMIN" || role === "CENTRAL_ADMIN"
  // Hapus alokasi: admin, atau SUPER kalau invoice locked PAID/CANCELLED
  const lockedByStatus =
    (invoice.status === "PAID" || invoice.status === "CANCELLED") && !isSuperAdmin
  const canDelete = isAdmin && !lockedByStatus

  const del = useDeleteAllocation()
  const [confirmId, setConfirmId] = useState<number | null>(null)

  const handleDelete = async () => {
    if (!confirmId) return
    try {
      await del.mutateAsync({
        allocationId: confirmId,
        invoiceId: invoice.id,
      })
      toast.success("Alokasi pembayaran dihapus", {
        description: "Sisa transaksi pembayaran kembali tersedia.",
      })
      setConfirmId(null)
    } catch (err) {
      toast.error("Gagal menghapus alokasi", { description: apiErrorMessage(err) })
    }
  }

  return (
    <div className="p-5 space-y-2">
      <div className="text-[12px] uppercase tracking-wider text-ink-500">
        Riwayat Pembayaran ({payments.length})
      </div>
      <ul className="flex flex-col divide-y rounded-md border bg-surface">
        {payments.map((pm) => (
          <li
            key={pm.allocation_id}
            className="grid grid-cols-[1fr_auto_auto] items-center gap-2 px-3 py-2"
          >
            <div className="min-w-0">
              {/* TX ID clickable -> bidirectional drilldown ke detail tx
                  pembayar. Sebelumnya teks plain, sulit di-trace. */}
              <RouterLink
                to={`/transactions/${pm.id}`}
                className="text-sm font-medium truncate text-brand-700 hover:underline block"
              >
                {pm.description || pm.reference_no || `Transaksi #${pm.id}`}
              </RouterLink>
              <div className="text-[11px] text-ink-500">
                <span className="font-mono">#{pm.id}</span> · {fmtDate(pm.tx_date)}{" "}
                · {pm.payment_method}
                {pm.reference_no && pm.description && ` · ${pm.reference_no}`}
              </div>
            </div>
            <span
              data-num
              className="font-mono text-sm font-semibold text-success-700 [font-variant-numeric:tabular-nums]"
            >
              {fmtIDR(pm.amount)}
            </span>
            {canDelete && (
              <button
                type="button"
                onClick={() => setConfirmId(pm.allocation_id)}
                className="flex h-8 w-8 items-center justify-center rounded text-ink-400 hover:bg-danger-50 hover:text-danger-700"
                aria-label="Hapus alokasi"
                disabled={del.isPending}
              >
                {del.isPending && del.variables?.allocationId === pm.allocation_id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </button>
            )}
          </li>
        ))}
      </ul>

      <Dialog open={confirmId != null} onOpenChange={(o) => !o && setConfirmId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hapus alokasi pembayaran?</DialogTitle>
            <DialogDescription>
              Sisa transaksi pembayaran akan kembali tersedia dan bisa
              dialokasikan ulang ke invoice lain. Status invoice akan
              dihitung ulang otomatis.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmId(null)}>
              Batal
            </Button>
            <Button variant="danger" onClick={handleDelete} disabled={del.isPending}>
              {del.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Hapus Alokasi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
