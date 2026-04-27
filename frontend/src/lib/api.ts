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

export function fileUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (/^https?:/.test(path)) return path;
  // Vite dev proxies /files to backend
  return path.startsWith("/files/") ? path : `/files/${path.replace(/^\//, "")}`;
}
