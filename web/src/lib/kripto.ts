import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Penyandian nomor rekening (AES-256-GCM). Bintang lama menyandikan nomor
 * rekening di database; versi ini mempertahankannya.
 *
 * Bentuk tersimpan: "enc:v1:<iv>:<tag>:<ciphertext>" (base64url).
 * Nilai TANPA awalan dianggap polos – supaya `KUNCI_DATA` bisa diaktifkan
 * belakangan tanpa migrasi, dan data lama tetap terbaca.
 */
const AWALAN = "enc:v1:";

function kunci(): Buffer | null {
  if (!env.KUNCI_DATA) return null;
  return createHash("sha256").update(`bintang-data:${env.KUNCI_DATA}`).digest();
}

export function sandikan(polos: string | null | undefined): string | null {
  if (polos === null || polos === undefined) return null;
  const v = polos.trim();
  if (v === "") return null;
  const k = kunci();
  if (!k) return v;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([cipher.update(v, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${AWALAN}${iv.toString("base64url")}:${tag.toString("base64url")}:${ct.toString("base64url")}`;
}

export function bukaSandi(tersimpan: string | null | undefined): string | null {
  if (!tersimpan) return null;
  if (!tersimpan.startsWith(AWALAN)) return tersimpan;
  const k = kunci();
  if (!k) return "•••• (kunci data tidak tersedia)";
  try {
    const [ivB, tagB, ctB] = tersimpan.slice(AWALAN.length).split(":");
    const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(ivB, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ctB, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return "•••• (gagal dibuka)";
  }
}

/** "1234567890" → "•••• 7890" untuk daftar; detail menampilkan utuh. */
export function samarkan(nomor: string | null | undefined): string | null {
  if (!nomor) return null;
  const digit = nomor.replace(/\s/g, "");
  return digit.length <= 4 ? digit : `•••• ${digit.slice(-4)}`;
}
