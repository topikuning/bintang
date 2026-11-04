"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";

/** Tombol salin – untuk nomor rekening & nominal yang akan diketik ulang di m-banking. */
export function Salin({ teks, label = "Salin", className }: { teks: string; label?: string; className?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(teks);
          setOk(true);
          setTimeout(() => setOk(false), 1500);
        } catch {
          // Peramban menolak akses papan klip – tidak ada yang bisa dilakukan.
        }
      }}
      aria-label={`${label}: ${teks}`}
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface px-2 text-[12px] font-medium text-ink-muted hover:border-border-strong hover:text-ink pointer-coarse:h-9",
        ok && "border-success-border bg-success-soft text-success",
        className,
      )}
    >
      {ok ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
      {ok ? "Tersalin" : label}
    </button>
  );
}
