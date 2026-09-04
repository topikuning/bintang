import { useMemo, useState } from "react"
import {
  AlertTriangle,
  ArrowRight,
  ArrowDownLeft,
  ArrowUpRight,
  BadgeCheck,
  Clock,
  Flame,
  FolderKanban,
  Link2Off,
  ListChecks,
  Loader2,
  PieChart as PieIcon,
  Search,
  Send,
  Shield,
  Sparkles,
  TrendingUp,
  Wallet,
} from "lucide-react"
import { Link } from "react-router"
import { useGlobalDashboard } from "@/hooks/useDashboard"
import { useCompanies } from "@/hooks/useCompanies"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import { useProjectFilters } from "@/hooks/useProjectsStats"
import { usePageTitle } from "@/hooks/usePageTitle"
import { Combobox } from "@/components/forms/Combobox"
import { MultiCombobox } from "@/components/forms/MultiCombobox"
import { EmptyState } from "@/components/data/EmptyState"
import { ErrorState } from "@/components/data/ErrorState"
import { SummaryCard, SummaryCardGrid } from "@/components/data/SummaryCard"
import { CashflowChart } from "@/components/charts/CashflowChart"
import { SpendingBreakdown } from "@/components/domain/dashboard/SpendingBreakdown"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { fmtCompact, fmtIDR } from "@/lib/format"
import { apiErrorMessage } from "@/lib/api"
import { useBreakpoint } from "@/lib/breakpoint"
import { cn } from "@/lib/utils"
import type { GlobalDashboardProjectSummary, GlobalDashboardResponse, HealthStatus } from "@/types/dashboard"
import {
  useAskQuery,
  useDailySummary,
  useScanAnomalies,
  type AnomalyFlag,
} from "@/hooks/useAI"
import { useAuthStore } from "@/store/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { toast } from "@/components/ui/sonner"

/**
 * Dashboard global -- ringkasan semua proyek dgn filter Lokasi/Dinas/
 * Pendana. Dashboard ini SELALU global; drilldown ke detail proyek
 * lewat Hub Proyek -> /projects/:id (atau klik kartu di bagian
 * "Ringkasan per Proyek" di bawah).
 */
export function DashboardPage() {
  return <GlobalDashboard />
}

