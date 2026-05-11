import { useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import type { PaymentMethod, Transaction, TxnKind, TxnType } from "@/types/api"

export interface TransactionItemInput {
  category_id?: number | null
  description: string
  amount: number
}

export interface TransactionInput {
  project_id: number
  tx_date: string
  type: TxnType
  kind?: TxnKind                          // default INVOICE_PAYMENT di backend
  amount: number
  category_id?: number | null
  vendor_client_id?: number | null
  party_name?: string | null
  payment_method: PaymentMethod
  reference_no?: string | null
  description?: string | null
  invoice_id?: number | null
  recipient_user_id?: number | null       // utk CASH_ADVANCE
  recipient_name?: string | null          // utk CASH_ADVANCE
  items?: TransactionItemInput[]          // utk DIRECT_EXPENSE
}

export function useCreateTransaction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: TransactionInput): Promise<Transaction> => {
      const { data } = await api.post<Transaction>("/transactions", payload)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.transactions.all() }),
  })
}

export function useUpdateTransaction(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: Partial<TransactionInput>): Promise<Transaction> => {
      const { data } = await api.patch<Transaction>(`/transactions/${id}`, payload)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.transactions.all() }),
  })
}

export function useSubmitTransaction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number): Promise<Transaction> => {
      const { data } = await api.post<Transaction>(`/transactions/${id}/submit`)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.transactions.all() }),
  })
}

export function useVerifyTransaction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number): Promise<Transaction> => {
      const { data } = await api.post<Transaction>(`/transactions/${id}/verify`)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.transactions.all() }),
  })
}

export function useRejectTransaction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason: string }): Promise<Transaction> => {
      const { data } = await api.post<Transaction>(`/transactions/${id}/reject`, { reason })
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.transactions.all() }),
  })
}

export function useCancelTransaction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason: string }): Promise<Transaction> => {
      const { data } = await api.post<Transaction>(`/transactions/${id}/cancel`, { reason })
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.transactions.all() }),
  })
}

export function useDeleteTransaction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number): Promise<void> => {
      await api.delete(`/transactions/${id}`)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.transactions.all() }),
  })
}

/**
 * GOD-MODE: hapus permanen (bypass status). Hanya SUPERADMIN.
 * Endpoint backend `DELETE /transactions/:id/hard` -- juga membersihkan
 * alokasi invoice yang menunjuk ke transaksi ini.
 */
export function useHardDeleteTransaction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number): Promise<void> => {
      await api.delete(`/transactions/${id}/hard`)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.transactions.all() })
      qc.invalidateQueries({ queryKey: queryKeys.invoices.all() })
    },
  })
}
