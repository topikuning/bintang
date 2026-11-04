import "server-only";
import { z } from "zod";
import { auditIn } from "@/lib/audit";
import { can, isCrossProject } from "@/lib/authz";
import type { Tx } from "@/lib/db";
import { PesanError } from "@/lib/galat";
import { assertTxTransition } from "@/lib/lifecycle";
import { kirim, penerimaBerwenang } from "@/lib/notifikasi";
import { nomorBerikutnya } from "@/lib/nomor";
import type { BerkasTersimpan } from "@/lib/penyimpanan";
import { keyKeTanggal } from "@/lib/tanggal";
import { jumlahkan, parseRupiah, rupiah } from "@/lib/uang";
import type { Aktor } from "@/lib/pengajuan/service";

/**
 * Pencatatan kas LANGSUNG (di luar pengajuan): termin masuk, belanja kecil
 * tunai, dll. Uang muka & realisasinya TIDAK dibuat di sini – itu hanya lewat
 * alur pengajuan supaya pertanggungjawabannya tidak terlewat.
 *
 * Dicatat Keuangan → langsung terverifikasi. Dicatat admin proyek → menunggu
 * verifikasi Keuangan (empat mata untuk uang).
 */

const uuid = z.string().uuid("Pilihan tidak valid.");

export const txSchema = z.object({
  projectId: uuid,
  kind: z.enum(["pemasukan", "pengeluaran"], { message: "Pilih masuk atau keluar." }),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Isi tanggal."),
  accountId: uuid.optional().or(z.literal("").transform(() => undefined)),
  method: z.enum(["transfer", "tunai", "qris", "giro", "lainnya"]).default("transfer"),
  description: z.string().trim().min(3, "Tulis keterangannya (minimal 3 huruf).").max(300),
  partyId: uuid.optional().or(z.literal("").transform(() => undefined)),
  partyName: z.string().trim().max(200).optional().transform((v) => v || undefined),
  reference: z.string().trim().max(120).optional().transform((v) => v || undefined),
  items: z
    .array(
      z.object({
        categoryId: uuid.optional().or(z.literal("").transform(() => undefined)),
        description: z.string().trim().max(300).optional(),
        amount: z.union([z.string(), z.number()]).transform((v, ctx) => {
          const n = parseRupiah(String(v));
          if (n === null || n <= 0n) {
            ctx.addIssue({ code: "custom", message: "Isi jumlah lebih dari 0." });
            return z.NEVER;
          }
          return n;
        }),
      }),
    )
    .min(1, "Isi minimal satu jumlah.")
    .max(100),
});

export type TxInput = z.output<typeof txSchema>;

async function aksesProyek(tx: Tx, aktor: Aktor, projectId: string) {
  if (isCrossProject(aktor.role, aktor.allProjects)) return;
  const m = await tx.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: aktor.id } } });
  if (!m) throw new PesanError("Anda tidak punya akses ke proyek ini.");
}

