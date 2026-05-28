/**
 * Bulk Auto-Kategori Invoice per Proyek.
 *
 * Audit 2026-05-24 user req: "supaya tdk kebanyakan request". 1 perintah
 * scan semua invoice di 1 proyek dgn item kategori NULL, AI suggest per
 * item per invoice, admin review + bulk apply.
 *
 * Flow:
 * 1. Pilih proyek
 * 2. Klik Scan -> backend loop invoice, per invoice panggil AI
 * 3. Tabel hasil group by invoice + collapsible item list
 * 4. Admin centang yg mau di-apply (default: high-confidence checked)
 * 5. Apply -> bulk update invoice_items.category_id
 */
import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import {
  CheckCheck, ChevronDown, ChevronRight, Loader2, Receipt,
  Sparkles, Tag,
} from "lucide-react"

import { useAuthStore } from "@/store/auth"
import { api, apiErrorMessage } from "@/lib/api"
import { fmtIDR } from "@/lib/format"
import { usePageTitle } from "@/hooks/usePageTitle"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/data/EmptyState"
import { ErrorState } from "@/components/data/ErrorState"
import { toast } from "@/components/ui/sonner"
import { ProjectPicker } from "@/components/forms/ProjectPicker"
import { CategoryPicker } from "@/components/forms/CategoryPicker"
import { cn } from "@/lib/utils"

interface ItemSuggestion {
  item_id: number
  description: string
  quantity: string | number | null
  unit: string | null
  unit_price: string | number | null
  current_category_id: number | null
  current_category_name: string | null
  suggested_category_id: number | null
  suggested_category_name: string | null
  confidence: number
  reason: string
}

interface InvoiceSuggestion {
  invoice_id: number
  invoice_number: string
  invoice_type: "IN" | "OUT"
  party_name: string | null
  items: ItemSuggestion[]
  high_confidence_count: number
}

interface ScanResp {
  project_id: number
  invoices: InvoiceSuggestion[]
  invoices_scanned: number
  invoices_skipped: number
  items_scanned: number
  summary: string
  ai_calls: number
}

