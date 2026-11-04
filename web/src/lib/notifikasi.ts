import "server-only";
import type { UserRole } from "@/generated/prisma/enums";
import { can, isCrossProject, type Capability } from "@/lib/authz";
import type { Tx } from "@/lib/db";

/**
 * Notifikasi dalam aplikasi. Ditulis DI DALAM transaksi aksi yang memicunya,
 * jadi tidak ada notifikasi "pengajuan disetujui" untuk persetujuan yang batal.
 */

export async function kirim(
  tx: Tx,
  userIds: Iterable<string>,
  pesan: { title: string; body?: string; href?: string },
  kecuali?: string,
): Promise<void> {
  const unik = [...new Set(userIds)].filter((id) => id !== kecuali);
  if (unik.length === 0) return;
  await tx.notification.createMany({
    data: unik.map((userId) => ({ userId, title: pesan.title, body: pesan.body, href: pesan.href })),
  });
}

/**
 * Semua user aktif yang memegang `capability` DAN bisa melihat proyek itu.
 * Dipakai untuk "siapa yang perlu tahu ada pengajuan baru".
 */
export async function penerimaBerwenang(tx: Tx, capability: Capability, projectId: string): Promise<string[]> {
  const roles = (["super_admin", "director", "finance", "project_admin", "staff", "viewer"] as UserRole[]).filter((r) =>
    can(r, capability),
  );
  const users = await tx.user.findMany({
    where: { isActive: true, role: { in: roles } },
    select: { id: true, role: true, allProjects: true, memberships: { where: { projectId }, select: { id: true } } },
  });
  return users.filter((u) => isCrossProject(u.role, u.allProjects) || u.memberships.length > 0).map((u) => u.id);
}
