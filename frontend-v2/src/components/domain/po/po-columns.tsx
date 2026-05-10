import type { ColumnDef } from "@tanstack/react-table"
import { ShoppingCart } from "lucide-react"
import type { Project, PurchaseOrder } from "@/types/api"
import { fmtDate, fmtIDR } from "@/lib/format"
import { StatusBadge } from "@/components/domain/shared/StatusBadge"

interface BuildOpts {
  projectMap: Map<number, Project>
  hideProject?: boolean
}

export function buildPOColumns({ projectMap, hideProject }: BuildOpts): ColumnDef<PurchaseOrder, unknown>[] {
  const cols: ColumnDef<PurchaseOrder, unknown>[] = [
    {
      id: "number",
      header: "No. PO",
      accessorKey: "number",
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5">
          <ShoppingCart className="h-3.5 w-3.5 text-info-600" />
          <span className="font-mono text-[13px]">{row.original.number}</span>
        </div>
      ),
      meta: { align: "left", width: "200px", sticky: true },
    },
    {
      id: "po_date",
      header: "Tanggal",
      accessorKey: "po_date",
      cell: ({ getValue }) => fmtDate(getValue<string>()),
      meta: { align: "left", width: "100px" },
      enableSorting: true,
    },
    {
      id: "needed_date",
      header: "Butuh",
      accessorKey: "needed_date",
      cell: ({ getValue }) => {
        const v = getValue<string | null | undefined>()
        return v ? fmtDate(v) : <span className="text-ink-400">—</span>
      },
      meta: { align: "left", width: "100px" },
    },
  ]

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
      id: "vendor",
      header: "Vendor",
      accessorKey: "vendor_name",
      cell: ({ getValue }) => <span className="text-sm">{getValue<string>() || "—"}</span>,
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
      id: "status",
      header: "Status",
      cell: ({ row }) => <StatusBadge domain="po" status={row.original.status} />,
      meta: { align: "center", width: "120px" },
    },
  )

  return cols
}
