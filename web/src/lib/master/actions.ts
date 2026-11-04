"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { jalankan, sukses, type ActionState } from "@/lib/aksi";
import { auditIn } from "@/lib/audit";
import { requireCapability } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { PesanError } from "@/lib/galat";
import { sandikan } from "@/lib/kripto";
import { parseRupiah } from "@/lib/uang";

const teks = (maks: number) => z.string().trim().max(maks).optional().transform((v) => v || null);
const aktif = z.union([z.literal("on"), z.literal("1"), z.literal(""), z.null(), z.undefined()]).transform((v) => v === "on" || v === "1");
const id = z.string().uuid().optional().or(z.literal("").transform(() => undefined));

function ambil(form: FormData, keys: string[]) {
  const o: Record<string, unknown> = {};
  for (const k of keys) {
    const v = form.get(k);
    o[k] = typeof v === "string" ? v : undefined;
  }
  return o;
}

function segarkan(path: string) {
  revalidatePath(path);
  revalidatePath("/master");
}

// ─── Perusahaan ──────────────────────────────────────────────

const perusahaan = z.object({
  id,
  name: z.string().trim().min(2, "Isi nama perusahaan.").max(200),
  address: teks(500),
  city: teks(100),
  npwp: teks(40),
  phone: teks(40),
  email: teks(120),
  isActive: aktif,
});

export async function simpanPerusahaan(_p: ActionState, form: FormData): Promise<ActionState> {
  return jalankan(async () => {
    const user = await requireCapability("master.manage");
    const { id: cid, ...d } = perusahaan.parse(ambil(form, ["id", "name", "address", "city", "npwp", "phone", "email", "isActive"]));
    await db.$transaction(async (tx) => {
      const c = cid ? await tx.company.update({ where: { id: cid }, data: d }) : await tx.company.create({ data: d });
      await auditIn(tx, user.id, cid ? "company.update" : "company.create", "company", c.id, d);
    });
    segarkan("/master/perusahaan");
    return sukses("Perusahaan tersimpan.");
  });
}

// ─── Kategori ────────────────────────────────────────────────

const kategori = z.object({
  id,
  name: z.string().trim().min(2, "Isi nama kategori.").max(120),
  direction: z.enum(["masuk", "keluar"], { message: "Pilih arah." }),
  description: teks(255),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  isActive: aktif,
});

export async function simpanKategori(_p: ActionState, form: FormData): Promise<ActionState> {
  return jalankan(async () => {
    const user = await requireCapability("master.manage");
    const { id: kid, ...d } = kategori.parse(ambil(form, ["id", "name", "direction", "description", "sortOrder", "isActive"]));
    const kembar = await db.category.findFirst({ where: { direction: d.direction, name: { equals: d.name, mode: "insensitive" }, ...(kid ? { id: { not: kid } } : {}) } });
    if (kembar) throw new PesanError(`Kategori "${d.name}" sudah ada.`);
    if (kid) {
      const lama = await db.category.findUniqueOrThrow({ where: { id: kid } });
      if (lama.direction !== d.direction) {
        const dipakai = await db.transactionItem.count({ where: { categoryId: kid } });
        if (dipakai) throw new PesanError("Arah kategori yang sudah dipakai transaksi tidak bisa diubah – buat kategori baru saja.");
      }
    }
    await db.$transaction(async (tx) => {
      const c = kid ? await tx.category.update({ where: { id: kid }, data: d }) : await tx.category.create({ data: d });
      await auditIn(tx, user.id, kid ? "category.update" : "category.create", "category", c.id, d);
    });
    segarkan("/master/kategori");
    return sukses("Kategori tersimpan.");
  });
}

// ─── Pihak (vendor / penerima) ───────────────────────────────

const pihak = z.object({
  id,
  name: z.string().trim().min(2, "Isi nama.").max(200),
  kind: z.enum(["vendor", "klien", "karyawan", "lainnya"]),
  phone: teks(40),
  email: teks(120),
  address: teks(500),
  npwp: teks(40),
  bankName: teks(80),
  bankAccount: teks(40),
  bankHolder: teks(200),
  isActive: aktif,
});

export async function simpanPihak(_p: ActionState, form: FormData): Promise<ActionState> {
  return jalankan(async () => {
    const user = await requireCapability("master.manage");
    const { id: pid, bankAccount, ...d } = pihak.parse(
      ambil(form, ["id", "name", "kind", "phone", "email", "address", "npwp", "bankName", "bankAccount", "bankHolder", "isActive"]),
    );
    const data = { ...d, bankAccount: sandikan(bankAccount) };
    await db.$transaction(async (tx) => {
      const p = pid ? await tx.party.update({ where: { id: pid }, data }) : await tx.party.create({ data });
      // Nomor rekening tidak ikut ditulis polos ke jejak audit.
      await auditIn(tx, user.id, pid ? "party.update" : "party.create", "party", p.id, { ...d, bankAccount: bankAccount ? "(diubah)" : null });
    });
    segarkan("/master/pihak");
    return sukses("Penerima tersimpan.");
  });
}

// ─── Rekening ────────────────────────────────────────────────

const rekening = z.object({
  id,
  name: z.string().trim().min(2, "Isi nama rekening.").max(120),
  kind: z.enum(["kas", "bank"]),
  companyId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  bankName: teks(80),
  accountNumber: teks(40),
  openingBalance: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v) return 0n;
      const neg = v.trim().startsWith("-");
      const n = parseRupiah(v.replace("-", ""));
      if (n === null) {
        ctx.addIssue({ code: "custom", message: "Saldo awal tidak valid." });
        return z.NEVER;
      }
      return neg ? -n : n;
    }),
  isActive: aktif,
});

export async function simpanRekening(_p: ActionState, form: FormData): Promise<ActionState> {
  return jalankan(async () => {
    const user = await requireCapability("master.manage");
    const { id: rid, companyId, ...d } = rekening.parse(
      ambil(form, ["id", "name", "kind", "companyId", "bankName", "accountNumber", "openingBalance", "isActive"]),
    );
    const data = { ...d, companyId: companyId ?? null };
    await db.$transaction(async (tx) => {
      const r = rid ? await tx.account.update({ where: { id: rid }, data }) : await tx.account.create({ data });
      await auditIn(tx, user.id, rid ? "account.update" : "account.create", "account", r.id, data);
    });
    segarkan("/master/rekening");
    return sukses("Rekening tersimpan.");
  });
}
