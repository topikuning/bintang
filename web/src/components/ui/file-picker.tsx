"use client";

import { Camera, FileText, Loader2, Paperclip, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * Pemilih lampiran untuk ponsel: "Foto" membuka kamera belakang langsung,
 * "Pilih berkas" membuka galeri/PDF. Foto DIKECILKAN di peramban sebelum
 * dikirim (maks 1.920 px, JPEG 0,82) – foto nota 6 MB jadi ±400 KB, jadi
 * unggahan di sinyal lapangan tidak macet.
 *
 * Berkas akhirnya ditaruh di satu <input type="file" name=…> tersembunyi
 * lewat DataTransfer, jadi tetap ikut FormData server action biasa.
 */

const MAKS_SISI = 1920;
const MUTU = 0.82;

async function kecilkan(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const skala = Math.min(1, MAKS_SISI / Math.max(bitmap.width, bitmap.height));
    if (skala === 1 && file.size < 900_000 && file.type === "image/jpeg") {
      bitmap.close();
      return file;
    }
    const w = Math.round(bitmap.width * skala);
    const h = Math.round(bitmap.height * skala);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", MUTU));
    if (!blob || blob.size >= file.size) return file;
    const nama = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], nama, { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    // HEIC di peramban yang tidak bisa membacanya, dst. – kirim apa adanya.
    return file;
  }
}

type Item = { id: string; file: File; url: string | null };

function ukuran(n: number) {
  return n >= 1_000_000 ? `${(n / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(n / 1000))} KB`;
}

export function FilePicker({
  name,
  label = "Lampiran",
  hint = "Foto nota, kuitansi, atau PDF. Maks 10 MB per berkas.",
  maxFiles = 8,
  className,
}: {
  name: string;
  label?: string;
  hint?: string;
  maxFiles?: number;
  className?: string;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [proses, setProses] = useState(false);
  const sinkRef = useRef<HTMLInputElement>(null);
  const kameraRef = useRef<HTMLInputElement>(null);
  const berkasRef = useRef<HTMLInputElement>(null);

  // Sinkronkan daftar ke input tersembunyi yang ikut dikirim form.
  //
  // React 19 MERESET form setelah server action selesai – termasuk saat aksi
  // mengembalikan galat validasi. Tanpa penyetelan ulang sesudah `reset`,
  // pratinjau masih menampilkan foto padahal input kirimnya sudah kosong, dan
  // kiriman kedua berangkat tanpa lampiran tanpa tanda apa pun.
  useEffect(() => {
    const sink = sinkRef.current;
    if (!sink) return;
    const pasang = () => {
      const dt = new DataTransfer();
      for (const it of items) dt.items.add(it.file);
      sink.files = dt.files;
    };
    pasang();
    const form = sink.form;
    const onReset = () => setTimeout(pasang, 0);
    form?.addEventListener("reset", onReset);
    return () => form?.removeEventListener("reset", onReset);
  }, [items]);

  useEffect(() => () => items.forEach((it) => it.url && URL.revokeObjectURL(it.url)), [items]);

  async function tambah(list: FileList | null) {
    if (!list || list.length === 0) return;
    setProses(true);
    try {
      const baru: Item[] = [];
      for (const f of Array.from(list).slice(0, Math.max(0, maxFiles - items.length))) {
        const k = await kecilkan(f);
        baru.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          file: k,
          url: k.type.startsWith("image/") ? URL.createObjectURL(k) : null,
        });
      }
      setItems((s) => [...s, ...baru]);
    } finally {
      setProses(false);
      if (kameraRef.current) kameraRef.current.value = "";
      if (berkasRef.current) berkasRef.current.value = "";
    }
  }

  const penuh = items.length >= maxFiles;

  return (
    <div className={cn("min-w-0", className)}>
      <p className="mb-1 text-[13px] font-medium text-ink">{label}</p>
      <input ref={sinkRef} type="file" name={name} multiple hidden tabIndex={-1} aria-hidden />
      <input
        ref={kameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => tambah(e.target.files)}
      />
      <input
        ref={berkasRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        hidden
        onChange={(e) => tambah(e.target.files)}
      />

      {items.length > 0 ? (
        <ul className="mb-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {items.map((it) => (
            <li key={it.id} className="group relative overflow-hidden rounded-md border border-border bg-surface-inset">
              {it.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.url} alt={it.file.name} className="aspect-square w-full object-cover" />
              ) : (
                <div className="flex aspect-square w-full flex-col items-center justify-center gap-1 p-2 text-center">
                  <FileText aria-hidden className="size-6 text-ink-muted" />
                  <span className="line-clamp-2 text-[11px] break-all text-ink-muted">{it.file.name}</span>
                </div>
              )}
              <span className="absolute inset-x-0 bottom-0 bg-ink/60 px-1.5 py-0.5 text-[10px] text-white">
                {ukuran(it.file.size)}
              </span>
              <button
                type="button"
                aria-label={`Hapus ${it.file.name}`}
                onClick={() => setItems((s) => s.filter((x) => x.id !== it.id))}
                className="absolute top-1 right-1 flex size-7 items-center justify-center rounded-full bg-ink/70 text-white hover:bg-ink"
              >
                <X aria-hidden className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={penuh || proses}
          onClick={() => kameraRef.current?.click()}
          className="inline-flex h-10 items-center gap-2 rounded-md border border-dashed border-border-strong bg-surface px-3.5 text-sm font-medium text-ink hover:border-primary-400 hover:bg-primary-50 disabled:opacity-50 pointer-coarse:h-11"
        >
          <Camera aria-hidden className="size-4 text-primary-600" />
          Foto
        </button>
        <button
          type="button"
          disabled={penuh || proses}
          onClick={() => berkasRef.current?.click()}
          className="inline-flex h-10 items-center gap-2 rounded-md border border-dashed border-border-strong bg-surface px-3.5 text-sm font-medium text-ink hover:border-primary-400 hover:bg-primary-50 disabled:opacity-50 pointer-coarse:h-11"
        >
          <Paperclip aria-hidden className="size-4 text-primary-600" />
          Pilih berkas
        </button>
        {proses ? (
          <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-muted">
            <Loader2 aria-hidden className="size-4 animate-spin" /> Mengecilkan foto…
          </span>
        ) : null}
      </div>
      {hint ? <p className="mt-1.5 text-[13px] text-ink-muted">{hint}</p> : null}
    </div>
  );
}
