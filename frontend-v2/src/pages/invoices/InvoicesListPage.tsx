import { useMemo, useState } from "react"
import { Clock, FileMinus, FilePlus, Plus, Receipt } from "lucide-react"
import { useInvoice, useInvoices, type InvoiceListParams } from "@/hooks/useInvoices"
import { useProjects } from "@/hooks/useProjects"
import { useUIPrefs } from "@/store/ui-prefs"
import { AdaptiveDataView } from "@/components/data/AdaptiveDataView"
import { Pagination } from "@/components/data/Pagination"
import { SummaryCard, SummaryCardGrid } from "@/components/data/SummaryCard"
import { ErrorState } from "@/components/data/ErrorState"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { DraggableSheet } from "@/components/ui/draggable-sheet"
import { InvoiceCard } from "@/components/domain/invoice/InvoiceCard"
import { InvoiceDetail } from "@/components/domain/invoice/InvoiceDetail"
import { InvoiceForm } from "@/components/domain/invoice/InvoiceForm"
import { InvoiceActions } from "@/components/domain/invoice/InvoiceActions"
import { buildInvoiceColumns } from "@/components/domain/invoice/invoice-columns"
import { fmtCompact, fmtIDR } from "@/lib/format"
import { apiErrorMessage } from "@/lib/api"
import { useBreakpoint } from "@/lib/breakpoint"
import type { Invoice, InvoiceStatus, InvoiceType, Project } from "@/types/api"

type StatusFilter = "ALL" | InvoiceStatus
type TypeFilter = "ALL" | InvoiceType

const STATUS_TABS: Array<{ value: StatusFilter; label: string }> = [
  { value: "ALL", label: "Semua" },
  { value: "ISSUED", label: "Belum Lunas" },
  { value: "PARTIALLY_PAID", label: "Sebagian" },
  { value: "OVERDUE", label: "Jatuh Tempo" },
  { value: "PAID", label: "Lunas" },
  { value: "DRAFT", label: "Draft" },
]

const TYPE_TABS: Array<{ value: TypeFilter; label: string }> = [
  { value: "ALL", label: "Semua" },
  { value: "IN", label: "Hutang" },
  { value: "OUT", label: "Piutang" },
]

