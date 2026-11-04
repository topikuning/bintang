import { ArrowDownLeft, ArrowUpRight, Banknote, Hourglass, Pencil, Plus, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BarisPengajuan } from "@/components/pengajuan/baris-pengajuan";
import { AnggaranBar } from "@/components/proyek/anggaran-bar";
import { Avatar, Badge, ButtonLink, Card, CardBody, CardHeader, Kpi, ProgressBar } from "@/components/ui";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { hasProjectAccess, requireUser } from "@/lib/auth/session";
import { can, ROLE_LABEL } from "@/lib/authz";
import { db } from "@/lib/db";
import { biayaPerKategori, ringkasan } from "@/lib/keuangan/queries";
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_TONE } from "@/lib/lifecycle";
import { scopePengajuan } from "@/lib/pengajuan/queries";
import { fmtTanggal, hariIniKey } from "@/lib/tanggal";
import { persen, rupiah, rupiahRingkas } from "@/lib/uang";

export const metadata: Metadata = { title: "Proyek" };

export default async function DetailProyekPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  requireCapabilityPage(user.role, "project.view");
  if (!(await hasProjectAccess(user, id))) notFound();
  const p = await db.project.findUnique({
    where: { id },
    include: {
      company: { select: { name: true } },
      members: { include: { user: { select: { fullName: true, role: true, isActive: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!p) notFound();
  const bolehUang = can(user.role, "tx.view");
  const scope = await scopePengajuan(user);
  const [r, kategori, berjalan, komitmen] = await Promise.all([
    bolehUang ? ringkasan([id]) : null,
    bolehUang ? biayaPerKategori([id]) : [],
    db.paymentRequest.findMany({
      where: { AND: [scope, { projectId: id, status: { in: ["diajukan", "disetujui", "perlu_revisi", "lpj_diajukan"] } }] },
      orderBy: [{ urgent: "desc" }, { submittedAt: "asc" }],
      take: 10,
      select: {
        id: true, number: true, title: true, kind: true, status: true, urgent: true, total: true, neededDate: true, payeeName: true,
        submittedAt: true, updatedAt: true, requester: { select: { fullName: true } }, project: { select: { code: true, name: true } },
        _count: { select: { attachments: true } },
      },
    }),
    db.paymentRequest.aggregate({ where: { projectId: id, status: { in: ["diajukan", "disetujui"] } }, _sum: { total: true } }),
  ]);
  const maksKategori = kategori[0]?.amount ?? 0n;
  const today = hariIniKey();

  return (
    <div className="space-y-5">
      <div>
        <Link href="/proyek" className="mb-2 inline-flex text-[13px] font-medium text-ink-muted hover:text-ink">
          ‹ Proyek
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="tabular text-xs font-semibold text-ink-faint">{p.code}</span>
              <Badge tone={PROJECT_STATUS_TONE[p.status]} dot>
                {PROJECT_STATUS_LABEL[p.status]}
              </Badge>
              {p.kind === "operasional" ? <Badge>Operasional</Badge> : null}
            </div>
            <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">{p.name}</h1>
            <p className="mt-1 text-[13px] text-ink-muted">
              {[p.client, p.location, p.company.name].filter(Boolean).join(" · ")}
              {p.startDate ? ` · ${fmtTanggal(p.startDate)} – ${p.endDate ? fmtTanggal(p.endDate) : "…"}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {can(user.role, "project.manage") ? (
              <ButtonLink href={`/proyek/${p.id}/ubah`} variant="secondary">
                <Pencil aria-hidden className="size-4" /> Ubah
              </ButtonLink>
            ) : null}
            {can(user.role, "request.create") && p.status === "aktif" ? (
              <ButtonLink href={`/pengajuan/baru?proyek=${p.id}`} variant="primary">
                <Plus aria-hidden className="size-4" /> Ajukan
              </ButtonLink>
            ) : null}
          </div>
        </div>
      </div>

      {r ? (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Nilai kontrak" value={rupiahRingkas(p.contractValue)} icon={Banknote} sub={rupiah(p.contractValue)} />
            <Kpi
              label="Sudah diterima"
              value={rupiahRingkas(r.pendapatan)}
              tone="masuk"
              icon={ArrowDownLeft}
              sub={p.contractValue > 0n ? `${persen(r.pendapatan, p.contractValue)?.toLocaleString("id-ID")}% dari kontrak` : undefined}
            />
            <Kpi label="Biaya" value={rupiahRingkas(r.biaya)} tone="keluar" icon={ArrowUpRight} sub={r.uangMukaBerjalan > 0n ? `+ uang muka berjalan ${rupiahRingkas(r.uangMukaBerjalan)}` : undefined} />
            <Kpi label="Saldo proyek" value={rupiahRingkas(r.saldo)} tone={r.saldo < 0n ? "danger" : "default"} icon={Wallet} sub="Masuk − keluar" />
          </section>
          <Card>
            <CardHeader title="Anggaran" subtitle={`Anggaran ${rupiah(p.budget)} · terpakai ${rupiah(r.terpakai)}`} />
            <CardBody className="space-y-3">
              <AnggaranBar terpakai={r.terpakai} anggaran={p.budget} />
              {(komitmen._sum.total ?? 0n) > 0n ? (
                <p className="flex items-center gap-1.5 text-[13px] text-ink-muted">
                  <Hourglass aria-hidden className="size-3.5" />
                  Masih ada {rupiah(komitmen._sum.total ?? 0n)} pengajuan yang menunggu/siap dibayar – belum masuk angka terpakai.
                </p>
              ) : null}
            </CardBody>
          </Card>
        </>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader
              title="Pengajuan berjalan"
              action={
                <Link href={`/pengajuan?proyek=${p.id}&tab=semua`} className="text-[13px] font-medium text-primary-700 hover:underline">
                  Semua
                </Link>
              }
            />
            {berjalan.length ? (
              <ul className="divide-y divide-border">
                {berjalan.map((x) => (
                  <BarisPengajuan key={x.id} r={x} today={today} />
                ))}
              </ul>
            ) : (
              <p className="px-4 py-6 text-center text-[13px] text-ink-muted">Tidak ada pengajuan yang sedang berjalan.</p>
            )}
          </Card>
          {kategori.length ? (
            <Card>
              <CardHeader title="Biaya per kategori" subtitle="Termasuk realisasi uang muka yang LPJ-nya diterima" />
              <ul className="space-y-3 px-4 py-4">
                {kategori.map((k) => (
                  <li key={k.categoryId ?? "none"}>
                    <div className="mb-1 flex justify-between gap-2 text-sm">
                      <span>{k.name}</span>
                      <span className="tabular font-medium">{rupiah(k.amount)}</span>
                    </div>
                    <ProgressBar value={maksKategori > 0n ? Number((k.amount * 100n) / maksKategori) : 0} label={k.name} />
                  </li>
                ))}
              </ul>
              {bolehUang ? (
                <div className="border-t border-border px-4 py-2.5 text-right">
                  <Link href={`/transaksi?proyek=${p.id}`} className="text-[13px] font-medium text-primary-700 hover:underline">
                    Lihat buku kas proyek ›
                  </Link>
                </div>
              ) : null}
            </Card>
          ) : null}
        </div>
        <Card>
          <CardHeader title="Tim proyek" subtitle={`${p.members.length} orang`} />
          <ul className="divide-y divide-border">
            {p.members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                <Avatar name={m.user.fullName} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{m.user.fullName}</p>
                  <p className="text-xs text-ink-muted">
                    {ROLE_LABEL[m.user.role]}
                    {!m.user.isActive ? " · nonaktif" : ""}
                  </p>
                </div>
              </li>
            ))}
            {p.members.length === 0 ? <li className="px-4 py-4 text-[13px] text-ink-muted">Belum ada anggota. Keuangan & Pimpinan otomatis bisa melihat semua proyek.</li> : null}
          </ul>
          {p.notes ? <p className="border-t border-border px-4 py-3 text-[13px] whitespace-pre-line text-ink-muted">{p.notes}</p> : null}
        </Card>
      </div>
    </div>
  );
}
