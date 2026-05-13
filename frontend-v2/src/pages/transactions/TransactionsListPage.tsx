import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { ArrowDownLeft, ArrowUpRight, Plus, Search, Wallet, X } from "lucide-react"
import { useTransaction, useTransactions, type TransactionListParams } from "@/hooks/useTransactions"
import { useProjects } from "@/hooks/useProjects"
import { useCategories } from "@/hooks/useCategories"
import { ProjectPicker } from "@/components/forms/ProjectPicker"
import { AdaptiveDataView } from "@/components/data/AdaptiveDataView"
import { Pagination } from "@/components/data/Pagination"
import { SummaryCard, SummaryCardGrid } from "@/components/data/SummaryCard"
import { ErrorState } from "@/components/data/ErrorState"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { DraggableSheet } from "@/components/ui/draggable-sheet"
import { TransactionCard } from "@/components/domain/transaction/TransactionCard"
import { TransactionDetail } from "@/components/domain/transaction/TransactionDetail"
import { TransactionForm } from "@/components/domain/transaction/TransactionForm"
import { TransactionActions } from "@/components/domain/transaction/TransactionActions"
import { buildTransactionColumns } from "@/components/domain/transaction/transaction-columns"
import { fmtCompact, fmtIDR } from "@/lib/format"
import { apiErrorMessage } from "@/lib/api"
import { useBreakpoint } from "@/lib/breakpoint"
import type { Project, Transaction, TxnStatus, TxnType } from "@/types/api"
import type { Category } from "@/hooks/useCategories"

type StatusFilter = "ALL" | TxnStatus
type TypeFilter = "ALL" | TxnType

const STATUS_TABS: Array<{ value: StatusFilter; label: string }> = [
  { value: "ALL", label: "Semua" },
  { value: "VERIFIED", label: "Tervalidasi" },
  { value: "SUBMITTED", label: "Menunggu" },
  { value: "DRAFT", label: "Draft" },
  { value: "REJECTED", label: "Ditolak" },
]

const TYPE_TABS: Array<{ value: TypeFilter; label: string }> = [
  { value: "ALL", label: "Semua" },
  { value: "IN", label: "Masuk" },
  { value: "OUT", label: "Keluar" },
]

