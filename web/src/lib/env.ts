import { z } from "zod";

/**
 * Validasi environment saat start. Import modul ini = validasi jalan.
 * Gagal di sini lebih murah daripada gagal di tengah transaksi uang.
 */
const schema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL wajib diisi"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET minimal 32 karakter"),
  APP_NAME: z.string().default("Bintang"),
  UPLOAD_DIR: z.string().default("./.data/berkas"),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(50).default(10),
  /** Kunci penyandian nomor rekening. Kosong = disimpan polos. */
  KUNCI_DATA: z.string().optional(),
  PENANDA_LINGKUNGAN: z.string().optional(),
  /**
   * Cookie sesi `Secure`? "auto" (bawaan) = ya bila permintaan datang lewat
   * HTTPS (Cloudflare Tunnel / reverse proxy), tidak bila lewat http:// di
   * jaringan kantor. Tanpa ini, server Lenovo yang dibuka lewat IP LAN tidak
   * bisa dipakai login sama sekali – peramban membuang cookie Secure di http.
   */
  COOKIE_AMAN: z.enum(["auto", "1", "0"]).default("auto"),
});

function normalizeDatabaseUrl(raw: string): string {
  return raw
    .replace(/^postgres(ql)?\+[a-z0-9]+:\/\//i, "postgresql://")
    .replace(/^postgres:\/\//i, "postgresql://");
}

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(`Konfigurasi environment tidak valid:\n${issues}`);
}

if (parsed.data.APP_ENV === "production" && parsed.data.SESSION_SECRET.startsWith("dev-only")) {
  throw new Error("SESSION_SECRET masih nilai pengembangan – ganti sebelum produksi.");
}

export const env = {
  ...parsed.data,
  DATABASE_URL: normalizeDatabaseUrl(parsed.data.DATABASE_URL),
  KUNCI_DATA: parsed.data.KUNCI_DATA?.trim() || undefined,
  PENANDA_LINGKUNGAN: parsed.data.PENANDA_LINGKUNGAN?.trim() || undefined,
};
