import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";

/**
 * Penyimpanan berkas lampiran – SATU PINTU (konsep MARLIN: baca, tulis, hapus
 * hanya lewat modul ini). Sekarang disk lokal (volume Railway di /data);
 * kalau nanti pindah ke R2/S3, cukup modul ini yang berubah.
 */

export const MIME_DIIZINKAN: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
};

export class BerkasError extends Error {}

function akar(): string {
  return path.resolve(env.UPLOAD_DIR);
}

/** Kunci → path absolut, dengan pagar path traversal. */
function jalur(kunci: string): string {
  if (!/^[a-z0-9/_-]+\.[a-z0-9]+$/i.test(kunci) || kunci.includes("..")) {
    throw new BerkasError("Kunci berkas tidak valid.");
  }
  const p = path.resolve(akar(), kunci);
  if (!p.startsWith(akar() + path.sep)) throw new BerkasError("Kunci berkas tidak valid.");
  return p;
}

/** Cek tanda tangan biner, bukan sekadar percaya MIME dari peramban. */
function cocokTandaTangan(buf: Buffer, mime: string): boolean {
  const h = buf.subarray(0, 12);
  switch (mime) {
    case "image/jpeg":
      return h[0] === 0xff && h[1] === 0xd8;
    case "image/png":
      return h.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    case "image/webp":
      return h.subarray(0, 4).toString("ascii") === "RIFF" && h.subarray(8, 12).toString("ascii") === "WEBP";
    case "application/pdf":
      return h.subarray(0, 4).toString("ascii") === "%PDF";
    case "image/heic":
    case "image/heif":
      return h.subarray(4, 8).toString("ascii") === "ftyp";
    default:
      return false;
  }
}

export type BerkasTersimpan = { storageKey: string; fileName: string; mimeType: string; size: number };

export async function simpanBerkas(file: File, folder: string): Promise<BerkasTersimpan> {
  const mime = file.type || "application/octet-stream";
  const ext = MIME_DIIZINKAN[mime];
  if (!ext) throw new BerkasError(`"${file.name}" bukan foto atau PDF.`);
  const maks = env.MAX_UPLOAD_MB * 1024 * 1024;
  if (file.size > maks) throw new BerkasError(`"${file.name}" lebih dari ${env.MAX_UPLOAD_MB} MB.`);
  if (file.size === 0) throw new BerkasError(`"${file.name}" kosong.`);
  const buf = Buffer.from(await file.arrayBuffer());
  if (!cocokTandaTangan(buf, mime)) throw new BerkasError(`Isi "${file.name}" tidak sesuai jenisnya.`);

  const now = new Date();
  const kunci = `${folder}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${ext}`;
  const p = jalur(kunci);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, buf, { flag: "wx" });
  const nama = file.name.replace(/[\\/\0]/g, "_").slice(0, 200) || `berkas.${ext}`;
  return { storageKey: kunci, fileName: nama, mimeType: mime, size: buf.length };
}

export async function ambilBerkas(kunci: string): Promise<Buffer> {
  return readFile(jalur(kunci));
}

export async function hapusBerkas(kunci: string): Promise<void> {
  await rm(jalur(kunci), { force: true });
}

/** Ambil File[] dari FormData, abaikan entri kosong (input file tanpa pilihan). */
export function berkasDariForm(form: FormData, nama: string): File[] {
  return form
    .getAll(nama)
    .filter((v): v is File => typeof v === "object" && v !== null && "size" in v && (v as File).size > 0);
}
