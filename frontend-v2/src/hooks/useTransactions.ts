import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import type { Page, Transaction, TxnStatus, TxnType } from "@/types/api"

export interface TransactionListParams {
  page?: number
  size?: number
  project_id?: number
  type?: TxnType
  status?: TxnStatus
  category_id?: number
  vendor_client_id?: number
  date_from?: string
  date_to?: string
  q?: string
}

export function useTransactions(params: TransactionListParams = {}) {
  return useQuery({
    queryKey: queryKeys.transactions.list(params),
    queryFn: async (): Promise<Page<Transaction>> => {
      const { data } = await api.get<Page<Transaction>>("/transactions", {
        params: { page: 1, size: 50, ...params },
      })
      return data
    },
    placeholderData: (prev) => prev, // smooth pagination, tidak flicker
  })
}

export function useTransaction(id: number | null | undefined) {
  return useQuery({
    queryKey: queryKeys.transactions.detail(id ?? -1),
    queryFn: async (): Promise<Transaction> => {
      const { data } = await api.get<Transaction>(`/transactions/${id}`)
      return data
    },
    enabled: id != null && id > 0,
  })
}
