import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCheck, Loader2, ShoppingCart, Receipt, Send, BadgeCheck } from "lucide-react"

import { useAuthStore } from "@/store/auth"
import { api, apiErrorMessage } from "@/lib/api"
import { fmtIDR, fmtDate } from "@/lib/format"
import { usePageTitle } from "@/hooks/usePageTitle"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/data/EmptyState"
import { ErrorState } from "@/components/data/ErrorState"
import { toast } from "@/components/ui/sonner"
import { CompanyPicker } from "@/components/forms/CompanyPicker"
import { ProjectPicker } from "@/components/forms/ProjectPicker"
import { cn } from "@/lib/utils"

interface BulkFilters {
  company_id: number | null
  project_id: number | null
}

/**
 * Halaman bulk approval utk admin. 3 tab:
 * - Transaksi (SUBMITTED → VERIFIED)
 * - PO (DRAFT/ISSUED → APPROVED)
 * - Invoice (DRAFT → ISSUED)
 *
 * Audit 2026-05-23 user req: SUPERADMIN approve/validasi massal.
 * Tampil semua entity yg eligible (status pending), checkbox + bulk action.
 */
type TabKey = "tx" | "po" | "invoice"

interface BulkResult {
  total_requested: number
  success_count: number
  success: number[]
  skipped: Array<{ id: number; reason: string }>
}

export function BulkApprovalPage() {
  usePageTitle("Approval Massal")
  const role = useAuthStore((s) => s.user?.role)
  const isAdmin = role === "SUPERADMIN" || role === "CENTRAL_ADMIN"
  const [tab, setTab] = useState<TabKey>("tx")
  // Audit 2026-05-23 user req: filter per perusahaan / proyek.
  const [filters, setFilters] = useState<BulkFilters>({
    company_id: null, project_id: null,
  })

  if (!isAdmin) {
    return (
      <div className="flex flex-col gap-3 p-3 sm:p-5 lg:p-6">
        <EmptyState
          title="Akses Ditolak"
          description="Halaman ini hanya untuk SUPERADMIN / CENTRAL_ADMIN."
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 p-3 sm:p-5 lg:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-bold text-ink-900 sm:text-2xl">Approval Massal</h1>
        <p className="text-[13px] text-ink-500">
          Validasi sekaligus banyak transaksi, PO, atau invoice yang masih pending.
        </p>
      </div>

      <FilterBar value={filters} onChange={setFilters} />

      <div className="flex gap-1 border-b border-ink-200 mt-1">
        <TabButton active={tab === "tx"} onClick={() => setTab("tx")} icon={CheckCheck}>
          Transaksi
        </TabButton>
        <TabButton active={tab === "po"} onClick={() => setTab("po")} icon={ShoppingCart}>
          PO
        </TabButton>
        <TabButton active={tab === "invoice"} onClick={() => setTab("invoice")} icon={Receipt}>
          Invoice
        </TabButton>
      </div>

      {tab === "tx" && <BulkTxPanel filters={filters} />}
      {tab === "po" && <BulkPoPanel filters={filters} />}
      {tab === "invoice" && <BulkInvoicePanel filters={filters} />}
    </div>
  )
}

function FilterBar({
  value,
  onChange,
}: {
  value: BulkFilters
  onChange: (v: BulkFilters) => void
}) {
  // Audit 2026-05-24: pakai filterable Combobox (CompanyPicker /
  // ProjectPicker) -- standar app utk dropdown searchable. Native
  // <select> tdk konsisten dgn UI lain & repot kalau list panjang.
  return (
    <div className="rounded-md border bg-surface p-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
      <div className="flex flex-col gap-1">
        <label className="text-[11px] uppercase tracking-wider text-ink-500">
          Filter Perusahaan
        </label>
        <CompanyPicker
          value={value.company_id}
          onChange={(id) => {
            // Saat company berubah, reset project_id (avoid stale).
            onChange({ company_id: id, project_id: null })
          }}
          placeholder="— Semua Perusahaan —"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[11px] uppercase tracking-wider text-ink-500">
          Filter Proyek
        </label>
        <ProjectPicker
          value={value.project_id}
          onChange={(id) => onChange({ ...value, project_id: id })}
          placeholder="— Semua Proyek —"
          activeOnly={false}
          companyId={value.company_id}
        />
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean
  onClick: () => void
  icon: typeof CheckCheck
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-3 py-2 text-sm font-medium border-b-2 transition-colors",
        active
          ? "border-brand-500 text-brand-700"
          : "border-transparent text-ink-600 hover:text-ink-900",
      )}
    >
      <Icon className="h-4 w-4" />
      {children}
    </button>
  )
}


