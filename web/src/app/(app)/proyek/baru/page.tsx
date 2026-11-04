import type { Metadata } from "next";
import { FormProyek } from "@/components/proyek/form-proyek";
import { PageHeader } from "@/components/ui";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { requireUser } from "@/lib/auth/session";
import { bahanFormProyek } from "@/lib/proyek/form-data";

export const metadata: Metadata = { title: "Proyek baru" };

export default async function ProyekBaruPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "project.manage");
  const bahan = await bahanFormProyek();
  return (
    <>
      <PageHeader back={{ href: "/proyek", label: "Proyek" }} title="Proyek baru" />
      <FormProyek {...bahan} />
    </>
  );
}
