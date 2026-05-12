import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"

export interface MenuConfig {
  role: string
  menu_ids: string[]
}

const KEY = ["menu-config"] as const

/** Menu IDs yg user (sesuai role) boleh lihat. SUPERADMIN return semua. */
export function useMenuConfig() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<MenuConfig> => {
      const { data } = await api.get<MenuConfig>("/users/me/menu-config")
      return data
    },
    staleTime: 5 * 60_000,
  })
}

// ============================================================
// SUPERADMIN: Role-menu admin API
// ============================================================
export interface MenuRegistryItem {
  id: string
  label: string
  group: string
}

export interface RoleMenusResponse {
  registry: MenuRegistryItem[]
  roles: string[]
  hidden: Record<string, string[]>
}

export function useRoleMenus() {
  return useQuery({
    queryKey: ["admin", "role-menus"],
    queryFn: async (): Promise<RoleMenusResponse> => {
      const { data } = await api.get<RoleMenusResponse>("/admin/role-menus")
      return data
    },
    staleTime: 60_000,
  })
}

export interface PolicyUpdate {
  role: string
  menu_id: string
  hidden: boolean
}

export function useUpdateRoleMenus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (items: PolicyUpdate[]) => {
      const { data } = await api.patch("/admin/role-menus", { items })
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "role-menus"] })
      // Invalidate menu-config supaya nav user re-fetch policy baru.
      qc.invalidateQueries({ queryKey: KEY })
    },
  })
}
