import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import type { ColumnDef } from "@tanstack/react-table"
import {
  CheckCircle2,
  Clock,
  FileText,
  Plus,
  Search,
  XCircle,
} from "lucide-react"
import { useCashRequests } from "@/hooks/useCashRequests"
import { useProjects } from "@/hooks/useProjects"
import { usePageTitle } from "@/hooks/usePageTitle"
import { AdaptiveDataView } from "@/components/data/AdaptiveDataView"
import { Pagination } from "@/components/data/Pagination"
import { EmptyState } from "@/components/data/EmptyState"
import { ErrorState } from "@/components/data/ErrorState"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { CashRequestFormSheet } from "@/components/domain/cash-request/CashRequestFormSheet"
import { fmtIDR } from "@/lib/format"
import { apiErrorMessage } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import type { CashRequest, CashRequestStatus } from "@/types/api"

type StatusFilter = "ALL" | CashRequestStatus

const STATUS_TABS: Array<{
  value: StatusFilter
  label: string
  hint?: string
}> = [
  { value: "ALL", label: "Semua" },
  { value: "PENDING", label: "Menunggu", hint: "Perlu approval" },
  { value: "APPROVED", label: "Disetujui" },
  { value: "REJECTED", label: "Ditolak" },
  { value: "CANCELLED", label: "Dibatalkan" },
]

