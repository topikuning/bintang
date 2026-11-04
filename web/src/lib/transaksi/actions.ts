"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { gagal, jalankan, sukses, type ActionState } from "@/lib/aksi";
import { requireCapability, requireUser, type SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { PesanError } from "@/lib/galat";
import { catatanWajib } from "@/lib/pengajuan/schema";
import { berkasDariForm, hapusBerkas, simpanBerkas, type BerkasTersimpan } from "@/lib/penyimpanan";
import * as svc from "./service";

const aktor = (u: SessionUser) => ({ id: u.id, role: u.role, allProjects: u.allProjects, fullName: u.fullName });

function segarkan(id?: string) {
  revalidatePath("/", "layout");
  revalidatePath("/transaksi");
  if (id) revalidatePath(`/transaksi/${id}`);
}

export async function catatTransaksi(_prev: ActionState, form: FormData): Promise<ActionState> {
  let tujuan: string | null = null;
  const hasil = await jalankan(async () => {
    const user = await requireCapability("tx.create");
    let items: unknown;
    try {
      items = JSON.parse(String(form.get("items") ?? "[]"));
    } catch {
      throw new PesanError("Rincian tidak terbaca.");
    }
    const input = svc.txSchema.parse({
      projectId: form.get("projectId"),
      kind: form.get("kind"),
      date: form.get("date"),
      accountId: form.get("accountId") ?? "",
      method: form.get("method") || "transfer",
      description: form.get("description") ?? "",
      partyId: form.get("partyId") ?? "",
      partyName: form.get("partyName") ?? undefined,
      reference: form.get("reference") ?? undefined,
      items,
    });
    const files = berkasDariForm(form, "lampiran");
    const tersimpan: BerkasTersimpan[] = [];
    try {
      for (const f of files) tersimpan.push(await simpanBerkas(f, "transaksi"));
      const r = await db.$transaction((tx) => svc.catat(tx, aktor(user), input, tersimpan));
      segarkan(r.id);
      tujuan = `/transaksi/${r.id}?pesan=${r.langsung ? "tercatat" : "menunggu"}`;
      return sukses("Tercatat.");
    } catch (e) {
      await Promise.all(tersimpan.map((b) => hapusBerkas(b.storageKey).catch(() => undefined)));
      throw e;
    }
  });
  if (tujuan) redirect(tujuan);
  return hasil;
}

export async function verifikasiTransaksi(id: string, _prev: ActionState, _form: FormData): Promise<ActionState> {
  return jalankan(async () => {
    const user = await requireCapability("tx.verify");
    await db.$transaction((tx) => svc.verifikasi(tx, aktor(user), id));
    segarkan(id);
    return sukses("Transaksi terverifikasi.");
  });
}

export async function tolakTransaksi(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  return jalankan(async () => {
    const user = await requireCapability("tx.verify");
    const alasan = catatanWajib.parse(form.get("note") ?? "");
    await db.$transaction((tx) => svc.tolak(tx, aktor(user), id, alasan));
    segarkan(id);
    return sukses("Transaksi ditolak.");
  });
}

export async function batalkanTransaksi(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  return jalankan(async () => {
    const user = await requireUser();
    const alasan = catatanWajib.parse(form.get("note") ?? "");
    await db.$transaction((tx) => svc.batalkan(tx, aktor(user), id, alasan));
    segarkan(id);
    return sukses("Transaksi dibatalkan.");
  });
}

/** Verifikasi beberapa sekaligus dari daftar (hanya yang masih menunggu). */
export async function verifikasiMassal(_prev: ActionState, form: FormData): Promise<ActionState> {
  return jalankan(async () => {
    const user = await requireCapability("tx.verify");
    const ids = form.getAll("ids").map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
    if (!ids.length) return gagal("Pilih transaksi yang akan diverifikasi.");
    let ok = 0;
    for (const id of ids) {
      await db.$transaction((tx) => svc.verifikasi(tx, aktor(user), id));
      ok++;
    }
    segarkan();
    return sukses(`${ok} transaksi terverifikasi.`);
  });
}
