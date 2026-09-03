import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import type { User } from "@/types/api"

const AUTH_STORAGE_KEY = "bintang-auth"

// Token lama pernah disimpan persisten di localStorage. Hapus sekali saat
// aplikasi baru dimuat agar kredensial tidak tertinggal lintas sesi browser.
if (typeof window !== "undefined") {
  window.localStorage.removeItem(AUTH_STORAGE_KEY)
}

interface AuthState {
  token: string | null
  user: User | null
  setSession: (token: string, user: User) => void
  setUser: (user: User) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setSession: (token, user) => set({ token, user }),
      setUser: (user) => set({ user }),
      logout: () => set({ token: null, user: null }),
    }),
    {
      name: AUTH_STORAGE_KEY,
      storage: createJSONStorage(() => window.sessionStorage),
      partialize: (s) => ({ token: s.token, user: s.user }),
    },
  ),
)
