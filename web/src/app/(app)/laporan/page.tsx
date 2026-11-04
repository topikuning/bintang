import { Download, FileSpreadsheet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { GrafikArusKas } from "@/components/grafik/arus-kas";
import { AnggaranBar } from "@/components/proyek/anggaran-bar";
import { ButtonLink, Card, CardHeader, Kpi, LinkTabs, PageHeader, ProgressBar, qs } from "@/components/ui";
import { FilterBar } from "@/components/ui/filter-bar";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { accessibleProjectIds, requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { arusKasBulanan, biayaPerKategori, ringkasan, ringkasanPerProyek } from "@/lib/keuangan/queries";
import { bacaPeriode, PRESET_LABEL, type Preset } from "@/lib/laporan/periode";
import { fmtTanggal, hariIniKey } from "@/lib/tanggal";
import { rupiah, rupiahRingkas } from "@/lib/uang";

export const metadata: Metadata = { title: "Laporan" };

export default async function LaporanPage({
  searchParams,
}: {
  searchParams: Promise<{ periode?: string; dari?: string; sampai?: string; proyek?: string }>;
}) {
  const sp = await searchParams;
  const user = await requireUser();
  requireCapabilityPage(user.role, "report.view");
  const ids = await accessibleProjectIds(user);
  const lingkup = sp.proyek ? (ids === null || ids.includes(sp.proyek) ? [sp.proyek] : []) : ids;
  const periode = bacaPeriode(sp);
  const today = hariIniKey();

  const [r, kategori, grafik, projects, per] = await Promise.all([
    ringkasan(lingkup, periode),
    biayaPerKategori(lingkup, periode),
    arusKasBulanan(lingkup, 12, periode.sampai ?? today),
    db.project.findMany({ where: ids === null ? {} : { id: { in: ids } }, orderBy: { code: "asc" } }),
    ringkasanPerProyek(lingkup),
  ]);
  const totalBiaya = kategori.reduce((a, k) => a + k.amount, 0n);
  const label = periode.preset ? PRESET_LABEL[periode.preset] : `${periode.dari ? fmtTanggal(periode.dari) : "awal"} – ${periode.sampai ? fmtTanggal(periode.sampai) : "sekarang"}`;

  return (
    <>
      <PageHeader
        title="Laporan keuangan"
        description={`Periode: ${label}. Hanya transaksi terverifikasi.`}
        actions={
          <>
            <ButtonLink href={`/api/laporan/transaksi${qs({ proyek: sp.proyek, dari: periode.dari, sampai: periode.sampai })}`} external>
              <Download aria-hidden className="size-4" /> Buku kas
            </ButtonLink>
            <ButtonLink href={`/api/laporan/proyek${qs({ proyek: sp.proyek, dari: periode.dari, sampai: periode.sampai })}`} external>
              <FileSpreadsheet aria-hidden className="size-4" /> Ringkasan proyek
            </ButtonLink>
            <ButtonLink href={`/api/laporan/pengajuan${qs({ proyek: sp.proyek, dari: periode.dari, sampai: periode.sampai })}`} external>
              <FileSpreadsheet aria-hidden className="size-4" /> Pengajuan
            </ButtonLink>
          </>
        }
      />

      <LinkTabs
        className="mb-3"
        active={periode.preset ?? "custom"}
        items={(Object.keys(PRESET_LABEL) as Preset[]).map((p) => ({ key: p, label: PRESET_LABEL[p], href: `/laporan${qs({ periode: p, proyek: sp.proyek })}` }))}
      />
      <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-end">
        <form className="flex flex-wrap items-end gap-2" action="/laporan">
          {sp.proyek ? <input type="hidden" name="proyek" value={sp.proyek} /> : null}
          <label className="text-[13px]">
            <span className="mb-1 block font-medium">Dari</span>
            <input type="date" name="dari" defaultValue={periode.dari} className="h-10 rounded-md border border-border bg-surface px-3 text-base sm:text-sm" />
          </label>
          <label className="text-[13px]">
            <span className="mb-1 block font-medium">Sampai</span>
            <input type="date" name="sampai" defaultValue={periode.sampai} className="h-10 rounded-md border border-border bg-surface px-3 text-base sm:text-sm" />
          </label>
          <button type="submit" className="h-10 rounded-md border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-muted">
            Terapkan
          </button>
        </form>
        <Suspense>
          <FilterBar
            search={false}
            selects={[{ param: "proyek", label: "Proyek", allLabel: "Semua proyek", options: projects.map((p) => ({ value: p.id, label: `${p.code} – ${p.name}` })) }]}
          />
        </Suspense>
      </div>

      <section className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Kas masuk" value={rupiahRingkas(r.kasMasuk)} tone="masuk" sub={rupiah(r.kasMasuk)} />
        <Kpi label="Kas keluar" value={rupiahRingkas(r.kasKeluar)} tone="keluar" sub={rupiah(r.kasKeluar)} />
        <Kpi label="Pendapatan" value={rupiahRingkas(r.pendapatan)} sub="Pemasukan proyek" />
        <Kpi label="Biaya" value={rupiahRingkas(r.biaya)} sub="Termasuk realisasi uang muka" />
        <Kpi label="Uang muka berjalan" value={rupiahRingkas(r.uangMukaBerjalan)} tone="warning" sub="Belum di-LPJ-kan" />
      </section>

      <div className="mb-5 grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Arus kas 12 bulan" />
          <div className="px-4 py-3">
            <GrafikArusKas data={grafik} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Biaya per kategori" subtitle={`Total ${rupiah(totalBiaya)}`} />
          {kategori.length ? (
            <ul className="space-y-3 px-4 py-4">
              {kategori.map((k) => (
                <li key={k.categoryId ?? "none"}>
                  <div className="mb-1 flex justify-between gap-2 text-sm">
                    <span>{k.name}</span>
                    <span className="tabular font-medium">
                      {rupiah(k.amount)}
                      <span className="ml-1.5 text-xs text-ink-faint">{totalBiaya > 0n ? Math.round(Number((k.amount * 1000n) / totalBiaya) / 10) : 0}%</span>
                    </span>
                  </div>
                  <ProgressBar value={totalBiaya > 0n ? Number((k.amount * 100n) / totalBiaya) : 0} label={k.name} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-8 text-center text-[13px] text-ink-muted">Belum ada biaya pada periode ini.</p>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Per proyek" subtitle="Seluruh periode (anggaran berlaku untuk umur proyek)" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted text-left text-xs text-ink-muted">
                <th className="px-4 py-2.5 font-medium">Proyek</th>
                <th className="px-3 py-2.5 text-right font-medium">Pendapatan</th>
                <th className="px-3 py-2.5 text-right font-medium">Biaya</th>
                <th className="px-3 py-2.5 text-right font-medium">Uang muka</th>
                <th className="px-3 py-2.5 text-right font-medium">Saldo</th>
                <th className="w-56 px-4 py-2.5 font-medium">Anggaran</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {projects
                .filter((p) => lingkup === null || lingkup.includes(p.id))
                .map((p) => {
                  const x = per.get(p.id);
                  return (
                    <tr key={p.id} className="hover:bg-surface-muted">
                      <td className="px-4 py-2.5">
                        <Link href={`/proyek/${p.id}`} className="font-medium hover:underline">
                          <span className="tabular text-ink-muted">{p.code}</span> {p.name}
                        </Link>
                      </td>
                      <td className="tabular px-3 py-2.5 text-right text-masuk">{rupiahRingkas(x?.pendapatan ?? 0n)}</td>
                      <td className="tabular px-3 py-2.5 text-right text-keluar">{rupiahRingkas(x?.biaya ?? 0n)}</td>
                      <td className="tabular px-3 py-2.5 text-right">{rupiahRingkas(x?.uangMukaBerjalan ?? 0n)}</td>
                      <td className="tabular px-3 py-2.5 text-right font-medium">{rupiahRingkas(x?.saldo ?? 0n)}</td>
                      <td className="px-4 py-2.5">
                        <AnggaranBar terpakai={x?.terpakai ?? 0n} anggaran={p.budget} ringkas />
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
