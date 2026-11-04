"use client";

import { CheckCircle2, XCircle } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/aksi";
import { cn } from "@/lib/cn";
import { Button, type ButtonProps } from "./button";

/** Tombol submit yang otomatis berputar selama form terkirim. */
export function SubmitButton({ children, pendingText, ...rest }: ButtonProps & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} {...rest}>
      {pending && pendingText ? pendingText : children}
    </Button>
  );
}

/**
 * Umpan balik hasil server action. Galat tampil sebagai banner; sukses tampil
 * sebagai toast kecil di bawah layar yang hilang sendiri – orang tidak perlu
 * menutupnya dan isinya tidak menggeser tata letak.
 */
export function ActionFeedback({ state, className }: { state: ActionState; className?: string }) {
  if (!state?.error) return null;
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2.5 rounded-lg border border-danger-border bg-danger-soft px-3.5 py-3 text-sm",
        className,
      )}
    >
      <XCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
      <p className="text-ink">{state.error}</p>
    </div>
  );
}

export function Toast({ state }: { state: ActionState }) {
  const [tampil, setTampil] = useState<{ pesan: string; at: number } | null>(null);
  const terakhir = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (state?.ok && state.at !== terakhir.current) {
      terakhir.current = state.at;
      const pesan = state.ok;
      const at = state.at ?? Date.now();
      queueMicrotask(() => setTampil({ pesan, at }));
      const t = setTimeout(() => setTampil((s) => (s?.at === at ? null : s)), 3500);
      return () => clearTimeout(t);
    }
  }, [state]);
  if (!tampil) return null;
  return <ToastView pesan={tampil.pesan} />;
}

export function ToastView({ pesan }: { pesan: ReactNode }) {
  return (
    <div
      role="status"
      className="bintang-naik fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[1300] mx-auto flex w-fit max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm text-white shadow-(--shadow-pop) lg:bottom-6"
    >
      <CheckCircle2 aria-hidden className="size-4 shrink-0 text-emerald-400" />
      <span>{pesan}</span>
    </div>
  );
}