export function BulkInvoiceCategorizePage() {
  usePageTitle("Auto-Kategori Invoice (Bulk)")
  const role = useAuthStore((s) => s.user?.role)
  const isAdmin = role === "SUPERADMIN" || role === "CENTRAL_ADMIN"

  const [projectId, setProjectId] = useState<number | null>(null)
  const [maxItems, setMaxItems] = useState(500)
  const [onlyUncategorized, setOnlyUncategorized] = useState(true)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  // overrides per item_id (admin pilih kategori beda dr saran)
  const [overrides, setOverrides] = useState<Record<number, number>>({})
  // checked per item_id -- yg akan di-apply
  const [checked, setChecked] = useState<Set<number>>(new Set())

  const scanMut = useMutation({
    mutationFn: async (): Promise<ScanResp> => {
      const { data } = await api.post<ScanResp>(
        "/ai/batch-invoice-categorize/categorize-project",
        {
          project_id: projectId,
          only_uncategorized: onlyUncategorized,
          max_items: maxItems,
        },
        // Audit 2026-05-24: AI batch lama (chunk 150 item × N chunk).
        // Override axios default 30s ke 10 menit utk safety margin.
        { timeout: 600_000 },
      )
      return data
    },
    onSuccess: (res) => {
      // Auto-expand semua + auto-check yg high confidence
      const allIds = new Set(res.invoices.map((i) => i.invoice_id))
      setExpanded(allIds)
      const autoChecked = new Set<number>()
      res.invoices.forEach((inv) => {
        inv.items.forEach((it) => {
          if (it.confidence >= 0.7 && it.suggested_category_id) {
            autoChecked.add(it.item_id)
          }
        })
      })
      setChecked(autoChecked)
      setOverrides({})
      toast.success(res.summary)
    },
    onError: (e) => toast.error("Scan gagal", { description: apiErrorMessage(e) }),
  })

  const applyMut = useMutation({
    mutationFn: async (items: Array<{ item_id: number; new_category_id: number }>) => {
      const { data } = await api.post(
        "/ai/batch-invoice-categorize/apply", { items },
      )
      return data
    },
    onSuccess: (res) => {
      toast.success(
        `Apply: ${res.success_count}/${res.total_requested} berhasil`,
      )
      // re-scan utk lihat sisa
      scanMut.mutate()
    },
    onError: (e) => toast.error("Apply gagal", { description: apiErrorMessage(e) }),
  })

  if (!isAdmin) {
    return (
      <div className="p-3 sm:p-5 lg:p-6">
        <EmptyState
          title="Akses Ditolak"
          description="Hanya SUPERADMIN / CENTRAL_ADMIN."
        />
      </div>
    )
  }

  const invoices = scanMut.data?.invoices ?? []
  const totalChecked = checked.size

  const toggleInvoice = (id: number) => {
    const next = new Set(expanded)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setExpanded(next)
  }

  const toggleItem = (id: number) => {
    const next = new Set(checked)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setChecked(next)
  }

  const toggleInvoiceAllItems = (inv: InvoiceSuggestion, allOn: boolean) => {
    const next = new Set(checked)
    inv.items.forEach((it) => {
      if (!it.suggested_category_id) return
      if (allOn) next.add(it.item_id)
      else next.delete(it.item_id)
    })
    setChecked(next)
  }

  const handleApply = () => {
    const items = [...checked].flatMap((iid) => {
      const it = invoices.flatMap((inv) => inv.items).find((x) => x.item_id === iid)
      if (!it) return []
      const cat = overrides[iid] ?? it.suggested_category_id
      if (!cat || cat === it.current_category_id) return []
      return [{ item_id: iid, new_category_id: cat }]
    })
    if (items.length === 0) {
      toast.error("Tidak ada perubahan utk di-apply")
      return
    }
    if (!confirm(`Apply ${items.length} kategorisasi item?`)) return
    applyMut.mutate(items)
  }

  return (
    <div className="flex flex-col gap-3 p-3 sm:p-5 lg:p-6 max-w-6xl">
      <div>
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-brand-600" />
          <h1 className="text-xl font-bold text-ink-900 sm:text-2xl">
            Auto-Kategori Invoice (Bulk)
          </h1>
        </div>
        <p className="text-[13px] text-ink-500 mt-0.5">
          Scan semua invoice di proyek terpilih, AI suggest kategori per
          item (per invoice context-aware), bulk apply.
        </p>
      </div>

      {/* Filter bar */}
      <div className="rounded-md border bg-surface p-3 grid grid-cols-1 sm:grid-cols-4 gap-2">
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label className="text-[11px] uppercase tracking-wider">Proyek</Label>
          <ProjectPicker
            value={projectId}
            onChange={setProjectId}
            placeholder="Pilih proyek..."
            activeOnly={false}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[11px] uppercase tracking-wider">
            Max Items / Call
          </Label>
          <input
            type="number"
            min={1}
            max={1000}
            value={maxItems}
            onChange={(e) => setMaxItems(Number(e.target.value) || 500)}
            className="h-10 rounded border border-border-strong px-3 text-sm"
          />
          <span className="text-[10px] text-ink-500">
            Default 500 -- semua item dlm 1 AI call
          </span>
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-[12px] cursor-pointer">
            <input
              type="checkbox"
              checked={onlyUncategorized}
              onChange={(e) => setOnlyUncategorized(e.target.checked)}
              className="h-4 w-4 accent-brand-600"
            />
            Hanya item belum dikategori
          </label>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-[12px] text-ink-600">
          {scanMut.data && (
            <>
              {invoices.length} invoice ditemukan ·{" "}
              <strong>{totalChecked}</strong> item dipilih untuk apply
            </>
          )}
        </span>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => scanMut.mutate()}
            disabled={!projectId || scanMut.isPending}
          >
            {scanMut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Scan & Saran AI
          </Button>
          <Button
            variant="primary"
            onClick={handleApply}
            disabled={totalChecked === 0 || applyMut.isPending}
          >
            {applyMut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCheck className="h-4 w-4" />
            )}
            Apply Selected ({totalChecked})
          </Button>
        </div>
      </div>

      {scanMut.isPending && <Skeleton className="h-64" />}
      {scanMut.error && <ErrorState description={apiErrorMessage(scanMut.error)} />}

      {scanMut.data && (
        <div className="rounded-md border bg-info-50 px-3 py-2 text-[12px] text-info-800">
          {scanMut.data.summary}
        </div>
      )}

      {scanMut.data && invoices.length === 0 && (
        <EmptyState
          title="Tidak ada invoice utk dikategori"
          description={
            onlyUncategorized
              ? "Semua item di proyek ini sudah punya kategori. Uncheck 'Hanya item belum dikategori' utk scan ulang."
              : "Proyek ini belum punya invoice di status scan."
          }
        />
      )}

      {invoices.map((inv) => {
        const isOpen = expanded.has(inv.invoice_id)
        const allItemsChecked = inv.items.every(
          (it) => !it.suggested_category_id || checked.has(it.item_id),
        )
        const someChecked = inv.items.some((it) => checked.has(it.item_id))
        return (
          <div key={inv.invoice_id} className="rounded-md border bg-surface overflow-hidden">
            <button
              type="button"
              className="w-full flex items-center justify-between gap-3 px-3 py-2 hover:bg-ink-50/50"
              onClick={() => toggleInvoice(inv.invoice_id)}
            >
              <div className="flex items-center gap-2 min-w-0">
                {isOpen ? (
                  <ChevronDown className="h-4 w-4 text-ink-500" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-ink-500" />
                )}
                <Receipt className="h-4 w-4 text-ink-600" />
                <span className="font-mono text-sm font-semibold text-ink-900">
                  {inv.invoice_number}
                </span>
                <span className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase",
                  inv.invoice_type === "IN" ? "bg-info-100 text-info-800" : "bg-success-100 text-success-800",
                )}>
                  {inv.invoice_type === "IN" ? "Hutang" : "Piutang"}
                </span>
                <span className="text-[12px] text-ink-600 truncate">
                  {inv.party_name || "—"}
                </span>
              </div>
              <div className="flex items-center gap-2 text-[12px] text-ink-600">
                <Tag className="h-3.5 w-3.5" />
                {inv.items.length} item ·{" "}
                <span className="text-success-700 font-semibold">
                  {inv.high_confidence_count} high-conf
                </span>
              </div>
            </button>

            {isOpen && (
              <div className="border-t bg-surface-muted/30 p-3">
                <div className="flex justify-end mb-2">
                  <button
                    type="button"
                    onClick={() => toggleInvoiceAllItems(inv, !allItemsChecked)}
                    className="text-[11px] text-brand-700 hover:underline"
                  >
                    {allItemsChecked ? "Uncheck semua" : "Check semua (dgn saran)"}
                  </button>
                </div>
                <div className="overflow-x-auto rounded border bg-surface">
                  <table className="w-full text-sm">
                    <thead className="bg-ink-50 text-[11px] uppercase tracking-wider text-ink-600">
                      <tr>
                        <th className="px-2 py-1.5 w-8">
                          <input
                            type="checkbox"
                            checked={allItemsChecked && someChecked}
                            onChange={() => toggleInvoiceAllItems(inv, !allItemsChecked)}
                            className="h-4 w-4 accent-brand-600"
                          />
                        </th>
                        <th className="px-2 py-1.5 text-left">Deskripsi</th>
                        <th className="px-2 py-1.5 text-right">Qty</th>
                        <th className="px-2 py-1.5 text-right">Harga</th>
                        <th className="px-2 py-1.5 text-left">Saat ini</th>
                        <th className="px-2 py-1.5 text-left">Saran / Override</th>
                        <th className="px-2 py-1.5 text-left">Conf / Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inv.items.map((it) => {
                        const conf = it.confidence
                        const confTone =
                          conf >= 0.85 ? "bg-success-100 text-success-800" :
                          conf >= 0.6 ? "bg-warning-100 text-warning-800" :
                          "bg-ink-100 text-ink-600"
                        const dir = inv.invoice_type === "IN" ? "OUT" : "IN"
                        return (
                          <tr
                            key={it.item_id}
                            className={cn(
                              "border-t",
                              checked.has(it.item_id) && "bg-brand-50/40",
                            )}
                          >
                            <td className="px-2 py-1.5">
                              <input
                                type="checkbox"
                                checked={checked.has(it.item_id)}
                                onChange={() => toggleItem(it.item_id)}
                                disabled={!it.suggested_category_id}
                                className="h-4 w-4 accent-brand-600"
                              />
                            </td>
                            <td className="px-2 py-1.5 text-[12px]">
                              {it.description}
                            </td>
                            <td className="px-2 py-1.5 text-right text-[11px] font-mono">
                              {it.quantity ? `${it.quantity} ${it.unit ?? ""}` : "—"}
                            </td>
                            <td className="px-2 py-1.5 text-right text-[11px] font-mono">
                              {it.unit_price ? fmtIDR(Number(it.unit_price)) : "—"}
                            </td>
                            <td className="px-2 py-1.5 text-[11px]">
                              {it.current_category_name || (
                                <em className="text-ink-400">belum</em>
                              )}
                            </td>
                            <td className="px-2 py-1.5 w-48">
                              <CategoryPicker
                                value={overrides[it.item_id] ?? it.suggested_category_id ?? null}
                                onChange={(id) => {
                                  setOverrides((prev) => ({
                                    ...prev,
                                    [it.item_id]: id ?? 0,
                                  }))
                                }}
                                type={dir as "IN" | "OUT"}
                              />
                            </td>
                            <td className="px-2 py-1.5 max-w-xs">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className={cn(
                                  "rounded px-1.5 py-0.5 text-[10px] font-bold",
                                  confTone,
                                )}>
                                  {(conf * 100).toFixed(0)}%
                                </span>
                                <span className="text-[10px] text-ink-600">
                                  {it.reason}
                                </span>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
