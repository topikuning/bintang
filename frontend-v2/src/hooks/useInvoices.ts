import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import type { Invoice, InvoiceStatus, InvoiceType, Page } from "@/types/api"

export interface InvoiceListParams {
  page?: number
  size?: number
  project_id?: number
  type?: InvoiceType
  status?: InvoiceStatus
  vendor_client_id?: number
  date_from?: string
  date_to?: string
  q?: string
}

export function useInvoices(params: InvoiceListParams = {}) {
  return useQuery({
    queryKey: queryKeys.invoices.list(params),
    queryFn: async (): Promise<Page<Invoice>> => {
      const { data } = await api.get<Page<Invoice>>("/invoices", {
        params: { page: 1, size: 50, ...params },
      })
      return data
    },
    placeholderData: (prev) => prev,
  })
}

export function useInvoice(id: number | null | undefined) {
  return useQuery({
    queryKey: queryKeys.invoices.detail(id ?? -1),
    queryFn: async (): Promise<Invoice> => {
      const { data } = await api.get<Invoice>(`/invoices/${id}`)
      return data
    },
    enabled: id != null && id > 0,
  })
}
