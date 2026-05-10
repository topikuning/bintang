import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  type TooltipProps,
} from "recharts"
import { fmtIDR } from "@/lib/format"

interface SpendingItem {
  name: string
  value: number
}

interface SpendingPieProps {
  data: SpendingItem[]
  height?: number
  /** Maks slice ditampilkan terpisah; sisanya digabung "Lainnya". Default 5. */
  topN?: number
}

/**
 * Donut chart utk proporsi pengeluaran -- per proyek atau per kategori.
 * Pakai palet warna brand+netral (bukan rainbow yg bikin pusing).
 */
const COLORS = [
  "#0a5dc2", // brand-500
  "#dc2626", // danger-500
  "#d97706", // warning-500
  "#16a34a", // success-500
  "#7c3aed", // violet
  "#0891b2", // cyan
  "#737373", // ink-500 utk "Lainnya"
]

function CustomTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload || !payload.length) return null
  const item = payload[0]
  if (!item) return null
  return (
    <div className="rounded-md border bg-surface px-3 py-2 shadow-md text-[12px]">
      <div className="font-semibold text-ink-900">{item.name}</div>
      <div className="font-mono text-ink-700 [font-variant-numeric:tabular-nums]">
        {fmtIDR(Number(item.value))}
      </div>
    </div>
  )
}

export function SpendingPie({ data, height = 200, topN = 5 }: SpendingPieProps) {
  // Filter zero values + sort desc, group "Lainnya" kalau lebih dari topN.
  const sorted = [...data].filter((d) => d.value > 0).sort((a, b) => b.value - a.value)
  const top = sorted.slice(0, topN)
  const rest = sorted.slice(topN)
  const restTotal = rest.reduce((s, d) => s + d.value, 0)
  const display = restTotal > 0 ? [...top, { name: "Lainnya", value: restTotal }] : top

  if (display.length === 0) {
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center rounded-md border border-dashed bg-surface-muted text-[13px] text-ink-500"
      >
        Belum ada data pengeluaran.
      </div>
    )
  }

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie
            data={display}
            innerRadius="55%"
            outerRadius="85%"
            paddingAngle={2}
            dataKey="value"
            stroke="#ffffff"
            strokeWidth={2}
          >
            {display.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}
