import type { Metadata } from "next";
import { KelolaPengguna } from "@/components/pengguna/kelola-pengguna";
import { PageHeader } from "@/components/ui";
import { requireCapabilityPage } from "@/lib/auth/page-guard";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { relatif } from "@/lib/tanggal";

export const metadata: Metadata = { title: "Pengguna" };

export default async function PenggunaPage() {
  const user = await requireUser();
  requireCapabilityPage(user.role, "user.manage");
  const rows = await db.user.findMany({
    orderBy: [{ isActive: "desc" }, { fullName: "asc" }],
    include: { _count: { select: { memberships: true } } },
  });
  return (
    <>
      <PageHeader title="Pengguna" description="Siapa boleh apa. Anggota proyek diatur dari halaman masing-masing proyek." />
      <KelolaPengguna
        rows={rows.map((u) => ({
          id: u.id,
          fullName: u.fullName,
          username: u.username ?? "",
          email: u.email ?? "",
          phone: u.phone ?? "",
          role: u.role,
          allProjects: u.allProjects,
          isActive: u.isActive,
          lastLogin: u.lastLoginAt ? `masuk ${relatif(u.lastLoginAt)}` : "belum pernah masuk",
          projects: u._count.memberships,
          me: u.id === user.id,
        }))}
      />
    </>
  );
}
