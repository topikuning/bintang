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

export interface ComboboxOption {
  value: string | number
  label: string
  /** Sub-text di bawah label (mis. project code). */
  hint?: string
}

interface ComboboxProps {
  value: string | number | null | undefined
  onChange: (value: string | number | null) => void
  options: ComboboxOption[]
  placeholder?: string
  emptyMessage?: string
  /** Allow clearing -- tampilkan tombol X. */
  clearable?: boolean
  isLoading?: boolean
  disabled?: boolean
  /** Label utk sheet di mobile (mis. "Pilih Proyek"). */
  sheetTitle?: string
  className?: string
}

/**
 * Picker generik single-select dgn search.
 * Desktop: Radix Popover dgn input filter di top.
 * Mobile: bottom Sheet (lebih ergonomis utk thumb).
 *
 * Keyboard support (desktop):
 *  - Saat dropdown open, focus auto ke search input
 *  - ArrowDown/ArrowUp: navigasi highlight di list filtered (wrap)
 *  - Enter: pilih item yg ter-highlight
 *  - Esc: tutup (handled native by Radix)
 *
 * Clipping prevention:
 *  - Popover.Content pakai `--radix-popover-content-available-height`
 *    + collisionPadding supaya konten otomatis shrink saat ruang sempit
 *    (mis. trigger di bawah side-sheet -> popover open ke atas, search
 *    bar di top tdk ke-clip viewport).
 */
export function Combobox({
  value,
  onChange,
  options,
  placeholder = "Pilih…",
  emptyMessage = "Tidak ada hasil.",
  clearable,
  isLoading,
  disabled,
  sheetTitle = "Pilih opsi",
  className,
}: ComboboxProps) {
  const bp = useBreakpoint()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [activeIdx, setActiveIdx] = React.useState(0)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const listRef = React.useRef<HTMLUListElement>(null)

  const selected = options.find((o) => o.value === value)

  const filtered = React.useMemo(() => {
    if (!query.trim()) return options
    const q = query.toLowerCase()
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) || o.hint?.toLowerCase().includes(q),
    )
  }, [options, query])

  // Reset state saat tutup.
  React.useEffect(() => {
    if (!open) {
      setQuery("")
      setActiveIdx(0)
    }
  }, [open])

  // Saat open, default highlight ke item yg sudah terpilih (kalau ada),
  // supaya keyboard nav langsung punya konteks.
  React.useEffect(() => {
    if (!open) return
    if (selected) {
      const idx = filtered.findIndex((o) => o.value === selected.value)
      setActiveIdx(idx >= 0 ? idx : 0)
    } else {
      setActiveIdx(0)
    }
    // Sengaja hanya tergantung `open` -- jangan re-run tiap ketikan,
    // itu di-handle clamp effect di bawah.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const choose = (v: string | number) => {
    onChange(v)
    setOpen(false)
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
      if (opt) choose(opt.value)
    }
  }

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
          !selected && "text-ink-400",
        )}
      >
        {isLoading ? "Memuat…" : selected ? selected.label : placeholder}
      </span>
      {clearable && selected && !disabled && (
        <X
          role="button"
          tabIndex={-1}
          aria-label="Bersihkan pilihan"
          className="h-4 w-4 text-ink-400 hover:text-ink-700"
          onClick={(e) => {
            e.stopPropagation()
            onChange(null)
          }}
        />
      )}
      <ChevronDown className="h-4 w-4 text-ink-400 shrink-0" />
    </button>
  )

  const list = (
    <ul ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
      {filtered.length === 0 ? (
        <li className="px-3 py-6 text-center text-sm text-ink-500">{emptyMessage}</li>
      ) : (
        filtered.map((opt, idx) => {
          const isSelected = opt.value === value
          const isActive = idx === activeIdx
          return (
            <li key={opt.value} data-idx={idx}>
              <button
                type="button"
                onClick={() => choose(opt.value)}
                onMouseEnter={() => setActiveIdx(idx)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors",
                  isActive && "bg-brand-100 text-brand-800",
                  isSelected && !isActive && "bg-brand-50 text-brand-700",
                  !isSelected && !isActive && "hover:bg-ink-50",
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm font-medium">{opt.label}</div>
                  {opt.hint && (
                    <div className="truncate text-[11px] text-ink-500">{opt.hint}</div>
                  )}
                </div>
                {isSelected && <Check className="h-4 w-4 text-brand-600 shrink-0" />}
              </button>
            </li>
          )
        })
      )}
    </ul>
  )

  // Footer counter -- berguna saat list panjang & user filter ("5 dari
  // 18 proyek"). Hanya tampil di desktop popover supaya mobile sheet
  // tetap minimalis.
  const footer = filtered.length > 0 && (
    <div className="flex items-center justify-between gap-2 border-t bg-surface px-3 py-1.5 text-[11px] text-ink-500 tabular-nums shrink-0">
      <span>
        {filtered.length === options.length
          ? `${options.length} item`
          : `${filtered.length} dari ${options.length}`}
      </span>
      <span className="text-ink-400">↑↓ navigasi · Enter pilih · Esc tutup</span>
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
            <div className="px-5 pt-3 shrink-0">
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
            <div className="mt-3 flex-1 min-h-0 flex flex-col overflow-hidden">
              {list}
            </div>
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
          collisionPadding={8}
          // Override Radix default focus behaviour -- force focus ke
          // search input. Default-nya kadang nyangkut. rAF supaya
          // popover fully mounted dulu sebelum focus.
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            requestAnimationFrame(() => inputRef.current?.focus())
          }}
          // Constrain tinggi total ke ruang yg tersedia (CSS var dari
          // Radix). Flex column supaya search header tetap visible di
          // top + list scroll di tengah + footer di bawah, walau ruang
          // sempit (mis. trigger di bawah side-sheet).
          style={{ maxHeight: "var(--radix-popover-content-available-height)" }}
          className="z-50 flex w-[--radix-popover-trigger-width] min-w-[280px] flex-col overflow-hidden rounded-md border bg-surface shadow-md outline-none"
        >
          <div className="border-b p-2 shrink-0">
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
