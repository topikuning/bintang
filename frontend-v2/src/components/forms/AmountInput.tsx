import * as React from "react"
import { cn } from "@/lib/utils"

interface AmountInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "prefix"> {
  /** Nilai numeric. null/undefined diperlakukan sbg empty. */
  value: number | null | undefined
  /** Dipanggil dgn nilai numeric (atau null kalau kosong). */
  onChange: (value: number | null) => void
  /** Currency prefix, default "Rp". Set null utk hilangkan. */
  prefix?: string | null
  className?: string
}

function formatThousands(n: number): string {
  return n.toLocaleString("id-ID", { maximumFractionDigits: 0 })
}

function parseDigits(s: string): number | null {
  const digits = s.replace(/[^\d]/g, "")
  if (!digits) return null
  return Number(digits)
}

/**
 * Input nominal Rupiah dgn auto-format ribuan saat user mengetik.
 * Implementasi: maintain string state internal yg formatted, parse
 * ke number saat blur/onChange utk dikirim ke caller.
 */
export const AmountInput = React.forwardRef<HTMLInputElement, AmountInputProps>(
  ({ value, onChange, prefix = "Rp", className, disabled, placeholder, ...props }, ref) => {
    // Sinkronisasi: kalau value dari luar berubah, refresh display.
    const [display, setDisplay] = React.useState<string>(() =>
      value != null ? formatThousands(value) : "",
    )
    React.useEffect(() => {
      const numCurrent = parseDigits(display)
      if (value !== numCurrent) {
        setDisplay(value != null ? formatThousands(value) : "")
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value])

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value
      const num = parseDigits(raw)
      setDisplay(num != null ? formatThousands(num) : "")
      onChange(num)
    }

    return (
      <div className={cn("relative flex items-center", className)}>
        {prefix && (
          <span className="absolute left-3 text-sm text-ink-500 select-none pointer-events-none">
            {prefix}
          </span>
        )}
        <input
          ref={ref}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={display}
          onChange={handleChange}
          placeholder={placeholder ?? "0"}
          disabled={disabled}
          className={cn(
            "h-10 w-full rounded border border-border-strong bg-surface text-right font-mono text-sm",
            prefix ? "pl-9 pr-3" : "px-3",
            "[font-variant-numeric:tabular-nums]",
            "placeholder:text-ink-400",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 focus-visible:border-brand-500",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
          {...props}
        />
      </div>
    )
  },
)
AmountInput.displayName = "AmountInput"
