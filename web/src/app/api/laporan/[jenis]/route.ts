import { NextResponse } from "next/server";
import type { TransactionStatus } from "@/generated/prisma/enums";
import { accessibleProjectIds, getCurrentUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { ringkasanPerProyek, biayaPerKategori } from "@/lib/keuangan/queries";
import { statusAnggaran } from "@/lib/keuangan/hitung";
import { bukuBaru, responsXlsx, tambahSheet } from "@/lib/laporan/excel";
import { bacaPeriode } from "@/lib/laporan/periode";
import { REQUEST_KIND_LABEL, REQUEST_STATUS_LABEL, TX_CASH_SIGN, TX_KIND_LABEL, TX_STATUS_LABEL } from "@/lib/lifecycle";
import { scopePengajuan } from "@/lib/pengajuan/queries";
import { fmtTanggal, hariIniKey, keyKeTanggal } from "@/lib/tanggal";
import { whereTransaksi } from "@/lib/transaksi/queries";

export const dynamic = "force-dynamic";

/** Ekspor Excel: /api/laporan/transaksi | proyek | pengajuan (+ filter query yang sama dengan layar). */
export async function GET(req: Request, { params }: { params: Promise<{ jenis: string }> }) {
  const { jenis } = await params;
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Silakan masuk dulu.", { status: 401 });
  if (!can(user.role, "report.view")) return new NextResponse("Tidak ditemukan.", { status: 404 });
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const today = hariIniKey();
  const wb = bukuBaru();

  if (jenis === "transaksi") {
    const arah = sp.arah === "masuk" || sp.arah === "keluar" ? sp.arah : undefined;
    const where = await whereTransaksi(user, {
      q: sp.q,
      projectId: sp.proyek,
      accountId: sp.rekening,
      arah,
      status: sp.status as TransactionStatus | undefined,
      dari: sp.dari,
      sampai: sp.sampai,
    });
    const rows = await db.transaction.findMany({
      where,
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      take: 50_000,
      include: {
        project: { select: { code: true } },
        account: { select: { name: true } },
        request: { select: { number: true } },
        items: { include: { category: { select: { name: true } } } },
      },
    });
    // Satu baris per rincian supaya bisa di-pivot per kategori di Excel.
    const baris = rows.flatMap((t) =>
      t.items.map((it) => {
        const sign = TX_CASH_SIGN[t.kind];
        return {
          tanggal: t.date,
          nomor: t.number,
          proyek: t.project.code,
          jenis: TX_KIND_LABEL[t.kind],
          kategori: it.category?.name ?? "",
          uraian: it.description,
          pihak: t.partyName ?? "",
          rekening: t.account?.name ?? "",
          masuk: sign > 0 ? it.amount : null,
          keluar: sign < 0 ? it.amount : null,
          status: TX_STATUS_LABEL[t.status],
          pengajuan: t.request?.number ?? "",
          referensi: t.reference ?? "",
        };
      }),
    );
    tambahSheet(
      wb,
      "Buku Kas",
      "Buku Kas",
      `Diekspor ${fmtTanggal(today)} oleh ${user.fullName}${sp.dari || sp.sampai ? ` · ${sp.dari ?? "awal"} s/d ${sp.sampai ?? "sekarang"}` : ""}`,
      [
        { header: "Tanggal", key: "tanggal", tanggal: true, width: 12 },
        { header: "Nomor", key: "nomor", width: 18 },
        { header: "Proyek", key: "proyek", width: 10 },
        { header: "Jenis", key: "jenis", width: 20 },
        { header: "Kategori", key: "kategori", width: 18 },
        { header: "Uraian", key: "uraian", width: 40 },
        { header: "Pihak", key: "pihak", width: 24 },
        { header: "Rekening", key: "rekening", width: 18 },
        { header: "Masuk", key: "masuk", uang: true },
        { header: "Keluar", key: "keluar", uang: true },
        { header: "Status", key: "status", width: 18 },
        { header: "Pengajuan", key: "pengajuan", width: 18 },
        { header: "Referensi", key: "referensi", width: 18 },
      ],
      baris,
    );
    return responsXlsx(wb, `buku-kas-${today}.xlsx`);
  }

  if (jenis === "proyek") {
    const ids = await accessibleProjectIds(user);
    const periode = bacaPeriode(sp);
    const [projects, per, kategori] = await Promise.all([
      db.project.findMany({ where: ids === null ? {} : { id: { in: ids } }, orderBy: { code: "asc" } }),
      ringkasanPerProyek(ids),
      biayaPerKategori(sp.proyek ? [sp.proyek] : ids, periode),
    ]);
    tambahSheet(
      wb,
      "Ringkasan proyek",
      "Ringkasan keuangan per proyek",
      `Seluruh periode · diekspor ${fmtTanggal(today)}`,
      [
        { header: "Kode", key: "kode", width: 10 },
        { header: "Proyek", key: "nama", width: 36 },
        { header: "Status", key: "status", width: 10 },
        { header: "Nilai kontrak", key: "kontrak", uang: true },
        { header: "Anggaran", key: "anggaran", uang: true },
        { header: "Pendapatan", key: "pendapatan", uang: true },
        { header: "Biaya", key: "biaya", uang: true },
        { header: "Uang muka berjalan", key: "umb", uang: true },
        { header: "Terpakai", key: "terpakai", uang: true },
        { header: "% anggaran", key: "persen", width: 12 },
        { header: "Saldo", key: "saldo", uang: true },
      ],
      projects.map((p) => {
        const r = per.get(p.id);
        const s = statusAnggaran(r?.terpakai ?? 0n, p.budget);
        return {
          kode: p.code,
          nama: p.name,
          status: p.status,
          kontrak: p.contractValue,
          anggaran: p.budget,
          pendapatan: r?.pendapatan ?? 0n,
          biaya: r?.biaya ?? 0n,
          umb: r?.uangMukaBerjalan ?? 0n,
          terpakai: r?.terpakai ?? 0n,
          persen: s.persen === null ? "" : `${s.persen}%`,
          saldo: r?.saldo ?? 0n,
        };
      }),
    );
    tambahSheet(
      wb,
      "Biaya per kategori",
      "Biaya per kategori",
      periode.dari || periode.sampai ? `${periode.dari ?? "awal"} s/d ${periode.sampai ?? "sekarang"}` : "Seluruh periode",
      [
        { header: "Kategori", key: "name", width: 30 },
        { header: "Biaya", key: "amount", uang: true },
      ],
      kategori,
    );
    return responsXlsx(wb, `ringkasan-proyek-${today}.xlsx`);
  }

  if (jenis === "pengajuan") {
    const scope = await scopePengajuan(user);
    const periode = bacaPeriode(sp);
    const rows = await db.paymentRequest.findMany({
      where: {
        AND: [
          scope,
          { status: { not: "draft" } },
          ...(sp.proyek ? [{ projectId: sp.proyek }] : []),
          ...(periode.dari ? [{ submittedAt: { gte: keyKeTanggal(periode.dari) } }] : []),
          ...(periode.sampai ? [{ submittedAt: { lt: new Date(keyKeTanggal(periode.sampai).getTime() + 86_400_000) } }] : []),
        ],
      },
      orderBy: { submittedAt: "asc" },
      take: 50_000,
      include: {
        project: { select: { code: true } },
        requester: { select: { fullName: true } },
        approver: { select: { fullName: true } },
        payer: { select: { fullName: true } },
      },
    });
    tambahSheet(
      wb,
      "Pengajuan",
      "Daftar pengajuan pembayaran",
      `Diekspor ${fmtTanggal(today)}`,
      [
        { header: "Nomor", key: "nomor", width: 18 },
        { header: "Diajukan", key: "diajukan", tanggal: true, width: 12 },
        { header: "Proyek", key: "proyek", width: 10 },
        { header: "Jenis", key: "jenis", width: 16 },
        { header: "Keperluan", key: "judul", width: 40 },
        { header: "Pemohon", key: "pemohon", width: 20 },
        { header: "Penerima", key: "penerima", width: 24 },
        { header: "Total", key: "total", uang: true },
        { header: "Status", key: "status", width: 22 },
        { header: "Disetujui", key: "penyetuju", width: 20 },
        { header: "Dibayar", key: "dibayar", tanggal: true, width: 12 },
        { header: "Pembayar", key: "pembayar", width: 20 },
      ],
      rows.map((p) => ({
        nomor: p.number,
        diajukan: p.submittedAt,
        proyek: p.project.code,
        jenis: REQUEST_KIND_LABEL[p.kind],
        judul: p.title,
        pemohon: p.requester.fullName,
        penerima: p.payeeName ?? "",
        total: p.total,
        status: REQUEST_STATUS_LABEL[p.status],
        penyetuju: p.approver?.fullName ?? "",
        dibayar: p.paidDate,
        pembayar: p.payer?.fullName ?? "",
      })),
    );
    return responsXlsx(wb, `pengajuan-${today}.xlsx`);
  }

  return new NextResponse("Laporan tidak dikenal.", { status: 404 });
}
