import { create } from "zustand"
import { persist } from "zustand/middleware"

interface UIPrefsState {
  density: "compact" | "comfortable"
  sidebarCollapsed: boolean
  setDensity: (d: UIPrefsState["density"]) => void
  toggleSidebar: () => void
}

export const useUIPrefs = create<UIPrefsState>()(
  persist(
    (set) => ({
      density: "comfortable",
      sidebarCollapsed: false,
      setDensity: (d) => set({ density: d }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    }),
    { name: "cacak-ui-prefs" },
  ),
)
