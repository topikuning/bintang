import "server-only";
import type { RequestStatus, TransactionKind, UserRole } from "@/generated/prisma/enums";
import { PesanError } from "@/lib/galat";
import { auditIn } from "@/lib/audit";
import { can, isCrossProject, type Capability } from "@/lib/authz";
import type { Tx } from "@/lib/db";
import { selisihLpj } from "@/lib/keuangan/hitung";
import { sandikan } from "@/lib/kripto";
import { assertRequestTransition, REQUEST_KIND_LABEL } from "@/lib/lifecycle";
import { kirim, penerimaBerwenang } from "@/lib/notifikasi";
import { nomorBerikutnya } from "@/lib/nomor";
import type { BerkasTersimpan } from "@/lib/penyimpanan";
import { keyKeTanggal } from "@/lib/tanggal";
import { jumlahkan, rupiah } from "@/lib/uang";
import * as akses from "./akses";
import type { BayarInput, PengajuanInput } from "./schema";

/**
 * Operasi pengajuan pembayaran. Setiap fungsi menerima `tx` (transaksi Prisma)
 * dan `aktor`, jadi bisa dipanggil server action MAUPUN uji integrasi tanpa
 * cookie. Semuanya: periksa wewenang → periksa transisi → tulis → riwayat →
 * audit → notifikasi, di dalam transaksi yang sama.
 */

export type Aktor = { id: string; role: UserRole; allProjects: boolean; fullName: string };

function wajib(k: akses.Keputusan): void {
  if (!k.boleh) throw new PesanError(k.alasan);
}

function wajibCap(aktor: Aktor, c: Capability) {
  if (!can(aktor.role, c)) throw new PesanError("Anda tidak punya izin untuk aksi ini.");
}

async function aksesProyek(tx: Tx, aktor: Aktor, projectId: string): Promise<void> {
  if (isCrossProject(aktor.role, aktor.allProjects)) return;
  const m = await tx.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: aktor.id } },
    select: { id: true },
  });
  if (!m) throw new PesanError("Anda tidak punya akses ke proyek ini.");
}

async function muat(tx: Tx, id: string) {
  const p = await tx.paymentRequest.findUnique({ where: { id } });
  if (!p) throw new PesanError("Pengajuan tidak ditemukan.");
  return p;
}

