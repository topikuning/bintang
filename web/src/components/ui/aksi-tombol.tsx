"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import type { ActionState } from "@/lib/aksi";
import { Button, type ButtonSize, type ButtonVariant } from "./button";
import { Textarea } from "./field";
import { ActionFeedback, SubmitButton, ToastView } from "./form-bits";
import { Sheet } from "./lapisan";

/**
 * Tombol aksi ber-konfirmasi untuk satu server action (verifikasi, tolak,
 * batalkan, nonaktifkan…). Konfirmasi tampil sebagai lembar bawah di ponsel,
 * dialog di desktop; catatan opsional/wajib; toast saat berhasil.
 */
export function AksiTombol({
  label,
  icon,
  variant = "secondary",
  size = "md",
  title,
  description,
  action,
  confirmLabel,
  confirmVariant,
  note = "none",
  notePlaceholder,
  className,
}: {
  label: string;
  icon?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  title: string;
  description?: ReactNode;
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  confirmLabel?: string;
  confirmVariant?: ButtonVariant;
  note?: "none" | "optional" | "required";
  notePlaceholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<ActionState, FormData>(action, undefined);
  const [toast, setToast] = useState<string | null>(null);
  const terakhir = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (state?.ok && state.at !== terakhir.current) {
      terakhir.current = state.at;
      const pesan = state.ok;
      queueMicrotask(() => {
        setOpen(false);
        setToast(pesan);
      });
      const t = setTimeout(() => setToast(null), 3500);
      return () => clearTimeout(t);
    }
  }, [state]);
  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)} className={className}>
        {icon}
        {label}
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={title} description={description} size="sm">
        <form action={formAction} className="space-y-3">
          <ActionFeedback state={state} />
          {note !== "none" ? (
            <Textarea
              name="note"
              aria-label="Catatan"
              placeholder={notePlaceholder}
              rows={3}
              required={note === "required"}
              maxLength={1000}
            />
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <SubmitButton variant={confirmVariant ?? (variant === "ghost" || variant === "secondary" ? "primary" : variant)}>
              {confirmLabel ?? label}
            </SubmitButton>
          </div>
        </form>
      </Sheet>
      {toast ? <ToastView pesan={toast} /> : null}
    </>
  );
}
