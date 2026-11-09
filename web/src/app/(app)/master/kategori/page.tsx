import type { Metadata } from "next";
import { MasterCrud } from "@/components/master/master-crud";
import { PageHeader } from "@/components/ui";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { simpanKategori } from "@/lib/master/actions";

export const metadata: Metadata = { title: "Kategori" };

export default async function KategoriPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "master.manage");
  const rows = await db.category.findMany({
    orderBy: [{ direction: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { transactionItems: true } } },
  });
  return (
    <>
      <PageHeader back={{ href: "/master", label: "Data Master" }} title="Kategori" description="Kategori keluar dipakai di pengajuan & biaya; kategori masuk untuk pemasukan." />
      <MasterCrud
        entityLabel="kategori"
        addLabel="Tambah kategori"
        emptyText="Belum ada kategori."
        action={simpanKategori}
        rows={rows.map((c) => ({
          id: c.id,
          title: c.name,
          badge: c.direction === "masuk" ? "Masuk" : "Keluar",
          subtitle: [c.description, `${c._count.transactionItems} pemakaian`].filter(Boolean).join(" · "),
          active: c.isActive,
          values: { name: c.name, direction: c.direction, description: c.description ?? "", sortOrder: String(c.sortOrder), isActive: c.isActive ? "1" : "" },
        }))}
        fields={[
          { name: "name", label: "Nama kategori", type: "text", required: true },
          { name: "direction", label: "Arah", type: "select", required: true, options: [{ value: "keluar", label: "Keluar (biaya)" }, { value: "masuk", label: "Masuk (pemasukan)" }] },
          { name: "description", label: "Keterangan", type: "text", span: 2 },
          { name: "sortOrder", label: "Urutan", type: "number", help: "Angka kecil tampil lebih dulu di pilihan." },
          { name: "isActive", label: "Aktif", type: "checkbox", description: "Kategori nonaktif tidak muncul di form, tapi data lamanya tetap." },
        ]}
      />
    </>
  );
}
