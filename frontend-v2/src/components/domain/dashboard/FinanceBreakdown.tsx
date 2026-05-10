import type { ProjectFinance } from "@/types/dashboard"
import { fmtIDR } from "@/lib/format"
import { cn } from "@/lib/utils"

interface FinanceBreakdownProps {
  finance: ProjectFinance
  className?: string
}

/**
 * Rincian Keuangan kontrak proyek -- DPP, PPn, PPh, Nilai Cair,
 * Marketing, Profit Saat Ini & Profit Proyeksi. Mirror frontend lama.
 */
export function FinanceBreakdown({ finance, className }: FinanceBreakdownProps) {
  if (finance.nilai_kontrak <= 0) return null

  const profitNowNeg = finance.profit_now < 0
  const profitProjNeg = finance.profit_proj < 0

  return (
    <div className={cn("rounded-md border bg-surface p-4", className)}>
      <div className="mb-2 flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-ink-900">Rincian Keuangan</h3>
        <span className="text-[11px] text-ink-500">
          PPn {finance.ppn_pct}% · PPh {finance.pph_pct}% · Mkt {finance.marketing_pct}%
        </span>
      </div>
      <ul className="text-sm divide-y divide-ink-100">
        <Row label="Nilai Kontrak" value={finance.nilai_kontrak} bold />
        <Row label="DPP" value={finance.dpp} muted />
        <Row label={`PPn (${finance.ppn_pct}%)`} value={-finance.ppn} negative />
        <Row label={`PPh (${finance.pph_pct}%)`} value={-finance.pph} negative />
        <Row label="Nilai Cair" value={finance.nilai_cair} highlight="success" bold />
        <Row label={`Marketing (${finance.marketing_pct}%)`} value={-finance.marketing} negative />
        <Row label="Biaya Aktual (realisasi)" value={-finance.biaya_aktual} negative />
        <Row label="Biaya Proyeksi (target)" value={-finance.biaya_proyeksi} negative muted />
      </ul>

      <div className="mt-2 grid gap-1.5">
        <ProfitRow
          label="Profit Saat Ini"
          value={finance.profit_now}
          variant={profitNowNeg ? "danger" : "neutral"}
        />
        <ProfitRow
          label="Profit Proyeksi"
          value={finance.profit_proj}
          variant={profitProjNeg ? "danger" : "success"}
        />
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-ink-500">
        DPP = Nilai Kontrak ÷ (1 + PPn%). Profit Saat Ini pakai realisasi
        pengeluaran; Profit Proyeksi pakai target pengeluaran (budget).
        Persentase pajak & marketing bisa diubah lewat menu Edit proyek.
      </p>
    </div>
  )
}

function Row({
  label,
  value,
  bold,
  muted,
  negative,
  highlight,
}: {
  label: string
  value: number
  bold?: boolean
  muted?: boolean
  negative?: boolean
  highlight?: "success"
}) {
  const display = negative
    ? `− ${fmtIDR(Math.abs(value))}`
    : fmtIDR(value)
  return (
    <li
      className={cn(
        "flex items-center justify-between gap-3 py-1.5",
        highlight === "success" && "-mx-2 my-1 rounded bg-success-50 px-2",
      )}
    >
      <span className={cn("text-ink-600", muted && "text-ink-500", highlight && "font-semibold text-success-800")}>
        {label}
      </span>
      <span
        data-num
        className={cn(
          "font-mono [font-variant-numeric:tabular-nums]",
          bold && "font-semibold",
          highlight === "success" && "font-bold text-success-800",
          negative && "text-danger-700",
          !negative && !highlight && "text-ink-900",
        )}
      >
        {display}
      </span>
    </li>
  )
}

function ProfitRow({
  label,
  value,
  variant,
}: {
  label: string
  value: number
  variant: "neutral" | "success" | "danger"
}) {
  const cls = {
    neutral: "bg-ink-100 text-ink-900",
    success: "bg-success-50 text-success-800",
    danger: "bg-danger-50 text-danger-700",
  }[variant]
  const display = value < 0 ? `− ${fmtIDR(Math.abs(value))}` : fmtIDR(value)
  return (
    <div className={cn("flex items-center justify-between rounded-md px-3 py-2", cls)}>
      <span className="text-sm font-semibold">{label}</span>
      <span
        data-num
        className="font-mono text-sm font-bold [font-variant-numeric:tabular-nums]"
      >
        {display}
      </span>
    </div>
  )
}
