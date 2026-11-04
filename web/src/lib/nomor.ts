import "server-only";
import type { Tx } from "@/lib/db";
import { hariIniKey } from "@/lib/tanggal";

/**
 * Nomor dokumen berurutan: PGJ/2026/11/0001, TRX/2026/11/0001.
 *
 * Bintang lama memakai `COUNT(*) + 1` – dua pengajuan yang dikirim bersamaan
 * mendapat nomor sama. Di sini penghitungnya dinaikkan dengan UPSERT atomik di
 * DALAM transaksi dokumennya: kunci baris dipegang sampai transaksi selesai,
 * jadi pemanggil kedua menunggu, bukan menyalip.
 */
export async function nomorBerikutnya(tx: Tx, awalan: "PGJ" | "TRX", tanggalKey = hariIniKey()): Promise<string> {
  const [y, m] = tanggalKey.split("-");
  const key = `${awalan}/${y}/${m}`;
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "counters" ("key", "value") VALUES (${key}, 1)
    ON CONFLICT ("key") DO UPDATE SET "value" = "counters"."value" + 1
    RETURNING "value"`;
  return `${key}/${String(rows[0].value).padStart(4, "0")}`;
}
