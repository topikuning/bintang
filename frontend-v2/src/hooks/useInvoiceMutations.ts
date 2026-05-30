import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { AxiosProgressEvent } from "axios"
import { api } from "@/lib/api"
import { invalidateFinanceQueries, queryKeys } from "@/lib/query-keys"
import type { Attachment, Invoice, InvoiceItemInput, InvoiceType } from "@/types/api"

export interface InvoiceCreateInput {
  number: string
  project_id: number
  type: InvoiceType
  invoice_date: string
  due_date?: string | null
  vendor_client_id?: number | null
  party_name?: string | null
  tax?: number
  notes?: string | null
  items: InvoiceItemInput[]
}

export interface InvoiceUpdateInput {
  number?: string
  /** Hutang/Piutang. Bila status sudah ISSUED+, butuh SUPERADMIN. */
  type?: InvoiceType
  invoice_date?: string
  due_date?: string | null
  vendor_client_id?: number | null
  party_name?: string | null
  tax?: number
  notes?: string | null
  items?: InvoiceItemInput[]
}

export function useCreateInvoice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: InvoiceCreateInput): Promise<Invoice> => {
      const { data } = await api.post<Invoice>("/invoices", payload)
      return data
    },
    onSuccess: () => invalidateFinanceQueries(qc),
  })
}

export function useUpdateInvoice(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: InvoiceUpdateInput): Promise<Invoice> => {
      const { data } = await api.patch<Invoice>(`/invoices/${id}`, payload)
      return data
    },
    onSuccess: () => invalidateFinanceQueries(qc),
  })
}

export function useIssueInvoice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number): Promise<Invoice> => {
      const { data } = await api.post<Invoice>(`/invoices/${id}/issue`)
      return data
    },
    onSuccess: () => invalidateFinanceQueries(qc),
  })
}

export function useMarkPaidInvoice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number): Promise<Invoice> => {
      const { data } = await api.post<Invoice>(`/invoices/${id}/mark-paid`)
      return data
    },
    onSuccess: () => invalidateFinanceQueries(qc),
  })
}

export function useCancelInvoice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number): Promise<Invoice> => {
      const { data } = await api.post<Invoice>(`/invoices/${id}/cancel`)
      return data
    },
    onSuccess: () => invalidateFinanceQueries(qc),
  })
}

export function useDeleteInvoice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number): Promise<void> => {
      await api.delete(`/invoices/${id}`)
    },
    onSuccess: () => invalidateFinanceQueries(qc),
  })
}

/** GOD-MODE: hard-delete invoice + items + lampiran + alokasi. SUPERADMIN only. */
export function useHardDeleteInvoice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number): Promise<void> => {
      await api.delete(`/invoices/${id}/hard`)
    },
    onSuccess: () => invalidateFinanceQueries(qc),
  })
}

// ---- Attachments ----

interface UploadVars {
  invoiceId: number
  file: File
  onProgress?: (pct: number) => void
}
export function useUploadInvoiceAttachment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ invoiceId, file, onProgress }: UploadVars): Promise<Attachment> => {
      const fd = new FormData()
      fd.append("file", file)
      const { data } = await api.post<Attachment>(
        `/invoices/${invoiceId}/attachments`,
        fd,
        {
          headers: { "Content-Type": "multipart/form-data" },
          onUploadProgress: (e: AxiosProgressEvent) => {
            if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100))
          },
        },
      )
      return data
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.invoices.detail(vars.invoiceId) })
      qc.invalidateQueries({ queryKey: queryKeys.invoices.all() })
    },
  })
}

interface LinkVars {
  invoiceId: number
  url: string
  label?: string
  fileName?: string
}
export function useLinkInvoiceAttachment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ invoiceId, url, label, fileName }: LinkVars): Promise<Attachment> => {
      const { data } = await api.post<Attachment>(
        `/invoices/${invoiceId}/attachments/link`,
        { url, label: label ?? null, file_name: fileName ?? null },
      )
      return data
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.invoices.detail(vars.invoiceId) })
    },
  })
}

interface DelAttVars {
  invoiceId: number
  attachmentId: number
}
export function useDeleteInvoiceAttachment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ invoiceId, attachmentId }: DelAttVars): Promise<void> => {
      await api.delete(`/invoices/${invoiceId}/attachments/${attachmentId}`)
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.invoices.detail(vars.invoiceId) })
    },
  })
}
