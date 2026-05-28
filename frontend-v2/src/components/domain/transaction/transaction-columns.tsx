import type { ColumnDef } from "@tanstack/react-table"
import type { Project, Transaction } from "@/types/api"
import type { Category } from "@/hooks/useCategories"
import { fmtCompact, fmtDate, fmtIDR } from "@/lib/format"
import { AmountDisplay } from "@/components/domain/shared/AmountDisplay"
import { StatusBadge } from "@/components/domain/shared/StatusBadge"

interface BuildOpts {
  projectMap: Map<number, Project>
  categoryMap: Map<number, Category>
  /** Sembunyikan kolom proyek (mis. di halaman per-proyek). */
  hideProject?: boolean
}

/** Buat column defs utk DataGrid Transaksi (desktop & tablet). */
export function buildTransactionColumns({
  projectMap,
  categoryMap,
  hideProject,
}: BuildOpts): ColumnDef<Transaction, unknown>[] {
  const cols: ColumnDef<Transaction, unknown>[] = [
    {
      id: "tx_date",
      header: "Tanggal",
      accessorKey: "tx_date",
      cell: ({ getValue }) => fmtDate(getValue<string>()),
      meta: { align: "left", width: "100px", sticky: true },
      enableSorting: true,
    },
  ]

  if (!hideProject) {
    cols.push({
      id: "project",
      header: "Proyek",
      cell: ({ row }) => {
        const p = projectMap.get(row.original.project_id)
        return (
          <div className="flex flex-col leading-tight max-w-[220px]">
            <span className="truncate text-sm">{p?.name ?? "-"}</span>
            {p?.code && <span className="text-[11px] text-ink-500">{p.code}</span>}
          </div>
        )
      },
      meta: { align: "left", width: "200px" },
    })
  }

  cols.push(
    {
      id: "type",
      header: "Arah",
      cell: ({ row }) => (
        <span className="text-[11px] font-semibold uppercase tracking-wider">
          {row.original.type === "IN" ? (
            <span className="text-success-700">Masuk</span>
          ) : (
            <span className="text-danger-700">Keluar</span>
          )}
        </span>
      ),
      meta: { align: "center", width: "70px" },
    },
    {
      id: "category",
      header: "Kategori",
      cell: ({ row }) => {
        const c = row.original.category_id ? categoryMap.get(row.original.category_id) : null
        return <span className="text-sm">{c?.name ?? "—"}</span>
      },
      meta: { align: "left", width: "140px" },
    },
    {
      id: "party_name",
      header: "Pihak",
      accessorKey: "party_name",
      cell: ({ getValue }) => (
        <span className="text-sm">{getValue<string>() || "—"}</span>
      ),
      meta: { align: "left" },
    },
    {
      id: "description",
      header: "Deskripsi",
      accessorKey: "description",
      cell: ({ getValue }) => (
        <span className="text-sm text-ink-600 line-clamp-2">{getValue<string>() || "—"}</span>
      ),
      meta: { align: "left" },
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => <StatusBadge domain="transaction" status={row.original.status} />,
      meta: { align: "center", width: "120px" },
    },
    {
      id: "amount",
      header: "Nominal",
      accessorKey: "amount",
      cell: ({ row }) => {
        const t = row.original
        // Audit 2026-05-24: badge alokasi (Belum/Sisa) utk TX OUT.
        // Hanya tampil kalau ada outstanding (remaining > 0). Kalau full
        // allocated atau IN -> tdk tampil (clean).
        // Audit 2026-05-27: skip DIRECT_EXPENSE -- by design tdk dialokasi
        // ke invoice (beban tercatat in-place via items), jadi badge
        // "Belum dialokasi" menyesatkan.
        const remaining = Number(t.remaining_amount ?? 0)
        const allocated = Number(t.allocated_amount ?? 0)
        const showBadge =
          t.type === "OUT" && t.kind !== "DIRECT_EXPENSE" && remaining > 0
        const isFullUnalloc = showBadge && allocated === 0
        return (
          <div className="flex flex-col items-end gap-0.5">
            <AmountDisplay value={t.amount} type={t.type} colored />
            {showBadge && (
              <span
                className={
                  "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
                  (isFullUnalloc
                    ? "bg-danger-100 text-danger-800"
                    : "bg-warning-100 text-warning-800")
                }
                title={
                  isFullUnalloc
                    ? "Belum dialokasi sama sekali"
                    : `Sudah dialokasi ${fmtIDR(allocated)} · sisa ${fmtIDR(remaining)}`
                }
              >
                {isFullUnalloc
                  ? "Belum dialokasi"
                  : `Sisa ${fmtCompact(remaining)}`}
              </span>
            )}
          </div>
        )
      },
      meta: { align: "num", width: "170px" },
      enableSorting: true,
    },
  )

  return cols
}
