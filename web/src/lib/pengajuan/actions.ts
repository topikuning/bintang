"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { gagal, jalankan, sukses, type ActionState } from "@/lib/aksi";
import { audit } from "@/lib/audit";
import { requireCapability, requireUser, type SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { PesanError } from "@/lib/galat";
import { sandikan } from "@/lib/kripto";
import { berkasDariForm, hapusBerkas, simpanBerkas, type BerkasTersimpan } from "@/lib/penyimpanan";
import { hariIniKey } from "@/lib/tanggal";
import { bacaPengajuanForm, bayarSchema, catatanWajib, realisasiSchema } from "./schema";
import * as svc from "./service";

function aktor(u: SessionUser): svc.Aktor {
  return { id: u.id, role: u.role, allProjects: u.allProjects, fullName: u.fullName };
}

function segarkan(id?: string) {
  revalidatePath("/", "layout");
  revalidatePath("/pengajuan");
  if (id) revalidatePath(`/pengajuan/${id}`);
}

/**
 * Simpan berkas DULU (di luar transaksi DB – disk tidak ikut rollback), lalu
 * jalankan transaksi. Bila transaksi gagal, berkas yang terlanjur tersimpan
 * dibuang supaya tidak jadi yatim.
 */
async function denganBerkas<T>(
  files: File[],
  folder: string,
  fn: (berkas: BerkasTersimpan[]) => Promise<T>,
): Promise<T> {
  const tersimpan: BerkasTersimpan[] = [];
  try {
    for (const f of files) tersimpan.push(await simpanBerkas(f, folder));
    return await fn(tersimpan);
  } catch (e) {
    await Promise.all(tersimpan.map((b) => hapusBerkas(b.storageKey).catch(() => undefined)));
    throw e;
  }
}

// ─── Simpan / ajukan ─────────────────────────────────────────

export async function simpanPengajuan(_prev: ActionState, form: FormData): Promise<ActionState> {
  let tujuan: string | null = null;
  const hasil = await jalankan(async () => {
    const user = await requireCapability("request.create");
    const id = (form.get("id") as string) || undefined;
    const ajukan = form.get("intent") === "ajukan";
    const input = bacaPengajuanForm(form);
    if (ajukan) {
      const kosong = input.items.flatMap((it, i) => (it.categoryId ? [] : [i]));
      if (kosong.length) {
        return gagal(
          "Pilih kategori untuk setiap rincian sebelum mengajukan.",
          Object.fromEntries(kosong.map((i) => [`items.${i}.categoryId`, "Pilih kategori."])),
        );
      }
    }
    const files = berkasDariForm(form, "lampiran");
    const r = await denganBerkas(files, "pengajuan", (lampiran) =>
      db.$transaction((tx) => svc.simpan(tx, aktor(user), input, { id, ajukan, lampiran })),
    );
    segarkan(r.id);
    tujuan = `/pengajuan/${r.id}?pesan=${ajukan ? "diajukan" : "draf"}`;
    return sukses(ajukan ? "Pengajuan terkirim." : "Draf tersimpan.");
  });
  if (tujuan && hasil?.ok) redirect(tujuan);
  return hasil;
}

export async function ajukanDraf(id: string, _prev: ActionState, _form: FormData): Promise<ActionState> {
  return jalankan(async () => {
    const user = await requireUser();
    const { number } = await db.$transaction((tx) => svc.ajukan(tx, aktor(user), id));
    segarkan(id);
    return sukses(`Terkirim dengan nomor ${number}.`);
  });
}

export async function hapusDraf(id: string, _prev: ActionState, _form: FormData): Promise<ActionState> {
  const hasil = await jalankan(async () => {
    const user = await requireUser();
    const keys = await db.$transaction((tx) => svc.hapusDraft(tx, aktor(user), id));
    await Promise.all(keys.map((k) => hapusBerkas(k).catch(() => undefined)));
    segarkan();
    return sukses("Draf dihapus.");
  });
  if (hasil?.ok) redirect("/pengajuan?tab=draf");
  return hasil;
}

// ─── Persetujuan ─────────────────────────────────────────────

const catatanOpsional = z
  .string()
  .trim()
  .max(1000)
  .optional()
  .transform((v) => v || undefined);

export async function setujuiPengajuan(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  return jalankan(async () => {
    const user = await requireCapability("request.approve");
    const catatan = catatanOpsional.parse(form.get("note") ?? undefined);
    await db.$transaction((tx) => svc.setujui(tx, aktor(user), id, catatan));
    segarkan(id);
    return sukses("Pengajuan disetujui.");
  });
}

export async function mintaRevisiPengajuan(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  return jalankan(async () => {
    const user = await requireUser();
    const catatan = catatanWajib.parse(form.get("note") ?? "");
    await db.$transaction((tx) => svc.mintaRevisi(tx, aktor(user), id, catatan));
    segarkan(id);
    return sukses("Dikembalikan ke pemohon untuk diperbaiki.");
  });
}

export async function tolakPengajuan(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  return jalankan(async () => {
    const user = await requireCapability("request.approve");
    const alasan = catatanWajib.parse(form.get("note") ?? "");
    await db.$transaction((tx) => svc.tolak(tx, aktor(user), id, alasan));
    segarkan(id);
    return sukses("Pengajuan ditolak.");
  });
}

export async function batalkanPengajuan(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  return jalankan(async () => {
    const user = await requireUser();
    const alasan = catatanOpsional.parse(form.get("note") ?? undefined);
    await db.$transaction((tx) => svc.batalkan(tx, aktor(user), id, alasan));
    segarkan(id);
    return sukses("Pengajuan dibatalkan.");
  });
}

// ─── Pembayaran ──────────────────────────────────────────────

function bacaBayar(form: FormData) {
  return bayarSchema.parse({
    paidDate: form.get("paidDate") || hariIniKey(),
    accountId: form.get("accountId") ?? "",
    method: form.get("method") || "transfer",
    reference: form.get("reference") ?? undefined,
    note: form.get("note") ?? undefined,
  });
}

export async function bayarPengajuan(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  return jalankan(async () => {
    const user = await requireCapability("request.pay");
    const input = bacaBayar(form);
    const gabung = form.get("gabung") === "1";
    const r = await denganBerkas(berkasDariForm(form, "bukti"), "bukti-bayar", (bukti) =>
      db.$transaction((tx) =>
        gabung
          ? svc.setujuiDanBayar(tx, aktor(user), id, input, bukti)
          : svc.bayar(tx, aktor(user), id, input, bukti),
      ),
    );
    segarkan(id);
    revalidatePath("/transaksi");
    return sukses(`${gabung ? "Disetujui & dibayar" : "Tercatat dibayar"} – ${r.transactionNumber}.`);
  });
}

export async function batalkanPembayaran(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  return jalankan(async () => {
    const user = await requireCapability("request.pay");
    const alasan = catatanWajib.parse(form.get("note") ?? "");
    await db.$transaction((tx) => svc.batalkanPembayaran(tx, aktor(user), id, alasan));
    segarkan(id);
    revalidatePath("/transaksi");
    return sukses("Pencatatan pembayaran dibatalkan. Pengajuan kembali ke status disetujui.");
  });
}

// ─── LPJ ─────────────────────────────────────────────────────

export async function ajukanLpj(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  let ok = false;
  const hasil = await jalankan(async () => {
    const user = await requireUser();
    let mentah: unknown;
    try {
      mentah = JSON.parse(String(form.get("realisasi") ?? "[]"));
    } catch {
      throw new PesanError("Rincian pemakaian tidak terbaca.");
    }
    const realisasi = realisasiSchema.parse(mentah);
    const catatan = catatanOpsional.parse(form.get("note") ?? undefined);
    await denganBerkas(berkasDariForm(form, "nota"), "lpj", (nota) =>
      db.$transaction((tx) => svc.ajukanLpj(tx, aktor(user), id, realisasi, catatan, nota)),
    );
    segarkan(id);
    ok = true;
    return sukses("LPJ terkirim ke Keuangan.");
  });
  if (ok) redirect(`/pengajuan/${id}?pesan=lpj`);
  return hasil;
}

export async function kembalikanLpj(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  return jalankan(async () => {
    const user = await requireCapability("request.verify_lpj");
    const catatan = catatanWajib.parse(form.get("note") ?? "");
    await db.$transaction((tx) => svc.kembalikanLpj(tx, aktor(user), id, catatan));
    segarkan(id);
    return sukses("LPJ dikembalikan ke pemohon.");
  });
}

export async function terimaLpj(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  return jalankan(async () => {
    const user = await requireCapability("request.verify_lpj");
    const b = bacaBayar(form);
    const r = await db.$transaction((tx) =>
      svc.terimaLpj(tx, aktor(user), id, { date: b.paidDate, accountId: b.accountId, method: b.method, note: b.note }),
    );
    segarkan(id);
    revalidatePath("/transaksi");
    return sukses(
      r.arah === "pas" ? "LPJ diterima. Uang muka selesai." : r.arah === "kembali" ? "LPJ diterima, sisa uang muka dicatat masuk kas." : "LPJ diterima, kekurangan dicatat sebagai pembayaran.",
    );
  });
}

// ─── Lampiran ────────────────────────────────────────────────

export async function hapusLampiran(attachmentId: string, requestId: string, _prev: ActionState, _form: FormData): Promise<ActionState> {
  return jalankan(async () => {
    const user = await requireUser();
    const key = await db.$transaction((tx) => svc.hapusLampiran(tx, aktor(user), attachmentId));
    await hapusBerkas(key).catch(() => undefined);
    segarkan(requestId);
    return sukses("Lampiran dihapus.");
  });
}

// ─── Penerima baru (dari form pengajuan) ─────────────────────

const pihakCepat = z.object({
  name: z.string().trim().min(2, "Nama penerima minimal 2 huruf.").max(200),
  bankName: z.string().trim().max(80).optional(),
  bankAccount: z.string().trim().max(40).optional(),
  bankHolder: z.string().trim().max(200).optional(),
});

export async function tambahPihakCepat(input: {
  name: string;
  bankName?: string;
  bankAccount?: string;
  bankHolder?: string;
}): Promise<{ ok: true; id: string; name: string } | { ok: false; error: string }> {
  try {
    const user = await requireCapability("party.create");
    const d = pihakCepat.parse(input);
    const ada = await db.party.findFirst({ where: { name: { equals: d.name, mode: "insensitive" } } });
    if (ada) return { ok: true, id: ada.id, name: ada.name };
    const p = await db.party.create({
      data: {
        name: d.name,
        kind: "vendor",
        bankName: d.bankName || null,
        bankAccount: sandikan(d.bankAccount),
        bankHolder: d.bankHolder || null,
      },
    });
    await audit(user.id, "party.create", "party", p.id, { name: p.name, sumber: "form pengajuan" });
    return { ok: true, id: p.id, name: p.name };
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0].message };
    return { ok: false, error: e instanceof Error ? e.message : "Gagal menambah penerima." };
  }
}
