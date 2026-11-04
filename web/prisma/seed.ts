/**
 * Seed Bintang v3.
 *
 *   pnpm db:seed            → data demo lengkap (pengguna tiap peran, proyek,
 *                             pengajuan di berbagai status). Password: bintang123
 *   pnpm db:seed -- --bersih → instalasi bersih: 1 admin + kategori + pengaturan.
 *                             Password admin dicetak SEKALI dan wajib diganti.
 *
 * Pengajuan demo dibuat LEWAT service yang sama dengan aplikasi – jadi seed ini
 * sekaligus membuktikan alurnya jalan, bukan menulis baris DB yang mustahil
 * terjadi lewat layar.
 */
import { randomBytes } from "node:crypto";

try {
  process.loadEnvFile();
} catch {
  // env dari platform
}

const BERSIH = process.argv.includes("--bersih");

async function main() {
  const { db } = await import("@/lib/db");
  const { hashPassword } = await import("@/lib/auth/password");
  const svc = await import("@/lib/pengajuan/service");
  const { sandikan } = await import("@/lib/kripto");
  const { nomorBerikutnya } = await import("@/lib/nomor");
  const { keyKeTanggal, hariIniKey } = await import("@/lib/tanggal");

  const env = process.env.APP_ENV ?? "development";
  if (!BERSIH && env === "production") {
    throw new Error("Seed demo ditolak di produksi. Pakai --bersih untuk instalasi awal.");
  }

  if (!BERSIH) {
    await db.setting.upsert({ where: { id: 1 }, update: { orgName: "PT Bintang Konstruksi" }, create: { id: 1, orgName: "PT Bintang Konstruksi" } });
  }

  // ─── Kategori ────────────────────────────────────────────
  const KELUAR = [
    "Material",
    "Upah tukang",
    "Sewa alat",
    "Transportasi",
    "Konsumsi",
    "BBM",
    "ATK & kantor",
    "Perizinan",
    "Marketing",
    "Pajak",
    "Lain-lain",
  ];
  const MASUK = ["Termin proyek", "Uang muka proyek", "Pendapatan lain"];
  for (const [i, name] of KELUAR.entries()) {
    await db.category.upsert({
      where: { direction_name: { direction: "keluar", name } },
      update: {},
      create: { name, direction: "keluar", sortOrder: i },
    });
  }
  for (const [i, name] of MASUK.entries()) {
    await db.category.upsert({
      where: { direction_name: { direction: "masuk", name } },
      update: {},
      create: { name, direction: "masuk", sortOrder: i },
    });
  }

  if (BERSIH) {
    const ada = await db.user.count();
    if (ada > 0) {
      console.log("Sudah ada pengguna – admin tidak dibuat ulang.");
      return;
    }
    const pw = process.env.SEED_ADMIN_PASSWORD || randomBytes(9).toString("base64url");
    await db.user.create({
      data: {
        fullName: "Admin Sistem",
        username: "admin",
        passwordHash: await hashPassword(pw),
        role: "super_admin",
        mustChangePassword: true,
      },
    });
    console.log("\n  Admin dibuat → username: admin  password:", pw);
    console.log("  (wajib diganti saat pertama masuk)\n");
    return;
  }

  if ((await db.paymentRequest.count()) > 0) {
    console.log("Data demo sudah ada – seed dilewati.");
    return;
  }

  // ─── Pengguna ────────────────────────────────────────────
  const pw = await hashPassword("bintang123");
  const buat = (username: string, fullName: string, role: "super_admin" | "director" | "finance" | "project_admin" | "staff" | "viewer", extra: object = {}) =>
    db.user.upsert({
      where: { username },
      update: {},
      create: { username, fullName, role, passwordHash: pw, email: `${username}@bintang.test`, ...extra },
    });
  const admin = await buat("admin", "Admin Sistem", "super_admin");
  const hery = await buat("hery", "Hery Susanto", "director");
  const rina = await buat("rina", "Rina Keuangan", "finance", {
    bankName: "BCA",
    bankAccount: sandikan("8890123456"),
    bankHolder: "Rina Marlina",
  });
  const budi = await buat("budi", "Budi Santoso", "project_admin", {
    bankName: "BRI",
    bankAccount: sandikan("002101234567501"),
    bankHolder: "Budi Santoso",
    phone: "0812-3456-7890",
  });
  const sari = await buat("sari", "Sari Wulandari", "project_admin", {
    bankName: "Mandiri",
    bankAccount: sandikan("1370012345678"),
    bankHolder: "Sari Wulandari",
  });
  const agus = await buat("agus", "Agus Mandor", "staff", {
    bankName: "BRI",
    bankAccount: sandikan("034501009876509"),
    bankHolder: "Agus Prasetyo",
  });
  await buat("investor", "Ibu Dewi (Pendana)", "viewer", { allProjects: true });

  // ─── Perusahaan & rekening ───────────────────────────────
  const pt = await db.company.create({
    data: { name: "PT Bintang Konstruksi", city: "Semarang", address: "Jl. Pemuda No. 12, Semarang", npwp: "01.234.567.8-501.000", phone: "024-3551234" },
  });
  const cv = await db.company.create({ data: { name: "CV Sinar Abadi", city: "Kudus", address: "Jl. Sunan Kudus 7, Kudus" } });

  const bca = await db.account.create({
    data: { name: "BCA Operasional", kind: "bank", companyId: pt.id, bankName: "BCA", accountNumber: "0095551234", openingBalance: 350_000_000n },
  });
  const mandiri = await db.account.create({
    data: { name: "Mandiri Proyek", kind: "bank", companyId: pt.id, bankName: "Mandiri", accountNumber: "1360009988776", openingBalance: 120_000_000n },
  });
  const kas = await db.account.create({ data: { name: "Kas Kecil Kantor", kind: "kas", companyId: pt.id, openingBalance: 15_000_000n } });

  // ─── Proyek ──────────────────────────────────────────────
  const p1 = await db.project.create({
    data: {
      code: "PRJ-001",
      name: "Gedung Kantor Dinas PU Semarang",
      companyId: pt.id,
      client: "Dinas PU Kota Semarang",
      location: "Semarang",
      contractValue: 2_450_000_000n,
      budget: 1_850_000_000n,
      startDate: keyKeTanggal("2026-06-01"),
      endDate: keyKeTanggal("2027-02-28"),
    },
  });
  const p2 = await db.project.create({
    data: {
      code: "PRJ-002",
      name: "Jalan Lingkar Desa Karangrejo",
      companyId: pt.id,
      client: "Pemkab Kudus",
      location: "Kudus",
      contractValue: 980_000_000n,
      budget: 760_000_000n,
      startDate: keyKeTanggal("2026-08-15"),
      endDate: keyKeTanggal("2026-12-20"),
    },
  });
  const p3 = await db.project.create({
    data: {
      code: "PRJ-003",
      name: "Renovasi Puskesmas Jati",
      companyId: cv.id,
      client: "Dinkes Kab. Kudus",
      location: "Kudus",
      contractValue: 420_000_000n,
      budget: 330_000_000n,
      startDate: keyKeTanggal("2026-09-01"),
    },
  });
  const ops = await db.project.create({
    data: { code: "OPS", name: "Operasional Kantor", kind: "operasional", companyId: pt.id, budget: 240_000_000n },
  });

  const anggota: [string, string][] = [
    [p1.id, budi.id],
    [p2.id, budi.id],
    [p3.id, sari.id],
    [ops.id, sari.id],
    [p1.id, agus.id],
    [p2.id, agus.id],
  ];
  for (const [projectId, userId] of anggota) await db.projectMember.create({ data: { projectId, userId } });

  // ─── Pihak ───────────────────────────────────────────────
  const tb = await db.party.create({
    data: { name: "TB Sumber Rejeki", kind: "vendor", phone: "024-7601234", bankName: "BCA", bankAccount: sandikan("0123987654"), bankHolder: "Hartono Wijaya" },
  });
  const beton = await db.party.create({
    data: { name: "PT Beton Jaya Readymix", kind: "vendor", npwp: "02.345.678.9-512.000", bankName: "Mandiri", bankAccount: sandikan("1350004433221"), bankHolder: "PT Beton Jaya" },
  });
  await db.party.create({ data: { name: "CV Alat Berat Makmur", kind: "vendor", bankName: "BNI", bankAccount: sandikan("0412345678"), bankHolder: "CV Alat Berat Makmur" } });
  await db.party.create({ data: { name: "Dinas PU Kota Semarang", kind: "klien" } });

  const cat = Object.fromEntries((await db.category.findMany()).map((c) => [`${c.direction}:${c.name}`, c.id]));
  const k = (n: string) => cat[`keluar:${n}`];

  // ─── Kas masuk (termin) ──────────────────────────────────
  async function masuk(projectId: string, date: string, amount: bigint, description: string, accountId: string) {
    await db.$transaction(async (tx) => {
      await tx.transaction.create({
        data: {
          number: await nomorBerikutnya(tx, "TRX", date),
          projectId,
          date: keyKeTanggal(date),
          kind: "pemasukan",
          accountId,
          method: "transfer",
          amount,
          description,
          status: "terverifikasi",
          createdById: rina.id,
          verifiedById: rina.id,
          verifiedAt: new Date(),
          items: { create: [{ categoryId: cat["masuk:Termin proyek"], description, amount }] },
        },
      });
    });
  }
  await masuk(p1.id, "2026-07-10", 735_000_000n, "Termin 1 (30%) Gedung Dinas PU", bca.id);
  await masuk(p1.id, "2026-10-05", 490_000_000n, "Termin 2 (20%) Gedung Dinas PU", bca.id);
  await masuk(p2.id, "2026-09-01", 294_000_000n, "Uang muka 30% Jalan Karangrejo", mandiri.id);
  await masuk(p3.id, "2026-09-20", 84_000_000n, "Uang muka 20% Renovasi Puskesmas", mandiri.id);

  // ─── Pengajuan lewat service ─────────────────────────────
  type U = { id: string; role: "super_admin" | "director" | "finance" | "project_admin" | "staff" | "viewer"; allProjects: boolean; fullName: string };
  const a = (u: U) => ({ id: u.id, role: u.role, allProjects: u.allProjects, fullName: u.fullName });
  const item = (description: string, amount: number, kategori: string, q?: { qty: string; unit: string; harga: number }) => ({
    categoryId: k(kategori),
    description,
    amount: BigInt(amount),
    quantity: q?.qty,
    unit: q?.unit,
    unitPrice: q ? BigInt(q.harga) : undefined,
  });
  const base = { description: undefined, neededDate: undefined, payeeName: undefined, bankName: undefined, bankAccount: undefined, bankHolder: undefined, partyId: undefined, urgent: false };

  async function ajukan(u: U, input: Parameters<typeof svc.simpan>[2], kirimkan = true) {
    return db.$transaction((tx) => svc.simpan(tx, a(u), input, { ajukan: kirimkan, lampiran: [] }));
  }
  const bayarInput = (date: string, accountId: string) => ({ paidDate: date, accountId, method: "transfer" as const, reference: undefined, note: undefined });
  const hari = hariIniKey();

  // 1. Pembayaran material – sudah selesai dibayar.
  const r1 = await ajukan(budi, {
    ...base,
    projectId: p1.id,
    kind: "pembayaran",
    title: "Semen & besi tahap 2",
    partyId: tb.id,
    items: [
      item("Semen Gresik 50 kg", 33_000_000, "Material", { qty: "500", unit: "sak", harga: 66_000 }),
      item("Besi ulir D13", 25_200_000, "Material", { qty: "120", unit: "btg", harga: 210_000 }),
    ],
  });
  await db.$transaction((tx) => svc.setujui(tx, a(rina), r1.id, "Harga sesuai penawaran."));
  await db.$transaction((tx) => svc.bayar(tx, a(rina), r1.id, bayarInput("2026-10-12", bca.id), []));

  // 2. Beton readymix – besar, di atas batas keuangan → disetujui Pimpinan, siap dibayar.
  await db.setting.update({ where: { id: 1 }, data: { financeApproveCap: 100_000_000n } });
  const r2 = await ajukan(budi, {
    ...base,
    projectId: p1.id,
    kind: "pembayaran",
    title: "Readymix K-300 pengecoran lantai 3",
    urgent: true,
    neededDate: hari,
    partyId: beton.id,
    items: [item("Beton K-300", 148_500_000, "Material", { qty: "165", unit: "m3", harga: 900_000 })],
  });
  await db.$transaction((tx) => svc.setujui(tx, a(hery), r2.id, "Jadwal cor tidak boleh mundur."));

  // 3. Upah tukang – menunggu persetujuan.
  await ajukan(agus, {
    ...base,
    projectId: p2.id,
    kind: "pembayaran",
    title: "Upah tukang minggu ke-10",
    payeeName: "Agus Prasetyo (mandor)",
    bankName: "BRI",
    bankAccount: "034501009876509",
    bankHolder: "Agus Prasetyo",
    items: [
      item("Tukang batu 6 orang × 6 hari", 5_400_000, "Upah tukang", { qty: "36", unit: "OH", harga: 150_000 }),
      item("Kenek 4 orang × 6 hari", 2_880_000, "Upah tukang", { qty: "24", unit: "OH", harga: 120_000 }),
    ],
  });

  // 4. Uang muka operasional lapangan – sudah dibayar, menunggu LPJ.
  const r4 = await ajukan(budi, {
    ...base,
    projectId: p2.id,
    kind: "uang_muka",
    title: "Uang muka operasional lapangan Oktober",
    items: [item("BBM alat & kendaraan", 3_000_000, "BBM"), item("Konsumsi pekerja", 2_000_000, "Konsumsi")],
  });
  await db.$transaction((tx) => svc.setujui(tx, a(rina), r4.id));
  await db.$transaction((tx) => svc.bayar(tx, a(rina), r4.id, bayarInput("2026-10-20", mandiri.id), []));

  // 5. Uang muka yang LPJ-nya sudah diterima (ada sisa dikembalikan).
  const r5 = await ajukan(sari, {
    ...base,
    projectId: p3.id,
    kind: "uang_muka",
    title: "Belanja material kecil renovasi",
    items: [item("Material kecil (cat, paku, lem)", 4_000_000, "Material")],
  });
  await db.$transaction((tx) => svc.setujui(tx, a(rina), r5.id));
  await db.$transaction((tx) => svc.bayar(tx, a(rina), r5.id, bayarInput("2026-10-01", mandiri.id), []));
  await db.$transaction((tx) =>
    svc.ajukanLpj(tx, a(sari), r5.id, [
      { categoryId: k("Material"), description: "Cat tembok 10 pail", amount: 2_150_000n },
      { categoryId: k("Material"), description: "Paku, lem, amplas", amount: 640_000n },
      { categoryId: k("Transportasi"), description: "Ongkos angkut", amount: 300_000n },
    ], "Sisa dikembalikan tunai ke kas kecil.", []),
  );
  await db.$transaction((tx) => svc.terimaLpj(tx, a(rina), r5.id, { date: "2026-10-15", accountId: kas.id, method: "tunai" }));

  // 6. Penggantian – perlu revisi.
  const r6 = await ajukan(agus, {
    ...base,
    projectId: p1.id,
    kind: "penggantian",
    title: "Ganti ongkos sewa pikap",
    items: [item("Sewa pikap 2 hari", 700_000, "Transportasi")],
  });
  await db.$transaction((tx) => svc.mintaRevisi(tx, a(budi.role === "project_admin" ? rina : rina), r6.id, "Lampirkan foto nota sewanya ya, Pak."));

  // 7. Operasional kantor – menunggu, dari admin proyek.
  await ajukan(sari, {
    ...base,
    projectId: ops.id,
    kind: "pembayaran",
    title: "Tagihan listrik & internet kantor November",
    payeeName: "PLN & Indihome",
    items: [item("Listrik PLN", 2_350_000, "ATK & kantor"), item("Internet Indihome", 650_000, "ATK & kantor")],
  });

  // 8. Ditolak.
  const r8 = await ajukan(agus, {
    ...base,
    projectId: p2.id,
    kind: "pembayaran",
    title: "Sewa genset tambahan",
    payeeName: "CV Alat Berat Makmur",
    items: [item("Sewa genset 20 kVA 1 bulan", 9_500_000, "Sewa alat")],
  });
  await db.$transaction((tx) => svc.tolak(tx, a(rina), r8.id, "Genset proyek masih cukup – pakai yang ada dulu."));

  // 9. Draf milik Agus.
  await ajukan(
    agus,
    { ...base, projectId: p1.id, kind: "penggantian", title: "Beli air minum galon", items: [item("Air galon 10 buah", 200_000, "Konsumsi")] },
    false,
  );

  // 10. Kas keluar langsung yang menunggu verifikasi (dicatat admin proyek).
  await db.$transaction(async (tx) => {
    await tx.transaction.create({
      data: {
        number: await nomorBerikutnya(tx, "TRX", hari),
        projectId: p3.id,
        date: keyKeTanggal(hari),
        kind: "pengeluaran",
        accountId: kas.id,
        method: "tunai",
        amount: 450_000n,
        description: "Fotokopi & jilid dokumen MC",
        status: "menunggu_verifikasi",
        createdById: sari.id,
        items: { create: [{ categoryId: k("ATK & kantor"), description: "Fotokopi & jilid dokumen MC", amount: 450_000n }] },
      },
    });
  });

  console.log("Seed demo selesai. Masuk dengan: admin / hery / rina / budi / sari / agus / investor – password: bintang123");
  void admin;
}

main()
  .then(async () => {
    const { db } = await import("@/lib/db");
    await db.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    process.exit(1);
  });
