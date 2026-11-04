"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

/**
 * Lapisan layar penuh via portal ke <body> (konsep MARLIN "Lapisan"): tidak
 * bisa dikurung leluhur ber-transform, dan z-index-nya satu skala.
 *
 * `Sheet` = lembar bawah di ponsel, dialog di tengah di desktop. Escape
 * menutup, fokus terkurung, fokus kembali ke pemicu, gulir latar dikunci.
 *
 * PENTING: isi lembar yang berupa <form> harus berada DI DALAM lembar
 * (portal memindahkan simpul keluar dari form induk).
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const [siap, setSiap] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    queueMicrotask(() => setSiap(true));
  }, []);

  const tutup = useCallback(() => {
    onClose();
    restoreRef.current?.focus?.();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const semula = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const panel = panelRef.current;
    const fokusable = () =>
      panel
        ? Array.from(
            panel.querySelectorAll<HTMLElement>(
              'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          )
        : [];
    // Fokus ke kontrol isian pertama bila ada, kalau tidak ke tombol tutup.
    queueMicrotask(() => {
      const els = fokusable();
      const isian = els.find((e) => e.tagName === "INPUT" || e.tagName === "TEXTAREA");
      (isian ?? els[0])?.focus();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        tutup();
        return;
      }
      if (e.key !== "Tab") return;
      const els = fokusable();
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = semula;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, tutup]);

  if (!siap || !open) return null;
  const lebar = size === "sm" ? "sm:max-w-sm" : size === "lg" ? "sm:max-w-2xl" : "sm:max-w-lg";
  return createPortal(
    <div className="fixed inset-0 z-[1200] flex items-end justify-center sm:items-center sm:p-4" role="presentation">
      <button
        type="button"
        aria-label="Tutup"
        tabIndex={-1}
        onClick={tutup}
        className="absolute inset-0 bg-ink/45 backdrop-blur-[1px]"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        className={cn(
          "bintang-naik relative flex max-h-[92dvh] w-full flex-col rounded-t-2xl border border-border bg-surface shadow-(--shadow-pop) sm:rounded-xl",
          lebar,
        )}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-border-strong sm:hidden" aria-hidden />
        <div className="flex items-start justify-between gap-3 px-4 pt-3 pb-2 sm:pt-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink">{title}</h2>
            {description ? <div className="mt-0.5 text-[13px] text-ink-muted">{description}</div> : null}
          </div>
          <button
            type="button"
            aria-label="Tutup"
            onClick={tutup}
            className="-mr-1 flex size-9 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-surface-inset hover:text-ink"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
        {footer ? (
          <div className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pb-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
