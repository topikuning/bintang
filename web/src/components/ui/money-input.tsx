"use client";

import { useState, type Ref } from "react";
import { cn } from "@/lib/cn";
import { formatIsian } from "@/lib/uang";
import { CONTROL_CLASS } from "./field";

/**
 * Isian rupiah: titik ribuan muncul SAAT mengetik ("1.250.000"), papan angka
 * di ponsel (inputMode numeric), awalan "Rp" tetap. Nilai yang dikirim ke
 * server tetap teks berformat – server membacanya dengan `parseRupiah`.
 */
export function MoneyInput({
  name,
  id,
  value,
  defaultValue,
  onChange,
  invalid,
  placeholder = "0",
  className,
  size = "md",
  ref,
  ...rest
}: {
  name?: string;
  id?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (formatted: string) => void;
  invalid?: boolean;
  placeholder?: string;
  className?: string;
  size?: "md" | "lg";
  ref?: Ref<HTMLInputElement>;
  required?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  "aria-label"?: string;
  "aria-describedby"?: string;
}) {
  const [internal, setInternal] = useState(formatIsian(defaultValue ?? ""));
  const v = value !== undefined ? value : internal;
  return (
    <div className={cn("relative min-w-0", className)}>
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted",
          size === "lg" ? "text-base font-medium" : "text-sm",
        )}
      >
        Rp
      </span>
      <input
        ref={ref}
        id={id}
        name={name}
        inputMode="numeric"
        autoComplete="off"
        value={v}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        onChange={(e) => {
          const f = formatIsian(e.target.value);
          if (value === undefined) setInternal(f);
          onChange?.(f);
        }}
        className={cn(
          CONTROL_CLASS,
          "tabular pl-9 text-right",
          size === "lg" ? "h-12 text-lg font-semibold sm:text-lg" : "h-10 pointer-coarse:min-h-11",
          invalid && "border-danger",
        )}
        {...rest}
      />
    </div>
  );
}
