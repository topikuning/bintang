/**
 * IMPOR DATA DARI BINTANG LAMA (FastAPI/SQLAlchemy, PostgreSQL) KE BINTANG v3.
 *
 *   DATABASE_URL=<db v3>  DATABASE_URL_LAMA=<db lama>  [SECRET_KEY_LAMA=<SECRET_KEY lama>] \
 *     pnpm impor:lama -- --kering     # uji: semua dijalankan lalu DIBATALKAN, cetak ringkasan
 *   … pnpm impor:lama                 # sungguhan, satu transaksi DB – gagal = tidak ada yang masuk
 *
 * Yang diimpor: pengguna (password lama tetap berlaku – hash bcrypt diganti
 * argon2id otomatis saat login pertama), perusahaan, proyek + anggota,
 * kategori, vendor/klien, transaksi + rincian, penyelesaian uang muka, dan
 * pengajuan dana (cash request) beserta rinciannya.
 *
 * Pemetaan yang perlu diketahui:
 * - Transaksi OUT INVOICE_PAYMENT / DIRECT_EXPENSE → pengeluaran.
 * - CASH_ADVANCE → uang_muka. Tx "top-up" penyelesaian (DIRECT_EXPENSE ber-
 *   parent_advance_tx_id) → uang_muka juga, BUKAN biaya: biayanya sudah diakui
 *   lewat rincian penyelesaian (realisasi). Kalau dipetakan ke pengeluaran,
 *   biaya terhitung dua kali.
 * - Rincian penyelesaian → realisasi_uang_muka (tanpa gerak kas).
 * - returned_to_kas > 0 → pengembalian_uang_muka (kas masuk). Versi lama TIDAK
 *   mencatat uang kembali ini sebagai transaksi, jadi saldo kas di v3 akan
 *   LEBIH BESAR sebesar jumlah itu – yang benar adalah v3.
 * - Proyek NON_PROJECT → proyek jenis "operasional" (selalu ikut agregat; saklar
 *   per-tahun versi lama tidak dibawa).
 * - Nomor rekening terenkripsi (Fernet) dibuka bila SECRET_KEY_LAMA diisi, lalu
 *   disandikan ulang dengan KUNCI_DATA. Tanpa SECRET_KEY_LAMA, kolom itu dikosongkan.
 *
 * TIDAK diimpor: invoice & PO (pembayarannya tetap masuk sebagai transaksi),
 * berkas lampiran (ada di volume layanan lama), pengaturan AI/OCR/bot.
 * Transaksi lama tidak punya rekening – di v3 tampil sebagai "tanpa rekening".
 */
import { createDecipheriv, createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Client } from "pg";

try {
  process.loadEnvFile();
} catch {
  // env dari platform
}

const KERING = process.argv.includes("--kering");

class Batal extends Error {}

/** Bintang lama: Fernet dengan kunci sha256(SECRET_KEY). */
function bukaFernet(token: string, secret: string): string | null {
  try {
    const key = createHash("sha256").update(secret, "utf8").digest();
    const signKey = key.subarray(0, 16);
    const encKey = key.subarray(16, 32);
    const raw = Buffer.from(token.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    if (raw.length < 1 + 8 + 16 + 32 || raw[0] !== 0x80) return null;
    const hmac = raw.subarray(raw.length - 32);
    const isi = raw.subarray(0, raw.length - 32);
    const hitung = createHmac("sha256", signKey).update(isi).digest();
    if (!timingSafeEqual(hmac, hitung)) return null;
    const iv = raw.subarray(9, 25);
    const ct = raw.subarray(25, raw.length - 32);
    const d = createDecipheriv("aes-128-cbc", encKey, iv);
    return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** "1500000.00" → 1500000n (setengah ke atas). */
function keBigInt(v: string | number | null | undefined, catat: () => void): bigint {
  if (v === null || v === undefined) return 0n;
  const s = String(v);
  const [bulat, pecahan = ""] = s.split(".");
  let n = BigInt(bulat);
  if (/[1-9]/.test(pecahan)) {
    catat();
    if (Number(`0.${pecahan}`) >= 0.5) n += n < 0n ? -1n : 1n;
  }
  return n;
}

const ROLE: Record<string, "super_admin" | "finance" | "project_admin" | "viewer"> = {
  SUPERADMIN: "super_admin",
  CENTRAL_ADMIN: "finance",
  PROJECT_ADMIN: "project_admin",
  EXECUTIVE: "viewer",
};
const PROJECT_STATUS: Record<string, "aktif" | "ditahan" | "selesai" | "batal"> = {
  MENUNGGU_PERSETUJUAN: "ditahan",
  AKTIF: "aktif",
  SELESAI: "selesai",
  DITAHAN: "ditahan",
  DIBATALKAN: "batal",
};
const TX_STATUS: Record<string, "menunggu_verifikasi" | "terverifikasi" | "ditolak" | "dibatalkan"> = {
  DRAFT: "menunggu_verifikasi",
  SUBMITTED: "menunggu_verifikasi",
  VERIFIED: "terverifikasi",
  REJECTED: "ditolak",
  CANCELLED: "dibatalkan",
};
const METODE: Record<string, "transfer" | "tunai" | "qris" | "giro" | "lainnya"> = {
  CASH: "tunai",
  TRANSFER: "transfer",
  QRIS: "qris",
  GIRO: "giro",
  OTHER: "lainnya",
};

// ─── Sumber data lama ────────────────────────────────────────

type Baris = Record<string, any>;
type InfoBerkas = { path: string; size: number };

interface Sumber {
  nama: string;
  /** Semua baris tabel (kosong bila tabel tidak ada di versi lama itu). */
  tabel(nama: string): Promise<Baris[]>;
  /** Daftar berkas di UPLOAD_DIR lama; null = sumber ini tidak membawa berkas. */
  berkas(): Promise<InfoBerkas[] | null>;
  unduh(path: string, tujuan: string): Promise<void>;
  tutup(): Promise<void>;
}

/** Kolom tanggal/waktu dari JSON → Date (pg mengembalikannya sudah sebagai Date). */
function hidupkanTanggal(r: Baris): Baris {
  for (const [k, v] of Object.entries(r)) {
    if (typeof v !== "string" || !/(_at|_date)$/.test(k)) continue;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) r[k] = new Date(`${v}T00:00:00Z`);
    else if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(v)) r[k] = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(v) ? v : `${v.replace(" ", "T")}Z`);
  }
  return r;
}