// ============================================================
// TX panel
// ============================================================
function BulkTxPanel({ filters }: { filters: BulkFilters }) {
  const qc = useQueryClient()
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const listQ = useQuery({
    queryKey: ["bulk-approval", "tx", "pending", filters],
    queryFn: async () => {
      // Backend bulk_verify accept DRAFT + SUBMITTED. Fetch keduanya
      // (list endpoint cuma terima 1 status, jadi 2 query lalu merge).
      const baseParams: Record<string, unknown> = { size: 200 }
      if (filters.project_id) baseParams.project_id = filters.project_id
      if (filters.company_id) baseParams.company_id = filters.company_id
      const [draftRes, submittedRes] = await Promise.all([
        api.get("/transactions", { params: { ...baseParams, status: "DRAFT" } }),
        api.get("/transactions", { params: { ...baseParams, status: "SUBMITTED" } }),
      ])
      const merged = [
        ...(submittedRes.data?.items ?? []),  // submitted dulu (lebih prioritas)
        ...(draftRes.data?.items ?? []),
      ]
      return {
        items: merged as TxItem[],
        total: (submittedRes.data?.total ?? 0) + (draftRes.data?.total ?? 0),
      }
    },
  })

  const verifyMut = useMutation({
    mutationFn: async (ids: number[]): Promise<BulkResult> => {
      const { data } = await api.post<BulkResult>("/transactions/bulk/verify", { ids })
      return data
    },
    onSuccess: (res) => {
      reportBulkResult("Transaksi", res)
      setSelected(new Set())
      qc.invalidateQueries({ queryKey: ["bulk-approval", "tx"] })
      qc.invalidateQueries({ queryKey: ["transactions"] })
    },
    onError: (err) => toast.error("Bulk verify gagal", { description: apiErrorMessage(err) }),
  })

  return (
    <BulkPanel
      title="Transaksi SUBMITTED"
      hint="VERIFIED akan masuk laporan finansial. Pastikan sudah review masing-masing tx."
      items={listQ.data?.items ?? []}
      isLoading={listQ.isLoading}
      error={listQ.error}
      selected={selected}
      setSelected={setSelected}
      onBulkAction={(ids) => verifyMut.mutate(ids)}
      bulkPending={verifyMut.isPending}
      bulkLabel="Verify Selected"
      renderRow={(item) => (
        <>
          <td className="px-3 py-2 text-sm">
            <span className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
              item.status === "DRAFT"
                ? "bg-ink-100 text-ink-700"
                : "bg-warning-100 text-warning-800",
            )}>
              {item.status}
            </span>
          </td>
          <td className="px-3 py-2 text-sm">{fmtDate(item.tx_date)}</td>
          <td className="px-3 py-2 text-sm">{item.type}</td>
          <td className="px-3 py-2 text-sm font-mono">{fmtIDR(Number(item.amount))}</td>
          <td className="px-3 py-2 text-sm">{item.party_name || "—"}</td>
          <td className="px-3 py-2 text-sm text-ink-600 truncate max-w-[300px]">
            {item.description || "—"}
          </td>
        </>
      )}
      headers={["Status", "Tanggal", "Tipe", "Nominal", "Pihak", "Deskripsi"]}
    />
  )
}

