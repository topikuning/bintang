import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  PiggyBank,
  TrendingDown,
  Wallet,
  XCircle,
} from "lucide-react"
import { useBudgetSummary, type BudgetStatus } from "@/hooks/useBudget"
import { usePageTitle } from "@/hooks/usePageTitle"
import { MultiProjectPicker } from "@/components/forms/MultiProjectPicker"
import { SummaryCard, SummaryCardGrid } from "@/components/data/SummaryCard"
import { ErrorState } from "@/components/data/ErrorState"
import { Skeleton } from "@/components/ui/skeleton"
import { fmtCompact, fmtIDR } from "@/lib/format"
import { apiErrorMessage } from "@/lib/api"
import { cn } from "@/lib/utils"

const STATUS_META: Record<BudgetStatus, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  aman: { label: "Aman", tone: "success" },
  mendekati_batas: { label: "Mendekati Batas", tone: "warning" },
  overbudget: { label: "Over Budget", tone: "danger" },
  no_budget: { label: "Belum di-set", tone: "neutral" },
}

export function BudgetPage() {
  usePageTitle("Budget vs Actual")
  const [projectFilter, setProjectFilter] = useState<number[]>([])
  const [includeNoBudget, setIncludeNoBudget] = useState(false)

  const params = useMemo(
    () => ({
      project_id: projectFilter.length > 0 ? projectFilter : undefined,
      include_no_budget: includeNoBudget,
    }),
    [projectFilter, includeNoBudget],
  )

  const q = useBudgetSummary(params)

  if (q.error) {
    return (
      <div className="p-4 sm:p-6">
        <ErrorState
          description={apiErrorMessage(q.error)}
          onRetry={() => q.refetch()}
        />
      </div>
    )
  }

  const rows = q.data?.rows ?? []
  const totals = q.data?.totals
  const byCategory = q.data?.by_category ?? []
  const isSingleProject = projectFilter.length === 1

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-5 lg:p-6">
      <div>
        <h1 className="text-xl font-bold text-ink-900 sm:text-2xl">
          Budget vs Actual
        </h1>
        <p className="text-[13px] text-ink-500 mt-0.5">
          Realisasi anggaran per proyek
          {isSingleProject ? " (+ breakdown kategori)" : ""}.
          Realisasi mencakup tx OUT aktif (DRAFT/SUBMITTED/VERIFIED).
        </p>
      </div>

      {/* Filter bar */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-ink-500 shrink-0 w-12">
            Proyek
          </span>
          <div className="flex-1 max-w-sm">
            <MultiProjectPicker
              value={projectFilter}
              onChange={setProjectFilter}
            />
          </div>
        </div>
        <label className="inline-flex items-center gap-2 text-[12px] text-ink-700 cursor-pointer">
          <input
            type="checkbox"
            checked={includeNoBudget}
            onChange={(e) => setIncludeNoBudget(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          Tampilkan proyek tanpa budget (untuk audit "belum di-set")
        </label>
      </div>

      {/* Totals */}
      {totals && (
        <SummaryCardGrid>
          <SummaryCard
            icon={PiggyBank}
            label="Total Budget"
            value={fmtCompact(totals.budget)}
            hint={fmtIDR(totals.budget)}
            tone="neutral"
          />
          <SummaryCard
            icon={TrendingDown}
            label="Total Realisasi"
            value={fmtCompact(totals.spent)}
            hint={`${pctText(totals.usage_pct)} dari budget`}
            tone={
              Number(totals.usage_pct) > 100
                ? "danger"
                : Number(totals.usage_pct) > 80
                  ? "warning"
                  : "success"
            }
          />
          <SummaryCard
            icon={Wallet}
            label="Sisa Budget"
            value={fmtCompact(totals.remaining)}
            hint={fmtIDR(totals.remaining)}
            tone={Number(totals.remaining) < 0 ? "danger" : "neutral"}
          />
          <SummaryCard
            icon={AlertTriangle}
            label="Status Proyek"
            value={`${totals.n_overbudget}/${rows.length}`}
            hint={`${totals.n_aman} aman · ${totals.n_mendekati} dekat · ${totals.n_overbudget} over${totals.n_no_budget > 0 ? ` · ${totals.n_no_budget} belum` : ""}`}
            tone={totals.n_overbudget > 0 ? "danger" : "success"}
          />
        </SummaryCardGrid>
      )}

      {/* Per-project table */}
      <div className="rounded-md border bg-surface overflow-hidden">
        {q.isLoading ? (
          <div className="p-4 space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-sm text-ink-500">
            {includeNoBudget
              ? "Tidak ada proyek aktif."
              : "Tidak ada proyek dengan budget. Set budget di Master → Proyek, atau aktifkan toggle 'tampilkan proyek tanpa budget'."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] border-collapse">
              <thead className="bg-surface-muted text-ink-600">
                <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-semibold">
                  <th>Proyek</th>
                  <th className="text-right">Budget</th>
                  <th className="text-right">Realisasi</th>
                  <th className="text-right">Sisa</th>
                  <th className="text-right w-24">%</th>
                  <th className="w-32">Status</th>
                </tr>
              </thead>
              <tbody className="[&>tr]:border-t">
                {rows.map((r) => {
                  const meta = STATUS_META[r.status]
                  const pct = Number(r.usage_pct)
                  const barColor =
                    r.status === "overbudget"
                      ? "bg-danger-500"
                      : r.status === "mendekati_batas"
                        ? "bg-warning-500"
                        : r.status === "aman"
                          ? "bg-success-500"
                          : "bg-ink-300"
                  return (
                    <tr key={r.project_id} className="hover:bg-ink-50/50">
                      <td className="px-3 py-2.5">
                        <Link
                          to={`/projects/${r.project_id}`}
                          className="block group"
                        >
                          <div className="font-medium text-ink-900 group-hover:text-brand-700">
                            {r.project_name}
                          </div>
                          <div className="text-[11px] text-ink-500 font-mono">
                            {r.project_code}
                            {r.company_name && (
                              <span className="font-sans"> · {r.company_name}</span>
                            )}
                          </div>
                        </Link>
                      </td>
                      <td
                        data-num
                        className="px-3 py-2.5 text-right font-mono [font-variant-numeric:tabular-nums]"
                      >
                        {fmtIDR(r.budget_amount)}
                      </td>
                      <td
                        data-num
                        className="px-3 py-2.5 text-right font-mono [font-variant-numeric:tabular-nums]"
                      >
                        {fmtIDR(r.spent)}
                      </td>
                      <td
                        data-num
                        className={cn(
                          "px-3 py-2.5 text-right font-mono [font-variant-numeric:tabular-nums]",
                          Number(r.remaining) < 0 && "text-danger-700 font-semibold",
                        )}
                      >
                        {fmtIDR(r.remaining)}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-col gap-1 items-end">
                          <span
                            data-num
                            className={cn(
                              "font-mono [font-variant-numeric:tabular-nums] text-[12px] font-semibold",
                              r.status === "overbudget" && "text-danger-700",
                              r.status === "mendekati_batas" && "text-warning-700",
                              r.status === "aman" && "text-success-700",
                              r.status === "no_budget" && "text-ink-500",
                            )}
                          >
                            {pctText(r.usage_pct)}
                          </span>
                          <div className="h-1 w-full rounded-full bg-ink-100 overflow-hidden">
                            <div
                              className={cn("h-full transition-all", barColor)}
                              style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusBadge label={meta.label} tone={meta.tone} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Per-category breakdown (drilldown 1 project) */}
      {isSingleProject && byCategory.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-ink-900 mb-2">
            Realisasi per Kategori — {rows[0]?.project_name ?? "-"}
          </h2>
          <div className="rounded-md border bg-surface overflow-hidden">
            <table className="w-full text-[12px] border-collapse">
              <thead className="bg-surface-muted text-ink-600">
                <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-semibold">
                  <th>Kategori</th>
                  <th className="text-right">Realisasi</th>
                  <th className="text-right w-20">%</th>
                </tr>
              </thead>
              <tbody className="[&>tr]:border-t">
                {byCategory.map((c) => (
                  <tr
                    key={`${c.project_id}-${c.category_id ?? "none"}`}
                    className="hover:bg-ink-50/50"
                  >
                    <td className="px-3 py-2 text-ink-900">{c.category_name}</td>
                    <td
                      data-num
                      className="px-3 py-2 text-right font-mono [font-variant-numeric:tabular-nums]"
                    >
                      {fmtIDR(c.spent)}
                    </td>
                    <td
                      data-num
                      className="px-3 py-2 text-right font-mono text-ink-600 [font-variant-numeric:tabular-nums]"
                    >
                      {pctText(c.pct_of_project_spent)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function pctText(v: number | string): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return "—"
  return `${n.toFixed(1)}%`
}

function StatusBadge({
  label,
  tone,
}: {
  label: string
  tone: "success" | "warning" | "danger" | "neutral"
}) {
  const cls = {
    success: "bg-success-50 text-success-700 border-success-200",
    warning: "bg-warning-50 text-warning-700 border-warning-200",
    danger: "bg-danger-50 text-danger-700 border-danger-200",
    neutral: "bg-ink-50 text-ink-600 border-border",
  }[tone]
  const Icon =
    tone === "success"
      ? CheckCircle2
      : tone === "warning"
        ? Clock
        : tone === "danger"
          ? XCircle
          : AlertTriangle
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        cls,
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  )
}