// ============================================================
// Global dashboard (multi-project)
// ============================================================
function GlobalDashboard() {
  usePageTitle("Beranda")
  const bp = useBreakpoint()
  // Filter state -- samakan dgn ProjectsHubPage: search + perusahaan +
  // 3 multi-select + tabs Aktif/Semua.
  const [qSearch, setQSearch] = useState("")
  const [companyId, setCompanyId] = useState<number | null>(null)
  const [locations, setLocations] = useState<string[]>([])
  const [clientNames, setClientNames] = useState<string[]>([])
  const [funderIds, setFunderIds] = useState<number[]>([])
  // Tabs "Aktif | Semua" -- "Aktif" = exclude SELESAI/DIBATALKAN dari
  // warning counters (default operational); "Semua" = include_closed.
  const [statusTab, setStatusTab] = useState<"AKTIF" | "ALL">("AKTIF")
  // Debounce search supaya tdk fire request tiap keystroke.
  const debouncedSearch = useDebouncedValue(qSearch, 300)

  const params = useMemo(
    () => ({
      q: debouncedSearch.trim() || undefined,
      company_id: companyId ?? undefined,
      location: locations.length ? locations : undefined,
      client_name: clientNames.length ? clientNames : undefined,
      funder_id: funderIds.length ? funderIds : undefined,
      include_closed: statusTab === "ALL" || undefined,
    }),
    [debouncedSearch, companyId, locations, clientNames, funderIds, statusTab],
  )

  const q = useGlobalDashboard(params)
  const filtersQ = useProjectFilters()
  const companiesQ = useCompanies()
  const hasActiveFilter =
    qSearch.trim().length > 0 ||
    companyId != null ||
    locations.length > 0 ||
    clientNames.length > 0 ||
    funderIds.length > 0

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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-brand-600">Command Center</p>
          <h1 className="text-xl font-bold text-ink-900 sm:text-2xl">Posisi Keuangan</h1>
          <p className="text-[13px] text-ink-500 mt-0.5">
            Kendali kas dan risiko dari {d.active_projects} proyek aktif
            {d.total_projects > d.active_projects &&
              ` dari ${d.total_projects} total`}
            {hasActiveFilter && (
              <span className="text-brand-600"> · filter aktif</span>
            )}
          </p>
        </div>
        {hasActiveFilter && (
          <button
            type="button"
            onClick={() => {
              setQSearch("")
              setCompanyId(null)
              setLocations([])
              setClientNames([])
              setFunderIds([])
            }}
            className="text-[12px] text-brand-600 hover:underline"
          >
            Bersihkan filter
          </button>
        )}
      </div>

      <FinancialPositionHero data={d} />

      {/* Filter bar -- samakan dgn ProjectsHubPage:
          Search + Perusahaan + Lokasi + Dinas + Pendana + tabs Aktif/Semua.
          Tabs replace toggle banner include_closed (lebih kompak). */}
      <div className="rounded-md border bg-surface p-2.5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
          <Input
            value={qSearch}
            onChange={(e) => setQSearch(e.target.value)}
            placeholder="Cari nama / kode..."
            className="pl-9"
          />
        </div>
        <Combobox
          value={companyId}
          onChange={(v) => setCompanyId(v == null ? null : Number(v))}
          options={(companiesQ.data?.items ?? []).map((c) => ({
            value: c.id,
            label: c.name,
          }))}
          placeholder="Semua perusahaan"
          clearable
          sheetTitle="Pilih Perusahaan"
        />
        <MultiCombobox<string>
          value={locations}
          onChange={setLocations}
          options={(filtersQ.data?.locations ?? []).map((loc) => ({
            value: loc,
            label: loc,
          }))}
          placeholder="Semua lokasi"
          sheetTitle="Pilih Lokasi"
          emptyMessage="Belum ada lokasi di proyek"
        />
        <MultiCombobox<string>
          value={clientNames}
          onChange={setClientNames}
          options={(filtersQ.data?.clients ?? []).map((c) => ({
            value: c,
            label: c,
          }))}
          placeholder="Semua Dinas/Klien"
          sheetTitle="Pilih Dinas/Klien"
          emptyMessage="Belum ada Dinas/Klien di proyek"
        />
        <MultiCombobox<number>
          value={funderIds}
          onChange={setFunderIds}
          options={(filtersQ.data?.funders ?? []).map((f) => ({
            value: f.id,
            label: f.name,
          }))}
          placeholder="Semua Pendana"
          sheetTitle="Pilih Pendana"
          emptyMessage="Belum ada pendana di-link ke proyek"
        />
        <div className="flex rounded border border-border-strong bg-surface text-[12px] overflow-hidden">
          <FilterTab
            label="Aktif"
            active={statusTab === "AKTIF"}
            onClick={() => setStatusTab("AKTIF")}
          />
          <FilterTab
            label="Semua"
            active={statusTab === "ALL"}
            onClick={() => setStatusTab("ALL")}
          />
        </div>
      </div>

      {d.warnings.length > 0 && <WarningBanner warnings={d.warnings} />}

      {/* Supporting metrics intentionally follow the decision hero. */}
      <SummaryCardGrid>
        <SummaryCard
          icon={ArrowDownLeft}
          label="Kas Masuk Tervalidasi"
          value={fmtCompact(d.totals.in)}
          hint={fmtIDR(d.totals.in)}
          tone="success"
        />
        <SummaryCard
          icon={ArrowUpRight}
          label="Kas Keluar Tervalidasi"
          value={fmtCompact(d.totals.out)}
          hint={fmtIDR(d.totals.out)}
          tone="danger"
        />
        <SummaryCard
          icon={Clock}
          label="Nilai Belum Final"
          value={fmtCompact(d.pending_total)}
          hint={`${d.pending_count} transaksi menunggu`}
          tone={d.pending_count > 0 ? "warning" : "neutral"}
        />
        <SummaryCard
          icon={FolderKanban}
          label="Portofolio Aktif"
          value={String(d.active_projects)}
          hint={d.minus_projects > 0 ? `${d.minus_projects} proyek minus` : "semua dalam batas"}
          tone={d.minus_projects > 0 ? "warning" : "neutral"}
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
        {sortedProjects.length === 0 ? (
          <EmptyState
            icon={FolderKanban}
            title="Belum ada proyek aktif"
            description="Mulai dengan membuat proyek baru atau aktifkan proyek yang ada di Hub Proyek."
            actionLabel="Buka Hub Proyek"
            to="/projects"
            tone="neutral"
          />
        ) : (
          <div>
            <div className="grid gap-2.5 sm:grid-cols-2 md:hidden">
              {sortedProjects.map((p) => <ProjectSummaryCard key={p.id} project={p} />)}
            </div>
            <div className="hidden overflow-hidden rounded-2xl border border-white bg-white shadow-[var(--app-shadow)] md:block">
              <table className="w-full border-collapse text-left">
                <thead className="bg-ink-50/80 text-[10px] font-bold uppercase tracking-[0.12em] text-ink-400">
                  <tr>
                    <th className="px-4 py-3">Proyek</th>
                    <th className="px-4 py-3">Kesehatan</th>
                    <th className="px-4 py-3 text-right">Masuk</th>
                    <th className="px-4 py-3 text-right">Keluar</th>
                    <th className="px-4 py-3 text-right">Saldo</th>
                    <th className="w-48 px-4 py-3">Realisasi budget</th>
                    <th className="w-10 px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {sortedProjects.map((p) => {
                    const usage = Math.min(100, Math.max(0, p.budget.usage_pct))
                    return (
                      <tr key={p.id} className="group hover:bg-brand-50/30">
                        <td className="px-4 py-3">
                          <Link to={`/projects/${p.id}`} className="font-semibold text-ink-900 group-hover:text-brand-700">{p.name}</Link>
                          <p className="text-[11px] text-ink-500">{p.code}{p.company ? ` · ${p.company}` : ""}</p>
                        </td>
                        <td className="px-4 py-3"><HealthBadge status={p.health} /></td>
                        <td className="px-4 py-3 text-right font-mono text-[12px] font-medium text-success-700">{fmtCompact(p.total_in)}</td>
                        <td className="px-4 py-3 text-right font-mono text-[12px] font-medium text-danger-700">{fmtCompact(p.total_out)}</td>
                        <td className={cn("px-4 py-3 text-right font-mono text-[12px] font-semibold", p.balance < 0 ? "text-danger-700" : "text-ink-900")}>{fmtCompact(p.balance)}</td>
                        <td className="px-4 py-3">
                          {p.budget.amount > 0 ? (
                            <div>
                              <div className="mb-1 flex justify-between text-[10px] text-ink-500"><span>{Math.round(usage)}%</span><span>{fmtCompact(p.budget.remaining)} sisa</span></div>
                              <div className="h-1.5 overflow-hidden rounded-full bg-ink-100"><div className={cn("h-full", p.budget.status === "overbudget" ? "bg-danger-500" : p.budget.status === "mendekati_batas" ? "bg-warning-500" : "bg-success-500")} style={{ width: `${p.budget.status === "overbudget" ? 100 : usage}%` }} /></div>
                            </div>
                          ) : <span className="text-[11px] text-ink-400">Belum ditetapkan</span>}
                        </td>
                        <td className="px-4 py-3"><Link to={`/projects/${p.id}`} aria-label={`Buka ${p.name}`}><ArrowRight className="h-4 w-4 text-ink-300 group-hover:text-brand-600" /></Link></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Section>

      {/* AI panels (audit 2026-05-23). 3 fitur: Tanya bebas, Ringkasan
          hari ini, Scan anomali. Admin only. */}
      <AIInsightsPanel />
    </Page>
  )
}

// ============================================================
// Sub-components
// ============================================================

function FinancialPositionHero({ data: d }: { data: GlobalDashboardResponse }) {
  const riskCount = d.pending_count + d.unlinked_out_count + d.overdue_invoices + d.minus_projects
  const netMovement = d.totals.in - d.totals.out
  const actions = [
    {
      label: "Transaksi belum final",
      value: d.pending_count,
      hint: fmtCompact(d.pending_total),
      to: "/transactions?status=DRAFT&status=SUBMITTED",
      icon: Clock,
      urgent: d.pending_count > 0,
    },
    {
      label: "Invoice lewat jatuh tempo",
      value: d.overdue_invoices,
      hint: "Tutup risiko koleksi",
      to: "/invoices?status=OVERDUE",
      icon: AlertTriangle,
      urgent: d.overdue_invoices > 0,
    },
    {
      label: "Pengeluaran belum dialokasi",
      value: d.unlinked_out_count,
      hint: fmtCompact(d.unlinked_out_total),
      to: "/transactions?unlinked=true",
      icon: Link2Off,
      urgent: d.unlinked_out_count > 0,
    },
  ]

  return (
    <section className="overflow-hidden rounded-2xl bg-ink-900 text-white shadow-[0_24px_70px_rgb(15_23_42/0.16)]">
      <div className="grid lg:grid-cols-[1.35fr_1fr]">
        <div className="relative overflow-hidden p-5 sm:p-7 lg:p-8">
          <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-brand-500/20 blur-3xl" />
          <div className="relative">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
              <Wallet className="h-3.5 w-3.5 text-brand-300" /> Saldo terkonsolidasi
            </div>
            <p className={cn("mt-3 font-mono text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl", d.totals.balance < 0 ? "text-rose-300" : "text-white")}>
              {fmtIDR(d.totals.balance)}
            </p>
            <div className="mt-7 grid max-w-xl grid-cols-3 gap-3 border-t border-white/10 pt-5">
              <PositionMetric label="Masuk" value={fmtCompact(d.totals.in)} tone="positive" />
              <PositionMetric label="Keluar" value={fmtCompact(d.totals.out)} tone="negative" />
              <PositionMetric label="Pergerakan neto" value={fmtCompact(netMovement)} tone={netMovement < 0 ? "negative" : "positive"} />
            </div>
          </div>
        </div>

        <div className="border-t border-white/10 bg-white/[0.045] p-4 sm:p-5 lg:border-l lg:border-t-0">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Prioritas hari ini</p>
              <p className="text-sm font-semibold text-white">{riskCount === 0 ? "Tidak ada exception terbuka" : `${riskCount} sinyal perlu ditinjau`}</p>
            </div>
            <Link to="/action-center" className="grid h-9 w-9 place-items-center rounded-lg bg-white/10 text-white hover:bg-white/15" aria-label="Buka pusat tindakan">
              <ListChecks className="h-4 w-4" />
            </Link>
          </div>
          <div className="space-y-1.5">
            {actions.map(({ label, value, hint, to, icon: Icon, urgent }) => (
              <Link key={label} to={to} className="group flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.045] p-3 hover:bg-white/[0.09]">
                <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", urgent ? "bg-warning-500/15 text-warning-400" : "bg-success-500/15 text-success-400")}><Icon className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-medium text-slate-200">{label}</span>
                  <span className="block text-[10px] text-slate-500">{hint}</span>
                </span>
                <span className={cn("font-mono text-lg font-semibold tabular-nums", urgent ? "text-warning-300" : "text-slate-400")}>{value}</span>
                <ArrowRight className="h-3.5 w-3.5 text-slate-600 group-hover:text-white" />
              </Link>
            ))}
          </div>
          <Link to="/action-center" className="mt-3 flex h-10 items-center justify-center gap-2 rounded-xl bg-white text-[12px] font-semibold text-ink-900 hover:bg-slate-100">
            Buka Pusat Tindakan <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </section>
  )
}

function PositionMetric({ label, value, tone }: { label: string; value: string; tone: "positive" | "negative" }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[10px] uppercase tracking-[0.11em] text-slate-500">{label}</p>
      <p className={cn("mt-1 truncate font-mono text-sm font-semibold tabular-nums sm:text-base", tone === "positive" ? "text-emerald-300" : "text-rose-300")}>{value}</p>
    </div>
  )
}

function ProjectSummaryCard({ project: p }: { project: GlobalDashboardProjectSummary }) {
  const minus = p.balance < 0
  const usage = Math.min(100, Math.max(0, p.budget.usage_pct))
  const barColor =
    p.budget.status === "overbudget"
      ? "bg-danger-500"
      : p.budget.status === "mendekati_batas"
        ? "bg-warning-500"
        : "bg-success-500"

  return (
    <Link
      to={`/projects/${p.id}`}
      // `overflow-hidden` + `min-w-0` di card root supaya kalau ada
      // child dgn intrinsic min-width >cell (mis. judul project panjang
      // 50+ char tanpa space), card tetap clipped & tdk push grid cell
      // jadi lebih lebar dari viewport. Sebelumnya: judul terpotong di
      // luar viewport tanpa ellipsis di mobile.
      className="block w-full min-w-0 overflow-hidden rounded-md border bg-surface p-3 text-left transition-colors hover:border-brand-300 hover:bg-brand-50/30"
    >
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-ink-900 truncate">{p.name}</div>
          <div className="text-[11px] text-ink-500 truncate font-mono">
            {p.code}
            {p.company && <span className="font-sans"> · {p.company}</span>}
          </div>
        </div>
        <HealthBadge status={p.health} />
      </div>

      {/* min-w-0 di setiap grid cell supaya nomor panjang (mis.
          "Rp 1.234,5 jt") shrink, bukan push grid cell jadi lebih lebar
          dari 1fr. truncate fallback supaya tetap rapi kalau super
          panjang. */}
      <div className="mt-2 grid grid-cols-3 gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-ink-500">Masuk</div>
          <div
            data-num
            className="font-mono text-[13px] font-semibold text-success-700 [font-variant-numeric:tabular-nums] truncate"
          >
            {fmtCompact(p.total_in)}
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-ink-500">Keluar</div>
          <div
            data-num
            className="font-mono text-[13px] font-semibold text-danger-700 [font-variant-numeric:tabular-nums] truncate"
          >
            {fmtCompact(p.total_out)}
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-ink-500">Saldo</div>
          <div
            data-num
            className={cn(
              "font-mono text-[13px] font-semibold [font-variant-numeric:tabular-nums] truncate",
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
    </Link>
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

function FilterTab({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 px-2 py-2 transition-colors",
        active ? "bg-brand-50 text-brand-700 font-semibold" : "text-ink-600 hover:bg-ink-50",
      )}
    >
      {label}
    </button>
  )
}

/** Map warning text -> drill-down href. Bullet jadi clickable kalau
 *  cocok salah satu pattern. Audit 2026-06-02 user req: warning yg
 *  cuma teks tdk actionable -- "9 proyek minus", "3 overbudget" perlu
 *  cara liat proyek mana saja. */
function warningHref(w: string): string | null {
  const t = w.toLowerCase()
  if (t.includes("bersaldo minus")) return "/projects?health=minus"
  if (t.includes("overbudget")) return "/projects?budget_status=overbudget"
  if (t.includes("mendekati batas")) return "/projects?budget_status=mendekati_batas"
  if (t.includes("invoice overdue")) return "/invoices?status=OVERDUE"
  if (t.includes("transaksi belum diverifikasi"))
    return "/transactions?status=DRAFT&status=SUBMITTED"
  if (t.includes("belum dialokasi"))
    return "/transactions?unlinked=true"
  return null
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
        {warnings.map((w, i) => {
          const href = warningHref(w)
          return (
            <li key={`${i}:${w}`}>
              {href ? (
                <Link
                  to={href}
                  className="text-warning-800 underline-offset-2 hover:underline hover:text-warning-900"
                >
                  {w} →
                </Link>
              ) : (
                w
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ============================================================
// Helpers
// ============================================================
function Page({ children }: { children: React.ReactNode }) {
  // `min-w-0` + `overflow-x-hidden` defensif: kalau ada child (tabel,
  // chart, badge dgn long-text) yg punya min-width >viewport, page
  // tetap clipped & tdk push card lain jadi overflow.
  return (
    <div className="flex flex-col gap-4 p-3 sm:p-5 lg:p-6 min-w-0 overflow-x-hidden">
      {children}
    </div>
  )
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


// ============================================================
// AI Insights Panel (audit 2026-05-23 UX integration AI-5/6/8)
// ============================================================
function AIInsightsPanel() {
  const role = useAuthStore((s) => s.user?.role)
  const isAdmin = role === "SUPERADMIN" || role === "CENTRAL_ADMIN"
  if (!isAdmin) return null
  return (
    <section className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <AskQueryCard />
      <DailySummaryCard />
      <AnomalyCard />
    </section>
  )
}

function AskQueryCard() {
  const ask = useAskQuery()
  const [q, setQ] = useState("")
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (q.trim().length < 3) return
    try {
      await ask.mutateAsync({ question: q.trim() })
    } catch (err) {
      toast.error("AI gagal", { description: apiErrorMessage(err) })
    }
  }
  return (
    <div className="rounded-md border bg-surface p-4">
      <div className="flex items-center gap-2 text-sm font-semibold mb-2">
        <Search className="h-4 w-4 text-brand-600" />
        Tanya Laporan (AI)
      </div>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Mis. Top vendor bulan ini, atau Saldo Q1 2026"
          disabled={ask.isPending}
        />
        <Button type="submit" size="sm" disabled={ask.isPending || q.trim().length < 3}>
          {ask.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </form>
      {ask.data && (
        <div className="mt-3 space-y-2">
          {ask.data.template === "none" ? (
            <div className="rounded border bg-warning-50 px-3 py-2 text-[12px] text-warning-900">
              <div>{ask.data.reason}</div>
              {ask.data.follow_up && (
                <div className="mt-1 italic">💡 {ask.data.follow_up}</div>
              )}
            </div>
          ) : (
            <>
              <div className="text-[11px] text-ink-500">{ask.data.reason}</div>
              {ask.data.data && (
                <div className="overflow-x-auto rounded border">
                  <table className="w-full text-[12px]">
                    <thead className="bg-ink-50">
                      <tr>
                        {ask.data.data.columns.map((c) => (
                          <th key={c} className="px-2 py-1.5 text-left font-medium">{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {ask.data.data.data.slice(0, 10).map((row, i) => (
                        <tr key={i} className="border-t">
                          {row.map((cell, j) => (
                            <td key={j} className="px-2 py-1.5">
                              {typeof cell === "number" ? fmtIDR(cell) : String(cell)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function DailySummaryCard() {
  const summary = useDailySummary()
  const handleClick = async () => {
    try {
      await summary.mutateAsync({})
    } catch (err) {
      toast.error("AI gagal", { description: apiErrorMessage(err) })
    }
  }
  return (
    <div className="rounded-md border bg-surface p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-brand-600" />
          Ringkasan Hari Ini (AI)
        </div>
        <Button
          type="button"
          variant={summary.data ? "outline" : "primary"}
          size="sm"
          onClick={handleClick}
          disabled={summary.isPending}
        >
          {summary.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {summary.data ? "Refresh" : "Ringkas"}
        </Button>
      </div>
      {summary.data && (
        <div className="text-sm text-ink-800 whitespace-pre-wrap">
          {summary.data.text}
        </div>
      )}
    </div>
  )
}

function AnomalyCard() {
  const scan = useScanAnomalies()
  const handleClick = async () => {
    // Default: 30 hari terakhir
    const today = new Date()
    const monthAgo = new Date(today.getTime() - 30 * 86400_000)
    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    try {
      await scan.mutateAsync({
        date_from: fmt(monthAgo),
        date_to: fmt(today),
      })
    } catch (err) {
      toast.error("AI gagal", { description: apiErrorMessage(err) })
    }
  }
  return (
    <div className="rounded-md border bg-surface p-4 md:col-span-2">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Shield className="h-4 w-4 text-warning-600" />
          Deteksi Anomali 30 Hari Terakhir (AI)
        </div>
        <Button
          type="button"
          variant={scan.data ? "outline" : "primary"}
          size="sm"
          onClick={handleClick}
          disabled={scan.isPending}
        >
          {scan.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
          {scan.data ? "Scan Ulang" : "Scan"}
        </Button>
      </div>
      {scan.data && (
        <div className="space-y-2">
          <div className="text-[12px] text-ink-600">{scan.data.summary}</div>
          {scan.data.flagged.length === 0 ? (
            <div className="rounded border bg-success-50 px-3 py-2 text-sm text-success-900">
              Tdk ada anomali terdeteksi.
            </div>
          ) : (
            <ul className="divide-y rounded border">
              {scan.data.flagged.map((f) => (
                <AnomalyRow key={f.tx_id} flag={f} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function AnomalyRow({ flag }: { flag: AnomalyFlag }) {
  const sevColor =
    flag.severity === "high"
      ? "bg-danger-100 text-danger-800"
      : flag.severity === "medium"
      ? "bg-warning-100 text-warning-800"
      : "bg-ink-100 text-ink-700"
  return (
    <li className="flex items-start gap-3 p-2.5">
      <span className={cn("rounded px-2 py-0.5 text-[10px] font-semibold uppercase shrink-0", sevColor)}>
        {flag.severity}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-medium text-ink-800">
          {flag.anomaly_type} ·{" "}
          <Link
            to={`/transactions/${flag.tx_id}`}
            className="text-brand-600 hover:underline"
          >
            TX #{flag.tx_id}
          </Link>
        </div>
        <div className="text-[12px] text-ink-600">{flag.reason}</div>
      </div>
    </li>
  )
}
