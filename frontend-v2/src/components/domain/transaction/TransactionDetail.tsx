import { Calendar, CreditCard, FileText, Hash, User } from "lucide-react"
import type { Project, Transaction } from "@/types/api"
import type { Category } from "@/hooks/useCategories"
import { fmtDate, fmtDateTime, fmtIDR } from "@/lib/format"
import { AmountDisplay } from "@/components/domain/shared/AmountDisplay"
import { StatusBadge } from "@/components/domain/shared/StatusBadge"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"

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
