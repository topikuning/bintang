import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { CheckCircle2, Clock, Plus, Search, ShoppingCart, XCircle } from "lucide-react"
import { usePO, usePOs, type POListParams } from "@/hooks/usePOs"
import { useProjects } from "@/hooks/useProjects"
import { DateRangeFilter } from "@/components/forms/DateRangeFilter"
import { FilterBar, FilterButton, FilterRadioList } from "@/components/data/FilterBar"
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
import { POCard } from "@/components/domain/po/POCard"
import { PODetail } from "@/components/domain/po/PODetail"
import { POForm } from "@/components/domain/po/POForm"
import { POActions } from "@/components/domain/po/POActions"
import { buildPOColumns } from "@/components/domain/po/po-columns"
import { fmtCompact, fmtIDR } from "@/lib/format"
import { apiErrorMessage } from "@/lib/api"
import { useBreakpoint } from "@/lib/breakpoint"
import type { POStatus, Project, PurchaseOrder } from "@/types/api"

type StatusFilter = "ALL" | POStatus

const STATUS_TABS: Array<{ value: StatusFilter; label: string }> = [
  { value: "ALL", label: "Semua" },
  { value: "DRAFT", label: "Draft" },
  { value: "ISSUED", label: "Diajukan" },
  { value: "APPROVED", label: "Disetujui" },
  { value: "CANCELLED", label: "Dibatalkan" },
]

