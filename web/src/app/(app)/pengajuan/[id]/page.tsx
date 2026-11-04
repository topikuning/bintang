import { CalendarClock, FolderKanban, Printer, UserRound, Zap } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AksiPanel } from "@/components/pengajuan/aksi-panel";
import { LampiranGrid } from "@/components/pengajuan/lampiran";
import { Riwayat } from "@/components/pengajuan/riwayat";
import { StatusPengajuan, StepperPengajuan } from "@/components/pengajuan/status";
import { Badge, Banner, ButtonLink, Card, CardBody, CardHeader, DescList } from "@/components/ui";
import { Salin } from "@/components/ui/salin";
import { requireUser } from "@/lib/auth/session";
import { selisihLpj } from "@/lib/keuangan/hitung";
import { bukaSandi } from "@/lib/kripto";
import { REQUEST_KIND_LABEL, TX_KIND_LABEL, TX_STATUS_LABEL, TX_STATUS_TONE } from "@/lib/lifecycle";
import { semuaAksi } from "@/lib/pengajuan/akses";
import { detailPengajuan } from "@/lib/pengajuan/queries";
import { ambilPengaturan } from "@/lib/pengaturan";
import { opsiRekening } from "@/lib/rekening";
import { fmtTanggal, fmtWaktu, hariIniKey, selisihHari, tanggalKeKey } from "@/lib/tanggal";
import { angka, jumlahkan, rupiah } from "@/lib/uang";
import { can } from "@/lib/authz";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const user = await requireUser();
  const p = await detailPengajuan(user, id);
  return { title: p ? (p.number ?? "Draf pengajuan") : "Pengajuan" };
}

const PESAN: Record<string, string> = {
  diajukan: "Pengajuan terkirim. Pemberi persetujuan sudah diberi tahu.",
  draf: "Draf tersimpan. Lanjutkan kapan saja dari menu Pengajuan › Draf.",
  lpj: "LPJ terkirim ke Keuangan.",
};

const METODE: Record<string, string> = { transfer: "Transfer", tunai: "Tunai", qris: "QRIS", giro: "Giro", lainnya: "Lainnya" };

