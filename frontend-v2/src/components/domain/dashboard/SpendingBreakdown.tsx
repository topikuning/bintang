import { fmtCompact, fmtIDR, fmtPct } from "@/lib/format"
import { cn } from "@/lib/utils"
import { SpendingPie } from "@/components/charts/SpendingPie"

interface BreakdownItem {
  /** Label (kategori atau nama proyek). */
  name: string
  /** Total nilai. */
  value: number
}

interface SpendingBreakdownProps {
  /** Total semua = denominator utk persentase. */
  total: number
  items: BreakdownItem[]
  /** Tampilkan donut chart di atas. Default true. */
  showChart?: boolean
  /** Maks list item; default 8. */
  limit?: number
  /** Tinggi chart (kalau showChart). */
  chartHeight?: number
  className?: string
}

/**
 * Donut chart + ranked list dgn progress bar inline.
 * Dipakai utk: pengeluaran per kategori, pengeluaran per proyek, dst.
 */
export function SpendingBreakdown({
  total,
  items,
  showChart = true,
  limit = 8,
  chartHeight = 180,
  className,
}: SpendingBreakdownProps) {
  const sorted = [...items].filter((i) => i.value > 0).sort((a, b) => b.value - a.value)
  if (sorted.length === 0) {
    return (
      <div
        className={cn(
          "rounded-md border border-dashed bg-surface-muted p-6 text-center text-[13px] text-ink-500",
          className,
        )}
      >
        Belum ada pengeluaran.
      </div>
    )
  }

  const display = sorted.slice(0, limit)
  const top1 = display[0]?.value ?? 1

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {showChart && <SpendingPie data={sorted} height={chartHeight} />}

      <ul className="flex flex-col divide-y rounded-md border bg-surface">
        {display.map((item, idx) => {
          const pct = total > 0 ? (item.value / total) * 100 : 0
          // Bar relative ke top item supaya barisan ke-2 kelihatan proporsi
          const barWidth = top1 > 0 ? (item.value / top1) * 100 : 0
          return (
            <li
              key={`${item.name}-${idx}`}
              className="grid grid-cols-[1fr_auto] items-center gap-3 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-ink-900">
                    {item.name}
                  </span>
                  <span className="text-[11px] text-ink-500 shrink-0 font-mono [font-variant-numeric:tabular-nums]">
                    {fmtPct(pct / 100)}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
                  <div
                    className="h-full bg-danger-500 transition-all"
                    style={{ width: `${Math.min(100, barWidth)}%` }}
                  />
                </div>
              </div>
              <div
                data-num
                className="text-right font-mono text-sm font-semibold text-ink-900 [font-variant-numeric:tabular-nums]"
                title={fmtIDR(item.value)}
              >
                {fmtCompact(item.value)}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
