"use client";

import { FileSpreadsheet, FileText, Image as ImageIcon, Plus, Trash2, Video } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FilePicker } from "@/components/ui/file-picker";
import { ActionFeedback, SubmitButton, ToastView } from "@/components/ui/form-bits";
import { Sheet } from "@/components/ui/lapisan";
import type { ActionState } from "@/lib/aksi";
import { hapusDokumenProyek, unggahDokumenProyek } from "@/lib/proyek/actions";

export type DokumenRow = { id: string; label: string; fileName: string; mimeType: string; size: number; tanggal: string; oleh: string };

function Ikon({ mime }: { mime: string }) {
  const cls = "size-5 shrink-0 text-ink-muted";
  if (mime.startsWith("image/")) return <ImageIcon aria-hidden className={cls} />;
  if (mime.startsWith("video/")) return <Video aria-hidden className={cls} />;
  if (mime.includes("spreadsheet")) return <FileSpreadsheet aria-hidden className="size-5 shrink-0 text-masuk" />;
  return <FileText aria-hidden className={cls} />;
}

function ukuran(n: number) {
  return n >= 1_000_000 ? `${(n / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(n / 1000))} KB`;
}

function Hapus({ id, projectId }: { id: string; projectId: string }) {
  const [, action, pending] = useActionState<ActionState, FormData>(hapusDokumenProyek.bind(null, id, projectId), undefined);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Hapus dokumen ini?")) e.preventDefault();
      }}
    >
      <button type="submit" disabled={pending} aria-label="Hapus dokumen" className="flex size-9 items-center justify-center rounded-md text-ink-faint hover:bg-danger-soft hover:text-danger">
        <Trash2 aria-hidden className="size-4" />
      </button>
    </form>
  );
}

/** Dokumen proyek: kontrak, SPK, BAST – termasuk arsip yang dipindah dari Bintang lama. */
export function DokumenProyek({ projectId, rows, bolehKelola }: { projectId: string; rows: DokumenRow[]; bolehKelola: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<ActionState, FormData>(unggahDokumenProyek.bind(null, projectId), undefined);
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
      const t = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(t);
    }
  }, [state]);

  return (
    <>
      {rows.length ? (
        <ul className="divide-y divide-border">
          {rows.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-4 py-2.5">
              <Ikon mime={d.mimeType} />
              <a href={`/api/berkas/${d.id}`} target="_blank" rel="noopener" className="min-w-0 flex-1 hover:underline">
                <span className="block truncate text-sm font-medium">{d.label}</span>
                <span className="block truncate text-xs text-ink-muted">
                  {d.fileName} · {ukuran(d.size)} · {d.tanggal} · {d.oleh}
                </span>
              </a>
              {bolehKelola ? <Hapus id={d.id} projectId={projectId} /> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-5 text-center text-[13px] text-ink-muted">Belum ada dokumen. Simpan kontrak, SPK, atau BAST di sini supaya mudah dicari.</p>
      )}
      {bolehKelola ? (
        <div className="border-t border-border px-4 py-2.5">
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            <Plus aria-hidden className="size-4" /> Tambah dokumen
          </Button>
        </div>
      ) : null}
      <Sheet open={open} onClose={() => setOpen(false)} title="Tambah dokumen proyek" size="sm">
        <form action={action} className="space-y-4">
          <ActionFeedback state={state} />
          <Field label="Judul" htmlFor="doc-label" required>
            <Input id="doc-label" name="label" placeholder="mis. Kontrak No. 12/PU/2026" maxLength={200} required />
          </Field>
          <FilePicker name="dokumen" label="Berkas" hint="PDF atau foto. Maks 10 MB per berkas." maxFiles={10} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <SubmitButton>Simpan</SubmitButton>
          </div>
        </form>
      </Sheet>
      {toast ? <ToastView pesan={toast} /> : null}
    </>
  );
}
