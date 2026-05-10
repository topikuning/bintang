import { useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import type { VendorClient } from "@/hooks/useVendors"
import type { VendorClientInput } from "@/types/api"

export function useCreateVendor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: VendorClientInput): Promise<VendorClient> => {
      const { data } = await api.post<VendorClient>("/vendors-clients", payload)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.vendors.all() }),
  })
}

export function useUpdateVendor(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: Partial<VendorClientInput>): Promise<VendorClient> => {
      const { data } = await api.patch<VendorClient>(`/vendors-clients/${id}`, payload)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.vendors.all() }),
  })
}

export function useDeleteVendor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number): Promise<void> => {
      await api.delete(`/vendors-clients/${id}`)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.vendors.all() }),
  })
}
