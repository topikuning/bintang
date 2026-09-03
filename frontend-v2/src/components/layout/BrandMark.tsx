import { cn } from "@/lib/utils"

interface BrandMarkProps {
  compact?: boolean
  inverse?: boolean
  className?: string
}

/** Code-native mark: ascending ledger bars forming a compact spark. */
export function BrandMark({ compact = false, inverse = false, className }: BrandMarkProps) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <span
        aria-hidden="true"
        className={cn(
          "relative grid shrink-0 place-items-center overflow-hidden rounded-[10px] bg-brand-500 shadow-[0_8px_24px_rgb(99_102_241/0.35)]",
          compact ? "h-9 w-9" : "h-10 w-10",
        )}
      >
        <span className="absolute inset-x-2 bottom-2 flex items-end justify-center gap-[3px]">
          <i className="h-2 w-1.5 rounded-sm bg-white/65" />
          <i className="h-3.5 w-1.5 rounded-sm bg-white/85" />
          <i className="h-5 w-1.5 rounded-sm bg-white" />
        </span>
      </span>
      {!compact && (
        <span className="flex min-w-0 flex-col leading-none">
          <span className={cn("text-[17px] font-bold tracking-[-0.03em]", inverse ? "text-white" : "text-ink-900")}>Bintang</span>
          <span className={cn("mt-1.5 text-[9px] font-semibold uppercase tracking-[0.2em]", inverse ? "text-slate-400" : "text-ink-500")}>Financial OS</span>
        </span>
      )}
    </div>
  )
}
