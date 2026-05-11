import * as React from "react"
import { Check, ChevronDown, Search, X } from "lucide-react"
import * as Popover from "@radix-ui/react-popover"
import { useBreakpoint } from "@/lib/breakpoint"
import { cn } from "@/lib/utils"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import type { ComboboxOption } from "./Combobox"

interface MultiComboboxProps<T extends string | number> {
  value: T[]
  onChange: (next: T[]) => void
  options: ComboboxOption[]
  placeholder?: string
  emptyMessage?: string
  isLoading?: boolean
  disabled?: boolean
  sheetTitle?: string
  className?: string
  /** Maks N label tampak di trigger sebelum "+N lainnya". Default 2. */
  maxChipsInTrigger?: number
}

/**
 * Multi-select picker dgn search + checkbox list. Variant dari Combobox
 * single-select. Pakai untuk filter yg perlu pilih BEBERAPA nilai
 * sekaligus (mis. lokasi/dinas/pendana di hub proyek + dashboard).
 *
 * Desktop: Radix Popover.
 * Mobile: bottom Sheet.
 */
export function MultiCombobox<T extends string | number>({
  value,
  onChange,
  options,
  placeholder = "Pilih…",
  emptyMessage = "Tidak ada hasil.",
  isLoading,
  disabled,
  sheetTitle = "Pilih opsi",
  className,
  maxChipsInTrigger = 2,
}: MultiComboboxProps<T>) {
  const bp = useBreakpoint()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")

  const selectedSet = new Set<T>(value)
  const selectedOpts = options.filter((o) => selectedSet.has(o.value as T))

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

  const clearAll = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange([])
  }

  const triggerLabel = (() => {
    if (isLoading) return "Memuat…"
    if (selectedOpts.length === 0) return placeholder
    if (selectedOpts.length <= maxChipsInTrigger) {
      return selectedOpts.map((o) => o.label).join(", ")
    }
    const head = selectedOpts.slice(0, maxChipsInTrigger).map((o) => o.label).join(", ")
    return `${head} +${selectedOpts.length - maxChipsInTrigger} lainnya`
  })()

  const trigger = (
    <button
      type="button"
      disabled={disabled}
      onClick={() => !disabled && setOpen(true)}
      className={cn(
        "flex h-10 w-full items-center gap-2 rounded border border-border-strong bg-surface px-3 text-sm text-left",
        "hover:bg-surface-muted",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 focus-visible:border-brand-500",
        className,
      )}
    >
      <span
        className={cn(
          "flex-1 truncate",
          selectedOpts.length === 0 && "text-ink-400",
        )}
      >
        {triggerLabel}
      </span>
      {selectedOpts.length > 0 && !disabled && (
        <X
          role="button"
          tabIndex={-1}
          aria-label="Bersihkan pilihan"
          className="h-4 w-4 text-ink-400 hover:text-ink-700"
          onClick={clearAll}
        />
      )}
      <ChevronDown className="h-4 w-4 text-ink-400 shrink-0" />
    </button>
  )

  const list = (
    <ul className="max-h-[400px] overflow-y-auto">
      {filtered.length === 0 ? (
        <li className="px-3 py-6 text-center text-sm text-ink-500">{emptyMessage}</li>
      ) : (
        filtered.map((opt) => {
          const isSelected = selectedSet.has(opt.value as T)
          return (
            <li key={opt.value}>
              <button
                type="button"
                onClick={() => toggle(opt.value as T)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors",
                  isSelected ? "bg-brand-50 text-brand-700" : "hover:bg-ink-100",
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
                  <div className="truncate text-sm font-medium">{opt.label}</div>
                  {opt.hint && (
                    <div className="truncate text-[11px] text-ink-500">{opt.hint}</div>
                  )}
                </div>
              </button>
            </li>
          )
        })
      )}
    </ul>
  )

  // Footer-shared antara desktop & mobile (Pilih semua / Bersihkan / Tutup).
  const footer = (
    <div className="flex items-center justify-between gap-2 border-t bg-surface px-3 py-2 text-[12px]">
      <button
        type="button"
        onClick={() => {
          if (selectedOpts.length === filtered.length) {
            onChange([])
          } else {
            onChange(filtered.map((o) => o.value as T))
          }
        }}
        className="text-brand-600 hover:underline"
      >
        {selectedOpts.length === filtered.length && filtered.length > 0
          ? "Bersihkan semua"
          : "Pilih semua"}
      </button>
      <span className="text-ink-500">{selectedOpts.length} terpilih</span>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-ink-700 hover:underline"
      >
        Tutup
      </button>
    </div>
  )

  if (bp === "mobile") {
    return (
      <>
        {trigger}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" className="max-h-[85vh] flex flex-col">
            <SheetHeader>
              <SheetTitle>{sheetTitle}</SheetTitle>
            </SheetHeader>
            <div className="px-5 pt-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Cari…"
                  className="h-10 w-full rounded border border-border-strong bg-surface pl-8 pr-3 text-sm focus:outline-none focus:border-brand-500"
                  autoFocus
                />
              </div>
            </div>
            <div className="mt-3 flex-1 overflow-hidden">{list}</div>
            {footer}
          </SheetContent>
        </Sheet>
      </>
    )
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-50 w-[--radix-popover-trigger-width] min-w-[260px] rounded-md border bg-surface shadow-md outline-none"
        >
          <div className="border-b p-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cari…"
                className="h-9 w-full rounded border border-border-strong bg-surface pl-8 pr-3 text-sm focus:outline-none focus:border-brand-500"
                autoFocus
              />
            </div>
          </div>
          {list}
          {footer}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
