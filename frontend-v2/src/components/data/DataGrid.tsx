import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type Row,
} from "@tanstack/react-table"
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"
import { useState } from "react"
import type { SortingState } from "@tanstack/react-table"
import { getSortedRowModel } from "@tanstack/react-table"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

export interface DataGridProps<T> {
  data: T[]
  columns: ColumnDef<T, unknown>[]
  isLoading?: boolean
  onRowClick?: (row: T) => void
  /** Class utk seluruh container scroll. */
  className?: string
  /** Footer row (mis. TOTAL). */
  footer?: React.ReactNode
  /** Custom empty state, default tidak render apa-apa (parent handle). */
  emptyMessage?: string
}

export function DataGrid<T>({
  data,
  columns,
  isLoading,
  onRowClick,
  className,
  footer,
  emptyMessage = "Tidak ada data.",
}: DataGridProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([])

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  if (isLoading) {
    return (
      <div className={cn("rounded-md border bg-surface", className)}>
        <div className="space-y-2 p-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "rounded-md border bg-surface overflow-hidden",
        className,
      )}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-surface-muted">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b">
                {hg.headers.map((header, idx) => {
                  const meta = (header.column.columnDef.meta ?? {}) as {
                    align?: "left" | "right" | "center" | "num"
                    width?: string
                    sticky?: boolean
                  }
                  const isSorted = header.column.getIsSorted()
                  const canSort = header.column.getCanSort()
                  return (
                    <th
                      key={header.id}
                      style={meta.width ? { width: meta.width } : undefined}
                      className={cn(
                        "h-10 px-3 text-[11px] font-semibold uppercase tracking-wider text-ink-600 whitespace-nowrap",
                        meta.align === "right" && "text-right",
                        meta.align === "center" && "text-center",
                        meta.align === "num" && "text-right",
                        meta.align === "left" && "text-left",
                        !meta.align && (idx === 0 ? "text-left" : ""),
                        meta.sticky && "sticky left-0 bg-surface-muted z-10",
                      )}
                    >
                      {header.isPlaceholder ? null : (
                        <button
                          type="button"
                          onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                          className={cn(
                            "inline-flex items-center gap-1.5",
                            canSort && "hover:text-ink-900",
                            !canSort && "cursor-default",
                          )}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {canSort && (
                            <span className="text-ink-400">
                              {isSorted === "asc" ? (
                                <ArrowUp className="h-3 w-3" />
                              ) : isSorted === "desc" ? (
                                <ArrowDown className="h-3 w-3" />
                              ) : (
                                <ArrowUpDown className="h-3 w-3 opacity-40" />
                              )}
                            </span>
                          )}
                        </button>
                      )}
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-12 text-center text-sm text-ink-500"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row: Row<T>) => (
                <tr
                  key={row.id}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  className={cn(
                    "border-b last:border-b-0 transition-colors",
                    onRowClick && "cursor-pointer hover:bg-brand-50/50",
                  )}
                >
                  {row.getVisibleCells().map((cell, idx) => {
                    const meta = (cell.column.columnDef.meta ?? {}) as {
                      align?: "left" | "right" | "center" | "num"
                      sticky?: boolean
                    }
                    return (
                      <td
                        key={cell.id}
                        className={cn(
                          "px-3 py-2.5 align-top",
                          meta.align === "right" && "text-right",
                          meta.align === "center" && "text-center",
                          meta.align === "num" && "text-right font-mono [font-variant-numeric:tabular-nums]",
                          meta.align === "left" && "text-left",
                          !meta.align && (idx === 0 ? "text-left" : ""),
                          meta.sticky && "sticky left-0 bg-surface z-[1]",
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    )
                  })}
                </tr>
              ))
            )}
          </tbody>
          {footer && <tfoot className="bg-surface-muted border-t-2 border-ink-300">{footer}</tfoot>}
        </table>
      </div>
    </div>
  )
}
