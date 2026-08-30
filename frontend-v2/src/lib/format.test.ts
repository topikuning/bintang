/**
 * Audit 2026-06-13 #M-03 -- test pertama di frontend.
 *
 * Prioritasnya helper uang & tanggal: 38k baris frontend punya logika
 * finansial nyata, dan typecheck hanya memeriksa bentuk data, bukan
 * aritmetika atau pembulatan. Berkas ini yang paling banyak dipakai
 * (tiap tabel, kartu ringkasan, dan PDF preview memanggilnya), jadi
 * nilai per baris test-nya paling tinggi.
 */
import { describe, expect, it } from "vitest"

import { fmtCompact, fmtDate, fmtIDR, fmtPct, toApiDate } from "./format"

// Helper kecil: fmtIDR memakai NBSP (U+00A0), bukan spasi biasa.
const nb = (s: string) => s.replace(/\u00A0/g, " ")

describe("fmtIDR", () => {
  it("memakai titik sebagai pemisah ribuan (locale id-ID)", () => {
    expect(nb(fmtIDR(1_500_000))).toBe("Rp 1.500.000")
  })

  it("membulatkan ke rupiah penuh secara default", () => {
    expect(nb(fmtIDR(1234.56))).toBe("Rp 1.235")
  })

  it("menghormati jumlah desimal yang diminta", () => {
    expect(nb(fmtIDR(1234.5, { decimal: 2 }))).toBe("Rp 1.234,50")
  })

  it("memakai en-dash untuk nilai negatif, bukan hyphen", () => {
    expect(nb(fmtIDR(-2000))).toBe("–Rp 2.000")
  })

  it("mendukung format kurung untuk laporan akuntansi", () => {
    expect(nb(fmtIDR(-2000, { sign: "parens" }))).toBe("(Rp 2.000)")
  })

  it("menambahkan tanda plus hanya bila diminta dan nilainya positif", () => {
    expect(nb(fmtIDR(2000, { sign: "always" }))).toBe("+Rp 2.000")
    expect(nb(fmtIDR(0, { sign: "always" }))).toBe("Rp 0")
  })

  it("menerima string angka dari API (Decimal dikirim sbg string)", () => {
    expect(nb(fmtIDR("2500000"))).toBe("Rp 2.500.000")
  })

  it("tidak pernah menampilkan NaN untuk input rusak", () => {
    expect(nb(fmtIDR(null))).toBe("Rp 0")
    expect(nb(fmtIDR(undefined))).toBe("Rp 0")
    expect(nb(fmtIDR("bukan angka"))).toBe("Rp 0")
    expect(nb(fmtIDR(Number.POSITIVE_INFINITY))).toBe("Rp 0")
  })
})

describe("fmtCompact", () => {
  it("memakai satuan miliar dengan dua desimal", () => {
    expect(nb(fmtCompact(1_250_000_000))).toBe("Rp 1,25 M")
  })

  it("memakai satuan juta dengan satu desimal", () => {
    expect(nb(fmtCompact(25_300_000))).toBe("Rp 25,3 jt")
  })

  it("memakai satuan ribu tanpa desimal", () => {
    expect(nb(fmtCompact(500_000))).toBe("Rp 500rb")
  })

  it("jatuh ke format penuh di bawah seribu", () => {
    expect(nb(fmtCompact(750))).toBe("Rp 750")
  })

  it("mempertahankan tanda negatif di tiap satuan", () => {
    expect(nb(fmtCompact(-25_300_000))).toBe("–Rp 25,3 jt")
  })

  it("memakai koma desimal, bukan titik", () => {
    // Regresi: `toFixed()` menghasilkan titik; kalau replace-nya hilang,
    // angka jadi terbaca sbg ribuan di locale Indonesia.
    expect(nb(fmtCompact(1_500_000_000))).not.toContain(".")
  })
})

describe("fmtPct", () => {
  it("mengubah rasio jadi persen dengan koma desimal", () => {
    expect(fmtPct(0.155)).toBe("15,5%")
  })

  it("menghormati jumlah desimal", () => {
    expect(fmtPct(0.1234, 2)).toBe("12,34%")
  })

  it("aman untuk nilai kosong", () => {
    expect(fmtPct(null)).toBe("0%")
    expect(fmtPct(undefined)).toBe("0%")
  })
})

describe("fmtDate", () => {
  it("memakai nama bulan Indonesia yang disingkat", () => {
    expect(fmtDate(new Date(2026, 4, 17))).toBe("17 Mei 2026")
  })

  it("mendukung nama bulan penuh", () => {
    expect(fmtDate(new Date(2026, 7, 1), { fullMonth: true })).toBe(
      "01 Agustus 2026",
    )
  })

  it("memberi tanda hubung untuk tanggal kosong atau rusak", () => {
    expect(fmtDate(null)).toBe("-")
    expect(fmtDate("bukan tanggal")).toBe("-")
  })
})

describe("toApiDate", () => {
  it("memakai tanggal LOKAL, bukan UTC", () => {
    // Regresi penting: `toISOString()` akan menggeser tanggal ke hari
    // sebelumnya untuk zona waktu Indonesia (UTC+7/+8) pada jam-jam
    // awal hari -- transaksi bisa tercatat di tanggal yang salah.
    const local = new Date(2026, 0, 1, 0, 30) // 1 Jan 2026, 00:30 lokal
    expect(toApiDate(local)).toBe("2026-01-01")
  })

  it("memberi padding nol pada bulan dan tanggal satu digit", () => {
    expect(toApiDate(new Date(2026, 2, 5))).toBe("2026-03-05")
  })

  it("mengembalikan null untuk input kosong atau rusak", () => {
    expect(toApiDate(null)).toBeNull()
    expect(toApiDate("bukan tanggal")).toBeNull()
  })
})