export function POListPage() {
  usePageTitle("Purchase Order")
  const bp = useBreakpoint()
  const [searchParams, setSearchParams] = useSearchParams()
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(50)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL")
  // Project filter: URL = source of truth + MULTI-SELECT.
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
  const [editTarget, setEditTarget] = useState<PurchaseOrder | null>(null)

  // Deep link: ?id=N auto-open detail. ?project_id + ?status override
  // filter dr URL (mis. dari ProjectDashboard 'Lihat semua').
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

  const urlStatus = searchParams.get("status")
  const effectiveStatus =
    urlStatus && urlStatus !== "ALL"
      ? (urlStatus as POStatus)
      : statusFilter === "ALL" ? undefined : statusFilter

  // Date range filter di URL state.
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

  const params: POListParams = useMemo(
    () => ({
      page,
      size,
      project_id: projectFilter.length > 0 ? projectFilter : undefined,
      status: effectiveStatus,
      date_from: dateFrom ?? undefined,
      date_to: dateTo ?? undefined,
    }),
    [page, size, projectFilter, effectiveStatus, dateFrom, dateTo],
  )

  const poQuery = usePOs(params)
  const projectsQuery = useProjects({ status: "AKTIF" })
  const detailQuery = usePO(selectedId)

  const projectMap = useMemo(() => {
    const m = new Map<number, Project>()
    projectsQuery.data?.items.forEach((p) => m.set(p.id, p))
    return m
  }, [projectsQuery.data])

  const items = poQuery.data?.items ?? []
  const total = poQuery.data?.total ?? 0

  const sumApproved = items
    .filter((i) => i.status === "APPROVED")
    .reduce((s, i) => s + Number(i.total ?? 0), 0)
  const sumIssued = items
    .filter((i) => i.status === "ISSUED")
    .reduce((s, i) => s + Number(i.total ?? 0), 0)
  const nDraft = items.filter((i) => i.status === "DRAFT").length
  const nCancelled = items.filter((i) => i.status === "CANCELLED").length

  const columns = useMemo(
    () => buildPOColumns({ projectMap, hideProject: projectFilter.length === 1 }),
    [projectMap, projectFilter],
  )

  const detailOpen = selectedId != null
  const closeDetail = () => setSelectedId(null)

  if (poQuery.error) {
    return (
      <div className="p-4 sm:p-6">
        <ErrorState
          description={apiErrorMessage(poQuery.error)}
          onRetry={() => poQuery.refetch()}
        />
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-col gap-4 p-3 sm:p-5 lg:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-ink-900 sm:text-2xl">Purchase Order</h1>
            <p className="text-[13px] text-ink-500 mt-0.5">
              PO ke vendor + workflow approval.
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
            Tambah PO
          </Button>
        </div>

        <SummaryCardGrid>
          <SummaryCard
            icon={CheckCircle2}
            label="Disetujui (page)"
            value={fmtCompact(sumApproved)}
            hint={fmtIDR(sumApproved)}
            tone="success"
          />
          <SummaryCard
            icon={ShoppingCart}
            label="Diajukan (page)"
            value={fmtCompact(sumIssued)}
            hint={fmtIDR(sumIssued)}
            tone="warning"
          />
          <SummaryCard
            icon={Clock}
            label="Draft"
            value={String(nDraft)}
            hint={nDraft > 0 ? "perlu review" : "—"}
            tone={nDraft > 0 ? "warning" : "neutral"}
          />
          <SummaryCard
            icon={XCircle}
            label="Dibatalkan"
            value={String(nCancelled)}
            hint={nCancelled > 0 ? "tidak dihitung laporan" : "—"}
            tone="neutral"
          />
        </SummaryCardGrid>

        {/* Audit 2026-05-24: compact filter toolbar (popover buttons). */}
        <FilterBar
          hasActive={
            projectFilter.length > 0 ||
            !!dateFrom || !!dateTo ||
            statusFilter !== "ALL"
          }
          onReset={() => {
            setProjectFilter([])
            setDateRange({ from: null, to: null })
            setStatusFilter("ALL")
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
            onClear={() => { setProjectFilter([]); setPage(1) }}
            width={320}
          >
            <MultiSelectList<number>
              value={projectFilter}
              onChange={(ids) => { setProjectFilter(ids); setPage(1) }}
              options={(projectsQuery.data?.items ?? []).map((p) => ({
                value: p.id, label: p.name, hint: p.code,
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
            onClear={() => { setDateRange({ from: null, to: null }); setPage(1) }}
            width={360}
          >
            <DateRangeFilter
              from={dateFrom}
              to={dateTo}
              onChange={(next) => { setDateRange(next); setPage(1) }}
            />
          </FilterButton>

          <FilterButton
            label="Status"
            active={statusFilter !== "ALL"}
            displayValue={statusFilter !== "ALL" ? STATUS_TABS.find((s) => s.value === statusFilter)?.label ?? null : null}
            onClear={() => { setStatusFilter("ALL"); setPage(1) }}
            width={220}
          >
            <FilterRadioList
              value={statusFilter}
              options={STATUS_TABS}
              onChange={(v) => { setStatusFilter(v as StatusFilter); setPage(1) }}
            />
          </FilterButton>
        </FilterBar>

        <div className="rounded-md bg-surface md:bg-transparent">
          <AdaptiveDataView
            data={items}
            isLoading={poQuery.isLoading}
            columns={columns}
            onItemClick={(po) => setSelectedId(po.id)}
            emptyState={
              statusFilter !== "ALL" || projectFilter.length > 0 || dateFrom || dateTo ? (
                <EmptyState
                  icon={Search}
                  title="Tidak ada hasil"
                  description="Coba ubah filter."
                  tone="neutral"
                  compact
                />
              ) : (
                <EmptyState
                  icon={ShoppingCart}
                  title="Belum ada Purchase Order"
                  description="Buat PO untuk track komitmen pembelian ke vendor sebelum invoice masuk."
                  actionLabel="Tambah PO"
                  onAction={() => {
                    setEditTarget(null)
                    setFormOpen(true)
                  }}
                  tone="neutral"
                />
              )
            }
            renderCard={(po) => (
              <POCard
                po={po}
                projectName={projectMap.get(po.project_id)?.name}
                onClick={() => setSelectedId(po.id)}
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

      <Button
        size="icon"
        className="sm:hidden fixed bottom-[calc(64px+env(safe-area-inset-bottom)+12px)] right-4 z-30 h-14 w-14 rounded-full shadow-lg"
        aria-label="Tambah PO"
        onClick={() => {
          setEditTarget(null)
          setFormOpen(true)
        }}
      >
        <Plus className="h-6 w-6" />
      </Button>

      {bp === "mobile" ? (
        <DraggableSheet
          open={detailOpen}
          onOpenChange={(o) => !o && closeDetail()}
          title="Detail PO"
          maxHeight="92vh"
          footer={
            detailQuery.data && (
              <POActions
                po={detailQuery.data}
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
          <PODetail
            po={detailQuery.data}
            isLoading={detailQuery.isLoading}
            project={detailQuery.data ? projectMap.get(detailQuery.data.project_id) : undefined}
          />
        </DraggableSheet>
      ) : (
        <Sheet open={detailOpen} onOpenChange={(open) => !open && closeDetail()}>
          <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col p-0">
            <SheetHeader className="border-b">
              <SheetTitle>Detail PO</SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto">
              <PODetail
                po={detailQuery.data}
                isLoading={detailQuery.isLoading}
                project={detailQuery.data ? projectMap.get(detailQuery.data.project_id) : undefined}
              />
            </div>
            {detailQuery.data && (
              <POActions
                po={detailQuery.data}
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

      <POForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false)
          setEditTarget(null)
        }}
        po={editTarget}
        onSaved={(saved) => setSelectedId(saved.id)}
      />
    </>
  )
}

// Format period range jadi label kompak utk FilterButton.displayValue.
function formatPeriod(from: string | null, to: string | null): string | null {
  if (!from && !to) return null
  const fmt = (s: string) => {
    const [, m, d] = s.split("-")
    return `${d}/${m}`
  }
  if (from && to && from === to) return fmt(from)
  if (from && to) return `${fmt(from)} – ${fmt(to)}`
  if (from) return `≥ ${fmt(from)}`
  if (to) return `≤ ${fmt(to)}`
  return null
}
