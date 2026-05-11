import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  Clock,
  FileText,
  FolderKanban,
  Link2Off,
  Loader2,
  Paperclip,
  Plus,
  Receipt,
  ShoppingCart,
  UserMinus,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react"
import { useProject } from "@/hooks/useProjects"
import { useProjectDashboard } from "@/hooks/useDashboard"
import { useTransactions } from "@/hooks/useTransactions"
import {
  useDeleteProjectAttachment,
  useLinkProjectAttachment,
  useProjectAttachments,
  useUploadProjectAttachment,
  type ProjectAttachment,
} from "@/hooks/useProjectAttachments"
import { useProjectUsers, type ProjectMember } from "@/hooks/useProjectUsers"
import { useAssignProject, useUnassignProject, useUsers } from "@/hooks/useUsers"
import { useUIPrefs } from "@/store/ui-prefs"
import { useAuthStore } from "@/store/auth"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ErrorState } from "@/components/data/ErrorState"
import { TransactionForm } from "@/components/domain/transaction/TransactionForm"
import { InvoiceForm } from "@/components/domain/invoice/InvoiceForm"
import { POForm } from "@/components/domain/po/POForm"
import { CashflowChart } from "@/components/charts/CashflowChart"
import { SpendingBreakdown } from "@/components/domain/dashboard/SpendingBreakdown"
import { AttachmentList } from "@/components/domain/shared/AttachmentList"
import { AttachmentUploader } from "@/components/forms/AttachmentUploader"
import { Combobox, type ComboboxOption } from "@/components/forms/Combobox"
import { toast } from "@/components/ui/sonner"
import { fmtCompact, fmtDate, fmtIDR } from "@/lib/format"
import { apiErrorMessage } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { Attachment } from "@/types/api"

/**
 * Halaman tunggal proyek -- canonical view utk konteks 1 proyek.
 *
 * Berisi: header, quick-add (Tx/Invoice/PO modal), cashflow stats,
 * budget bar, alert, finance breakdown (DPP/PPn/profit), cashflow
 * bulanan chart, pengeluaran per kategori, invoice list, recent
 * transaksi, tim, dan lampiran proyek.
 *
 * Sebelumnya halaman terpisah antara dashboard (/projects/:id) dan
 * detail master (/master/projects/:id) -- sekarang /master/projects/:id
 * redirect ke sini supaya tampilan konsisten.
 */
