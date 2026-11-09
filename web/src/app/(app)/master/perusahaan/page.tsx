import type { Metadata } from "next";
import { MasterCrud } from "@/components/master/master-crud";
import { PageHeader } from "@/components/ui";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { simpanPerusahaan } from "@/lib/master/actions";

export const metadata: Metadata = { title: "Perusahaan" };

export default async function PerusahaanPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "master.manage");
  const rows = await db.company.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { projects: true } } } });
  return (
    <>
      <PageHeader back={{ href: "/master", label: "Data Master" }} title="Perusahaan" description="Nama, alamat, dan kota tampil di kop bukti pengajuan yang dicetak." />
      <MasterCrud
        entityLabel="perusahaan"
        addLabel="Tambah perusahaan"
        emptyText="Belum ada perusahaan."
        action={simpanPerusahaan}
        rows={rows.map((c) => ({
          id: c.id,
          title: c.name,
          subtitle: [c.city, c.npwp ? `NPWP ${c.npwp}` : null, `${c._count.projects} proyek`].filter(Boolean).join(" · "),
          active: c.isActive,
          values: { name: c.name, address: c.address ?? "", city: c.city ?? "", npwp: c.npwp ?? "", phone: c.phone ?? "", email: c.email ?? "", isActive: c.isActive ? "1" : "" },
        }))}
        fields={[
          { name: "name", label: "Nama perusahaan", type: "text", required: true, span: 2 },
          { name: "address", label: "Alamat", type: "textarea", span: 2 },
          { name: "city", label: "Kota", type: "text", help: "Dipakai di baris tempat & tanggal tanda tangan." },
          { name: "npwp", label: "NPWP", type: "text" },
          { name: "phone", label: "Telepon", type: "tel" },
          { name: "email", label: "Email", type: "email" },
          { name: "isActive", label: "Aktif", type: "checkbox", span: 2 },
        ]}
      />
    </>
  );
}
