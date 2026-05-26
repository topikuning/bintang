/**
 * Compact filter toolbar untuk halaman list (transactions, invoices, POs).
 *
 * Audit 2026-05-24: redesign dr layout 5-row "label + control" yg crowded
 * jadi 1 row tombol popover. Tiap filter = button outline. Saat aktif,
 * button berubah warna + tampilkan value inline. Klik tombol = popover
 * dgn opsi + tombol Clear.
 *
 * Inspired by Linear / Notion / shadcn data-table-toolbar.
 *
 * Pemakaian:
 *   <FilterBar onReset={resetAll} hasActive={anyFilterActive}>
 *     <FilterButton label="Proyek" active={...} displayValue="KNMP" onClear={...}>
 *       <MultiProjectPicker ... />
 *     </FilterButton>
 *     <FilterButton label="Status" active={...} displayValue="Menunggu" ...>
 *       <RadioGroup ... />
 *     </FilterButton>
 *     <FilterToggle active={unlinked} onToggle={...}>Belum dialokasi</FilterToggle>
 *   </FilterBar>
 */
import * as Popover from "@radix-ui/react-popover"
import { ChevronDown, RotateCcw, X } from "lucide-react"
import * as React from "react"
import { cn } from "@/lib/utils"

interface FilterBarProps {
  children: React.ReactNode
  hasActive?: boolean
  onReset?: () => void
  className?: string
}

export function FilterBar({
  children,
  hasActive,
  onReset,
  className,
}: FilterBarProps) {
  return (
    <div className={cn("flex items-center gap-1.5 flex-wrap", className)}>
      {children}
      {hasActive && onReset && (
        <button
          type="button"
          onClick={onReset}
          className="flex items-center gap-1 rounded-md px-2 py-1.5 text-[12px] font-medium text-ink-500 hover:bg-ink-100 hover:text-ink-900"
          title="Reset semua filter"
        >
          <RotateCcw className="h-3 w-3" />
          Reset
        </button>
      )}
    </div>
  )
}

interface FilterButtonProps {
  label: string
  /** Apakah ada value aktif (utk styling + show display). */
  active: boolean
  /** Value compact yg di-render setelah label saat active. */
  displayValue?: string | null
  children: React.ReactNode
  onClear?: () => void
  /** Lebar max popover. Default 280px. */
  width?: number
}

export function FilterButton({
  label,
  active,
  displayValue,
  children,
  onClear,
  width = 280,
}: FilterButtonProps) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12.5px] transition-colors",
            active
              ? "border-brand-300 bg-brand-50 text-brand-800 hover:bg-brand-100"
              : "border-border-strong bg-surface text-ink-700 hover:bg-ink-50",
          )}
        >
          <span className={cn("font-medium", active && "font-semibold")}>
            {label}
          </span>
          {active && displayValue && (
            <>
              <span className="text-brand-400">·</span>
              <span className="truncate max-w-[120px]">{displayValue}</span>
            </>
          )}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-50 rounded-md border bg-surface shadow-lg outline-none animate-in fade-in-0 zoom-in-95"
          style={{ width }}
        >
          <div className="p-3">{children}</div>
          {active && onClear && (
            <div className="border-t">
              <button
                type="button"
                onClick={onClear}
                className="flex w-full items-center justify-center gap-1.5 px-3 py-2 text-[12px] text-danger-700 hover:bg-danger-50"
              >
                <X className="h-3 w-3" />
                Bersihkan {label.toLowerCase()}
              </button>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

interface FilterToggleProps {
  active: boolean
  onToggle: () => void
  children: React.ReactNode
  /** Icon di kiri (optional). */
  icon?: React.ReactNode
  /** Tone saat aktif. Default "warning". */
  tone?: "warning" | "brand" | "danger"
}

export function FilterToggle({
  active,
  onToggle,
  children,
  icon,
  tone = "warning",
}: FilterToggleProps) {
  const toneClass = active
    ? tone === "warning"
      ? "border-warning-300 bg-warning-50 text-warning-800"
      : tone === "danger"
      ? "border-danger-300 bg-danger-50 text-danger-800"
      : "border-brand-300 bg-brand-50 text-brand-800"
    : "border-border-strong bg-surface text-ink-700 hover:bg-ink-50"
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12.5px] font-medium transition-colors",
        toneClass,
      )}
    >
      {active && <span className="text-[10px]">✓</span>}
      {!active && icon}
      {children}
    </button>
  )
}


// ---------- Helper: simple radio list utk dipakai di FilterButton ----------

interface FilterRadioOption<V extends string> {
  value: V
  label: string
}

interface FilterRadioListProps<V extends string> {
  value: V
  options: FilterRadioOption<V>[]
  onChange: (v: V) => void
}

export function FilterRadioList<V extends string>({
  value,
  options,
  onChange,
}: FilterRadioListProps<V>) {
  return (
    <div className="flex flex-col gap-0.5">
      {options.map((opt) => {
        const selected = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] transition-colors",
              selected
                ? "bg-brand-50 text-brand-900 font-medium"
                : "text-ink-700 hover:bg-ink-100",
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                selected ? "bg-brand-600" : "bg-ink-300",
              )}
            />
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
