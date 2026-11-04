import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import type { Aktor } from "@/lib/pengajuan/service";
import type { UserRole } from "@/generated/prisma/enums";

/** Kosongkan semua tabel aplikasi (bukan riwayat migrasi). Trigger append-only dilewati dengan TRUNCATE. */
export async function bersihkan() {
  const rows = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const daftar = rows.map((r) => `"${r.tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE ${daftar} RESTART IDENTITY CASCADE`);
  await db.setting.create({ data: { id: 1 } });
}

let hash: string | null = null;
export async function buatUser(username: string, role: UserRole, extra: Record<string, unknown> = {}): Promise<Aktor> {
  hash ??= await hashPassword("rahasia123");
  const u = await db.user.create({ data: { username, fullName: username, role, passwordHash: hash, ...extra } });
  return { id: u.id, role: u.role, allProjects: u.allProjects, fullName: u.fullName };
}

export async function fixtures() {
  await bersihkan();
  const company = await db.company.create({ data: { name: "PT Uji" } });
  const proyek = await db.project.create({ data: { code: "UJI-1", name: "Proyek Uji", companyId: company.id, budget: 100_000_000n } });
  const proyekLain = await db.project.create({ data: { code: "UJI-2", name: "Proyek Lain", companyId: company.id } });
  const material = await db.category.create({ data: { name: "Material", direction: "keluar" } });
  const upah = await db.category.create({ data: { name: "Upah", direction: "keluar" } });
  const termin = await db.category.create({ data: { name: "Termin", direction: "masuk" } });
  const rekening = await db.account.create({ data: { name: "BCA", kind: "bank", openingBalance: 10_000_000n } });
  const kas = await db.account.create({ data: { name: "Kas", kind: "kas" } });
  const staf = await buatUser("staf", "staff");
  const admin = await buatUser("adminproyek", "project_admin");
  const keuangan = await buatUser("keuangan", "finance");
  const pimpinan = await buatUser("pimpinan", "director");
  for (const u of [staf, admin]) await db.projectMember.create({ data: { projectId: proyek.id, userId: u.id } });
  return { company, proyek, proyekLain, material, upah, termin, rekening, kas, staf, admin, keuangan, pimpinan };
}

export const dasar = {
  description: undefined,
  neededDate: undefined,
  partyId: undefined,
  payeeName: "Toko Uji",
  bankName: "BRI",
  bankAccount: "1234567890",
  bankHolder: "Toko Uji",
  urgent: false,
};
