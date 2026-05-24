/**
 * Audit Kategorisasi -- admin scan tx VERIFIED yg suspect mis-categorized.
 *
 * Audit 2026-05-24 user req: admin proyek sering salah kategori. Mass-scan
 * tool: AI flag tx yg kategori-nya bertentangan dgn pattern history
 * vendor. Admin review, pilih item, klik Apply -> bulk update.
 *
 * Flow:
 * 1. Filter (proyek, periode, arah) + tombol Scan
 * 2. Tabel hasil dgn checkbox + override suggested kategori per row
 * 3. Apply Selected -> bulk recategorize
 */
import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { CheckCheck, Loader2, RefreshCw, Tag } from "lucide-react"

import { useAuthStore } from "@/store/auth"
import { api, apiErrorMessage } from "@/lib/api"
import { fmtIDR, fmtDate } from "@/lib/format"
import { usePageTitle } from "@/hooks/usePageTitle"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/data/EmptyState"
import { ErrorState } from "@/components/data/ErrorState"
import { toast } from "@/components/ui/sonner"
import { ProjectPicker } from "@/components/forms/ProjectPicker"
import { CategoryPicker } from "@/components/forms/CategoryPicker"
import { cn } from "@/lib/utils"

interface FlaggedItem {
  tx_id: number
  tx_date: string
  party_name: string | null
  description: string | null
  amount: string | number
  current_category_id: number | null
  current_category_name: string | null
  suggested_category_id: number | null
  suggested_category_name: string | null
  confidence: number
  reason: string
  is_miscategorized: boolean
}

interface ScanResp {
  flagged: FlaggedItem[]
  summary: string
  candidates_count: number
  ai_used: boolean
}