// ============================================================
// PO panel
// ============================================================
function BulkPoPanel({ filters }: { filters: BulkFilters }) {
  const qc = useQueryClient()
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const listQ = useQuery({
    queryKey: ["bulk-approval", "po", "pending", filters],
    queryFn: async () => {
      // Backend bulk_approve accept DRAFT + ISSUED. Fetch keduanya.
      const baseParams: Record<string, unknown> = { size: 200 }
      if (filters.project_id) baseParams.project_id = filters.project_id
      if (filters.company_id) baseParams.company_id = filters.company_id
      const [draftRes, issuedRes] = await Promise.all([
        api.get("/purchase-orders", { params: { ...baseParams, status: "DRAFT" } }),
        api.get("/purchase-orders", { params: { ...baseParams, status: "ISSUED" } }),
      ])
      const merged = [
        ...(issuedRes.data?.items ?? []),
        ...(draftRes.data?.items ?? []),
      ]
      return {
        items: merged as PoItem[],
        total: (issuedRes.data?.total ?? 0) + (draftRes.data?.total ?? 0),
      }
    },
  })

  const approveMut = useMutation({
    mutationFn: async (ids: number[]): Promise<BulkResult> => {
      const { data } = await api.post<BulkResult>("/purchase-orders/bulk/approve", { ids })
      return data
    },
    onSuccess: (res) => {
      reportBulkResult("PO", res)
      setSelected(new Set())
      qc.invalidateQueries({ queryKey: ["bulk-approval", "po"] })
      qc.invalidateQueries({ queryKey: ["pos"] })
    },
    onError: (err) => toast.error("Bulk approve gagal", { description: apiErrorMessage(err) }),
  })

  return (
    <BulkPanel
      title="PO DRAFT / ISSUED"
      hint="APPROVED = PO siap dikirim ke vendor & dialokasi ke pembayaran. DRAFT akan skip step ISSUED."
      items={listQ.data?.items ?? []}
      isLoading={listQ.isLoading}
      error={listQ.error}
      selected={selected}
      setSelected={setSelected}
      onBulkAction={(ids) => approveMut.mutate(ids)}
      bulkPending={approveMut.isPending}
      bulkLabel="Approve Selected"
      renderRow={(item) => (
        <>
          <td className="px-3 py-2 text-sm">
            <span className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
              item.status === "DRAFT"
                ? "bg-ink-100 text-ink-700"
                : "bg-warning-100 text-warning-800",
            )}>
              {item.status}
            </span>
          </td>
          <td className="px-3 py-2 text-sm font-mono">{item.number}</td>
          <td className="px-3 py-2 text-sm">{fmtDate(item.po_date)}</td>
          <td className="px-3 py-2 text-sm">{item.vendor_client_name || item.vendor_name || "—"}</td>
          <td className="px-3 py-2 text-sm font-mono">{fmtIDR(Number(item.total))}</td>
        </>
      )}
      headers={["Status", "Nomor", "Tanggal", "Vendor", "Total"]}
    />
  )
}

// ============================================================
// Invoice panel
// ============================================================
// Audit 2026-05-24 user req: invoice bulk action tdk cuma Issue.
// Tambah Mark-Paid utk invoice ISSUED/PARTIALLY_PAID/OVERDUE. Mode
// segmented supaya satu tab cukup, action button context-aware.
type InvoiceMode = "issue" | "mark-paid"

