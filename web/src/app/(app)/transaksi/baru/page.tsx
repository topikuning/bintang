import type { Metadata } from "next";
import { FormTransaksi } from "@/components/transaksi/form-transaksi";
import { PageHeader } from "@/components/ui";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { accessibleProjectIds, requireUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { opsiRekening } from "@/lib/rekening";
import { hariIniKey } from "@/lib/tanggal";

export const metadata: Metadata = { title: "Catat kas" };

export default async function CatatKasPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "tx.create");
  const ids = await accessibleProjectIds(user);
  const [projects, cats, parties, accounts] = await Promise.all([
    db.project.findMany({
      where: { status: "aktif", ...(ids === null ? {} : { id: { in: ids } }) },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
    db.category.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, direction: true } }),
    db.party.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    opsiRekening(),
  ]);
  return (
    <>
      <PageHeader back={{ href: "/transaksi", label: "Buku Kas" }} title="Catat kas" description="Uang masuk (termin, pendapatan lain) atau belanja kecil yang tidak lewat pengajuan." />
      <FormTransaksi
        today={hariIniKey()}
        akanLangsung={can(user.role, "tx.verify")}
        projects={projects.map((p) => ({ value: p.id, label: `${p.code} – ${p.name}` }))}
        accounts={accounts}
        catMasuk={cats.filter((c) => c.direction === "masuk").map((c) => ({ value: c.id, label: c.name }))}
        catKeluar={cats.filter((c) => c.direction === "keluar").map((c) => ({ value: c.id, label: c.name }))}
        parties={parties.map((p) => ({ value: p.id, label: p.name }))}
      />
    </>
  );
}
