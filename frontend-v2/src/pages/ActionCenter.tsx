import { useMemo } from "react"
import { Link } from "react-router"
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  FileClock,
  ListChecks,
  ReceiptText,
  ShieldCheck,
  ShoppingCart,
} from "lucide-react"
import { useGlobalDashboard } from "@/hooks/useDashboard"
import { useInvoices } from "@/hooks/useInvoices"
import { usePOs } from "@/hooks/usePOs"
import { useCashRequests } from "@/hooks/useCashRequests"
import { useTransactions } from "@/hooks/useTransactions"
import { usePageTitle } from "@/hooks/usePageTitle"
import { useAuthStore } from "@/store/auth"
import { apiErrorMessage } from "@/lib/api"
import { cn } from "@/lib/utils"
import { fmtCompact, fmtIDR } from "@/lib/format"
import { ErrorState } from "@/components/data/ErrorState"
import { Skeleton } from "@/components/ui/skeleton"

interface QueueItem {
  id: string
  title: string
  meta: string
  amount: number
  to: string
  kind: "approval" | "exception"
}

/**
 * A single operational inbox across transactions, requests, PO and invoices.
 * It intentionally contains no mutation controls: users first see the reason,
 * amount and source, then make the decision in the owning domain screen where
 * the complete audit context is available.
 */
