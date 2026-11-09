"use client";

import { Printer } from "lucide-react";
import { useEffect } from "react";

export function TombolCetak({ otomatis = false }: { otomatis?: boolean }) {
  useEffect(() => {
    if (!otomatis) return;
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [otomatis]);
  return (
    <div className="no-print mx-auto mb-4 flex max-w-[210mm] items-center justify-between gap-3 px-4 sm:px-0">
      <button type="button" onClick={() => window.history.back()} className="text-sm text-ink-muted hover:text-ink">
        ‹ Kembali
      </button>
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white hover:bg-primary-800"
      >
        <Printer aria-hidden className="size-4" /> Cetak / simpan PDF
      </button>
    </div>
  );
}
