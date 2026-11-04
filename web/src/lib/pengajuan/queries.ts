import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { RequestKind, RequestStatus } from "@/generated/prisma/enums";
import { accessibleProjectIds, type SessionUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";

/**
 * Lingkup baca pengajuan:
 *   - pemegang `request.view_project` → semua pengajuan di proyek yang bisa diakses
 *   - selain itu → hanya pengajuannya sendiri
 */
export async function scopePengajuan(user: SessionUser): Promise<Prisma.PaymentRequestWhereInput> {
  if (!can(user.role, "request.view_project")) return { requesterId: user.id };
  const ids = await accessibleProjectIds(user);
  if (ids === null) return {};
  return { OR: [{ projectId: { in: ids } }, { requesterId: user.id }] };
}

export type TabPengajuan =
  | "tindakan"
  | "menunggu"
  | "disetujui"
  | "dibayar"
  | "lpj"
  | "selesai"
  | "draf"
  | "ditolak"
  | "semua"
  | "saya";

export const TAB_LABEL: Record<TabPengajuan, string> = {
  tindakan: "Perlu tindakan",
  menunggu: "Menunggu",
  disetujui: "Siap dibayar",
  dibayar: "Dibayar",
  lpj: "Uang muka",
  selesai: "Selesai",
  draf: "Draf",
  ditolak: "Ditolak/batal",
  semua: "Semua",
  saya: "Milik saya",
};

/**
 * "Perlu tindakan SAYA" – inti layar beranda. Satu definisi, dipakai untuk
 * hitungan di beranda dan isi tab "Perlu tindakan".
 */
export function whereTindakan(user: SessionUser, cap: bigint): Prisma.PaymentRequestWhereInput {
  const atau: Prisma.PaymentRequestWhereInput[] = [
    // Milik saya yang menunggu saya.
    { requesterId: user.id, status: { in: ["perlu_revisi", "draft"] } },
    { requesterId: user.id, status: "dibayar", kind: "uang_muka" },
  ];
  if (can(user.role, "request.approve")) {
    const tanpaBatas = cap === 0n || can(user.role, "request.approve_any_amount");
    atau.push({
      status: "diajukan",
      ...(user.role === "super_admin" ? {} : { requesterId: { not: user.id } }),
      ...(tanpaBatas ? {} : { total: { lte: cap } }),
    });
  }
  if (can(user.role, "request.pay")) atau.push({ status: "disetujui" });
  if (can(user.role, "request.verify_lpj")) atau.push({ status: "lpj_diajukan" });
  return { OR: atau };
}

function whereTab(tab: TabPengajuan, user: SessionUser, cap: bigint): Prisma.PaymentRequestWhereInput {
  switch (tab) {
    case "tindakan":
      return whereTindakan(user, cap);
    case "menunggu":
      return { status: { in: ["diajukan", "perlu_revisi"] } };
    case "disetujui":
      return { status: "disetujui" };
    case "dibayar":
      return { status: "dibayar", kind: { not: "uang_muka" } };
    case "lpj":
      return { kind: "uang_muka", status: { in: ["dibayar", "lpj_diajukan"] } };
    case "selesai":
      return { OR: [{ status: "selesai" }, { status: "dibayar", kind: { not: "uang_muka" } }] };
    case "draf":
      return { status: "draft", requesterId: user.id };
    case "ditolak":
      return { status: { in: ["ditolak", "dibatalkan"] } };
    case "saya":
      return { requesterId: user.id };
    case "semua":
      // Draf orang lain bukan urusan siapa pun selain pemiliknya.
      return { OR: [{ status: { not: "draft" } }, { requesterId: user.id }] };
  }
}

export type FilterPengajuan = {
  tab: TabPengajuan;
  q?: string;
  projectId?: string;
  kind?: RequestKind;
  page?: number;
};

export const PER_HALAMAN = 25;

export async function daftarPengajuan(user: SessionUser, f: FilterPengajuan, cap: bigint) {
  const scope = await scopePengajuan(user);
  const and: Prisma.PaymentRequestWhereInput[] = [scope, whereTab(f.tab, user, cap)];
  if (f.projectId) and.push({ projectId: f.projectId });
  if (f.kind) and.push({ kind: f.kind });
  if (f.q) {
    const q = f.q.trim();
    and.push({
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { number: { contains: q, mode: "insensitive" } },
        { payeeName: { contains: q, mode: "insensitive" } },
        { requester: { fullName: { contains: q, mode: "insensitive" } } },
      ],
    });
  }
  const where: Prisma.PaymentRequestWhereInput = { AND: and };
  const page = Math.max(1, f.page ?? 1);
  // Antrean kerja: yang mendesak dan paling lama menunggu di atas.
  const antrean = f.tab === "tindakan" || f.tab === "menunggu" || f.tab === "disetujui";
  const orderBy: Prisma.PaymentRequestOrderByWithRelationInput[] = antrean
    ? [{ urgent: "desc" }, { submittedAt: "asc" }, { createdAt: "asc" }]
    : [{ updatedAt: "desc" }];
  const [rows, total, jumlah] = await Promise.all([
    db.paymentRequest.findMany({
      where,
      orderBy,
      skip: (page - 1) * PER_HALAMAN,
      take: PER_HALAMAN,
      select: {
        id: true,
        number: true,
        title: true,
        kind: true,
        status: true,
        urgent: true,
        total: true,
        neededDate: true,
        payeeName: true,
        submittedAt: true,
        createdAt: true,
        updatedAt: true,
        requesterId: true,
        requester: { select: { fullName: true } },
        project: { select: { code: true, name: true } },
        _count: { select: { attachments: true } },
      },
    }),
    db.paymentRequest.count({ where }),
    db.paymentRequest.aggregate({ where, _sum: { total: true } }),
  ]);
  return { rows, total, jumlahNilai: jumlah._sum.total ?? 0n, page, pages: Math.max(1, Math.ceil(total / PER_HALAMAN)) };
}