export default async function DetailPengajuanPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ pesan?: string }>;
}) {
  const [{ id }, { pesan }] = await Promise.all([params, searchParams]);
  const user = await requireUser();
  const p = await detailPengajuan(user, id);
  if (!p) notFound();
  const setting = await ambilPengaturan();
  const k = semuaAksi(user, p, setting.financeApproveCap);
  const perluRekening = k.bayar.boleh || k.setujuiBayar.boleh || k.periksaLpj.boleh;
  const accounts = perluRekening ? await opsiRekening() : [];

  const rekening = bukaSandi(p.bankAccount);
  const totalRealisasi = jumlahkan(p.realizations.map((r) => r.amount));
  const lpj = p.realizations.length || p.status === "lpj_diajukan" || p.status === "selesai" ? selisihLpj(p.total, totalRealisasi) : null;
  const today = hariIniKey();
  const sisaHari = p.neededDate ? selisihHari(today, tanggalKeKey(p.neededDate)) : null;
  const terbuka = ["diajukan", "disetujui", "perlu_revisi", "draft"].includes(p.status);
  const terakhirDitolak = [...p.events].reverse().find((e) => e.toStatus === "ditolak" || e.toStatus === "dibatalkan");

  const approverNeeded =
    p.status === "diajukan" && setting.financeApproveCap > 0n && p.total > setting.financeApproveCap
      ? `Nilainya di atas ${rupiah(setting.financeApproveCap)}, jadi perlu persetujuan Pimpinan.`
      : undefined;

  return (
    <div className="space-y-5">
      {pesan && PESAN[pesan] ? <Banner tone="success" title={PESAN[pesan]} /> : null}

      {/* Kepala */}
      <div>
        <Link href="/pengajuan" className="mb-2 inline-flex text-[13px] font-medium text-ink-muted hover:text-ink">
          ‹ Pengajuan
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="tabular text-xs font-semibold tracking-wide text-ink-faint">{p.number ?? "DRAF"}</span>
              <StatusPengajuan status={p.status} kind={p.kind} />
              {p.urgent ? (
                <Badge tone="danger">
                  <Zap aria-hidden className="size-3" /> Mendesak
                </Badge>
              ) : null}
            </div>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink sm:text-2xl">{p.title}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-muted">
              <span className="inline-flex items-center gap-1">
                <FolderKanban aria-hidden className="size-3.5" />
                {p.project.code} – {p.project.name}
              </span>
              <span className="inline-flex items-center gap-1">
                <UserRound aria-hidden className="size-3.5" />
                {p.requester.fullName}
              </span>
              <span>{REQUEST_KIND_LABEL[p.kind]}</span>
            </p>
          </div>
          <div className="sm:text-right">
            <p className="text-[11px] font-semibold tracking-wide text-ink-muted uppercase">Total</p>
            <p className="tabular text-2xl font-semibold text-ink">{rupiah(p.total)}</p>
            {sisaHari !== null && terbuka ? (
              <p className={`mt-0.5 inline-flex items-center gap-1 text-xs ${sisaHari < 0 ? "text-danger" : sisaHari <= 2 ? "text-warning" : "text-ink-muted"}`}>
                <CalendarClock aria-hidden className="size-3.5" />
                {sisaHari < 0 ? `Lewat ${-sisaHari} hari` : sisaHari === 0 ? "Dibutuhkan hari ini" : `Dibutuhkan ${fmtTanggal(p.neededDate)}`}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {p.status !== "ditolak" && p.status !== "dibatalkan" && p.status !== "draft" ? (
        <Card>
          <CardBody className="py-4">
            <StepperPengajuan status={p.status} kind={p.kind} />
          </CardBody>
        </Card>
      ) : null}

      {(p.status === "ditolak" || p.status === "dibatalkan") && terakhirDitolak ? (
        <Banner
          tone={p.status === "ditolak" ? "error" : "info"}
          title={`${p.status === "ditolak" ? "Ditolak" : "Dibatalkan"} oleh ${terakhirDitolak.actor.fullName}`}
          description={terakhirDitolak.note ?? undefined}
        />
      ) : null}

      <AksiPanel
        id={p.id}
        kind={p.kind}
        status={p.status}
        totalLabel={rupiah(p.total)}
        payeeLabel={p.payeeName ?? "penerima"}
        isRequester={p.requesterId === user.id}
        today={today}
        requireProof={setting.requireProof}
        accounts={accounts}
        k={k}
        approverNeeded={approverNeeded}
        lpj={lpj ? { arah: lpj.arah, jumlahLabel: rupiah(lpj.jumlah) } : undefined}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-5 lg:order-1">
          {/* Rincian */}
          <Card>
            <CardHeader title="Rincian" subtitle={`${p.items.length} baris`} />
            <ul className="divide-y divide-border">
              {p.items.map((it, i) => (
                <li key={it.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="flex min-w-0 gap-3">
                    <span className="tabular w-5 shrink-0 pt-0.5 text-xs text-ink-faint">{i + 1}</span>
                    <div className="min-w-0">
                      <p className="text-sm text-ink">{it.description}</p>
                      <p className="text-xs text-ink-muted">
                        {it.category?.name ?? "Tanpa kategori"}
                        {it.quantity !== null && it.unitPrice !== null
                          ? ` · ${it.quantity.toString().replace(".", ",")} ${it.unit ?? ""} × ${rupiah(it.unitPrice)}`
                          : ""}
                      </p>
                    </div>
                  </div>
                  <span className="tabular shrink-0 text-sm font-medium">{rupiah(it.amount)}</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-between border-t border-border bg-surface-muted px-4 py-3 text-sm font-semibold">
              <span>Total</span>
              <span className="tabular">{rupiah(p.total)}</span>
            </div>
          </Card>

          {p.description ? (
            <Card>
              <CardHeader title="Keterangan" />
              <CardBody>
                <p className="text-sm whitespace-pre-line text-ink">{p.description}</p>
              </CardBody>
            </Card>
          ) : null}

          {/* LPJ */}
          {p.kind === "uang_muka" && (p.realizations.length > 0 || p.lpjNote) ? (
            <Card>
              <CardHeader title="Laporan pemakaian (LPJ)" subtitle={p.lpjSubmittedAt ? `Diajukan ${fmtWaktu(p.lpjSubmittedAt)}` : undefined} />
              <ul className="divide-y divide-border">
                {p.realizations.map((r) => (
                  <li key={r.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm">{r.description}</p>
                      <p className="text-xs text-ink-muted">{r.category?.name ?? "Tanpa kategori"}</p>
                    </div>
                    <span className="tabular text-sm">{rupiah(r.amount)}</span>
                  </li>
                ))}
              </ul>
              <dl className="space-y-1 border-t border-border bg-surface-muted px-4 py-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-ink-muted">Uang muka</dt>
                  <dd className="tabular">{rupiah(p.total)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-muted">Terpakai</dt>
                  <dd className="tabular">{rupiah(totalRealisasi)}</dd>
                </div>
                {lpj ? (
                  <div className="flex justify-between font-semibold">
                    <dt>{lpj.arah === "kembali" ? "Sisa dikembalikan" : lpj.arah === "kurang" ? "Kurang dibayar" : "Selisih"}</dt>
                    <dd className={`tabular ${lpj.arah === "kembali" ? "text-masuk" : lpj.arah === "kurang" ? "text-keluar" : ""}`}>
                      {rupiah(lpj.jumlah)}
                    </dd>
                  </div>
                ) : null}
              </dl>
              {p.lpjNote ? <p className="border-t border-border px-4 py-3 text-[13px] text-ink-muted">“{p.lpjNote}”</p> : null}
            </Card>
          ) : null}

          {p.attachments.length ? (
            <Card>
              <CardHeader title="Lampiran" subtitle={`${p.attachments.length} berkas`} />
              <CardBody>
                <LampiranGrid items={p.attachments} showKind />
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Riwayat" />
            <CardBody className="py-4">
              <Riwayat events={p.events} />
            </CardBody>
          </Card>
        </div>

        {/* Di ponsel kolom ini naik ke atas: yang membayar butuh rekening
            tujuan tepat di bawah tombol "Tandai sudah dibayar". */}
        <div className="order-first min-w-0 space-y-5 lg:order-2">
          {/* Penerima */}
          <Card>
            <CardHeader title="Dibayarkan ke" />
            <CardBody className="space-y-3">
              <p className="text-sm font-semibold">{p.payeeName ?? "–"}</p>
              {rekening ? (
                <div className="rounded-lg border border-border bg-surface-muted p-3">
                  <p className="text-xs text-ink-muted">{p.bankName ?? "Bank"}</p>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="tabular text-base font-semibold tracking-wide">{rekening}</p>
                    <Salin teks={rekening.replace(/\D/g, "") || rekening} />
                  </div>
                  {p.bankHolder ? <p className="text-xs text-ink-muted">a.n. {p.bankHolder}</p> : null}
                </div>
              ) : (
                <p className="text-[13px] text-ink-muted">Rekening tidak dicantumkan.</p>
              )}
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] text-ink-muted">Nominal</span>
                <span className="flex items-center gap-2">
                  <span className="tabular text-sm font-semibold">{rupiah(p.total)}</span>
                  <Salin teks={p.total.toString()} label="Salin" />
                </span>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Informasi" />
            <CardBody>
              <DescList
                className="sm:grid-cols-1"
                items={[
                  { label: "Pemohon", value: p.requester.fullName },
                  { label: "Diajukan", value: p.submittedAt ? fmtWaktu(p.submittedAt) : "Belum" },
                  ...(p.neededDate ? [{ label: "Dibutuhkan", value: fmtTanggal(p.neededDate) }] : []),
                  ...(p.approver ? [{ label: "Disetujui", value: `${p.approver.fullName} · ${fmtWaktu(p.approvedAt)}` }] : []),
                  ...(p.payer
                    ? [
                        {
                          label: "Dibayar",
                          value: `${fmtTanggal(p.paidDate)} · ${p.paymentMethod ? METODE[p.paymentMethod] : ""}${p.account ? ` dari ${p.account.name}` : ""}`,
                        },
                        ...(p.paymentRef ? [{ label: "Referensi", value: p.paymentRef }] : []),
                        { label: "Dicatat oleh", value: p.payer.fullName },
                      ]
                    : []),
                ]}
              />
            </CardBody>
          </Card>

          {p.transactions.length && can(user.role, "tx.view") ? (
            <Card>
              <CardHeader title="Transaksi kas" />
              <ul className="divide-y divide-border">
                {p.transactions.map((t) => (
                  <li key={t.id}>
                    <Link href={`/transaksi/${t.id}`} className="flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-surface-muted">
                      <div className="min-w-0">
                        <p className="tabular text-[13px] font-medium">{t.number}</p>
                        <p className="text-xs text-ink-muted">
                          {TX_KIND_LABEL[t.kind]} · {fmtTanggal(t.date)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="tabular text-[13px]">{angka(t.amount)}</p>
                        <Badge tone={TX_STATUS_TONE[t.status]}>{TX_STATUS_LABEL[t.status]}</Badge>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {p.status !== "draft" ? (
            <ButtonLink href={`/cetak/pengajuan/${p.id}`} external target="_blank" variant="secondary" className="w-full">
              <Printer aria-hidden className="size-4" /> Cetak bukti pengajuan
            </ButtonLink>
          ) : null}
        </div>
      </div>
    </div>
  );
}
