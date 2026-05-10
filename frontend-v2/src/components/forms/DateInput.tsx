import * as React from "react"
import { cn } from "@/lib/utils"

interface DateInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  /** ISO date string yyyy-mm-dd. */
  value: string | null | undefined
  onChange: (iso: string | null) => void
  className?: string
}

/**
 * Date input. Pakai native <input type="date"> -- UX terbaik di mobile
 * (pulls up native picker), juga acceptable di desktop. Hindari
 * dependency date-picker library yg menambah bundle.
 */
export const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(
  ({ value, onChange, className, ...props }, ref) => (
    <input
      ref={ref}
      type="date"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className={cn(
        "flex h-10 w-full rounded border border-border-strong bg-surface px-3 text-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 focus-visible:border-brand-500",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
)
DateInput.displayName = "DateInput"
