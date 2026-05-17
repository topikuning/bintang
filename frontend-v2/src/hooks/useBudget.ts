import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"

export type BudgetStatus =
  | "aman"
  | "mendekati_batas"
  | "overbudget"
  | "no_budget"

export interface BudgetRow {
  project_id: number
  project_code: string
  project_name: string
  company_name: string | null
  budget_amount: number | string
  spent: number | string
  remaining: number | string
  usage_pct: number | string
  status: BudgetStatus
}

export interface BudgetCategoryRow {
  project_id: number
  category_id: number | null
  category_name: string
  spent: number | string
  pct_of_project_spent: number | string
}

export interface BudgetTotals {
  budget: number | string
  spent: number | string
  remaining: number | string
  usage_pct: number | string
  n_aman: number
  n_mendekati: number
  n_overbudget: number
  n_no_budget: number
}

export interface BudgetSummaryResponse {
  rows: BudgetRow[]
  totals: BudgetTotals
  by_category: BudgetCategoryRow[]
}

export interface BudgetSummaryParams {
  project_id?: number[]
  date_from?: string
  date_to?: string
  include_no_budget?: boolean
}

export function useBudgetSummary(params: BudgetSummaryParams = {}) {
  return useQuery({
    queryKey: ["budget", "summary", params],
    queryFn: async (): Promise<BudgetSummaryResponse> => {
      const { data } = await api.get<BudgetSummaryResponse>(
        "/budget/summary",
        { params },
      )
      return data
    },
    placeholderData: (prev) => prev,
  })
}
