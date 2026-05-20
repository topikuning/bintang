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
 *
 * Keyboard support:
 *  - Saat dropdown open, focus auto ke search input (override Radix
 *    default supaya konsisten)
 *  - ArrowDown/ArrowUp: navigasi highlight di list filtered
 *  - Enter: toggle item yg ter-highlight
 *  - Esc: tutup (handled native by Radix)
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
  const [activeIdx, setActiveIdx] = React.useState(0)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const listRef = React.useRef<HTMLUListElement>(null)

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

  // Reset state saat tutup. Saat buka, focus & activeIdx di-handle
  // di handler khusus di bawah (onOpenAutoFocus / Sheet open).
  React.useEffect(() => {
    if (!open) {
      setQuery("")
      setActiveIdx(0)
    }
  }, [open])

  // Clamp activeIdx saat filter berubah (mis. user ketik & list shrink).
  React.useEffect(() => {
    if (activeIdx >= filtered.length) {
      setActiveIdx(Math.max(0, filtered.length - 1))
    }
  }, [filtered.length, activeIdx])

  // Scroll item aktif ke viewport saat ArrowUp/Down.
  React.useEffect(() => {
    if (!open || filtered.length === 0) return
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-idx="${activeIdx}"]`,
    )
    el?.scrollIntoView({ block: "nearest" })
  }, [activeIdx, open, filtered.length])

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

  // Keyboard handler di search input -- handle ↑/↓/Enter.
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (filtered.length === 0) return
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActiveIdx((i) => (i + 1) % filtered.length)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActiveIdx((i) => (i - 1 + filtered.length) % filtered.length)
    } else if (e.key === "Enter") {
      e.preventDefault()
      const opt = filtered[activeIdx]
      if (opt) toggle(opt.value as T)
    }
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
    <ul ref={listRef} className="max-h-[400px] overflow-y-auto">
      {filtered.length === 0 ? (
        <li className="px-3 py-6 text-center text-sm text-ink-500">{emptyMessage}</li>
      ) : (
        filtered.map((opt, idx) => {
          const isSelected = selectedSet.has(opt.value as T)
          const isActive = idx === activeIdx
          return (
            <li key={opt.value} data-idx={idx}>
              <button
                type="button"
                onClick={() => toggle(opt.value as T)}
                onMouseEnter={() => setActiveIdx(idx)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors",
                  isSelected && !isActive && "bg-brand-50 text-brand-700",
                  isActive && "bg-brand-100 text-brand-800",
                  !isSelected && !isActive && "hover:bg-ink-50",
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

  // Footer dgn counter "X dari Y" supaya saat list di-filter user tahu
  // posisi (mis. "2 dari 18 proyek").
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
      <span className="text-ink-500 tabular-nums">
        {selectedOpts.length} dari {filtered.length} terpilih
        {query && filtered.length !== options.length && ` (${options.length} total)`}
      </span>
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
                  ref={inputRef}
                  type="search"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value)
                    setActiveIdx(0)
                  }}
                  onKeyDown={onKey}
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
          // Override Radix default focus behaviour -- force focus ke
          // search input. Default-nya Radix focus ke first focusable
          // child, kadang nyangkut di trigger atau scroll viewport.
          // rAF supaya popover fully mounted dulu sebelum focus.
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            requestAnimationFrame(() => inputRef.current?.focus())
          }}
          className="z-50 w-[--radix-popover-trigger-width] min-w-[280px] rounded-md border bg-surface shadow-md outline-none"
        >
          <div className="border-b p-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setActiveIdx(0)
                }}
                onKeyDown={onKey}
                placeholder="Cari (↑↓ Enter)…"
                className="h-9 w-full rounded border border-border-strong bg-surface pl-8 pr-3 text-sm focus:outline-none focus:border-brand-500"
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
