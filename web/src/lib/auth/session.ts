import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { UserRole } from "@/generated/prisma/enums";
import { can, isCrossProject, type Capability } from "@/lib/authz";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { ForbiddenError } from "@/lib/galat";

export const SESSION_COOKIE = "bintang_session";

/** Lama sesi per peran (detik). Peran yang menyentuh uang lebih pendek. */
const ROLE_SESSION_SECONDS: Record<UserRole, number> = {
  super_admin: 24 * 3600,
  director: 7 * 24 * 3600,
  finance: 3 * 24 * 3600,
  project_admin: 14 * 24 * 3600,
  staff: 30 * 24 * 3600,
  viewer: 7 * 24 * 3600,
};

export type SessionUser = {
  id: string;
  fullName: string;
  username: string | null;
  email: string | null;
  role: UserRole;
  allProjects: boolean;
  mustChangePassword: boolean;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string, role: UserRole, ip?: string, userAgent?: string) {
  const token = randomBytes(32).toString("base64url");
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { tokenVersion: true } });
  const expiresAt = new Date(Date.now() + ROLE_SESSION_SECONDS[role] * 1000);
  await db.session.create({
    data: { id: hashToken(token), userId, tokenVersion: user.tokenVersion, expiresAt, ip, userAgent },
  });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: await cookieAman(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/** Lihat env COOKIE_AMAN. */
async function cookieAman(): Promise<boolean> {
  if (env.COOKIE_AMAN === "1") return true;
  if (env.COOKIE_AMAN === "0") return false;
  if (env.APP_ENV !== "production") return false;
  const h = await headers();
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  return proto === "https";
}

export async function destroySession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.session.updateMany({
      where: { id: hashToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  cookieStore.delete(SESSION_COOKIE);
}

/** Cabut SEMUA sesi user (nonaktifkan / ganti password / paksa keluar). */
export async function revokeAllSessions(userId: string) {
  await db.$transaction([
    db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    db.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } }),
  ]);
}

/** User saat ini (cache per request). null bila tidak login / kedaluwarsa / dicabut. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { id: hashToken(token) },
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          username: true,
          email: true,
          role: true,
          isActive: true,
          allProjects: true,
          mustChangePassword: true,
          tokenVersion: true,
        },
      },
    },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  if (!session.user.isActive) return null;
  if (session.tokenVersion !== session.user.tokenVersion) return null;
  const { user } = session;
  return {
    id: user.id,
    fullName: user.fullName,
    username: user.username,
    email: user.email,
    role: user.role,
    allProjects: user.allProjects,
    mustChangePassword: user.mustChangePassword,
  };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/masuk");
  if (user.mustChangePassword) redirect("/ganti-password");
  return user;
}

export { ForbiddenError };

export async function requireCapability(capability: Capability): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user.role, capability)) throw new ForbiddenError();
  return user;
}

// ─── Lingkup proyek ──────────────────────────────────────────

/** Id proyek yang boleh diakses. `null` = semua proyek. */
export async function accessibleProjectIds(user: SessionUser): Promise<string[] | null> {
  if (isCrossProject(user.role, user.allProjects)) return null;
  const rows = await db.projectMember.findMany({ where: { userId: user.id }, select: { projectId: true } });
  return rows.map((r) => r.projectId);
}

/** Filter Prisma `projectId` sesuai lingkup. */
export function projectScope(ids: string[] | null): { projectId?: { in: string[] } } {
  return ids === null ? {} : { projectId: { in: ids } };
}

export async function hasProjectAccess(user: SessionUser, projectId: string): Promise<boolean> {
  if (isCrossProject(user.role, user.allProjects)) {
    return (await db.project.count({ where: { id: projectId } })) > 0;
  }
  const m = await db.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: user.id } },
    select: { id: true },
  });
  return m !== null;
}

export async function requireProjectAccess(user: SessionUser, projectId: string): Promise<void> {
  if (!(await hasProjectAccess(user, projectId))) {
    throw new ForbiddenError("Anda tidak punya akses ke proyek ini.");
  }
}

// ─── Request info ────────────────────────────────────────────

export async function requestIp(): Promise<string | undefined> {
  try {
    const h = await headers();
    return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || undefined;
  } catch {
    // Di luar scope request (skrip/uji) – IP memang tidak ada.
    return undefined;
  }
}
