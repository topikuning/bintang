"use server";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { jalankan, sukses, type ActionState } from "@/lib/aksi";
import { audit, auditIn } from "@/lib/audit";
import { hashPassword } from "@/lib/auth/password";
import { requireCapability, requireUser, revokeAllSessions } from "@/lib/auth/session";
import { ROLES } from "@/lib/authz";
import { db } from "@/lib/db";
import { PesanError } from "@/lib/galat";
import { sandikan } from "@/lib/kripto";
import type { UserRole } from "@/generated/prisma/enums";

/** Password sementara yang mudah dibacakan lewat telepon: 3 suku kata + 3 angka. */
function passwordSementara(): string {
  const suku = ["ba", "di", "ku", "ma", "ne", "po", "ra", "si", "tu", "we", "ya", "lo", "ge", "fa", "ho"];
  let s = "";
  for (let i = 0; i < 3; i++) s += suku[randomInt(suku.length)];
  return `${s}${randomInt(100, 1000)}`;
}

const teks = (maks: number) => z.string().trim().max(maks).optional().transform((v) => v || null);

const schema = z.object({
  id: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  fullName: z.string().trim().min(2, "Isi nama lengkap.").max(120),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,50}$/, "Username 3–50 huruf kecil/angka/titik/strip.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  email: z.string().trim().toLowerCase().email("Email tidak valid.").optional().or(z.literal("").transform(() => undefined)),
  phone: teks(40),
  role: z.enum(ROLES as [UserRole, ...UserRole[]]),
  allProjects: z.union([z.literal("1"), z.literal(""), z.null(), z.undefined()]).transform((v) => v === "1"),
  isActive: z.union([z.literal("1"), z.literal(""), z.null(), z.undefined()]).transform((v) => v === "1"),
  resetPassword: z.union([z.literal("1"), z.literal(""), z.null(), z.undefined()]).transform((v) => v === "1"),
});

export type SimpanPenggunaState = (ActionState & { password?: string; untuk?: string }) | undefined;

export async function simpanPengguna(_p: SimpanPenggunaState, form: FormData): Promise<SimpanPenggunaState> {
  let password: string | undefined;
  let untuk: string | undefined;
  const hasil = await jalankan(async () => {
    const admin = await requireCapability("user.manage");
    const get = (k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : undefined);
    const d = schema.parse({
      id: get("id"),
      fullName: get("fullName") ?? "",
      username: get("username"),
      email: get("email"),
      phone: get("phone"),
      role: get("role"),
      allProjects: get("allProjects"),
      isActive: get("isActive"),
      resetPassword: get("resetPassword"),
    });
    if (!d.username && !d.email) throw new PesanError("Isi username atau email – salah satu dipakai untuk masuk.");
    const kembar = await db.user.findFirst({
      where: {
        OR: [...(d.username ? [{ username: d.username }] : []), ...(d.email ? [{ email: d.email }] : [])],
        ...(d.id ? { id: { not: d.id } } : {}),
      },
    });
    if (kembar) throw new PesanError(`Username/email sudah dipakai ${kembar.fullName}.`);

    if (d.id === admin.id && (!d.isActive || d.role !== admin.role)) {
      throw new PesanError("Anda tidak bisa menonaktifkan atau mengganti peran akun sendiri.");
    }

    const data = {
      fullName: d.fullName,
      username: d.username ?? null,
      email: d.email ?? null,
      phone: d.phone,
      role: d.role,
      allProjects: d.allProjects,
      isActive: d.isActive,
    };

    if (!d.id) {
      password = passwordSementara();
      untuk = d.fullName;
      const u = await db.user.create({ data: { ...data, passwordHash: await hashPassword(password), mustChangePassword: true } });
      await audit(admin.id, "user.create", "user", u.id, { ...data });
    } else {
      const lama = await db.user.findUniqueOrThrow({ where: { id: d.id } });
      const update: Record<string, unknown> = { ...data };
      if (d.resetPassword) {
        password = passwordSementara();
        untuk = d.fullName;
        update.passwordHash = await hashPassword(password);
        update.mustChangePassword = true;
      }
      await db.$transaction(async (tx) => {
        await tx.user.update({ where: { id: d.id }, data: update });
        await auditIn(tx, admin.id, "user.update", "user", d.id, { ...data, resetPassword: d.resetPassword });
      });
      // Sesi lama gugur bila akses menyempit atau password direset.
      if (d.resetPassword || !d.isActive || lama.role !== d.role || lama.allProjects !== d.allProjects) {
        await revokeAllSessions(d.id!);
      }
    }
    revalidatePath("/pengguna");
    return sukses(password ? "Tersimpan. Berikan password sementara di bawah ke penggunanya." : "Pengguna tersimpan.");
  });
  return hasil ? { ...hasil, password, untuk } : hasil;
}

// ─── Profil sendiri ──────────────────────────────────────────

const profil = z.object({
  fullName: z.string().trim().min(2, "Isi nama lengkap.").max(120),
  phone: teks(40),
  bankName: teks(80),
  bankAccount: teks(40),
  bankHolder: teks(200),
});

export async function simpanProfil(_p: ActionState, form: FormData): Promise<ActionState> {
  return jalankan(async () => {
    const user = await requireUser();
    const get = (k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : undefined);
    const d = profil.parse({
      fullName: get("fullName") ?? "",
      phone: get("phone"),
      bankName: get("bankName"),
      bankAccount: get("bankAccount"),
      bankHolder: get("bankHolder"),
    });
    await db.user.update({ where: { id: user.id }, data: { ...d, bankAccount: sandikan(d.bankAccount) } });
    await audit(user.id, "user.profile", "user", user.id, { fullName: d.fullName, bankName: d.bankName, bankAccount: d.bankAccount ? "(diubah)" : null });
    revalidatePath("/profil");
    revalidatePath("/", "layout");
    return sukses("Profil tersimpan.");
  });
}

// ─── Notifikasi ──────────────────────────────────────────────

export async function tandaiSemuaDibaca(): Promise<void> {
  const user = await requireUser();
  await db.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/", "layout");
}