export function InvoicesListPage() {
  const bp = useBreakpoint()
  const { defaultProjectId } = useUIPrefs()
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(50)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL")
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("ALL")
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Invoice | null>(null)

  const params: InvoiceListParams = useMemo(
    () => ({
      page,
      size,
      project_id: defaultProjectId ?? undefined,
      status: statusFilter === "ALL" ? undefined : statusFilter,
      type: typeFilter === "ALL" ? undefined : typeFilter,
    }),
    [page, size, defaultProjectId, statusFilter, typeFilter],
  )

  const invQuery = useInvoices(params)
  const projectsQuery = useProjects({ is_active: true })
  const detailQuery = useInvoice(selectedId)

  const projectMap = useMemo(() => {
    const m = new Map<number, Project>()
    projectsQuery.data?.items.forEach((p) => m.set(p.id, p))
    return m
  }, [projectsQuery.data])

  const items = invQuery.data?.items ?? []
  const total = invQuery.data?.total ?? 0

  // Summary -- per page subset, akurat utk current view.
  const sumOutstanding = items
    .filter((i) =>
      i.status === "ISSUED" || i.status === "PARTIALLY_PAID" || i.status === "OVERDUE",
    )
    .reduce((s, i) => s + Number(i.outstanding_amount ?? i.remaining ?? 0), 0)
  const sumPaid = items
    .filter((i) => i.status === "PAID")
    .reduce((s, i) => s + Number(i.total ?? 0), 0)
  const nOverdue = items.filter((i) => i.status === "OVERDUE").length
  const nDraft = items.filter((i) => i.status === "DRAFT").length

  const columns = useMemo(
    () => buildInvoiceColumns({ projectMap, hideProject: defaultProjectId != null }),
    [projectMap, defaultProjectId],
  )

  const detailOpen = selectedId != null
  const closeDetail = () => setSelectedId(null)

  if (invQuery.error) {
    return (
      <div className="p-4 sm:p-6">
        <ErrorState
          description={apiErrorMessage(invQuery.error)}
          onRetry={() => invQuery.refetch()}
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
            <h1 className="text-xl font-bold text-ink-900 sm:text-2xl">Invoice</h1>
            <p className="text-[13px] text-ink-500 mt-0.5">
              Kelola hutang & piutang dengan tracking pembayaran.
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
            Tambah Invoice
          </Button>
        </div>

        {/* Summary cards */}
        <SummaryCardGrid>
          <SummaryCard
            icon={Receipt}
            label="Sisa Tagihan (page)"
            value={fmtCompact(sumOutstanding)}
            hint={fmtIDR(sumOutstanding)}
            tone={sumOutstanding > 0 ? "warning" : "neutral"}
          />
          <SummaryCard
            icon={FilePlus}
            label="Lunas (page)"
            value={fmtCompact(sumPaid)}
            hint={fmtIDR(sumPaid)}
            tone="success"
          />
          <SummaryCard
            icon={FileMinus}
            label="Jatuh Tempo"
            value={String(nOverdue)}
            hint={nOverdue > 0 ? "perlu tindakan" : "tidak ada"}
            tone={nOverdue > 0 ? "danger" : "neutral"}
          />
          <SummaryCard
            icon={Clock}
            label="Draft"
            value={String(nDraft)}
            hint={nDraft > 0 ? "belum diterbitkan" : "—"}
            tone={nDraft > 0 ? "warning" : "neutral"}
          />
        </SummaryCardGrid>

        {/* Filter chips */}
        <div className="flex flex-col gap-2">
          <FilterChips
            label="Tipe"
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

        {/* List */}
        <div className="rounded-md bg-surface md:bg-transparent">
          <AdaptiveDataView
            data={items}
            isLoading={invQuery.isLoading}
            columns={columns}
            onItemClick={(i) => setSelectedId(i.id)}
            emptyMessage={
              statusFilter !== "ALL" || typeFilter !== "ALL"
                ? "Tidak ada invoice yang cocok dengan filter."
                : "Belum ada invoice."
            }
            renderCard={(inv) => (
              <InvoiceCard
                invoice={inv}
                projectName={projectMap.get(inv.project_id)?.name}
                onClick={() => setSelectedId(inv.id)}
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
        aria-label="Tambah invoice"
        onClick={() => {
          setEditTarget(null)
          setFormOpen(true)
        }}
      >
        <Plus className="h-6 w-6" />
      </Button>

      {/* Detail: mobile DraggableSheet, desktop side panel */}
      {bp === "mobile" ? (
        <DraggableSheet
          open={detailOpen}
          onOpenChange={(o) => !o && closeDetail()}
          title="Detail Invoice"
          maxHeight="92vh"
          footer={
            detailQuery.data && (
              <InvoiceActions
                invoice={detailQuery.data}
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
          <InvoiceDetail
            invoice={detailQuery.data}
            isLoading={detailQuery.isLoading}
            project={detailQuery.data ? projectMap.get(detailQuery.data.project_id) : undefined}
          />
        </DraggableSheet>
      ) : (
        <Sheet open={detailOpen} onOpenChange={(open) => !open && closeDetail()}>
          <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col p-0">
            <SheetHeader className="border-b">
              <SheetTitle>Detail Invoice</SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto">
              <InvoiceDetail
                invoice={detailQuery.data}
                isLoading={detailQuery.isLoading}
                project={detailQuery.data ? projectMap.get(detailQuery.data.project_id) : undefined}
              />
            </div>
            {detailQuery.data && (
              <InvoiceActions
                invoice={detailQuery.data}
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

      {/* Form */}
      <InvoiceForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false)
          setEditTarget(null)
        }}
        invoice={editTarget}
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
