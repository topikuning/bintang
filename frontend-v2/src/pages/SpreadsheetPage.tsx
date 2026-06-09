import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import {
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  Search,
  X,
} from "lucide-react"
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table"
import { useProjects } from "@/hooks/useProjects"
import { useTransactions } from "@/hooks/useTransactions"
import { useCategories } from "@/hooks/useCategories"
import { usePageTitle } from "@/hooks/usePageTitle"
import { useBreakpoint } from "@/lib/breakpoint"
import { fmtDate, fmtIDR } from "@/lib/format"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { Transaction } from "@/types/api"

/**
 * Tampilan Spreadsheet (audit 2026-06-02).
 *
 * Full-page modal-like view: tabs di bawah utk tiap proyek (mirip
 * Excel sheets), grid TanStack Table read-only di tengah, header
 * close-button. Desktop only -- mobile/tablet redirect ke pesan
 * fallback (UX excel-style tdk muat di layar kecil).
 *
 * Read-only MVP: edit tetap via halaman Transaksi existing. Tdk
 * ganggu eksisting (route baru `/spreadsheet`).
 */
export function SpreadsheetPage() {
  usePageTitle("Tampilan Spreadsheet")
  const navigate = useNavigate()
  const bp = useBreakpoint()

  const projectsQuery = useProjects({ status: "AKTIF", size: 200 })
  const categoriesQuery = useCategories()
  const projects = useMemo(
    () => projectsQuery.data?.items ?? [],
    [projectsQuery.data],
  )

  const [activeProjectId, setActiveProjectId] = useState<number | null>(null)
  const [searchProj, setSearchProj] = useState("")

  // Auto-pilih proyek pertama saat data masuk pertama kali.
  useEffect(() => {
    if (activeProjectId == null && projects.length > 0) {
      setActiveProjectId(projects[0]!.id)
    }
  }, [projects, activeProjectId])

  // ESC utk tutup.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") navigate(-1)
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [navigate])

  const filteredProjects = useMemo(() => {
    const q = searchProj.trim().toLowerCase()
    if (!q) return projects
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q),
    )
  }, [projects, searchProj])

  if (bp === "mobile") {
    return (
      <div className="fixed inset-0 z-50 bg-surface flex flex-col items-center justify-center p-6 text-center">
        <FileSpreadsheet className="h-12 w-12 text-ink-300 mb-3" />
        <h1 className="text-lg font-semibold text-ink-900">
          Tampilan Spreadsheet
        </h1>
        <p className="text-[13px] text-ink-500 mt-2 max-w-sm">
          Tampilan ini butuh layar yg lebih lebar. Buka di tablet (landscape)
          atau desktop untuk pengalaman optimal.
        </p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => navigate(-1)}
        >
          Tutup
        </Button>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-surface flex flex-col">
      {/* Toolbar atas */}
      <div className="flex items-center gap-3 border-b bg-surface px-4 py-2.5 shrink-0">
        <FileSpreadsheet className="h-5 w-5 text-brand-600 shrink-0" />
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold text-ink-900">
            Tampilan Spreadsheet
          </h1>
          <p className="text-[11px] text-ink-500">
            Read-only · {projects.length} proyek aktif · Edit tetap via{" "}
            <Link to="/transactions" className="text-brand-600 hover:underline">
              halaman Transaksi
            </Link>
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="rounded-md p-2 text-ink-500 hover:bg-ink-100 hover:text-ink-900"
          aria-label="Tutup (ESC)"
          title="Tutup (ESC)"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Grid area */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {projectsQuery.isLoading ? (
          <div className="p-4 space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : projects.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[13px] text-ink-500">
            Belum ada proyek aktif.
          </div>
        ) : activeProjectId == null ? null : (
          <ProjectSheet
            key={activeProjectId}
            projectId={activeProjectId}
            categoriesMap={categoriesMapFromHook(categoriesQuery.data)}
          />
        )}
      </div>

      {/* Tab bar bawah (Excel-style) */}
      <div className="border-t bg-surface-muted shrink-0">
        <div className="flex items-stretch overflow-hidden">
          {/* Search proyek */}
          <div className="relative w-56 shrink-0 border-r bg-surface px-2 py-1.5">
            <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-400" />
            <Input
              value={searchProj}
              onChange={(e) => setSearchProj(e.target.value)}
              placeholder="Cari proyek…"
              className="h-7 pl-7 text-[12px]"
            />
          </div>
          {/* Tabs scrollable */}
          <ScrollableTabs
            projects={filteredProjects}
            activeId={activeProjectId}
            onSelect={setActiveProjectId}
          />
        </div>
      </div>
    </div>
  )
}

