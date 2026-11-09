import { z } from "zod";
import { kaliHarga, parseRupiah } from "@/lib/uang";

/**
 * Validasi isian pengajuan. Rincian dikirim klien sebagai JSON di satu kolom
 * tersembunyi (`items`), lalu DIHITUNG ULANG di sini – jumlah dari klien hanya
 * dipercaya bila tidak ada qty × harga.
 */

const uuid = z.string().uuid("Pilihan tidak valid.");
const teksOpsional = (maks: number) =>
  z
    .string()
    .trim()
    .max(maks, `Maksimal ${maks} karakter.`)
    .optional()
    .transform((v) => (v ? v : undefined));

const rupiahWajib = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const n = parseRupiah(String(v));
  if (n === null || n <= 0n) {
    ctx.addIssue({ code: "custom", message: "Isi jumlah lebih dari 0." });
    return z.NEVER;
  }
  return n;
});

export const itemSchema = z
  .object({
    categoryId: uuid.optional().or(z.literal("").transform(() => undefined)),
    description: z.string().trim().min(1, "Isi uraian.").max(300, "Uraian maksimal 300 karakter."),
    quantity: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v.replace(",", ".") : undefined))
      .refine((v) => v === undefined || /^\d+(\.\d{1,3})?$/.test(v), "Kuantitas tidak valid."),
    unit: teksOpsional(20),
    unitPrice: z
      .union([z.string(), z.number()])
      .optional()
      .transform((v) => (v === undefined || v === "" ? undefined : parseRupiah(String(v)) ?? undefined)),
    amount: z.union([z.string(), z.number()]).optional(),
  })
  .transform((it, ctx) => {
    let amount: bigint | null;
    if (it.quantity && it.unitPrice !== undefined) {
      amount = kaliHarga(it.quantity, it.unitPrice);
    } else {
      amount = it.amount === undefined ? null : parseRupiah(String(it.amount));
    }
    if (amount === null || amount <= 0n) {
      ctx.addIssue({ code: "custom", message: "Isi jumlah lebih dari 0.", path: ["amount"] });
      return z.NEVER;
    }
    return {
      categoryId: it.categoryId,
      description: it.description,
      quantity: it.quantity && it.unitPrice !== undefined ? it.quantity : undefined,
      unit: it.unit,
      unitPrice: it.quantity && it.unitPrice !== undefined ? it.unitPrice : undefined,
      amount,
    };
  });

export type ItemInput = z.output<typeof itemSchema>;

const itemsJson = z.string().transform((s, ctx) => {
  try {
    const v = JSON.parse(s);
    if (!Array.isArray(v)) throw new Error();
    return v as unknown[];
  } catch {
    ctx.addIssue({ code: "custom", message: "Rincian tidak terbaca." });
    return z.NEVER;
  }
});

export const pengajuanSchema = z.object({
  projectId: uuid,
  kind: z.enum(["pembayaran", "uang_muka", "penggantian"], { message: "Pilih jenis pengajuan." }),
  title: z.string().trim().min(3, "Tulis keperluannya (minimal 3 huruf).").max(200, "Maksimal 200 karakter."),
  description: teksOpsional(2000),
  urgent: z
    .union([z.literal("on"), z.literal("1"), z.literal("true"), z.literal(""), z.undefined(), z.null()])
    .transform((v) => v === "on" || v === "1" || v === "true"),
  neededDate: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => v === undefined || /^\d{4}-\d{2}-\d{2}$/.test(v), "Tanggal tidak valid."),
  partyId: uuid.optional().or(z.literal("").transform(() => undefined)),
  payeeName: teksOpsional(200),
  bankName: teksOpsional(80),
  bankAccount: teksOpsional(40),
  bankHolder: teksOpsional(200),
  items: itemsJson.pipe(
    z.array(itemSchema).min(1, "Tambahkan minimal satu rincian.").max(100, "Maksimal 100 rincian."),
  ),
});

export type PengajuanInput = z.output<typeof pengajuanSchema>;

export function bacaPengajuanForm(form: FormData) {
  const get = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : undefined;
  };
  return pengajuanSchema.parse({
    projectId: get("projectId"),
    kind: get("kind"),
    title: get("title") ?? "",
    description: get("description"),
    urgent: get("urgent") ?? undefined,
    neededDate: get("neededDate"),
    partyId: get("partyId"),
    payeeName: get("payeeName"),
    bankName: get("bankName"),
    bankAccount: get("bankAccount"),
    bankHolder: get("bankHolder"),
    items: get("items") ?? "[]",
  });
}

export const bayarSchema = z.object({
  paidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Isi tanggal bayar."),
  accountId: uuid.or(z.literal("").transform(() => undefined)).optional(),
  method: z.enum(["transfer", "tunai", "qris", "giro", "lainnya"], { message: "Pilih cara bayar." }),
  reference: teksOpsional(120),
  note: teksOpsional(1000),
});

export type BayarInput = z.output<typeof bayarSchema>;

export const realisasiSchema = z
  .array(
    z.object({
      categoryId: uuid.optional().or(z.literal("").transform(() => undefined)),
      description: z.string().trim().min(1, "Isi uraian.").max(300),
      amount: rupiahWajib,
    }),
  )
  // Boleh kosong: uang muka yang sama sekali tidak terpakai dikembalikan utuh
  // (service mewajibkan catatan untuk kasus itu).
  .max(100);

export const catatanWajib = z.string().trim().min(3, "Tulis alasannya supaya pemohon tahu apa yang harus diperbaiki.").max(1000);
