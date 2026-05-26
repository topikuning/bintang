/**
 * Search + checkbox list yg di-embed langsung (tanpa popover wrapper).
 * Audit 2026-05-24: dipakai di dalam FilterButton supaya tdk perlu
 * dropdown bertumpuk (sebelumnya: tombol Proyek -> popover -> MultiProjectPicker
 * yg buka popover lagi = 2 klik).
 *
 * Beda dgn MultiCombobox: ini render flat (tdk ada trigger button, tdk
 * ada Popover/Sheet wrapper). Caller wrap dgn container sendiri.
 */
import * as React from "react"
import { Check, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ComboboxOption } from "@/components/forms/Combobox"

interface MultiSelectListProps<T extends string | number> {
  value: T[]
  onChange: (next: T[]) => void
  options: ComboboxOption[]
  isLoading?: boolean
  emptyMessage?: string
  searchPlaceholder?: string
  /** Tinggi max area list (px). Default 280. */
  maxHeight?: number
}

export function MultiSelectList<T extends string | number>({
  value,
  onChange,
  options,
  isLoading,
  emptyMessage = "Tidak ada hasil.",
  searchPlaceholder = "Cari…",
  maxHeight = 280,
}: MultiSelectListProps<T>) {
  const [query, setQuery] = React.useState("")
  const selectedSet = new Set<T>(value)
  const filtered = React.useMemo(() => {
    if (!query.trim()) return options
    const q = query.toLowerCase()
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) || o.hint?.toLowerCase().includes(q),
    )
  }, [options, query])

  const toggle = (v: T) => {
    const next = new Set(selectedSet)
    if (next.has(v)) next.delete(v)
    else next.add(v)
    onChange(Array.from(next))
  }

  return (
    <div className="flex flex-col">
      <div className="relative mb-2">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-400" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder}
          className="h-8 w-full rounded border border-border-strong bg-surface pl-7 pr-2 text-[13px] focus:outline-none focus:border-brand-500"
          autoFocus
        />
      </div>
      <ul
        className="flex flex-col overflow-y-auto"
        style={{ maxHeight }}
      >
        {isLoading && (
          <li className="px-2 py-4 text-center text-[12px] text-ink-500">
            Memuat…
          </li>
        )}
        {!isLoading && filtered.length === 0 && (
          <li className="px-2 py-4 text-center text-[12px] text-ink-500">
            {emptyMessage}
          </li>
        )}
        {filtered.map((opt) => {
          const isSelected = selectedSet.has(opt.value as T)
          return (
            <li key={opt.value}>
              <button
                type="button"
                onClick={() => toggle(opt.value as T)}
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors",
                  isSelected
                    ? "bg-brand-50 text-brand-900"
                    : "text-ink-800 hover:bg-ink-100",
                )}
              >
                <div
                  className={cn(
                    "flex h-4 w-4 items-center justify-center rounded border shrink-0",
                    isSelected
                      ? "border-brand-600 bg-brand-600 text-white"
                      : "border-border-strong bg-surface",
                  )}
                >
                  {isSelected && <Check className="h-3 w-3" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="truncate text-[13px] font-medium">
                    {opt.label}
                  </div>
                  {opt.hint && (
                    <div className="truncate text-[10px] text-ink-500">
                      {opt.hint}
                    </div>
                  )}
                </div>
              </button>
            </li>
          )
        })}
      </ul>
      {selectedSet.size > 0 && (
        <div className="mt-2 flex items-center justify-between border-t pt-2 text-[11px] text-ink-500">
          <span>{selectedSet.size} terpilih</span>
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-brand-700 hover:underline"
          >
            Bersihkan
          </button>
        </div>
      )}
    </div>
  )
}
