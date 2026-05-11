import type { ColumnDef } from "@tanstack/react-table"
import { ChevronDown, ChevronRight, FileMinus, FilePlus } from "lucide-react"
import type { Invoice, Project } from "@/types/api"
import { fmtDate, fmtIDR } from "@/lib/format"
import { StatusBadge } from "@/components/domain/shared/StatusBadge"

interface BuildOpts {
  projectMap: Map<number, Project>
  hideProject?: boolean
  /** Kalau diisi, tampilkan kolom chevron expand di paling kiri. */
  expand?: {
    isExpanded: (id: number) => boolean
    toggle: (id: number) => void
  }
}

export function buildInvoiceColumns({
  projectMap,
  hideProject,
  expand,
}: BuildOpts): ColumnDef<Invoice, unknown>[] {
  const cols: ColumnDef<Invoice, unknown>[] = []

  if (expand) {
    cols.push({
      id: "expand",
      header: "",
      cell: ({ row }) => {
        const open = expand.isExpanded(row.original.id)
        return (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              expand.toggle(row.original.id)
            }}
            className="flex h-7 w-7 items-center justify-center rounded text-ink-500 hover:bg-ink-100 hover:text-ink-900"
            aria-label={open ? "Tutup detail item" : "Lihat detail item"}
          >
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        )
      },
      meta: { align: "center", width: "44px" },
    })
  }

  cols.push(
    {
      id: "number",
      header: "No. Invoice",
      accessorKey: "number",
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5">
          {row.original.type === "IN" ? (
            <FileMinus className="h-3.5 w-3.5 text-warning-600" />
          ) : (
            <FilePlus className="h-3.5 w-3.5 text-info-600" />
          )}
          <span className="font-mono text-[13px]">{row.original.number}</span>
        </div>
      ),
      meta: { align: "left", width: "180px", sticky: true },
    },
    {
      id: "invoice_date",
      header: "Tanggal",
      accessorKey: "invoice_date",
      cell: ({ getValue }) => fmtDate(getValue<string>()),
      meta: { align: "left", width: "100px" },
      enableSorting: true,
    },
    {
      id: "due_date",
      header: "Jatuh Tempo",
      accessorKey: "due_date",
      cell: ({ getValue }) => {
        const v = getValue<string | null>()
        return v ? fmtDate(v) : <span className="text-ink-400">—</span>
      },
      meta: { align: "left", width: "110px" },
      enableSorting: true,
    },
  )

  if (!hideProject) {
    cols.push({
      id: "project",
      header: "Proyek",
      cell: ({ row }) => {
        const p = projectMap.get(row.original.project_id)
        return (
          <div className="flex flex-col leading-tight max-w-[200px]">
            <span className="truncate text-sm">{p?.name ?? "-"}</span>
            {p?.code && <span className="text-[11px] text-ink-500">{p.code}</span>}
          </div>
        )
      },
      meta: { align: "left", width: "180px" },
    })
  }

  cols.push(
    {
      id: "party_name",
      header: "Vendor / Klien",
      accessorKey: "party_name",
      cell: ({ getValue }) => (
        <span className="text-sm">{getValue<string>() || "—"}</span>
      ),
      meta: { align: "left" },
    },
    {
      id: "total",
      header: "Total",
      accessorKey: "total",
      cell: ({ row }) => (
        <span
          data-num
          className="font-mono font-semibold text-ink-900 [font-variant-numeric:tabular-nums]"
        >
          {fmtIDR(row.original.total)}
        </span>
      ),
      meta: { align: "num", width: "150px" },
      enableSorting: true,
    },
    {
      id: "paid",
      header: "Terbayar",
      cell: ({ row }) => {
        const paid = Number(row.original.paid_amount ?? 0)
        if (paid <= 0)
          return <span className="text-ink-400 text-sm">—</span>
        return (
          <span
            data-num
            className="font-mono text-success-700 [font-variant-numeric:tabular-nums]"
          >
            {fmtIDR(paid)}
          </span>
        )
      },
      meta: { align: "num", width: "140px" },
    },
    {
      id: "outstanding",
      header: "Sisa",
      cell: ({ row }) => {
        const remaining = Number(
          row.original.outstanding_amount ?? row.original.remaining ?? 0,
        )
        if (remaining <= 0)
          return <span className="text-success-700 text-sm font-semibold">Lunas</span>
        return (
          <span
            data-num
            className="font-mono font-semibold text-warning-700 [font-variant-numeric:tabular-nums]"
          >
            {fmtIDR(remaining)}
          </span>
        )
      },
      meta: { align: "num", width: "140px" },
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => <StatusBadge domain="invoice" status={row.original.status} />,
      meta: { align: "center", width: "120px" },
    },
  )

  return cols
}
