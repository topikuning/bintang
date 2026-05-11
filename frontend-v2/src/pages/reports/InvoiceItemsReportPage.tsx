import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import {
  ArrowLeft,
  Download,
  FileMinus,
  FilePlus,
  Receipt,
  Search,
  X,
} from "lucide-react"
import { useInvoices } from "@/hooks/useInvoices"
import { useProjects } from "@/hooks/useProjects"
import { useUIPrefs } from "@/store/ui-prefs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/data/ErrorState"
import { ProjectPicker } from "@/components/forms/ProjectPicker"
import { StatusBadge } from "@/components/domain/shared/StatusBadge"
import { fmtCompact, fmtDate, fmtIDR } from "@/lib/format"
import { apiErrorMessage } from "@/lib/api"
import { toast } from "@/components/ui/sonner"
import type {
  Invoice,
  InvoiceItem,
  InvoiceStatus,
  InvoiceType,
  Project,
} from "@/types/api"
import { cn } from "@/lib/utils"

/**
 * Halaman Laporan Detail Invoice: flatten semua invoice items lintas
 * invoice jadi 1 tabel besar. Bisa filter periode/proyek/tipe/status,
 * plus export CSV client-side.
 *
 * Use case: audit, cetak rincian per item, atau quick scan tanpa harus
 * klik per invoice satu-satu.
 */

type TypeFilter = "ALL" | InvoiceType
type StatusFilter = "ALL" | InvoiceStatus

interface FlatRow {
  invoice: Invoice
  item: InvoiceItem
  idxInInvoice: number
}

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "ALL", label: "Semua status" },
  { value: "ISSUED", label: "Belum Lunas" },
  { value: "PARTIALLY_PAID", label: "Sebagian Dibayar" },
  { value: "OVERDUE", label: "Jatuh Tempo" },
  { value: "PAID", label: "Lunas" },
  { value: "DRAFT", label: "Draft" },
  { value: "CANCELLED", label: "Dibatalkan" },
]

const TYPE_OPTIONS: Array<{ value: TypeFilter; label: string }> = [
  { value: "ALL", label: "Semua tipe" },
  { value: "IN", label: "Hutang (Invoice masuk)" },
  { value: "OUT", label: "Piutang (Invoice keluar)" },
]

