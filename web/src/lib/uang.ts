/**
 * Uang = BigInt rupiah utuh (tanpa sen). Rupiah praktis tidak memakai sen, dan
 * BigInt membuat penjumlahan bebas galat pembulatan float.
 *
 * Modul ini MURNI (tanpa DB) supaya bisa dipakai di klien dan diuji.
 */

const RIBUAN = new Intl.NumberFormat("id-ID");

/** 1250000n → "Rp 1.250.000" ; -5000n → "−Rp 5.000". */
export function rupiah(nilai: bigint | number | string | null | undefined): string {
  if (nilai === null || nilai === undefined || nilai === "") return "Rp 0";
  const n = typeof nilai === "bigint" ? nilai : BigInt(Math.trunc(Number(nilai)));
  const neg = n < 0n;
  const abs = neg ? -n : n;
  return `${neg ? "−" : ""}Rp ${RIBUAN.format(abs)}`;
}

/** Tanpa "Rp" – untuk kolom angka yang judul kolomnya sudah menyebut Rp. */
export function angka(nilai: bigint | number | string | null | undefined): string {
  if (nilai === null || nilai === undefined || nilai === "") return "0";
  const n = typeof nilai === "bigint" ? nilai : BigInt(Math.trunc(Number(nilai)));
  const neg = n < 0n;
  return `${neg ? "−" : ""}${RIBUAN.format(neg ? -n : n)}`;
}

/**
 * Ringkas untuk kartu KPI di ponsel: 1.250.000.000 → "Rp 1,25 M".
 * Di bawah sejuta ditulis utuh – "Rp 750 rb" justru lebih sulit dibaca.
 */
export function rupiahRingkas(nilai: bigint | number | string): string {
  const n = typeof nilai === "bigint" ? nilai : BigInt(Math.trunc(Number(nilai)));
  const neg = n < 0n;
  const abs = Number(neg ? -n : n);
  const tanda = neg ? "−" : "";
  const fmt = (v: number) => v.toLocaleString("id-ID", { maximumFractionDigits: 2 });
  if (abs >= 1e12) return `${tanda}Rp ${fmt(abs / 1e12)} T`;
  if (abs >= 1e9) return `${tanda}Rp ${fmt(abs / 1e9)} M`;
  if (abs >= 1e6) return `${tanda}Rp ${fmt(abs / 1e6)} jt`;
  return `${tanda}Rp ${RIBUAN.format(abs)}`;
}

/**
 * Baca isian rupiah dari pengguna: "1.250.000", "Rp1.250.000", "1250000",
 * "1,250,000". Desimal TIDAK diterima (",50" di akhir dianggap salah ketik,
 * bukan sen) – mengembalikan null bila bukan angka bulat non-negatif.
 */
export function parseRupiah(input: string | null | undefined): bigint | null {
  if (input === null || input === undefined) return null;
  const bersih = String(input).replace(/rp/gi, "").replace(/\s/g, "");
  if (bersih === "") return null;
  if (!/^\d{1,3}([.,]\d{3})*$|^\d+$/.test(bersih)) return null;
  const digit = bersih.replace(/[.,]/g, "");
  if (digit.length > 15) return null; // > 999 triliun = pasti salah ketik
  return BigInt(digit);
}

/** Format saat mengetik: "1250000" → "1.250.000". */
export function formatIsian(input: string): string {
  const digit = input.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (digit === "") return "";
  return RIBUAN.format(BigInt(digit.slice(0, 15)));
}

/** quantity × harga satuan, dibulatkan ke rupiah terdekat (setengah ke atas). */
export function kaliHarga(quantity: string | number, hargaSatuan: bigint): bigint {
  const q = typeof quantity === "number" ? quantity.toString() : quantity.trim();
  if (!/^\d+(\.\d{1,3})?$/.test(q)) throw new Error("Kuantitas tidak valid");
  const [bulat, pecahan = ""] = q.split(".");
  const skala = 1000n;
  const qMilli = BigInt(bulat) * skala + BigInt((pecahan + "000").slice(0, 3));
  return (qMilli * hargaSatuan + skala / 2n) / skala;
}

export function jumlahkan(nilai: Iterable<bigint>): bigint {
  let total = 0n;
  for (const v of nilai) total += v;
  return total;
}

/** Persen a dari b, 1 desimal; null bila b = 0. */
export function persen(a: bigint, b: bigint): number | null {
  if (b === 0n) return null;
  return Number((a * 1000n) / b) / 10;
}

const SATUAN = ["", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"];

function terbilangKecil(n: number): string {
  if (n < 12) return SATUAN[n];
  if (n < 20) return `${SATUAN[n - 10]} belas`;
  if (n < 100) return `${SATUAN[Math.floor(n / 10)]} puluh ${SATUAN[n % 10]}`.trim();
  if (n < 200) return `seratus ${terbilangKecil(n - 100)}`.trim();
  return `${SATUAN[Math.floor(n / 100)]} ratus ${terbilangKecil(n % 100)}`.trim();
}

/**
 * Terbilang rupiah untuk kuitansi/voucher: 1250000n → "satu juta dua ratus
 * lima puluh ribu rupiah". Kelompok ribuan: ribu, juta, miliar, triliun.
 */
export function terbilang(nilai: bigint): string {
  if (nilai === 0n) return "nol rupiah";
  const neg = nilai < 0n;
  let n = neg ? -nilai : nilai;
  const nama = ["", "ribu", "juta", "miliar", "triliun"];
  const bagian: string[] = [];
  let i = 0;
  while (n > 0n) {
    const k = Number(n % 1000n);
    if (k > 0) {
      const kata = i === 1 && k === 1 ? "seribu" : `${terbilangKecil(k)} ${nama[i]}`.trim();
      bagian.unshift(kata);
    }
    n /= 1000n;
    i++;
    if (i >= nama.length && n > 0n) throw new Error("Nilai terlalu besar untuk terbilang");
  }
  return `${neg ? "minus " : ""}${bagian.join(" ")} rupiah`.replace(/\s+/g, " ");
}
