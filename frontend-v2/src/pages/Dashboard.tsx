import { useMemo } from "react"
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Clock,
  Download,
  FolderKanban,
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
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { fmtCompact, fmtIDR } from "@/lib/format"
import { apiErrorMessage } from "@/lib/api"
import { useBreakpoint } from "@/lib/breakpoint"

/**
 * Dashboard adaptif:
 *  - Kalau project dipilih di ProjectSwitcher -> ProjectDashboard
 *  - Kalau "Semua Proyek" -> GlobalDashboard
 *
 * Mobile mengikuti pendekatan report-first: summary cards vertikal +
 * warning banner + cashflow compact + 2 list (transaksi terbaru,
 * invoice urgent) + 2 quick action button.
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

  return (
    <Page>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink-900 sm:text-2xl">
            {d.project.name}
          </h1>
          <p className="text-[13px] text-ink-500 mt-0.5 font-mono">
            {d.project.code}
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="secondary" size={bp === "mobile" ? "sm" : "md"}>
            <Link to="/transactions">
              <Plus className="h-4 w-4" />
              Tambah Transaksi
            </Link>
          </Button>
          <Button
            asChild
            variant="ghost"
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
      {d.warnings.length > 0 && (
        <div className="rounded-md border border-warning-200 bg-warning-50 p-3 sm:p-4 space-y-1.5">
          <div className="flex items-center gap-2 text-warning-700 font-semibold text-sm">
            <AlertTriangle className="h-4 w-4" />
            <span>
              {d.warnings.length === 1 ? "Perhatian" : `${d.warnings.length} hal perlu diperhatikan`}
            </span>
          </div>
          <ul className="ml-6 list-disc text-[13px] text-warning-700 space-y-0.5">
            {d.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Summary cards */}
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
          tone="neutral"
        />
        <SummaryCard
          icon={ArrowUpRight}
          label="Total Pengeluaran"
          value={fmtCompact(d.totals.out)}
          hint={fmtIDR(d.totals.out)}
          tone="neutral"
        />
        <SummaryCard
          icon={Clock}
          label="Menunggu Validasi"
          value={String(d.pending_count)}
          hint={d.pending_count > 0 ? `nilai ${fmtCompact(d.pending_total)}` : "semua tervalidasi"}
          tone={d.pending_count > 0 ? "warning" : "neutral"}
        />
      </SummaryCardGrid>

      {/* 2-col grid utk desktop, 1-col mobile */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <Section title="Cashflow 12 Bulan" icon={TrendingUp}>
            <CashflowChart
              data={d.monthly_cashflow}
              height={bp === "mobile" ? 200 : 280}
              compact={bp === "mobile"}
            />
          </Section>
          <Section title="Transaksi Terbaru" icon={Receipt} actionTo="/transactions" actionLabel="Semua">
            <RecentTransactions
              items={d.recent_transactions}
              limit={bp === "mobile" ? 5 : 8}
            />
          </Section>
        </div>

        <div className="space-y-4">
          <BudgetProgress budget={d.budget} />
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

  // PENTING: hook harus dipanggil di setiap render utk menjaga urutan
  // sama. Kalau ditaruh setelah early-return, React error #310 (more
  // hooks than prev render) akan muncul saat data datang.
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
            Ringkasan semua proyek aktif
          </p>
        </div>
      </div>

      {d.warnings.length > 0 && (
        <div className="rounded-md border border-warning-200 bg-warning-50 p-3 sm:p-4 space-y-1.5">
          <div className="flex items-center gap-2 text-warning-700 font-semibold text-sm">
            <AlertTriangle className="h-4 w-4" />
            <span>{d.warnings.length} hal perlu diperhatikan</span>
          </div>
          <ul className="ml-6 list-disc text-[13px] text-warning-700 space-y-0.5">
            {d.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

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
          tone="neutral"
        />
        <SummaryCard
          icon={ArrowUpRight}
          label="Total Pengeluaran"
          value={fmtCompact(d.totals.out)}
          hint={fmtIDR(d.totals.out)}
          tone="neutral"
        />
      </SummaryCardGrid>

      <Section title="Cashflow 12 Bulan" icon={TrendingUp}>
        <CashflowChart
          data={d.monthly_cashflow}
          height={bp === "mobile" ? 200 : 320}
          compact={bp === "mobile"}
        />
      </Section>

      <Section
        title="Proyek"
        icon={FolderKanban}
        actionTo="/master/projects"
        actionLabel="Kelola"
      >
        <ul className="flex flex-col divide-y rounded-md border bg-surface">
          {sortedProjects.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-ink-500">
              Belum ada proyek aktif.
            </li>
          )}
          {sortedProjects.map((p) => {
            const minus = p.balance < 0
            const usage = Math.min(100, Math.max(0, p.budget_usage_pct))
            return (
              <li key={p.id}>
                <Link
                  to={`/transactions`}
                  className="grid grid-cols-[1fr_auto] items-center gap-2 px-3 py-2.5 hover:bg-surface-muted"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{p.name}</span>
                      <span className="text-[11px] font-mono text-ink-500">{p.code}</span>
                    </div>
                    {p.budget_amount > 0 && (
                      <div className="mt-1 flex items-center gap-2">
                        <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink-100">
                          <div
                            className={
                              p.budget_status === "overbudget"
                                ? "h-full bg-danger-500"
                                : p.budget_status === "mendekati_batas"
                                  ? "h-full bg-warning-500"
                                  : "h-full bg-success-500"
                            }
                            style={{ width: `${p.budget_status === "overbudget" ? 100 : usage}%` }}
                          />
                        </div>
                        <span className="text-[11px] font-mono text-ink-500 [font-variant-numeric:tabular-nums]">
                          {Math.round(usage)}%
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div
                      data-num
                      className={
                        minus
                          ? "font-mono text-sm font-semibold text-danger-700 [font-variant-numeric:tabular-nums]"
                          : "font-mono text-sm font-semibold [font-variant-numeric:tabular-nums]"
                      }
                    >
                      {fmtCompact(p.balance)}
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-ink-500">
                      saldo
                    </div>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      </Section>
    </Page>
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
