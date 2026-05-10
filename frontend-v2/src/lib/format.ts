/**
 * Format helpers untuk app keuangan Indonesia.
 *
 * - IDR pakai titik ribuan, koma desimal (locale id-ID)
 * - Tanggal pakai DD MMM YYYY (Jan/Feb/Mar/.../Mei/.../Agu/Sep/Okt/Nov/Des)
 * - Negatif pakai en-dash (−) lebih berat visual daripada hyphen-minus
 */

const NBSP = " "
const ENDASH = "–"

export interface FmtIDROptions {
  decimal?: number
  /** "auto" (default): tampilkan minus utk negatif. "always": +Rp utk positif. "parens": (Rp X). */
  sign?: "auto" | "always" | "parens"
}

export function fmtIDR(
  value: number | string | null | undefined,
  opts: FmtIDROptions = {}
): string {
  const n = typeof value === "string" ? Number(value) : (value ?? 0)
  if (!Number.isFinite(n)) return "Rp 0"
  const decimal = opts.decimal ?? 0
  const abs = Math.abs(n)
  const formatted = abs.toLocaleString("id-ID", {
    minimumFractionDigits: decimal,
    maximumFractionDigits: decimal,
  })
  if (n < 0) {
    if (opts.sign === "parens") return `(Rp${NBSP}${formatted})`
    return `${ENDASH}Rp${NBSP}${formatted}`
  }
  if (opts.sign === "always" && n > 0) return `+Rp${NBSP}${formatted}`
  return `Rp${NBSP}${formatted}`
}

/** Compact: Rp 1,25 M / Rp 25,3 jt / Rp 500 rb -- utk summary card mobile. */
export function fmtCompact(value: number | string | null | undefined): string {
  const n = typeof value === "string" ? Number(value) : (value ?? 0)
  if (!Number.isFinite(n)) return "Rp 0"
  const abs = Math.abs(n)
  const sign = n < 0 ? ENDASH : ""
  if (abs >= 1_000_000_000)
    return `${sign}Rp${NBSP}${(abs / 1e9).toFixed(2).replace(".", ",")}${NBSP}M`
  if (abs >= 1_000_000)
    return `${sign}Rp${NBSP}${(abs / 1e6).toFixed(1).replace(".", ",")}${NBSP}jt`
  if (abs >= 1_000)
    return `${sign}Rp${NBSP}${Math.round(abs / 1e3)}rb`
  return fmtIDR(n)
}

export function fmtPct(value: number | null | undefined, decimal = 1): string {
  if (value == null || !Number.isFinite(value)) return "0%"
  return `${(value * 100).toFixed(decimal).replace(".", ",")}%`
}

const BULAN_SHORT = [
  "", "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
]
const BULAN_FULL = [
  "", "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
]

export function fmtDate(
  d: Date | string | null | undefined,
  opts: { fullMonth?: boolean } = {}
): string {
  if (!d) return "-"
  const x = typeof d === "string" ? new Date(d) : d
  if (Number.isNaN(x.getTime())) return "-"
  const months = opts.fullMonth ? BULAN_FULL : BULAN_SHORT
  return `${String(x.getDate()).padStart(2, "0")} ${months[x.getMonth() + 1]} ${x.getFullYear()}`
}

export function fmtDateTime(
  d: Date | string | null | undefined,
  opts: { fullMonth?: boolean } = {}
): string {
  if (!d) return "-"
  const x = typeof d === "string" ? new Date(d) : d
  if (Number.isNaN(x.getTime())) return "-"
  const date = fmtDate(x, opts)
  const hh = String(x.getHours()).padStart(2, "0")
  const mm = String(x.getMinutes()).padStart(2, "0")
  return `${date} ${hh}:${mm}`
}

/** Tanggal -> "ISO yyyy-mm-dd" untuk dikirim ke API. */
export function toApiDate(d: Date | string | null | undefined): string | null {
  if (!d) return null
  const x = typeof d === "string" ? new Date(d) : d
  if (Number.isNaN(x.getTime())) return null
  const y = x.getFullYear()
  const m = String(x.getMonth() + 1).padStart(2, "0")
  const dd = String(x.getDate()).padStart(2, "0")
  return `${y}-${m}-${dd}`
}

/** Relative time singkat: "baru saja", "5 mnt lalu", "2 jam lalu", "kemarin", "3 hari lalu". */
export function fmtRelative(d: Date | string | null | undefined): string {
  if (!d) return "-"
  const x = typeof d === "string" ? new Date(d) : d
  if (Number.isNaN(x.getTime())) return "-"
  const diffMs = Date.now() - x.getTime()
  const diffMin = Math.round(diffMs / 60_000)
  if (diffMin < 1) return "baru saja"
  if (diffMin < 60) return `${diffMin} mnt lalu`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr} jam lalu`
  const diffDay = Math.round(diffHr / 24)
  if (diffDay === 1) return "kemarin"
  if (diffDay < 7) return `${diffDay} hari lalu`
  return fmtDate(x)
}
