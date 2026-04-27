import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

interface Item {
  name: string;
  value: number;
}

const COLORS = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#eab308",
  "#84cc16",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

export default function SpendingPie({
  data,
  topN = 5,
}: {
  data: Item[];
  topN?: number;
}) {
  const sorted = [...data].sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, topN);
  const rest = sorted.slice(topN);
  const restSum = rest.reduce((s, x) => s + x.value, 0);
  const display = restSum > 0 ? [...top, { name: `Lainnya (${rest.length})`, value: restSum }] : top;

  if (display.length === 0 || display.every((d) => d.value === 0)) {
    return <div className="text-xs text-slate-500 italic py-6 text-center">Belum ada data</div>;
  }

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <PieChart>
          <Pie
            data={display}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius="50%"
            outerRadius="80%"
            paddingAngle={1}
          >
            {display.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(v: number) => `Rp ${v.toLocaleString("id-ID")}`}
            contentStyle={{ borderRadius: 8, fontSize: 12 }}
          />
          <Legend
            wrapperStyle={{ fontSize: 11 }}
            formatter={(v: string) => (v.length > 22 ? v.slice(0, 21) + "…" : v)}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
