import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts"
import type { MonthlyCashflowPoint } from "@/types/dashboard"
import { fmtCompact, fmtIDR } from "@/lib/format"

interface CashflowChartProps {
  data: MonthlyCashflowPoint[]
  /** Tinggi chart, default 280px (desktop). Mobile pass 200. */
  height?: number
  /** Render simple mode (utk dashboard mobile) -- legend hidden, axis lebih ringkas. */
  compact?: boolean
}

const BULAN_SHORT = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"]

function formatMonth(ym: string): string {
  // Input: "2026-05" -> "Mei 26"
  const [y, m] = ym.split("-").map(Number)
  if (!y || !m) return ym
  const label = BULAN_SHORT[m - 1] ?? ym
  return `${label} ${String(y).slice(2)}`
}

function CustomTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null
  const inVal = (payload.find((p) => p.dataKey === "in")?.value ?? 0) as number
  const outVal = (payload.find((p) => p.dataKey === "out")?.value ?? 0) as number
  const balance = inVal - outVal
  return (
    <div className="rounded-md border bg-surface px-3 py-2 shadow-md text-[12px]">
      <div className="font-semibold text-ink-900 mb-1">{formatMonth(String(label ?? ""))}</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono [font-variant-numeric:tabular-nums]">
        <span className="text-success-700">Masuk</span>
        <span className="text-right text-success-700">{fmtIDR(inVal)}</span>
        <span className="text-danger-700">Keluar</span>
        <span className="text-right text-danger-700">{fmtIDR(outVal)}</span>
        <span className="text-ink-700 border-t border-ink-200 pt-0.5">Saldo</span>
        <span
          className={
            balance >= 0
              ? "text-right border-t border-ink-200 pt-0.5 text-success-700 font-semibold"
              : "text-right border-t border-ink-200 pt-0.5 text-danger-700 font-semibold"
          }
        >
          {fmtIDR(balance)}
        </span>
      </div>
    </div>
  )
}

export function CashflowChart({ data, height = 280, compact }: CashflowChartProps) {
  if (data.length === 0) {
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center rounded-md border border-dashed bg-surface-muted text-[13px] text-ink-500"
      >
        Belum ada data cashflow.
      </div>
    )
  }

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <BarChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: compact ? 0 : 8 }}
          barCategoryGap={compact ? "20%" : "30%"}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" vertical={false} />
          <XAxis
            dataKey="month"
            tickFormatter={formatMonth}
            tick={{ fontSize: 11, fill: "#737373" }}
            stroke="#d4d4d4"
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v) => fmtCompact(Number(v)).replace("Rp ", "")}
            tick={{ fontSize: 11, fill: "#737373" }}
            stroke="#d4d4d4"
            axisLine={false}
            tickLine={false}
            width={compact ? 50 : 70}
          />
          <Tooltip
            content={<CustomTooltip />}
            cursor={{ fill: "rgba(10, 93, 194, 0.04)" }}
          />
          {!compact && (
            <Legend
              wrapperStyle={{ fontSize: 12 }}
              iconType="square"
              iconSize={10}
            />
          )}
          <Bar dataKey="in" name="Pemasukan" fill="#16a34a" radius={[3, 3, 0, 0]} />
          <Bar dataKey="out" name="Pengeluaran" fill="#dc2626" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
