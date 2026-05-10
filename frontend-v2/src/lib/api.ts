import axios, { AxiosError } from "axios"
import { useAuthStore } from "@/store/auth"

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "/api/v1",
  timeout: 30_000,
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

/** Parse pesan error dari response axios -> string yg user-friendly. */
export function apiErrorMessage(err: unknown): string {
  if (err instanceof AxiosError) {
    const data = err.response?.data
    if (typeof data === "string") return data
    if (data && typeof data === "object") {
      if ("detail" in data && typeof data.detail === "string") return data.detail
      if ("message" in data && typeof data.message === "string") return data.message
    }
    return err.message || "Terjadi kesalahan jaringan"
  }
  if (err instanceof Error) return err.message
  return "Terjadi kesalahan tidak diketahui"
}