// ============================================================
// ProjectSheet -- 1 sheet utk 1 proyek
// ============================================================

function ProjectSheet({
  projectId,
  categoriesMap,
}: {
  projectId: number
  categoriesMap: Map<number, string>
}) {
  const txQuery = useTransactions({
    project_id: [projectId],
    size: 500,
    page: 1,
  })

  const items = useMemo(() => txQuery.data?.items ?? [], [txQuery.data])

  const columns = useMemo<ColumnDef<Transaction, unknown>[]>(
    () => [
      {
        id: "row_no",
        header: "#",
        cell: ({ row }) => (
          <span className="text-ink-400">{row.index + 1}</span>
        ),
        size: 48,
      },
      {
        id: "tx_date",
        header: "Tanggal",
        accessorKey: "tx_date",
        cell: ({ getValue }) => fmtDate(getValue<string>()),
        size: 100,
      },
      {
        id: "id",
        header: "ID",
        cell: ({ row }) => (
          <span className="font-mono text-ink-500">#{row.original.id}</span>
        ),
        size: 64,
      },
      {
        id: "type",
        header: "Arah",
        cell: ({ row }) =>
          row.original.type === "IN" ? (
            <span className="text-success-700 font-medium">Masuk</span>
          ) : (
            <span className="text-danger-700 font-medium">Keluar</span>
          ),
        size: 72,
      },
      {
        id: "party",
        header: "Pihak",
        accessorKey: "party_name",
        cell: ({ getValue }) => (
          <span className="truncate">{getValue<string>() || "—"}</span>
        ),
        size: 200,
      },
      {
        id: "category",
        header: "Kategori",
        cell: ({ row }) => {
          const cid = row.original.category_id
          return (
            <span className="text-ink-700">
              {cid ? categoriesMap.get(cid) ?? "—" : "—"}
            </span>
          )
        },
        size: 140,
      },
      {
        id: "description",
        header: "Deskripsi",
        accessorKey: "description",
        cell: ({ getValue }) => (
          <span className="text-ink-600 truncate">
            {getValue<string>() || "—"}
          </span>
        ),
        size: 280,
      },
      {
        id: "in",
        header: "Masuk (Rp)",
        cell: ({ row }) =>
          row.original.type === "IN" ? (
            <span className="font-mono text-success-700 tabular-nums">
              {fmtIDR(Number(row.original.amount))}
            </span>
          ) : (
            <span className="text-ink-300">—</span>
          ),
        size: 140,
      },
      {
        id: "out",
        header: "Keluar (Rp)",
        cell: ({ row }) =>
          row.original.type === "OUT" ? (
            <span className="font-mono text-danger-700 tabular-nums">
              {fmtIDR(Number(row.original.amount))}
            </span>
          ) : (
            <span className="text-ink-300">—</span>
          ),
        size: 140,
      },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        cell: ({ getValue }) => (
          <span className="text-[11px] uppercase tracking-wider text-ink-600">
            {getValue<string>()}
          </span>
        ),
        size: 96,
      },
      {
        id: "reference_no",
        header: "Referensi",
        accessorKey: "reference_no",
        cell: ({ getValue }) => (
          <span className="font-mono text-ink-500 text-[11px]">
            {getValue<string>() || "—"}
          </span>
        ),
        size: 140,
      },
    ],
    [categoriesMap],
  )

  const table = useReactTable({
    data: items,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  // Total IN/OUT untuk footer.
  const totals = useMemo(() => {
    let in_ = 0
    let out_ = 0
    for (const t of items) {
      if (t.type === "IN") in_ += Number(t.amount)
      else out_ += Number(t.amount)
    }
    return { in: in_, out: out_, balance: in_ - out_ }
  }, [items])

  if (txQuery.isLoading) {
    return (
      <div className="p-4 space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-ink-500">
        Belum ada transaksi di proyek ini.
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-collapse text-[12.5px]">
        <thead className="sticky top-0 z-10 bg-surface-muted shadow-[0_1px_0_0] shadow-border-strong">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th
                  key={h.id}
                  style={{ width: h.column.columnDef.size }}
                  className="border-r border-border-strong/60 px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-600"
                >
                  {flexRender(h.column.columnDef.header, h.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              className="border-b hover:bg-brand-50/40"
            >
              {row.getVisibleCells().map((cell) => (
                <td
                  key={cell.id}
                  className="border-r border-border-strong/30 px-2 py-1.5 align-middle"
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot className="sticky bottom-0 bg-surface-muted shadow-[0_-1px_0_0] shadow-border-strong">
          <tr className="font-semibold">
            <td colSpan={7} className="px-2 py-2 text-right text-ink-700">
              TOTAL ({items.length} transaksi)
            </td>
            <td className="px-2 py-2 font-mono text-success-700 tabular-nums">
              {fmtIDR(totals.in)}
            </td>
            <td className="px-2 py-2 font-mono text-danger-700 tabular-nums">
              {fmtIDR(totals.out)}
            </td>
            <td
              colSpan={2}
              className={cn(
                "px-2 py-2 font-mono tabular-nums",
                totals.balance < 0 ? "text-danger-700" : "text-ink-900",
              )}
            >
              Saldo: {fmtIDR(totals.balance)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// ============================================================
// Tab bar -- horizontal scrollable, Excel-style
// ============================================================

function ScrollableTabs({
  projects,
  activeId,
  onSelect,
}: {
  projects: Array<{ id: number; code: string; name: string }>
  activeId: number | null
  onSelect: (id: number) => void
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  // Auto-scroll to active tab.
  useEffect(() => {
    const container = scrollRef.current
    if (!container || activeId == null) return
    const target = container.querySelector<HTMLElement>(
      `[data-tab-id="${activeId}"]`,
    )
    target?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" })
  }, [activeId])

  const scrollBy = (dx: number) => {
    scrollRef.current?.scrollBy({ left: dx, behavior: "smooth" })
  }

  return (
    <div className="flex items-stretch flex-1 min-w-0">
      <button
        type="button"
        onClick={() => scrollBy(-200)}
        className="px-1 text-ink-400 hover:text-ink-700 hover:bg-ink-100"
        aria-label="Scroll left"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <div
        ref={scrollRef}
        className="flex items-stretch overflow-x-auto scrollbar-thin"
      >
        {projects.map((p) => (
          <button
            key={p.id}
            data-tab-id={p.id}
            type="button"
            onClick={() => onSelect(p.id)}
            className={cn(
              "shrink-0 border-r border-border-strong/60 px-3 py-1.5 text-[12px] transition-colors",
              p.id === activeId
                ? "bg-surface font-semibold text-brand-700 border-b-2 border-b-brand-500 -mb-px"
                : "text-ink-600 hover:bg-surface",
            )}
            title={`${p.name} (${p.code})`}
          >
            <div className="flex flex-col leading-tight items-start">
              <span className="font-mono text-[10px] text-ink-400 uppercase tracking-wider">
                {p.code}
              </span>
              <span className="max-w-[120px] truncate">{p.name}</span>
            </div>
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => scrollBy(200)}
        className="px-1 text-ink-400 hover:text-ink-700 hover:bg-ink-100"
        aria-label="Scroll right"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  )
}

// Categories hook returns Page<Category>. Convert ke Map id->name.
function categoriesMapFromHook(
  data: { items: Array<{ id: number; name: string }> } | undefined,
): Map<number, string> {
  const m = new Map<number, string>()
  for (const c of data?.items ?? []) {
    m.set(c.id, c.name)
  }
  return m
}
