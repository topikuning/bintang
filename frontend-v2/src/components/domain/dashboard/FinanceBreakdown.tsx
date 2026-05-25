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
 * Struktur (audit 2026-05-23):
 *   1. Kontrak -> tax -> Nilai Cair.
 *   2. Marketing breakdown (budget vs realisasi).
 *   3. Biaya Aktual + Biaya Proyeksi.
 *   4. Komposisi Biaya (breakdown per peran akuntansi).
 *   5. Profit Saat Ini + Proyeksi (proporsional side-by-side).
 *   6. Handle profit minus dgn warning.
 */
export function FinanceBreakdown({ finance, className }: FinanceBreakdownProps) {
  if (finance.nilai_kontrak <= 0) return null

  const budget = finance.marketing_budget ?? finance.marketing
  const aktual = finance.marketing_aktual ?? 0
  const mktSisa = Math.max(0, budget - aktual)
  const mktOverspend = Math.max(0, aktual - budget)
  const usedPct = budget > 0 ? (aktual / budget) * 100 : 0
  const exp = finance.expense_breakdown

  return (
    <div className={cn("rounded-md border bg-surface p-4", className)}>
      <div className="mb-2 flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-ink-900">Rincian Keuangan</h3>
        <span className="text-[11px] text-ink-500">
          PPn {finance.ppn_pct}% · PPh {finance.pph_pct}% · Mkt {finance.marketing_pct}%
        </span>
      </div>

      {/* Section 1: Kontrak → Nilai Cair */}
      <ul className="text-sm divide-y divide-ink-100">
        <Row label="Nilai Kontrak" value={finance.nilai_kontrak} bold />
        <Row label="DPP" value={finance.dpp} muted />
        <Row label={`PPn (${finance.ppn_pct}%)`} value={-finance.ppn} negative />
        <Row label={`PPh (${finance.pph_pct}%)`} value={-finance.pph} negative />
        <Row label="Nilai Cair" value={finance.nilai_cair} highlight="success" bold />
      </ul>

      {/* Section 2: Marketing */}
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

      {/* Section 4: Komposisi Biaya (distribusi spending per peran). */}
      {exp && exp.total > 0 && (
        <ExpenseCompositionCard exp={exp} />
      )}

      {/* Section 5: Profit Saat Ini + Proyeksi (proporsional). */}
      <ProfitComparison
        profitNow={finance.profit_now}
        profitProj={finance.profit_proj}
        profitNet={finance.profit_net}
        profitSharePaid={finance.profit_share_paid}
      />

      <p className="mt-3 text-[11px] leading-relaxed text-ink-500">
        DPP = Nilai Kontrak ÷ (1 + PPn%). Profit Saat Ini = Nilai Cair −
        Biaya operasi (marketing aktual + denda + operasional). Bagi
        hasil TIDAK kurangi Profit Saat Ini -- itu distribusi, bukan
        biaya. Bagi hasil yg sudah dibayar ditampilkan terpisah +
        Profit Net (setelah distribusi). Tag peran akuntansi di
        master Kategori.
      </p>
    </div>
  )
}


/**
 * Komposisi Biaya Aktual: breakdown per peran akuntansi (marketing /
 * denda / bagi hasil / operating). Pure transparency -- math sudah
 * inside Biaya Aktual di atas. Audit 2026-05-23 user req.
 */
function ExpenseCompositionCard({
  exp,
}: {
  exp: NonNullable<ProjectFinance["expense_breakdown"]>
}) {
  const items = [
    { key: "operating",     label: "Operasional",        value: exp.operating,    color: "text-ink-700" },
    { key: "marketing",     label: "Marketing",          value: exp.marketing,    color: "text-info-700" },
    { key: "penalty",       label: "Denda",              value: exp.penalty,      color: "text-warning-700" },
    { key: "profit_share",  label: "Bagi Hasil",         value: exp.profit_share, color: "text-brand-700" },
  ]
  return (
    <div className="mt-3 rounded-md border bg-ink-50/60 p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-ink-700">
          Komposisi Biaya Aktual
        </span>
        <span className="text-[10px] text-ink-500">
          Pure breakdown — tdk re-hitung profit
        </span>
      </div>
      <ul className="text-sm divide-y divide-ink-200/60">
        {items.map((it) => {
          if (it.value <= 0) return null
          const pct = exp.total > 0 ? (it.value / exp.total) * 100 : 0
          return (
            <li
              key={it.key}
              className="flex items-center justify-between gap-3 py-1.5"
            >
              <div className="flex items-center gap-2">
                <span className={cn("text-[12px] font-medium", it.color)}>
                  {it.label}
                </span>
                <span className="text-[10px] text-ink-500">
                  {pct.toFixed(1)}%
                </span>
              </div>
              <span
                data-num
                className="font-mono font-semibold text-ink-900 [font-variant-numeric:tabular-nums]"
              >
                {fmtIDR(it.value)}
              </span>
            </li>
          )
        })}
        <li className="flex items-center justify-between gap-3 py-1.5 border-t-2 border-ink-300">
          <span className="text-[12px] font-bold uppercase text-ink-800">
            Total
          </span>
          <span
            data-num
            className="font-mono font-bold text-ink-900 [font-variant-numeric:tabular-nums]"
          >
            {fmtIDR(exp.total)}
          </span>
        </li>
      </ul>
    </div>
  )
}


/**
 * Profit Saat Ini + Proyeksi side-by-side, proporsional.
 * Color-coded berdasar performance vs target. Handle minus dgn warning.
 *
 * Profit Saat Ini = profit OPERATING (sebelum bagi hasil dibayar).
 * Bagi hasil ditampilkan sbg distribusi terpisah + Profit Net (after).
 */
