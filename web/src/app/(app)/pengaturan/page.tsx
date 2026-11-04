import type { Metadata } from "next";
import { FormPengaturan } from "@/components/pengaturan/form-pengaturan";
import { PageHeader } from "@/components/ui";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { requireUser } from "@/lib/auth/session";
import { ambilPengaturan } from "@/lib/pengaturan";
import { formatIsian } from "@/lib/uang";

export const metadata: Metadata = { title: "Pengaturan" };

export default async function PengaturanPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "settings.manage");
  const s = await ambilPengaturan();
  return (
    <>
      <PageHeader title="Pengaturan" />
      <FormPengaturan v={{ orgName: s.orgName, financeApproveCap: s.financeApproveCap ? formatIsian(s.financeApproveCap.toString()) : "", requireProof: s.requireProof }} />
    </>
  );
}
