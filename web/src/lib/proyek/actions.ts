"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { jalankan, sukses, type ActionState } from "@/lib/aksi";
import { auditIn } from "@/lib/audit";
import { requireCapability } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { PesanError } from "@/lib/galat";
import { berkasDariForm, hapusBerkas, simpanBerkas, type BerkasTersimpan } from "@/lib/penyimpanan";
import { keyKeTanggal } from "@/lib/tanggal";
import { parseRupiah } from "@/lib/uang";

const rupiahOpsional = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (!v) return 0n;
    const n = parseRupiah(v);
    if (n === null) {
      ctx.addIssue({ code: "custom", message: "Angka tidak valid." });
      return z.NEVER;
    }
    return n;
  });
const tanggal = z
  .string()
  .optional()
  .transform((v) => (v ? keyKeTanggal(v) : null));

const schema = z
  .object({
    code: z
      .string()
      .trim()
      .min(2, "Kode minimal 2 karakter.")
      .max(30)
      .regex(/^[A-Za-z0-9._-]+$/, "Kode hanya huruf, angka, titik, strip.")
      .transform((v) => v.toUpperCase()),
    name: z.string().trim().min(3, "Nama proyek minimal 3 huruf.").max(200),
    kind: z.enum(["proyek", "operasional"]),
    companyId: z.string().uuid("Pilih perusahaan."),
    client: z.string().trim().max(200).optional().transform((v) => v || null),
    location: z.string().trim().max(200).optional().transform((v) => v || null),
    contractValue: rupiahOpsional,
    budget: rupiahOpsional,
    startDate: tanggal,
    endDate: tanggal,
    status: z.enum(["aktif", "ditahan", "selesai", "batal"]),
    notes: z.string().trim().max(2000).optional().transform((v) => v || null),
    members: z.array(z.string().uuid()).max(500),
  })
  .refine((d) => !d.startDate || !d.endDate || d.endDate >= d.startDate, {
    message: "Tanggal selesai tidak boleh sebelum tanggal mulai.",
    path: ["endDate"],
  });

export async function simpanProyek(_prev: ActionState, form: FormData): Promise<ActionState> {
  let tujuan: string | null = null;
  const hasil = await jalankan(async () => {
    const user = await requireCapability("project.manage");
    const id = (form.get("id") as string) || undefined;
    const d = schema.parse({
      code: form.get("code") ?? "",
      name: form.get("name") ?? "",
      kind: form.get("kind") || "proyek",
      companyId: form.get("companyId") ?? "",
      client: form.get("client") ?? undefined,
      location: form.get("location") ?? undefined,
      contractValue: form.get("contractValue") ?? undefined,
      budget: form.get("budget") ?? undefined,
      startDate: form.get("startDate") ?? undefined,
      endDate: form.get("endDate") ?? undefined,
      status: form.get("status") || "aktif",
      notes: form.get("notes") ?? undefined,
      members: form.getAll("members").map(String),
    });
    const kembar = await db.project.findFirst({ where: { code: d.code, ...(id ? { id: { not: id } } : {}) } });
    if (kembar) throw new PesanError(`Kode ${d.code} sudah dipakai proyek "${kembar.name}".`);
    const { members, ...data } = d;
    const pid = await db.$transaction(async (tx) => {
      const p = id ? await tx.project.update({ where: { id }, data }) : await tx.project.create({ data });
      await tx.projectMember.deleteMany({ where: { projectId: p.id, userId: { notIn: members } } });
      for (const userId of members) {
        await tx.projectMember.upsert({
          where: { projectId_userId: { projectId: p.id, userId } },
          update: {},
          create: { projectId: p.id, userId },
        });
      }
      await auditIn(tx, user.id, id ? "project.update" : "project.create", "project", p.id, { ...data, members: members.length });
      return p.id;
    });
    revalidatePath("/proyek");
    revalidatePath(`/proyek/${pid}`);
    tujuan = `/proyek/${pid}`;
    return sukses("Proyek tersimpan.");
  });
  if (tujuan) redirect(tujuan);
  return hasil;
}

// ─── Dokumen proyek (kontrak, SPK, BAST, …) ──────────────────

export async function unggahDokumenProyek(projectId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  return jalankan(async () => {
    const user = await requireCapability("project.manage");
    const label = z.string().trim().min(2, "Beri judul dokumennya, mis. Kontrak No. 12/2026.").max(200).parse(form.get("label") ?? "");
    const files = berkasDariForm(form, "dokumen");
    if (!files.length) throw new PesanError("Pilih berkasnya dulu.");
    const tersimpan: BerkasTersimpan[] = [];
    try {
      for (const f of files) tersimpan.push(await simpanBerkas(f, "proyek"));
      await db.$transaction(async (tx) => {
        await tx.attachment.createMany({
          data: tersimpan.map((b, i) => ({
            ...b,
            kind: "lainnya" as const,
            label: files.length > 1 ? `${label} (${i + 1})` : label,
            projectId,
            uploadedById: user.id,
          })),
        });
        await auditIn(tx, user.id, "project.document_add", "project", projectId, { label, berkas: tersimpan.length });
      });
    } catch (e) {
      await Promise.all(tersimpan.map((b) => hapusBerkas(b.storageKey).catch(() => undefined)));
      throw e;
    }
    revalidatePath(`/proyek/${projectId}`);
    return sukses("Dokumen tersimpan.");
  });
}

export async function hapusDokumenProyek(attachmentId: string, projectId: string, _prev: ActionState, _form: FormData): Promise<ActionState> {
  return jalankan(async () => {
    const user = await requireCapability("project.manage");
    const a = await db.attachment.findFirst({ where: { id: attachmentId, projectId } });
    if (!a) throw new PesanError("Dokumen tidak ditemukan.");
    await db.$transaction(async (tx) => {
      await tx.attachment.delete({ where: { id: a.id } });
      await auditIn(tx, user.id, "project.document_delete", "project", projectId, { label: a.label, fileName: a.fileName });
    });
    await hapusBerkas(a.storageKey).catch(() => undefined);
    revalidatePath(`/proyek/${projectId}`);
    return sukses("Dokumen dihapus.");
  });
}
