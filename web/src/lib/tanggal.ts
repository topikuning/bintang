import { TZDate } from "@date-fns/tz";
import { format, formatDistanceToNowStrict } from "date-fns";
import { id as localeId } from "date-fns/locale";

/**
 * Semua logika "hari ini" memakai Asia/Jakarta. Kolom tanggal kerja (@db.Date)
 * tersimpan sebagai tengah malam UTC – JANGAN diformat dengan jam, karena
 * tengah malam UTC = 07:00 WIB dan itu bukan data.
 */
export const ZONA = "Asia/Jakarta";

/** "2026-11-04" menurut jam Jakarta. */
export function hariIniKey(sekarang: Date = new Date()): string {
  return format(new TZDate(sekarang, ZONA), "yyyy-MM-dd");
}

/** Kunci tanggal → Date tengah malam UTC (bentuk penyimpanan @db.Date). */
export function keyKeTanggal(key: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error("Format tanggal tidak valid");
  const d = new Date(`${key}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== key) {
    throw new Error("Tanggal tidak valid");
  }
  return d;
}

/** Date dari kolom @db.Date → "2026-11-04". */
export function tanggalKeKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Kolom @db.Date → "4 Nov 2026". */
export function fmtTanggal(d: Date | string | null | undefined, pola = "d MMM yyyy"): string {
  if (!d) return "–";
  const key = typeof d === "string" ? d.slice(0, 10) : tanggalKeKey(d);
  const [y, m, day] = key.split("-").map(Number);
  return format(new Date(y, m - 1, day), pola, { locale: localeId });
}

/** Timestamptz → "4 Nov 2026, 14.05" (WIB). */
export function fmtWaktu(d: Date | string | null | undefined): string {
  if (!d) return "–";
  return format(new TZDate(new Date(d), ZONA), "d MMM yyyy, HH.mm", { locale: localeId });
}

/** "3 jam lalu". */
export function relatif(d: Date | string): string {
  return formatDistanceToNowStrict(new Date(d), { addSuffix: true, locale: localeId });
}

/** Awal & akhir bulan (kunci tanggal) untuk tahun-bulan Jakarta. */
export function rentangBulan(key: string = hariIniKey()): { dari: string; sampai: string } {
  const [y, m] = key.split("-").map(Number);
  const akhir = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return { dari: `${y}-${mm}-01`, sampai: `${y}-${mm}-${String(akhir).padStart(2, "0")}` };
}

export function namaBulan(tahun: number, bulan: number, pola = "MMM yy"): string {
  return format(new Date(tahun, bulan - 1, 1), pola, { locale: localeId });
}

/** Selisih hari (b − a) antara dua kunci tanggal. */
export function selisihHari(a: string, b: string): number {
  return Math.round((keyKeTanggal(b).getTime() - keyKeTanggal(a).getTime()) / 86_400_000);
}
