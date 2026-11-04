import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { TransactionKind } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { keyKeTanggal } from "@/lib/tanggal";
import { kelompokkan, ringkasKas, type JumlahPerJenis, type RingkasanKas } from "./hitung";

/**
 * Kueri agregat. Semua angka lewat `ringkasKas` – kueri hanya menjumlahkan
 * per jenis; rumusnya tidak boleh ditulis ulang di sini.
 */

export type Rentang = { dari?: string; sampai?: string };

function whereTx(projectIds: string[] | null, r: Rentang = {}, extra: Prisma.TransactionWhereInput = {}) {
  const where: Prisma.TransactionWhereInput = { status: "terverifikasi", ...extra };
  if (projectIds !== null) where.projectId = { in: projectIds };
  if (r.dari || r.sampai) {
    where.date = {
      ...(r.dari ? { gte: keyKeTanggal(r.dari) } : {}),
      ...(r.sampai ? { lte: keyKeTanggal(r.sampai) } : {}),
    };
  }
  return where;
}

export async function ringkasan(projectIds: string[] | null, r: Rentang = {}): Promise<RingkasanKas> {
  const rows = await db.transaction.groupBy({
    by: ["kind"],
    where: whereTx(projectIds, r),
    _sum: { amount: true },
  });
  return ringkasKas(kelompokkan(rows.map((x) => ({ kind: x.kind, amount: x._sum.amount }))));
}

/** Ringkasan per proyek, untuk daftar proyek & dasbor. */
export async function ringkasanPerProyek(projectIds: string[] | null): Promise<Map<string, RingkasanKas>> {
  const rows = await db.transaction.groupBy({
    by: ["projectId", "kind"],
    where: whereTx(projectIds),
    _sum: { amount: true },
  });
  const per = new Map<string, JumlahPerJenis>();
  for (const x of rows) {
    const j = per.get(x.projectId) ?? {};
    j[x.kind] = (j[x.kind] ?? 0n) + (x._sum.amount ?? 0n);
    per.set(x.projectId, j);
  }
  return new Map([...per].map(([id, j]) => [id, ringkasKas(j)]));
}

/** Saldo tiap rekening = saldo awal + kas masuk − kas keluar. */
export async function saldoRekening(): Promise<
  { id: string; name: string; kind: string; bankName: string | null; accountNumber: string | null; saldo: bigint; isActive: boolean }[]
> {
  const [akun, rows] = await Promise.all([
    db.account.findMany({ orderBy: [{ isActive: "desc" }, { name: "asc" }] }),
    db.transaction.groupBy({
      by: ["accountId", "kind"],
      where: { status: "terverifikasi", accountId: { not: null } },
      _sum: { amount: true },
    }),
  ]);
  const per = new Map<string, JumlahPerJenis>();
  for (const x of rows) {
    if (!x.accountId) continue;
    const j = per.get(x.accountId) ?? {};
    j[x.kind] = (j[x.kind] ?? 0n) + (x._sum.amount ?? 0n);
    per.set(x.accountId, j);
  }
  return akun.map((a) => ({
    id: a.id,
    name: a.name,
    kind: a.kind,
    bankName: a.bankName,
    accountNumber: a.accountNumber,
    isActive: a.isActive,
    saldo: a.openingBalance + ringkasKas(per.get(a.id) ?? {}).saldo,
  }));
}

const KIND_BIAYA: TransactionKind[] = ["pengeluaran", "realisasi_uang_muka"];

/** Biaya per kategori (rincian transaksi pengeluaran + realisasi uang muka). */
export async function biayaPerKategori(
  projectIds: string[] | null,
  r: Rentang = {},
): Promise<{ categoryId: string | null; name: string; amount: bigint }[]> {
  const rows = await db.transactionItem.groupBy({
    by: ["categoryId"],
    where: { transaction: whereTx(projectIds, r, { kind: { in: KIND_BIAYA } }) },
    _sum: { amount: true },
  });
  const ids = rows.map((r) => r.categoryId).filter((x): x is string => !!x);
  const cats = await db.category.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const nama = new Map(cats.map((c) => [c.id, c.name]));
  return rows
    .map((x) => ({
      categoryId: x.categoryId,
      name: x.categoryId ? (nama.get(x.categoryId) ?? "–") : "Tanpa kategori",
      amount: x._sum.amount ?? 0n,
    }))
    .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));
}

/** Arus kas per bulan (n bulan terakhir sampai `akhirKey`). */
export async function arusKasBulanan(
  projectIds: string[] | null,
  n: number,
  akhirKey: string,
): Promise<{ tahun: number; bulan: number; masuk: bigint; keluar: bigint }[]> {
  const [y, m] = akhirKey.split("-").map(Number);
  const mulai = new Date(Date.UTC(y, m - n, 1));
  const akhir = new Date(Date.UTC(y, m, 0));
  const rows = await db.transaction.findMany({
    where: whereTx(projectIds, {
      dari: mulai.toISOString().slice(0, 10),
      sampai: akhir.toISOString().slice(0, 10),
    }),
    select: { date: true, kind: true, amount: true },
  });
  const ember = new Map<string, JumlahPerJenis>();
  for (const r of rows) {
    const k = r.date.toISOString().slice(0, 7);
    const j = ember.get(k) ?? {};
    j[r.kind] = (j[r.kind] ?? 0n) + r.amount;
    ember.set(k, j);
  }
  const out: { tahun: number; bulan: number; masuk: bigint; keluar: bigint }[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(y, m - n + i, 1));
    const k = d.toISOString().slice(0, 7);
    const s = ringkasKas(ember.get(k) ?? {});
    out.push({ tahun: d.getUTCFullYear(), bulan: d.getUTCMonth() + 1, masuk: s.kasMasuk, keluar: s.kasKeluar });
  }
  return out;
}
