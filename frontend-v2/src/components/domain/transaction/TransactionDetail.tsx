import { Calendar, CreditCard, FileText, Hash, Paperclip, User } from "lucide-react"
import type { Project, Transaction } from "@/types/api"
import type { Category } from "@/hooks/useCategories"
import {
  useDeleteTransactionAttachment,
  useLinkTransactionAttachment,
  useUploadTransactionAttachment,
} from "@/hooks/useTransactionAttachments"
import { useAuthStore } from "@/store/auth"
import { apiErrorMessage } from "@/lib/api"
import { fmtDate, fmtDateTime, fmtIDR } from "@/lib/format"
import { AmountDisplay } from "@/components/domain/shared/AmountDisplay"
import { AttachmentList } from "@/components/domain/shared/AttachmentList"
import { StatusBadge } from "@/components/domain/shared/StatusBadge"
import { AttachmentUploader } from "@/components/forms/AttachmentUploader"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "@/components/ui/sonner"

interface TransactionDetailProps {
  transaction: Transaction | null | undefined
  isLoading?: boolean
  project?: Project | null
  category?: Category | null
}

const PAYMENT_LABEL: Record<string, string> = {
  TRANSFER: "Transfer Bank",
  CASH: "Tunai",
  QRIS: "QRIS",
  OTHER: "Lainnya",
}

export function TransactionDetail({
  transaction,
  isLoading,
  project,
  category,
}: TransactionDetailProps) {
  if (isLoading || !transaction) {
    return (
      <div className="flex flex-col gap-3 p-5">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  const t = transaction
  const isIn = t.type === "IN"

  return (
    <div className="flex flex-col">
      {/* Header amount */}
      <div className="flex flex-col gap-2 p-5 bg-surface-muted border-b">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
            {isIn ? "Pemasukan" : "Pengeluaran"}
          </span>
          <StatusBadge domain="transaction" status={t.status} />
        </div>
        <AmountDisplay value={t.amount} type={t.type} colored size="lg" className="text-2xl" />
        <div className="text-[12px] text-ink-500">{fmtDate(t.tx_date, { fullMonth: true })}</div>
      </div>

      {/* Body fields */}
      <dl className="divide-y">
        <Field label="Pihak" icon={User} value={t.party_name || "—"} />
        <Field label="Proyek" value={project ? `${project.name} (${project.code})` : "—"} />
        <Field label="Kategori" value={category?.name || "—"} />
        <Field label="Deskripsi" icon={FileText} value={t.description || "—"} />
        <Field
          label="Metode Pembayaran"
          icon={CreditCard}
          value={PAYMENT_LABEL[t.payment_method] ?? t.payment_method}
        />
        <Field label="No. Referensi" icon={Hash} value={t.reference_no || "—"} mono />
        <Field
          label="Dibuat pada"
          icon={Calendar}
          value={fmtDateTime(t.created_at)}
        />
        {t.verified_at && (
          <Field
            label="Diverifikasi pada"
            value={fmtDateTime(t.verified_at)}
          />
        )}
      </dl>

      {/* Total breakdown — placeholder utk masa depan (allocations dll) */}
      <Separator />
      <div className="p-5 text-[13px] text-ink-500">
        Total: <span className="font-mono font-semibold text-ink-900">{fmtIDR(t.amount)}</span>
      </div>

      {/* Lampiran / bukti */}
      <Separator />
      <AttachmentSection transaction={t} />
    </div>
  )
}

/**
 * Section lampiran terpisah supaya state delete + permission gating
 * tidak mempengaruhi render field info di atas.
 */
function AttachmentSection({ transaction }: { transaction: Transaction }) {
  const role = useAuthStore((s) => s.user?.role)
  const isSuperAdmin = role === "SUPERADMIN"
  const isReadOnly = role === "EXECUTIVE"

  // Pakai rule yang sama dgn modify transaksi: VERIFIED -> SUPERADMIN only
  // utk attach/hapus bukti (audit trail kuat).
  const lockedByVerified = transaction.status === "VERIFIED" && !isSuperAdmin
  const canModifyAttachments = !isReadOnly && !lockedByVerified

  const upload = useUploadTransactionAttachment()
  const link = useLinkTransactionAttachment()
  const del = useDeleteTransactionAttachment()
  const attachments = transaction.attachments ?? []

  const handleDelete = async (attId: number) => {
    try {
      await del.mutateAsync({ transactionId: transaction.id, attachmentId: attId })
      toast.success("Lampiran dihapus")
    } catch (err) {
      toast.error("Gagal menghapus lampiran", { description: apiErrorMessage(err) })
    }
  }

  return (
    <div className="p-5 space-y-3">
      <div className="flex items-center gap-2 text-[12px] uppercase tracking-wider text-ink-500">
        <Paperclip className="h-3.5 w-3.5" />
        <span>Lampiran / Bukti</span>
        {attachments.length > 0 && (
          <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] font-semibold text-ink-700 normal-case">
            {attachments.length}
          </span>
        )}
      </div>

      <AttachmentList
        attachments={attachments}
        canDelete={canModifyAttachments}
        onDelete={(a) => handleDelete(a.id)}
        deletingId={del.isPending ? del.variables?.attachmentId ?? null : null}
        emptyMessage={
          canModifyAttachments
            ? "Belum ada bukti. Tambah file/link di bawah."
            : "Belum ada bukti."
        }
      />

      {canModifyAttachments && (
        <AttachmentUploader
          uploadFile={(file, onProgress) =>
            upload.mutateAsync({ transactionId: transaction.id, file, onProgress }).then(() => undefined)
          }
          linkExternal={(url, label) =>
            link.mutateAsync({ transactionId: transaction.id, url, label }).then(() => undefined)
          }
          isLinking={link.isPending}
        />
      )}

      {lockedByVerified && (
        <p className="text-[11px] text-ink-500">
          Transaksi sudah tervalidasi. Hanya SUPERADMIN yang dapat
          memodifikasi bukti.
        </p>
      )}
    </div>
  )
}

function Field({
  label,
  icon: Icon,
  value,
  mono,
}: {
  label: string
  icon?: React.ComponentType<{ className?: string }>
  value: React.ReactNode
  mono?: boolean
}) {
  return (
    <div className="grid grid-cols-3 gap-3 px-5 py-3">
      <dt className="col-span-1 flex items-center gap-1.5 text-[12px] uppercase tracking-wider text-ink-500">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        <span>{label}</span>
      </dt>
      <dd className={mono ? "col-span-2 text-sm font-mono" : "col-span-2 text-sm"}>{value}</dd>
    </div>
  )
}
