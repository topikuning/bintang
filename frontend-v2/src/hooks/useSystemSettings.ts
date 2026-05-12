import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"

export interface SystemSettingItem {
  key: string
  group: "ocr" | "telegram" | "whatsapp" | "system"
  label: string
  hint?: string | null
  is_secret: boolean
  has_value: boolean
  from_env: boolean
  /** Non-secret: nilai effective (DB > env). Secret: tidak ada (pakai preview). */
  value?: string
  /** Secret: '••••XXXX' (masked) atau null. */
  preview?: string | null
}

export interface SystemSettingsResponse {
  items: SystemSettingItem[]
  grouped: Record<string, SystemSettingItem[]>
}

const KEY = ["admin", "settings"] as const

export function useSystemSettings() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<SystemSettingsResponse> => {
      const { data } = await api.get<SystemSettingsResponse>("/admin/settings")
      return data
    },
    staleTime: 30_000,
  })
}

export interface SettingUpdate {
  key: string
  value: string | null
}

export function useUpdateSystemSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (items: SettingUpdate[]) => {
      const { data } = await api.patch("/admin/settings", { items })
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY })
      // Force refresh related caches (OCR engines list dll)
      qc.invalidateQueries({ queryKey: ["ocr", "engines"] })
    },
  })
}

export function useDeleteSystemSetting() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (key: string) => {
      await api.delete(`/admin/settings/${key}`)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY })
      qc.invalidateQueries({ queryKey: ["ocr", "engines"] })
    },
  })
}
