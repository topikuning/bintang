import type { ProjectFinance } from "@/types/dashboard"
import { fmtIDR } from "@/lib/format"
import { cn } from "@/lib/utils"

interface FinanceBreakdownProps {
  finance: ProjectFinance
  className?: string
}

/**
 * Rincian Keuangan kontrak proyek.
 *
 * Struktur:
 *   1. Header: Nilai Kontrak -> tax -> Nilai Cair (highlighted).
 *   2. Marketing breakdown (budget / realisasi / sisa atau overspend).
 *      Sisa budget = uncommitted → masuk profit (transparency).
 *   3. Biaya Aktual + Biaya Proyeksi.
 *   4. Profit Saat Ini -- HERO (big, color-coded vs target).
 *   5. Profit Proyeksi -- secondary, as target reference.
 *
 * Audit 2026-05-23 user req:
 * - Profit Saat Ini di-highlight prominent (bukan profit proyeksi).
 * - Warna berdasar performance vs target.
 * - Sisa budget marketing ditampilkan eksplisit di rincian (bukan cuma
 *   di card terpisah) -- 'masuk profit' supaya jelas dimana savings-nya.
 */
export function FinanceBreakdown({ finance, className }: FinanceBreakdownProps) {
  if (finance.nilai_kontrak <= 0) return null

  const budget = finance.marketing_budget ?? finance.marketing
  const aktual = finance.marketing_aktual ?? 0
  const mktSisa = Math.max(0, budget - aktual)
  const mktOverspend = Math.max(0, aktual - budget)
  const usedPct = budget > 0 ? (aktual / budget) * 100 : 0

  return (
    <div className={cn("rounded-md border bg-surface p-4", className)}>
      <div className="mb-2 flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-ink-900">Rincian Keuangan</h3>
        <span className="text-[11px] text-ink-500">
          PPn {finance.ppn_pct}% · PPh {finance.pph_pct}% · Mkt {finance.marketing_pct}%
        </span>
      </div>

      {/* Section 1: Kontrak -> tax -> Nilai Cair */}
      <ul className="text-sm divide-y divide-ink-100">
        <Row label="Nilai Kontrak" value={finance.nilai_kontrak} bold />
        <Row label="DPP" value={finance.dpp} muted />
        <Row label={`PPn (${finance.ppn_pct}%)`} value={-finance.ppn} negative />
        <Row label={`PPh (${finance.pph_pct}%)`} value={-finance.pph} negative />
        <Row label="Nilai Cair" value={finance.nilai_cair} highlight="success" bold />
      </ul>

      {/* Section 2: Marketing breakdown */}
      {(budget > 0 || aktual > 0) && (
        <div className="mt-3 rounded-md border bg-ink-50/60 p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-[12px] font-semibold uppercase tracking-wide text-ink-700">
              Marketing ({finance.marketing_pct}%)
            </span>
            {budget > 0 && (
              <span
                className={cn(
                  "text-[10px] font-semibold uppercase",
                  mktOverspend > 0 ? "text-danger-700" : usedPct > 90 ? "text-warning-700" : "text-ink-500",
                )}
              >
                {usedPct.toFixed(0)}% terpakai
              </span>
            )}
          </div>
          <ul className="text-sm divide-y divide-ink-200/60">
            <Row label="Budget" value={budget} muted hint="Reservasi formula" />
            <Row label="Realisasi" value={aktual} hint={aktual > 0 ? "TX OUT dgn kategori marketing" : "Belum ada tx marketing"} />
            {mktSisa > 0 && (
              <Row
                label="Sisa Budget (masuk profit)"
                value={mktSisa}
                highlight="success"
                hint="Budget belum dialokasi → kontribusi positif ke profit"
              />
            )}
            {mktOverspend > 0 && (
              <Row
                label="Overspend Marketing"
                value={-mktOverspend}
                negative
                hint="Realisasi melebihi budget → tergerus dr profit"
              />
            )}
          </ul>
        </div>
      )}

      {/* Section 3: Biaya */}
      <ul className="mt-3 text-sm divide-y divide-ink-100">
        <Row label="Biaya Aktual (realisasi)" value={-finance.biaya_aktual} negative />
        <Row label="Biaya Proyeksi (target)" value={-finance.biaya_proyeksi} negative muted />
      </ul>

      {/* Section 4: PROFIT SAAT INI -- hero, color-coded vs target */}
      <ProfitHero
        profitNow={finance.profit_now}
        profitProj={finance.profit_proj}
      />

      <p className="mt-3 text-[11px] leading-relaxed text-ink-500">
        DPP = Nilai Kontrak ÷ (1 + PPn%). Profit Saat Ini = Nilai Cair −
        Biaya Aktual (sudah include marketing aktual, tdk double-count).
        Sisa budget marketing yg tdk dialokasi otomatis tercermin di
        Profit Saat Ini. Tag kategori &apos;marketing&apos; di master
        Kategori agar TX OUT terkait ter-recognize.
      </p>
    </div>
  )
}


