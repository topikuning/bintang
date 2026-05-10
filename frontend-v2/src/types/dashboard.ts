/**
 * Dashboard response shapes (mirror backend GET /dashboard/global &
 * GET /dashboard/project/:pid). Field names persis dr backend.
 */
import type { InvoiceStatus, InvoiceType, TxnStatus, TxnType } from "./api"

export type BudgetStatus = "no_budget" | "budget_aman" | "mendekati_batas" | "overbudget"
export type HealthStatus = "sehat" | "perhatian" | "minus"

export interface ProjectTotals {
  in: number
  out: number
  balance: number
  pending_in: number
  pending_out: number
}

export interface ProjectBudget {
  amount: number
  spent: number
  remaining: number
  usage_pct: number
  status: BudgetStatus
}

export interface MonthlyCashflowPoint {
  /** ISO YYYY-MM */
  month: string
  in: number
  out: number
}

export interface DashboardRecentTransaction {
  id: number
  date: string
  type: TxnType
  amount: number
  party: string | null
  description: string | null
  status: TxnStatus
}

export interface DashboardInvoice {
  id: number
  number: string
  type: InvoiceType
  invoice_date: string
  due_date: string | null
  party_name: string | null
  total: number
  paid_amount: number
  outstanding_amount: number
  status: InvoiceStatus
}

export interface CategoryBreakdownItem {
  category: string
  total: number
}

export interface ProjectDashboardResponse {
  project: {
    id: number
    code: string
    name: string
    status: string
    company_id: number
    currency: string
  }
  totals: ProjectTotals
  budget: ProjectBudget
  health: { status: HealthStatus; label?: string }
  expense_to_income_ratio_pct: number | null
  invoice_open_total: number
  invoice_paid_total: number
  pending_count: number
  pending_total: number
  unlinked_out_count: number
  unlinked_out_total: number
  by_category: CategoryBreakdownItem[]
  monthly_cashflow: MonthlyCashflowPoint[]
  recent_transactions: DashboardRecentTransaction[]
  invoices: DashboardInvoice[]
  warnings: string[]
}

export interface GlobalDashboardProjectSummary {
  id: number
  code: string
  name: string
  total_in: number
  total_out: number
  balance: number
  budget_amount: number
  budget_usage_pct: number
  budget_status: BudgetStatus
  status: string
}

export interface GlobalDashboardResponse {
  totals: { in: number; out: number; balance: number }
  active_projects: number
  minus_projects: number
  biggest_project: GlobalDashboardProjectSummary | null
  monthly_cashflow: MonthlyCashflowPoint[]
  projects: GlobalDashboardProjectSummary[]
  warnings: string[]
}
