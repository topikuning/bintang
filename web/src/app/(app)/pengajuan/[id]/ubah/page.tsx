import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { LampiranGrid } from "@/components/pengajuan/lampiran";
import { barisBaru } from "@/lib/pengajuan/baris";
import { FormPengajuan } from "@/components/pengajuan/form-pengajuan";
import { Banner, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { bukaSandi } from "@/lib/kripto";
import { bolehEdit } from "@/lib/pengajuan/akses";
import { bahanFormPengajuan } from "@/lib/pengajuan/form-data";
import { detailPengajuan } from "@/lib/pengajuan/queries";
import { tanggalKeKey } from "@/lib/tanggal";
import { formatIsian } from "@/lib/uang";

export const metadata: Metadata = { title: "Ubah pengajuan" };

export default async function UbahPengajuanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const p = await detailPengajuan(user, id);
  if (!p) notFound();
  if (!bolehEdit(user, p).boleh) redirect(`/pengajuan/${id}`);
  const bahan = await bahanFormPengajuan(user);
  // Proyek pengajuan tetap muncul walau sudah tidak aktif, supaya form tidak kosong.
  if (!bahan.projects.some((x) => x.value === p.projectId)) {
    bahan.projects.unshift({ value: p.projectId, label: `${p.project.code} – ${p.project.name}` });
  }
  const revisi = [...p.events].reverse().find((e) => e.toStatus === "perlu_revisi");

  return (
    <>
      <PageHeader
        back={{ href: `/pengajuan/${id}`, label: p.number ?? "Draf" }}
        title={p.status === "perlu_revisi" ? "Perbaiki pengajuan" : "Lanjutkan draf"}
      />
      {p.status === "perlu_revisi" && revisi ? (
        <Banner
          tone="warning"
          className="mb-5"
          title={`Catatan dari ${revisi.actor.fullName}`}
          description={revisi.note ?? "Periksa kembali isian Anda."}
        />
      ) : null}
      {p.attachments.length ? (
        <div className="mb-5 rounded-xl border border-border bg-surface p-4">
          <p className="mb-2 text-sm font-semibold">Lampiran yang sudah ada</p>
          <LampiranGrid items={p.attachments} requestId={p.id} bolehHapus />
        </div>
      ) : null}
      <FormPengajuan
        {...bahan}
        initial={{
          id: p.id,
          projectId: p.projectId,
          kind: p.kind,
          title: p.title,
          description: p.description ?? "",
          urgent: p.urgent,
          neededDate: p.neededDate ? tanggalKeKey(p.neededDate) : "",
          partyId: p.partyId ?? "",
          payeeName: p.payeeName ?? "",
          bankName: p.bankName ?? "",
          bankAccount: bukaSandi(p.bankAccount) ?? "",
          bankHolder: p.bankHolder ?? "",
          status: p.status,
          rows: p.items.map((it) =>
            barisBaru({
              description: it.description,
              categoryId: it.categoryId ?? "",
              amount: formatIsian(it.amount.toString()),
              rinci: it.quantity !== null && it.unitPrice !== null,
              quantity: it.quantity?.toString() ?? "",
              unit: it.unit ?? "",
              unitPrice: it.unitPrice !== null ? formatIsian(it.unitPrice.toString()) : "",
            }),
          ),
        }}
      />
    </>
  );
}
