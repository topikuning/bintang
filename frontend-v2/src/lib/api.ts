import axios, { AxiosError } from "axios"
import { useAuthStore } from "@/store/auth"

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "/api/v1",
  timeout: 30_000,
  // Serialize array params dgn key di-repeat (?x=a&x=b) -- format yg
  // FastAPI parse via `list[T] = Query(None)`. Default axios pakai
  // bracket notation (?x[]=a) yg tdk dikenal FastAPI.
  paramsSerializer: {
    serialize: (params: Record<string, unknown>) => {
      const parts: string[] = []
      for (const [key, val] of Object.entries(params)) {
        if (val === undefined || val === null) continue
        if (Array.isArray(val)) {
          for (const v of val) {
            if (v === undefined || v === null || v === "") continue
            parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`)
          }
        } else {
          parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(val))}`)
        }
      }
      return parts.join("&")
    },
  },
})

api.interceptors.request.use((cfg) => {
  const token = useAuthStore.getState().token
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})

api.interceptors.response.use(
  (r) => r,
  (err: AxiosError) => {
    if (err.response?.status === 401) {
      useAuthStore.getState().logout()
      // Hindari redirect-loop kalau sudah di /login
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
        const next = window.location.pathname + window.location.search
        window.location.href = `/login?next=${encodeURIComponent(next)}`
      }
    }
    return Promise.reject(err)
  },
)

/** Bangun URL absolut utk file (lampiran/logo) yg disajikan backend di /files/. */
function backendOrigin(): string {
  const base = import.meta.env.VITE_API_BASE_URL || "/api/v1"
  return base.replace(/\/api\/v\d+\/?$/, "")
}

export function fileUrl(path?: string | null): string | undefined {
  if (!path) return undefined
  if (/^https?:/.test(path)) return path
  const clean = path.startsWith("/") ? path : `/${path}`
  const finalPath = clean.startsWith("/files/") ? clean : `/files${clean}`
  return `${backendOrigin()}${finalPath}`
}

/**
 * Map kode error backend -> pesan user-friendly Indonesia.
 *
 * Backend pakai code-style (mis. "verified_locked", "project_change_forbidden")
 * supaya stable & i18n-able. Mapping di sini convert ke kalimat manusia.
 * Kalau code tdk dikenal, fallback ke `detail` apa adanya (backend
 * sering punya pesan eksplikatif setelah colon: "code: penjelasan").
 */
const ERROR_MESSAGES: Record<string, string> = {
  // Auth & permission
  not_authenticated: "Silakan login dulu.",
  invalid_token: "Sesi tdk valid. Login ulang.",
  token_revoked: "Sesi sudah berakhir (logout dari device lain). Login ulang.",
  rate_limited: "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.",
  user_inactive: "Akun tidak aktif.",
  superadmin_only: "Hanya SUPERADMIN yang bisa lakukan ini.",
  admin_only: "Hanya admin (CENTRAL_ADMIN/SUPERADMIN) yang bisa.",
  read_only_role: "Role Anda hanya boleh lihat, tidak bisa ubah data.",
  no_access_to_project: "Anda tidak punya akses ke proyek ini.",
  // Workflow tx/invoice
  verified_locked:
    "Transaksi/Invoice sudah diverifikasi. Hanya SUPERADMIN yang bisa edit.",
  invalid_state: "Status saat ini tidak mendukung aksi ini.",
  project_change_forbidden:
    "Proyek tidak bisa diubah via edit. Cancel item ini, lalu buat ulang di proyek yang benar.",
  cash_advance_already_settled:
    "Dana operasional sudah di-settle. Hapus settlement dulu jika mau koreksi.",
  kind_change_blocked:
    "Tx sudah ter-alokasi ke invoice. Hapus alokasi/unlink dulu sebelum ganti jenis.",
  invoice_not_allocatable: "Invoice di status ini tidak bisa di-alokasi.",
  transaction_not_allocatable:
    "Transaksi hanya bisa di-alokasi setelah status VERIFIED. Submit & verify tx dulu.",
  non_project_superadmin_only:
    "Hanya SUPERADMIN yang dapat mengakses bucket Catatan Non-Proyek.",
  invoice_number_already_used:
    "Nomor invoice sudah dipakai. Pakai nomor yang berbeda.",
  cannot_request_against_non_project:
    "Tidak bisa mengajukan dana ke bucket Catatan Non-Proyek.",
  // Common
  not_found: "Data tidak ditemukan.",
  recipient_user_not_found: "Penerima dana tidak ditemukan.",
  project_code_already_used: "Kode proyek sudah dipakai proyek lain.",
}

/** Cek kalau detail string punya format "code:penjelasan" — return code. */
function extractCode(detail: string): string {
  const colon = detail.indexOf(":")
  if (colon === -1) return detail.trim()
  return detail.slice(0, colon).trim()
}

/** Parse pesan error dari response axios -> string yg user-friendly. */
export function apiErrorMessage(err: unknown): string {
  if (err instanceof AxiosError) {
    const data = err.response?.data
    if (typeof data === "string") return data
    if (data && typeof data === "object") {
      if ("detail" in data && typeof data.detail === "string") {
        const detail = data.detail
        const code = extractCode(detail)
        // Kalau code dikenal di registry, gunakan friendly version.
        if (ERROR_MESSAGES[code]) return ERROR_MESSAGES[code]
        // Kalau detail punya format "code:penjelasan", trim code prefix
        // supaya user lihat penjelasan saja (lebih readable).
        if (detail.includes(":")) {
          return detail.slice(detail.indexOf(":") + 1).trim() || detail
        }
        return detail
      }
      if ("message" in data && typeof data.message === "string") return data.message
    }
    return err.message || "Terjadi kesalahan jaringan."
  }
  if (err instanceof Error) return err.message
  return "Terjadi kesalahan tidak diketahui."
}
