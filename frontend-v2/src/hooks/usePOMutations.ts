import { useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import type { POItemInput, PurchaseOrder } from "@/types/api"

export interface POCreateInput {
  project_id: number
  company_id: number
  vendor_client_id?: number | null
  vendor_name?: string | null
  po_date: string
  needed_date?: string | null
  tax?: number
  discount?: number
  payment_terms?: string | null
  notes?: string | null
  items: POItemInput[]
}

export interface POUpdateInput {
  vendor_client_id?: number | null
  vendor_name?: string | null
  po_date?: string
  needed_date?: string | null
  tax?: number
  discount?: number
  payment_terms?: string | null
  notes?: string | null
  items?: POItemInput[]
}

export function useCreatePO() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: POCreateInput): Promise<PurchaseOrder> => {
      const { data } = await api.post<PurchaseOrder>("/purchase-orders", payload)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.pos.all() }),
  })
}

export function useUpdatePO(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: POUpdateInput): Promise<PurchaseOrder> => {
      const { data } = await api.patch<PurchaseOrder>(`/purchase-orders/${id}`, payload)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.pos.all() }),
  })
}

export function useIssuePO() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number): Promise<PurchaseOrder> => {
      const { data } = await api.post<PurchaseOrder>(`/purchase-orders/${id}/issue`)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.pos.all() }),
  })
}

export function useApprovePO() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number): Promise<PurchaseOrder> => {
      const { data } = await api.post<PurchaseOrder>(`/purchase-orders/${id}/approve`)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.pos.all() }),
  })
}

export function useCancelPO() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason: string }): Promise<PurchaseOrder> => {
      const { data } = await api.post<PurchaseOrder>(`/purchase-orders/${id}/cancel`, { reason })
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.pos.all() }),
  })
}

export function useDeletePO() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number): Promise<void> => {
      await api.delete(`/purchase-orders/${id}`)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.pos.all() }),
  })
}

/** GOD-MODE: SUPERADMIN only. */
export function useHardDeletePO() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number): Promise<void> => {
      await api.delete(`/purchase-orders/${id}/hard`)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.pos.all() }),
  })
}
