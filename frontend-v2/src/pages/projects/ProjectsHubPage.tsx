import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { Building2, ClipboardList, FolderKanban, Plus, Search } from "lucide-react"
import {
  useProjectFilters,
  useProjectsStats,
  type ProjectStats,
} from "@/hooks/useProjectsStats"
import { useCompanies } from "@/hooks/useCompanies"
import { useProposalCount } from "@/hooks/useProjectProposals"
import { useAuthStore } from "@/store/auth"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Combobox } from "@/components/forms/Combobox"
import { MultiCombobox } from "@/components/forms/MultiCombobox"
import { ErrorState } from "@/components/data/ErrorState"
import { ProjectProposalForm } from "@/components/domain/project/ProjectProposalForm"
import { fmtIDR } from "@/lib/format"
import { apiErrorMessage } from "@/lib/api"
import { cn } from "@/lib/utils"

/**
 * Halaman Proyek (operasional, bukan master CRUD).
 *
 * Beda dari /master/projects: di sini setiap kartu menampilkan ringkasan
 * keuangan (cashflow, budget, invoice open) dan klik kartu langsung
 * masuk ke dashboard proyek (/projects/:id) -- entry point cepat utk
 * konteks proyek di mobile.
 *
 * Master CRUD (tambah/edit/hapus) tetap di /master/projects.
 */
export function ProjectsHubPage() {
  const role = useAuthStore((s) => s.user?.role)
  const isAdmin = role === "SUPERADMIN" || role === "CENTRAL_ADMIN"
  const canPropose = role !== "EXECUTIVE"

  const [q, setQ] = useState("")
  const [companyId, setCompanyId] = useState<number | null>(null)
  // Multi-select: lokasi, dinas, pendana bisa pilih > 1 sekaligus.
  const [locations, setLocations] = useState<string[]>([])
  const [clientNames, setClientNames] = useState<string[]>([])
  const [funderIds, setFunderIds] = useState<number[]>([])
  const [statusFilter, setStatusFilter] = useState<"AKTIF" | "ALL">("AKTIF")
  const [proposeOpen, setProposeOpen] = useState(false)

  // Pending proposal count (admin saja -- 403 utk non-admin, queryClient
  // tetap retry-disabled supaya tdk spam log).
  const proposalCountQ = useProposalCount()
  const pendingCount = isAdmin ? proposalCountQ.data?.count ?? 0 : 0

  const params = useMemo(
    () => ({
      q: q.trim() || undefined,
      company_id: companyId ?? undefined,
      location: locations.length ? locations : undefined,
      client_name: clientNames.length ? clientNames : undefined,
      funder_id: funderIds.length ? funderIds : undefined,
      status: statusFilter === "ALL" ? undefined : statusFilter,
    }),
    [q, companyId, locations, clientNames, funderIds, statusFilter],
  )

  const projectsQ = useProjectsStats(params)
  const companiesQ = useCompanies()
  const filtersQ = useProjectFilters()

  if (projectsQ.error) {
    return (
      <div className="p-3 sm:p-5 lg:p-6">
        <ErrorState
          description={apiErrorMessage(projectsQ.error)}
          onRetry={() => projectsQ.refetch()}
        />
      </div>
    )
  }

  const items = projectsQ.data ?? []

  return (
    <div className="flex flex-col gap-3 p-3 sm:p-5 lg:p-6 max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink-900 sm:text-2xl">Proyek</h1>
          <p className="text-[12px] text-ink-500 mt-0.5">
            Pilih proyek untuk lihat dashboard dan akses cepat ke transaksi/invoice.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && pendingCount > 0 && (
            <Link to="/projects/approval-queue">
              <Button variant="secondary" size="md">
                <ClipboardList className="h-4 w-4" />
                Antrian Proposal
                <span className="ml-1 rounded-full bg-warning-500 text-white px-1.5 py-0.5 text-[10px] font-bold">
                  {pendingCount}
                </span>
              </Button>
            </Link>
          )}
          {isAdmin && pendingCount === 0 && (
            <Link to="/projects/approval-queue">
              <Button variant="secondary" size="md">
                <ClipboardList className="h-4 w-4" />
                Antrian Proposal
              </Button>
            </Link>
          )}
          {canPropose && (
            <Button onClick={() => setProposeOpen(true)} size="md">
              <Plus className="h-4 w-4" />
              Ajukan Proyek
            </Button>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <div className="rounded-md border bg-surface p-2.5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
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
            active={statusFilter === "AKTIF"}
            onClick={() => setStatusFilter("AKTIF")}
          />
          <FilterTab
            label="Semua"
            active={statusFilter === "ALL"}
            onClick={() => setStatusFilter("ALL")}
          />
        </div>
      </div>

      {projectsQ.isLoading ? (
        <div className="grid gap-2.5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-md border border-dashed bg-surface p-10 text-center text-[13px] text-ink-500">
          {q || companyId
            ? "Tidak ada proyek yang cocok dgn filter."
            : "Belum ada proyek. Tambahkan dari menu Lainnya → Proyek (master)."}
        </div>
      ) : (
        <div className="grid gap-2.5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((p) => (
            <ProjectCard key={p.id} p={p} />
          ))}
        </div>
      )}

      <ProjectProposalForm
        open={proposeOpen}
        onClose={() => setProposeOpen(false)}
      />
    </div>
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

