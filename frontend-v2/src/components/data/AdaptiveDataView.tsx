import type { ColumnDef } from "@tanstack/react-table"
import { useBreakpoint } from "@/lib/breakpoint"
import { DataGrid } from "./DataGrid"
import { CardList } from "./CardList"

interface AdaptiveDataViewProps<T> {
  data: T[]
  isLoading?: boolean
  /** Definisi kolom utk DataGrid (desktop & tablet). */
  columns: ColumnDef<T, unknown>[]
  /** Renderer per item utk CardList (mobile). */
  renderCard: (item: T, index: number) => React.ReactNode
  /** Click handler utk row (desktop) / card (mobile). */
  onItemClick?: (item: T) => void
  emptyMessage?: string
  /** Override -- paksa render mode tertentu, mis. utk halaman yg
      table-only di semua breakpoint. */
  forceMode?: "grid" | "card"
  /** Footer row utk DataGrid (mis. TOTAL). */
  gridFooter?: React.ReactNode
  /** Expandable-row support utk DataGrid (desktop). */
  getRowId?: (row: T) => string | number
  expandedIds?: Set<string | number>
  renderExpandedRow?: (row: T) => React.ReactNode
}

export function AdaptiveDataView<T>({
  data,
  isLoading,
  columns,
  renderCard,
  onItemClick,
  emptyMessage,
  forceMode,
  gridFooter,
  getRowId,
  expandedIds,
  renderExpandedRow,
}: AdaptiveDataViewProps<T>) {
  const bp = useBreakpoint()
  const mode = forceMode ?? (bp === "mobile" ? "card" : "grid")

  if (mode === "card") {
    return (
      <CardList
        items={data}
        isLoading={isLoading}
        emptyMessage={emptyMessage}
        renderItem={(item, idx) => (
          <div onClick={onItemClick ? () => onItemClick(item) : undefined}>
            {renderCard(item, idx)}
          </div>
        )}
      />
    )
  }

  return (
    <DataGrid
      data={data}
      columns={columns}
      isLoading={isLoading}
      onRowClick={onItemClick}
      emptyMessage={emptyMessage}
      footer={gridFooter}
      getRowId={getRowId}
      expandedIds={expandedIds}
      renderExpandedRow={renderExpandedRow}
    />
  )
}
