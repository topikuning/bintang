import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"

export interface MessagingConfig {
  telegram_enabled: boolean
  whatsapp_enabled: boolean
  telegram_configured: boolean
  whatsapp_configured: boolean
  whatsapp_base_url: string | null
  whatsapp_session: string | null
}

export interface MessagingConfigPatch {
  telegram_enabled?: boolean
  whatsapp_enabled?: boolean
}

const KEY = ["messaging", "config"] as const

export function useMessagingConfig() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<MessagingConfig> => {
      const { data } = await api.get<MessagingConfig>("/messaging/config")
      return data
    },
  })
}

export function useUpdateMessagingConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: MessagingConfigPatch): Promise<MessagingConfig> => {
      const { data } = await api.patch<MessagingConfig>("/messaging/config", payload)
      return data
    },
    onSuccess: (data) => qc.setQueryData(KEY, data),
  })
}

export interface WhatsAppTestResult {
  configured: boolean
  toggle_enabled: boolean
  waha_reachable: boolean
  session_status: string | null
  session_name: string | null
  waha_url: string | null
  engine: string | null
}

export function useWhatsAppTest() {
  return useMutation({
    mutationFn: async (): Promise<WhatsAppTestResult> => {
      const { data } = await api.post<WhatsAppTestResult>("/whatsapp/test")
      return data
    },
  })
}