/**
 * Hero profit display: Profit Saat Ini big & color-coded berdasar
 * performance vs target (Profit Proyeksi). Profit Proyeksi muncul
 * di footer kecil sbg referensi target.
 */
function ProfitHero({
  profitNow,
  profitProj,
}: {
  profitNow: number
  profitProj: number
}) {
  // Variant logic:
  // - profit_now < 0 → DANGER
  // - profit_now >= profit_proj → SUCCESS (mengalahkan / sama dgn target)
  // - 0 <= profit_now < profit_proj → WARNING (positif tapi di bawah target)
  const variant: "danger" | "warning" | "success" =
    profitNow < 0
      ? "danger"
      : profitProj > 0 && profitNow < profitProj
      ? "warning"
      : "success"

  const styles = {
    danger: {
      bg: "bg-danger-50",
      border: "border-danger-300",
      text: "text-danger-800",
      badge: "bg-danger-100 text-danger-800",
      icon: "✕",
    },
    warning: {
      bg: "bg-warning-50",
      border: "border-warning-300",
      text: "text-warning-900",
      badge: "bg-warning-100 text-warning-800",
      icon: "!",
    },
    success: {
      bg: "bg-success-50",
      border: "border-success-300",
      text: "text-success-800",
      badge: "bg-success-100 text-success-800",
      icon: "✓",
    },
  }[variant]

  // Selisih vs target
  const diff = profitNow - profitProj
  const diffPct = profitProj !== 0 ? (diff / Math.abs(profitProj)) * 100 : 0
  const ahead = diff >= 0
  const statusText = (() => {
    if (profitNow < 0) return "Proyek rugi"
    if (profitProj <= 0) return "Target belum di-set"
    if (ahead) return `Di atas target (+${diffPct.toFixed(0)}%)`
    return `Di bawah target (${diffPct.toFixed(0)}%)`
  })()

  return (
    <div className="mt-4 space-y-2">
      {/* Hero card */}
      <div
        className={cn(
          "rounded-lg border-2 p-4",
          styles.bg,
          styles.border,
        )}
      >
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className={cn("text-[12px] font-semibold uppercase tracking-wider", styles.text)}>
            Profit Saat Ini
          </span>
          <span className={cn(
            "rounded px-2 py-0.5 text-[10px] font-bold uppercase",
            styles.badge,
          )}>
            <span className="mr-1">{styles.icon}</span>
            {statusText}
          </span>
        </div>
        <div
          data-num
          className={cn(
            "font-mono text-2xl font-bold [font-variant-numeric:tabular-nums] sm:text-3xl",
            styles.text,
          )}
        >
          {profitNow < 0 ? `− ${fmtIDR(Math.abs(profitNow))}` : fmtIDR(profitNow)}
        </div>
      </div>

      {/* Target reference (compact) */}
      <div className="flex items-center justify-between gap-3 px-1">
        <span className="text-[11px] text-ink-500">
          Target (Profit Proyeksi)
        </span>
        <span
          data-num
          className="font-mono text-[12px] text-ink-600 [font-variant-numeric:tabular-nums]"
        >
          {profitProj < 0 ? `− ${fmtIDR(Math.abs(profitProj))}` : fmtIDR(profitProj)}
        </span>
      </div>
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
  hint,
}: {
  label: string
  value: number
  bold?: boolean
  muted?: boolean
  negative?: boolean
  highlight?: "success"
  hint?: string
}) {
  const display = negative
    ? `− ${fmtIDR(Math.abs(value))}`
    : fmtIDR(value)
  return (
    <li
      className={cn(
        "flex items-start justify-between gap-3 py-1.5",
        highlight === "success" && "-mx-2 my-1 rounded bg-success-50 px-2",
      )}
    >
      <div className="flex flex-col min-w-0">
        <span className={cn(
          "text-ink-700",
          muted && "text-ink-500",
          highlight === "success" && "font-semibold text-success-800",
        )}>
          {label}
        </span>
        {hint && (
          <span className="text-[10px] text-ink-400">{hint}</span>
        )}
      </div>
      <span
        data-num
        className={cn(
          "font-mono [font-variant-numeric:tabular-nums] shrink-0",
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
