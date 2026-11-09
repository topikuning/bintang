import "server-only";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { z } from "zod";
import { ForbiddenError, PesanError } from "@/lib/galat";
import { TransitionError } from "@/lib/lifecycle";
import { BerkasError } from "@/lib/penyimpanan";

export { PesanError };

/**
 * Bentuk hasil server action untuk `useActionState`.
 * `ok` = pesan sukses (Banner hijau), `error` = pesan untuk manusia,
 * `fields` = galat per kolom (ditempel di bawah kolomnya).
 */
export type ActionState = {
  ok?: string;
  error?: string;
  fields?: Record<string, string>;
  /** Penanda unik per hasil – supaya klien bisa bereaksi walau pesannya sama. */
  at?: number;
} | undefined;

export function gagal(error: string, fields?: Record<string, string>): ActionState {
  return { error, fields, at: Date.now() };
}

export function sukses(ok: string): ActionState {
  return { ok, at: Date.now() };
}

export function zodKeFields(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/**
 * Bungkus server action: galat yang dikenal → pesan ramah; galat tak dikenal
 * → pesan umum + log server (detail teknis tidak bocor ke layar).
 * `redirect()` dilempar ulang supaya navigasinya tetap berjalan.
 */
export async function jalankan(fn: () => Promise<ActionState>): Promise<ActionState> {
  try {
    return await fn();
  } catch (err) {
    if (isRedirectError(err)) throw err;
    if (err instanceof z.ZodError) {
      const fields = zodKeFields(err);
      return gagal(Object.values(fields)[0] ?? "Isian belum lengkap.", fields);
    }
    if (err instanceof ForbiddenError || err instanceof TransitionError || err instanceof BerkasError || err instanceof PesanError) {
      return gagal(err.message);
    }
    console.error("[aksi] galat tak terduga:", err);
    return gagal("Maaf, ada yang tidak beres di server. Coba lagi sebentar lagi.");
  }
}
