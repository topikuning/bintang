import { fmtIDR } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { TxnType } from "@/types/api"

interface AmountDisplayProps {
  /** Nilai bisa string (dari API Decimal) atau number. */
  value: number | string | null | undefined
  /** Kalau diisi, prefix tanda + atau − sesuai arah. */
  type?: TxnType
  /**
   * Tampilkan dalam warna sesuai sign:
   *  - true  (default): IN hijau, OUT merah, balance dgn `negativeRed`
   *  - false: warna ink-900 (utk tabel detail yg sudah pisah kolom Masuk/Keluar)
   */
  colored?: boolean
  /** Kalau true, nilai negatif (saldo minus) di-warna merah. */
  negativeRed?: boolean
  /** Ukuran. Default sm utk tabel, lg utk summary card / card mobile. */
  size?: "sm" | "md" | "lg" | "xl"
  /** Class tambahan utk tweak layout. */
  className?: string
  /** Jangan tampilkan tanda + utk IN. Default false (tampilkan +). */
  hideSignForIn?: boolean
}

/**
 * Display nominal Rupiah dgn tabular-nums dan default coloring sign-aware:
 * - IN  -> hijau (success-700) + prefix optional "+"
 * - OUT -> merah  (danger-700)  + prefix "−" (en-dash)
 * - Tanpa type -> ink-900, kecuali negatif & negativeRed=true
 *
 * Default `colored=true` -- penting utk app keuangan supaya scan cepat.
 */
export function AmountDisplay({
  value,
  type,
  colored = true,
  negativeRed,
  size = "sm",
  className,
  hideSignForIn,
}: AmountDisplayProps) {
  const n = typeof value === "string" ? Number(value) : (value ?? 0)

  let display: string
  if (type === "OUT") {
    display = fmtIDR(-Math.abs(n))
  } else if (type === "IN") {
    display = hideSignForIn ? fmtIDR(Math.abs(n)) : fmtIDR(Math.abs(n), { sign: "always" })
  } else {
    display = fmtIDR(n)
  }

  const sizeClasses = {
    sm: "text-sm",
    md: "text-base",
    lg: "text-lg",
    xl: "text-2xl",
  }[size]

  const tone = colored
    ? type === "IN"
      ? "text-success-700"
      : type === "OUT"
        ? "text-danger-700"
        : negativeRed && n < 0
          ? "text-danger-700"
          : "text-ink-900"
    : "text-ink-900"

  return (
    <span
      data-num
      className={cn(
        "font-mono font-semibold whitespace-nowrap",
        sizeClasses,
        tone,
        className,
      )}
    >
      {display}
    </span>
  )
}
