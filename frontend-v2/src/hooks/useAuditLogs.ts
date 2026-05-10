import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import type { AuditLogEntry, Page } from "@/types/api"

export interface AuditLogParams {
  page?: number
  size?: number
  entity?: string
  entity_id?: number
  user_id?: number
  date_from?: string
  date_to?: string
}

export function useAuditLogs(params: AuditLogParams = {}) {
  return useQuery({
    queryKey: ["audit-logs", params],
    queryFn: async (): Promise<Page<AuditLogEntry>> => {
      const { data } = await api.get<Page<AuditLogEntry>>("/audit-logs", {
        params: { page: 1, size: 100, ...params },
      })
      return data
    },
    placeholderData: (prev) => prev,
  })
}
