import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { FormLpj } from "@/components/pengajuan/form-lpj";
import { Banner, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { bolehAjukanLpj } from "@/lib/pengajuan/akses";
import { barisBaru } from "@/lib/pengajuan/baris";
import { detailPengajuan } from "@/lib/pengajuan/queries";
import { formatIsian, rupiah } from "@/lib/uang";

export const metadata: Metadata = { title: "LPJ uang muka" };

export default async function LpjPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const p = await detailPengajuan(user, id);
  if (!p) notFound();
  if (!bolehAjukanLpj(user, p).boleh) redirect(`/pengajuan/${id}`);
  const categories = await db.category.findMany({
    where: { direction: "keluar", isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true },
  });
  const dikembalikan = [...p.events].reverse().find((e) => e.action === "LPJ dikembalikan");
  // Rincian awal: LPJ yang dikembalikan, atau – kalau belum pernah – rencana di pengajuannya.
  const awal = (p.realizations.length ? p.realizations : p.items).map((r) =>
    barisBaru({ description: r.description, categoryId: r.categoryId ?? "", amount: formatIsian(r.amount.toString()) }),
  );

  return (
    <>
      <PageHeader
        back={{ href: `/pengajuan/${id}`, label: p.number ?? "Pengajuan" }}
        title="Laporan pemakaian uang muka"
        description={`${p.title} · ${rupiah(p.total)}`}
      />
      {dikembalikan ? (
        <Banner tone="warning" className="mb-5" title={`LPJ dikembalikan oleh ${dikembalikan.actor.fullName}`} description={dikembalikan.note ?? undefined} />
      ) : (
        <Banner
          tone="info"
          className="mb-5"
          title="Rincian di bawah diisi dari rencana pengajuan"
          description="Sesuaikan dengan nota yang sebenarnya. Sisa uang dikembalikan ke kas; kalau lebih, kekurangannya dibayarkan ke Anda."
        />
      )}
      <FormLpj
        id={p.id}
        uangMuka={p.total.toString()}
        categories={categories.map((c) => ({ value: c.id, label: c.name }))}
        awal={awal}
        catatanAwal={p.lpjNote ?? ""}
      />
    </>
  );
}
