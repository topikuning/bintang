import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import type {
  CashAdvanceBalanceRow,
  CashAdvanceOutstandingRow,
  CashAdvanceSettlement,
} from "@/types/api"

const KEYS = {
  outstanding: ["cash-advances", "outstanding"] as const,
  balances: ["cash-advances", "balances"] as const,
  settlement: (id: number) => ["cash-advances", "settlement", id] as const,
}

/** List uang muka outstanding (belum di-settle). */
export function useCashAdvanceOutstanding() {
  return useQuery({
    queryKey: KEYS.outstanding,
    queryFn: async (): Promise<CashAdvanceOutstandingRow[]> => {
      const { data } = await api.get<CashAdvanceOutstandingRow[]>(
        "/transactions/cash-advances/outstanding",
      )
      return data
    },
    staleTime: 30_000,
  })
}

/** Saldo uang muka per penerima (group). */
export function useCashAdvanceBalances() {
  return useQuery({
    queryKey: KEYS.balances,
    queryFn: async (): Promise<CashAdvanceBalanceRow[]> => {
      const { data } = await api.get<CashAdvanceBalanceRow[]>(
        "/transactions/cash-advances/balances",
      )
      return data
    },
    staleTime: 30_000,
  })
}

/** Detail settlement utk 1 advance tx. */
export function useCashAdvanceSettlement(txId: number | null | undefined) {
  return useQuery({
    queryKey: txId ? KEYS.settlement(txId) : ["cash-advances", "settlement", "none"],
    enabled: !!txId,
    queryFn: async (): Promise<CashAdvanceSettlement> => {
      const { data } = await api.get<CashAdvanceSettlement>(
        `/transactions/${txId}/settlement`,
      )
      return data
    },
    staleTime: 30_000,
  })
}

export interface SettlementItemInput {
  category_id?: number | null
  description: string
  amount: number
  receipt_url?: string | null
}

export interface SettlementInput {
  settled_at?: string | null
  returned_to_kas: number
  notes?: string | null
  items: SettlementItemInput[]
}

/** POST settle: bikin pertanggungjawaban utk advance tx. */
export function useSettleCashAdvance() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      txId,
      payload,
    }: {
      txId: number
      payload: SettlementInput
    }): Promise<CashAdvanceSettlement> => {
      const { data } = await api.post<CashAdvanceSettlement>(
        `/transactions/${txId}/settle`,
        payload,
      )
      return data
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: KEYS.outstanding })
      qc.invalidateQueries({ queryKey: KEYS.balances })
      qc.invalidateQueries({ queryKey: KEYS.settlement(vars.txId) })
      qc.invalidateQueries({ queryKey: queryKeys.transactions.all() })
    },
  })
}

/** DELETE settle: hapus pertanggungjawaban (koreksi). */
export function useDeleteCashAdvanceSettlement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (txId: number): Promise<void> => {
      await api.delete(`/transactions/${txId}/settle`)
    },
    onSuccess: (_, txId) => {
      qc.invalidateQueries({ queryKey: KEYS.outstanding })
      qc.invalidateQueries({ queryKey: KEYS.balances })
      qc.invalidateQueries({ queryKey: KEYS.settlement(txId) })
      qc.invalidateQueries({ queryKey: queryKeys.transactions.all() })
    },
  })
}
