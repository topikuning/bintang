import { Loader2 } from "lucide-react";
import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "danger" | "success" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-white hover:bg-primary-800 active:bg-primary-900 disabled:bg-primary/50 border border-transparent shadow-xs",
  secondary:
    "bg-surface text-ink border border-border hover:bg-surface-muted hover:border-border-strong active:bg-surface-inset disabled:text-ink-faint",
  danger:
    "bg-danger text-white hover:bg-danger/90 active:bg-danger/80 disabled:bg-danger/50 border border-transparent shadow-xs",
  success:
    "bg-success text-white hover:bg-success/90 active:bg-success/80 disabled:bg-success/50 border border-transparent shadow-xs",
  ghost:
    "bg-transparent text-ink-muted hover:bg-surface-inset hover:text-ink active:bg-surface-muted border border-transparent",
};

// Di layar sentuh tombol minimal 44 px (pointer-coarse) – jari bukan kursor.
const SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 pointer-coarse:min-h-10",
  md: "h-9 px-4 text-sm gap-2 pointer-coarse:min-h-11",
  lg: "h-11 px-5 text-[15px] gap-2 pointer-coarse:min-h-12",
};

const BASE =
  "inline-flex items-center justify-center rounded-md font-medium whitespace-nowrap select-none transition-colors disabled:cursor-not-allowed";

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string) {
  return cn(BASE, VARIANT[variant], SIZE[size], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass(variant, size, className)}
      {...rest}
    >
      {loading ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
      {children}
    </button>
  );
}

export interface ButtonLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
  /** Tautan ke route handler (unduhan/cetak) – bukan navigasi Next. */
  external?: boolean;
}

export function ButtonLink({
  href,
  variant = "secondary",
  size = "md",
  className,
  children,
  external = false,
  ...rest
}: ButtonLinkProps) {
  const cls = buttonClass(variant, size, className);
  if (external) {
    return (
      <a href={href} className={cls} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls} {...rest}>
      {children}
    </Link>
  );
}
