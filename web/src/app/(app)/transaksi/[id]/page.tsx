import { Ban, CheckCircle2, XCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LampiranGrid } from "@/components/pengajuan/lampiran";
import { Badge, Banner, Card, CardBody, CardHeader, DescList } from "@/components/ui";
import { AksiTombol } from "@/components/ui/aksi-tombol";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { accessibleProjectIds, requireUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { cn } from "@/lib/cn";
import { db } from "@/lib/db";
import { TX_CASH_SIGN, TX_KIND_LABEL, TX_STATUS_LABEL, TX_STATUS_TONE } from "@/lib/lifecycle";
import { fmtTanggal, fmtWaktu } from "@/lib/tanggal";
import { batalkanTransaksi, tolakTransaksi, verifikasiTransaksi } from "@/lib/transaksi/actions";
import { rupiah } from "@/lib/uang";

export const metadata: Metadata = { title: "Transaksi" };

const METODE: Record<string, string> = { transfer: "Transfer", tunai: "Tunai", qris: "QRIS", giro: "Giro", lainnya: "–" };
const PESAN: Record<string, string> = {
  tercatat: "Tercatat dan langsung terverifikasi.",
  menunggu: "Tercatat. Keuangan sudah diberi tahu untuk memverifikasi.",
};

export default async function DetailTransaksiPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ pesan?: string }>;
}) {
  const [{ id }, { pesan }] = await Promise.all([params, searchParams]);
  const user = await requireUser();
  requireCapabilityPage(user.role, "tx.view");
  const ids = await accessibleProjectIds(user);
  const t = await db.transaction.findFirst({
    where: { id, ...(ids === null ? {} : { projectId: { in: ids } }) },
    include: {
      project: { select: { id: true, code: true, name: true } },
      account: { select: { name: true } },
      createdBy: { select: { fullName: true } },
      verifiedBy: { select: { fullName: true } },
      request: { select: { id: true, number: true, title: true } },
      items: { orderBy: { position: "asc" }, include: { category: { select: { name: true } } } },
      attachments: true,
    },
  });
  if (!t) notFound();
  const sign = TX_CASH_SIGN[t.kind];
  const bisaVerif = can(user.role, "tx.verify") && t.status === "menunggu_verifikasi";
  const bisaBatal =
    !t.requestId &&
    (t.status === "terverifikasi" || t.status === "menunggu_verifikasi") &&
    (can(user.role, "tx.verify") || (t.createdById === user.id && t.status === "menunggu_verifikasi"));

  return (
    <div className="space-y-5">
      {pesan && PESAN[pesan] ? <Banner tone="success" title={PESAN[pesan]} /> : null}
      <div>
        <Link href="/transaksi" className="mb-2 inline-flex text-[13px] font-medium text-ink-muted hover:text-ink">
          ‹ Buku Kas
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="tabular text-xs font-semibold text-ink-faint">{t.number}</span>
              <Badge tone={TX_STATUS_TONE[t.status]} dot>
                {TX_STATUS_LABEL[t.status]}
              </Badge>
              <Badge>{TX_KIND_LABEL[t.kind]}</Badge>
            </div>
            <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">{t.description}</h1>
          </div>
          <p className={cn("tabular text-2xl font-semibold", sign > 0 ? "text-masuk" : sign < 0 ? "text-keluar" : "text-ink")}>
            {sign > 0 ? "+" : sign < 0 ? "−" : ""}
            {rupiah(t.amount)}
          </p>
        </div>
      </div>

      {t.statusNote ? <Banner tone={t.status === "ditolak" ? "error" : "info"} title={TX_STATUS_LABEL[t.status]} description={t.statusNote} /> : null}
      {t.kind === "realisasi_uang_muka" ? (
        <Banner tone="info" title="Baris ini tidak menggerakkan kas" description="Ia mengakui biaya uang muka per kategori saat LPJ diterima. Uang kasnya sudah keluar saat uang muka dibayar." />
      ) : null}

      {bisaVerif || bisaBatal ? (
        <div className="flex flex-wrap gap-2">
          {bisaVerif ? (
            <>
              <AksiTombol
                label="Verifikasi"
                variant="primary"
                icon={<CheckCircle2 aria-hidden className="size-4" />}
                title="Verifikasi transaksi?"
                description={`${rupiah(t.amount)} masuk ke perhitungan saldo & laporan.`}
                action={verifikasiTransaksi.bind(null, t.id)}
              />
              <AksiTombol
                label="Tolak"
                icon={<XCircle aria-hidden className="size-4" />}
                title="Tolak transaksi"
                action={tolakTransaksi.bind(null, t.id)}
                note="required"
                notePlaceholder="Alasan, mis. nominal tidak sesuai nota"
                confirmVariant="danger"
              />
            </>
          ) : null}
          {bisaBatal ? (
            <AksiTombol
              label="Batalkan"
              variant="ghost"
              icon={<Ban aria-hidden className="size-4" />}
              title="Batalkan transaksi?"
              description="Transaksi tetap tersimpan sebagai jejak, tapi tidak lagi dihitung."
              action={batalkanTransaksi.bind(null, t.id)}
              note="required"
              notePlaceholder="Alasan pembatalan"
              confirmVariant="danger"
            />
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader title="Rincian" />
            <ul className="divide-y divide-border">
              {t.items.map((it) => (
                <li key={it.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm">{it.description}</p>
                    <p className="text-xs text-ink-muted">{it.category?.name ?? "Tanpa kategori"}</p>
                  </div>
                  <span className="tabular text-sm font-medium">{rupiah(it.amount)}</span>
                </li>
              ))}
            </ul>
          </Card>
          {t.attachments.length ? (
            <Card>
              <CardHeader title="Bukti" />
              <CardBody>
                <LampiranGrid items={t.attachments} />
              </CardBody>
            </Card>
          ) : null}
        </div>
        <Card>
          <CardHeader title="Informasi" />
          <CardBody>
            <DescList
              className="sm:grid-cols-1"
              items={[
                { label: "Tanggal", value: fmtTanggal(t.date) },
                { label: "Proyek", value: <Link className="text-primary-700 hover:underline" href={`/proyek/${t.project.id}`}>{t.project.code} – {t.project.name}</Link> },
                { label: "Rekening", value: t.account?.name ?? "–" },
                { label: "Cara", value: METODE[t.method] },
                ...(t.partyName ? [{ label: sign > 0 ? "Dari" : "Kepada", value: t.partyName }] : []),
                ...(t.reference ? [{ label: "Referensi", value: t.reference }] : []),
                ...(t.request
                  ? [{ label: "Dari pengajuan", value: <Link className="text-primary-700 hover:underline" href={`/pengajuan/${t.request.id}`}>{t.request.number} – {t.request.title}</Link> }]
                  : []),
                { label: "Dicatat", value: `${t.createdBy.fullName} · ${fmtWaktu(t.createdAt)}` },
                ...(t.verifiedBy ? [{ label: "Diverifikasi", value: `${t.verifiedBy.fullName} · ${fmtWaktu(t.verifiedAt)}` }] : []),
              ]}
            />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
