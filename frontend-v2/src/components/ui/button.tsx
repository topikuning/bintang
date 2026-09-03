import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-brand-600 text-white shadow-[0_1px_2px_rgb(15_23_42/0.12),0_6px_16px_rgb(79_70_229/0.18)] hover:-translate-y-px hover:bg-brand-500 active:translate-y-0 active:bg-brand-700",
        secondary:
          "border border-border-strong bg-white text-ink-800 shadow-sm hover:border-ink-300 hover:bg-ink-50",
        ghost:
          "text-ink-600 hover:bg-ink-100 hover:text-ink-900",
        danger:
          "bg-danger-600 text-white shadow-sm hover:bg-danger-500",
        outline:
          "border border-brand-300 bg-white text-brand-700 hover:bg-brand-50",
        link:
          "text-brand-600 underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-9 px-3 text-[12px]",
        md: "h-10 px-4 text-[13px]",
        lg: "h-12 px-5 text-sm",
        icon: "h-10 w-10",
        "icon-sm": "h-8 w-8",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = "Button"
