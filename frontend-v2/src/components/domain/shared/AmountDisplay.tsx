import { fmtIDR } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { TxnType } from "@/types/api"

interface AmountDisplayProps {
  /** Nilai bisa string (dari API Decimal) atau number. */
  value: number | string | null | undefined
  /** Kalau diisi, prefix tanda + atau − sesuai arah. */
  type?: TxnType
  /** Tampilkan dlm warna sesuai sign (success/danger). Default false utk tabel detail. */
  colored?: boolean
  /** Ukuran. Default sm utk tabel, lg utk summary card / card mobile. */
  size?: "sm" | "md" | "lg"
  /** Class tambahan utk tweak layout. */
  className?: string
}

export function AmountDisplay({
  value,
  type,
  colored = false,
  size = "sm",
  className,
}: AmountDisplayProps) {
  const n = typeof value === "string" ? Number(value) : (value ?? 0)
  // Untuk tabel cashflow, kolom Masuk dan Keluar dipisah, jadi kita tampilkan
  // angka apa adanya. Kalau "type" diberikan dan kita ingin perlakuan
  // signed (mis. di card), prefix +/- berdasar IN/OUT.
  let display: string
  if (type === "OUT") {
    display = fmtIDR(-Math.abs(n))
  } else if (type === "IN") {
    display = fmtIDR(Math.abs(n))
  } else {
    display = fmtIDR(n)
  }

  const sizeClasses = {
    sm: "text-sm",
    md: "text-base",
    lg: "text-lg",
  }[size]

  return (
    <span
      data-num
      className={cn(
        "font-mono font-semibold",
        sizeClasses,
        colored && type === "OUT" && "text-danger-700",
        colored && type === "IN" && "text-success-700",
        className,
      )}
    >
      {display}
    </span>
  )
}
