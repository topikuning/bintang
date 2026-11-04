"use client";

import { FileText, Trash2 } from "lucide-react";
import { useActionState } from "react";
import type { ActionState } from "@/lib/aksi";
import { hapusLampiran } from "@/lib/pengajuan/actions";

type Lampiran = { id: string; fileName: string; mimeType: string; kind: string; size: number };

const KIND_LABEL: Record<string, string> = {
  nota: "Pendukung",
  bukti_bayar: "Bukti bayar",
  lpj: "Nota LPJ",
  lainnya: "Lainnya",
};

function HapusTombol({ id, requestId }: { id: string; requestId: string }) {
  const [, action, pending] = useActionState<ActionState, FormData>(hapusLampiran.bind(null, id, requestId), undefined);
  return (
    <form action={action}>
      <button
        type="submit"
        disabled={pending}
        aria-label="Hapus lampiran"
        className="absolute top-1 right-1 flex size-7 items-center justify-center rounded-full bg-ink/70 text-white hover:bg-danger disabled:opacity-50"
      >
        <Trash2 aria-hidden className="size-3.5" />
      </button>
    </form>
  );
}

export function LampiranGrid({
  items,
  requestId,
  bolehHapus = false,
  showKind = false,
}: {
  items: Lampiran[];
  requestId?: string;
  bolehHapus?: boolean;
  showKind?: boolean;
}) {
  return (
    <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
      {items.map((a) => {
        const gambar = a.mimeType.startsWith("image/") && a.mimeType !== "image/heic" && a.mimeType !== "image/heif";
        return (
          <li key={a.id} className="relative overflow-hidden rounded-lg border border-border bg-surface-inset">
            <a href={`/api/berkas/${a.id}`} target="_blank" rel="noopener" className="block" title={a.fileName}>
              {gambar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/berkas/${a.id}`} alt={a.fileName} loading="lazy" className="aspect-square w-full object-cover" />
              ) : (
                <span className="flex aspect-square w-full flex-col items-center justify-center gap-1 p-2 text-center">
                  <FileText aria-hidden className="size-7 text-ink-muted" />
                  <span className="line-clamp-2 text-[11px] break-all text-ink-muted">{a.fileName}</span>
                </span>
              )}
              {showKind ? (
                <span className="absolute inset-x-0 bottom-0 bg-ink/65 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  {KIND_LABEL[a.kind] ?? a.kind}
                </span>
              ) : null}
            </a>
            {bolehHapus && requestId && a.kind === "nota" ? <HapusTombol id={a.id} requestId={requestId} /> : null}
          </li>
        );
      })}
    </ul>
  );
}
