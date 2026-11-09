"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { jalankan, sukses, type ActionState } from "@/lib/aksi";
import { auditIn } from "@/lib/audit";
import { requireCapability } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { parseRupiah } from "@/lib/uang";

const schema = z.object({
  orgName: z.string().trim().min(2, "Isi nama organisasi.").max(120),
  financeApproveCap: z.string().optional().transform((v, ctx) => {
    if (!v) return 0n;
    const n = parseRupiah(v);
    if (n === null) {
      ctx.addIssue({ code: "custom", message: "Batas tidak valid." });
      return z.NEVER;
    }
    return n;
  }),
  requireProof: z.union([z.literal("1"), z.literal(""), z.null(), z.undefined()]).transform((v) => v === "1"),
});

export async function simpanPengaturan(_p: ActionState, form: FormData): Promise<ActionState> {
  return jalankan(async () => {
    const user = await requireCapability("settings.manage");
    const d = schema.parse({
      orgName: form.get("orgName") ?? "",
      financeApproveCap: (form.get("financeApproveCap") as string) ?? undefined,
      requireProof: (form.get("requireProof") as string) ?? undefined,
    });
    await db.$transaction(async (tx) => {
      await tx.setting.upsert({ where: { id: 1 }, update: d, create: { id: 1, ...d } });
      await auditIn(tx, user.id, "settings.update", "setting", "1", d);
    });
    revalidatePath("/", "layout");
    return sukses("Pengaturan tersimpan.");
  });
}
