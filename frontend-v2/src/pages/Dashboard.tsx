import { useMemo } from "react"
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  BadgeCheck,
  Clock,
  Download,
  Flame,
  FolderKanban,
  Link2Off,
  PieChart as PieIcon,
  Plus,
  Receipt,
  TrendingUp,
  Wallet,
} from "lucide-react"
import { Link } from "react-router-dom"
import { useUIPrefs } from "@/store/ui-prefs"
import { useGlobalDashboard, useProjectDashboard } from "@/hooks/useDashboard"
import { ErrorState } from "@/components/data/ErrorState"
import { SummaryCard, SummaryCardGrid } from "@/components/data/SummaryCard"
import { CashflowChart } from "@/components/charts/CashflowChart"
import { RecentTransactions } from "@/components/domain/dashboard/RecentTransactions"
import { UpcomingInvoices } from "@/components/domain/dashboard/UpcomingInvoices"
import { BudgetProgress } from "@/components/domain/dashboard/BudgetProgress"
import { SpendingBreakdown } from "@/components/domain/dashboard/SpendingBreakdown"
import { FinanceBreakdown } from "@/components/domain/dashboard/FinanceBreakdown"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { fmtCompact, fmtIDR } from "@/lib/format"
import { apiErrorMessage } from "@/lib/api"
import { useBreakpoint } from "@/lib/breakpoint"
import { cn } from "@/lib/utils"
import type { GlobalDashboardProjectSummary, HealthStatus } from "@/types/dashboard"

/**
 * Dashboard adaptif:
 *  - Project picker = "Semua Proyek" -> GlobalDashboard
 *  - Project picker = proyek tertentu -> ProjectDashboard
 *
 * Visual: pemasukan = hijau, pengeluaran = merah, saldo minus = merah,
 * konsisten di semua tempat (summary card, list, chart). Bahasa
 * Indonesia full.
 */
export function DashboardPage() {
  const { defaultProjectId } = useUIPrefs()
  return defaultProjectId ? (
    <ProjectDashboard projectId={defaultProjectId} />
  ) : (
    <GlobalDashboard />
  )
}