export function TransactionsListPage() {
  const bp = useBreakpoint()
  const [searchParams, setSearchParams] = useSearchParams()
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(50)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL")
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("ALL")
  // Project filter: URL ?project_id=N override (mis. drilldown dari
  // ProjectDashboard). Selain itu controlled via picker di page ini.
  const urlProjectId = searchParams.get("project_id")
  const initialProjectId =
    urlProjectId && Number(urlProjectId) > 0 ? Number(urlProjectId) : null
  const [projectFilter, setProjectFilter] = useState<number | null>(
    initialProjectId,
  )
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Transaction | null>(null)
  // q dipasok via URL (mis. dr Topbar global search /transactions?q=foo).
  // Reactive: berubah saat user search lagi dr Topbar tanpa reload.
  const q = searchParams.get("q")?.trim() ?? ""

  const params: TransactionListParams = useMemo(
    () => ({
      page,
      size,
      project_id: projectFilter ?? undefined,
      status: statusFilter === "ALL" ? undefined : statusFilter,
      type: typeFilter === "ALL" ? undefined : typeFilter,
      q: q || undefined,
    }),
    [page, size, projectFilter, statusFilter, typeFilter, q],
  )

  // Reset ke page 1 kalau query/filter berubah.
  useEffect(() => {
    setPage(1)
  }, [q])

  const txQuery = useTransactions(params)
  const projectsQuery = useProjects({ status: "AKTIF" })
  const catQuery = useCategories()
  const detailQuery = useTransaction(selectedId)

  const projectMap = useMemo(() => {
    const m = new Map<number, Project>()
    projectsQuery.data?.items.forEach((p) => m.set(p.id, p))
    return m
  }, [projectsQuery.data])

  const categoryMap = useMemo(() => {
    const m = new Map<number, Category>()
    catQuery.data?.items.forEach((c) => m.set(c.id, c))
    return m
  }, [catQuery.data])

  const items = txQuery.data?.items ?? []
  const total = txQuery.data?.total ?? 0

  // Summary dari result page (idealnya dari endpoint khusus -- kita
  // pakai page subset dulu, akurat utk current view).
  const sumIn = items
    .filter((t) => t.type === "IN" && t.status === "VERIFIED")
    .reduce((s, t) => s + Number(t.amount || 0), 0)
  const sumOut = items
    .filter((t) => t.type === "OUT" && t.status === "VERIFIED")
    .reduce((s, t) => s + Number(t.amount || 0), 0)
  const balance = sumIn - sumOut
  const nPending = items.filter((t) => t.status === "SUBMITTED").length

  const columns = useMemo(
    () => buildTransactionColumns({ projectMap, categoryMap, hideProject: projectFilter != null }),
    [projectMap, categoryMap, projectFilter],
  )

  const detailOpen = selectedId != null
  const closeDetail = () => setSelectedId(null)

  if (txQuery.error) {
    return (
      <div className="p-4 sm:p-6">
        <ErrorState
          description={apiErrorMessage(txQuery.error)}
          onRetry={() => txQuery.refetch()}
        />
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-col gap-4 p-3 sm:p-5 lg:p-6">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-ink-900 sm:text-2xl">Transaksi</h1>
            <p className="text-[13px] text-ink-500 mt-0.5">
              Catat dan kelola pemasukan & pengeluaran proyek.
            </p>
          </div>
          <Button
            size={bp === "mobile" ? "md" : "lg"}
            className="hidden sm:inline-flex"
            onClick={() => {
              setEditTarget(null)
              setFormOpen(true)
            }}
          >
            <Plus className="h-4 w-4" />
            Tambah Transaksi
          </Button>
        </div>

        {/* Summary cards */}
        <SummaryCardGrid>
          <SummaryCard
            icon={ArrowDownLeft}
            label="Pemasukan (page)"
            value={fmtCompact(sumIn)}
            hint={fmtIDR(sumIn)}
            tone="success"
          />
          <SummaryCard
            icon={ArrowUpRight}
            label="Pengeluaran (page)"
            value={fmtCompact(sumOut)}
            hint={fmtIDR(sumOut)}
            tone="danger"
          />
          <SummaryCard
            icon={Wallet}
            label="Saldo (page)"
            value={fmtCompact(balance)}
            hint={fmtIDR(balance)}
            tone={balance >= 0 ? "success" : "danger"}
          />
          <SummaryCard
            label="Menunggu Validasi"
            value={String(nPending)}
            hint={nPending > 0 ? "perlu tindakan" : "semua tervalidasi"}
            tone={nPending > 0 ? "warning" : "neutral"}
          />
        </SummaryCardGrid>

        {q && (
          <div className="flex items-center gap-2 rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-[12px]">
            <Search className="h-4 w-4 text-brand-600 shrink-0" />
            <span className="text-ink-700">
              Hasil pencarian: <strong className="text-brand-800">{q}</strong>
            </span>
            <button
              type="button"
              onClick={() => {
                const next = new URLSearchParams(searchParams)
                next.delete("q")
                setSearchParams(next)
              }}
              className="ml-auto flex h-6 w-6 items-center justify-center rounded text-ink-500 hover:bg-brand-100 hover:text-ink-900"
              aria-label="Hapus pencarian"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Filter rows */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wider text-ink-500 shrink-0 w-12">
              Proyek
            </span>
            <div className="flex-1 max-w-sm">
              <ProjectPicker
                value={projectFilter}
                onChange={(id) => {
                  setProjectFilter(id)
                  setPage(1)
                  // Sync URL agar bisa dishare / refresh.
                  const next = new URLSearchParams(searchParams)
                  if (id) next.set("project_id", String(id))
                  else next.delete("project_id")
                  setSearchParams(next, { replace: true })
                }}
                placeholder="Semua proyek"
              />
            </div>
          </div>
          <FilterChips
            label="Arah"
            value={typeFilter}
            options={TYPE_TABS}
            onChange={(v) => {
              setTypeFilter(v as TypeFilter)
              setPage(1)
            }}
          />
          <FilterChips
            label="Status"
            value={statusFilter}
            options={STATUS_TABS}
            onChange={(v) => {
              setStatusFilter(v as StatusFilter)
              setPage(1)
            }}
          />
        </div>

        {/* Data view */}
        <div className="rounded-md bg-surface md:bg-transparent">
          <AdaptiveDataView
            data={items}
            isLoading={txQuery.isLoading}
            columns={columns}
            onItemClick={(t) => setSelectedId(t.id)}
            emptyMessage={
              statusFilter !== "ALL" || typeFilter !== "ALL"
                ? "Tidak ada transaksi yang cocok dengan filter."
                : "Belum ada transaksi."
            }
            renderCard={(t) => (
              <TransactionCard
                transaction={t}
                projectName={projectMap.get(t.project_id)?.name}
                categoryName={t.category_id ? categoryMap.get(t.category_id)?.name : undefined}
                onClick={() => setSelectedId(t.id)}
              />
            )}
          />
          {bp !== "mobile" && total > 0 && (
            <Pagination
              page={page}
              size={size}
              total={total}
              onPageChange={setPage}
              onSizeChange={(s) => {
                setSize(s)
                setPage(1)
              }}
            />
          )}
          {bp === "mobile" && total > size && (
            <div className="flex justify-center py-4">
              <Button
                variant="secondary"
                onClick={() => setSize((s) => s + 50)}
                disabled={items.length >= total}
              >
                Muat lebih banyak
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Mobile FAB */}
      <Button
        size="icon"
        className="sm:hidden fixed bottom-[calc(64px+env(safe-area-inset-bottom)+12px)] right-4 z-30 h-14 w-14 rounded-full shadow-lg"
        aria-label="Tambah transaksi"
        onClick={() => {
          setEditTarget(null)
          setFormOpen(true)
        }}
      >
        <Plus className="h-6 w-6" />
      </Button>

      {/* Detail sheet:
          Mobile: DraggableSheet (drag handle + swipe-down to close +
            tombol close 44x44 di header).
          Desktop: side panel kanan (Sheet biasa). */}
      {bp === "mobile" ? (
        <DraggableSheet
          open={detailOpen}
          onOpenChange={(o) => !o && closeDetail()}
          title="Detail Transaksi"
          maxHeight="92vh"
          footer={
            detailQuery.data && (
              <TransactionActions
                transaction={detailQuery.data}
                onEdit={() => {
                  setEditTarget(detailQuery.data!)
                  setSelectedId(null)
                  setFormOpen(true)
                }}
                onAfterDestroy={closeDetail}
              />
            )
          }
        >
          <TransactionDetail
            transaction={detailQuery.data}
            isLoading={detailQuery.isLoading}
            project={detailQuery.data ? projectMap.get(detailQuery.data.project_id) : undefined}
            category={
              detailQuery.data?.category_id ? categoryMap.get(detailQuery.data.category_id) : undefined
            }
          />
        </DraggableSheet>
      ) : (
        <Sheet open={detailOpen} onOpenChange={(open) => !open && closeDetail()}>
          <SheetContent
            side="right"
            className="w-full sm:max-w-md flex flex-col p-0"
          >
            <SheetHeader className="border-b">
              <SheetTitle>Detail Transaksi</SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto">
              <TransactionDetail
                transaction={detailQuery.data}
                isLoading={detailQuery.isLoading}
                project={detailQuery.data ? projectMap.get(detailQuery.data.project_id) : undefined}
                category={
                  detailQuery.data?.category_id ? categoryMap.get(detailQuery.data.category_id) : undefined
                }
              />
            </div>
            {detailQuery.data && (
              <TransactionActions
                transaction={detailQuery.data}
                onEdit={() => {
                  setEditTarget(detailQuery.data!)
                  setSelectedId(null)
                  setFormOpen(true)
                }}
                onAfterDestroy={closeDetail}
              />
            )}
          </SheetContent>
        </Sheet>
      )}

      {/* Create/edit form sheet */}
      <TransactionForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false)
          setEditTarget(null)
        }}
        transaction={editTarget}
      />
    </>
  )
}

interface FilterChipsProps<V extends string> {
  label: string
  value: V
  options: Array<{ value: V; label: string }>
  onChange: (v: V) => void
}

function FilterChips<V extends string>({ label, value, options, onChange }: FilterChipsProps<V>) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
      <span className="text-[11px] uppercase tracking-wider text-ink-500 shrink-0">
        {label}
      </span>
      <div className="flex gap-1.5 shrink-0">
        {options.map((opt) => {
          const active = value === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={
                active
                  ? "h-8 rounded-full bg-brand-500 text-white px-3 text-[12px] font-semibold whitespace-nowrap"
                  : "h-8 rounded-full bg-surface border border-border-strong text-ink-700 px-3 text-[12px] font-medium hover:bg-ink-100 whitespace-nowrap"
              }
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
