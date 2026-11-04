import type { TransactionKind } from "@/generated/prisma/enums";

/**
 * CALCULATION LAYER KANONIK – satu-satunya tempat rumus angka keuangan.
 * Komponen, laporan, dan ekspor Excel DILARANG menghitung ulang; mereka
 * memanggil fungsi di sini (konsep MARLIN, PROJECT.md §3).
 *
 * Modul ini MURNI: input baris, output angka. Kueri DB ada di `queries.ts`.
 *
 * Definisi (hanya transaksi TERVERIFIKASI yang dihitung):
 *   kasMasuk          = pemasukan + pengembalian_uang_muka
 *   kasKeluar         = pengeluaran + uang_muka
 *   saldo             = kasMasuk − kasKeluar
 *   pendapatan        = pemasukan
 *   biaya             = pengeluaran + realisasi_uang_muka
 *   uangMukaBerjalan  = uang_muka − pengembalian_uang_muka − realisasi_uang_muka
 *   terpakai          = biaya + uangMukaBerjalan   (= kasKeluar − pengembalian)
 *
 * `terpakai` adalah yang dibandingkan dengan anggaran: uang muka yang masih
 * dipegang orang sudah keluar dari kas, jadi sudah memakan anggaran walau
 * belum jelas dipakai untuk apa.
 */

export type JumlahPerJenis = Partial<Record<TransactionKind, bigint>>;

export type RingkasanKas = {
  kasMasuk: bigint;
  kasKeluar: bigint;
  saldo: bigint;
  pendapatan: bigint;
  biaya: bigint;
  uangMukaBerjalan: bigint;
  terpakai: bigint;
};

export function ringkasKas(j: JumlahPerJenis): RingkasanKas {
  const v = (k: TransactionKind) => j[k] ?? 0n;
  const kasMasuk = v("pemasukan") + v("pengembalian_uang_muka");
  const kasKeluar = v("pengeluaran") + v("uang_muka");
  const biaya = v("pengeluaran") + v("realisasi_uang_muka");
  const uangMukaBerjalan = v("uang_muka") - v("pengembalian_uang_muka") - v("realisasi_uang_muka");
  return {
    kasMasuk,
    kasKeluar,
    saldo: kasMasuk - kasKeluar,
    pendapatan: v("pemasukan"),
    biaya,
    uangMukaBerjalan,
    terpakai: biaya + uangMukaBerjalan,
  };
}

/** Gabungkan baris {kind, amount} jadi JumlahPerJenis. */
export function kelompokkan(baris: Iterable<{ kind: TransactionKind; amount: bigint | null }>): JumlahPerJenis {
  const out: JumlahPerJenis = {};
  for (const b of baris) out[b.kind] = (out[b.kind] ?? 0n) + (b.amount ?? 0n);
  return out;
}

export type StatusAnggaran = "tanpa_anggaran" | "aman" | "waspada" | "lewat";

/** Ambang: ≥ 80% waspada, > 100% lewat anggaran. */
export function statusAnggaran(terpakai: bigint, anggaran: bigint): {
  status: StatusAnggaran;
  persen: number | null;
  sisa: bigint;
} {
  if (anggaran <= 0n) return { status: "tanpa_anggaran", persen: null, sisa: 0n };
  const persen = Number((terpakai * 1000n) / anggaran) / 10;
  const sisa = anggaran - terpakai;
  if (terpakai > anggaran) return { status: "lewat", persen, sisa };
  if (persen >= 80) return { status: "waspada", persen, sisa };
  return { status: "aman", persen, sisa };
}

export const STATUS_ANGGARAN_LABEL: Record<StatusAnggaran, string> = {
  tanpa_anggaran: "Belum ada anggaran",
  aman: "Aman",
  waspada: "Mendekati batas",
  lewat: "Lewat anggaran",
};

/**
 * Selisih LPJ uang muka.
 *   dibayar − realisasi > 0 → sisa harus DIKEMBALIKAN ke kas
 *   dibayar − realisasi < 0 → kantor KURANG BAYAR, perlu dibayar ke pemegang
 */
export function selisihLpj(dibayar: bigint, realisasi: bigint): {
  arah: "pas" | "kembali" | "kurang";
  jumlah: bigint;
} {
  const d = dibayar - realisasi;
  if (d === 0n) return { arah: "pas", jumlah: 0n };
  return d > 0n ? { arah: "kembali", jumlah: d } : { arah: "kurang", jumlah: -d };
}
