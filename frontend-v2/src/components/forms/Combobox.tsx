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
 * Picker generik dgn search.
 * Desktop: Radix Popover dgn input filter di top.
 * Mobile: bottom Sheet (lebih ergonomis utk thumb).
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

  const selected = options.find((o) => o.value === value)

  const filtered = React.useMemo(() => {
    if (!query.trim()) return options
    const q = query.toLowerCase()
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) || o.hint?.toLowerCase().includes(q),
    )
  }, [options, query])

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
    <ul className="max-h-[400px] overflow-y-auto">
      {filtered.length === 0 ? (
        <li className="px-3 py-6 text-center text-sm text-ink-500">{emptyMessage}</li>
      ) : (
        filtered.map((opt) => {
          const isSelected = opt.value === value
          return (
            <li key={opt.value}>
              <button
                type="button"
                onClick={() => {
                  onChange(opt.value)
                  setOpen(false)
                  setQuery("")
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors",
                  isSelected ? "bg-brand-50 text-brand-700" : "hover:bg-ink-100",
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
          className="z-50 w-[var(--radix-popover-trigger-width)] min-w-[260px] rounded-md border bg-surface shadow-lg overflow-hidden"
          onOpenAutoFocus={(e) => {
            // Focus search input, bukan first item
            e.preventDefault()
          }}
        >
          <div className="border-b p-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cari…"
                className="h-9 w-full rounded border border-border bg-surface-muted pl-8 pr-3 text-sm focus:outline-none focus:border-brand-500 focus:bg-surface"
                autoFocus
              />
            </div>
          </div>
          {list}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
