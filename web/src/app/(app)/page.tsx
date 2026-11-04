import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  FilePen,
  FileText,
  Hourglass,
  Landmark,
  PartyPopper,
  Plus,
  RotateCcw,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { GrafikArusKas } from "@/components/grafik/arus-kas";
import { BarisPengajuan } from "@/components/pengajuan/baris-pengajuan";
import { AnggaranBar } from "@/components/proyek/anggaran-bar";
import { Card, CardHeader, Kpi } from "@/components/ui";
import { accessibleProjectIds, requireUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { cn } from "@/lib/cn";
import { db } from "@/lib/db";
import { arusKasBulanan, ringkasan, ringkasanPerProyek, saldoRekening, saldoTanpaRekening } from "@/lib/keuangan/queries";
import { statusAnggaran } from "@/lib/keuangan/hitung";
import { ambilPengaturan } from "@/lib/pengaturan";
import { scopePengajuan, tugasSaya } from "@/lib/pengajuan/queries";
import { fmtTanggal, hariIniKey, rentangBulan } from "@/lib/tanggal";
import { jumlahkan, rupiah, rupiahRingkas } from "@/lib/uang";

export const metadata: Metadata = { title: "Beranda" };

function sapaan() {
  const jam = Number(new Intl.DateTimeFormat("id-ID", { hour: "numeric", hour12: false, timeZone: "Asia/Jakarta" }).format(new Date()));
  if (jam < 11) return "Selamat pagi";
  if (jam < 15) return "Selamat siang";
  if (jam < 18) return "Selamat sore";
  return "Selamat malam";
}

type Tugas = { key: string; label: string; ket: string; n: number; total?: bigint; href: string; icon: typeof Wallet; tone: string };

export default async function BerandaPage() {
  const user = await requireUser();
  const setting = await ambilPengaturan();
  const today = hariIniKey();
  const bulan = rentangBulan(today);
  const ids = await accessibleProjectIds(user);
  const bolehKas = can(user.role, "tx.view");

  const [tugas, txMenunggu, terbaru] = await Promise.all([
    tugasSaya(user, setting.financeApproveCap),
    can(user.role, "tx.verify")
      ? db.transaction.count({ where: { status: "menunggu_verifikasi", ...(ids === null ? {} : { projectId: { in: ids } }) } })
      : Promise.resolve(0),
    scopePengajuan(user).then((scope) =>
      db.paymentRequest.findMany({
        where: { AND: [scope, { requesterId: user.id }] },
        orderBy: { updatedAt: "desc" },
        take: 5,
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
          updatedAt: true,
          requester: { select: { fullName: true } },
          project: { select: { code: true, name: true } },
          _count: { select: { attachments: true } },
        },
      }),
    ),
  ]);

  const daftar: Tugas[] = [];
  const t = (key: string, v: { n: number; total: bigint } | null, label: string, ket: string, href: string, icon: typeof Wallet, tone: string) => {
    if (v && v.n > 0) daftar.push({ key, label, ket, n: v.n, total: v.total, href, icon, tone });
  };
  t("setujui", tugas.setujui, "Menunggu persetujuan Anda", "Periksa lalu setujui, minta revisi, atau tolak", "/pengajuan?tab=tindakan", ShieldCheck, "bg-primary-100 text-primary-700");
  t("bayar", tugas.bayar, "Siap dibayar", "Sudah disetujui, tinggal ditransfer", "/pengajuan?tab=disetujui", CircleDollarSign, "bg-success-soft text-success");
  t("lpj", tugas.lpjPeriksa, "LPJ perlu diperiksa", "Laporan pemakaian uang muka", "/pengajuan?tab=lpj", ClipboardCheck, "bg-info-soft text-info");
  t("revisi", tugas.revisi, "Perlu Anda perbaiki", "Dikembalikan dengan catatan", "/pengajuan?tab=tindakan", RotateCcw, "bg-warning-soft text-warning");
  t("lpjSaya", tugas.lpjSaya, "Uang muka belum di-LPJ-kan", "Laporkan pemakaiannya beserta nota", "/pengajuan?tab=lpj", Wallet, "bg-gold-soft text-warning");
  if (txMenunggu > 0) {
    daftar.push({
      key: "tx",
      label: "Transaksi menunggu verifikasi",
      ket: "Kas yang dicatat admin proyek",
      n: txMenunggu,
      href: "/transaksi?status=menunggu_verifikasi",
      icon: Hourglass,
      tone: "bg-surface-inset text-ink-muted",
    });
  }

  // Ringkasan keuangan (hanya untuk yang boleh melihat buku kas).
  let keuangan: null | {
    saldo: bigint;
    bulanIni: Awaited<ReturnType<typeof ringkasan>>;
    komitmen: bigint;
    grafik: Awaited<ReturnType<typeof arusKasBulanan>>;
    rekening: Awaited<ReturnType<typeof saldoRekening>>;
    tanpaRekening: bigint;
    proyek: { id: string; code: string; name: string; budget: bigint; terpakai: bigint }[];
  } = null;
  if (bolehKas) {
    const [semua, bulanIni, grafik, rekening, perProyek, komitmen, projects, tanpaRekening] = await Promise.all([
      ringkasan(ids),
      ringkasan(ids, bulan),
      arusKasBulanan(ids, 6, today),
      ids === null ? saldoRekening() : Promise.resolve([]),
      ringkasanPerProyek(ids),
      db.paymentRequest.aggregate({
        where: { status: { in: ["diajukan", "disetujui"] }, ...(ids === null ? {} : { projectId: { in: ids } }) },
        _sum: { total: true },
      }),
      db.project.findMany({
        where: { status: "aktif", ...(ids === null ? {} : { id: { in: ids } }) },
        select: { id: true, code: true, name: true, budget: true },
      }),
      ids === null ? saldoTanpaRekening() : Promise.resolve(0n),
    ]);
    const saldoTotal = ids === null ? jumlahkan(rekening.map((r) => r.saldo)) + tanpaRekening : semua.saldo;
    keuangan = {
      saldo: saldoTotal,
      bulanIni,
      komitmen: komitmen._sum.total ?? 0n,
      grafik,
      rekening,
      tanpaRekening,
      proyek: projects
        .map((p) => ({ ...p, terpakai: perProyek.get(p.id)?.terpakai ?? 0n }))
        .sort((a, b) => (statusAnggaran(b.terpakai, b.budget).persen ?? -1) - (statusAnggaran(a.terpakai, a.budget).persen ?? -1))
        .slice(0, 5),
    };
  }

  const namaDepan = user.fullName.split(" ")[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[13px] text-ink-muted">{fmtTanggal(today, "EEEE, d MMMM yyyy")}</p>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            {sapaan()}, {namaDepan}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {can(user.role, "request.create") ? (
            <Link href="/pengajuan/baru" className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-white shadow-xs hover:bg-primary-800">
              <Plus aria-hidden className="size-4" /> Ajukan pembayaran
            </Link>
          ) : null}
          {can(user.role, "tx.create") ? (
            <Link href="/transaksi/baru" className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-muted">
              <FileText aria-hidden className="size-4" /> Catat kas
            </Link>
          ) : null}
        </div>
      </div>

      {/* Tugas saya */}
      <section aria-labelledby="tugas">
        <h2 id="tugas" className="mb-2 text-sm font-semibold text-ink">
          Perlu tindakan Anda
        </h2>
        {daftar.length === 0 ? (
          <div className="flex items-center gap-3 rounded-xl border border-success-border bg-success-soft px-4 py-4">
            <PartyPopper aria-hidden className="size-6 shrink-0 text-success" />
            <div>
              <p className="text-sm font-semibold text-ink">Tidak ada yang menunggu Anda</p>
              <p className="text-[13px] text-ink-muted">Pengajuan yang perlu Anda setujui, bayar, atau perbaiki akan muncul di sini.</p>
            </div>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {daftar.map((d) => (
              <li key={d.key} className="min-w-0">
                <Link
                  href={d.href}
                  className="group flex h-full items-center gap-3 rounded-xl border border-border bg-surface p-4 shadow-(--shadow-card) transition-colors hover:border-primary-300 hover:bg-primary-50/40"
                >
                  <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-lg", d.tone)}>
                    <d.icon aria-hidden className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="tabular text-2xl leading-none font-semibold text-ink">{d.n}</span>
                      <span className="truncate text-sm font-semibold text-ink">{d.label}</span>
                    </span>
                    <span className="mt-1 block truncate text-xs text-ink-muted">
                      {d.total !== undefined ? `${rupiah(d.total)} · ` : ""}
                      {d.ket}
                    </span>
                  </span>
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-faint group-hover:text-primary-600" />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {tugas.draf && tugas.draf.n > 0 ? (
          <Link href="/pengajuan?tab=draf" className="mt-2 inline-flex items-center gap-1.5 text-[13px] text-ink-muted hover:text-ink">
            <FilePen aria-hidden className="size-3.5" /> Anda punya {tugas.draf.n} draf yang belum dikirim
          </Link>
        ) : null}
      </section>

      {keuangan ? (
        <>
          <section aria-label="Ringkasan kas" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label={ids === null ? "Saldo semua rekening" : "Saldo proyek Anda"} value={rupiahRingkas(keuangan.saldo)} icon={Landmark} sub={rupiah(keuangan.saldo)} />
            <Kpi label="Masuk bulan ini" value={rupiahRingkas(keuangan.bulanIni.kasMasuk)} tone="masuk" icon={ArrowDownLeft} href="/laporan" />
            <Kpi label="Keluar bulan ini" value={rupiahRingkas(keuangan.bulanIni.kasKeluar)} tone="keluar" icon={ArrowUpRight} href="/laporan" />
            <Kpi
              label="Komitmen berjalan"
              value={rupiahRingkas(keuangan.komitmen)}
              tone="warning"
              icon={Hourglass}
              sub="Pengajuan menunggu & siap dibayar"
              href="/pengajuan?tab=menunggu"
            />
          </section>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <Card>
              <CardHeader title="Arus kas 6 bulan" subtitle="Hanya transaksi terverifikasi" />
              <div className="px-4 py-3">
                <GrafikArusKas data={keuangan.grafik} />
              </div>
            </Card>
            <Card>
              <CardHeader
                title="Anggaran proyek"
                subtitle="Yang paling dekat batas di atas"
                action={
                  <Link href="/proyek" className="text-[13px] font-medium text-primary-700 hover:underline">
                    Semua
                  </Link>
                }
              />
              <ul className="divide-y divide-border">
                {keuangan.proyek.map((p) => (
                  <li key={p.id}>
                    <Link href={`/proyek/${p.id}`} className="block px-4 py-3 hover:bg-surface-muted">
                      <p className="mb-1.5 truncate text-sm font-medium">
                        <span className="tabular text-ink-muted">{p.code}</span> {p.name}
                      </p>
                      <AnggaranBar terpakai={p.terpakai} anggaran={p.budget} ringkas />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          {keuangan.rekening.length ? (
            <Card>
              <CardHeader title="Saldo rekening & kas" />
              <ul className="grid divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                {keuangan.rekening
                  .filter((r) => r.isActive)
                  .map((r) => (
                    <li key={r.id} className="px-4 py-3">
                      <p className="text-xs text-ink-muted">
                        {r.name}
                        {r.bankName ? ` · ${r.bankName}` : ""}
                      </p>
                      <p className={cn("tabular text-base font-semibold", r.saldo < 0n && "text-danger")}>{rupiah(r.saldo)}</p>
                    </li>
                  ))}
                {keuangan.tanpaRekening !== 0n ? (
                  <li className="px-4 py-3">
                    <p className="text-xs text-ink-muted">Tanpa rekening (data lama)</p>
                    <p className={cn("tabular text-base font-semibold", keuangan.tanpaRekening < 0n && "text-danger")}>{rupiah(keuangan.tanpaRekening)}</p>
                  </li>
                ) : null}
              </ul>
            </Card>
          ) : null}
        </>
      ) : null}

      {terbaru.length ? (
        <Card>
          <CardHeader
            title="Pengajuan saya terakhir"
            action={
              <Link href="/pengajuan?tab=saya" className="text-[13px] font-medium text-primary-700 hover:underline">
                Semua
              </Link>
            }
          />
          <ul className="divide-y divide-border">
            {terbaru.map((r) => (
              <BarisPengajuan key={r.id} r={r} today={today} />
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
