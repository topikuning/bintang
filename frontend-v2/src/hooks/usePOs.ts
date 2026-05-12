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

export interface POAllocationRef {
  allocation_id: number
  invoice_id: number
  invoice_number: string | null
  invoice_status: string
  allocated_amount: number
}

export interface POLinkedTx {
  id: number
  tx_date: string | null
  amount: number
  type: "IN" | "OUT"
  kind: string | null
  status: string
  description: string | null
  party_name: string | null
  allocations: POAllocationRef[]
}

export interface POLinkedTxResponse {
  po_id: number
  po_number: string
  po_total: number
  transactions: POLinkedTx[]
  transactions_count: number
  invoices_count: number
  total_paid: number
}

/** Get tx + invoice (via allocation) yg ter-link ke PO. Untuk audit
 *  procurement chain: PO -> TX -> Invoice. */
export function usePOLinkedTransactions(id: number | null | undefined) {
  return useQuery({
    queryKey: ["po-linked-tx", id ?? -1],
    queryFn: async (): Promise<POLinkedTxResponse> => {
      const { data } = await api.get<POLinkedTxResponse>(
        `/purchase-orders/${id}/linked-transactions`,
      )
      return data
    },
    enabled: id != null && id > 0,
    staleTime: 30_000,
  })
}
