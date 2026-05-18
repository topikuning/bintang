import { useMemo } from "react"
import { CalendarDays, X } from "lucide-react"
import { DateInput } from "@/components/forms/DateInput"
import { Button } from "@/components/ui/button"
import { toApiDate } from "@/lib/format"

interface DateRangeFilterProps {
  from: string | null
  to: string | null
  onChange: (next: { from: string | null; to: string | null }) => void
  className?: string
}

interface Preset {
  label: string
  compute: () => { from: string; to: string }
}

/**
 * Filter rentang tanggal utk list page (Tx/Invoice/PO).
 * - 2 input date (Dari / Sampai)
 * - Preset cepat: Hari ini, 7 hari, Bulan ini, Bulan lalu, YTD
 * - Tombol clear (X) saat ada nilai
 *
 * Format string YYYY-MM-DD; backend FastAPI parse via `date` type
 * lewat query param `date_from` / `date_to`.
 */
export function DateRangeFilter({
  from,
  to,
  onChange,
  className,
}: DateRangeFilterProps) {
  const presets = useMemo<Preset[]>(() => buildPresets(), [])
  const hasValue = !!from || !!to

  return (
    <div className={className}>
      <div className="flex items-center gap-2 flex-wrap">
        <CalendarDays className="h-3.5 w-3.5 text-ink-500 shrink-0" />
        <span className="text-[11px] uppercase tracking-wider text-ink-500 shrink-0">
          Periode
        </span>
        <div className="flex items-center gap-1.5">
          <DateInput
            value={from}
            onChange={(v) => onChange({ from: v, to })}
            placeholder="Dari"
          />
          <span className="text-ink-400 text-[12px]">→</span>
          <DateInput
            value={to}
            onChange={(v) => onChange({ from, to: v })}
            placeholder="Sampai"
          />
        </div>
        {hasValue && (
          <button
            type="button"
            onClick={() => onChange({ from: null, to: null })}
            className="inline-flex h-7 w-7 items-center justify-center rounded text-ink-500 hover:bg-ink-100"
            aria-label="Hapus filter tanggal"
            title="Hapus filter tanggal"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {/* Preset row */}
      <div className="flex gap-1.5 flex-wrap mt-1.5 ml-6">
        {presets.map((p) => (
          <Button
            key={p.label}
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px] font-medium text-ink-600 hover:bg-ink-100"
            onClick={() => {
              const { from: f, to: t } = p.compute()
              onChange({ from: f, to: t })
            }}
          >
            {p.label}
          </Button>
        ))}
      </div>
    </div>
  )
}

function buildPresets(): Preset[] {
  return [
    {
      label: "Hari ini",
      compute: () => {
        const t = new Date()
        const s = toApiDate(t) ?? ""
        return { from: s, to: s }
      },
    },
    {
      label: "7 hari",
      compute: () => {
        const to = new Date()
        const from = new Date()
        from.setDate(to.getDate() - 6)
        return { from: toApiDate(from) ?? "", to: toApiDate(to) ?? "" }
      },
    },
    {
      label: "Bulan ini",
      compute: () => {
        const now = new Date()
        const from = new Date(now.getFullYear(), now.getMonth(), 1)
        return { from: toApiDate(from) ?? "", to: toApiDate(now) ?? "" }
      },
    },
    {
      label: "Bulan lalu",
      compute: () => {
        const now = new Date()
        const from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
        const to = new Date(now.getFullYear(), now.getMonth(), 0)
        return { from: toApiDate(from) ?? "", to: toApiDate(to) ?? "" }
      },
    },
    {
      label: "Tahun ini",
      compute: () => {
        const now = new Date()
        const from = new Date(now.getFullYear(), 0, 1)
        return { from: toApiDate(from) ?? "", to: toApiDate(now) ?? "" }
      },
    },
  ]
}
