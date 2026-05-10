import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import type { Page } from "@/types/api"

export interface VendorClient {
  id: number
  name: string
  npwp: string | null
  party_kind: "VENDOR" | "CLIENT" | "BOTH"
  phone?: string | null
  email?: string | null
}

export function useVendors(params: { party_kind?: VendorClient["party_kind"] } = {}) {
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
