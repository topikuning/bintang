"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { hashPassword } from "@/lib/auth/password";
import { createSession, requestIp } from "@/lib/auth/session";
import { db } from "@/lib/db";

export type MulaiState = { error?: string } | undefined;

const KATEGORI_KELUAR = ["Material", "Upah tukang", "Sewa alat", "Transportasi", "Konsumsi", "BBM", "ATK & kantor", "Perizinan", "Pajak", "Lain-lain"];
const KATEGORI_MASUK = ["Termin proyek", "Uang muka proyek", "Pendapatan lain"];

const schema = z
  .object({
    orgName: z.string().trim().min(2, "Isi nama organisasi.").max(120),
    fullName: z.string().trim().min(2, "Isi nama Anda.").max(120),
    username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,50}$/, "Username 3–50 huruf kecil/angka/titik/strip."),
    password: z.string().min(8, "Password minimal 8 karakter.").max(255),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, { message: "Konfirmasi password tidak sama.", path: ["confirm"] });

/**
 * Pemasangan pertama: membuat Admin Sistem, pengaturan, dan kategori bawaan.
 * HANYA berlaku selama belum ada satu pun pengguna – dicek ulang di dalam
 * transaksi dengan kunci advisory, jadi dua orang yang membuka layar ini
 * bersamaan tidak bisa sama-sama menjadi admin.
 */
export async function mulai(_p: MulaiState, form: FormData): Promise<MulaiState> {
  const parsed = schema.safeParse({
    orgName: form.get("orgName"),
    fullName: form.get("fullName"),
    username: form.get("username"),
    password: form.get("password"),
    confirm: form.get("confirm"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const passwordHash = await hashPassword(d.password);
  const user = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(424242)`;
    if ((await tx.user.count()) > 0) return null;
    const u = await tx.user.create({ data: { fullName: d.fullName, username: d.username, passwordHash, role: "super_admin" } });
    await tx.setting.upsert({ where: { id: 1 }, update: { orgName: d.orgName }, create: { id: 1, orgName: d.orgName } });
    if ((await tx.category.count()) === 0) {
      await tx.category.createMany({
        data: [
          ...KATEGORI_KELUAR.map((name, i) => ({ name, direction: "keluar" as const, sortOrder: i })),
          ...KATEGORI_MASUK.map((name, i) => ({ name, direction: "masuk" as const, sortOrder: i })),
        ],
      });
    }
    return u;
  });
  if (!user) redirect("/masuk");
  const h = await headers();
  await createSession(user.id, user.role, await requestIp(), h.get("user-agent") ?? undefined);
  await audit(user.id, "system.setup", "user", user.id, { orgName: d.orgName });
  redirect("/master");
}