function BulkInvoicePanel({ filters }: { filters: BulkFilters }) {
  const qc = useQueryClient()
  const [mode, setMode] = useState<InvoiceMode>("issue")
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const listQ = useQuery({
    queryKey: ["bulk-approval", "invoice", mode, filters],
    queryFn: async () => {
      const baseParams: Record<string, unknown> = { size: 200 }
      if (filters.project_id) baseParams.project_id = filters.project_id
      if (filters.company_id) baseParams.company_id = filters.company_id
      if (mode === "issue") {
        const { data } = await api.get("/invoices", {
          params: { ...baseParams, status: "DRAFT" },
        })
        return data as { items: InvoiceItem[]; total: number }
      }
      // mark-paid: ISSUED + PARTIALLY_PAID + OVERDUE (list endpoint
      // hanya terima 1 status -> 3 query lalu merge).
      const [issued, partial, overdue] = await Promise.all([
        api.get("/invoices", { params: { ...baseParams, status: "ISSUED" } }),
        api.get("/invoices", { params: { ...baseParams, status: "PARTIALLY_PAID" } }),
        api.get("/invoices", { params: { ...baseParams, status: "OVERDUE" } }),
      ])
      const merged = [
        ...(issued.data?.items ?? []),
        ...(partial.data?.items ?? []),
        ...(overdue.data?.items ?? []),
      ]
      return {
        items: merged as InvoiceItem[],
        total:
          (issued.data?.total ?? 0) +
          (partial.data?.total ?? 0) +
          (overdue.data?.total ?? 0),
      }
    },
  })

  const actionMut = useMutation({
    mutationFn: async (ids: number[]): Promise<BulkResult> => {
      const url =
        mode === "issue"
          ? "/invoices/bulk/issue"
          : "/invoices/bulk/mark-paid"
      const { data } = await api.post<BulkResult>(url, { ids })
      return data
    },
    onSuccess: (res) => {
      reportBulkResult("Invoice", res)
      setSelected(new Set())
      qc.invalidateQueries({ queryKey: ["bulk-approval", "invoice"] })
      qc.invalidateQueries({ queryKey: ["invoices"] })
      qc.invalidateQueries({ queryKey: ["transactions"] })
    },
    onError: (err) =>
      toast.error(
        mode === "issue" ? "Bulk issue gagal" : "Bulk mark paid gagal",
        { description: apiErrorMessage(err) },
      ),
  })

  const headers =
    mode === "issue"
      ? ["Nomor", "Tanggal", "Tipe", "Pihak", "Total"]
      : ["Status", "Nomor", "Tanggal", "Tipe", "Pihak", "Total"]

  return (
    <div className="flex flex-col gap-2">
      {/* Segmented control: Issue vs Mark Paid */}
      <div className="inline-flex self-start rounded-md border bg-surface p-0.5 mt-2">
        <button
          type="button"
          onClick={() => {
            setMode("issue")
            setSelected(new Set())
          }}
          className={cn(
            "flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors",
            mode === "issue"
              ? "bg-brand-100 text-brand-700"
              : "text-ink-600 hover:text-ink-900",
          )}
        >
          <Send className="h-3.5 w-3.5" />
          Issue (DRAFT)
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("mark-paid")
            setSelected(new Set())
          }}
          className={cn(
            "flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors",
            mode === "mark-paid"
              ? "bg-brand-100 text-brand-700"
              : "text-ink-600 hover:text-ink-900",
          )}
        >
          <BadgeCheck className="h-3.5 w-3.5" />
          Tandai Lunas (ISSUED+)
        </button>
      </div>

      <BulkPanel
        title={mode === "issue" ? "Invoice DRAFT" : "Invoice Outstanding"}
        hint={
          mode === "issue"
            ? "ISSUED = invoice resmi masuk piutang/hutang & laporan."
            : "Tandai lunas: auto-create TX pelunasan (VERIFIED) sebesar outstanding tiap invoice."
        }
        items={listQ.data?.items ?? []}
        isLoading={listQ.isLoading}
        error={listQ.error}
        selected={selected}
        setSelected={setSelected}
        onBulkAction={(ids) => actionMut.mutate(ids)}
        bulkPending={actionMut.isPending}
        bulkLabel={mode === "issue" ? "Issue Selected" : "Mark Paid Selected"}
        renderRow={(item) =>
          mode === "issue" ? (
            <>
              <td className="px-3 py-2 text-sm font-mono">{item.number}</td>
              <td className="px-3 py-2 text-sm">{fmtDate(item.invoice_date)}</td>
              <td className="px-3 py-2 text-sm">{item.type === "IN" ? "Hutang" : "Piutang"}</td>
              <td className="px-3 py-2 text-sm">{item.party_name || "—"}</td>
              <td className="px-3 py-2 text-sm font-mono">{fmtIDR(Number(item.total))}</td>
            </>
          ) : (
            <>
              <td className="px-3 py-2 text-sm">
                <span className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                  item.status === "OVERDUE"
                    ? "bg-danger-100 text-danger-800"
                    : item.status === "PARTIALLY_PAID"
                    ? "bg-warning-100 text-warning-800"
                    : "bg-info-100 text-info-800",
                )}>
                  {item.status}
                </span>
              </td>
              <td className="px-3 py-2 text-sm font-mono">{item.number}</td>
              <td className="px-3 py-2 text-sm">{fmtDate(item.invoice_date)}</td>
              <td className="px-3 py-2 text-sm">{item.type === "IN" ? "Hutang" : "Piutang"}</td>
              <td className="px-3 py-2 text-sm">{item.party_name || "—"}</td>
              <td className="px-3 py-2 text-sm font-mono">{fmtIDR(Number(item.total))}</td>
            </>
          )
        }
        headers={headers}
      />
    </div>
  )
}


