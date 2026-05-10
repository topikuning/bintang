import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold leading-tight uppercase tracking-wider",
  {
    variants: {
      tone: {
        success: "bg-success-50 text-success-700 border border-success-100",
        warning: "bg-warning-50 text-warning-700 border border-warning-100",
        danger: "bg-danger-50 text-danger-700 border border-danger-100",
        info: "bg-info-50 text-info-700 border border-info-100",
        neutral: "bg-ink-100 text-ink-700 border border-ink-200",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />
}
