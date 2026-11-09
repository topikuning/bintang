import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FormProyek } from "@/components/proyek/form-proyek";
import { PageHeader } from "@/components/ui";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { bahanFormProyek } from "@/lib/proyek/form-data";
import { tanggalKeKey } from "@/lib/tanggal";
import { formatIsian } from "@/lib/uang";

export const metadata: Metadata = { title: "Ubah proyek" };

export default async function UbahProyekPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  requireCapabilityPage(user.role, "project.manage");
  const p = await db.project.findUnique({ where: { id }, include: { members: { select: { userId: true } } } });
  if (!p) notFound();
  const bahan = await bahanFormProyek();
  return (
    <>
      <PageHeader back={{ href: `/proyek/${id}`, label: p.code }} title="Ubah proyek" />
      <FormProyek
        {...bahan}
        awal={{
          id: p.id,
          code: p.code,
          name: p.name,
          kind: p.kind,
          companyId: p.companyId,
          client: p.client ?? "",
          location: p.location ?? "",
          contractValue: p.contractValue ? formatIsian(p.contractValue.toString()) : "",
          budget: p.budget ? formatIsian(p.budget.toString()) : "",
          startDate: p.startDate ? tanggalKeKey(p.startDate) : "",
          endDate: p.endDate ? tanggalKeKey(p.endDate) : "",
          status: p.status,
          notes: p.notes ?? "",
          members: p.members.map((m) => m.userId),
        }}
      />
    </>
  );
}
