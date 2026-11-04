import "server-only";
import type { ComboOption } from "@/components/ui/combobox";
import { accessibleProjectIds, type SessionUser } from "@/lib/auth/session";
import { can } from "@/lib/authz";
import { db } from "@/lib/db";
import { bukaSandi } from "@/lib/kripto";

/** Bahan form pengajuan: proyek aktif yang bisa diakses, kategori, penerima, rekening saya. */
export async function bahanFormPengajuan(user: SessionUser) {
  const ids = await accessibleProjectIds(user);
  const [projects, categories, parties, me] = await Promise.all([
    db.project.findMany({
      where: { status: "aktif", ...(ids === null ? {} : { id: { in: ids } }) },
      orderBy: [{ kind: "asc" }, { code: "asc" }],
      select: { id: true, code: true, name: true, kind: true },
    }),
    db.category.findMany({
      where: { direction: "keluar", isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
    db.party.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, kind: true, bankName: true, bankAccount: true, bankHolder: true },
    }),
    db.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { fullName: true, bankName: true, bankAccount: true, bankHolder: true },
    }),
  ]);
  return {
    projects: projects.map<ComboOption>((p) => ({
      value: p.id,
      label: `${p.code} – ${p.name}`,
      hint: p.kind === "operasional" ? "Operasional (non-proyek)" : undefined,
    })),
    categories: categories.map<ComboOption>((c) => ({ value: c.id, label: c.name })),
    parties: parties.map((p) => ({ ...p, bankAccount: bukaSandi(p.bankAccount) })),
    me: { ...me, bankAccount: bukaSandi(me.bankAccount) },
    canCreateParty: can(user.role, "party.create"),
  };
}