async function sumberPostgres(url: string): Promise<Sumber> {
  const lama = new Client({ connectionString: url.replace(/^postgres(ql)?\+[a-z0-9]+:\/\//i, "postgresql://") });
  await lama.connect();
  return {
    nama: "PostgreSQL lama (tanpa berkas)",
    async tabel(nama) {
      const ada = await lama.query(`SELECT 1 FROM information_schema.tables WHERE table_name = $1`, [nama]);
      if (!ada.rowCount) return [];
      // Nama tabel hanya dari daftar tetap di skrip ini, bukan dari luar.
      return (await lama.query(`SELECT * FROM "${nama}" ORDER BY id`)).rows;
    },
    async berkas() {
      return null;
    },
    async unduh() {
      throw new Error("Sumber PostgreSQL tidak membawa berkas – pakai SUMBER_LAMA_URL.");
    },
    async tutup() {
      await lama.end();
    },
  };
}

async function sumberApi(base: string, token: string): Promise<Sumber> {
  const akar = base.replace(/\/+$/, "") + "/api/v1/ekspor-v3";
  const h = { "X-Ekspor-Token": token };
  async function json(path: string) {
    for (let coba = 1; ; coba++) {
      try {
        const r = await fetch(akar + path, { headers: h });
        if (r.status === 404 && path === "/manifest") {
          throw new Error("API ekspor mati di server lama – isi EKSPOR_V3_TOKEN di sana lalu redeploy.");
        }
        if (r.status === 401) throw new Error("Token ekspor ditolak server lama (EKSPOR_V3_TOKEN tidak sama).");
        if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
        return await r.json();
      } catch (e) {
        if (coba >= 4 || (e instanceof Error && /ditolak|mati/.test(e.message))) throw e;
        await new Promise((ok) => setTimeout(ok, 2000 * 2 ** (coba - 1)));
      }
    }
  }
  const manifest = await json("/manifest");
  if (manifest.versi !== 1) throw new Error(`Format ekspor versi ${manifest.versi} belum didukung importer ini.`);
  console.log(`Sumber: ${base} – ${Object.values(manifest.tabel as Record<string, number>).reduce((a, b) => a + b, 0)} baris, ${manifest.berkas.jumlah} berkas (${(manifest.berkas.total_bytes / 1e6).toFixed(1)} MB).`);
  return {
    nama: base,
    async tabel(nama) {
      if (!(nama in manifest.tabel)) return [];
      const out: Baris[] = [];
      for (let offset = 0; ; ) {
        const r = await json(`/tabel/${nama}?offset=${offset}&limit=2000`);
        out.push(...(r.rows as Baris[]).map(hidupkanTanggal));
        if (!r.lanjut) break;
        offset += r.rows.length;
      }
      return out;
    },
    async berkas() {
      return (await json("/berkas")).berkas as InfoBerkas[];
    },
    async unduh(path, tujuan) {
      const enc = path.split("/").map(encodeURIComponent).join("/");
      for (let coba = 1; ; coba++) {
        try {
          const r = await fetch(`${akar}/berkas/${enc}`, { headers: h });
          if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
          await mkdir(dirname(tujuan), { recursive: true });
          const sementara = `${tujuan}.part`;
          await pipeline(Readable.fromWeb(r.body as never), createWriteStream(sementara));
          await rename(sementara, tujuan);
          return;
        } catch (e) {
          if (coba >= 4) throw new Error(`Gagal mengunduh ${path}: ${e instanceof Error ? e.message : e}`);
          await new Promise((ok) => setTimeout(ok, 2000 * 2 ** (coba - 1)));
        }
      }
    },
    async tutup() {},
  };
}

const MIME_DARI_EKS: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
  mp4: "video/mp4",
  mov: "video/quicktime",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

const JENIS_DOKUMEN: Record<string, string> = {
  SPK: "SPK",
  SURAT_PESANAN: "Surat pesanan",
  BAST: "BAST",
  KONTRAK: "Kontrak",
  FAKTUR_PAJAK: "Faktur pajak",
  INVOICE: "Invoice",
  KWITANSI: "Kwitansi",
  BERITA_ACARA: "Berita acara",
  LAINNYA: "Dokumen",
};

async function main() {
  const urlApi = process.env.SUMBER_LAMA_URL?.trim();
  const tokenApi = process.env.EKSPOR_V3_TOKEN?.trim();
  const urlLama = process.env.DATABASE_URL_LAMA?.trim();
  if (!urlApi && !urlLama) {
    throw new Error("Isi SUMBER_LAMA_URL + EKSPOR_V3_TOKEN (disarankan: data + berkas), atau DATABASE_URL_LAMA (data saja).");
  }
  if (urlApi && !tokenApi) throw new Error("SUMBER_LAMA_URL butuh EKSPOR_V3_TOKEN yang sama dengan di server lama.");
  if (!urlApi && urlLama && /^sqlite/i.test(urlLama)) throw new Error("Importer hanya mendukung Bintang lama di PostgreSQL.");
  const secretLama = process.env.SECRET_KEY_LAMA;
  const cermin = resolve(process.env.IMPOR_CERMIN || "./.data/impor-cermin");

  const { db } = await import("@/lib/db");
  const { sandikan } = await import("@/lib/kripto");
  const { simpanBuffer, hapusBerkas } = await import("@/lib/penyimpanan");
  const { bukuBaru, tambahSheet } = await import("@/lib/laporan/excel");

  const sudah = await db.transaction.count({ where: { legacyId: { not: null } } });
  if (sudah > 0 && !KERING) throw new Error(`Database v3 sudah berisi ${sudah} transaksi hasil impor. Impor hanya dijalankan sekali.`);

  const sumber = urlApi ? await sumberApi(urlApi, tokenApi!) : await sumberPostgres(urlLama!);

  let pecahan = 0;
  const uang = (v: unknown) => keBigInt(v as string, () => pecahan++);
  let rekeningTerbuka = 0;
  let rekeningGagal = 0;
  const rekening = (v: unknown): string | null => {
    if (!v) return null;
    const s = String(v);
    if (!s.startsWith("enc:v1:")) return sandikan(s);
    if (!secretLama) {
      rekeningGagal++;
      return null;
    }
    const polos = bukaFernet(s.slice(7), secretLama);
    if (polos === null) {
      rekeningGagal++;
      return null;
    }
    rekeningTerbuka++;
    return sandikan(polos);
  };

  const hidup = (rows: Baris[]) => rows.filter((r) => !r.deleted_at);
  const users = await sumber.tabel("users");
  const companies = await sumber.tabel("companies");
  const projects = await sumber.tabel("projects");
  const members = await sumber.tabel("project_users");
  const categories = await sumber.tabel("categories");
  const parties = await sumber.tabel("vendors_clients");
  const txs = hidup(await sumber.tabel("transactions"));
  const items = hidup(await sumber.tabel("transaction_items"));
  const settlements = await sumber.tabel("cash_advance_settlements");
  const settleItems = hidup(await sumber.tabel("cash_advance_settlement_items"));
  const crs = hidup(await sumber.tabel("cash_requests"));
  const crItems = await sumber.tabel("cash_request_items");
  const txAtt = hidup(await sumber.tabel("transaction_attachments"));
  const projAtt = hidup(await sumber.tabel("project_attachments"));
  const invoices = hidup(await sumber.tabel("invoices"));
  const invItems = hidup(await sumber.tabel("invoice_items"));
  const invAlloc = hidup(await sumber.tabel("invoice_allocations"));
  const invAtt = hidup(await sumber.tabel("invoice_attachments"));
  const pos = hidup(await sumber.tabel("purchase_orders"));
  const poItems = hidup(await sumber.tabel("po_items"));

  // ─── Berkas: cermin lokal dulu (bisa dilanjutkan), baru masuk transaksi DB ───
  const daftarBerkas = await sumber.berkas();
  const ukuranDi = new Map((daftarBerkas ?? []).map((b) => [b.path, b.size]));
  const relDari = (url: unknown): string | null => {
    if (typeof url !== "string" || !url) return null;
    if (url.startsWith("/files/")) return url.slice(7);
    return /^[a-z][a-z0-9+.-]*:/i.test(url) ? null : url.replace(/^\/+/, "");
  };
  let diunduh = 0;
  let sudahAda = 0;
  if (daftarBerkas) {
    console.log(`Mencerminkan ${daftarBerkas.length} berkas ke ${cermin} …`);
    for (const [i, b] of daftarBerkas.entries()) {
      const tujuan = join(cermin, b.path);
      if (!tujuan.startsWith(cermin + sep)) continue;
      const st = await stat(tujuan).catch(() => null);
      if (st && st.size === b.size) {
        sudahAda++;
        continue;
      }
      await sumber.unduh(b.path, tujuan);
      const cek = await stat(tujuan);
      if (cek.size !== b.size) throw new Error(`Ukuran ${b.path} tidak cocok (${cek.size} ≠ ${b.size}). Jalankan ulang.`);
      diunduh++;
      if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${daftarBerkas.length}`);
    }
  }
  await sumber.tutup();

  const ditulis: string[] = [];
  const tautanLuar: string[] = [];
  const hilang: string[] = [];
  /** Salin berkas lama dari cermin ke penyimpanan v3. null = tidak bisa (tautan luar / hilang). */
  async function salin(url: unknown, namaBerkas: unknown, mime: unknown, konteks: string) {
    const rel = relDari(url);
    if (rel === null) {
      if (url) tautanLuar.push(`${konteks}\t${url}`);
      return null;
    }
    if (!daftarBerkas || !ukuranDi.has(rel)) {
      hilang.push(`${konteks}\t${rel}`);
      return null;
    }
    const buf = await readFile(join(cermin, rel));
    const nama = String(namaBerkas || rel.split("/").pop() || "berkas");
    const eks = (nama.split(".").pop() || rel.split(".").pop() || "").toLowerCase();
    const tipe = typeof mime === "string" && mime ? mime : (MIME_DARI_EKS[eks] ?? "application/octet-stream");
    const b = await simpanBuffer(buf, "impor", nama, tipe);
    ditulis.push(b.storageKey);
    return b;
  }

  const ringkas: Record<string, number> = {};
  const hitung = (k: string, n = 1) => (ringkas[k] = (ringkas[k] ?? 0) + n);

  try {
    await db.$transaction(
      async (tx) => {
        const uid = new Map<number, string>();
        const cid = new Map<number, string>();
        const pid = new Map<number, string>();
        const kid = new Map<number, string>();
        const vid = new Map<number, string>();
        const tid = new Map<number, string>();

        // ─── Pengguna ───
        for (const u of users as Record<string, any>[]) {
          const username = u.username ? String(u.username).toLowerCase() : null;
          const email = u.email ? String(u.email).toLowerCase() : null;
          const bentrok = await tx.user.findFirst({
            where: { OR: [...(username ? [{ username }] : []), ...(email ? [{ email }] : [])] },
          });
          const role = ROLE[u.role] ?? "viewer";
          const data = {
            fullName: u.name,
            username: bentrok ? null : username,
            email: bentrok ? null : email,
            phone: u.phone ?? null,
            passwordHash: u.password_hash,
            role,
            isActive: u.is_active && !u.deleted_at,
            allProjects: role === "viewer" ? !!u.scope_all_projects : false,
            legacyId: u.id,
          };
          if (bentrok) {
            uid.set(u.id, bentrok.id);
            await tx.user.update({ where: { id: bentrok.id }, data: { legacyId: u.id } });
            hitung("pengguna digabung dengan akun v3 yang sudah ada");
          } else {
            const n = await tx.user.create({ data });
            uid.set(u.id, n.id);
            hitung("pengguna");
          }
        }
        const sistem = await tx.user.upsert({
          where: { username: "impor-lama" },
          update: {},
          create: { username: "impor-lama", fullName: "Impor Bintang lama", role: "viewer", passwordHash: "!", isActive: false },
        });
        const u = (id: unknown) => (id ? (uid.get(Number(id)) ?? sistem.id) : sistem.id);

        // ─── Perusahaan, proyek, anggota ───
        for (const c of companies as Record<string, any>[]) {
          const n = await tx.company.create({
            data: { name: c.name, address: c.address, npwp: c.npwp, phone: c.phone, email: c.email, isActive: !c.deleted_at, legacyId: c.id },
          });
          cid.set(c.id, n.id);
          hitung("perusahaan");
        }
        for (const p of projects as Record<string, any>[]) {
          let code = String(p.code);
          if (await tx.project.findUnique({ where: { code } })) code = `${code}-LAMA`;
          const n = await tx.project.create({
            data: {
              code,
              name: p.name,
              kind: p.kind === "NON_PROJECT" ? "operasional" : "proyek",
              companyId: cid.get(p.company_id)!,
              client: p.client_name ?? null,
              location: p.location ?? null,
              contractValue: uang(p.project_value),
              budget: uang(p.budget_amount),
              startDate: p.start_date ?? null,
              endDate: p.end_date ?? null,
              status: p.deleted_at ? "batal" : (PROJECT_STATUS[p.status] ?? "aktif"),
              notes: p.notes ?? null,
              legacyId: p.id,
            },
          });
          pid.set(p.id, n.id);
          hitung("proyek");
        }
        for (const m of members as Record<string, any>[]) {
          if (!pid.has(m.project_id) || !uid.has(m.user_id)) continue;
          await tx.projectMember.upsert({
            where: { projectId_userId: { projectId: pid.get(m.project_id)!, userId: uid.get(m.user_id)! } },
            update: {},
            create: { projectId: pid.get(m.project_id)!, userId: uid.get(m.user_id)! },
          });
          hitung("anggota proyek");
        }

        // ─── Kategori & pihak ───
        for (const k of categories as Record<string, any>[]) {
          const direction = k.type === "IN" ? "masuk" : "keluar";
          const sama = await tx.category.findFirst({ where: { direction, name: { equals: k.name, mode: "insensitive" } } });
          if (sama) {
            kid.set(k.id, sama.id);
            continue;
          }
          const n = await tx.category.create({
            data: { name: k.name, direction, description: k.description ?? null, isActive: !k.deleted_at, legacyId: k.id },
          });
          kid.set(k.id, n.id);
          hitung("kategori");
        }
        for (const v of parties as Record<string, any>[]) {
          const n = await tx.party.create({
            data: {
              name: v.name,
              kind: v.type === "CLIENT" ? "klien" : "vendor",
              phone: v.phone ?? v.contact ?? null,
              email: v.email ?? null,
              address: v.address ?? null,
              npwp: v.npwp ?? null,
              bankAccount: rekening(v.bank_account),
              isActive: !v.deleted_at,
              legacyId: v.id,
            },
          });
          vid.set(v.id, n.id);
          hitung("vendor/klien");
        }

        // ─── Transaksi ───
        const itemsPer = new Map<number, Record<string, any>[]>();
        for (const it of items as Record<string, any>[]) {
          const l = itemsPer.get(it.transaction_id) ?? [];
          l.push(it);
          itemsPer.set(it.transaction_id, l);
        }
        for (const t of txs as Record<string, any>[]) {
          if (!pid.has(t.project_id)) {
            hitung("transaksi dilewati (proyek tidak ada)");
            continue;
          }
          const amount = uang(t.amount);
          if (amount <= 0n) {
            hitung("transaksi dilewati (jumlah ≤ 0)");
            continue;
          }
          const kind =
            t.type === "IN"
              ? "pemasukan"
              : t.kind === "CASH_ADVANCE" || t.parent_advance_tx_id
                ? "uang_muka"
                : "pengeluaran";
          // Uang muka belum biaya – kategorinya diakui lewat realisasi.
          const kategori = (id: unknown) => (kind === "uang_muka" ? null : (kid.get(Number(id)) ?? null));
          let rincian = (itemsPer.get(t.id) ?? []).map((it, i) => ({
            position: i,
            categoryId: kategori(it.category_id),
            description: it.description || t.description || "–",
            amount: uang(it.amount),
          }));
          rincian = rincian.filter((r) => r.amount > 0n);
          const sum = rincian.reduce((a, r) => a + r.amount, 0n);
          if (!rincian.length || sum !== amount) {
            if (rincian.length && sum !== amount) hitung("rincian disesuaikan ke jumlah transaksi");
            rincian = [{ position: 0, categoryId: kategori(t.category_id), description: t.description || "–", amount }];
          }
          const n = await tx.transaction.create({
            data: {
              number: `LAMA/TRX/${t.id}`,
              projectId: pid.get(t.project_id)!,
              date: t.tx_date,
              kind,
              accountId: null,
              method: METODE[t.payment_method] ?? "transfer",
              amount,
              description: (t.description || t.usage_note || "Transaksi impor").slice(0, 300),
              partyId: t.vendor_client_id ? (vid.get(t.vendor_client_id) ?? null) : null,
              partyName: t.party_name ?? t.recipient_name ?? null,
              reference: t.reference_no ?? null,
              status: TX_STATUS[t.status] ?? "menunggu_verifikasi",
              statusNote: t.cancel_reason ?? null,
              createdById: u(t.created_by_id),
              verifiedById: t.verified_by_id ? u(t.verified_by_id) : null,
              verifiedAt: t.verified_at ?? null,
              legacyId: t.id,
              createdAt: t.created_at,
              items: { create: rincian },
            },
          });
          tid.set(t.id, n.id);
          hitung(`transaksi ${kind}`);
        }

        // ─── Penyelesaian uang muka ───
        const sItems = new Map<number, Record<string, any>[]>();
        for (const it of settleItems as Record<string, any>[]) {
          const l = sItems.get(it.settlement_id) ?? [];
          l.push(it);
          sItems.set(it.settlement_id, l);
        }
        const realisasiPer = new Map<number, { categoryId: string | null; description: string; amount: bigint }[]>();
        for (const s of settlements as Record<string, any>[]) {
          const adv = (txs as Record<string, any>[]).find((t) => t.id === s.cash_advance_tx_id);
          if (!adv || !tid.has(adv.id)) continue;
          const tanggal = s.settled_at ?? adv.tx_date;
          const rows = (sItems.get(s.id) ?? []).map((it, i) => ({
            position: i,
            categoryId: kid.get(it.category_id) ?? null,
            description: it.description || "–",
            amount: uang(it.amount),
          })).filter((r) => r.amount > 0n);
          realisasiPer.set(adv.id, rows);
          const total = rows.reduce((a, r) => a + r.amount, 0n);
          const dasar = {
            projectId: pid.get(adv.project_id)!,
            date: tanggal,
            status: "terverifikasi" as const,
            createdById: u(s.settled_by_id),
            verifiedById: u(s.settled_by_id),
            verifiedAt: s.settled_at ?? null,
            partyName: adv.recipient_name ?? adv.party_name ?? null,
          };
          if (total > 0n) {
            await tx.transaction.create({
              data: {
                ...dasar,
                number: `LAMA/REAL/${s.id}`,
                kind: "realisasi_uang_muka",
                method: "lainnya",
                amount: total,
                description: `Realisasi uang muka ${adv.description ?? `#${adv.id}`}`.slice(0, 300),
                items: { create: rows },
              },
            });
            hitung("realisasi uang muka");
          }
          const kembali = uang(s.returned_to_kas);
          if (kembali > 0n) {
            await tx.transaction.create({
              data: {
                ...dasar,
                number: `LAMA/KEMBALI/${s.id}`,
                kind: "pengembalian_uang_muka",
                method: "tunai",
                amount: kembali,
                description: `Pengembalian sisa uang muka ${adv.description ?? `#${adv.id}`}`.slice(0, 300),
                items: { create: [{ position: 0, description: "Sisa uang muka", amount: kembali }] },
              },
            });
            hitung("pengembalian uang muka (baru tercatat sebagai kas masuk)");
          }
        }

        // ─── Pengajuan dana (cash request) → pengajuan uang muka ───
        const reqUntukAdv = new Map<number, string>();
        const crItemsPer = new Map<number, Record<string, any>[]>();
        for (const it of crItems as Record<string, any>[]) {
          const l = crItemsPer.get(it.request_id) ?? [];
          l.push(it);
          crItemsPer.set(it.request_id, l);
        }
        for (const c of crs as Record<string, any>[]) {
          if (!pid.has(c.project_id)) continue;
          const adv = c.disbursement_tx_id ? (txs as Record<string, any>[]).find((t) => t.id === c.disbursement_tx_id) : undefined;
          const advVerified = adv && adv.status === "VERIFIED";
          const punyaLpj = adv ? realisasiPer.has(adv.id) : false;
          const status =
            c.status === "PENDING"
              ? "diajukan"
              : c.status === "APPROVED"
                ? advVerified
                  ? punyaLpj
                    ? "selesai"
                    : "dibayar"
                  : "disetujui"
                : c.status === "REJECTED"
                  ? "ditolak"
                  : "dibatalkan";
          const pemohon = u(c.requester_id);
          const penerima = (users as Record<string, any>[]).find((x) => x.id === (c.recipient_user_id ?? c.requester_id));
          const rows = (crItemsPer.get(c.id) ?? []).map((it, i) => ({
            position: i,
            categoryId: kid.get(it.category_id) ?? null,
            description: it.description || "–",
            quantity: it.quantity !== null && it.unit_price !== null && it.quantity !== undefined ? String(it.quantity) : null,
            unitPrice: it.unit_price !== null && it.unit_price !== undefined && it.quantity !== null ? uang(it.unit_price) : null,
            amount: uang(it.amount),
          })).filter((r) => r.amount > 0n);
          const total = rows.reduce((a, r) => a + r.amount, 0n);
          let number: string | null = c.number ?? `LAMA/CR/${c.id}`;
          if (number && (await tx.paymentRequest.findUnique({ where: { number } }))) number = `${number}-LAMA`;
          const p = await tx.paymentRequest.create({
            data: {
              number,
              projectId: pid.get(c.project_id)!,
              kind: "uang_muka",
              title: String(c.title).slice(0, 200),
              description: c.notes ?? null,
              total,
              status,
              payeeName: penerima?.name ?? null,
              requesterId: pemohon,
              submittedAt: c.created_at,
              approverId: c.approved_by_id ? u(c.approved_by_id) : null,
              approvedAt: c.approved_at ?? null,
              payerId: advVerified ? u(adv!.verified_by_id) : null,
              paidAt: advVerified ? (adv!.verified_at ?? null) : null,
              paidDate: advVerified ? adv!.tx_date : null,
              paymentMethod: advVerified ? (METODE[adv!.payment_method] ?? "transfer") : null,
              closedAt: ["selesai", "ditolak", "dibatalkan"].includes(status) ? (c.rejected_at ?? c.updated_at) : null,
              legacyId: c.id,
              createdAt: c.created_at,
              items: { create: rows },
              realizations: adv && punyaLpj ? { create: realisasiPer.get(adv.id)!.map((r, i) => ({ ...r, position: i })) } : undefined,
            },
          });
          const ev = [
            { toStatus: "draft" as const, action: "dibuat (impor)", actorId: pemohon, createdAt: c.created_at },
            { toStatus: "diajukan" as const, action: "diajukan", actorId: pemohon, createdAt: c.created_at },
            ...(c.approved_at ? [{ toStatus: "disetujui" as const, action: "disetujui", actorId: u(c.approved_by_id), createdAt: c.approved_at }] : []),
            ...(c.status === "REJECTED"
              ? [{ toStatus: "ditolak" as const, action: "ditolak", actorId: u(c.rejected_by_id), createdAt: c.rejected_at ?? c.updated_at, note: c.rejection_reason }]
              : []),
            ...(c.status === "CANCELLED" || c.status === "DISBURSEMENT_CANCELLED"
              ? [{ toStatus: "dibatalkan" as const, action: "dibatalkan", actorId: pemohon, createdAt: c.updated_at, note: c.rejection_reason }]
              : []),
            ...(advVerified ? [{ toStatus: "dibayar" as const, action: "dibayar", actorId: u(adv!.verified_by_id), createdAt: adv!.verified_at ?? c.updated_at }] : []),
            ...(punyaLpj ? [{ toStatus: "selesai" as const, action: "LPJ diterima (impor)", actorId: sistem.id, createdAt: c.updated_at }] : []),
          ];
          await tx.paymentRequestEvent.createMany({
            data: ev.map((e) => ({ requestId: p.id, toStatus: e.toStatus, action: e.action, actorId: e.actorId, createdAt: e.createdAt, note: "note" in e ? (e.note ?? null) : null })),
          });
          if (adv) reqUntukAdv.set(adv.id, p.id);
          if (adv && tid.has(adv.id)) {
            const topup = (settlements as Record<string, any>[])
              .filter((s) => s.cash_advance_tx_id === adv.id && s.topup_tx_id && tid.has(s.topup_tx_id))
              .map((s) => tid.get(s.topup_tx_id)!);
            await tx.transaction.updateMany({ where: { id: { in: [tid.get(adv.id)!, ...topup] } }, data: { requestId: p.id } });
            await tx.transaction.updateMany({
              where: { number: { in: (settlements as Record<string, any>[]).filter((s) => s.cash_advance_tx_id === adv.id).flatMap((s) => [`LAMA/REAL/${s.id}`, `LAMA/KEMBALI/${s.id}`]) } },
              data: { requestId: p.id },
            });
          }
          hitung(`pengajuan ${status}`);
        }

        // ─── Lampiran (hanya bila sumbernya membawa berkas) ───
        if (daftarBerkas) {
          for (const a of txAtt) {
            if (!tid.has(a.transaction_id)) continue;
            const b = await salin(a.url, a.file_name, a.mime_type, `transaksi lama #${a.transaction_id}`);
            if (!b) continue;
            await tx.attachment.create({ data: { ...b, kind: "nota", transactionId: tid.get(a.transaction_id)!, uploadedById: u(a.uploaded_by_id) } });
            hitung("lampiran transaksi");
          }
          for (const a of projAtt) {
            if (!pid.has(a.project_id)) continue;
            const b = await salin(a.url, a.file_name, a.mime_type, `dokumen proyek lama #${a.project_id}`);
            if (!b) continue;
            const label = a.label || JENIS_DOKUMEN[a.doc_type] || "Dokumen";
            await tx.attachment.create({
              data: { ...b, kind: "lainnya", label: String(label).slice(0, 200), projectId: pid.get(a.project_id)!, uploadedById: u(a.uploaded_by_id) },
            });
            hitung("dokumen proyek");
          }
          const invMap = new Map(invoices.map((i) => [i.id, i]));
          for (const a of invAtt) {
            const inv = invMap.get(a.invoice_id);
            if (!inv || !pid.has(inv.project_id)) continue;
            const b = await salin(a.url, a.file_name, a.mime_type, `invoice lama ${inv.number}`);
            if (!b) continue;
            const label = `Invoice ${inv.number}${inv.party_name ? ` – ${inv.party_name}` : ""}`;
            await tx.attachment.create({
              data: { ...b, kind: "lainnya", label: label.slice(0, 200), projectId: pid.get(inv.project_id)!, uploadedById: u(a.uploaded_by_id) },
            });
            hitung("berkas invoice → dokumen proyek");
          }
          const settleMap = new Map(settlements.map((st) => [st.id, st]));
          for (const it of settleItems) {
            if (!it.receipt_url) continue;
            const st = settleMap.get(it.settlement_id);
            if (!st) continue;
            const b = await salin(it.receipt_url, null, null, `nota penyelesaian #${st.id}`);
            if (!b) continue;
            const reqId = reqUntukAdv.get(st.cash_advance_tx_id);
            const real = reqId ? null : await tx.transaction.findUnique({ where: { number: `LAMA/REAL/${st.id}` }, select: { id: true } });
            const pemilik = reqId ? { requestId: reqId } : real ? { transactionId: real.id } : null;
            if (!pemilik) continue;
            await tx.attachment.create({ data: { ...b, kind: "lpj", ...pemilik, uploadedById: u(st.settled_by_id) } });
            hitung("nota LPJ uang muka");
          }
        }

        // ─── Arsip invoice & PO per proyek (v3 belum punya modulnya) ───
        // Supaya tidak ada yang hilang: setiap proyek yang punya invoice/PO
        // mendapat satu berkas Excel di Dokumen proyek.
        const txNomor = new Map<number, string>(txs.map((t) => [t.id, `LAMA/TRX/${t.id}`]));
        const projDenganArsip = new Set<number>([...invoices.map((i) => i.project_id), ...pos.map((p) => p.project_id)]);
        for (const lp of projDenganArsip) {
          if (!pid.has(lp)) continue;
          const proj = projects.find((p) => p.id === lp);
          const invP = invoices.filter((i) => i.project_id === lp);
          const invIds = new Set(invP.map((i) => i.id));
          const nomorInv = new Map(invP.map((i) => [i.id, i.number]));
          const poP = pos.filter((p) => p.project_id === lp);
          const poIds = new Set(poP.map((p) => p.id));
          const nomorPo = new Map(poP.map((p) => [p.id, p.number]));
          const wb = bukuBaru();
          const sub = `Proyek ${proj?.code ?? lp} – diarsipkan dari Bintang lama`;
          tambahSheet(wb, "Invoice", "Invoice (hutang & piutang)", sub, [
            { header: "Nomor", key: "number", width: 20 },
            { header: "Jenis", key: "jenis", width: 10 },
            { header: "Tanggal", key: "invoice_date", tanggal: true, width: 12 },
            { header: "Jatuh tempo", key: "due_date", tanggal: true, width: 12 },
            { header: "Pihak", key: "party_name", width: 28 },
            { header: "Subtotal", key: "subtotal", uang: true },
            { header: "Pajak", key: "tax", uang: true },
            { header: "Total", key: "total", uang: true },
            { header: "Status", key: "status", width: 16 },
            { header: "Catatan", key: "notes", width: 40 },
          ], invP.map((i) => ({ ...i, jenis: i.type === "IN" ? "Masuk (hutang)" : "Keluar (piutang)", subtotal: uang(i.subtotal), tax: uang(i.tax), total: uang(i.total) })));
          tambahSheet(wb, "Rincian invoice", "Rincian invoice", sub, [
            { header: "Invoice", key: "inv", width: 20 },
            { header: "Uraian", key: "description", width: 40 },
            { header: "Qty", key: "quantity", width: 10 },
            { header: "Satuan", key: "unit", width: 10 },
            { header: "Harga satuan", key: "unit_price", uang: true },
            { header: "Subtotal", key: "subtotal", uang: true },
          ], invItems.filter((x) => invIds.has(x.invoice_id)).map((x) => ({ ...x, inv: nomorInv.get(x.invoice_id), quantity: String(x.quantity ?? ""), unit_price: uang(x.unit_price), subtotal: uang(x.subtotal) })));
          tambahSheet(wb, "Pembayaran invoice", "Alokasi pembayaran invoice", sub, [
            { header: "Invoice", key: "inv", width: 20 },
            { header: "Transaksi di v3", key: "trx", width: 20 },
            { header: "Jumlah", key: "allocated_amount", uang: true },
            { header: "Catatan", key: "note", width: 40 },
          ], invAlloc.filter((x) => invIds.has(x.invoice_id)).map((x) => ({ ...x, inv: nomorInv.get(x.invoice_id), trx: txNomor.get(x.transaction_id) ?? "", allocated_amount: uang(x.allocated_amount) })));
          tambahSheet(wb, "PO", "Purchase order", sub, [
            { header: "Nomor", key: "number", width: 20 },
            { header: "Tanggal", key: "po_date", tanggal: true, width: 12 },
            { header: "Vendor", key: "vendor_name", width: 28 },
            { header: "Total", key: "total", uang: true },
            { header: "Status", key: "status", width: 16 },
            { header: "Syarat bayar", key: "payment_terms", width: 24 },
            { header: "Catatan", key: "notes", width: 40 },
          ], poP.map((x) => ({ ...x, total: uang(x.total) })));
          tambahSheet(wb, "Rincian PO", "Rincian PO", sub, [
            { header: "PO", key: "po", width: 20 },
            { header: "Uraian", key: "description", width: 40 },
            { header: "Qty", key: "quantity", width: 10 },
            { header: "Satuan", key: "unit", width: 10 },
            { header: "Harga satuan", key: "unit_price", uang: true },
            { header: "Subtotal", key: "subtotal", uang: true },
          ], poItems.filter((x) => poIds.has(x.po_id)).map((x) => ({ ...x, po: nomorPo.get(x.po_id), quantity: String(x.quantity ?? ""), unit_price: uang(x.unit_price), subtotal: uang(x.subtotal) })));
          const buf = Buffer.from(await wb.xlsx.writeBuffer());
          const nama = `arsip-invoice-po-${String(proj?.code ?? lp).toLowerCase()}.xlsx`;
          const b = await simpanBuffer(buf, "impor", nama, MIME_DARI_EKS.xlsx);
          ditulis.push(b.storageKey);
          await tx.attachment.create({
            data: { ...b, kind: "lainnya", label: `Arsip invoice & PO dari Bintang lama (${invP.length} invoice, ${poP.length} PO)`, projectId: pid.get(lp)!, uploadedById: sistem.id },
          });
          hitung("arsip invoice & PO (Excel per proyek)");
        }

        const topupMenunggu = (settlements as Record<string, any>[]).filter((s) => {
          const t = s.topup_tx_id ? (txs as Record<string, any>[]).find((x) => x.id === s.topup_tx_id) : undefined;
          return t && t.status !== "VERIFIED";
        }).length;
        if (topupMenunggu) hitung("top-up penyelesaian belum diverifikasi (uang muka berjalan negatif sampai diverifikasi)", topupMenunggu);

        await tx.auditLog.create({
          data: { userId: null, action: "import.legacy", resourceType: "system", payload: { ...ringkas, kering: KERING } },
        });
        if (KERING) throw new Batal();
      },
      { timeout: 15 * 60_000, maxWait: 60_000 },
    );
  } catch (e) {
    // Transaksi DB batal → berkas yang terlanjur ditulis ke penyimpanan v3
    // dibuang supaya tidak jadi yatim. Cermin lokal tetap ada untuk diulang.
    await Promise.all(ditulis.map((k) => hapusBerkas(k).catch(() => undefined)));
    if (!(e instanceof Batal)) throw e;
  }

  if (tautanLuar.length || hilang.length) {
    await mkdir(cermin, { recursive: true });
    await writeFile(join(cermin, "laporan-tautan-luar.tsv"), tautanLuar.join("\n"));
    await writeFile(join(cermin, "laporan-berkas-hilang.tsv"), hilang.join("\n"));
  }

  console.log(`\n${KERING ? "UJI KERING – tidak ada yang disimpan" : "IMPOR SELESAI"}\n`);
  for (const [k, v] of Object.entries(ringkas).sort()) console.log(`  ${String(v).padStart(6)}  ${k}`);
  if (pecahan) console.log(`\n  ${pecahan} nilai bersen dibulatkan ke rupiah terdekat.`);
  if (rekeningTerbuka) console.log(`  ${rekeningTerbuka} nomor rekening terenkripsi berhasil dibuka & disandikan ulang.`);
  if (rekeningGagal) console.log(`  ${rekeningGagal} nomor rekening terenkripsi TIDAK bisa dibuka (isi SECRET_KEY_LAMA) – dikosongkan.`);
  if (daftarBerkas) {
    console.log(`\n  Berkas: ${diunduh} diunduh, ${sudahAda} sudah ada di cermin (${cermin}).`);
    console.log(`  Semua isi UPLOAD_DIR lama ikut dicerminkan – termasuk yang tidak ditautkan ke data mana pun.`);
    if (tautanLuar.length) console.log(`  ${tautanLuar.length} lampiran berupa tautan luar (tidak bisa diunduh) – lihat laporan-tautan-luar.tsv.`);
    if (hilang.length) console.log(`  ${hilang.length} lampiran tercatat di DB tapi berkasnya tidak ada di server lama – lihat laporan-berkas-hilang.tsv.`);
  } else {
    console.log("\n  Sumber PostgreSQL langsung: berkas lampiran TIDAK ikut. Pakai SUMBER_LAMA_URL untuk membawa berkas.");
  }
  console.log("  Pengaturan AI/OCR/bot tidak dipindah.\n");
  await db.$disconnect();
}

main().catch((e) => {
  console.error("\nIMPOR GAGAL – tidak ada data yang tersimpan.\n", e instanceof Error ? e.message : e);
  process.exit(1);
});
