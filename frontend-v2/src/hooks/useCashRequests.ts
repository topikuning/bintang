import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import type {
  CashRequest,
  CashRequestCreateInput,
  CashRequestStatus,
  CashRequestUpdateInput,
  Page,
} from "@/types/api"

export interface CashRequestListParams {
  page?: number
  size?: number
  status?: CashRequestStatus
  project_id?: number
  requester_id?: number
  date_from?: string
  date_to?: string
  q?: string
}

export function useCashRequests(params: CashRequestListParams = {}) {
  return useQuery({
    queryKey: queryKeys.cashRequests.list(params),
    queryFn: async (): Promise<Page<CashRequest>> => {
      const { data } = await api.get<Page<CashRequest>>("/cash-requests", {
        params: { page: 1, size: 50, ...params },
      })
      return data
    },
    placeholderData: (prev) => prev,
  })
}

export function useCashRequest(id: number | null | undefined) {
  return useQuery({
    queryKey: queryKeys.cashRequests.detail(id ?? -1),
    queryFn: async (): Promise<CashRequest> => {
      const { data } = await api.get<CashRequest>(`/cash-requests/${id}`)
      return data
    },
    enabled: id != null && id > 0,
  })
}

export function useCreateCashRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: CashRequestCreateInput): Promise<CashRequest> => {
      const { data } = await api.post<CashRequest>("/cash-requests", payload)
      return data
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.cashRequests.all() }),
  })
}

export function useUpdateCashRequest(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (
      payload: CashRequestUpdateInput,
    ): Promise<CashRequest> => {
      const { data } = await api.patch<CashRequest>(
        `/cash-requests/${id}`,
        payload,
      )
      return data
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.cashRequests.all() }),
  })
}

export function useDeleteCashRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number): Promise<void> => {
      await api.delete(`/cash-requests/${id}`)
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.cashRequests.all() }),
  })
}

export function useApproveCashRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number): Promise<CashRequest> => {
      const { data } = await api.post<CashRequest>(
        `/cash-requests/${id}/approve`,
      )
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.cashRequests.all() })
      // Approve bikin tx CASH_ADVANCE DRAFT -> invalidate tx list juga.
      qc.invalidateQueries({ queryKey: queryKeys.transactions.all() })
    },
  })
}

export function useRejectCashRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      reason,
    }: {
      id: number
      reason: string
    }): Promise<CashRequest> => {
      const { data } = await api.post<CashRequest>(
        `/cash-requests/${id}/reject`,
        { reason },
      )
      return data
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.cashRequests.all() }),
  })
}

export function useCancelCashRequest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      reason,
    }: {
      id: number
      reason?: string
    }): Promise<CashRequest> => {
      const { data } = await api.post<CashRequest>(
        `/cash-requests/${id}/cancel`,
        { reason: reason ?? null },
      )
      return data
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.cashRequests.all() }),
  })
}
