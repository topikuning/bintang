import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Plus, Search, Wallet, X } from "lucide-react"
import { useTransaction, useTransactions, type TransactionListParams } from "@/hooks/useTransactions"
import { useProjects } from "@/hooks/useProjects"
import { useCategories } from "@/hooks/useCategories"
import { DateRangeFilter } from "@/components/forms/DateRangeFilter"
import { FilterBar, FilterButton, FilterRadioList, FilterToggle } from "@/components/data/FilterBar"
import { MultiSelectList } from "@/components/data/MultiSelectList"
import { usePageTitle } from "@/hooks/usePageTitle"
import { AdaptiveDataView } from "@/components/data/AdaptiveDataView"
import { Pagination } from "@/components/data/Pagination"
import { SummaryCard, SummaryCardGrid } from "@/components/data/SummaryCard"
import { EmptyState } from "@/components/data/EmptyState"
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
  usePageTitle("Transaksi")
  const bp = useBreakpoint()
  const [searchParams, setSearchParams] = useSearchParams()
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(50)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL")
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("ALL")
  // Project filter: URL = single source of truth + MULTI-SELECT.
  // URL format `?project_id=1&project_id=2&...` (axios paramsSerializer
  // serialize array sbg repeated key, FastAPI parse list[int]).
  const projectFilter: number[] = searchParams
    .getAll("project_id")
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n) && n > 0)
  const setProjectFilter = (ids: number[]) => {
    const next = new URLSearchParams(searchParams)
    next.delete("project_id")
    for (const id of ids) next.append("project_id", String(id))
    setSearchParams(next, { replace: true })
  }
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Transaction | null>(null)

  // Deep link: ?id=N auto-open detail. Pakai pattern sama dgn POListPage
  // dan InvoicesListPage -- baca sekali di mount, strip dari URL supaya
  // bisa close tanpa back-loop, lalu state biasa.
  useEffect(() => {
    const idStr = searchParams.get("id")
    if (idStr) {
      const id = Number(idStr)
      if (Number.isFinite(id) && id > 0) {
        setSelectedId(id)
      }
      const next = new URLSearchParams(searchParams)
      next.delete("id")
      setSearchParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // q dipasok via URL (mis. dr Topbar global search /transactions?q=foo).
  // Reactive: berubah saat user search lagi dr Topbar tanpa reload.
  const q = searchParams.get("q")?.trim() ?? ""

  // Date range filter -- URL state (shareable/bookmarkable).
  const dateFrom = searchParams.get("date_from") || null
  const dateTo = searchParams.get("date_to") || null
  const setDateRange = (next: { from: string | null; to: string | null }) => {
    const u = new URLSearchParams(searchParams)
    if (next.from) u.set("date_from", next.from)
    else u.delete("date_from")
    if (next.to) u.set("date_to", next.to)
    else u.delete("date_to")
    setSearchParams(u, { replace: true })
  }

  // Deep link override: ?status=DRAFT & ?type=OUT dari ProjectDashboard
  // drilldown link. Selain itu pakai filter chip state.
  const urlStatus = searchParams.get("status")
  const urlType = searchParams.get("type")
  // Audit 2026-05-24: drill-down dari dashboard counter "N pengeluaran
  // masih punya sisa belum dialokasi".
  const unlinkedOnly = searchParams.get("unlinked") === "true"
  const effectiveStatus =
    urlStatus && urlStatus !== "ALL"
      ? (urlStatus as TxnStatus)
      : statusFilter === "ALL" ? undefined : statusFilter
  const effectiveType =
    urlType && urlType !== "ALL"
      ? (urlType as TxnType)
      : typeFilter === "ALL" ? undefined : typeFilter

  const params: TransactionListParams = useMemo(
    () => ({
      page,
      size,
      project_id: projectFilter.length > 0 ? projectFilter : undefined,
      status: effectiveStatus,
      type: effectiveType,
      q: q || undefined,
      date_from: dateFrom ?? undefined,
      date_to: dateTo ?? undefined,
      unlinked_only: unlinkedOnly || undefined,
    }),
    [page, size, projectFilter, effectiveStatus, effectiveType, q, dateFrom, dateTo, unlinkedOnly],
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
    // Sembunyikan kolom Proyek hanya kalau filter EXACTLY 1 proyek
    // (drilldown). Multi-select tetap tampilkan supaya user bisa
    // distinguish row antar proyek.
    () => buildTransactionColumns({ projectMap, categoryMap, hideProject: projectFilter.length === 1 }),
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

        {/* Audit 2026-05-24: compact filter toolbar.
            Sblm-nya 5-row "label + control" layout. Now: single row
            tombol popover (Linear/Notion-style). Active filter -> button
            warna brand + display value inline. */}
        <FilterBar
          hasActive={
            projectFilter.length > 0 ||
            !!dateFrom ||
            !!dateTo ||
            typeFilter !== "ALL" ||
            statusFilter !== "ALL" ||
            unlinkedOnly
          }
          onReset={() => {
            const next = new URLSearchParams(searchParams)
            next.delete("project_id")
            next.delete("date_from")
            next.delete("date_to")
            next.delete("status")
            next.delete("type")
            next.delete("unlinked")
            setSearchParams(next, { replace: true })
            setProjectFilter([])
            setStatusFilter("ALL")
            setTypeFilter("ALL")
            setPage(1)
          }}
        >
          <FilterButton
            label="Proyek"
            active={projectFilter.length > 0}
            displayValue={
              projectFilter.length === 1
                ? projectMap.get(projectFilter[0]!)?.name ?? "1 proyek"
                : projectFilter.length > 1
                ? `${projectFilter.length} proyek`
                : null
            }
            onClear={() => {
              setProjectFilter([])
              setPage(1)
            }}
            width={320}
          >
            <MultiSelectList<number>
              value={projectFilter}
              onChange={(ids) => {
                setProjectFilter(ids)
                setPage(1)
              }}
              options={(projectsQuery.data?.items ?? []).map((p) => ({
                value: p.id,
                label: p.name,
                hint: p.code,
              }))}
              isLoading={projectsQuery.isLoading}
              searchPlaceholder="Cari proyek…"
              emptyMessage="Belum ada proyek"
            />
          </FilterButton>

          <FilterButton
            label="Periode"
            active={!!dateFrom || !!dateTo}
            displayValue={formatPeriod(dateFrom, dateTo)}
            onClear={() => {
              setDateRange({ from: null, to: null })
              setPage(1)
            }}
            width={360}
          >
            <DateRangeFilter
              from={dateFrom}
              to={dateTo}
              onChange={(next) => {
                setDateRange(next)
                setPage(1)
              }}
            />
          </FilterButton>

          <FilterButton
            label="Arah"
            active={typeFilter !== "ALL"}
            displayValue={typeFilter !== "ALL" ? TYPE_TABS.find((t) => t.value === typeFilter)?.label ?? null : null}
            onClear={() => {
              setTypeFilter("ALL")
              setPage(1)
            }}
            width={200}
          >
            <FilterRadioList
              value={typeFilter}
              options={TYPE_TABS}
              onChange={(v) => {
                setTypeFilter(v as TypeFilter)
                setPage(1)
              }}
            />
          </FilterButton>

          <FilterButton
            label="Status"
            active={statusFilter !== "ALL"}
            displayValue={statusFilter !== "ALL" ? STATUS_TABS.find((s) => s.value === statusFilter)?.label ?? null : null}
            onClear={() => {
              setStatusFilter("ALL")
              setPage(1)
            }}
            width={200}
          >
            <FilterRadioList
              value={statusFilter}
              options={STATUS_TABS}
              onChange={(v) => {
                setStatusFilter(v as StatusFilter)
                setPage(1)
              }}
            />
          </FilterButton>

          <FilterToggle
            active={unlinkedOnly}
            onToggle={() => {
              const next = new URLSearchParams(searchParams)
              if (unlinkedOnly) next.delete("unlinked")
              else next.set("unlinked", "true")
              setSearchParams(next, { replace: true })
              setPage(1)
            }}
            tone="warning"
          >
            Belum dialokasi
          </FilterToggle>
        </FilterBar>

        {/* Data view */}
        <div className="rounded-md bg-surface md:bg-transparent">
          <AdaptiveDataView
            data={items}
            isLoading={txQuery.isLoading}
            columns={columns}
            onItemClick={(t) => setSelectedId(t.id)}
            emptyState={
              statusFilter !== "ALL" || typeFilter !== "ALL" || projectFilter.length > 0 || dateFrom || dateTo || q || unlinkedOnly ? (
                <EmptyState
                  icon={Search}
                  title="Tidak ada hasil"
                  description="Coba ubah filter atau hapus pencarian."
                  tone="neutral"
                  compact
                />
              ) : (
                <EmptyState
                  icon={ArrowLeftRight}
                  title="Belum ada transaksi"
                  description="Mulai catat pemasukan / pengeluaran pertama. Setelah itu lakukan submit ke admin untuk verifikasi."
                  actionLabel="Tambah Transaksi"
                  onAction={() => {
                    setEditTarget(null)
                    setFormOpen(true)
                  }}
                  tone="neutral"
                />
              )
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

      {/* Create/edit form sheet. Setelah save, re-open detail tx
          (utk verifikasi user) -- bukan close semua. */}
      <TransactionForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false)
          setEditTarget(null)
        }}
        transaction={editTarget}
        onSaved={(saved) => setSelectedId(saved.id)}
      />
    </>
  )
}

// Format period range jadi label kompak utk display di FilterButton.
// Audit 2026-05-24.
function formatPeriod(from: string | null, to: string | null): string | null {
  if (!from && !to) return null
  const fmt = (s: string) => {
    // YYYY-MM-DD -> DD/MM
    const [, m, d] = s.split("-")
    return `${d}/${m}`
  }
  if (from && to && from === to) return fmt(from)
  if (from && to) return `${fmt(from)} – ${fmt(to)}`
  if (from) return `≥ ${fmt(from)}`
  if (to) return `≤ ${fmt(to)}`
  return null
}
