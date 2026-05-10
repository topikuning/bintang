import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import type { Page, VendorClientType } from "@/types/api"

export interface VendorClient {
  id: number
  name: string
  type: VendorClientType
  address: string | null
  npwp: string | null
  contact: string | null
  phone: string | null
  email: string | null
  bank_account: string | null
}

export function useVendors(params: { type?: VendorClientType; q?: string } = {}) {
  return useQuery({
    queryKey: queryKeys.vendors.list(params),
    queryFn: async (): Promise<Page<VendorClient>> => {
      const { data } = await api.get<Page<VendorClient>>("/vendors-clients", {
        params: { page: 1, size: 500, ...params },
      })
      return data
    },
    staleTime: 5 * 60_000,
  })
}