function ProfitComparison({
  profitNow,
  profitProj,
  profitNet,
  profitSharePaid,
}: {
  profitNow: number
  profitProj: number
  profitNet?: number
  profitSharePaid?: number
}) {
  const minus = profitNow < 0
  const ahead = profitProj > 0 && profitNow >= profitProj
  const variant: "danger" | "warning" | "success" =
    minus ? "danger" : ahead ? "success" : "warning"

  const styles = {
    danger:  { bg: "bg-danger-50",  border: "border-danger-300",  text: "text-danger-800",  badge: "bg-danger-100 text-danger-800",   icon: "✕" },
    warning: { bg: "bg-warning-50", border: "border-warning-300", text: "text-warning-900", badge: "bg-warning-100 text-warning-800", icon: "!" },
    success: { bg: "bg-success-50", border: "border-success-300", text: "text-success-800", badge: "bg-success-100 text-success-800", icon: "✓" },
  }[variant]

  const diff = profitNow - profitProj
  const diffPct = profitProj !== 0 ? (diff / Math.abs(profitProj)) * 100 : 0
  const statusText = (() => {
    if (minus) return "Proyek merugi"
    if (profitProj <= 0) return "Target belum di-set"
    if (ahead) return `Di atas target (+${diffPct.toFixed(0)}%)`
    return `Di bawah target (${diffPct.toFixed(0)}%)`
  })()

  const hasShare = (profitSharePaid ?? 0) > 0
  const netVal = profitNet ?? profitNow

  return (
    <div className="mt-4 space-y-2">
      {minus && (
        <div className="rounded-md border border-danger-300 bg-danger-50 p-3">
          <div className="flex items-start gap-2">
            <span className="text-base">⚠</span>
            <div className="flex-1 text-[12px] text-danger-800">
              <strong className="font-semibold">Proyek minus.</strong>{" "}
              Tinjau realisasi vs target. Kalau ada bagi hasil yg sudah
              dibayar, review akunting — distribusi profit seharusnya
              nol ketika operasi minus.
            </div>
          </div>
        </div>
      )}

      {/* Side-by-side proporsional. Audit 2026-05-24: stack 1-col di
          mobile -- angka 10+ digit + badge tdk cukup di half-width cell. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Profit Saat Ini (operating, sebelum bagi hasil) */}
        <div className={cn("rounded-md border-2 p-3", styles.bg, styles.border)}>
          <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
            <span className={cn("text-[11px] font-semibold uppercase tracking-wider", styles.text)}>
              Profit Saat Ini
            </span>
            <span className={cn("rounded px-1.5 py-0.5 text-[9px] font-bold uppercase whitespace-nowrap", styles.badge)}>
              <span className="mr-0.5">{styles.icon}</span>
              {statusText}
            </span>
          </div>
          <div
            data-num
            className={cn(
              "font-mono text-lg font-bold [font-variant-numeric:tabular-nums] sm:text-xl break-all",
              styles.text,
            )}
          >
            {minus ? `− ${fmtIDR(Math.abs(profitNow))}` : fmtIDR(profitNow)}
          </div>
          {hasShare && (
            <div className={cn("mt-1 text-[10px]", styles.text)}>
              Profit operasional (sebelum distribusi bagi hasil)
            </div>
          )}
        </div>

        {/* Profit Proyeksi -- reference */}
        <div className="rounded-md border bg-ink-50/60 p-3">
          <div className="mb-1 flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-600">
              Profit Proyeksi
            </span>
            <span className="text-[9px] uppercase text-ink-400 whitespace-nowrap">
              Target
            </span>
          </div>
          <div
            data-num
            className="font-mono text-lg font-bold text-ink-700 [font-variant-numeric:tabular-nums] sm:text-xl break-all"
          >
            {profitProj < 0 ? `− ${fmtIDR(Math.abs(profitProj))}` : fmtIDR(profitProj)}
          </div>
        </div>
      </div>

      {/* Bagi hasil distribusi + Profit Net (kalau ada bagi hasil) */}
      {hasShare && (
        <div className="mt-2 rounded-md border bg-ink-50/40 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-700 mb-1.5">
            Distribusi Profit
          </div>
          <ul className="text-sm divide-y divide-ink-200/60">
            <li className="flex items-center justify-between gap-3 py-1">
              <span className="text-[12px] text-ink-600">
                Bagi Hasil Dibayar
              </span>
              <span
                data-num
                className="font-mono text-[13px] font-semibold text-brand-700 [font-variant-numeric:tabular-nums]"
              >
                − {fmtIDR(profitSharePaid ?? 0)}
              </span>
            </li>
            <li className="flex items-center justify-between gap-3 py-1.5">
              <span className="text-[12px] font-semibold text-ink-800">
                Profit Net (setelah distribusi)
              </span>
              <span
                data-num
                className={cn(
                  "font-mono text-[14px] font-bold [font-variant-numeric:tabular-nums]",
                  netVal < 0 ? "text-danger-700" : "text-ink-900",
                )}
              >
                {netVal < 0 ? `− ${fmtIDR(Math.abs(netVal))}` : fmtIDR(netVal)}
              </span>
            </li>
          </ul>
        </div>
      )}
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
        // Audit 2026-05-24: stack di mobile supaya angka 10+ digit
        // tidak terpotong. Side-by-side hanya di sm+.
        "flex flex-col items-stretch gap-0.5 py-1.5",
        "sm:flex-row sm:items-start sm:justify-between sm:gap-3",
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
          "font-mono [font-variant-numeric:tabular-nums] text-right sm:shrink-0 break-all",
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
