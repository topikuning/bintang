import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

interface CardListProps<T> {
  items: T[]
  isLoading?: boolean
  renderItem: (item: T, index: number) => React.ReactNode
  /** Custom key extractor (default: pakai `id` field). */
  keyExtractor?: (item: T, index: number) => string | number
  emptyMessage?: string
  /** Override -- pakai rich EmptyState component. Menang dari emptyMessage. */
  emptyState?: React.ReactNode
  className?: string
}

export function CardList<T>({
  items,
  isLoading,
  renderItem,
  keyExtractor,
  emptyMessage = "Tidak ada data.",
  emptyState,
  className,
}: CardListProps<T>) {
  if (isLoading) {
    return (
      <div className={cn("flex flex-col gap-2", className)}>
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    )
  }

  if (items.length === 0) {
    if (emptyState) {
      return <div className={className}>{emptyState}</div>
    }
    return (
      <div
        className={cn(
          "rounded-md border border-dashed bg-surface p-8 text-center text-sm text-ink-500",
          className,
        )}
      >
        {emptyMessage}
      </div>
    )
  }

  const getKey = (item: T, idx: number): string | number => {
    if (keyExtractor) return keyExtractor(item, idx)
    if (typeof item === "object" && item != null && "id" in item) {
      return (item as { id: string | number }).id
    }
    return idx
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {items.map((item, idx) => (
        <div key={getKey(item, idx)}>{renderItem(item, idx)}</div>
      ))}
    </div>
  )
}