export function InvoiceItemsReportPage() {
  const { defaultProjectId } = useUIPrefs()
  const [projectId, setProjectId] = useState<number | null>(defaultProjectId)
  const [type, setType] = useState<TypeFilter>("ALL")
  const [status, setStatus] = useState<StatusFilter>("ALL")
  const [dateFrom, setDateFrom] = useState<string>("")
  const [dateTo, setDateTo] = useState<string>("")
  // Pencarian teks bebas: dicari di deskripsi item, satuan, no invoice,
  // nama vendor/klien, dan kode/nama proyek. Client-side (instant) krn
  // data sudah ada di memory.
  const [searchText, setSearchText] = useState<string>("")
  // Min/max nilai subtotal item utk audit (mis. cari item > 10jt).
  const [minSubtotal, setMinSubtotal] = useState<string>("")
  const [maxSubtotal, setMaxSubtotal] = useState<string>("")

  const invQuery = useInvoices({
    project_id: projectId ?? undefined,
    type: type === "ALL" ? undefined : type,
    status: status === "ALL" ? undefined : status,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    size: 2000,
  })
  const projectsQuery = useProjects({ size: 200 })

  const projectMap = useMemo(() => {
    const m = new Map<number, Project>()
    projectsQuery.data?.items.forEach((p) => m.set(p.id, p))
    return m
  }, [projectsQuery.data])

  // Build flat rows DULU dari hasil fetch (semua filter server-side).
  const allRows = useMemo<FlatRow[]>(() => {
    const list: FlatRow[] = []
    for (const inv of invQuery.data?.items ?? []) {
      const items = inv.items ?? []
      items.forEach((it, idx) => list.push({ invoice: inv, item: it, idxInInvoice: idx }))
    }
    return list
  }, [invQuery.data])

  // Lalu apply client-side filter (search text + min/max subtotal).
  const rows = useMemo<FlatRow[]>(() => {
    const needle = searchText.trim().toLowerCase()
    const minN = minSubtotal === "" ? null : Number(minSubtotal)
    const maxN = maxSubtotal === "" ? null : Number(maxSubtotal)
    return allRows.filter((r) => {
      if (needle) {
        const p = projectMap.get(r.invoice.project_id)
        const hay = [
          r.item.description ?? "",
          r.item.unit ?? "",
          r.invoice.number ?? "",
          r.invoice.party_name ?? "",
          p?.name ?? "",
          p?.code ?? "",
          r.invoice.notes ?? "",
        ]
          .join(" ")
          .toLowerCase()
        if (!hay.includes(needle)) return false
      }
      if (minN != null && !Number.isNaN(minN)) {
        if (Number(r.item.subtotal) < minN) return false
      }
      if (maxN != null && !Number.isNaN(maxN)) {
        if (Number(r.item.subtotal) > maxN) return false
      }
      return true
    })
  }, [allRows, searchText, minSubtotal, maxSubtotal, projectMap])

  const totalQty = rows.reduce((s, r) => s + Number(r.item.quantity || 0), 0)
  const totalSubtotal = rows.reduce((s, r) => s + Number(r.item.subtotal || 0), 0)

  const handleExportCSV = () => {
    if (rows.length === 0) {
      toast.error("Tidak ada data untuk diekspor")
      return
    }
    try {
      const headers = [
        "No Invoice",
        "Tanggal Invoice",
        "Jatuh Tempo",
        "Tipe",
        "Status",
        "Proyek (Kode)",
        "Proyek (Nama)",
        "Vendor/Klien",
        "No Urut Item",
        "Deskripsi",
        "Qty",
        "Satuan",
        "Harga Satuan",
        "Subtotal",
      ]
      const escape = (v: unknown): string => {
        const s = v == null ? "" : String(v)
        if (s.includes(",") || s.includes('"') || s.includes("\n")) {
          return `"${s.replace(/"/g, '""')}"`
        }
        return s
      }
      const lines = [headers.map(escape).join(",")]
      for (const r of rows) {
        const p = projectMap.get(r.invoice.project_id)
        lines.push(
          [
            r.invoice.number,
            r.invoice.invoice_date,
            r.invoice.due_date ?? "",
            r.invoice.type === "IN" ? "Hutang" : "Piutang",
            r.invoice.status,
            p?.code ?? "",
            p?.name ?? "",
            r.invoice.party_name ?? "",
            r.idxInInvoice + 1,
            r.item.description,
            Number(r.item.quantity),
            r.item.unit ?? "",
            Number(r.item.unit_price),
            Number(r.item.subtotal),
          ]
            .map(escape)
            .join(","),
        )
      }
      // BOM utk Excel id-ID supaya unicode (—, /, dst) muncul benar.
      const csv = "﻿" + lines.join("\n")
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      const ts = new Date().toISOString().slice(0, 10)
      a.href = url
      a.download = `laporan-invoice-items-${ts}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success(`Berhasil ekspor ${rows.length} baris ke CSV`)
    } catch (err) {
      toast.error("Gagal ekspor CSV", { description: apiErrorMessage(err) })
    }
  }

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
    <div className="flex flex-col gap-4 p-3 sm:p-5 lg:p-6">
      {/* Header */}
      <div>
        <Link
          to="/reports"
          className="inline-flex items-center gap-1 text-[12px] text-ink-500 hover:text-ink-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Kembali ke Laporan
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-ink-900 sm:text-2xl">
              Laporan Detail Invoice
            </h1>
            <p className="text-[13px] text-ink-500 mt-0.5">
              Semua item dr seluruh invoice di-flatten jadi 1 tabel. Untuk audit
              & cetak rincian per item.
            </p>
          </div>
          <Button
            onClick={handleExportCSV}
            disabled={invQuery.isLoading || rows.length === 0}
            size="md"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Search bar -- prioritas utama utk audit. */}
      <div className="rounded-md border bg-surface p-3 sm:p-4">
        <Field
          label="Cari di rincian item"
          hint="Cari di deskripsi, satuan, no invoice, nama vendor/klien, kode/nama proyek, dan catatan invoice."
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
            <Input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Mis. 'semen', 'PT Beton Jaya', 'INV-2025-0042', 'KNMP-MTR'…"
              className="pl-9 pr-9"
              autoFocus
            />
            {searchText && (
              <button
                type="button"
                onClick={() => setSearchText("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded text-ink-500 hover:bg-ink-100 hover:text-ink-900"
                aria-label="Hapus pencarian"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </Field>
      </div>

      {/* Filter bar */}
      <div className="rounded-md border bg-surface p-3 sm:p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <Field label="Proyek">
          <ProjectPicker
            value={projectId}
            onChange={setProjectId}
            activeOnly={false}
            placeholder="Semua proyek"
          />
        </Field>
        <Field label="Tipe">
          <Select value={type} onChange={(e) => setType(e.target.value as TypeFilter)}>
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Dari Tanggal">
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </Field>
        <Field label="Sampai Tanggal">
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </Field>
      </div>

      {/* Nilai filter -- berguna utk audit "tampilkan item > 10jt" dll */}
      <div className="rounded-md border bg-surface p-3 sm:p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Field label="Subtotal Min (Rp)">
          <Input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={minSubtotal}
            onChange={(e) => setMinSubtotal(e.target.value)}
            placeholder="0"
            className="font-mono [font-variant-numeric:tabular-nums]"
          />
        </Field>
        <Field label="Subtotal Max (Rp)">
          <Input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={maxSubtotal}
            onChange={(e) => setMaxSubtotal(e.target.value)}
            placeholder="tanpa batas"
            className="font-mono [font-variant-numeric:tabular-nums]"
          />
        </Field>
        <div className="col-span-2 flex items-end">
          {(searchText || minSubtotal || maxSubtotal) && (
            <button
              type="button"
              onClick={() => {
                setSearchText("")
                setMinSubtotal("")
                setMaxSubtotal("")
              }}
              className="text-[12px] text-brand-600 hover:underline"
            >
              ✕ Hapus semua filter pencarian
            </button>
          )}
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <SummaryCard
          icon={Receipt}
          label="Total Item"
          value={String(rows.length)}
          hint={
            allRows.length !== rows.length
              ? `dr ${allRows.length} item (terfilter)`
              : `dari ${invQuery.data?.items.length ?? 0} invoice`
          }
        />
        <SummaryCard
          label="Total Qty"
          value={String(totalQty)}
          hint="semua satuan"
        />
        <SummaryCard
          icon={FilePlus}
          label="Total Nilai"
          value={fmtCompact(totalSubtotal)}
          hint={fmtIDR(totalSubtotal)}
          tone="info"
        />
        <SummaryCard
          icon={FileMinus}
          label="Rata² per Item"
          value={fmtCompact(rows.length > 0 ? totalSubtotal / rows.length : 0)}
          hint="subtotal / jumlah item"
        />
      </div>

      {/* Table */}
      <div className="rounded-md border bg-surface overflow-hidden">
        {invQuery.isLoading ? (
          <div className="p-3 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-[13px] text-ink-500">
            {searchText.trim() || minSubtotal || maxSubtotal
              ? `Tidak ada item yg cocok dgn pencarian${searchText.trim() ? ` "${searchText.trim()}"` : ""}.`
              : "Tidak ada item invoice yang cocok dgn filter."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] border-collapse">
              <thead className="bg-surface-muted sticky top-0">
                <tr>
                  <Th>No Invoice</Th>
                  <Th>Tanggal</Th>
                  <Th>Tipe</Th>
                  <Th>Status</Th>
                  <Th>Proyek</Th>
                  <Th>Vendor / Klien</Th>
                  <Th>Item ke-</Th>
                  <Th className="min-w-[240px]">Deskripsi</Th>
                  <Th num>Qty</Th>
                  <Th>Sat.</Th>
                  <Th num>Harga Satuan</Th>
                  <Th num>Subtotal</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const p = projectMap.get(r.invoice.project_id)
                  return (
                    <tr
                      key={`${r.invoice.id}-${r.item.id}`}
                      className="border-b hover:bg-brand-50/30"
                    >
                      <td className="px-2 py-1.5">
                        <Link
                          to={`/invoices?id=${r.invoice.id}`}
                          className="font-mono text-brand-700 hover:underline"
                        >
                          {r.invoice.number}
                        </Link>
                      </td>
                      <td className="px-2 py-1.5">{fmtDate(r.invoice.invoice_date)}</td>
                      <td className="px-2 py-1.5">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold",
                            r.invoice.type === "IN"
                              ? "bg-warning-50 text-warning-700"
                              : "bg-info-50 text-info-700",
                          )}
                        >
                          {r.invoice.type === "IN" ? "Hutang" : "Piutang"}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <StatusBadge domain="invoice" status={r.invoice.status} />
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="leading-tight">
                          <div className="truncate max-w-[180px]">{p?.name ?? "—"}</div>
                          {p?.code && (
                            <div className="text-[10px] text-ink-500 font-mono">
                              {p.code}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 truncate max-w-[180px]">
                        {r.invoice.party_name ?? "—"}
                      </td>
                      <td className="px-2 py-1.5 text-center text-ink-500">
                        {r.idxInInvoice + 1}
                      </td>
                      <td className="px-2 py-1.5 align-top">
                        <Highlight text={r.item.description} term={searchText.trim()} />
                      </td>
                      <td
                        data-num
                        className="px-2 py-1.5 text-right font-mono [font-variant-numeric:tabular-nums]"
                      >
                        {Number(r.item.quantity)}
                      </td>
                      <td className="px-2 py-1.5 text-ink-700">
                        {r.item.unit ?? "—"}
                      </td>
                      <td
                        data-num
                        className="px-2 py-1.5 text-right font-mono [font-variant-numeric:tabular-nums]"
                      >
                        {fmtIDR(r.item.unit_price)}
                      </td>
                      <td
                        data-num
                        className="px-2 py-1.5 text-right font-mono font-semibold [font-variant-numeric:tabular-nums]"
                      >
                        {fmtIDR(r.item.subtotal)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="bg-surface-muted border-t-2">
                <tr>
                  <td
                    colSpan={11}
                    className="px-2 py-2 text-right text-ink-900 font-bold"
                  >
                    TOTAL ({rows.length} item)
                  </td>
                  <td
                    data-num
                    className="px-2 py-2 text-right font-mono font-bold text-brand-700 [font-variant-numeric:tabular-nums]"
                  >
                    {fmtIDR(totalSubtotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================
// Helpers
// ============================================================
function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-[11px] uppercase tracking-wider">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-ink-500">{hint}</p>}
    </div>
  )
}

function Th({
  children,
  num,
  className,
}: {
  children: React.ReactNode
  num?: boolean
  className?: string
}) {
  return (
    <th
      className={cn(
        "px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-600 whitespace-nowrap",
        num ? "text-right" : "text-left",
        className,
      )}
    >
      {children}
    </th>
  )
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon?: React.ComponentType<{ className?: string }>
  label: string
  value: string
  hint?: string
  tone?: "info" | "success" | "warning"
}) {
  return (
    <div className="rounded-md border bg-surface p-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-ink-500">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {label}
      </div>
      <div
        data-num
        className={cn(
          "mt-1 text-base font-bold font-mono [font-variant-numeric:tabular-nums]",
          tone === "info" && "text-info-700",
          tone === "success" && "text-success-700",
          tone === "warning" && "text-warning-700",
        )}
      >
        {value}
      </div>
      {hint && <div className="text-[10px] text-ink-500 mt-0.5 truncate">{hint}</div>}
    </div>
  )
}

/** Tampilkan teks dgn match dr `term` di-highlight (case-insensitive). */
function Highlight({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>
  const lower = text.toLowerCase()
  const needle = term.toLowerCase()
  if (!lower.includes(needle)) return <>{text}</>
  const parts: React.ReactNode[] = []
  let cursor = 0
  let idx = lower.indexOf(needle, cursor)
  let key = 0
  while (idx !== -1) {
    if (idx > cursor) parts.push(text.slice(cursor, idx))
    parts.push(
      <mark
        key={key++}
        className="bg-warning-100 text-warning-900 rounded-sm px-0.5"
      >
        {text.slice(idx, idx + needle.length)}
      </mark>,
    )
    cursor = idx + needle.length
    idx = lower.indexOf(needle, cursor)
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return <>{parts}</>
}

