import { FolderX } from "lucide-react";
import type { Metadata } from "next";
import { FormPengajuan } from "@/components/pengajuan/form-pengajuan";
import { EmptyState, PageHeader } from "@/components/ui";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { requireUser } from "@/lib/auth/session";
import { bahanFormPengajuan } from "@/lib/pengajuan/form-data";

export const metadata: Metadata = { title: "Ajukan pembayaran" };

export default async function PengajuanBaruPage({ searchParams }: { searchParams: Promise<{ proyek?: string }> }) {
  const user = await requireUser();
  requireCapabilityPage(user.role, "request.create");
  const bahan = await bahanFormPengajuan(user);
  const { proyek } = await searchParams;
  return (
    <>
      <PageHeader
        back={{ href: "/pengajuan", label: "Pengajuan" }}
        title="Ajukan pembayaran"
        description="Isi seperlunya – pengajuan bisa disimpan sebagai draf dan dilanjutkan nanti."
      />
      {bahan.projects.length === 0 ? (
        <EmptyState
          icon={FolderX}
          title="Anda belum ditugaskan ke proyek mana pun"
          description="Minta admin menambahkan Anda sebagai anggota proyek, lalu buka halaman ini lagi."
        />
      ) : (
        <FormPengajuan
          {...bahan}
          defaultProjectId={bahan.projects.some((p) => p.value === proyek) ? proyek : undefined}
        />
      )}
    </>
  );
}
