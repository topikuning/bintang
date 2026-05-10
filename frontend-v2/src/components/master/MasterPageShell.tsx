import { Plus } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"
import { Button } from "@/components/ui/button"
import { AdaptiveDataView } from "@/components/data/AdaptiveDataView"
import { ErrorState } from "@/components/data/ErrorState"
import { apiErrorMessage } from "@/lib/api"
import { useBreakpoint } from "@/lib/breakpoint"

interface MasterPageShellProps<T> {
  title: string
  description: string
  /** Loading + error state. */
  isLoading?: boolean
  error?: unknown
  onRetry?: () => void
  /** Data list. */
  items: T[]
  /** Definisi kolom desktop. */
  columns: ColumnDef<T, unknown>[]
  /** Renderer card mobile. */
  renderCard: (item: T) => React.ReactNode
  /** Click row -> open detail/edit. */
  onItemClick?: (item: T) => void
  /** Handler tombol Tambah. */
  onAdd?: () => void
  emptyMessage?: string
}

/**
 * Shell halaman master data: header + tombol Tambah (desktop & FAB mobile)
 * + AdaptiveDataView. Konsisten visual di semua master page (Categories,
 * Vendors, Companies, Projects).
 */
export function MasterPageShell<T>({
  title,
  description,
  isLoading,
  error,
  onRetry,
  items,
  columns,
  renderCard,
  onItemClick,
  onAdd,
  emptyMessage = "Belum ada data.",
}: MasterPageShellProps<T>) {
  const bp = useBreakpoint()

  if (error) {
    return (
      <div className="p-4 sm:p-6">
        <ErrorState description={apiErrorMessage(error)} onRetry={onRetry} />
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-col gap-4 p-3 sm:p-5 lg:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-ink-900 sm:text-2xl">{title}</h1>
            <p className="text-[13px] text-ink-500 mt-0.5">{description}</p>
          </div>
          {onAdd && (
            <Button
              size={bp === "mobile" ? "md" : "lg"}
              className="hidden sm:inline-flex"
              onClick={onAdd}
            >
              <Plus className="h-4 w-4" />
              Tambah
            </Button>
          )}
        </div>

        <div className="rounded-md bg-surface md:bg-transparent">
          <AdaptiveDataView
            data={items}
            isLoading={isLoading}
            columns={columns}
            onItemClick={onItemClick}
            renderCard={(item) => renderCard(item)}
            emptyMessage={emptyMessage}
          />
        </div>
      </div>

      {onAdd && (
        <Button
          size="icon"
          className="sm:hidden fixed bottom-[calc(64px+env(safe-area-inset-bottom)+12px)] right-4 z-30 h-14 w-14 rounded-full shadow-lg"
          aria-label="Tambah"
          onClick={onAdd}
        >
          <Plus className="h-6 w-6" />
        </Button>
      )}
    </>
  )
}
