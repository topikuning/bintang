import type { Metadata } from "next";
import { MasterCrud } from "@/components/master/master-crud";
import { PageHeader } from "@/components/ui";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { bukaSandi, samarkan } from "@/lib/kripto";
import { simpanPihak } from "@/lib/master/actions";

export const metadata: Metadata = { title: "Penerima & vendor" };

const JENIS = { vendor: "Vendor", klien: "Klien", karyawan: "Karyawan", lainnya: "Lainnya" } as const;

export default async function PihakPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "master.manage");
  const rows = await db.party.findMany({ orderBy: { name: "asc" } });
  return (
    <>
      <PageHeader back={{ href: "/master", label: "Data Master" }} title="Penerima & vendor" description="Rekening di sini otomatis terisi saat orang memilih penerima di form pengajuan." />
      <MasterCrud
        entityLabel="penerima"
        addLabel="Tambah penerima"
        emptyText="Belum ada penerima."
        action={simpanPihak}
        rows={rows.map((p) => {
          const rek = bukaSandi(p.bankAccount);
          return {
            id: p.id,
            title: p.name,
            badge: JENIS[p.kind],
            subtitle: [p.bankName && rek ? `${p.bankName} ${samarkan(rek)}` : null, p.phone].filter(Boolean).join(" · ") || "Rekening belum diisi",
            active: p.isActive,
            values: {
              name: p.name, kind: p.kind, phone: p.phone ?? "", email: p.email ?? "", address: p.address ?? "", npwp: p.npwp ?? "",
              bankName: p.bankName ?? "", bankAccount: rek ?? "", bankHolder: p.bankHolder ?? "", isActive: p.isActive ? "1" : "",
            },
          };
        })}
        fields={[
          { name: "name", label: "Nama", type: "text", required: true },
          { name: "kind", label: "Jenis", type: "select", required: true, options: Object.entries(JENIS).map(([value, label]) => ({ value, label })) },
          { name: "bankName", label: "Bank", type: "text", placeholder: "BCA, BRI, Mandiri…" },
          { name: "bankAccount", label: "Nomor rekening", type: "text" },
          { name: "bankHolder", label: "Atas nama", type: "text", span: 2 },
          { name: "phone", label: "Telepon / WA", type: "tel" },
          { name: "email", label: "Email", type: "email" },
          { name: "npwp", label: "NPWP", type: "text" },
          { name: "address", label: "Alamat", type: "textarea", span: 2 },
          { name: "isActive", label: "Aktif", type: "checkbox", span: 2 },
        ]}
      />
    </>
  );
}
