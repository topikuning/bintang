import { cn } from "@/lib/utils";

export default function BudgetProgress({
  pct,
  status,
}: {
  pct: number;
  status: "aman" | "mendekati_batas" | "overbudget" | "no_budget" | string;
}) {
  const safe = Math.max(0, Math.min(100, pct || 0));
  const barColor =
    status === "overbudget"
      ? "bg-rose-500"
      : status === "mendekati_batas"
        ? "bg-amber-500"
        : status === "aman"
          ? "bg-emerald-500"
          : "bg-slate-400";
  return (
    <div>
      <div className="h-2.5 w-full rounded-full bg-slate-200 overflow-hidden">
        <div className={cn("h-full rounded-full", barColor)} style={{ width: `${safe}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-slate-500">
        <span>{(pct || 0).toFixed(1)}% terpakai</span>
        <span className="capitalize">{String(status).replace("_", " ")}</span>
      </div>
    </div>
  );
}
