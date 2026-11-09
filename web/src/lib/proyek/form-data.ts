import "server-only";
import { isCrossProject, ROLE_LABEL } from "@/lib/authz";
import { db } from "@/lib/db";

export async function bahanFormProyek() {
  const [companies, users] = await Promise.all([
    db.company.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.user.findMany({ where: { isActive: true }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true, role: true, allProjects: true } }),
  ]);
  return {
    companies: companies.map((c) => ({ value: c.id, label: c.name })),
    users: users.map((u) => ({ id: u.id, name: u.fullName, role: ROLE_LABEL[u.role], cross: isCrossProject(u.role, u.allProjects) })),
  };
}
