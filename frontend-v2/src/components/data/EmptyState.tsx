import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { Inbox } from "lucide-react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: ReactNode
  /** Backward-compat: custom action node (mis. multiple button). */
  action?: ReactNode
  /** Convenience: 1 CTA button. Pakai salah satu (onAction | to). */
  actionLabel?: string
  onAction?: () => void
  to?: string
  /** Tone visual: neutral (default), success, warning, danger. */
  tone?: "neutral" | "success" | "warning" | "danger"
  /** Compact = padding lebih kecil utk inline context (mis. di sub-section). */
  compact?: boolean
  className?: string
}

const TONE_CLASSES = {
  neutral: { bg: "bg-ink-100/60", text: "text-ink-500" },
  success: { bg: "bg-success-100/60", text: "text-success-600" },
  warning: { bg: "bg-warning-100/60", text: "text-warning-600" },
  danger: { bg: "bg-danger-100/60", text: "text-danger-600" },
} as const

/**
 * Empty state generic -- icon + headline + body + CTA.
 *
 * Sebelumnya banyak tempat hanya tampilkan teks abu-abu "Belum ada X".
 * Komponen ini provide:
 *  - Visual focus (icon dgn tone-aware background)
 *  - Headline jelas (apa yg kosong)
 *  - Penjelasan (kenapa kosong / what to do next)
 *  - CTA langsung (trigger create / navigate ke setup page)
 *
 * Pakai di empty list / first-run state. Untuk sub-section yg tdk perlu
 * dominan, set `compact`.
 */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  actionLabel,
  onAction,
  to,
  tone = "neutral",
  compact = false,
  className,
}: EmptyStateProps) {
  const t = TONE_CLASSES[tone]

  // Resolve action: custom `action` node menang; selain itu auto-build
  // dari actionLabel+onAction/to.
  const resolvedAction: ReactNode =
    action ??
    (actionLabel && (onAction || to)
      ? to
        ? (
            <Button asChild size="sm">
              <Link to={to}>{actionLabel}</Link>
            </Button>
          )
        : (
            <Button size="sm" onClick={onAction}>
              {actionLabel}
            </Button>
          )
      : null)

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center rounded-md border border-dashed bg-surface",
        compact ? "gap-2 p-5" : "gap-3 p-8",
        className,
      )}
    >
      <div
        className={cn(
          "flex items-center justify-center rounded-full",
          compact ? "h-10 w-10" : "h-14 w-14",
          t.bg,
        )}
      >
        <Icon
          className={cn(compact ? "h-5 w-5" : "h-7 w-7", t.text)}
          aria-hidden="true"
        />
      </div>
      <div className="flex flex-col gap-1">
        <h3
          className={cn(
            "font-semibold text-ink-900",
            compact ? "text-sm" : "text-base",
          )}
        >
          {title}
        </h3>
        {description && (
          <p
            className={cn(
              "text-ink-500 max-w-md mx-auto",
              compact ? "text-[12px]" : "text-[13px]",
            )}
          >
            {description}
          </p>
        )}
      </div>
      {resolvedAction && <div className="mt-1">{resolvedAction}</div>}
    </div>
  )
}