export function ActionCenterPage() {
  usePageTitle("Pusat Tindakan")
  const role = useAuthStore((state) => state.user?.role)
  const canApprove = role === "SUPERADMIN" || role === "CENTRAL_ADMIN"

  const dashboardQ = useGlobalDashboard()
  const submittedTxQ = useTransactions({ status: "SUBMITTED", size: 6 })
  const pendingCashQ = useCashRequests({ status: "PENDING", size: 6 })
  const issuedPoQ = usePOs({ status: "ISSUED", size: 6 })
  const overdueInvoiceQ = useInvoices({ status: "OVERDUE", size: 6 })
  const draftTxQ = useTransactions({ status: "DRAFT", size: 1 })
  const draftInvoiceQ = useInvoices({ status: "DRAFT", size: 1 })
  const draftPoQ = usePOs({ status: "DRAFT", size: 1 })

  const approvalItems = useMemo<QueueItem[]>(() => [
    ...(submittedTxQ.data?.items ?? []).map((item) => ({
      id: `tx-${item.id}`,
      title: item.party_name || item.description || `Transaksi #${item.id}`,
      meta: `Transaksi menunggu verifikasi · ${item.tx_date}`,
      amount: Number(item.amount || 0),
      to: `/transactions?id=${item.id}`,
      kind: "approval" as const,
    })),
    ...(pendingCashQ.data?.items ?? []).map((item) => ({
      id: `cr-${item.id}`,
      title: item.title,
      meta: `${item.number} · ${item.requester_name ?? "Pemohon"}`,
      amount: Number(item.total_amount || 0),
      to: `/cash-requests/${item.id}`,
      kind: "approval" as const,
    })),
    ...(issuedPoQ.data?.items ?? []).map((item) => ({
      id: `po-${item.id}`,
      title: item.vendor_client_name || item.vendor_name || item.number,
      meta: `${item.number} · Purchase order diajukan`,
      amount: Number(item.total || 0),
      to: `/purchase-orders?id=${item.id}`,
      kind: "approval" as const,
    })),
  ], [submittedTxQ.data, pendingCashQ.data, issuedPoQ.data])

  const exceptionItems = useMemo<QueueItem[]>(() => [
    ...(overdueInvoiceQ.data?.items ?? []).map((item) => ({
      id: `invoice-${item.id}`,
      title: item.party_name || item.number,
      meta: `${item.number} · jatuh tempo ${item.due_date ?? "belum diisi"}`,
      amount: Number(item.outstanding_amount ?? item.remaining ?? item.total ?? 0),
      to: `/invoices?id=${item.id}`,
      kind: "exception" as const,
    })),
  ], [overdueInvoiceQ.data])

  const error = [
    dashboardQ.error,
    submittedTxQ.error,
    pendingCashQ.error,
    issuedPoQ.error,
    overdueInvoiceQ.error,
  ].find(Boolean)

  if (error) {
    return (
      <Page>
        <ErrorState description={apiErrorMessage(error)} onRetry={() => {
          void dashboardQ.refetch()
          void submittedTxQ.refetch()
          void pendingCashQ.refetch()
          void issuedPoQ.refetch()
          void overdueInvoiceQ.refetch()
        }} />
      </Page>
    )
  }

  const isLoading = [dashboardQ, submittedTxQ, pendingCashQ, issuedPoQ, overdueInvoiceQ]
    .some((query) => query.isLoading)
  const approvalTotal = approvalItems.reduce((sum, item) => sum + item.amount, 0)
  const exceptionTotal = exceptionItems.reduce((sum, item) => sum + item.amount, 0)
  const taskCount = (submittedTxQ.data?.total ?? 0)
    + (pendingCashQ.data?.total ?? 0)
    + (issuedPoQ.data?.total ?? 0)
    + (overdueInvoiceQ.data?.total ?? 0)
    + (dashboardQ.data?.unlinked_out_count ?? 0)

  if (isLoading) return <ActionCenterSkeleton />

  return (
    <Page>
      <section className="overflow-hidden rounded-2xl bg-ink-900 text-white shadow-[0_24px_70px_rgb(15_23_42/0.18)]">
        <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[1.4fr_1fr] lg:p-8">
          <div className="max-w-2xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-200">
              <ListChecks className="h-3.5 w-3.5" /> Pusat Tindakan
            </div>
            <h1 className="max-w-xl text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              {taskCount === 0 ? "Operasional dalam kendali." : `${taskCount} hal membutuhkan perhatian.`}
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">
              Prioritas lintas transaksi, pengajuan dana, purchase order, dan invoice—disusun berdasarkan keputusan dan risiko, bukan berdasarkan modul.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 self-end">
            <HeroMetric label="Nilai perlu keputusan" value={fmtCompact(approvalTotal)} />
            <HeroMetric label="Eksposur jatuh tempo" value={fmtCompact(exceptionTotal)} danger={exceptionTotal > 0} />
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <QueuePanel
          icon={ShieldCheck}
          eyebrow={canApprove ? "Keputusan Anda" : "Menunggu Keputusan"}
          title="Persetujuan & verifikasi"
          description={canApprove ? "Tinjau konteks lengkap sebelum menyetujui." : "Pantau pekerjaan yang sedang menunggu reviewer."}
          items={approvalItems}
          empty="Tidak ada approval tertunda."
          viewAllTo={canApprove ? "/admin/bulk-approval" : "/transactions?status=SUBMITTED"}
        />
        <QueuePanel
          icon={AlertTriangle}
          eyebrow="Exception management"
          title="Risiko yang perlu ditutup"
          description="Kewajiban lewat jatuh tempo dan transaksi yang belum terhubung."
          items={exceptionItems}
          empty="Tidak ada invoice lewat jatuh tempo."
          viewAllTo="/invoices?status=OVERDUE"
          footer={dashboardQ.data && dashboardQ.data.unlinked_out_count > 0 ? (
            <Link
              to="/transactions?unlinked=true"
              className="flex items-center justify-between gap-4 rounded-xl border border-warning-200 bg-warning-50 p-3 text-warning-800 transition-colors hover:bg-warning-100"
            >
              <span className="min-w-0">
                <span className="block text-[12px] font-semibold">{dashboardQ.data.unlinked_out_count} pengeluaran belum dialokasikan</span>
                <span className="block truncate text-[11px]">Sisa {fmtIDR(dashboardQ.data.unlinked_out_total)}</span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0" />
            </Link>
          ) : undefined}
        />
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-400">Lanjutkan pekerjaan</p>
            <h2 className="text-lg font-semibold text-ink-900">Antrian kerja pribadi</h2>
          </div>
          <p className="hidden text-[12px] text-ink-500 sm:block">Masuk kembali tanpa mencari dari menu</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <WorkstreamCard icon={FileClock} label="Transaksi draft" count={draftTxQ.data?.total ?? 0} to="/transactions?status=DRAFT" />
          <WorkstreamCard icon={ReceiptText} label="Invoice draft" count={draftInvoiceQ.data?.total ?? 0} to="/invoices?status=DRAFT" />
          <WorkstreamCard icon={ShoppingCart} label="PO draft" count={draftPoQ.data?.total ?? 0} to="/purchase-orders?status=DRAFT" />
          <WorkstreamCard icon={CircleDollarSign} label="Proyek minus" count={dashboardQ.data?.minus_projects ?? 0} to="/projects?health=minus" danger={(dashboardQ.data?.minus_projects ?? 0) > 0} />
        </div>
      </section>
    </Page>
  )
}