export function ProjectDashboardPage() {
  const { id } = useParams<{ id: string }>()
  const projectId = Number(id)
  const setDefaultProject = useUIPrefs((s) => s.setDefaultProject)
  const role = useAuthStore((s) => s.user?.role)
  const canWrite = role !== "EXECUTIVE"
  const isAdmin = role === "SUPERADMIN" || role === "CENTRAL_ADMIN"

  const projectQ = useProject(projectId)
  const dashQ = useProjectDashboard(projectId)
  const recentTxQ = useTransactions({ project_id: projectId, size: 8 })

  const [txFormOpen, setTxFormOpen] = useState(false)
  const [invFormOpen, setInvFormOpen] = useState(false)
  const [poFormOpen, setPoFormOpen] = useState(false)

  // Saat masuk ke halaman, sync ProjectSwitcher supaya konteks proyek
  // konsisten antar halaman (transaksi/invoice/PO list akan ikut filter).
  useEffect(() => {
    if (projectId > 0) setDefaultProject(projectId)
  }, [projectId, setDefaultProject])

  if (projectQ.isLoading || dashQ.isLoading) {
    return (
      <div className="p-3 sm:p-5 lg:p-6 space-y-3 max-w-4xl">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-12 w-full" />
        <div className="grid grid-cols-2 gap-2.5">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  const err = projectQ.error || dashQ.error
  if (err) {
    return (
      <div className="p-4 sm:p-6 max-w-4xl">
        <ErrorState
          description={apiErrorMessage(err)}
          onRetry={() => {
            projectQ.refetch()
            dashQ.refetch()
          }}
        />
      </div>
    )
  }
  if (!projectQ.data || !dashQ.data) return null

  const project = projectQ.data
  const dash = dashQ.data
  const health = typeof dash.health === "string" ? dash.health : dash.health?.status ?? "sehat"

  return (
    <>
      <div className="flex flex-col gap-3 p-3 sm:p-5 lg:p-6 max-w-4xl">
        {/* HEADER */}
        <div>
          <Link
            to="/projects"
            className="inline-flex items-center gap-1 text-[12px] text-ink-500 hover:text-ink-700"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Kembali ke daftar proyek
          </Link>
          <div className="mt-2 flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <div className="flex h-10 w-10 items-center justify-center rounded bg-brand-50 text-brand-600 shrink-0">
                <FolderKanban className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h1 className="text-xl font-bold text-ink-900 sm:text-2xl truncate">
                  {project.name}
                </h1>
                <div className="flex items-center gap-2 flex-wrap mt-0.5 text-[12px] text-ink-500">
                  <span className="font-mono">{project.code}</span>
                  {project.location && (
                    <>
                      <span>·</span>
                      <span>{project.location}</span>
                    </>
                  )}
                  {project.company_name && (
                    <>
                      <span>·</span>
                      <Building2 className="h-3 w-3" />
                      <span>{project.company_name}</span>
                    </>
                  )}
                </div>
                {project.client_name && (
                  <div className="text-[12px] text-ink-500 mt-0.5">
                    Klien: <span className="font-medium text-ink-700">{project.client_name}</span>
                  </div>
                )}
              </div>
            </div>
            <Badge tone={healthTone(health)}>{healthLabel(health)}</Badge>
          </div>
        </div>

        {/* QUICK ACTIONS */}
        {canWrite && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <QuickAction
              icon={Receipt}
              label="Transaksi"
              hint="Catat masuk/keluar"
              onClick={() => setTxFormOpen(true)}
              primary
            />
            <QuickAction
              icon={FileText}
              label="Invoice"
              hint="Hutang / Piutang"
              onClick={() => setInvFormOpen(true)}
            />
            <QuickAction
              icon={ShoppingCart}
              label="Purchase Order"
              hint="Buat PO baru"
              onClick={() => setPoFormOpen(true)}
            />
            <QuickAction
              icon={Wallet}
              label="Lihat Semua"
              hint="Transaksi proyek"
              to={`/transactions?project_id=${projectId}`}
            />
          </div>
        )}

        {/* CASHFLOW STATS */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <StatCard label="Masuk" value={fmtCompact(dash.totals.in)} tone="success" />
          <StatCard label="Keluar" value={fmtCompact(dash.totals.out)} tone="danger" />
          <StatCard
            label="Saldo"
            value={fmtCompact(dash.totals.balance)}
            tone={dash.totals.balance < 0 ? "danger" : "default"}
          />
          <StatCard
            label="Rasio Keluar/Masuk"
            value={
              dash.expense_to_income_ratio_pct == null
                ? "—"
                : `${dash.expense_to_income_ratio_pct.toFixed(1)}%`
            }
          />
        </div>

        {/* BUDGET */}
        {dash.budget.amount > 0 && (
          <Section title="Budget Pengeluaran">
            <div className="flex items-baseline justify-between gap-2 px-3 sm:px-4 pt-3">
              <div>
                <div className="text-base font-semibold tabular-nums">
                  {fmtIDR(dash.budget.spent)}{" "}
                  <span className="text-[12px] text-ink-500 font-normal">
                    / {fmtIDR(dash.budget.amount)}
                  </span>
                </div>
              </div>
              <Badge tone={budgetTone_(dash.budget.status)}>
                {budgetLabel(dash.budget.status)}
              </Badge>
            </div>
            <div className="px-3 sm:px-4 pb-3 mt-2 space-y-1.5">
              <div className="h-2 rounded-full bg-ink-100 overflow-hidden">
                <div
                  className={cn(
                    "h-full transition-all",
                    budgetTone_(dash.budget.status) === "success" && "bg-success-500",
                    budgetTone_(dash.budget.status) === "warning" && "bg-warning-500",
                    budgetTone_(dash.budget.status) === "danger" && "bg-danger-500",
                    budgetTone_(dash.budget.status) === "neutral" && "bg-ink-400",
                  )}
                  style={{ width: `${Math.min(100, dash.budget.usage_pct)}%` }}
                />
              </div>
              <div className="text-[11px] text-ink-500">
                Sisa: <span className="font-mono">{fmtIDR(dash.budget.remaining)}</span> ·{" "}
                <span className="font-mono">{dash.budget.usage_pct.toFixed(1)}%</span> terpakai
              </div>
            </div>
          </Section>
        )}

        {/* ALERT BAR (pending + unlinked) */}
        {(dash.pending_count > 0 || dash.unlinked_out_count > 0) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {dash.pending_count > 0 && (
              <Link
                to={`/transactions?project_id=${projectId}&status=DRAFT`}
                className="rounded-md border border-warning-200 bg-warning-50 p-3 hover:bg-warning-100 active:bg-warning-100/70"
              >
                <div className="flex items-start gap-2">
                  <Clock className="h-5 w-5 text-warning-600 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-[11px] uppercase font-semibold text-warning-700">
                      Belum Verifikasi
                    </div>
                    <div className="text-base font-bold tabular-nums text-warning-900 mt-0.5">
                      {dash.pending_count} txn
                    </div>
                    <div className="text-[11px] text-warning-800 tabular-nums truncate">
                      {fmtIDR(dash.pending_total)}
                    </div>
                  </div>
                </div>
              </Link>
            )}
            {dash.unlinked_out_count > 0 && (
              <Link
                to={`/transactions?project_id=${projectId}&type=OUT`}
                className="rounded-md border border-info-200 bg-info-50 p-3 hover:bg-info-100 active:bg-info-100/70"
              >
                <div className="flex items-start gap-2">
                  <Link2Off className="h-5 w-5 text-info-600 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-[11px] uppercase font-semibold text-info-700">
                      Belum Dialokasi
                    </div>
                    <div className="text-base font-bold tabular-nums text-info-900 mt-0.5">
                      {dash.unlinked_out_count} txn
                    </div>
                    <div className="text-[11px] text-info-800 tabular-nums truncate">
                      {fmtIDR(dash.unlinked_out_total)}
                    </div>
                  </div>
                </div>
              </Link>
            )}
          </div>
        )}

        {/* WARNINGS */}
        {dash.warnings?.length > 0 && (
          <div className="rounded-md border border-warning-200 bg-warning-50 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-warning-600 shrink-0 mt-0.5" />
              <ul className="text-[12px] text-warning-800 list-disc list-inside space-y-0.5">
                {dash.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* RINCIAN KEUANGAN -- selalu muncul section, isi conditional */}
        <Section
          title="Rincian Keuangan"
          subtitle={
            dash.finance && dash.finance.nilai_kontrak > 0
              ? `PPn ${dash.finance.ppn_pct}% · PPh ${dash.finance.pph_pct}% · Mkt ${dash.finance.marketing_pct}%`
              : undefined
          }
        >
          {dash.finance && dash.finance.nilai_kontrak > 0 ? (
            <FinanceTable f={dash.finance} />
          ) : (
            <EmptyHint>
              Belum ada nilai kontrak. Tambahkan <em>Nilai Kontrak</em> di edit
              proyek supaya rincian DPP/PPn/PPh/profit muncul di sini.
            </EmptyHint>
          )}
        </Section>

        {/* CASHFLOW BULANAN */}
        <Section title="Cashflow Bulanan">
          {dash.monthly_cashflow.length > 0 ? (
            <div className="px-3 sm:px-4 pb-3 pt-2">
              <CashflowChart data={dash.monthly_cashflow} height={220} compact />
            </div>
          ) : (
            <EmptyHint>Belum ada data cashflow.</EmptyHint>
          )}
        </Section>

        {/* PENGELUARAN PER KATEGORI */}
        <Section title="Pengeluaran per Kategori">
          {dash.by_category.length > 0 ? (
            <div className="px-3 sm:px-4 pb-3 pt-2">
              <SpendingBreakdown
                total={dash.totals.out}
                items={dash.by_category.map((c) => ({ name: c.category, value: c.total }))}
                chartHeight={180}
                limit={8}
              />
            </div>
          ) : (
            <EmptyHint>Belum ada pengeluaran ter-kategorisasi.</EmptyHint>
          )}
        </Section>

        {/* INVOICE SUMMARY */}
        <div className="grid grid-cols-2 gap-2.5">
          <SummaryRow
            label="Invoice Belum Lunas"
            value={fmtIDR(dash.invoice_open_total)}
            to={`/invoices?project_id=${projectId}&status=ISSUED`}
          />
          <SummaryRow
            label="Invoice Lunas"
            value={fmtIDR(dash.invoice_paid_total)}
            tone="success"
            to={`/invoices?project_id=${projectId}&status=PAID`}
          />
        </div>

        {/* INVOICE LIST */}
        <Section
          title="Invoice Proyek"
          right={
            <Link
              to={`/invoices?project_id=${projectId}`}
              className="text-[11px] text-brand-600 hover:underline"
            >
              Lihat semua
            </Link>
          }
        >
          {dash.invoices.length === 0 ? (
            <EmptyHint>Belum ada invoice.</EmptyHint>
          ) : (
            <div className="divide-y">
              {dash.invoices.slice(0, 5).map((inv) => {
                const isPiutang = inv.type === "OUT"
                const total = Number(inv.total || 0)
                const paid = Number(inv.paid_amount || 0)
                const pct = total > 0 ? Math.min(100, (paid / total) * 100) : 0
                return (
                  <Link
                    key={inv.id}
                    to={`/invoices?id=${inv.id}`}
                    className="block px-3 sm:px-4 py-2.5 hover:bg-ink-50"
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          "h-8 w-8 shrink-0 rounded-full grid place-items-center text-[11px] font-bold",
                          isPiutang
                            ? "bg-success-100 text-success-700"
                            : "bg-danger-100 text-danger-700",
                        )}
                      >
                        {isPiutang ? "P" : "H"}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">
                          INV {inv.number}
                        </div>
                        <div className="text-[11px] text-ink-500 truncate">
                          {fmtDate(inv.invoice_date)}
                          {inv.due_date && ` · jatuh tempo ${fmtDate(inv.due_date)}`}
                          {inv.party_name ? ` · ${inv.party_name}` : ""}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div
                          data-num
                          className="font-mono text-sm font-semibold [font-variant-numeric:tabular-nums]"
                        >
                          {fmtIDR(total)}
                        </div>
                        <Badge tone={invoiceTone(inv.status)}>{inv.status}</Badge>
                      </div>
                    </div>
                    {total > 0 && (
                      <div className="mt-1.5 h-1 rounded-full bg-ink-100 overflow-hidden">
                        <div
                          className="h-full bg-success-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    )}
                  </Link>
                )
              })}
            </div>
          )}
        </Section>

        {/* RECENT TRANSACTIONS */}
        <Section
          title="Transaksi Terbaru"
          right={
            <Link
              to={`/transactions?project_id=${projectId}`}
              className="text-[11px] text-brand-600 hover:underline"
            >
              Lihat semua
            </Link>
          }
        >
          {recentTxQ.isLoading ? (
            <div className="p-4 space-y-2">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : (recentTxQ.data?.items?.length ?? 0) === 0 ? (
            <EmptyHint>Belum ada transaksi.</EmptyHint>
          ) : (
            <div className="divide-y">
              {recentTxQ.data!.items.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center gap-3 px-3 sm:px-4 py-2.5"
                >
                  <div
                    className={cn(
                      "h-8 w-8 shrink-0 rounded-full grid place-items-center text-sm font-semibold",
                      t.type === "IN"
                        ? "bg-success-100 text-success-700"
                        : "bg-danger-100 text-danger-700",
                    )}
                  >
                    {t.type === "IN" ? "+" : "−"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">
                      {t.description || t.party_name || "Transaksi"}
                    </div>
                    <div className="text-[11px] text-ink-500">
                      {fmtDate(t.tx_date)} · {t.payment_method}
                    </div>
                  </div>
                  <div
                    data-num
                    className={cn(
                      "font-mono text-sm font-semibold shrink-0 [font-variant-numeric:tabular-nums]",
                      t.type === "IN" ? "text-success-700" : "text-danger-700",
                    )}
                  >
                    {fmtIDR(t.amount)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* TIM PROYEK */}
        <ProjectTeamSection projectId={projectId} isAdmin={isAdmin} />

        {/* LAMPIRAN */}
        <ProjectAttachmentsSection projectId={projectId} isAdmin={isAdmin} />
      </div>

      {/* FORMS dgn project terkunci */}
      <TransactionForm
        open={txFormOpen}
        onClose={() => setTxFormOpen(false)}
        lockProjectId={projectId}
      />
      <InvoiceForm
        open={invFormOpen}
        onClose={() => setInvFormOpen(false)}
        lockProjectId={projectId}
      />
      <POForm
        open={poFormOpen}
        onClose={() => setPoFormOpen(false)}
        lockProjectId={projectId}
      />
    </>
  )
}

// ============================================================
// Sections (selalu render -- isi conditional supaya layout konsisten)
// ============================================================
function Section({
  title,
  subtitle,
  right,
  children,
}: {
  title: string
  subtitle?: string
  right?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="rounded-md border bg-surface">
      <div className="flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5 border-b">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
          {subtitle && (
            <p className="text-[11px] text-ink-500 mt-0.5">{subtitle}</p>
          )}
        </div>
        {right}
      </div>
      {children}
    </div>
  )
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 sm:px-4 py-6 text-center text-[12px] text-ink-500">
      {children}
    </div>
  )
}

function FinanceTable({
  f,
}: {
  f: NonNullable<ReturnType<typeof useProjectDashboard>["data"]>["finance"] & object
}) {
  const Row = ({
    label,
    value,
    negative,
    highlight,
  }: {
    label: React.ReactNode
    value: number
    negative?: boolean
    highlight?: "good" | "bad"
  }) => (
    <li
      className={cn(
        "flex items-baseline justify-between gap-2 px-3 sm:px-4 py-1.5",
        highlight === "good" && "bg-success-50",
        highlight === "bad" && "bg-danger-50",
      )}
    >
      <span className="text-[12px] text-ink-700">{label}</span>
      <span
        data-num
        className={cn(
          "font-mono text-[13px] [font-variant-numeric:tabular-nums]",
          negative && "text-danger-700",
          highlight === "good" && "font-bold text-success-800",
          highlight === "bad" && "font-bold text-danger-800",
          !highlight && !negative && "font-semibold",
        )}
      >
        {negative && "− "}
        {fmtIDR(Math.abs(value))}
      </span>
    </li>
  )
  return (
    <div className="pb-3 pt-1">
      <ul className="divide-y">
        <Row label="Nilai Kontrak" value={f.nilai_kontrak} />
        <Row label="DPP" value={f.dpp} />
        <Row label={`PPn (${f.ppn_pct}%)`} value={f.ppn} negative />
        <Row label={`PPh (${f.pph_pct}%)`} value={f.pph} negative />
        <Row label="Nilai Cair" value={f.nilai_cair} highlight="good" />
        <Row label={`Marketing (${f.marketing_pct}%)`} value={f.marketing} negative />
        <Row label="Biaya Aktual (realisasi)" value={f.biaya_aktual} negative />
        <Row label="Biaya Proyeksi (target)" value={f.biaya_proyeksi} negative />
        <Row
          label="Profit Saat Ini"
          value={f.profit_now}
          highlight={f.profit_now < 0 ? "bad" : "good"}
        />
        <Row
          label="Profit Proyeksi"
          value={f.profit_proj}
          highlight={f.profit_proj < 0 ? "bad" : "good"}
        />
      </ul>
      <p className="px-3 sm:px-4 mt-2 text-[11px] text-ink-500 leading-relaxed">
        DPP = Nilai Kontrak ÷ (1 + PPn%). Profit Saat Ini pakai realisasi
        pengeluaran; Profit Proyeksi pakai target pengeluaran (budget).
        Persentase pajak & marketing diatur di edit proyek.
      </p>
    </div>
  )
}

// ============================================================
// Tim section (di-extract dr ProjectDetailPage lama)
// ============================================================
function ProjectTeamSection({
  projectId,
  isAdmin,
}: {
  projectId: number
  isAdmin: boolean
}) {
  const teamQ = useProjectUsers(projectId)
  const usersQ = useUsers()
  const assign = useAssignProject()
  const unassign = useUnassignProject()
  const [addOpen, setAddOpen] = useState(false)
  const [pickedUserId, setPickedUserId] = useState<number | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<ProjectMember | null>(null)

  const team = teamQ.data ?? []
  const teamIds = new Set(team.map((m) => m.id))
  const allUsers = usersQ.data?.items ?? []
  const candidateOptions: ComboboxOption[] = allUsers
    .filter((u) => !teamIds.has(u.id) && u.is_active && u.role !== "EXECUTIVE")
    .map((u) => ({
      value: u.id,
      label: u.name,
      hint: `${u.email} · ${u.role}`,
    }))

  const handleAssign = async () => {
    if (!pickedUserId) return
    try {
      await assign.mutateAsync({ userId: pickedUserId, projectId })
      toast.success("User ditambahkan ke tim proyek")
      setAddOpen(false)
      setPickedUserId(null)
    } catch (err) {
      toast.error("Gagal menambahkan", { description: apiErrorMessage(err) })
    }
  }

  const handleRemove = async () => {
    if (!confirmRemove) return
    try {
      await unassign.mutateAsync({ userId: confirmRemove.id, projectId })
      toast.success("User dikeluarkan dari tim")
      setConfirmRemove(null)
    } catch (err) {
      toast.error("Gagal mengeluarkan", { description: apiErrorMessage(err) })
    }
  }

  return (
    <>
      <Section
        title="Tim Proyek"
        subtitle={team.length > 0 ? `${team.length} anggota` : undefined}
        right={
          isAdmin && (
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <UserPlus className="h-3.5 w-3.5" />
              Tambah
            </Button>
          )
        }
      >
        {teamQ.isLoading ? (
          <div className="p-3 space-y-2">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : team.length === 0 ? (
          <EmptyHint>
            Belum ada anggota tim. Tambah anggota supaya mereka bisa akses
            transaksi/invoice/PO proyek ini.
          </EmptyHint>
        ) : (
          <ul className="divide-y">
            {team.map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-3 px-3 sm:px-4 py-2.5"
              >
                <Users className="h-4 w-4 text-ink-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{m.name}</div>
                  <div className="text-[11px] text-ink-500 truncate">
                    {m.email} · <span className="font-mono">{m.role}</span>
                  </div>
                </div>
                {isAdmin && m.role !== "SUPERADMIN" && (
                  <button
                    type="button"
                    onClick={() => setConfirmRemove(m)}
                    className="flex h-8 w-8 items-center justify-center rounded text-danger-500 hover:bg-danger-50"
                    aria-label="Keluarkan"
                  >
                    <UserMinus className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Add member dialog */}
      <Dialog open={addOpen} onOpenChange={(o) => !o && setAddOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tambah Anggota Tim</DialogTitle>
            <DialogDescription>
              User akan dapat akses ke transaksi, invoice, dan PO di proyek
              ini. Hanya user aktif & non-EXECUTIVE yang bisa di-assign.
            </DialogDescription>
          </DialogHeader>
          <Combobox
            value={pickedUserId}
            onChange={(v) => setPickedUserId(v == null ? null : Number(v))}
            options={candidateOptions}
            placeholder="Pilih user…"
            sheetTitle="Pilih User"
            emptyMessage="Semua user sudah jadi anggota / tidak ada user aktif."
          />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setAddOpen(false)}>
              Batal
            </Button>
            <Button
              onClick={handleAssign}
              disabled={!pickedUserId || assign.isPending}
            >
              {assign.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              <Plus className="h-4 w-4" />
              Tambahkan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmRemove} onOpenChange={(o) => !o && setConfirmRemove(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Keluarkan dari tim?</DialogTitle>
            <DialogDescription>
              <strong>{confirmRemove?.name}</strong> tdk akan bisa lagi akses
              transaksi/invoice/PO proyek ini. Data yg sudah dibuat user ini
              tetap ada.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmRemove(null)}>
              Batal
            </Button>
            <Button variant="danger" onClick={handleRemove} disabled={unassign.isPending}>
              {unassign.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Ya, Keluarkan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ============================================================
// Lampiran section (di-extract dr ProjectDetailPage lama)
// ============================================================
function ProjectAttachmentsSection({
  projectId,
  isAdmin,
}: {
  projectId: number
  isAdmin: boolean
}) {
  const attQ = useProjectAttachments(projectId)
  const upload = useUploadProjectAttachment()
  const link = useLinkProjectAttachment()
  const del = useDeleteProjectAttachment()
  const attachments: ProjectAttachment[] = attQ.data ?? []

  const asAttachment = (a: ProjectAttachment): Attachment => ({
    id: a.id,
    file_name: a.label || a.file_name,
    file_size: a.file_size,
    mime_type: a.mime_type,
    url: a.url,
    created_at: a.created_at,
  })

  const handleDelete = async (att: Attachment) => {
    try {
      await del.mutateAsync({ projectId, attachmentId: att.id })
      toast.success("Dokumen proyek dihapus")
    } catch (err) {
      toast.error("Gagal menghapus", { description: apiErrorMessage(err) })
    }
  }

  return (
    <Section
      title="Dokumen Proyek"
      subtitle={attachments.length > 0 ? `${attachments.length} file` : undefined}
    >
      <div className="px-3 sm:px-4 py-3 space-y-3">
        {attQ.isLoading ? (
          <Skeleton className="h-24" />
        ) : (
          <AttachmentList
            attachments={attachments.map(asAttachment)}
            canDelete={isAdmin}
            onDelete={handleDelete}
            deletingId={del.isPending ? del.variables?.attachmentId ?? null : null}
            emptyMessage={
              isAdmin
                ? "Belum ada dokumen. Tambah kontrak/BAST/lampiran lain di bawah."
                : "Belum ada dokumen proyek."
            }
          />
        )}
        {isAdmin && (
          <AttachmentUploader
            uploadFile={(file, onProgress) =>
              upload.mutateAsync({ projectId, file, onProgress }).then(() => undefined)
            }
            linkExternal={(url, label) =>
              link.mutateAsync({ projectId, url, label }).then(() => undefined)
            }
            isLinking={link.isPending}
          />
        )}
        {!isAdmin && attachments.length === 0 && (
          <p className="text-[11px] text-ink-500 flex items-center gap-1.5">
            <Paperclip className="h-3 w-3" />
            Hanya admin yang dapat mengelola dokumen proyek.
          </p>
        )}
      </div>
    </Section>
  )
}

// ============================================================
// Helpers
// ============================================================
function QuickAction({
  icon: Icon,
  label,
  hint,
  onClick,
  to,
  primary,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  hint: string
  onClick?: () => void
  to?: string
  primary?: boolean
}) {
  const className = cn(
    "flex flex-col items-center justify-center gap-1 rounded-md border p-3 text-center transition-colors min-h-[88px]",
    primary
      ? "border-brand-200 bg-brand-50 hover:bg-brand-100 text-brand-800"
      : "border-border bg-surface hover:border-brand-200 hover:bg-brand-50/40 text-ink-700",
  )
  const content = (
    <>
      <Icon className={cn("h-5 w-5", primary && "text-brand-600")} />
      <div className="text-[12px] font-semibold leading-tight">{label}</div>
      <div className="text-[10px] text-ink-500 leading-tight">{hint}</div>
    </>
  )
  if (to) {
    return (
      <Link to={to} className={className}>
        {content}
      </Link>
    )
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  )
}

function StatCard({
  label,
  value,
  tone = "default",
}: {
  label: string
  value: string
  tone?: "default" | "success" | "danger"
}) {
  return (
    <div className="rounded-md border bg-surface p-3">
      <div className="text-[11px] uppercase tracking-wider text-ink-500">{label}</div>
      <div
        data-num
        className={cn(
          "mt-1 text-base font-bold font-mono [font-variant-numeric:tabular-nums]",
          tone === "success" && "text-success-700",
          tone === "danger" && "text-danger-700",
        )}
        title={value}
      >
        {value}
      </div>
    </div>
  )
}

function SummaryRow({
  label,
  value,
  tone,
  to,
}: {
  label: string
  value: string
  tone?: "success"
  to: string
}) {
  return (
    <Link
      to={to}
      className="rounded-md border bg-surface p-3 hover:border-brand-300 active:bg-ink-50 transition-colors"
    >
      <div className="text-[11px] uppercase tracking-wider text-ink-500">{label}</div>
      <div
        data-num
        className={cn(
          "mt-1 text-sm font-bold font-mono [font-variant-numeric:tabular-nums]",
          tone === "success" && "text-success-700",
        )}
      >
        {value}
      </div>
    </Link>
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
function budgetLabel(s: string): string {
  if (s === "aman" || s === "budget_aman") return "Aman"
  if (s === "mendekati_batas") return "Mendekati Batas"
  if (s === "overbudget") return "Overbudget"
  return s
}
function invoiceTone(s: string): "success" | "warning" | "danger" | "info" | "neutral" {
  if (s === "PAID") return "success"
  if (s === "OVERDUE") return "danger"
  if (s === "PARTIALLY_PAID") return "warning"
  if (s === "ISSUED") return "info"
  if (s === "CANCELLED") return "neutral"
  return "neutral"
}
