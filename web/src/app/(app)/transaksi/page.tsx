import { ArrowDownLeft, ArrowUpRight, Download, Paperclip, Plus, Repeat, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Badge, ButtonLink, Card, EmptyState, Kpi, LinkTabs, PageHeader, Pagination, qs } from "@/components/ui";
import { FilterBar } from "@/components/ui/filter-bar";
import type { TransactionStatus } from "@/generated/prisma/enums";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { accessibleProjectIds, requireUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { cn } from "@/lib/cn";
import { db } from "@/lib/db";
import { ringkasan } from "@/lib/keuangan/queries";
import { TX_CASH_SIGN, TX_KIND_LABEL, TX_STATUS_LABEL, TX_STATUS_TONE } from "@/lib/lifecycle";
import { fmtTanggal, hariIniKey, rentangBulan } from "@/lib/tanggal";
import { daftarTransaksi } from "@/lib/transaksi/queries";
import { angka, rupiahRingkas } from "@/lib/uang";

export const metadata: Metadata = { title: "Buku Kas" };

const STATUS: TransactionStatus[] = ["menunggu_verifikasi", "terverifikasi", "ditolak", "dibatalkan"];

export default async function TransaksiPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; proyek?: string; rekening?: string; arah?: string; status?: string; dari?: string; sampai?: string; hal?: string }>;
}) {
  const sp = await searchParams;
  const user = await requireUser();
  requireCapabilityPage(user.role, "tx.view");
  const ids = await accessibleProjectIds(user);
  const arah = sp.arah === "masuk" || sp.arah === "keluar" ? sp.arah : undefined;
  const status = STATUS.includes(sp.status as TransactionStatus) ? (sp.status as TransactionStatus) : undefined;
  const bulan = rentangBulan(hariIniKey());
  const dari = sp.dari ?? undefined;
  const sampai = sp.sampai ?? undefined;

  const [data, projects, accounts, ringkas, menunggu] = await Promise.all([
    daftarTransaksi(user, { q: sp.q, projectId: sp.proyek, accountId: sp.rekening, arah, status, dari, sampai, page: Number(sp.hal) || 1 }),
    db.project.findMany({ where: ids === null ? {} : { id: { in: ids } }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
    db.account.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ringkasan(sp.proyek ? [sp.proyek] : ids, { dari: dari ?? bulan.dari, sampai: sampai ?? bulan.sampai }),
    db.transaction.count({ where: { status: "menunggu_verifikasi", ...(ids === null ? {} : { projectId: { in: ids } }) } }),
  ]);
  const base = { q: sp.q, proyek: sp.proyek, rekening: sp.rekening, arah: sp.arah, status: sp.status, dari: sp.dari, sampai: sp.sampai };
  const periode = dari || sampai ? `${dari ? fmtTanggal(dari) : "awal"} – ${sampai ? fmtTanggal(sampai) : "sekarang"}` : "Bulan ini";

  return (
    <>
      <PageHeader
        title="Buku Kas"
        description="Semua uang masuk & keluar. Pembayaran pengajuan tercatat di sini otomatis."
        actions={
          <>
            {can(user.role, "report.view") ? (
              <ButtonLink href={`/api/laporan/transaksi${qs({ ...base, hal: undefined })}`} external variant="secondary">
                <Download aria-hidden className="size-4" /> Excel
              </ButtonLink>
            ) : null}
            {can(user.role, "tx.create") ? (
              <ButtonLink href="/transaksi/baru" variant="primary">
                <Plus aria-hidden className="size-4" /> Catat kas
              </ButtonLink>
            ) : null}
          </>
        }
      />

      <section className="mb-4 grid grid-cols-3 gap-2 sm:gap-3">
        <Kpi label={`Masuk · ${periode}`} value={rupiahRingkas(ringkas.kasMasuk)} tone="masuk" icon={ArrowDownLeft} />
        <Kpi label="Keluar" value={rupiahRingkas(ringkas.kasKeluar)} tone="keluar" icon={ArrowUpRight} />
        <Kpi label="Selisih" value={rupiahRingkas(ringkas.saldo)} tone={ringkas.saldo < 0n ? "danger" : "default"} icon={Repeat} />
      </section>

      <LinkTabs
        className="mb-3"
        active={arah ?? (status === "menunggu_verifikasi" ? "menunggu" : "semua")}
        items={[
          { key: "semua", label: "Semua", href: `/transaksi${qs({ ...base, arah: undefined, status: undefined, hal: undefined })}` },
          { key: "masuk", label: "Masuk", href: `/transaksi${qs({ ...base, arah: "masuk", status: undefined, hal: undefined })}` },
          { key: "keluar", label: "Keluar", href: `/transaksi${qs({ ...base, arah: "keluar", status: undefined, hal: undefined })}` },
          {
            key: "menunggu",
            label: "Menunggu verifikasi",
            href: `/transaksi${qs({ ...base, arah: undefined, status: "menunggu_verifikasi", hal: undefined })}`,
            count: menunggu,
            highlight: can(user.role, "tx.verify"),
          },
        ]}
      />
      <Suspense>
        <FilterBar
          className="mb-4"
          placeholder="Cari keterangan, nomor, pihak, referensi…"
          selects={[
            { param: "proyek", label: "Proyek", allLabel: "Semua proyek", options: projects.map((p) => ({ value: p.id, label: `${p.code} – ${p.name}` })) },
            { param: "rekening", label: "Rekening", allLabel: "Semua rekening", options: accounts.map((a) => ({ value: a.id, label: a.name })) },
          ]}
        />
      </Suspense>

      {data.rows.length === 0 ? (
        <EmptyState icon={Wallet} title="Belum ada transaksi" description="Ubah saringan, atau catat kas masuk/keluar pertama." />
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {data.rows.map((t) => {
              const sign = TX_CASH_SIGN[t.kind];
              const batal = t.status === "ditolak" || t.status === "dibatalkan";
              return (
                <li key={t.id}>
                  <Link href={`/transaksi/${t.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-muted">
                    <span
                      className={cn(
                        "flex size-9 shrink-0 items-center justify-center rounded-full",
                        sign > 0 ? "bg-masuk-soft text-masuk" : sign < 0 ? "bg-keluar-soft text-keluar" : "bg-surface-inset text-ink-muted",
                      )}
                    >
                      {sign > 0 ? <ArrowDownLeft aria-hidden className="size-4" /> : sign < 0 ? <ArrowUpRight aria-hidden className="size-4" /> : <Repeat aria-hidden className="size-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <p className={cn("min-w-0 truncate text-sm font-medium", batal && "text-ink-faint line-through")}>{t.description}</p>
                        <p
                          className={cn(
                            "tabular shrink-0 text-sm font-semibold",
                            batal ? "text-ink-faint line-through" : sign > 0 ? "text-masuk" : sign < 0 ? "text-keluar" : "text-ink-muted",
                          )}
                        >
                          {sign > 0 ? "+" : sign < 0 ? "−" : ""}
                          {angka(t.amount)}
                        </p>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-ink-muted">
                        <span>{fmtTanggal(t.date)}</span>
                        <span className="tabular">{t.number}</span>
                        <span>{t.project.code}</span>
                        <span className="hidden sm:inline">{t.items[0]?.category?.name ?? TX_KIND_LABEL[t.kind]}</span>
                        {t.account ? <span className="hidden md:inline">{t.account.name}</span> : null}
                        {t._count.attachments ? (
                          <span className="inline-flex items-center gap-0.5">
                            <Paperclip aria-hidden className="size-3" />
                            {t._count.attachments}
                          </span>
                        ) : null}
                        {t.requestId ? <Badge tone="info">Pengajuan</Badge> : null}
                        {t.status !== "terverifikasi" ? <Badge tone={TX_STATUS_TONE[t.status]}>{TX_STATUS_LABEL[t.status]}</Badge> : null}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      <Pagination page={data.page} pages={data.pages} total={data.total} href={(h) => `/transaksi${qs({ ...base, hal: h })}`} />
    </>
  );
}
