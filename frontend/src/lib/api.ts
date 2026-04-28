import axios from "axios";
import { useAuthStore } from "@/store/auth";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "/api/v1",
  timeout: 30000,
});

api.interceptors.request.use((cfg) => {
  const token = useAuthStore.getState().token;
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401) {
      useAuthStore.getState().logout();
    }
    return Promise.reject(err);
  },
);

function backendOrigin(): string {
  // VITE_API_BASE_URL bisa berupa:
  //   "/api/v1"                                  (dev / docker-compose)
  //   "https://backend.up.railway.app/api/v1"    (prod / Railway)
  // Origin = bagian sebelum /api/v1.
  const base = import.meta.env.VITE_API_BASE_URL || "/api/v1";
  return base.replace(/\/api\/v\d+\/?$/, "");
}

export function fileUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (/^https?:/.test(path)) return path;
  const clean = path.startsWith("/") ? path : `/${path}`;
  const finalPath = clean.startsWith("/files/") ? clean : `/files${clean}`;
  return `${backendOrigin()}${finalPath}`;
}
