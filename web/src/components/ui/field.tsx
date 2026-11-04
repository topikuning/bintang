import type {
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  Ref,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/cn";

export function Label({
  required,
  className,
  children,
  ...rest
}: LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }) {
  return (
    <label className={cn("mb-1 block text-[13px] font-medium text-ink", className)} {...rest}>
      {children}
      {required ? (
        <span aria-hidden className="ml-0.5 text-danger">
          *
        </span>
      ) : null}
    </label>
  );
}

/*
 * `text-base sm:text-sm` = 16px di ponsel. Bukan selera: Safari iOS memperbesar
 * halaman bila kontrol yang difokus < 16px, dan zoom itu terbawa ke halaman
 * berikutnya (MARLIN DECISIONS 246).
 */
export const CONTROL_CLASS =
  "w-full rounded-md border border-border bg-surface px-3 py-2 text-base sm:text-sm text-ink transition-colors " +
  "hover:border-border-strong focus-visible:outline-2 focus-visible:outline-primary-600 focus-visible:border-primary-400 " +
  "disabled:cursor-not-allowed disabled:bg-surface-inset disabled:text-ink-faint";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  ref?: Ref<HTMLInputElement>;
}

export function Input({ invalid, className, ...rest }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(CONTROL_CLASS, "h-10 pointer-coarse:min-h-11", invalid && "border-danger", className)}
      {...rest}
    />
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  ref?: Ref<HTMLTextAreaElement>;
}

export function Textarea({ invalid, className, rows = 3, ...rest }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(CONTROL_CLASS, invalid && "border-danger", className)}
      {...rest}
    />
  );
}

export function FieldError({ id, children, className }: { id?: string; children?: ReactNode; className?: string }) {
  if (!children) return null;
  return (
    <p id={id} className={cn("mt-1 text-[13px] text-danger", className)}>
      {children}
    </p>
  );
}

export function HelpText({ id, children, className }: { id?: string; children: ReactNode; className?: string }) {
  return (
    <p id={id} className={cn("mt-1 text-[13px] text-ink-muted", className)}>
      {children}
    </p>
  );
}

/** Label + kontrol + bantuan + galat dalam satu bungkus. */
export function Field({
  label,
  htmlFor,
  required,
  help,
  error,
  className,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  required?: boolean;
  help?: ReactNode;
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <Label htmlFor={htmlFor} required={required}>
        {label}
      </Label>
      {children}
      {error ? <FieldError>{error}</FieldError> : help ? <HelpText>{help}</HelpText> : null}
    </div>
  );
}

/** Kotak centang besar yang enak disentuh. */
export function Checkbox({
  label,
  description,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; description?: ReactNode }) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-md border border-border bg-surface px-3 py-2.5 hover:border-border-strong has-[:checked]:border-primary-300 has-[:checked]:bg-primary-50",
        className,
      )}
    >
      <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-(--color-primary)" {...rest} />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        {description ? <span className="block text-[13px] text-ink-muted">{description}</span> : null}
      </span>
    </label>
  );
}