/** Kunci baris pengajuan selama transaksi – dua klik "Bayar" bersamaan tidak boleh dua-duanya lolos. */
async function kunci(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM "payment_requests" WHERE id = ${id}::uuid FOR UPDATE`;
  return muat(tx, id);
}

async function riwayat(
  tx: Tx,
  requestId: string,
  from: RequestStatus | null,
  to: RequestStatus,
  action: string,
  actorId: string,
  note?: string | null,
) {
  await tx.paymentRequestEvent.create({
    data: { requestId, fromStatus: from, toStatus: to, action, actorId, note: note || null },
  });
}

function tautan(id: string) {
  return `/pengajuan/${id}`;
}

function label(p: { number: string | null; title: string }) {
  return p.number ? `${p.number} – ${p.title}` : p.title;
}

async function cap(tx: Tx): Promise<bigint> {
  const s = await tx.setting.findUnique({ where: { id: 1 } });
  return s?.financeApproveCap ?? 0n;
}

// ─── Simpan / ajukan ─────────────────────────────────────────

export async function simpan(
  tx: Tx,
  aktor: Aktor,
  input: PengajuanInput,
  opsi: { id?: string; ajukan: boolean; lampiran: BerkasTersimpan[] },
): Promise<{ id: string; status: RequestStatus; number: string | null }> {
  wajibCap(aktor, "request.create");
  await aksesProyek(tx, aktor, input.projectId);

  const proyek = await tx.project.findUnique({ where: { id: input.projectId }, select: { status: true, name: true } });
  if (!proyek) throw new PesanError("Proyek tidak ditemukan.");
  if (proyek.status !== "aktif") throw new PesanError(`Proyek "${proyek.name}" tidak aktif – pengajuan tidak bisa dibuat.`);

  const catIds = [...new Set(input.items.map((i) => i.categoryId).filter((x): x is string => !!x))];
  if (catIds.length) {
    const ok = await tx.category.count({ where: { id: { in: catIds }, direction: "keluar" } });
    if (ok !== catIds.length) throw new PesanError("Ada kategori yang tidak valid untuk pengeluaran.");
  }

  // Penerima: dari master pihak, atau – untuk uang muka & penggantian – pemohon sendiri.
  // Nomor rekening dari isian disandikan; dari master (pihak/profil) sudah
  // tersandi di DB, jadi disalin apa adanya – jangan disandikan dua kali.
  let payeeName = input.payeeName;
  let bankName = input.bankName;
  let bankHolder = input.bankHolder;
  let bankAccountTersimpan: string | null = input.bankAccount ? sandikan(input.bankAccount) : null;
  if (input.partyId) {
    const party = await tx.party.findUnique({ where: { id: input.partyId } });
    if (!party) throw new PesanError("Penerima tidak ditemukan.");
    payeeName ??= party.name;
    bankName ??= party.bankName ?? undefined;
    bankHolder ??= party.bankHolder ?? undefined;
    bankAccountTersimpan ??= party.bankAccount;
  }
  if (!payeeName && input.kind !== "pembayaran") {
    const me = await tx.user.findUniqueOrThrow({ where: { id: aktor.id } });
    payeeName = me.fullName;
    bankName ??= me.bankName ?? undefined;
    bankHolder ??= me.bankHolder ?? undefined;
    bankAccountTersimpan ??= me.bankAccount;
  }
  if (opsi.ajukan && !payeeName) {
    throw new PesanError("Isi penerima dana sebelum mengajukan.");
  }

  const total = jumlahkan(input.items.map((i) => i.amount));
  const data = {
    projectId: input.projectId,
    kind: input.kind,
    title: input.title,
    description: input.description ?? null,
    urgent: input.urgent,
    neededDate: input.neededDate ? keyKeTanggal(input.neededDate) : null,
    partyId: input.partyId ?? null,
    payeeName: payeeName ?? null,
    bankName: bankName ?? null,
    bankAccount: bankAccountTersimpan,
    bankHolder: bankHolder ?? null,
    total,
  };
  const items = input.items.map((it, i) => ({
    position: i,
    categoryId: it.categoryId ?? null,
    description: it.description,
    quantity: it.quantity ?? null,
    unit: it.unit ?? null,
    unitPrice: it.unitPrice ?? null,
    amount: it.amount,
  }));

  let id: string;
  let status: RequestStatus;
  if (opsi.id) {
    const p = await kunci(tx, opsi.id);
    wajib(akses.bolehEdit(aktor, p));
    if (p.projectId !== input.projectId) await aksesProyek(tx, aktor, p.projectId);
    await tx.paymentRequestItem.deleteMany({ where: { requestId: p.id } });
    await tx.paymentRequest.update({ where: { id: p.id }, data: { ...data, items: { create: items } } });
    await auditIn(tx, aktor.id, "request.update", "payment_request", p.id, { total, status: p.status });
    id = p.id;
    status = p.status;
  } else {
    const p = await tx.paymentRequest.create({
      data: { ...data, requesterId: aktor.id, status: "draft", items: { create: items } },
    });
    await riwayat(tx, p.id, null, "draft", "dibuat", aktor.id);
    await auditIn(tx, aktor.id, "request.create", "payment_request", p.id, { total, kind: input.kind });
    id = p.id;
    status = "draft";
  }

  if (opsi.lampiran.length) {
    await tx.attachment.createMany({
      data: opsi.lampiran.map((b) => ({ ...b, kind: "nota" as const, requestId: id, uploadedById: aktor.id })),
    });
  }

  if (opsi.ajukan) {
    const hasil = await ajukan(tx, aktor, id);
    return { id, status: "diajukan", number: hasil.number };
  }
  const p = await muat(tx, id);
  return { id, status, number: p.number };
}

export async function ajukan(tx: Tx, aktor: Aktor, id: string): Promise<{ number: string }> {
  const p = await kunci(tx, id);
  wajib(akses.bolehAjukan(aktor, p));
  assertRequestTransition(p.status, "diajukan", p.kind);
  if (!p.payeeName) throw new PesanError("Isi penerima dana sebelum mengajukan.");
  const jumlahItem = await tx.paymentRequestItem.count({ where: { requestId: id } });
  if (jumlahItem === 0) throw new PesanError("Tambahkan minimal satu rincian sebelum mengajukan.");
  // Kategori wajib saat diajukan: tanpa kategori, biaya proyek tidak bisa
  // dipilah di laporan (masalah lama yang dulu ditambal dengan AI).
  const tanpaKategori = await tx.paymentRequestItem.count({ where: { requestId: id, categoryId: null } });
  if (tanpaKategori > 0) throw new PesanError("Pilih kategori untuk setiap rincian sebelum mengajukan.");

  const number = p.number ?? (await nomorBerikutnya(tx, "PGJ"));
  await tx.paymentRequest.update({
    where: { id },
    data: { status: "diajukan", number, submittedAt: new Date(), approverId: null, approvedAt: null, approvalNote: null },
  });
  const ulang = p.status === "perlu_revisi";
  await riwayat(tx, id, p.status, "diajukan", ulang ? "diajukan ulang" : "diajukan", aktor.id);
  await auditIn(tx, aktor.id, "request.submit", "payment_request", id, { number, total: p.total });

  const batas = await cap(tx);
  const capPenyetuju: Capability = batas > 0n && p.total > batas ? "request.approve_any_amount" : "request.approve";
  const penyetuju = await penerimaBerwenang(tx, capPenyetuju, p.projectId);
  await kirim(
    tx,
    penyetuju,
    {
      title: `${p.urgent ? "MENDESAK – " : ""}Pengajuan ${ulang ? "diperbaiki" : "baru"} menunggu persetujuan`,
      body: `${aktor.fullName} · ${REQUEST_KIND_LABEL[p.kind]} ${rupiah(p.total)} · ${p.title}`,
      href: tautan(id),
    },
    aktor.id,
  );
  return { number };
}

export async function hapusDraft(tx: Tx, aktor: Aktor, id: string): Promise<string[]> {
  const p = await kunci(tx, id);
  wajib(akses.bolehHapusDraft(aktor, p));
  const berkas = await tx.attachment.findMany({ where: { requestId: id }, select: { storageKey: true } });
  await tx.paymentRequest.delete({ where: { id } });
  await auditIn(tx, aktor.id, "request.delete_draft", "payment_request", id, { title: p.title });
  return berkas.map((b) => b.storageKey);
}

// ─── Persetujuan ─────────────────────────────────────────────

export async function setujui(
  tx: Tx,
  aktor: Aktor,
  id: string,
  catatan?: string,
  opsi: { beritahuPembayar?: boolean } = {},
): Promise<void> {
  const p = await kunci(tx, id);
  await aksesProyek(tx, aktor, p.projectId);
  wajib(akses.bolehSetujui(aktor, p, await cap(tx)));
  assertRequestTransition(p.status, "disetujui", p.kind);
  await tx.paymentRequest.update({
    where: { id },
    data: { status: "disetujui", approverId: aktor.id, approvedAt: new Date(), approvalNote: catatan || null },
  });
  await riwayat(tx, id, p.status, "disetujui", "disetujui", aktor.id, catatan);
  await auditIn(tx, aktor.id, "request.approve", "payment_request", id, { total: p.total });
  await kirim(tx, [p.requesterId], {
    title: "Pengajuan Anda disetujui",
    body: `${label(p)} · ${rupiah(p.total)}. Tinggal menunggu dibayar.`,
    href: tautan(id),
  }, aktor.id);
  if (opsi.beritahuPembayar !== false) {
    const pembayar = await penerimaBerwenang(tx, "request.pay", p.projectId);
    await kirim(tx, pembayar, {
      title: "Pengajuan siap dibayar",
      body: `${label(p)} · ${rupiah(p.total)} · ke ${p.payeeName ?? "–"}`,
      href: tautan(id),
    }, aktor.id);
  }
}

export async function mintaRevisi(tx: Tx, aktor: Aktor, id: string, catatan: string): Promise<void> {
  const p = await kunci(tx, id);
  await aksesProyek(tx, aktor, p.projectId);
  wajib(akses.bolehMintaRevisi(aktor, p));
  assertRequestTransition(p.status, "perlu_revisi", p.kind);
  await tx.paymentRequest.update({
    where: { id },
    data: { status: "perlu_revisi", approverId: null, approvedAt: null, approvalNote: null },
  });
  await riwayat(tx, id, p.status, "perlu_revisi", "minta revisi", aktor.id, catatan);
  await auditIn(tx, aktor.id, "request.revise", "payment_request", id, { catatan });
  await kirim(tx, [p.requesterId], {
    title: "Pengajuan Anda perlu diperbaiki",
    body: `${label(p)}: ${catatan}`,
    href: tautan(id),
  }, aktor.id);
}

export async function tolak(tx: Tx, aktor: Aktor, id: string, alasan: string): Promise<void> {
  const p = await kunci(tx, id);
  await aksesProyek(tx, aktor, p.projectId);
  wajib(akses.bolehTolak(aktor, p));
  assertRequestTransition(p.status, "ditolak", p.kind);
  await tx.paymentRequest.update({ where: { id }, data: { status: "ditolak", closedAt: new Date() } });
  await riwayat(tx, id, p.status, "ditolak", "ditolak", aktor.id, alasan);
  await auditIn(tx, aktor.id, "request.reject", "payment_request", id, { alasan });
  await kirim(tx, [p.requesterId], {
    title: "Pengajuan Anda ditolak",
    body: `${label(p)}: ${alasan}`,
    href: tautan(id),
  }, aktor.id);
}

export async function batalkan(tx: Tx, aktor: Aktor, id: string, alasan?: string): Promise<void> {
  const p = await kunci(tx, id);
  await aksesProyek(tx, aktor, p.projectId);
  wajib(akses.bolehBatalkan(aktor, p));
  assertRequestTransition(p.status, "dibatalkan", p.kind);
  await tx.paymentRequest.update({ where: { id }, data: { status: "dibatalkan", closedAt: new Date() } });
  await riwayat(tx, id, p.status, "dibatalkan", "dibatalkan", aktor.id, alasan);
  await auditIn(tx, aktor.id, "request.cancel", "payment_request", id, { alasan });
  await kirim(tx, [p.requesterId], {
    title: "Pengajuan Anda dibatalkan",
    body: `${label(p)}${alasan ? `: ${alasan}` : ""}`,
    href: tautan(id),
  }, aktor.id);
}

// ─── Pembayaran ──────────────────────────────────────────────

async function cekRekening(tx: Tx, accountId: string | undefined) {
  if (!accountId) return;
  const a = await tx.account.findUnique({ where: { id: accountId }, select: { isActive: true } });
  if (!a || !a.isActive) throw new PesanError("Rekening sumber tidak ditemukan atau sudah nonaktif.");
}

export async function bayar(
  tx: Tx,
  aktor: Aktor,
  id: string,
  input: BayarInput,
  bukti: BerkasTersimpan[],
): Promise<{ transactionNumber: string }> {
  const p = await kunci(tx, id);
  await aksesProyek(tx, aktor, p.projectId);
  wajib(akses.bolehBayar(aktor, p));
  assertRequestTransition(p.status, "dibayar", p.kind);
  await cekRekening(tx, input.accountId);
  const setting = await tx.setting.findUnique({ where: { id: 1 } });
  if (setting?.requireProof && bukti.length === 0) {
    throw new PesanError("Lampirkan bukti bayar (foto/PDF bukti transfer atau kuitansi).");
  }

  const items = await tx.paymentRequestItem.findMany({ where: { requestId: id }, orderBy: { position: "asc" } });
  const kind: TransactionKind = p.kind === "uang_muka" ? "uang_muka" : "pengeluaran";
  const number = await nomorBerikutnya(tx, "TRX", input.paidDate);
  await tx.transaction.create({
    data: {
      number,
      projectId: p.projectId,
      date: keyKeTanggal(input.paidDate),
      kind,
      accountId: input.accountId ?? null,
      method: input.method,
      amount: p.total,
      description: label(p),
      partyId: p.partyId,
      partyName: p.payeeName,
      reference: input.reference ?? null,
      status: "terverifikasi",
      requestId: id,
      createdById: aktor.id,
      verifiedById: aktor.id,
      verifiedAt: new Date(),
      items: {
        create: items.map((it) => ({
          position: it.position,
          // Uang muka belum biaya – kategorinya baru diakui saat LPJ diterima.
          categoryId: kind === "uang_muka" ? null : it.categoryId,
          description: it.description,
          amount: it.amount,
        })),
      },
    },
  });

  if (bukti.length) {
    await tx.attachment.createMany({
      data: bukti.map((b) => ({ ...b, kind: "bukti_bayar" as const, requestId: id, uploadedById: aktor.id })),
    });
  }

  await tx.paymentRequest.update({
    where: { id },
    data: {
      status: "dibayar",
      payerId: aktor.id,
      paidAt: new Date(),
      paidDate: keyKeTanggal(input.paidDate),
      accountId: input.accountId ?? null,
      paymentMethod: input.method,
      paymentRef: input.reference ?? null,
      closedAt: p.kind === "uang_muka" ? null : new Date(),
    },
  });
  await riwayat(tx, id, p.status, "dibayar", "dibayar", aktor.id, input.note);
  await auditIn(tx, aktor.id, "request.pay", "payment_request", id, {
    total: p.total,
    transaction: number,
    accountId: input.accountId,
    method: input.method,
  });
  await kirim(tx, [p.requesterId], {
    title: p.kind === "uang_muka" ? "Uang muka sudah ditransfer" : "Pengajuan Anda sudah dibayar",
    body:
      p.kind === "uang_muka"
        ? `${label(p)} · ${rupiah(p.total)}. Jangan lupa ajukan LPJ beserta notanya.`
        : `${label(p)} · ${rupiah(p.total)} ke ${p.payeeName ?? "–"}.`,
    href: tautan(id),
  }, aktor.id);
  return { transactionNumber: number };
}

export async function setujuiDanBayar(
  tx: Tx,
  aktor: Aktor,
  id: string,
  input: BayarInput,
  bukti: BerkasTersimpan[],
): Promise<{ transactionNumber: string }> {
  const p = await muat(tx, id);
  wajib(akses.bolehSetujuiDanBayar(aktor, p, await cap(tx)));
  await setujui(tx, aktor, id, undefined, { beritahuPembayar: false });
  return bayar(tx, aktor, id, input, bukti);
}

export async function batalkanPembayaran(tx: Tx, aktor: Aktor, id: string, alasan: string): Promise<void> {
  const p = await kunci(tx, id);
  await aksesProyek(tx, aktor, p.projectId);
  wajib(akses.bolehBatalkanPembayaran(aktor, p));
  assertRequestTransition(p.status, "disetujui", p.kind);
  const dibatalkan = await tx.transaction.updateMany({
    where: { requestId: id, status: { in: ["terverifikasi", "menunggu_verifikasi"] } },
    data: { status: "dibatalkan", statusNote: `Pembayaran dibatalkan: ${alasan}` },
  });
  await tx.paymentRequest.update({
    where: { id },
    data: {
      status: "disetujui",
      payerId: null,
      paidAt: null,
      paidDate: null,
      accountId: null,
      paymentMethod: null,
      paymentRef: null,
      closedAt: null,
    },
  });
  await riwayat(tx, id, p.status, "disetujui", "pembayaran dibatalkan", aktor.id, alasan);
  await auditIn(tx, aktor.id, "request.unpay", "payment_request", id, { alasan, transaksi: dibatalkan.count });
  await kirim(tx, [p.requesterId], {
    title: "Pencatatan pembayaran dibatalkan",
    body: `${label(p)}: ${alasan}`,
    href: tautan(id),
  }, aktor.id);
}

// ─── LPJ uang muka ───────────────────────────────────────────

export type RealisasiInput = { categoryId?: string; description: string; amount: bigint }[];

export async function ajukanLpj(
  tx: Tx,
  aktor: Aktor,
  id: string,
  realisasi: RealisasiInput,
  catatan: string | undefined,
  nota: BerkasTersimpan[],
): Promise<void> {
  const p = await kunci(tx, id);
  wajib(akses.bolehAjukanLpj(aktor, p));
  assertRequestTransition(p.status, "lpj_diajukan", p.kind);
  if (realisasi.length === 0 && !catatan) {
    throw new PesanError("Tulis catatan bila uang muka tidak terpakai sama sekali.");
  }
  const catIds = [...new Set(realisasi.map((r) => r.categoryId).filter((x): x is string => !!x))];
  if (catIds.length) {
    const ok = await tx.category.count({ where: { id: { in: catIds }, direction: "keluar" } });
    if (ok !== catIds.length) throw new PesanError("Ada kategori yang tidak valid untuk pengeluaran.");
  }
  await tx.paymentRequestRealization.deleteMany({ where: { requestId: id } });
  if (realisasi.length) {
    await tx.paymentRequestRealization.createMany({
      data: realisasi.map((r, i) => ({
        requestId: id,
        position: i,
        categoryId: r.categoryId ?? null,
        description: r.description,
        amount: r.amount,
      })),
    });
  }
  if (nota.length) {
    await tx.attachment.createMany({
      data: nota.map((b) => ({ ...b, kind: "lpj" as const, requestId: id, uploadedById: aktor.id })),
    });
  }
  const total = jumlahkan(realisasi.map((r) => r.amount));
  await tx.paymentRequest.update({
    where: { id },
    data: { status: "lpj_diajukan", lpjSubmittedAt: new Date(), lpjNote: catatan ?? null },
  });
  await riwayat(tx, id, p.status, "lpj_diajukan", "LPJ diajukan", aktor.id, catatan);
  await auditIn(tx, aktor.id, "request.lpj_submit", "payment_request", id, { realisasi: total });
  const pemeriksa = await penerimaBerwenang(tx, "request.verify_lpj", p.projectId);
  await kirim(tx, pemeriksa, {
    title: "LPJ uang muka perlu diperiksa",
    body: `${aktor.fullName} · ${label(p)} · terpakai ${rupiah(total)} dari ${rupiah(p.total)}`,
    href: tautan(id),
  }, aktor.id);
}

export async function kembalikanLpj(tx: Tx, aktor: Aktor, id: string, catatan: string): Promise<void> {
  const p = await kunci(tx, id);
  await aksesProyek(tx, aktor, p.projectId);
  wajib(akses.bolehPeriksaLpj(aktor, p));
  assertRequestTransition(p.status, "dibayar", p.kind);
  await tx.paymentRequest.update({ where: { id }, data: { status: "dibayar" } });
  await riwayat(tx, id, p.status, "dibayar", "LPJ dikembalikan", aktor.id, catatan);
  await auditIn(tx, aktor.id, "request.lpj_return", "payment_request", id, { catatan });
  await kirim(tx, [p.requesterId], {
    title: "LPJ Anda perlu diperbaiki",
    body: `${label(p)}: ${catatan}`,
    href: tautan(id),
  }, aktor.id);
}

export async function terimaLpj(
  tx: Tx,
  aktor: Aktor,
  id: string,
  input: { date: string; accountId?: string; method: BayarInput["method"]; note?: string },
): Promise<{ arah: "pas" | "kembali" | "kurang"; jumlah: bigint }> {
  const p = await kunci(tx, id);
  await aksesProyek(tx, aktor, p.projectId);
  wajib(akses.bolehPeriksaLpj(aktor, p));
  assertRequestTransition(p.status, "selesai", p.kind);
  await cekRekening(tx, input.accountId);

  const realisasi = await tx.paymentRequestRealization.findMany({ where: { requestId: id }, orderBy: { position: "asc" } });
  const totalRealisasi = jumlahkan(realisasi.map((r) => r.amount));
  const dibayarRows = await tx.transaction.aggregate({
    where: { requestId: id, kind: "uang_muka", status: "terverifikasi" },
    _sum: { amount: true },
  });
  const dibayar = dibayarRows._sum.amount ?? 0n;
  const selisih = selisihLpj(dibayar, totalRealisasi);
  if (selisih.arah !== "pas" && !input.accountId) {
    throw new PesanError(
      selisih.arah === "kembali"
        ? "Pilih rekening tempat sisa uang muka dikembalikan."
        : "Pilih rekening untuk membayar kekurangannya.",
    );
  }

  const dasar = {
    projectId: p.projectId,
    date: keyKeTanggal(input.date),
    status: "terverifikasi" as const,
    requestId: id,
    createdById: aktor.id,
    verifiedById: aktor.id,
    verifiedAt: new Date(),
    partyId: p.partyId,
    partyName: p.payeeName,
  };

  if (totalRealisasi > 0n) {
    await tx.transaction.create({
      data: {
        ...dasar,
        number: await nomorBerikutnya(tx, "TRX", input.date),
        kind: "realisasi_uang_muka",
        accountId: null,
        method: "lainnya",
        amount: totalRealisasi,
        description: `Realisasi ${label(p)}`,
        items: {
          create: realisasi.map((r) => ({
            position: r.position,
            categoryId: r.categoryId,
            description: r.description,
            amount: r.amount,
          })),
        },
      },
    });
  }
  if (selisih.arah !== "pas") {
    const kembali = selisih.arah === "kembali";
    await tx.transaction.create({
      data: {
        ...dasar,
        number: await nomorBerikutnya(tx, "TRX", input.date),
        kind: kembali ? "pengembalian_uang_muka" : "uang_muka",
        accountId: input.accountId ?? null,
        method: input.method,
        amount: selisih.jumlah,
        description: `${kembali ? "Pengembalian sisa" : "Kekurangan"} ${label(p)}`,
        items: {
          create: [{ position: 0, description: kembali ? "Sisa uang muka" : "Kekurangan uang muka", amount: selisih.jumlah }],
        },
      },
    });
  }

  await tx.paymentRequest.update({ where: { id }, data: { status: "selesai", closedAt: new Date() } });
  const ket =
    selisih.arah === "pas"
      ? "Pas, tidak ada selisih."
      : selisih.arah === "kembali"
        ? `Sisa ${rupiah(selisih.jumlah)} dikembalikan ke kas.`
        : `Kekurangan ${rupiah(selisih.jumlah)} dibayarkan.`;
  await riwayat(tx, id, p.status, "selesai", "LPJ diterima", aktor.id, [ket, input.note].filter(Boolean).join(" "));
  await auditIn(tx, aktor.id, "request.lpj_accept", "payment_request", id, {
    dibayar,
    realisasi: totalRealisasi,
    selisih: selisih.jumlah,
    arah: selisih.arah,
  });
  await kirim(tx, [p.requesterId], {
    title: "LPJ Anda diterima",
    body: `${label(p)}. ${ket}`,
    href: tautan(id),
  }, aktor.id);
  return selisih;
}

// ─── Lampiran ────────────────────────────────────────────────

export async function hapusLampiran(tx: Tx, aktor: Aktor, attachmentId: string): Promise<string> {
  const a = await tx.attachment.findUnique({ where: { id: attachmentId }, include: { request: true } });
  if (!a || !a.request) throw new PesanError("Lampiran tidak ditemukan.");
  if (a.kind !== "nota") throw new PesanError("Bukti bayar dan nota LPJ tidak bisa dihapus.");
  wajib(akses.bolehEdit(aktor, a.request));
  await tx.attachment.delete({ where: { id: attachmentId } });
  await auditIn(tx, aktor.id, "attachment.delete", "attachment", attachmentId, { requestId: a.requestId });
  return a.storageKey;
}
