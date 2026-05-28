import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { BadgeCheck, CheckCheck, Loader2, Receipt, Search, Send, ShoppingCart, Trash2, X } from "lucide-react"

import { useAuthStore } from "@/store/auth"
import { api, apiErrorMessage } from "@/lib/api"
import { fmtIDR, fmtDate } from "@/lib/format"
import { usePageTitle } from "@/hooks/usePageTitle"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/data/EmptyState"
import { ErrorState } from "@/components/data/ErrorState"
import { toast } from "@/components/ui/sonner"
import { Input } from "@/components/ui/input"
import { CompanyPicker } from "@/components/forms/CompanyPicker"
import { ProjectPicker } from "@/components/forms/ProjectPicker"
import { cn } from "@/lib/utils"

interface BulkFilters {
  company_id: number | null
  project_id: number | null
  q: string
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
  usePageTitle("Mass Action")
  const role = useAuthStore((s) => s.user?.role)
  const isAdmin = role === "SUPERADMIN" || role === "CENTRAL_ADMIN"
  const [tab, setTab] = useState<TabKey>("tx")
  // Audit 2026-05-23 user req: filter per perusahaan / proyek.
  // Audit 2026-05-24 user req: tambah search bebas (deskripsi / pihak /
  // nomor) -- diteruskan ke backend lewat param `q`.
  const [filters, setFilters] = useState<BulkFilters>({
    company_id: null, project_id: null, q: "",
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
        <h1 className="text-xl font-bold text-ink-900 sm:text-2xl">Mass Action</h1>
        <p className="text-[13px] text-ink-500">
          Verifikasi, terbitkan, tandai lunas, atau hapus banyak item sekaligus.
          {role === "SUPERADMIN" && (
            <span className="ml-1 inline-block rounded bg-warning-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-warning-800">
              god-mode aktif
            </span>
          )}
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
  // Search bebas (q) di-debounce via React Query (queryKey berubah
  // setiap onChange -> auto-refetch).
  return (
    <div className="rounded-md border bg-surface p-2.5 grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
      <div className="flex flex-col gap-1">
        <label className="text-[11px] uppercase tracking-wider text-ink-500">
          Filter Perusahaan
        </label>
        <CompanyPicker
          value={value.company_id}
          onChange={(id) => {
            // Saat company berubah, reset project_id (avoid stale).
            onChange({ ...value, company_id: id, project_id: null })
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
      <div className="flex flex-col gap-1">
        <label className="text-[11px] uppercase tracking-wider text-ink-500">
          Cari (Deskripsi / Pihak / Nomor)
        </label>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
          <Input
            value={value.q}
            onChange={(e) => onChange({ ...value, q: e.target.value })}
            placeholder="cth: tagihan listrik, PT Maju"
            className="pl-8 pr-8"
          />
          {value.q && (
            <button
              type="button"
              onClick={() => onChange({ ...value, q: "" })}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// Segmented mode control utk switching action (verify/approve/issue
// vs delete). Audit 2026-05-24 user req: mass delete satu fitur.
interface ModeOption<M extends string> {
  key: M
  label: string
  icon: typeof CheckCheck
  /** Variant warna: 'default' (brand) atau 'danger' (red utk delete). */
  danger?: boolean
}

function ModeToggle<M extends string>({
  value,
  onChange,
  options,
}: {
  value: M
  onChange: (m: M) => void
  options: ModeOption<M>[]
}) {
  return (
    <div className="inline-flex self-start rounded-md border bg-surface p-0.5 mt-2 flex-wrap">
      {options.map((opt) => {
        const Icon = opt.icon
        const active = value === opt.key
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            className={cn(
              "flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors",
              active
                ? opt.danger
                  ? "bg-danger-100 text-danger-700"
                  : "bg-brand-100 text-brand-700"
                : "text-ink-600 hover:text-ink-900",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {opt.label}
          </button>
        )
      })}
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
type TxMode = "verify" | "delete"

function BulkTxPanel({ filters }: { filters: BulkFilters }) {
  const qc = useQueryClient()
  const [mode, setMode] = useState<TxMode>("verify")
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const listQ = useQuery({
    queryKey: ["bulk-approval", "tx", mode, filters],
    queryFn: async () => {
      const baseParams: Record<string, unknown> = { size: 200 }
      if (filters.project_id) baseParams.project_id = filters.project_id
      if (filters.company_id) baseParams.company_id = filters.company_id
      if (filters.q.trim()) baseParams.q = filters.q.trim()
      if (mode === "verify") {
        // Backend bulk_verify accept DRAFT + SUBMITTED. Fetch keduanya
        // (list endpoint cuma terima 1 status, jadi 2 query lalu merge).
        const [draftRes, submittedRes] = await Promise.all([
          api.get("/transactions", { params: { ...baseParams, status: "DRAFT" } }),
          api.get("/transactions", { params: { ...baseParams, status: "SUBMITTED" } }),
        ])
        const merged = [
          ...(submittedRes.data?.items ?? []),
          ...(draftRes.data?.items ?? []),
        ]
        return {
          items: merged as TxItem[],
          total: (submittedRes.data?.total ?? 0) + (draftRes.data?.total ?? 0),
        }
      }
      // delete mode: semua non-deleted (backend skip per-item kalau
      // VERIFIED -> harus cancel dulu).
      const { data } = await api.get("/transactions", { params: baseParams })
      return data as { items: TxItem[]; total: number }
    },
  })

  const actionMut = useMutation({
    mutationFn: async (ids: number[]): Promise<BulkResult> => {
      const url =
        mode === "verify"
          ? "/transactions/bulk/verify"
          : "/transactions/bulk/delete"
      const { data } = await api.post<BulkResult>(url, { ids })
      return data
    },
    onSuccess: (res) => {
      reportBulkResult("Transaksi", res)
      setSelected(new Set())
      qc.invalidateQueries({ queryKey: ["bulk-approval", "tx"] })
      qc.invalidateQueries({ queryKey: ["transactions"] })
    },
    onError: (err) =>
      toast.error(
        mode === "verify" ? "Bulk verify gagal" : "Bulk delete gagal",
        { description: apiErrorMessage(err) },
      ),
  })

  return (
    <div className="flex flex-col gap-2">
      <ModeToggle<TxMode>
        value={mode}
        onChange={(m) => {
          setMode(m)
          setSelected(new Set())
        }}
        options={[
          { key: "verify", label: "Verify (DRAFT+SUBMITTED)", icon: CheckCheck },
          { key: "delete", label: "Delete (semua status)", icon: Trash2, danger: true },
        ]}
      />
      <BulkPanel
        title={mode === "verify" ? "Transaksi SUBMITTED" : "Transaksi"}
        hint={
          mode === "verify"
            ? "VERIFIED akan masuk laporan finansial. Pastikan sudah review masing-masing tx."
            : "Soft-delete tx (bisa di-restore admin). VERIFIED akan di-skip -- cancel dulu kalau perlu hapus."
        }
        items={listQ.data?.items ?? []}
        isLoading={listQ.isLoading}
        error={listQ.error}
        selected={selected}
        setSelected={setSelected}
        onBulkAction={(ids) => actionMut.mutate(ids)}
        bulkPending={actionMut.isPending}
        bulkLabel={mode === "verify" ? "Verify Selected" : "Delete Selected"}
        bulkVariant={mode === "verify" ? "default" : "danger"}
        renderRow={(item) => (
          <>
            <td className="px-3 py-2 text-sm">
              <span className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                txStatusClass(item.status),
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
    </div>
  )
}

function txStatusClass(status: string): string {
  switch (status) {
    case "DRAFT":     return "bg-ink-100 text-ink-700"
    case "SUBMITTED": return "bg-warning-100 text-warning-800"
    case "VERIFIED":  return "bg-success-100 text-success-800"
    case "REJECTED":  return "bg-danger-100 text-danger-800"
    case "CANCELLED": return "bg-ink-200 text-ink-600"
    default:          return "bg-ink-100 text-ink-700"
  }
}

// ============================================================
// PO panel
// ============================================================
type PoMode = "approve" | "delete"

function BulkPoPanel({ filters }: { filters: BulkFilters }) {
  const qc = useQueryClient()
  const [mode, setMode] = useState<PoMode>("approve")
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const listQ = useQuery({
    queryKey: ["bulk-approval", "po", mode, filters],
    queryFn: async () => {
      const baseParams: Record<string, unknown> = { size: 200 }
      if (filters.project_id) baseParams.project_id = filters.project_id
      if (filters.company_id) baseParams.company_id = filters.company_id
      if (filters.q.trim()) baseParams.q = filters.q.trim()
      if (mode === "approve") {
        // Backend bulk_approve accept DRAFT + ISSUED. Fetch keduanya.
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
      }
      const { data } = await api.get("/purchase-orders", { params: baseParams })
      return data as { items: PoItem[]; total: number }
    },
  })

  const actionMut = useMutation({
    mutationFn: async (ids: number[]): Promise<BulkResult> => {
      const url =
        mode === "approve"
          ? "/purchase-orders/bulk/approve"
          : "/purchase-orders/bulk/delete"
      const { data } = await api.post<BulkResult>(url, { ids })
      return data
    },
    onSuccess: (res) => {
      reportBulkResult("PO", res)
      setSelected(new Set())
      qc.invalidateQueries({ queryKey: ["bulk-approval", "po"] })
      qc.invalidateQueries({ queryKey: ["pos"] })
    },
    onError: (err) =>
      toast.error(
        mode === "approve" ? "Bulk approve gagal" : "Bulk delete gagal",
        { description: apiErrorMessage(err) },
      ),
  })

  return (
    <div className="flex flex-col gap-2">
      <ModeToggle<PoMode>
        value={mode}
        onChange={(m) => {
          setMode(m)
          setSelected(new Set())
        }}
        options={[
          { key: "approve", label: "Approve (DRAFT+ISSUED)", icon: CheckCheck },
          { key: "delete", label: "Delete (semua status)", icon: Trash2, danger: true },
        ]}
      />
      <BulkPanel
        title={mode === "approve" ? "PO DRAFT / ISSUED" : "PO"}
        hint={
          mode === "approve"
            ? "APPROVED = PO siap dikirim ke vendor & dialokasi ke pembayaran. DRAFT akan skip step ISSUED."
            : "Soft-delete PO. Hanya DRAFT / CANCELLED yg bisa dihapus -- ISSUED/APPROVED harus cancel dulu (di-skip otomatis)."
        }
        items={listQ.data?.items ?? []}
        isLoading={listQ.isLoading}
        error={listQ.error}
        selected={selected}
        setSelected={setSelected}
        onBulkAction={(ids) => actionMut.mutate(ids)}
        bulkPending={actionMut.isPending}
        bulkLabel={mode === "approve" ? "Approve Selected" : "Delete Selected"}
        bulkVariant={mode === "approve" ? "default" : "danger"}
        renderRow={(item) => (
          <>
            <td className="px-3 py-2 text-sm">
              <span className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                poStatusClass(item.status),
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
    </div>
  )
}

function poStatusClass(status: string): string {
  switch (status) {
    case "DRAFT":     return "bg-ink-100 text-ink-700"
    case "ISSUED":    return "bg-warning-100 text-warning-800"
    case "APPROVED":  return "bg-success-100 text-success-800"
    case "CANCELLED": return "bg-ink-200 text-ink-600"
    default:          return "bg-ink-100 text-ink-700"
  }
}

// ============================================================
// Invoice panel
// ============================================================
// Audit 2026-05-24 user req: invoice bulk action tdk cuma Issue.
// Tambah Mark-Paid utk invoice ISSUED/PARTIALLY_PAID/OVERDUE + Delete
// mass. Mode segmented supaya satu tab cukup, action context-aware.
type InvoiceMode = "issue" | "mark-paid" | "delete"

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
      if (filters.q.trim()) baseParams.q = filters.q.trim()
      if (mode === "issue") {
        const { data } = await api.get("/invoices", {
          params: { ...baseParams, status: "DRAFT" },
        })
        return data as { items: InvoiceItem[]; total: number }
      }
      if (mode === "mark-paid") {
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
      }
      // delete mode: semua non-deleted
      const { data } = await api.get("/invoices", { params: baseParams })
      return data as { items: InvoiceItem[]; total: number }
    },
  })

  const actionMut = useMutation({
    mutationFn: async (ids: number[]): Promise<BulkResult> => {
      const url =
        mode === "issue"
          ? "/invoices/bulk/issue"
          : mode === "mark-paid"
          ? "/invoices/bulk/mark-paid"
          : "/invoices/bulk/delete"
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
    onError: (err) => {
      const label =
        mode === "issue"
          ? "Bulk issue gagal"
          : mode === "mark-paid"
          ? "Bulk mark paid gagal"
          : "Bulk delete gagal"
      toast.error(label, { description: apiErrorMessage(err) })
    },
  })

  const showStatusCol = mode !== "issue"
  const headers = showStatusCol
    ? ["Status", "Nomor", "Tanggal", "Tipe", "Pihak", "Total"]
    : ["Nomor", "Tanggal", "Tipe", "Pihak", "Total"]

  return (
    <div className="flex flex-col gap-2">
      <ModeToggle<InvoiceMode>
        value={mode}
        onChange={(m) => {
          setMode(m)
          setSelected(new Set())
        }}
        options={[
          { key: "issue", label: "Issue (DRAFT)", icon: Send },
          { key: "mark-paid", label: "Tandai Lunas (ISSUED+)", icon: BadgeCheck },
          { key: "delete", label: "Delete (semua status)", icon: Trash2, danger: true },
        ]}
      />

      <BulkPanel
        title={
          mode === "issue"
            ? "Invoice DRAFT"
            : mode === "mark-paid"
            ? "Invoice Outstanding"
            : "Invoice"
        }
        hint={
          mode === "issue"
            ? "ISSUED = invoice resmi masuk piutang/hutang & laporan."
            : mode === "mark-paid"
            ? "Tandai lunas: auto-create TX pelunasan (VERIFIED) sebesar outstanding tiap invoice."
            : "Soft-delete invoice (bisa di-restore admin). Allocation row TIDAK ikut diubah (mirror single delete)."
        }
        items={listQ.data?.items ?? []}
        isLoading={listQ.isLoading}
        error={listQ.error}
        selected={selected}
        setSelected={setSelected}
        onBulkAction={(ids) => actionMut.mutate(ids)}
        bulkPending={actionMut.isPending}
        bulkLabel={
          mode === "issue"
            ? "Issue Selected"
            : mode === "mark-paid"
            ? "Mark Paid Selected"
            : "Delete Selected"
        }
        bulkVariant={mode === "delete" ? "danger" : "default"}
        renderRow={(item) => (
          <>
            {showStatusCol && (
              <td className="px-3 py-2 text-sm">
                <span className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                  invoiceStatusClass(item.status),
                )}>
                  {item.status}
                </span>
              </td>
            )}
            <td className="px-3 py-2 text-sm font-mono">{item.number}</td>
            <td className="px-3 py-2 text-sm">{fmtDate(item.invoice_date)}</td>
            <td className="px-3 py-2 text-sm">{item.type === "IN" ? "Hutang" : "Piutang"}</td>
            <td className="px-3 py-2 text-sm">{item.party_name || "—"}</td>
            <td className="px-3 py-2 text-sm font-mono">{fmtIDR(Number(item.total))}</td>
          </>
        )}
        headers={headers}
      />
    </div>
  )
}

function invoiceStatusClass(status: string): string {
  switch (status) {
    case "DRAFT":          return "bg-ink-100 text-ink-700"
    case "ISSUED":         return "bg-info-100 text-info-800"
    case "PARTIALLY_PAID": return "bg-warning-100 text-warning-800"
    case "OVERDUE":        return "bg-danger-100 text-danger-800"
    case "PAID":           return "bg-success-100 text-success-800"
    case "CANCELLED":      return "bg-ink-200 text-ink-600"
    default:               return "bg-ink-100 text-ink-700"
  }
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
  /** Tampilan action button: 'default' (brand) atau 'danger' (red). */
  bulkVariant?: "default" | "danger"
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
  bulkVariant = "default",
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
    // Konfirmasi extra-eksplisit utk delete (destructive). Soft-delete
    // tetap reversible tp lebih baik double-check supaya tdk salah klik.
    const msg =
      bulkVariant === "danger"
        ? `HAPUS ${ids.length} item? Soft-delete bisa di-restore admin, tp pastikan dulu.`
        : `Konfirmasi: ${bulkLabel.toLowerCase()} ${ids.length} item?`
    if (!confirm(msg)) return
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
          variant={bulkVariant === "danger" ? "danger" : "primary"}
          className="gap-1.5"
        >
          {bulkPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : bulkVariant === "danger" ? (
            <Trash2 className="h-4 w-4" />
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
