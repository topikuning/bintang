import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { TransactionKind, TransactionStatus } from "@/generated/prisma/enums";
import { accessibleProjectIds, type SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { keyKeTanggal } from "@/lib/tanggal";

export type FilterTx = {
  q?: string;
  projectId?: string;
  accountId?: string;
  arah?: "masuk" | "keluar";
  status?: TransactionStatus;
  dari?: string;
  sampai?: string;
  page?: number;
};

export const ARAH_KIND: Record<"masuk" | "keluar", TransactionKind[]> = {
  masuk: ["pemasukan", "pengembalian_uang_muka"],
  keluar: ["pengeluaran", "uang_muka"],
};

export async function whereTransaksi(user: SessionUser, f: FilterTx): Promise<Prisma.TransactionWhereInput> {
  const ids = await accessibleProjectIds(user);
  const and: Prisma.TransactionWhereInput[] = [];
  if (ids !== null) and.push({ projectId: { in: ids } });
  if (f.projectId) and.push({ projectId: f.projectId });
  if (f.accountId) and.push({ accountId: f.accountId });
  if (f.arah) and.push({ kind: { in: ARAH_KIND[f.arah] } });
  if (f.status) and.push({ status: f.status });
  if (f.dari) and.push({ date: { gte: keyKeTanggal(f.dari) } });
  if (f.sampai) and.push({ date: { lte: keyKeTanggal(f.sampai) } });
  if (f.q) {
    const q = f.q.trim();
    and.push({
      OR: [
        { description: { contains: q, mode: "insensitive" } },
        { number: { contains: q, mode: "insensitive" } },
        { partyName: { contains: q, mode: "insensitive" } },
        { reference: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  return { AND: and };
}

export const PER_HALAMAN_TX = 30;

export async function daftarTransaksi(user: SessionUser, f: FilterTx) {
  const where = await whereTransaksi(user, f);
  const page = Math.max(1, f.page ?? 1);
  const [rows, total] = await Promise.all([
    db.transaction.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * PER_HALAMAN_TX,
      take: PER_HALAMAN_TX,
      select: {
        id: true,
        number: true,
        date: true,
        kind: true,
        amount: true,
        description: true,
        partyName: true,
        status: true,
        requestId: true,
        project: { select: { code: true } },
        account: { select: { name: true } },
        items: { take: 1, select: { category: { select: { name: true } } } },
        _count: { select: { attachments: true, items: true } },
      },
    }),
    db.transaction.count({ where }),
  ]);
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / PER_HALAMAN_TX)) };
}
