import { KeyRound } from "lucide-react";
import type { Metadata } from "next";
import { FormProfil } from "@/components/profil/form-profil";
import { ButtonLink, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { ROLE_LABEL } from "@/lib/authz";
import { db } from "@/lib/db";
import { bukaSandi } from "@/lib/kripto";

export const metadata: Metadata = { title: "Profil" };

export default async function ProfilPage() {
  const user = await requireUser();
  const u = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  return (
    <>
      <PageHeader
        title="Profil saya"
        description={`${ROLE_LABEL[u.role]}${u.username ? ` · @${u.username}` : ""}${u.email ? ` · ${u.email}` : ""}`}
        actions={
          <ButtonLink href="/ganti-password" variant="secondary">
            <KeyRound aria-hidden className="size-4" /> Ganti password
          </ButtonLink>
        }
      />
      <FormProfil
        v={{ fullName: u.fullName, phone: u.phone ?? "", bankName: u.bankName ?? "", bankAccount: bukaSandi(u.bankAccount) ?? "", bankHolder: u.bankHolder ?? "" }}
      />
    </>
  );
}
