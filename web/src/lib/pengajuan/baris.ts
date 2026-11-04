import { kaliHarga, parseRupiah } from "@/lib/uang";

/**
 * Baris rincian di form (murni – dipakai klien dan server). Server tetap
 * menghitung ulang jumlahnya lewat `itemSchema`; ini hanya untuk tampilan.
 */
export type Baris = {
  key: string;
  description: string;
  categoryId: string;
  amount: string;
  rinci: boolean;
  quantity: string;
  unit: string;
  unitPrice: string;
};

export function barisBaru(seed: Partial<Baris> = {}): Baris {
  return {
    key: Math.random().toString(36).slice(2),
    description: "",
    categoryId: "",
    amount: "",
    rinci: false,
    quantity: "",
    unit: "",
    unitPrice: "",
    ...seed,
  };
}

/** Jumlah satu baris (BigInt) – qty × harga bila dirinci, kalau tidak isian jumlah. */
export function jumlahBaris(b: Baris): bigint {
  if (b.rinci) {
    const harga = parseRupiah(b.unitPrice);
    const q = b.quantity.replace(",", ".").trim();
    if (harga === null || !/^\d+(\.\d{1,3})?$/.test(q)) return 0n;
    return kaliHarga(q, harga);
  }
  return parseRupiah(b.amount) ?? 0n;
}

/** Bentuk JSON yang dikirim ke server (server tetap menghitung ulang). */
export function barisKeJson(rows: Baris[]) {
  return JSON.stringify(
    rows
      .filter((r) => r.description.trim() || jumlahBaris(r) > 0n)
      .map((r) =>
        r.rinci
          ? {
              description: r.description,
              categoryId: r.categoryId,
              quantity: r.quantity.replace(",", "."),
              unit: r.unit,
              unitPrice: r.unitPrice,
            }
          : { description: r.description, categoryId: r.categoryId, amount: r.amount },
      ),
  );
}

