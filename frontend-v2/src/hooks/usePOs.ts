import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import type { Page, POStatus, PurchaseOrder } from "@/types/api"

export interface POListParams {
  page?: number
  size?: number
  project_id?: number
  company_id?: number
  vendor_client_id?: number
  status?: POStatus
  date_from?: string
  date_to?: string
  q?: string
}

export function usePOs(params: POListParams = {}) {
  return useQuery({
    queryKey: queryKeys.pos.list(params),
    queryFn: async (): Promise<Page<PurchaseOrder>> => {
      const { data } = await api.get<Page<PurchaseOrder>>("/purchase-orders", {
        params: { page: 1, size: 50, ...params },
      })
      return data
    },
    placeholderData: (prev) => prev,
  })
}

export function usePO(id: number | null | undefined) {
  return useQuery({
    queryKey: queryKeys.pos.detail(id ?? -1),
    queryFn: async (): Promise<PurchaseOrder> => {
      const { data } = await api.get<PurchaseOrder>(`/purchase-orders/${id}`)
      return data
    },
    enabled: id != null && id > 0,
  })
}
