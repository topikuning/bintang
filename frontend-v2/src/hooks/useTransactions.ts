import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import type { Page, Transaction, TxnStatus, TxnType } from "@/types/api"

export interface TransactionListParams {
  page?: number
  size?: number
  /** Multi-select: backend terima ?project_id=1&project_id=2 via
   * paramsSerializer custom di lib/api. */
  project_id?: number[]
  type?: TxnType
  status?: TxnStatus
  category_id?: number
  vendor_client_id?: number
  date_from?: string
  date_to?: string
  q?: string
  /** true -> hanya tx di bucket NON_PROJECT (Catatan Non-Proyek).
   *  undefined/false -> tx reguler saja (NON_PROJECT di-exclude). */
  non_project?: boolean
  /** Audit 2026-05-24: tx OUT yg masih punya sisa belum dialokasi ke
   *  invoice. Drill-down dari dashboard counter "N pengeluaran masih
   *  punya sisa belum dialokasi". */
  unlinked_only?: boolean
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
