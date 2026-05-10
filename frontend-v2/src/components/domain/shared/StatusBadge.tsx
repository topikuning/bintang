import { Badge } from "@/components/ui/badge"
import type { InvoiceStatus, POStatus, TxnStatus } from "@/types/api"

type AnyStatus = TxnStatus | InvoiceStatus | POStatus

interface BadgeMeta {
  tone: "success" | "warning" | "danger" | "info" | "neutral"
  label: string
}

const TXN: Record<TxnStatus, BadgeMeta> = {
  DRAFT:     { tone: "info",    label: "Draft" },
  SUBMITTED: { tone: "warning", label: "Menunggu" },
  VERIFIED:  { tone: "success", label: "Tervalidasi" },
  REJECTED:  { tone: "danger",  label: "Ditolak" },
  CANCELLED: { tone: "neutral", label: "Dibatalkan" },
}

const INVOICE: Record<InvoiceStatus, BadgeMeta> = {
  DRAFT:          { tone: "info",    label: "Draft" },
  ISSUED:         { tone: "warning", label: "Belum lunas" },
  PARTIALLY_PAID: { tone: "warning", label: "Sebagian" },
  PAID:           { tone: "success", label: "Lunas" },
  OVERDUE:        { tone: "danger",  label: "Jatuh tempo" },
  CANCELLED:      { tone: "neutral", label: "Dibatalkan" },
}

const PO: Record<POStatus, BadgeMeta> = {
  DRAFT:     { tone: "info",    label: "Draft" },
  ISSUED:    { tone: "warning", label: "Diajukan" },
  APPROVED:  { tone: "success", label: "Disetujui" },
  CANCELLED: { tone: "neutral", label: "Dibatalkan" },
}

interface StatusBadgeProps {
  domain: "transaction" | "invoice" | "po"
  status: AnyStatus
  className?: string
}

export function StatusBadge({ domain, status, className }: StatusBadgeProps) {
  const meta =
    domain === "transaction"
      ? TXN[status as TxnStatus]
      : domain === "invoice"
        ? INVOICE[status as InvoiceStatus]
        : PO[status as POStatus]

  // Defensive fallback kalau API balikin status enum yg belum kita kenal.
  if (!meta) {
    return <Badge tone="neutral" className={className}>{String(status)}</Badge>
  }

  return (
    <Badge tone={meta.tone} className={className}>
      {meta.label}
    </Badge>
  )
}