function StatusBadge({ status }: { status: CashRequestStatus }) {
  const map: Record<
    CashRequestStatus,
    { label: string; bg: string; text: string; Icon: typeof CheckCircle2 }
  > = {
    PENDING: {
      label: "Menunggu",
      bg: "bg-warning-100",
      text: "text-warning-800",
      Icon: Clock,
    },
    APPROVED: {
      label: "Disetujui",
      bg: "bg-success-100",
      text: "text-success-800",
      Icon: CheckCircle2,
    },
    REJECTED: {
      label: "Ditolak",
      bg: "bg-danger-100",
      text: "text-danger-800",
      Icon: XCircle,
    },
    CANCELLED: {
      label: "Dibatalkan",
      bg: "bg-ink-100",
      text: "text-ink-600",
      Icon: XCircle,
    },
  }
  const { label, bg, text, Icon } = map[status]
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${bg} ${text}`}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  )
}

export function CashRequestsListPage() {
  usePageTitle("Pengajuan Dana")
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const canApprove =
    user?.role === "CENTRAL_ADMIN" || user?.role === "SUPERADMIN"

  const [page, setPage] = useState(1)
  const [size, setSize] = useState(50)
  const [status, setStatus] = useState<StatusFilter>("ALL")
  const [projectId, setProjectId] = useState<number | null>(null)
  const [q, setQ] = useState("")
  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<CashRequest | null>(null)

  const projectsQuery = useProjects({ include_non_project: true })
  const projects = projectsQuery.data?.items ?? []

  const params = useMemo(
    () => ({
      page,
      size,
      status: status === "ALL" ? undefined : status,
      project_id: projectId ?? undefined,
      q: q.trim() || undefined,
    }),
    [page, size, status, projectId, q],
  )
  const listQuery = useCashRequests(params)
  const items = listQuery.data?.items ?? []
  const total = listQuery.data?.total ?? 0

  // Hint count menunggu approval (utk highlight tab PENDING bagi admin).
  const pendingForApproval = useCashRequests(
    canApprove && status !== "PENDING"
      ? { status: "PENDING", size: 1 }
      : { status: "PENDING", size: 1, page: 0 },
  )
  const pendingCount = canApprove ? pendingForApproval.data?.total ?? 0 : 0

  const columns: ColumnDef<CashRequest, unknown>[] = useMemo(
    () => [
      {
        id: "number",
        header: "Nomor",
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-mono text-[12px] font-semibold">
              {row.original.number}
            </span>
            <span className="text-[11px] text-ink-500">
              {row.original.request_date}
            </span>
          </div>
        ),
        meta: { align: "left", width: "150px" },
      },
      {
        id: "title",
        header: "Judul / Proyek",
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium text-ink-800 truncate">
              {row.original.title}
            </span>
            <span className="text-[11px] text-ink-500 truncate">
              {row.original.project_code} — {row.original.project_name}
            </span>
          </div>
        ),
        meta: { align: "left" },
      },
      {
        id: "requester",
        header: "Pengaju",
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="text-[13px]">{row.original.requester_name}</span>
            {row.original.recipient_name &&
              row.original.recipient_name !== row.original.requester_name && (
                <span className="text-[11px] text-ink-500">
                  utk {row.original.recipient_name}
                </span>
              )}
          </div>
        ),
        meta: { align: "left", width: "180px" },
      },
      {
        id: "amount",
        header: "Total",
        cell: ({ row }) => (
          <span className="font-mono tabular-nums">
            Rp {fmtIDR(row.original.total_amount)}
          </span>
        ),
        meta: { align: "right", width: "150px" },
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
        meta: { align: "center", width: "120px" },
      },
    ],
    [],
  )

  if (listQuery.error) {
    return (
      <div className="p-4 sm:p-6">
        <ErrorState
          description={apiErrorMessage(listQuery.error)}
          onRetry={() => listQuery.refetch()}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 p-3 sm:p-5 lg:p-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-ink-500" />
            <h1 className="text-xl font-bold text-ink-900 sm:text-2xl">
              Pengajuan Dana
            </h1>
          </div>
          <p className="text-[13px] text-ink-500 mt-1 max-w-2xl">
            Pengajuan dana operasional internal. Setelah di-approve, sistem
            otomatis membuat transaksi <em>Dana Operasional</em> (DRAFT) yang
            siap di-verifikasi saat dana ditransfer.
          </p>
        </div>
        <Button onClick={() => setFormOpen(true)} className="shrink-0">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Pengajuan Baru</span>
          <span className="sm:hidden">Baru</span>
        </Button>
      </div>

      {/* Status tabs */}
      <div className="flex flex-wrap gap-2">
        {STATUS_TABS.map((t) => {
          const active = status === t.value
          const showBadge = canApprove && t.value === "PENDING" && pendingCount > 0
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => {
                setStatus(t.value)
                setPage(1)
              }}
              className={
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium transition-colors " +
                (active
                  ? "bg-brand-500 text-white"
                  : "bg-ink-100 text-ink-700 hover:bg-ink-200")
              }
            >
              {t.label}
              {showBadge && (
                <span
                  className={
                    "inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full px-1 text-[10px] font-semibold " +
                    (active
                      ? "bg-white text-brand-600"
                      : "bg-warning-500 text-white")
                  }
                >
                  {pendingCount}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Filter bar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400 pointer-events-none" />
          <Input
            placeholder="Cari nomor / judul…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setPage(1)
            }}
            className="pl-8"
          />
        </div>
        <Select
          value={projectId ?? ""}
          onChange={(e) => {
            const v = e.target.value
            setProjectId(v ? Number(v) : null)
            setPage(1)
          }}
          className="sm:w-64"
        >
          <option value="">Semua Proyek</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} — {p.name}
            </option>
          ))}
        </Select>
      </div>

      {items.length === 0 && !listQuery.isLoading ? (
        <EmptyState
          icon={FileText}
          title={
            status === "ALL"
              ? "Belum ada pengajuan dana"
              : `Tidak ada pengajuan ${STATUS_TABS.find((t) => t.value === status)?.label.toLowerCase()}`
          }
          description={
            status === "ALL"
              ? "Klik 'Pengajuan Baru' untuk mengajukan dana operasional dengan rincian."
              : undefined
          }
          tone="neutral"
        />
      ) : (
        <>
          <AdaptiveDataView
            data={items}
            isLoading={listQuery.isLoading}
            columns={columns}
            onItemClick={(cr) => navigate(`/cash-requests/${cr.id}`)}
            renderCard={(cr) => (
              <button
                type="button"
                onClick={() => navigate(`/cash-requests/${cr.id}`)}
                className="flex w-full flex-col gap-1 rounded-md border bg-surface p-3 text-left active:bg-ink-100"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="font-mono text-[11px] text-ink-500">
                      {cr.number}
                    </span>
                    <span className="font-medium text-ink-800 truncate">
                      {cr.title}
                    </span>
                    <span className="text-[11px] text-ink-500 truncate">
                      {cr.project_code} · {cr.requester_name}
                    </span>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <StatusBadge status={cr.status} />
                    <span className="font-mono text-[13px] tabular-nums">
                      Rp {fmtIDR(cr.total_amount)}
                    </span>
                  </div>
                </div>
              </button>
            )}
          />
          <Pagination
            page={page}
            size={size}
            total={total}
            onPageChange={setPage}
            onSizeChange={setSize}
          />
        </>
      )}

      <CashRequestFormSheet
        open={formOpen}
        onClose={() => {
          setFormOpen(false)
          setEditTarget(null)
        }}
        target={editTarget}
      />
    </div>
  )
}
