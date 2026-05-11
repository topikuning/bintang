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
  Receipt,
  ShoppingCart,
  Wallet,
} from "lucide-react"
import { useProject } from "@/hooks/useProjects"
import { useProjectDashboard } from "@/hooks/useDashboard"
import { useTransactions } from "@/hooks/useTransactions"
import { useUIPrefs } from "@/store/ui-prefs"
import { useAuthStore } from "@/store/auth"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/data/ErrorState"
import { TransactionForm } from "@/components/domain/transaction/TransactionForm"
import { InvoiceForm } from "@/components/domain/invoice/InvoiceForm"
import { fmtCompact, fmtDate, fmtIDR } from "@/lib/format"
import { apiErrorMessage } from "@/lib/api"
import { cn } from "@/lib/utils"

/**
 * Dashboard scoped ke 1 proyek -- entry point cepat utk:
 *  - Lihat ringkasan keuangan proyek (cashflow, budget, invoice)
 *  - Buat transaksi/invoice langsung dgn project_id terkunci
 *  - Drill ke list transaksi/invoice/PO ter-filter proyek ini
 */
export function ProjectDashboardPage() {
  const { id } = useParams<{ id: string }>()
  const projectId = Number(id)
  const setDefaultProject = useUIPrefs((s) => s.setDefaultProject)
  const role = useAuthStore((s) => s.user?.role)
  const canWrite = role !== "EXECUTIVE"

  const projectQ = useProject(projectId)
  const dashQ = useProjectDashboard(projectId)
  const recentTxQ = useTransactions({ project_id: projectId, size: 8 })

  const [txFormOpen, setTxFormOpen] = useState(false)
  const [invFormOpen, setInvFormOpen] = useState(false)

  // Saat masuk ke halaman ini, sync ProjectSwitcher supaya konteks
  // proyek konsisten antar halaman (transaksi/invoice/PO list akan
  // ikut ter-filter).
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
        {/* Header */}
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
              </div>
            </div>
            <Badge tone={healthTone(health)}>{healthLabel(health)}</Badge>
          </div>
        </div>

        {/* Quick actions -- ENTRY POINT UTAMA dr halaman ini */}
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
              to={`/purchase-orders?project_id=${projectId}&new=1`}
            />
            <QuickAction
              icon={Wallet}
              label="Lihat Semua"
              hint="Transaksi proyek"
              to={`/transactions?project_id=${projectId}`}
            />
          </div>
        )}

        {/* Cashflow stats */}
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

        {/* Budget */}
        {dash.budget.amount > 0 && (
          <div className="rounded-md border bg-surface p-3 sm:p-4 space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <div>
                <div className="text-[12px] uppercase tracking-wider text-ink-500">
                  Budget Pengeluaran
                </div>
                <div className="text-base font-semibold tabular-nums mt-0.5">
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
        )}

        {/* Pending / unlinked alerts */}
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

        {/* Warnings */}
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

        {/* Invoice summary */}
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

        {/* Recent transactions */}
        <div className="rounded-md border bg-surface">
          <div className="flex items-center justify-between px-3 sm:px-4 py-2.5 border-b">
            <h2 className="text-sm font-semibold">Transaksi Terbaru</h2>
            <Link
              to={`/transactions?project_id=${projectId}`}
              className="text-[11px] text-brand-600 hover:underline"
            >
              Lihat semua
            </Link>
          </div>
          <div className="divide-y">
            {recentTxQ.isLoading ? (
              <div className="p-4 space-y-2">
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
              </div>
            ) : (recentTxQ.data?.items?.length ?? 0) === 0 ? (
              <div className="p-6 text-center text-[13px] text-ink-500">
                Belum ada transaksi.
              </div>
            ) : (
              recentTxQ.data!.items.map((t) => (
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
              ))
            )}
          </div>
        </div>
      </div>

      {/* Forms with project locked */}
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
    </>
  )
}

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

