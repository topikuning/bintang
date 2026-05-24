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
  /** Spent NON-MARKETING (audit 2026-05-23). Marketing aktual punya
   *  reservasi terpisah formula -- exclude dr budget bar. */
  spent: number
  /** Total OUT (incl marketing) -- info, tdk dipakai utk bar. */
  spent_total?: number
  /** Marketing aktual yg sudah di-exclude dr 'spent'. */
  marketing_actual?: number
  remaining: number
  usage_pct: number
  status: BudgetStatus
}

/** Rincian keuangan kontrak proyek (DPP, PPn, PPh, profit). */
export interface ProjectFinance {
  nilai_kontrak: number
  ppn_pct: number
  pph_pct: number
  marketing_pct: number
  dpp: number
  ppn: number
  pph: number
  nilai_cair: number
  /** Backward-compat alias = marketing_budget (formula). */
  marketing: number
  biaya_aktual: number
  biaya_proyeksi: number
  profit_now: number
  /** Audit 2026-05-23: profit setelah bagi hasil dibayar. */
  profit_net?: number
  /** Bagi hasil yg sudah ditransaksikan (info, tdk kurangi profit_now). */
  profit_share_paid?: number
  profit_proj: number
  // Audit 2026-05-23: marketing dipecah utk cegah double-count.
  marketing_budget: number
  marketing_aktual: number
  /** marketing_aktual - marketing_budget. Positif = overspend. */
  marketing_variance: number
  /** biaya_aktual - marketing_aktual. */
  biaya_aktual_non_marketing: number
  /** Audit 2026-05-23: breakdown komposisi biaya aktual per peran
   *  akuntansi (marketing / penalty / profit_share / operating). */
  expense_breakdown?: {
    marketing: number
    penalty: number
    profit_share: number
    operating: number
    total: number
  }
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

export interface DashboardPurchaseOrder {
  id: number
  number: string
  po_date: string | null
  needed_date: string | null
  vendor_name: string | null
  total: number
  status: string
}

export interface CategoryBreakdownItem {
  category: string
  total: number
}

export interface ProjectSpendingItem {
  project_id: number
  name: string
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
  finance?: ProjectFinance
  health: HealthStatus | { status: HealthStatus; label?: string }
  expense_to_income_ratio_pct: number | null
  invoice_open_total: number
  invoice_paid_total: number
  /** Aging hutang ke vendor (Invoice IN open) */
  ap_aging?: AgingBreakdown
  /** Aging piutang dari klien (Invoice OUT open) */
  ar_aging?: AgingBreakdown
  pending_count: number
  pending_total: number
  unlinked_out_count: number
  unlinked_out_total: number
  by_category: CategoryBreakdownItem[]
  monthly_cashflow: MonthlyCashflowPoint[]
  recent_transactions: DashboardRecentTransaction[]
  invoices: DashboardInvoice[]
  purchase_orders?: DashboardPurchaseOrder[]
  warnings: string[]
}

export interface GlobalDashboardProjectSummary {
  id: number
  code: string
  name: string
  company: string | null
  status: string
  currency: string
  total_in: number
  total_out: number
  balance: number
  pending_in: number
  pending_out: number
  budget: ProjectBudget
  health: HealthStatus
}

export interface GlobalDashboardResponse {
  totals: {
    in: number
    out: number
    balance: number
    pending_in: number
    pending_out: number
  }
  active_projects: number
  total_projects: number
  minus_projects: number
  pending_count: number
  pending_total: number
  unlinked_out_count: number
  unlinked_out_total: number
  overdue_invoices: number
  biggest_project: { id: number; name: string; total: number } | null
  top_spender: ProjectSpendingItem | null
  spending_by_project: ProjectSpendingItem[]
  spending_by_category: CategoryBreakdownItem[]
  monthly_cashflow: MonthlyCashflowPoint[]
  projects: GlobalDashboardProjectSummary[]
  warnings: string[]
}

/** Aging bucket utk AR/AP -- 0-30 / 31-60 / 61-90 / >90 hari. */
export interface AgingBreakdown {
  b0_30: number
  b31_60: number
  b61_90: number
  b90_plus: number
  total: number
  count: number
}