function Page({ children }: { children: React.ReactNode }) {
  return <div className="flex min-w-0 flex-col gap-5 overflow-x-hidden p-3 sm:p-5 lg:p-6">{children}</div>
}

function HeroMetric({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.06] p-3.5 backdrop-blur-sm">
      <p className="text-[10px] uppercase tracking-[0.12em] text-slate-400">{label}</p>
      <p className={cn("mt-1 font-mono text-lg font-semibold tabular-nums", danger ? "text-rose-300" : "text-white")}>{value}</p>
    </div>
  )
}

function QueuePanel({
  icon: Icon,
  eyebrow,
  title,
  description,
  items,
  empty,
  viewAllTo,
  footer,
}: {
  icon: typeof CheckCircle2
  eyebrow: string
  title: string
  description: string
  items: QueueItem[]
  empty: string
  viewAllTo: string
  footer?: React.ReactNode
}) {
  return (
    <article className="flex min-h-[390px] flex-col rounded-2xl border border-white bg-white p-4 shadow-[var(--app-shadow)] sm:p-5">
      <div className="flex items-start gap-3 border-b border-ink-100 pb-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink-900 text-white"><Icon className="h-5 w-5" /></span>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-400">{eyebrow}</p>
          <h2 className="text-base font-semibold text-ink-900">{title}</h2>
          <p className="mt-0.5 text-[12px] text-ink-500">{description}</p>
        </div>
      </div>
      <div className="flex-1 divide-y divide-ink-100">
        {items.length === 0 ? (
          <div className="grid min-h-48 place-items-center text-center">
            <div>
              <CheckCircle2 className="mx-auto h-8 w-8 text-success-500" />
              <p className="mt-2 text-sm font-medium text-ink-700">{empty}</p>
            </div>
          </div>
        ) : items.slice(0, 6).map((item) => (
          <Link key={item.id} to={item.to} className="group flex items-center gap-3 py-3">
            <span className={cn("h-2 w-2 shrink-0 rounded-full", item.kind === "exception" ? "bg-danger-500" : "bg-warning-500")} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-ink-800 group-hover:text-brand-700">{item.title}</span>
              <span className="block truncate text-[11px] text-ink-500">{item.meta}</span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block font-mono text-[12px] font-semibold tabular-nums text-ink-800">{fmtCompact(item.amount)}</span>
              <ArrowRight className="ml-auto mt-1 h-3.5 w-3.5 text-ink-300 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600" />
            </span>
          </Link>
        ))}
      </div>
      {footer && <div className="mt-2">{footer}</div>}
      <Link to={viewAllTo} className="mt-3 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-ink-50 text-[12px] font-semibold text-ink-700 hover:bg-ink-100">
        Buka seluruh antrian <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </article>
  )
}

function WorkstreamCard({ icon: Icon, label, count, to, danger = false }: { icon: typeof Clock3; label: string; count: number; to: string; danger?: boolean }) {
  return (
    <Link to={to} className="group rounded-2xl border border-white bg-white p-4 shadow-[var(--app-shadow)] transition-transform hover:-translate-y-0.5">
      <div className="flex items-center justify-between">
        <span className={cn("grid h-9 w-9 place-items-center rounded-xl", danger ? "bg-danger-50 text-danger-600" : "bg-brand-50 text-brand-600")}><Icon className="h-4.5 w-4.5" /></span>
        <ArrowRight className="h-4 w-4 text-ink-300 group-hover:text-brand-600" />
      </div>
      <p className={cn("mt-5 font-mono text-3xl font-semibold tabular-nums", danger ? "text-danger-700" : "text-ink-900")}>{count}</p>
      <p className="mt-1 text-[12px] font-medium text-ink-500">{label}</p>
    </Link>
  )
}

function ActionCenterSkeleton() {
  return (
    <Page>
      <Skeleton className="h-64 rounded-2xl" />
      <div className="grid gap-4 xl:grid-cols-2"><Skeleton className="h-96 rounded-2xl" /><Skeleton className="h-96 rounded-2xl" /></div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-40 rounded-2xl" />)}</div>
    </Page>
  )
}