// ============================================================
// Per-project dashboard
// ============================================================
function ProjectDashboard({ projectId }: { projectId: number }) {
  const bp = useBreakpoint()
  const q = useProjectDashboard(projectId)

  if (q.isLoading) return <DashboardSkeleton />
  if (q.error) {
    return (
      <Page>
        <ErrorState
          description={apiErrorMessage(q.error)}
          onRetry={() => q.refetch()}
        />
      </Page>
    )
  }
  if (!q.data) return null
  const d = q.data
  const healthStr = typeof d.health === "string" ? d.health : d.health.status

  return (
    <Page>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-ink-900 sm:text-2xl">
              {d.project.name}
            </h1>
            <HealthBadge status={healthStr} />
          </div>
          <p className="text-[13px] text-ink-500 mt-0.5 font-mono">
            {d.project.code}
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="primary" size={bp === "mobile" ? "sm" : "md"}>
            <Link to="/transactions">
              <Plus className="h-4 w-4" />
              Transaksi
            </Link>
          </Button>
          <Button
            asChild
            variant="secondary"
            size={bp === "mobile" ? "sm" : "md"}
            className="hidden sm:inline-flex"
          >
            <Link to="/reports">
              <Download className="h-4 w-4" />
              Laporan
            </Link>
          </Button>
        </div>
      </div>

      {/* Warning banner */}
      {d.warnings.length > 0 && <WarningBanner warnings={d.warnings} />}

      {/* Pending + unlinked highlight (kalau ada) */}
      {(d.pending_count > 0 || d.unlinked_out_count > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {d.pending_count > 0 && (
            <Link to="/transactions" className="block">
              <HighlightCard
                tone="warning"
                icon={Clock}
                label="Belum Verifikasi"
                bigValue={`${d.pending_count} transaksi`}
                hint={fmtIDR(d.pending_total)}
              />
            </Link>
          )}
          {d.unlinked_out_count > 0 && (
            <Link to="/transactions" className="block">
              <HighlightCard
                tone="info"
                icon={Link2Off}
                label="Pengeluaran Belum Dialokasi"
                bigValue={`${d.unlinked_out_count} transaksi`}
                hint={`Sisa ${fmtIDR(d.unlinked_out_total)}`}
              />
            </Link>
          )}
        </div>
      )}

      {/* Summary cards: 4 KPI utama dgn warna sign-aware */}
      <SummaryCardGrid>
        <SummaryCard
          icon={Wallet}
          label="Saldo Proyek"
          value={fmtCompact(d.totals.balance)}
          hint={fmtIDR(d.totals.balance)}
          tone={d.totals.balance < 0 ? "danger" : "success"}
        />
        <SummaryCard
          icon={ArrowDownLeft}
          label="Total Pemasukan"
          value={fmtCompact(d.totals.in)}
          hint={fmtIDR(d.totals.in)}
          tone="success"
        />
        <SummaryCard
          icon={ArrowUpRight}
          label="Total Pengeluaran"
          value={fmtCompact(d.totals.out)}
          hint={fmtIDR(d.totals.out)}
          tone="danger"
        />
        <SummaryCard
          icon={Receipt}
          label="Invoice Belum Lunas"
          value={fmtCompact(d.invoice_open_total)}
          hint={
            d.invoice_paid_total > 0
              ? `Lunas ${fmtCompact(d.invoice_paid_total)}`
              : "—"
          }
          tone={d.invoice_open_total > 0 ? "warning" : "neutral"}
        />
      </SummaryCardGrid>

      {/* 2-col grid utk lg+, 1-col mobile */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          {/* Cashflow */}
          <Section title="Cashflow 12 Bulan" icon={TrendingUp}>
            <div className="rounded-md border bg-surface p-3">
              <CashflowChart
                data={d.monthly_cashflow}
                height={bp === "mobile" ? 200 : 280}
                compact={bp === "mobile"}
              />
            </div>
          </Section>

          {/* Recent transactions */}
          <Section
            title="Transaksi Terbaru"
            icon={Receipt}
            actionTo="/transactions"
            actionLabel="Semua"
          >
            <RecentTransactions
              items={d.recent_transactions}
              limit={bp === "mobile" ? 5 : 8}
            />
          </Section>

          {/* Pengeluaran per kategori (kalau ada) */}
          {d.by_category.length > 0 && (
            <Section title="Pengeluaran per Kategori" icon={PieIcon}>
              <div className="rounded-md border bg-surface p-4">
                <SpendingBreakdown
                  total={d.totals.out}
                  items={d.by_category.map((c) => ({
                    name: c.category,
                    value: c.total,
                  }))}
                  chartHeight={bp === "mobile" ? 180 : 220}
                />
              </div>
            </Section>
          )}
        </div>

        <div className="space-y-4">
          <BudgetProgress budget={d.budget} />

          {d.finance && d.finance.nilai_kontrak > 0 && (
            <FinanceBreakdown finance={d.finance} />
          )}

          <Section
            title="Invoice Perlu Tindakan"
            icon={Receipt}
            actionTo="/invoices"
            actionLabel="Semua"
          >
            <UpcomingInvoices items={d.invoices} limit={bp === "mobile" ? 4 : 6} />
          </Section>
        </div>
      </div>
    </Page>
  )
}

// ============================================================
// Global dashboard (multi-project)
// ============================================================
function GlobalDashboard() {
  const bp = useBreakpoint()
  const q = useGlobalDashboard()

  // PENTING: hook dipanggil di setiap render -- sebelum any conditional
  // return -- supaya urutan/jumlah hook konsisten (React error #310).
  const sortedProjects = useMemo(
    () =>
      [...(q.data?.projects ?? [])].sort((a, b) => {
        if (a.balance < 0 && b.balance >= 0) return -1
        if (b.balance < 0 && a.balance >= 0) return 1
        return b.balance - a.balance
      }),
    [q.data?.projects],
  )

  if (q.isLoading) return <DashboardSkeleton />
  if (q.error) {
    return (
      <Page>
        <ErrorState description={apiErrorMessage(q.error)} onRetry={() => q.refetch()} />
      </Page>
    )
  }
  if (!q.data) return null
  const d = q.data

  return (
    <Page>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink-900 sm:text-2xl">Beranda</h1>
          <p className="text-[13px] text-ink-500 mt-0.5">
            Ringkasan {d.active_projects} proyek aktif
            {d.total_projects > d.active_projects &&
              ` dari ${d.total_projects} total`}
          </p>
        </div>
      </div>

      {d.warnings.length > 0 && <WarningBanner warnings={d.warnings} />}

      {/* Pending + unlinked highlight */}
      {(d.pending_count > 0 || d.unlinked_out_count > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {d.pending_count > 0 && (
            <Link to="/transactions" className="block">
              <HighlightCard
                tone="warning"
                icon={Clock}
                label="Belum Verifikasi"
                bigValue={`${d.pending_count} transaksi`}
                hint={fmtIDR(d.pending_total)}
              />
            </Link>
          )}
          {d.unlinked_out_count > 0 && (
            <Link to="/transactions" className="block">
              <HighlightCard
                tone="info"
                icon={Link2Off}
                label="Pengeluaran Belum Dialokasi"
                bigValue={`${d.unlinked_out_count} transaksi`}
                hint={`Sisa ${fmtIDR(d.unlinked_out_total)}`}
              />
            </Link>
          )}
        </div>
      )}

      {/* 4 summary card multi-project */}
      <SummaryCardGrid>
        <SummaryCard
          icon={Wallet}
          label="Total Saldo"
          value={fmtCompact(d.totals.balance)}
          hint={fmtIDR(d.totals.balance)}
          tone={d.totals.balance < 0 ? "danger" : "success"}
        />
        <SummaryCard
          icon={FolderKanban}
          label="Proyek Aktif"
          value={String(d.active_projects)}
          hint={d.minus_projects > 0 ? `${d.minus_projects} minus` : "semua sehat"}
          tone={d.minus_projects > 0 ? "warning" : "neutral"}
        />
        <SummaryCard
          icon={ArrowDownLeft}
          label="Total Pemasukan"
          value={fmtCompact(d.totals.in)}
          hint={fmtIDR(d.totals.in)}
          tone="success"
        />
        <SummaryCard
          icon={ArrowUpRight}
          label="Total Pengeluaran"
          value={fmtCompact(d.totals.out)}
          hint={fmtIDR(d.totals.out)}
          tone="danger"
        />
      </SummaryCardGrid>

      {/* Top spender card (proyek paling boros) */}
      {d.top_spender && d.totals.out > 0 && (
        <div className="rounded-md border border-danger-200 bg-danger-50/50 p-3 sm:p-4">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-danger-100 text-danger-600 shrink-0">
              <Flame className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] uppercase tracking-wider text-danger-700/80 font-semibold">
                Proyek Paling Boros
              </div>
              <div className="font-semibold text-ink-900 truncate">
                {d.top_spender.name}
              </div>
              <div
                data-num
                className="text-sm font-mono text-danger-700 [font-variant-numeric:tabular-nums]"
              >
                {fmtIDR(d.top_spender.total)}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-[11px] text-ink-500">% dari total</div>
              <div
                data-num
                className="text-base font-bold font-mono text-danger-700 [font-variant-numeric:tabular-nums]"
              >
                {((d.top_spender.total / d.totals.out) * 100).toFixed(1)}%
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cashflow chart -- full width */}
      <Section title="Cashflow 12 Bulan" icon={TrendingUp}>
        <div className="rounded-md border bg-surface p-3">
          <CashflowChart
            data={d.monthly_cashflow}
            height={bp === "mobile" ? 200 : 280}
            compact={bp === "mobile"}
          />
        </div>
      </Section>

      {/* Breakdown charts -- side-by-side di lg, stack di mobile/tablet.
          Defensive `?? []`: backend old / user tanpa proyek bisa return
          shape tdk lengkap. */}
      {((d.spending_by_project?.length ?? 0) > 0 ||
        (d.spending_by_category?.length ?? 0) > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {(d.spending_by_project?.length ?? 0) > 0 && (
            <Section title="Pengeluaran per Proyek" icon={PieIcon}>
              <div className="rounded-md border bg-surface p-4">
                <SpendingBreakdown
                  total={d.totals.out}
                  items={(d.spending_by_project ?? []).map((s) => ({
                    name: s.name,
                    value: s.total,
                  }))}
                  chartHeight={bp === "mobile" ? 160 : 200}
                  limit={6}
                />
              </div>
            </Section>
          )}
          {(d.spending_by_category?.length ?? 0) > 0 && (
            <Section title="Pengeluaran per Kategori" icon={PieIcon}>
              <div className="rounded-md border bg-surface p-4">
                <SpendingBreakdown
                  total={d.totals.out}
                  items={(d.spending_by_category ?? []).map((c) => ({
                    name: c.category,
                    value: c.total,
                  }))}
                  chartHeight={bp === "mobile" ? 160 : 200}
                  limit={6}
                />
              </div>
            </Section>
          )}
        </div>
      )}

      {/* Ringkasan per proyek */}
      <Section title="Ringkasan per Proyek" icon={FolderKanban}>
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {sortedProjects.length === 0 && (
            <div className="col-span-full rounded-md border border-dashed bg-surface-muted p-6 text-center text-sm text-ink-500">
              Belum ada proyek aktif.
            </div>
          )}
          {sortedProjects.map((p) => (
            <ProjectSummaryCard key={p.id} project={p} />
          ))}
        </div>
      </Section>
    </Page>
  )
}

// ============================================================
// Sub-components
// ============================================================

function ProjectSummaryCard({ project: p }: { project: GlobalDashboardProjectSummary }) {
  const setProj = useUIPrefs((s) => s.setDefaultProject)
  const minus = p.balance < 0
  const usage = Math.min(100, Math.max(0, p.budget.usage_pct))
  const barColor =
    p.budget.status === "overbudget"
      ? "bg-danger-500"
      : p.budget.status === "mendekati_batas"
        ? "bg-warning-500"
        : "bg-success-500"

  return (
    <button
      type="button"
      onClick={() => setProj(p.id)}
      className="block w-full rounded-md border bg-surface p-3 text-left transition-colors hover:border-brand-300 hover:bg-brand-50/30"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-ink-900 truncate">{p.name}</div>
          <div className="text-[11px] text-ink-500 truncate font-mono">
            {p.code}
            {p.company && <span className="font-sans"> · {p.company}</span>}
          </div>
        </div>
        <HealthBadge status={p.health} />
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-ink-500">Masuk</div>
          <div
            data-num
            className="font-mono text-[13px] font-semibold text-success-700 [font-variant-numeric:tabular-nums]"
          >
            {fmtCompact(p.total_in)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-ink-500">Keluar</div>
          <div
            data-num
            className="font-mono text-[13px] font-semibold text-danger-700 [font-variant-numeric:tabular-nums]"
          >
            {fmtCompact(p.total_out)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-ink-500">Saldo</div>
          <div
            data-num
            className={cn(
              "font-mono text-[13px] font-semibold [font-variant-numeric:tabular-nums]",
              minus ? "text-danger-700" : "text-ink-900",
            )}
          >
            {fmtCompact(p.balance)}
          </div>
        </div>
      </div>

      {p.budget.amount > 0 && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px] text-ink-500 mb-1">
            <span>Realisasi Budget</span>
            <span
              data-num
              className={cn(
                "font-mono font-semibold [font-variant-numeric:tabular-nums]",
                p.budget.status === "overbudget" && "text-danger-700",
                p.budget.status === "mendekati_batas" && "text-warning-700",
                p.budget.status === "budget_aman" && "text-success-700",
              )}
            >
              {Math.round(usage)}%
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
            <div
              className={cn("h-full transition-all", barColor)}
              style={{ width: `${p.budget.status === "overbudget" ? 100 : usage}%` }}
            />
          </div>
          <div className="mt-1 text-[11px] text-ink-500 flex justify-between">
            <span>
              Terpakai{" "}
              <span className="font-mono [font-variant-numeric:tabular-nums]">
                {fmtCompact(p.budget.spent)}
              </span>
            </span>
            <span>
              dari{" "}
              <span className="font-mono [font-variant-numeric:tabular-nums]">
                {fmtCompact(p.budget.amount)}
              </span>
            </span>
          </div>
        </div>
      )}
    </button>
  )
}

function HealthBadge({ status }: { status: HealthStatus }) {
  const map = {
    sehat: { tone: "success" as const, label: "Sehat" },
    perhatian: { tone: "warning" as const, label: "Perhatian" },
    minus: { tone: "danger" as const, label: "Minus" },
  }
  const meta = map[status]
  if (!meta) return null
  return (
    <Badge tone={meta.tone} className="shrink-0">
      <BadgeCheck className="h-3 w-3 mr-1 inline-block" />
      {meta.label}
    </Badge>
  )
}

function HighlightCard({
  tone,
  icon: Icon,
  label,
  bigValue,
  hint,
}: {
  tone: "warning" | "info" | "success" | "danger"
  icon: React.ComponentType<{ className?: string }>
  label: string
  bigValue: string
  hint?: string
}) {
  const cls = {
    warning: "border-warning-200 bg-warning-50/70 hover:bg-warning-100/60 text-warning-800",
    info: "border-info-200 bg-info-50/70 hover:bg-info-100/60 text-info-800",
    success: "border-success-200 bg-success-50/70 hover:bg-success-100/60 text-success-800",
    danger: "border-danger-200 bg-danger-50/70 hover:bg-danger-100/60 text-danger-800",
  }[tone]
  const iconCls = {
    warning: "text-warning-600",
    info: "text-info-600",
    success: "text-success-600",
    danger: "text-danger-600",
  }[tone]
  return (
    <div className={cn("rounded-md border p-3 transition-colors", cls)}>
      <div className="flex items-start gap-2.5">
        <Icon className={cn("h-5 w-5 shrink-0 mt-0.5", iconCls)} />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] uppercase font-semibold tracking-wider opacity-80">
            {label}
          </div>
          <div className="text-base font-bold tabular-nums">{bigValue}</div>
          {hint && (
            <div
              data-num
              className="text-[11px] truncate font-mono [font-variant-numeric:tabular-nums]"
            >
              {hint}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function WarningBanner({ warnings }: { warnings: string[] }) {
  return (
    <div className="rounded-md border border-warning-200 bg-warning-50 p-3 sm:p-4 space-y-1.5">
      <div className="flex items-center gap-2 text-warning-700 font-semibold text-sm">
        <AlertTriangle className="h-4 w-4" />
        <span>
          {warnings.length === 1
            ? "Perhatian"
            : `${warnings.length} hal perlu diperhatikan`}
        </span>
      </div>
      <ul className="ml-6 list-disc text-[13px] text-warning-700 space-y-0.5">
        {warnings.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </div>
  )
}

// ============================================================
// Helpers
// ============================================================
function Page({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-4 p-3 sm:p-5 lg:p-6">{children}</div>
}

function Section({
  title,
  icon: Icon,
  children,
  actionTo,
  actionLabel,
}: {
  title: string
  icon?: React.ComponentType<{ className?: string }>
  children: React.ReactNode
  actionTo?: string
  actionLabel?: string
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
          {Icon && <Icon className="h-4 w-4 text-ink-500" />}
          <span>{title}</span>
        </h2>
        {actionTo && (
          <Link
            to={actionTo}
            className="text-[12px] font-medium text-brand-600 hover:underline"
          >
            {actionLabel ?? "Lihat semua"} →
          </Link>
        )}
      </div>
      {children}
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <Page>
      <Skeleton className="h-8 w-1/2 max-w-xs" />
      <SummaryCardGrid>
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </SummaryCardGrid>
      <Skeleton className="h-64" />
      <Skeleton className="h-48" />
    </Page>
  )
}
