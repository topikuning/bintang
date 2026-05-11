import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { Clock, FileMinus, FilePlus, Plus, Receipt, Search, X } from "lucide-react"
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
  const [searchParams, setSearchParams] = useSearchParams()
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(50)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL")
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("ALL")
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Invoice | null>(null)
  // Expandable rows utk grid desktop: kumpulan ID invoice yg sedang expand.
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const toggleExpanded = (id: number) =>
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // q dipasok via URL (dr Topbar global search /invoices?q=foo).
  const q = searchParams.get("q")?.trim() ?? ""

  const params: InvoiceListParams = useMemo(
    () => ({
      page,
      size,
      project_id: defaultProjectId ?? undefined,
      status: statusFilter === "ALL" ? undefined : statusFilter,
      type: typeFilter === "ALL" ? undefined : typeFilter,
      q: q || undefined,
    }),
    [page, size, defaultProjectId, statusFilter, typeFilter, q],
  )

  useEffect(() => {
    setPage(1)
  }, [q])

  const invQuery = useInvoices(params)
  const projectsQuery = useProjects({ status: "AKTIF" })
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
    () =>
      buildInvoiceColumns({
        projectMap,
        hideProject: defaultProjectId != null,
        expand: {
          isExpanded: (id) => expandedIds.has(id),
          toggle: toggleExpanded,
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectMap, defaultProjectId, expandedIds],
  )

  // Cast Set<number> ke Set<string|number> krn DataGrid generic key.
  const expandedSet = useMemo<Set<string | number>>(
    () => new Set<string | number>([...expandedIds]),
    [expandedIds],
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
            getRowId={(inv) => inv.id}
            expandedIds={expandedSet}
            renderExpandedRow={(inv) => <InvoiceItemsInline invoice={inv} />}
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

function InvoiceItemsInline({ invoice }: { invoice: Invoice }) {
  const items = invoice.items ?? []
  if (items.length === 0) {
    return (
      <div className="text-[12px] text-ink-500 italic">
        Invoice ini belum punya item rincian.
      </div>
    )
  }
  return (
    <div className="rounded-md border bg-surface overflow-hidden">
      <table className="w-full text-[12px] border-collapse">
        <thead className="bg-surface-muted">
          <tr>
            <th className="px-2 py-1.5 text-left font-semibold text-ink-600 w-8">No</th>
            <th className="px-2 py-1.5 text-left font-semibold text-ink-600">Deskripsi</th>
            <th className="px-2 py-1.5 text-right font-semibold text-ink-600 w-20">Qty</th>
            <th className="px-2 py-1.5 text-left font-semibold text-ink-600 w-16">Satuan</th>
            <th className="px-2 py-1.5 text-right font-semibold text-ink-600 w-32">Harga Satuan</th>
            <th className="px-2 py-1.5 text-right font-semibold text-ink-600 w-32">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, idx) => (
            <tr key={it.id} className="border-t">
              <td className="px-2 py-1.5 text-ink-500">{idx + 1}</td>
              <td className="px-2 py-1.5">{it.description}</td>
              <td
                data-num
                className="px-2 py-1.5 text-right font-mono [font-variant-numeric:tabular-nums]"
              >
                {Number(it.quantity)}
              </td>
              <td className="px-2 py-1.5 text-ink-700">{it.unit ?? "—"}</td>
              <td
                data-num
                className="px-2 py-1.5 text-right font-mono [font-variant-numeric:tabular-nums]"
              >
                {fmtIDR(it.unit_price)}
              </td>
              <td
                data-num
                className="px-2 py-1.5 text-right font-mono font-semibold [font-variant-numeric:tabular-nums]"
              >
                {fmtIDR(it.subtotal)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-surface-muted border-t-2">
          <tr>
            <td colSpan={5} className="px-2 py-1.5 text-right text-ink-600 font-semibold">
              Subtotal
            </td>
            <td
              data-num
              className="px-2 py-1.5 text-right font-mono font-semibold [font-variant-numeric:tabular-nums]"
            >
              {fmtIDR(invoice.subtotal)}
            </td>
          </tr>
          {Number(invoice.tax) > 0 && (
            <tr>
              <td colSpan={5} className="px-2 py-1.5 text-right text-ink-600">
                Pajak
              </td>
              <td
                data-num
                className="px-2 py-1.5 text-right font-mono [font-variant-numeric:tabular-nums]"
              >
                {fmtIDR(invoice.tax)}
              </td>
            </tr>
          )}
          <tr className="bg-brand-50/50">
            <td colSpan={5} className="px-2 py-1.5 text-right text-ink-900 font-bold">
              Total
            </td>
            <td
              data-num
              className="px-2 py-1.5 text-right font-mono font-bold text-brand-700 [font-variant-numeric:tabular-nums]"
            >
              {fmtIDR(invoice.total)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
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