function ProjectCard({ p }: { p: ProjectStats }) {
  const tone = healthTone(p.health)
  const budgetTone = budgetTone_(p.budget.status)

  return (
    <Link
      to={`/projects/${p.id}`}
      className="group flex flex-col gap-2.5 rounded-md border bg-surface p-3 hover:border-brand-300 hover:shadow-sm active:bg-ink-50 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0 flex-1">
          <div className="grid h-8 w-8 place-items-center rounded bg-brand-50 text-brand-600 shrink-0">
            <FolderKanban className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate group-hover:text-brand-700">
              {p.name}
            </div>
            <div className="text-[11px] text-ink-500 truncate flex items-center gap-1">
              <span className="font-mono">{p.code}</span>
              {p.company && (
                <>
                  <span>·</span>
                  <Building2 className="h-3 w-3 shrink-0" />
                  <span className="truncate">{p.company}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <Badge tone={tone}>{healthLabel(p.health)}</Badge>
      </div>

      {/* Cashflow grid */}
      <div className="grid grid-cols-3 gap-2 text-[11px] border-t pt-2">
        <Stat label="Masuk" value={fmtIDR(p.total_in)} positive />
        <Stat label="Keluar" value={fmtIDR(p.total_out)} negative />
        <Stat
          label="Saldo"
          value={fmtIDR(p.balance)}
          tone={p.balance < 0 ? "danger" : "default"}
        />
      </div>

      {/* Budget bar */}
      {p.budget.amount > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-ink-500">Budget</span>
            <span data-num className="font-mono text-ink-700">
              {p.budget.usage_pct.toFixed(1)}%
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-ink-100 overflow-hidden">
            <div
              className={cn(
                "h-full transition-all",
                budgetTone === "success" && "bg-success-500",
                budgetTone === "warning" && "bg-warning-500",
                budgetTone === "danger" && "bg-danger-500",
                budgetTone === "neutral" && "bg-ink-400",
              )}
              style={{ width: `${Math.min(100, p.budget.usage_pct)}%` }}
            />
          </div>
          <div className="text-[10px] text-ink-500 font-mono">
            {fmtIDR(p.budget.spent)} / {fmtIDR(p.budget.amount)}
          </div>
        </div>
      )}

      {p.invoice_open > 0 && (
        <div className="text-[11px] text-info-700 bg-info-50 rounded px-2 py-1">
          Invoice open: <span className="font-mono font-semibold">{fmtIDR(p.invoice_open)}</span>
        </div>
      )}
    </Link>
  )
}

function Stat({
  label,
  value,
  positive,
  negative,
  tone,
}: {
  label: string
  value: string
  positive?: boolean
  negative?: boolean
  tone?: "default" | "danger"
}) {
  return (
    <div className="min-w-0">
      <div className="text-ink-500">{label}</div>
      <div
        data-num
        className={cn(
          "font-mono font-semibold truncate [font-variant-numeric:tabular-nums]",
          positive && "text-success-700",
          negative && "text-danger-700",
          tone === "danger" && "text-danger-700",
        )}
        title={value}
      >
        {value}
      </div>
    </div>
  )
}

function healthTone(h: string): "success" | "warning" | "danger" | "neutral" {
  if (h === "sehat") return "success"
  if (h === "minus") return "danger"
  if (h === "waspada" || h === "perhatian") return "warning"
  return "neutral"
}

function healthLabel(h: string): string {
  if (h === "sehat") return "Sehat"
  if (h === "minus") return "Minus"
  if (h === "waspada" || h === "perhatian") return "Waspada"
  return h
}

function budgetTone_(s: string): "success" | "warning" | "danger" | "neutral" {
  if (s === "aman" || s === "budget_aman") return "success"
  if (s === "mendekati_batas") return "warning"
  if (s === "overbudget") return "danger"
  return "neutral"
}