// ============================================================
// Shared Panel
// ============================================================
interface BulkPanelProps<T extends { id: number }> {
  title: string
  hint: string
  items: T[]
  isLoading: boolean
  error: unknown
  selected: Set<number>
  setSelected: (s: Set<number>) => void
  onBulkAction: (ids: number[]) => void
  bulkPending: boolean
  bulkLabel: string
  renderRow: (item: T) => React.ReactNode
  headers: string[]
}

function BulkPanel<T extends { id: number }>({
  title,
  hint,
  items,
  isLoading,
  error,
  selected,
  setSelected,
  onBulkAction,
  bulkPending,
  bulkLabel,
  renderRow,
  headers,
}: BulkPanelProps<T>) {
  const allSelected = items.length > 0 && items.every((it) => selected.has(it.id))
  const someSelected = !allSelected && items.some((it) => selected.has(it.id))

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(items.map((it) => it.id)))
    }
  }
  const toggleOne = (id: number) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  const handleBulk = () => {
    const ids = Array.from(selected)
    if (ids.length === 0) {
      toast.error("Pilih minimal 1 item")
      return
    }
    if (!confirm(`Konfirmasi: ${bulkLabel.toLowerCase()} ${ids.length} item?`)) return
    onBulkAction(ids)
  }

  return (
    <div className="mt-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">
            {title} <span className="text-ink-500">· {items.length} pending</span>
          </h2>
          <p className="text-[11px] text-ink-500 mt-0.5">{hint}</p>
        </div>
        <Button
          type="button"
          onClick={handleBulk}
          disabled={selected.size === 0 || bulkPending}
          className="gap-1.5"
        >
          {bulkPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          {bulkLabel} ({selected.size})
        </Button>
      </div>

      {isLoading && <Skeleton className="h-48" />}
      {error ? (
        <ErrorState description={apiErrorMessage(error)} />
      ) : null}
      {!isLoading && !error && items.length === 0 && (
        <EmptyState
          title="Tidak ada item pending"
          description="Semua sudah diproses."
        />
      )}

      {!isLoading && !error && items.length > 0 && (
        <div className="overflow-x-auto rounded-md border bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-[11px] uppercase tracking-wider text-ink-600">
              <tr>
                <th className="px-3 py-2 text-left w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected
                    }}
                    onChange={toggleAll}
                    className="h-4 w-4 accent-brand-600"
                  />
                </th>
                {headers.map((h) => (
                  <th key={h} className="px-3 py-2 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr
                  key={it.id}
                  className={cn(
                    "border-t hover:bg-ink-50/50 cursor-pointer",
                    selected.has(it.id) && "bg-brand-50/50",
                  )}
                  onClick={() => toggleOne(it.id)}
                >
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected.has(it.id)}
                      onChange={() => toggleOne(it.id)}
                      className="h-4 w-4 accent-brand-600"
                    />
                  </td>
                  {renderRow(it)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}


function reportBulkResult(label: string, res: BulkResult) {
  const skippedDetail = res.skipped.length > 0
    ? `${res.skipped.length} di-skip (cek detail di console).`
    : ""
  if (res.success_count > 0) {
    toast.success(
      `${res.success_count} ${label} sukses dari ${res.total_requested}.`,
      { description: skippedDetail || undefined },
    )
  } else {
    toast.error(
      `Tidak ada ${label} yang berhasil diproses.`,
      { description: skippedDetail || "Semua di-skip" },
    )
  }
  if (res.skipped.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(`Bulk ${label} skipped:`, res.skipped)
  }
}


// ============================================================
// Types (minimal)
// ============================================================
interface TxItem {
  id: number
  tx_date: string
  type: string
  status: string
  amount: string | number
  party_name: string | null
  description: string | null
}

interface PoItem {
  id: number
  number: string
  status: string
  po_date: string
  vendor_client_name?: string | null
  vendor_name: string | null
  total: string | number
}

interface InvoiceItem {
  id: number
  number: string
  invoice_date: string
  type: string
  status: string
  party_name: string | null
  total: string | number
}
