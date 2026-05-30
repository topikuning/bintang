import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { invalidateFinanceQueries } from "@/lib/query-keys"
import type {
  AllocatableInvoiceRow,
  AllocatableTransactionRow,
  AllocationApplyResult,
} from "@/types/api"

/** Daftar transaksi yg masih punya remaining utk dialokasikan ke invoice. */
export function useAllocatableTransactions(
  invoiceId: number | null | undefined,
  opts: { includeZero?: boolean; enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: ["allocations", "for-invoice", invoiceId, opts],
    queryFn: async (): Promise<AllocatableTransactionRow[]> => {
      const { data } = await api.get<AllocatableTransactionRow[]>(
        `/invoices/${invoiceId}/allocatable-transactions`,
        { params: { include_zero: opts.includeZero ?? false } },
      )
      return data
    },
    enabled: invoiceId != null && invoiceId > 0 && (opts.enabled ?? true),
    staleTime: 30_000,
  })
}

/** Daftar invoice yg masih outstanding utk dialokasikan dr satu transaksi. */
export function useAllocatableInvoices(
  transactionId: number | null | undefined,
  opts: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: ["allocations", "for-transaction", transactionId],
    queryFn: async (): Promise<AllocatableInvoiceRow[]> => {
      const { data } = await api.get<AllocatableInvoiceRow[]>(
        `/transactions/${transactionId}/allocatable-invoices`,
      )
      return data
    },
    enabled: transactionId != null && transactionId > 0 && (opts.enabled ?? true),
    staleTime: 30_000,
  })
}

interface ApplyVars {
  invoiceId: number
  items: Array<{ transaction_id: number; requested_amount: number }>
  note?: string
}

/** Apply alokasi ke invoice (auto-cap saat melampaui remaining). */
export function useApplyInvoiceAllocations() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ invoiceId, items, note }: ApplyVars): Promise<AllocationApplyResult> => {
      const { data } = await api.post<AllocationApplyResult>(
        `/invoices/${invoiceId}/allocations`,
        { items, note: note ?? null },
      )
      return data
    },
    onSuccess: (_, vars) => {
      invalidateFinanceQueries(qc)
      qc.invalidateQueries({ queryKey: ["allocations", "for-invoice", vars.invoiceId] })
    },
  })
}

interface DelAllocVars {
  allocationId: number
  /** Untuk invalidate cache yg tepat. */
  invoiceId?: number
  transactionId?: number
}

export function useDeleteAllocation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ allocationId }: DelAllocVars): Promise<void> => {
      await api.delete(`/allocations/${allocationId}`)
    },
    onSuccess: () => {
      // Alokasi mempengaruhi multiple resource (TX, Invoice, dashboard,
      // budget, projects-stats) -- finance helper handle semuanya.
      invalidateFinanceQueries(qc)
      qc.invalidateQueries({ queryKey: ["allocations"] })
    },
  })
}

interface PatchAllocVars {
  allocationId: number
  allocated_amount: number
}

export function usePatchAllocation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ allocationId, allocated_amount }: PatchAllocVars) => {
      const { data } = await api.patch(`/allocations/${allocationId}`, {
        allocated_amount,
      })
      return data
    },
    onSuccess: () => {
      invalidateFinanceQueries(qc)
      qc.invalidateQueries({ queryKey: ["allocations"] })
    },
  })
}