export async function catat(tx: Tx, aktor: Aktor, input: TxInput, lampiran: BerkasTersimpan[]) {
  if (!can(aktor.role, "tx.create")) throw new PesanError("Anda tidak berwenang mencatat kas.");
  await aksesProyek(tx, aktor, input.projectId);
  const arah = input.kind === "pemasukan" ? "masuk" : "keluar";
  const catIds = [...new Set(input.items.map((i) => i.categoryId).filter((x): x is string => !!x))];
  if (catIds.length !== input.items.length) throw new PesanError("Pilih kategori untuk setiap baris.");
  const cocok = await tx.category.count({ where: { id: { in: catIds }, direction: arah } });
  if (cocok !== catIds.length) throw new PesanError(`Kategori harus kategori kas ${arah}.`);
  if (input.accountId) {
    const a = await tx.account.findUnique({ where: { id: input.accountId } });
    if (!a?.isActive) throw new PesanError("Rekening tidak ditemukan atau nonaktif.");
  }
  let partyName = input.partyName;
  if (input.partyId) {
    const p = await tx.party.findUnique({ where: { id: input.partyId } });
    if (!p) throw new PesanError("Pihak tidak ditemukan.");
    partyName ??= p.name;
  }

  const langsung = can(aktor.role, "tx.verify");
  const amount = jumlahkan(input.items.map((i) => i.amount));
  const number = await nomorBerikutnya(tx, "TRX", input.date);
  const t = await tx.transaction.create({
    data: {
      number,
      projectId: input.projectId,
      date: keyKeTanggal(input.date),
      kind: input.kind,
      accountId: input.accountId ?? null,
      method: input.method,
      amount,
      description: input.description,
      partyId: input.partyId ?? null,
      partyName: partyName ?? null,
      reference: input.reference ?? null,
      status: langsung ? "terverifikasi" : "menunggu_verifikasi",
      createdById: aktor.id,
      verifiedById: langsung ? aktor.id : null,
      verifiedAt: langsung ? new Date() : null,
      items: {
        create: input.items.map((it, i) => ({
          position: i,
          categoryId: it.categoryId ?? null,
          description: it.description || input.description,
          amount: it.amount,
        })),
      },
    },
  });
  if (lampiran.length) {
    await tx.attachment.createMany({
      data: lampiran.map((b) => ({ ...b, kind: "nota" as const, transactionId: t.id, uploadedById: aktor.id })),
    });
  }
  await auditIn(tx, aktor.id, "tx.create", "transaction", t.id, { number, kind: input.kind, amount, langsung });
  if (!langsung) {
    const verifikator = await penerimaBerwenang(tx, "tx.verify", input.projectId);
    await kirim(tx, verifikator, {
      title: "Transaksi kas perlu diverifikasi",
      body: `${aktor.fullName} · ${input.kind === "pemasukan" ? "Masuk" : "Keluar"} ${rupiah(amount)} · ${input.description}`,
      href: `/transaksi/${t.id}`,
    }, aktor.id);
  }
  return { id: t.id, number, langsung };
}

async function kunci(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM "transactions" WHERE id = ${id}::uuid FOR UPDATE`;
  const t = await tx.transaction.findUnique({ where: { id } });
  if (!t) throw new PesanError("Transaksi tidak ditemukan.");
  return t;
}

export async function verifikasi(tx: Tx, aktor: Aktor, id: string) {
  if (!can(aktor.role, "tx.verify")) throw new PesanError("Anda tidak berwenang memverifikasi.");
  const t = await kunci(tx, id);
  await aksesProyek(tx, aktor, t.projectId);
  assertTxTransition(t.status, "terverifikasi");
  await tx.transaction.update({
    where: { id },
    data: { status: "terverifikasi", verifiedById: aktor.id, verifiedAt: new Date() },
  });
  await auditIn(tx, aktor.id, "tx.verify", "transaction", id, { amount: t.amount });
  await kirim(tx, [t.createdById], { title: "Transaksi Anda diverifikasi", body: `${t.number} · ${t.description}`, href: `/transaksi/${id}` }, aktor.id);
}

export async function tolak(tx: Tx, aktor: Aktor, id: string, alasan: string) {
  if (!can(aktor.role, "tx.verify")) throw new PesanError("Anda tidak berwenang menolak transaksi.");
  const t = await kunci(tx, id);
  await aksesProyek(tx, aktor, t.projectId);
  assertTxTransition(t.status, "ditolak");
  await tx.transaction.update({ where: { id }, data: { status: "ditolak", statusNote: alasan } });
  await auditIn(tx, aktor.id, "tx.reject", "transaction", id, { alasan });
  await kirim(tx, [t.createdById], { title: "Transaksi Anda ditolak", body: `${t.number}: ${alasan}`, href: `/transaksi/${id}` }, aktor.id);
}

export async function batalkan(tx: Tx, aktor: Aktor, id: string, alasan: string) {
  const t = await kunci(tx, id);
  await aksesProyek(tx, aktor, t.projectId);
  if (t.requestId) {
    throw new PesanError("Transaksi ini berasal dari pengajuan – batalkan lewat halaman pengajuannya supaya statusnya ikut kembali.");
  }
  const pembuatMenunggu = t.createdById === aktor.id && t.status === "menunggu_verifikasi";
  if (!can(aktor.role, "tx.verify") && !pembuatMenunggu) throw new PesanError("Anda tidak berwenang membatalkan transaksi ini.");
  assertTxTransition(t.status, "dibatalkan");
  await tx.transaction.update({ where: { id }, data: { status: "dibatalkan", statusNote: alasan } });
  await auditIn(tx, aktor.id, "tx.cancel", "transaction", id, { alasan, amount: t.amount });
}
