import { describe, expect, it } from "vitest";
import { formatIsian, kaliHarga, parseRupiah, rupiah, rupiahRingkas, terbilang } from "@/lib/uang";

describe("parseRupiah", () => {
  it("menerima format lazim", () => {
    expect(parseRupiah("1.250.000")).toBe(1_250_000n);
    expect(parseRupiah("Rp 1.250.000")).toBe(1_250_000n);
    expect(parseRupiah("1250000")).toBe(1_250_000n);
    expect(parseRupiah("1,250,000")).toBe(1_250_000n);
  });
  it("menolak desimal, negatif, dan sampah", () => {
    expect(parseRupiah("1.250,50")).toBeNull();
    expect(parseRupiah("-5000")).toBeNull();
    expect(parseRupiah("12a")).toBeNull();
    expect(parseRupiah("1.25.000")).toBeNull();
    expect(parseRupiah("")).toBeNull();
    expect(parseRupiah("9999999999999999")).toBeNull();
  });
});

describe("format", () => {
  it("rupiah memakai titik ribuan dan tanda minus", () => {
    expect(rupiah(1_250_000n)).toBe("Rp 1.250.000");
    expect(rupiah(-5_000n)).toBe("−Rp 5.000");
  });
  it("ringkas untuk KPI", () => {
    expect(rupiahRingkas(2_021_710_000n)).toBe("Rp 2,02 M");
    expect(rupiahRingkas(159_780_000n)).toBe("Rp 159,78 jt");
    expect(rupiahRingkas(750_000n)).toBe("Rp 750.000");
  });
  it("formatIsian membuang non-digit dan nol di depan", () => {
    expect(formatIsian("001250000")).toBe("1.250.000");
    expect(formatIsian("Rp abc")).toBe("");
  });
});

describe("kaliHarga", () => {
  it("menghitung qty desimal tanpa galat float", () => {
    expect(kaliHarga("165", 900_000n)).toBe(148_500_000n);
    expect(kaliHarga("2.5", 33_333n)).toBe(83_333n); // 83.332,5 → dibulatkan ke atas
    expect(kaliHarga("0.1", 3n)).toBe(0n);
  });
  it("menolak kuantitas tidak valid", () => {
    expect(() => kaliHarga("1,5", 1000n)).toThrow();
    expect(() => kaliHarga("1.2345", 1000n)).toThrow();
  });
});

describe("terbilang", () => {
  it("bentuk baku Indonesia", () => {
    expect(terbilang(0n)).toBe("nol rupiah");
    expect(terbilang(1_000n)).toBe("seribu rupiah");
    expect(terbilang(11_000n)).toBe("sebelas ribu rupiah");
    expect(terbilang(115n)).toBe("seratus lima belas rupiah");
    expect(terbilang(1_250_000n)).toBe("satu juta dua ratus lima puluh ribu rupiah");
    expect(terbilang(148_500_000n)).toBe("seratus empat puluh delapan juta lima ratus ribu rupiah");
    expect(terbilang(2_000_000_001n)).toBe("dua miliar satu rupiah");
  });
});
