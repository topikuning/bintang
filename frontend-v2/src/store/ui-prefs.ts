import { create } from "zustand"
import { persist } from "zustand/middleware"

interface UIPrefsState {
  defaultProjectId: number | null
  density: "compact" | "comfortable"
  sidebarCollapsed: boolean
  setDefaultProject: (id: number | null) => void
  setDensity: (d: UIPrefsState["density"]) => void
  toggleSidebar: () => void
}

export const useUIPrefs = create<UIPrefsState>()(
  persist(
    (set) => ({
      defaultProjectId: null,
      density: "comfortable",
      sidebarCollapsed: false,
      setDefaultProject: (id) => set({ defaultProjectId: id }),
      setDensity: (d) => set({ density: d }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    }),
    { name: "bintang-ui-prefs" },
  ),
)
