import { describe, expect, it } from "vitest";
import { kelompokkan, ringkasKas, selisihLpj, statusAnggaran } from "@/lib/keuangan/hitung";

describe("ringkasKas – calculation layer kanonik", () => {
  it("uang muka mengurangi kas tapi belum biaya; realisasi mengakui biaya tanpa menggerakkan kas", () => {
    // Uang muka 4 jt, terpakai 3,09 jt, sisa 910 rb dikembalikan.
    const r = ringkasKas(
      kelompokkan([
        { kind: "pemasukan", amount: 84_000_000n },
        { kind: "uang_muka", amount: 4_000_000n },
        { kind: "realisasi_uang_muka", amount: 3_090_000n },
        { kind: "pengembalian_uang_muka", amount: 910_000n },
      ]),
    );
    expect(r.kasMasuk).toBe(84_910_000n);
    expect(r.kasKeluar).toBe(4_000_000n);
    expect(r.saldo).toBe(80_910_000n);
    expect(r.pendapatan).toBe(84_000_000n);
    expect(r.biaya).toBe(3_090_000n);
    expect(r.uangMukaBerjalan).toBe(0n);
    expect(r.terpakai).toBe(3_090_000n);
  });

  it("uang muka yang belum di-LPJ-kan sudah memakan anggaran", () => {
    const r = ringkasKas({ uang_muka: 5_000_000n, pengeluaran: 1_000_000n });
    expect(r.biaya).toBe(1_000_000n);
    expect(r.uangMukaBerjalan).toBe(5_000_000n);
    expect(r.terpakai).toBe(6_000_000n);
  });

  it("terpakai = kas keluar − pengembalian (identitas)", () => {
    const j = { pengeluaran: 7n, uang_muka: 11n, realisasi_uang_muka: 5n, pengembalian_uang_muka: 3n, pemasukan: 100n };
    const r = ringkasKas(j);
    expect(r.terpakai).toBe(r.kasKeluar - 3n);
  });
});

describe("statusAnggaran", () => {
  it("ambang aman / waspada / lewat", () => {
    expect(statusAnggaran(0n, 0n).status).toBe("tanpa_anggaran");
    expect(statusAnggaran(79n, 100n).status).toBe("aman");
    expect(statusAnggaran(80n, 100n).status).toBe("waspada");
    expect(statusAnggaran(100n, 100n).status).toBe("waspada");
    const lewat = statusAnggaran(125n, 100n);
    expect(lewat.status).toBe("lewat");
    expect(lewat.sisa).toBe(-25n);
    expect(lewat.persen).toBe(125);
  });
});

describe("selisihLpj", () => {
  it("arah selisih", () => {
    expect(selisihLpj(4_000_000n, 3_090_000n)).toEqual({ arah: "kembali", jumlah: 910_000n });
    expect(selisihLpj(1_000n, 1_500n)).toEqual({ arah: "kurang", jumlah: 500n });
    expect(selisihLpj(1_000n, 1_000n)).toEqual({ arah: "pas", jumlah: 0n });
  });
});
