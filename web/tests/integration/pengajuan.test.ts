import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ringkasan } from "@/lib/keuangan/queries";
import * as svc from "@/lib/pengajuan/service";
import * as txsvc from "@/lib/transaksi/service";
import { dasar, fixtures } from "./helper";

let f: Awaited<ReturnType<typeof fixtures>>;
beforeEach(async () => {
  f = await fixtures();
});
afterAll(async () => {
  await db.$disconnect();
});

const bayarInput = (accountId: string) => ({ paidDate: "2026-11-04", accountId, method: "transfer" as const, reference: "REF-1", note: undefined });

async function ajukanPembayaran(total = 1_500_000n, kind: "pembayaran" | "uang_muka" | "penggantian" = "pembayaran") {
  return db.$transaction((tx) =>
    svc.simpan(
      tx,
      f.staf,
      {
        ...dasar,
        projectId: f.proyek.id,
        kind,
        title: "Beli semen",
        items: [{ categoryId: f.material.id, description: "Semen", amount: total, quantity: undefined, unit: undefined, unitPrice: undefined }],
      },
      { ajukan: true, lampiran: [] },
    ),
  );
}

describe("alur pengajuan pembayaran", () => {
  it("ajukan → setujui → bayar membuat transaksi kas terverifikasi dan menulis riwayat + audit + notifikasi", async () => {
    const r = await ajukanPembayaran();
    expect(r.status).toBe("diajukan");
    expect(r.number).toMatch(/^PGJ\/\d{4}\/\d{2}\/0001$/);

    await db.$transaction((tx) => svc.setujui(tx, f.keuangan, r.id, "ok"));
    const { transactionNumber } = await db.$transaction((tx) => svc.bayar(tx, f.keuangan, r.id, bayarInput(f.rekening.id), []));

    const p = await db.paymentRequest.findUniqueOrThrow({ where: { id: r.id }, include: { events: true } });
    expect(p.status).toBe("dibayar");
    expect(p.closedAt).not.toBeNull();
    expect(p.events.map((e) => e.toStatus)).toEqual(["draft", "diajukan", "disetujui", "dibayar"]);

    const t = await db.transaction.findUniqueOrThrow({ where: { number: transactionNumber }, include: { items: true } });
    expect(t).toMatchObject({ kind: "pengeluaran", status: "terverifikasi", amount: 1_500_000n, requestId: r.id, accountId: f.rekening.id });
    expect(t.items[0].categoryId).toBe(f.material.id);

    const s = await ringkasan([f.proyek.id]);
    expect(s.biaya).toBe(1_500_000n);
    expect(await db.auditLog.count({ where: { resourceId: r.id } })).toBeGreaterThanOrEqual(4);
    expect(await db.notification.count({ where: { userId: f.staf.id } })).toBe(2); // disetujui + dibayar
  });

  it("nomor pengajuan unik walau diajukan bersamaan", async () => {
    const hasil = await Promise.all(Array.from({ length: 8 }, () => ajukanPembayaran()));
    const nomor = hasil.map((h) => h.number);
    expect(new Set(nomor).size).toBe(8);
  });

  it("dua klik bayar bersamaan → hanya satu transaksi", async () => {
    const r = await ajukanPembayaran();
    await db.$transaction((tx) => svc.setujui(tx, f.keuangan, r.id));
    const hasil = await Promise.allSettled([
      db.$transaction((tx) => svc.bayar(tx, f.keuangan, r.id, bayarInput(f.rekening.id), [])),
      db.$transaction((tx) => svc.bayar(tx, f.keuangan, r.id, bayarInput(f.rekening.id), [])),
    ]);
    expect(hasil.filter((h) => h.status === "fulfilled")).toHaveLength(1);
    expect(await db.transaction.count({ where: { requestId: r.id } })).toBe(1);
  });

  it("pemohon tidak bisa menyetujui pengajuannya sendiri, staf tidak bisa membayar", async () => {
    const r = await ajukanPembayaran();
    await expect(db.$transaction((tx) => svc.setujui(tx, f.staf, r.id))).rejects.toThrow();
    await db.$transaction((tx) => svc.setujui(tx, f.keuangan, r.id));
    await expect(db.$transaction((tx) => svc.bayar(tx, f.staf, r.id, bayarInput(f.rekening.id), []))).rejects.toThrow(/berwenang/);
  });

  it("di atas batas keuangan → hanya pimpinan", async () => {
    await db.setting.update({ where: { id: 1 }, data: { financeApproveCap: 1_000_000n } });
    const r = await ajukanPembayaran(5_000_000n);
    await expect(db.$transaction((tx) => svc.setujui(tx, f.keuangan, r.id))).rejects.toThrow(/Pimpinan/);
    await db.$transaction((tx) => svc.setujui(tx, f.pimpinan, r.id));
    expect((await db.paymentRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("disetujui");
  });

  it("revisi → ubah → ajukan ulang memakai nomor yang sama", async () => {
    const r = await ajukanPembayaran();
    await db.$transaction((tx) => svc.mintaRevisi(tx, f.keuangan, r.id, "Lampirkan nota"));
    const ulang = await db.$transaction((tx) =>
      svc.simpan(
        tx,
        f.staf,
        { ...dasar, projectId: f.proyek.id, kind: "pembayaran", title: "Beli semen (revisi)", items: [{ categoryId: f.material.id, description: "Semen", amount: 1_400_000n, quantity: undefined, unit: undefined, unitPrice: undefined }] },
        { id: r.id, ajukan: true, lampiran: [] },
      ),
    );
    expect(ulang.number).toBe(r.number);
    const p = await db.paymentRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(p.total).toBe(1_400_000n);
    expect(p.status).toBe("diajukan");
  });

  it("batalkan pembayaran: transaksi ikut batal, pengajuan kembali disetujui", async () => {
    const r = await ajukanPembayaran();
    await db.$transaction((tx) => svc.setujui(tx, f.keuangan, r.id));
    await db.$transaction((tx) => svc.bayar(tx, f.keuangan, r.id, bayarInput(f.rekening.id), []));
    await db.$transaction((tx) => svc.batalkanPembayaran(tx, f.keuangan, r.id, "salah rekening"));
    expect((await db.paymentRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("disetujui");
    expect((await db.transaction.findFirstOrThrow({ where: { requestId: r.id } })).status).toBe("dibatalkan");
    expect((await ringkasan([f.proyek.id])).kasKeluar).toBe(0n);
  });
});

describe("uang muka & LPJ", () => {
  it("LPJ melebihi uang muka → kekurangan dibayar sebagai uang muka tambahan, biaya per kategori diakui", async () => {
    const r = await ajukanPembayaran(2_000_000n, "uang_muka");
    await db.$transaction((tx) => svc.setujui(tx, f.keuangan, r.id));
    await db.$transaction((tx) => svc.bayar(tx, f.keuangan, r.id, bayarInput(f.rekening.id), []));
    let s = await ringkasan([f.proyek.id]);
    expect(s.biaya).toBe(0n);
    expect(s.uangMukaBerjalan).toBe(2_000_000n);

    await db.$transaction((tx) =>
      svc.ajukanLpj(tx, f.staf, r.id, [
        { categoryId: f.material.id, description: "Semen", amount: 1_700_000n },
        { categoryId: f.upah.id, description: "Kuli", amount: 500_000n },
      ], undefined, []),
    );
    const hasil = await db.$transaction((tx) => svc.terimaLpj(tx, f.keuangan, r.id, { date: "2026-11-04", accountId: f.kas.id, method: "tunai" }));
    expect(hasil).toEqual({ arah: "kurang", jumlah: 200_000n });

    s = await ringkasan([f.proyek.id]);
    expect(s.biaya).toBe(2_200_000n);
    expect(s.uangMukaBerjalan).toBe(0n);
    expect(s.kasKeluar).toBe(2_200_000n);
    expect((await db.paymentRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("selesai");
  });

  it("LPJ tanpa rincian wajib catatan (uang dikembalikan utuh)", async () => {
    const r = await ajukanPembayaran(1_000_000n, "uang_muka");
    await db.$transaction((tx) => svc.setujui(tx, f.keuangan, r.id));
    await db.$transaction((tx) => svc.bayar(tx, f.keuangan, r.id, bayarInput(f.rekening.id), []));
    await expect(db.$transaction((tx) => svc.ajukanLpj(tx, f.staf, r.id, [], undefined, []))).rejects.toThrow(/catatan/);
    await db.$transaction((tx) => svc.ajukanLpj(tx, f.staf, r.id, [], "Batal belanja, uang utuh", []));
    const hasil = await db.$transaction((tx) => svc.terimaLpj(tx, f.keuangan, r.id, { date: "2026-11-04", accountId: f.rekening.id, method: "transfer" }));
    expect(hasil).toEqual({ arah: "kembali", jumlah: 1_000_000n });
    const s = await ringkasan([f.proyek.id]);
    expect(s.saldo).toBe(0n);
    expect(s.biaya).toBe(0n);
  });
});

describe("lingkup & buku kas", () => {
  it("staf tidak bisa mengajukan di proyek yang bukan miliknya", async () => {
    await expect(
      db.$transaction((tx) =>
        svc.simpan(
          tx,
          f.staf,
          { ...dasar, projectId: f.proyekLain.id, kind: "pembayaran", title: "Coba", items: [{ categoryId: f.material.id, description: "x", amount: 1n, quantity: undefined, unit: undefined, unitPrice: undefined }] },
          { ajukan: false, lampiran: [] },
        ),
      ),
    ).rejects.toThrow(/akses/);
  });

  it("kas dari admin proyek menunggu verifikasi dan tidak dihitung sebelum diverifikasi", async () => {
    const input = txsvc.txSchema.parse({
      projectId: f.proyek.id,
      kind: "pemasukan",
      date: "2026-11-04",
      accountId: f.rekening.id,
      method: "transfer",
      description: "Termin 1",
      items: [{ categoryId: f.termin.id, amount: "5.000.000" }],
    });
    const r = await db.$transaction((tx) => txsvc.catat(tx, f.admin, input, []));
    expect(r.langsung).toBe(false);
    expect((await ringkasan([f.proyek.id])).kasMasuk).toBe(0n);
    await db.$transaction((tx) => txsvc.verifikasi(tx, f.keuangan, r.id));
    expect((await ringkasan([f.proyek.id])).kasMasuk).toBe(5_000_000n);
  });

  it("kategori harus searah dengan jenis kas", async () => {
    const input = txsvc.txSchema.parse({
      projectId: f.proyek.id,
      kind: "pemasukan",
      date: "2026-11-04",
      description: "Salah kategori",
      items: [{ categoryId: f.material.id, amount: "1000" }],
    });
    await expect(db.$transaction((tx) => txsvc.catat(tx, f.keuangan, input, []))).rejects.toThrow(/kas masuk/);
  });

  it("jejak audit tidak bisa diubah", async () => {
    const r = await ajukanPembayaran();
    const log = await db.auditLog.findFirstOrThrow({ where: { resourceId: r.id } });
    await expect(db.auditLog.update({ where: { id: log.id }, data: { action: "palsu" } })).rejects.toThrow();
  });
});

describe("dokumen proyek", () => {
  it("lampiran wajib tepat satu pemilik (dijaga CHECK di DB)", async () => {
    const dasarBerkas = { fileName: "kontrak.pdf", mimeType: "application/pdf", size: 10, uploadedById: f.keuangan.id };
    const ok = await db.attachment.create({ data: { ...dasarBerkas, storageKey: "proyek/uji-1.pdf", projectId: f.proyek.id, label: "Kontrak" } });
    expect(ok.projectId).toBe(f.proyek.id);
    const r = await ajukanPembayaran();
    await expect(
      db.attachment.create({ data: { ...dasarBerkas, storageKey: "proyek/uji-2.pdf", projectId: f.proyek.id, requestId: r.id } }),
    ).rejects.toThrow();
    await expect(db.attachment.create({ data: { ...dasarBerkas, storageKey: "proyek/uji-3.pdf" } })).rejects.toThrow();
  });
});
