import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"

interface PaginationProps {
  page: number
  size: number
  total: number
  onPageChange: (page: number) => void
  onSizeChange?: (size: number) => void
  pageSizeOptions?: number[]
}

export function Pagination({
  page,
  size,
  total,
  onPageChange,
  onSizeChange,
  pageSizeOptions = [25, 50, 100, 200],
}: PaginationProps) {
  const lastPage = Math.max(1, Math.ceil(total / size))
  const start = total === 0 ? 0 : (page - 1) * size + 1
  const end = Math.min(page * size, total)

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t bg-surface px-3 py-2.5">
      <div className="flex items-center gap-3 text-[13px] text-ink-600">
        <span data-num className="font-mono">
          {start.toLocaleString("id-ID")}–{end.toLocaleString("id-ID")} dari {total.toLocaleString("id-ID")}
        </span>
        {onSizeChange && (
          <div className="hidden md:flex items-center gap-1.5">
            <span className="text-ink-500">Per halaman</span>
            <select
              value={size}
              onChange={(e) => onSizeChange(Number(e.target.value))}
              className="h-7 rounded border border-border bg-surface px-1.5 text-[13px] focus:outline-none focus:border-brand-500"
            >
              {pageSizeOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <Button
          variant="secondary"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
          aria-label="Halaman sebelumnya"
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Sebelumnya</span>
        </Button>
        <span data-num className="px-2 text-[13px] text-ink-700 font-mono">
          {page} / {lastPage}
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={page >= lastPage}
          onClick={() => onPageChange(Math.min(lastPage, page + 1))}
          aria-label="Halaman berikutnya"
        >
          <span className="hidden sm:inline">Berikutnya</span>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