export function CategoryAuditPage() {
  usePageTitle("Audit Kategorisasi")
  const role = useAuthStore((s) => s.user?.role)
  const isAdmin = role === "SUPERADMIN" || role === "CENTRAL_ADMIN"
  const qc = useQueryClient()

  const [projectId, setProjectId] = useState<number | null>(null)
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [direction, setDirection] = useState<"" | "IN" | "OUT">("OUT")
  const [useAI, setUseAI] = useState(true)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  // override per row (kalau admin tdk setuju saran AI, ganti manual)
  const [overrides, setOverrides] = useState<Record<number, number>>({})

  const scanMut = useMutation({
    mutationFn: async (): Promise<ScanResp> => {
      const { data } = await api.post<ScanResp>("/ai/category-audit/scan", {
        project_id: projectId,
        date_from: dateFrom || null,
        date_to: dateTo || null,
        direction: direction || null,
        use_ai: useAI,
      })
      return data
    },
    onSuccess: (res) => {
      setSelected(new Set())
      setOverrides({})
      toast.success(`Scan selesai: ${res.flagged.length} item ter-flag`, {
        description: res.summary,
      })
    },
    onError: (e) => toast.error("Scan gagal", { description: apiErrorMessage(e) }),
  })

  const applyMut = useMutation({
    mutationFn: async (
      items: Array<{ tx_id: number; new_category_id: number }>,
    ) => {
      const { data } = await api.post("/ai/category-audit/apply", { items })
      return data
    },
    onSuccess: (res) => {
      toast.success(
        `Apply: ${res.success_count}/${res.total_requested} berhasil`,
        { description: `Skipped: ${res.skipped.length}` },
      )
      setSelected(new Set())
      setOverrides({})
      qc.invalidateQueries({ queryKey: ["transactions"] })
      // re-scan
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

  const flagged = scanMut.data?.flagged ?? []
  const allSelected = flagged.length > 0 && selected.size === flagged.length
  const toggleAll = () => {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(flagged.map((f) => f.tx_id)))
  }
  const toggleOne = (tid: number) => {
    const next = new Set(selected)
    if (next.has(tid)) next.delete(tid)
    else next.add(tid)
    setSelected(next)
  }

  const handleApply = () => {
    const items = [...selected].flatMap((tid) => {
      const f = flagged.find((x) => x.tx_id === tid)
      if (!f) return []
      const newCat = overrides[tid] ?? f.suggested_category_id
      if (!newCat || newCat === f.current_category_id) return []
      return [{ tx_id: tid, new_category_id: newCat }]
    })
    if (items.length === 0) {
      toast.error("Tidak ada perubahan yg valid utk diapply")
      return
    }
    if (!confirm(`Apply ${items.length} re-kategorisasi?`)) return
    applyMut.mutate(items)
  }

  return (
    <div className="flex flex-col gap-3 p-3 sm:p-5 lg:p-6">
      <div>
        <div className="flex items-center gap-2">
          <Tag className="h-5 w-5 text-brand-600" />
          <h1 className="text-xl font-bold text-ink-900 sm:text-2xl">
            Audit Kategorisasi
          </h1>
        </div>
        <p className="text-[13px] text-ink-500 mt-0.5">
          Scan TX VERIFIED yg kategorinya tdk konsisten dgn pattern vendor.
          AI verdict + bulk fix.
        </p>
      </div>

      {/* Filter bar */}
      <div className="rounded-md border bg-surface p-3 grid grid-cols-1 sm:grid-cols-4 gap-2">
        <div className="flex flex-col gap-1">
          <Label className="text-[11px] uppercase tracking-wider">Proyek</Label>
          <ProjectPicker
            value={projectId}
            onChange={setProjectId}
            placeholder="Semua proyek"
            activeOnly={false}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[11px] uppercase tracking-wider">Dari Tgl</Label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[11px] uppercase tracking-wider">S/d Tgl</Label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[11px] uppercase tracking-wider">Arah</Label>
          <Select
            value={direction}
            onChange={(e) => setDirection(e.target.value as "" | "IN" | "OUT")}
          >
            <option value="">Semua</option>
            <option value="OUT">OUT (pengeluaran)</option>
            <option value="IN">IN (pemasukan)</option>
          </Select>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <label className="flex items-center gap-2 text-[13px] text-ink-700 cursor-pointer">
          <input
            type="checkbox"
            checked={useAI}
            onChange={(e) => setUseAI(e.target.checked)}
            className="h-4 w-4 accent-brand-600"
          />
          Pakai AI verdict (lebih akurat, ada cost). Uncheck = SQL-only (gratis, basic).
        </label>
        <Button onClick={() => scanMut.mutate()} disabled={scanMut.isPending}>
          {scanMut.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Scan
        </Button>
      </div>

      {scanMut.isPending && <Skeleton className="h-64" />}
      {scanMut.error && <ErrorState description={apiErrorMessage(scanMut.error)} />}

      {scanMut.data && (
        <>
          <div className="rounded-md border bg-info-50 px-3 py-2 text-[12px] text-info-800">
            <strong>{scanMut.data.candidates_count}</strong> kandidat dari pre-filter SQL.
            AI memflag <strong>{flagged.length}</strong>.{" "}
            {scanMut.data.summary}
          </div>

          {flagged.length > 0 && (
            <>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[12px] text-ink-600">
                  {selected.size} dipilih
                </span>
                <Button
                  onClick={handleApply}
                  disabled={selected.size === 0 || applyMut.isPending}
                >
                  {applyMut.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCheck className="h-4 w-4" />
                  )}
                  Apply Selected ({selected.size})
                </Button>
              </div>

              <div className="overflow-x-auto rounded-md border bg-surface">
                <table className="w-full text-sm">
                  <thead className="bg-ink-50 text-[11px] uppercase tracking-wider text-ink-600">
                    <tr>
                      <th className="px-2 py-2 w-8">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={toggleAll}
                          className="h-4 w-4 accent-brand-600"
                        />
                      </th>
                      <th className="px-2 py-2 text-left">Tgl</th>
                      <th className="px-2 py-2 text-left">Vendor / Deskripsi</th>
                      <th className="px-2 py-2 text-right">Nominal</th>
                      <th className="px-2 py-2 text-left">Kategori Sekarang</th>
                      <th className="px-2 py-2 text-left">Saran AI</th>
                      <th className="px-2 py-2 text-left">Override</th>
                      <th className="px-2 py-2 text-left">Confidence / Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flagged.map((f) => {
                      const conf = f.confidence
                      const confTone =
                        conf >= 0.85 ? "bg-success-100 text-success-800" :
                        conf >= 0.6 ? "bg-warning-100 text-warning-800" :
                        "bg-ink-100 text-ink-600"
                      return (
                        <tr
                          key={f.tx_id}
                          className={cn(
                            "border-t hover:bg-ink-50/50",
                            selected.has(f.tx_id) && "bg-brand-50/40",
                          )}
                        >
                          <td className="px-2 py-2">
                            <input
                              type="checkbox"
                              checked={selected.has(f.tx_id)}
                              onChange={() => toggleOne(f.tx_id)}
                              className="h-4 w-4 accent-brand-600"
                            />
                          </td>
                          <td className="px-2 py-2 text-[12px] text-ink-600 whitespace-nowrap">
                            {fmtDate(f.tx_date)}
                          </td>
                          <td className="px-2 py-2">
                            <div className="font-medium text-ink-900 text-[13px]">
                              {f.party_name || "—"}
                            </div>
                            <div className="text-[11px] text-ink-500 truncate max-w-xs">
                              {f.description || "—"}
                            </div>
                          </td>
                          <td className="px-2 py-2 text-right font-mono text-[12px]">
                            {fmtIDR(Number(f.amount))}
                          </td>
                          <td className="px-2 py-2 text-[12px]">
                            {f.current_category_name || "—"}
                          </td>
                          <td className="px-2 py-2 text-[12px] text-brand-700 font-medium">
                            {f.suggested_category_name || "—"}
                          </td>
                          <td className="px-2 py-2 w-48">
                            <CategoryPicker
                              value={overrides[f.tx_id] ?? f.suggested_category_id ?? null}
                              onChange={(id) => {
                                setOverrides((prev) => ({
                                  ...prev, [f.tx_id]: id ?? 0,
                                }))
                              }}
                              type={(direction || undefined) as "IN" | "OUT" | undefined}
                            />
                          </td>
                          <td className="px-2 py-2 max-w-md">
                            <div className="flex items-center gap-1.5">
                              <span className={cn(
                                "rounded px-1.5 py-0.5 text-[10px] font-bold",
                                confTone,
                              )}>
                                {(conf * 100).toFixed(0)}%
                              </span>
                            </div>
                            <div className="text-[11px] text-ink-600 mt-0.5">
                              {f.reason}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {flagged.length === 0 && (
            <EmptyState
              title="Tdk ada anomali"
              description="Kategorisasi konsisten dgn pattern vendor."
            />
          )}
        </>
      )}
    </div>
  )
}
