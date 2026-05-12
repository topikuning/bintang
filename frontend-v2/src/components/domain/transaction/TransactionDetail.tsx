import {
  Calendar,
  Coins,
  CreditCard,
  FileText,
  Hash,
  ListTree,
  Paperclip,
  Receipt,
  User as UserIcon,
  Wallet,
} from "lucide-react"
import type { Project, Transaction, TxnKind } from "@/types/api"
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

const KIND_LABEL: Record<TxnKind, { label: string; hint: string }> = {
  INVOICE_PAYMENT: {
    label: "Bayar Invoice",
    hint: "Pembayaran ke vendor lewat invoice/PO.",
  },
  CASH_ADVANCE: {
    label: "Dana Operasional",
    hint: "Kas bon ke staff internal. Perlu pertanggungjawaban.",
  },
  DIRECT_EXPENSE: {
    label: "Beban Langsung",
    hint: "Pengeluaran tanpa invoice (struk/kwitansi). Rincian per item di bawah.",
  },
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
  const kindMeta = t.kind ? KIND_LABEL[t.kind] : null
  const isDirect = t.kind === "DIRECT_EXPENSE"
  const isAdvance = t.kind === "CASH_ADVANCE"

  return (
    <div className="flex flex-col">
      {/* Header amount */}
      <div className="flex flex-col gap-2 p-5 bg-surface-muted border-b">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
            {isIn ? "Pemasukan" : "Pengeluaran"}
          </span>
          <StatusBadge domain="transaction" status={t.status} />
          {/* Badge kind utk OUT: jelas jenis pengeluarannya. */}
          {!isIn && kindMeta && (
            <span
              className={
                "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider " +
                (isDirect
                  ? "bg-info-100 text-info-800"
                  : isAdvance
                    ? "bg-warning-100 text-warning-800"
                    : "bg-ink-100 text-ink-700")
              }
              title={kindMeta.hint}
            >
              {isDirect ? (
                <Receipt className="h-3 w-3" />
              ) : isAdvance ? (
                <Wallet className="h-3 w-3" />
              ) : (
                <Coins className="h-3 w-3" />
              )}
              {kindMeta.label}
            </span>
          )}
          {t.kind === "CASH_ADVANCE" && t.settlement_status && (
            <span
              className={
                "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider " +
                (t.settlement_status === "SETTLED"
                  ? "bg-success-100 text-success-800"
                  : "bg-warning-100 text-warning-800")
              }
            >
              {t.settlement_status === "SETTLED" ? "Settled" : "Outstanding"}
            </span>
          )}
          <span className="ml-auto rounded bg-ink-100 px-2 py-0.5 text-[11px] font-mono text-ink-700 tabular-nums">
            #{t.id}
          </span>
        </div>
        <AmountDisplay value={t.amount} type={t.type} colored size="lg" className="text-2xl" />
        <div className="text-[12px] text-ink-500">{fmtDate(t.tx_date, { fullMonth: true })}</div>
      </div>

      {/* Body fields */}
      <dl className="divide-y">
        {/* CASH_ADVANCE: penerima jadi info utama, sembunyikan party_name */}
        {isAdvance ? (
          <Field
            label="Penerima Dana"
            icon={UserIcon}
            value={t.recipient_display || t.recipient_name || "—"}
          />
        ) : (
          <Field label="Pihak" icon={UserIcon} value={t.party_name || "—"} />
        )}
        <Field label="Proyek" value={project ? `${project.name} (${project.code})` : "—"} />
        {/* Kategori hanya relevant utk INVOICE_PAYMENT (kategori sebagai
            ringkasan keseluruhan); utk DIRECT_EXPENSE rincian ada di items. */}
        {!isDirect && (
          <Field label="Kategori" value={category?.name || "—"} />
        )}
        <Field label="Deskripsi" icon={FileText} value={t.description || "—"} />
        <Field
          label="Metode Pembayaran"
          icon={CreditCard}
          value={PAYMENT_LABEL[t.payment_method] ?? t.payment_method}
        />
        <Field label="No. Referensi" icon={Hash} value={t.reference_no || "—"} mono />
        {t.parent_advance_tx_id && (
          <Field
            label="Top-up dari"
            icon={Coins}
            value={`Dana Ops #${t.parent_advance_tx_id}`}
          />
        )}
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

      {/* Rincian items utk DIRECT_EXPENSE -- breakdown per kategori */}
      {isDirect && (
        <>
          <Separator />
          <ItemsSection items={t.items ?? []} />
        </>
      )}

      {/* Total breakdown */}
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


function ItemsSection({
  items,
}: {
  items: NonNullable<Transaction["items"]>
}) {
  if (items.length === 0) {
    return (
      <div className="p-5 space-y-2">
        <div className="flex items-center gap-2 text-[12px] uppercase tracking-wider text-ink-500">
          <ListTree className="h-3.5 w-3.5" />
          <span>Rincian Pengeluaran</span>
        </div>
        <p className="text-[12px] text-ink-500 italic">
          Tidak ada rincian item.
        </p>
      </div>
    )
  }
  const total = items.reduce(
    (acc, it) => acc + Number(it.amount ?? 0),
    0,
  )
  return (
    <div className="p-5 space-y-2">
      <div className="flex items-center gap-2 text-[12px] uppercase tracking-wider text-ink-500">
        <ListTree className="h-3.5 w-3.5" />
        <span>Rincian Pengeluaran</span>
        <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] font-semibold text-ink-700 normal-case">
          {items.length}
        </span>
      </div>
      <ul className="divide-y rounded border bg-surface">
        {items.map((it) => (
          <li
            key={it.id}
            className="flex items-start gap-2 px-3 py-2 text-sm"
          >
            <div className="flex-1 min-w-0">
              <div className="truncate font-medium text-ink-900">
                {it.description}
              </div>
              {it.category_id != null && (
                <div className="text-[11px] text-ink-500">
                  Kategori #{it.category_id}
                </div>
              )}
            </div>
            <span className="font-mono text-sm tabular-nums shrink-0">
              {fmtIDR(Number(it.amount ?? 0))}
            </span>
          </li>
        ))}
        <li className="flex justify-between px-3 py-2 bg-surface-muted text-[12px] font-semibold">
          <span>Total rincian</span>
          <span className="font-mono tabular-nums">{fmtIDR(total)}</span>
        </li>
      </ul>
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