/** Hitungan per tab (untuk lencana angka di tab). */
export async function hitungTab(user: SessionUser, cap: bigint, tabs: TabPengajuan[]) {
  const scope = await scopePengajuan(user);
  const hasil = await Promise.all(
    tabs.map((t) => db.paymentRequest.count({ where: { AND: [scope, whereTab(t, user, cap)] } })),
  );
  return Object.fromEntries(tabs.map((t, i) => [t, hasil[i]])) as Record<TabPengajuan, number>;
}

/** Ringkasan "Tugas saya" untuk beranda, dipecah per jenis tindakan. */
export async function tugasSaya(user: SessionUser, cap: bigint) {
  const scope = await scopePengajuan(user);
  const hitung = (w: Prisma.PaymentRequestWhereInput) =>
    db.paymentRequest.aggregate({ where: { AND: [scope, w] }, _count: { _all: true }, _sum: { total: true } });
  const tanpaBatas = cap === 0n || can(user.role, "request.approve_any_amount");
  const [setujui, bayar, lpjPeriksa, revisi, lpjSaya, draf] = await Promise.all([
    can(user.role, "request.approve")
      ? hitung({
          status: "diajukan",
          ...(user.role === "super_admin" ? {} : { requesterId: { not: user.id } }),
          ...(tanpaBatas ? {} : { total: { lte: cap } }),
        })
      : null,
    can(user.role, "request.pay") ? hitung({ status: "disetujui" }) : null,
    can(user.role, "request.verify_lpj") ? hitung({ status: "lpj_diajukan" }) : null,
    hitung({ requesterId: user.id, status: "perlu_revisi" }),
    hitung({ requesterId: user.id, status: "dibayar", kind: "uang_muka" }),
    hitung({ requesterId: user.id, status: "draft" }),
  ]);
  const ubah = (a: Awaited<ReturnType<typeof hitung>> | null) =>
    a ? { n: a._count._all, total: a._sum.total ?? 0n } : null;
  return {
    setujui: ubah(setujui),
    bayar: ubah(bayar),
    lpjPeriksa: ubah(lpjPeriksa),
    revisi: ubah(revisi),
    lpjSaya: ubah(lpjSaya),
    draf: ubah(draf),
  };
}

export async function detailPengajuan(user: SessionUser, id: string) {
  const scope = await scopePengajuan(user);
  return db.paymentRequest.findFirst({
    where: { AND: [{ id }, scope] },
    include: {
      project: { select: { id: true, code: true, name: true, budget: true, company: { select: { name: true, city: true, address: true } } } },
      party: { select: { id: true, name: true, kind: true } },
      requester: { select: { id: true, fullName: true } },
      approver: { select: { fullName: true } },
      payer: { select: { fullName: true } },
      account: { select: { name: true, bankName: true, accountNumber: true } },
      items: { orderBy: { position: "asc" }, include: { category: { select: { id: true, name: true } } } },
      realizations: { orderBy: { position: "asc" }, include: { category: { select: { id: true, name: true } } } },
      events: { orderBy: { createdAt: "asc" }, include: { actor: { select: { fullName: true } } } },
      attachments: { orderBy: { createdAt: "asc" } },
      transactions: {
        orderBy: { createdAt: "asc" },
        select: { id: true, number: true, kind: true, amount: true, status: true, date: true },
      },
    },
  });
}

export type DetailPengajuan = NonNullable<Awaited<ReturnType<typeof detailPengajuan>>>;

/** Status terbuka (masih berjalan) – untuk ringkasan komitmen di proyek. */
export const STATUS_BERJALAN: RequestStatus[] = ["diajukan", "disetujui"];
