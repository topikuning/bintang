/**
 * TanStack Query keys terpusat. Pakai factory supaya autocompletion
 * konsisten dan invalidation pattern bisa hierarchical.
 *
 * Pattern: [domain, action, ...args]
 *   queryKeys.transactions.list({ project_id: 1, status: "VERIFIED" })
 *   queryKeys.transactions.detail(123)
 *   invalidate(["transactions"]) -> invalidate semua transaksi-related
 */

import type { QueryClient } from "@tanstack/react-query"

export const queryKeys = {
  auth: {
    me: () => ["auth", "me"] as const,
  },
  projects: {
    all: () => ["projects"] as const,
    list: (params?: object) => ["projects", "list", params ?? {}] as const,
    detail: (id: number | string) => ["projects", "detail", id] as const,
    stats: (id: number | string) => ["projects", "stats", id] as const,
  },
  categories: {
    all: () => ["categories"] as const,
    list: (params?: object) => ["categories", "list", params ?? {}] as const,
  },
  vendors: {
    all: () => ["vendors"] as const,
    list: (params?: object) => ["vendors", "list", params ?? {}] as const,
  },
  transactions: {
    all: () => ["transactions"] as const,
    list: (params?: object) => ["transactions", "list", params ?? {}] as const,
    detail: (id: number | string) => ["transactions", "detail", id] as const,
  },
  invoices: {
    all: () => ["invoices"] as const,
    list: (params?: object) => ["invoices", "list", params ?? {}] as const,
    detail: (id: number | string) => ["invoices", "detail", id] as const,
  },
  pos: {
    all: () => ["pos"] as const,
    list: (params?: object) => ["pos", "list", params ?? {}] as const,
    detail: (id: number | string) => ["pos", "detail", id] as const,
  },
  nonProject: {
    all: () => ["non-project"] as const,
    companies: () => ["non-project", "companies"] as const,
    years: (params?: object) => ["non-project", "years", params ?? {}] as const,
  },
  cashRequests: {
    all: () => ["cash-requests"] as const,
    list: (params?: object) => ["cash-requests", "list", params ?? {}] as const,
    detail: (id: number | string) => ["cash-requests", "detail", id] as const,
  },
  dashboard: {
    all: () => ["dashboard"] as const,
    global: (params?: object) => ["dashboard", "global", params ?? {}] as const,
    project: (id: number | string, params?: object) =>
      ["dashboard", "project", id, params ?? {}] as const,
  },
  projectsStats: {
    all: () => ["projects-stats"] as const,
  },
  budget: {
    all: () => ["budget"] as const,
  },
} as const

/**
 * Invalidate semua query yg bisa kena imbas perubahan transaksi/invoice/PO:
 * - List & detail dr entity itu sendiri
 * - Dashboard (global + per-project) -- MASUK/KELUAR/SALDO/AR/AP
 * - Hub Proyek (projects-stats) -- ringkasan per proyek
 * - Budget vs Actual
 *
 * Dipakai di onSuccess mutation TX/Invoice/PO/Allocation supaya card
 * dashboard langsung update tanpa user perlu refresh manual.
 */
export function invalidateFinanceQueries(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: queryKeys.transactions.all() })
  qc.invalidateQueries({ queryKey: queryKeys.invoices.all() })
  qc.invalidateQueries({ queryKey: queryKeys.pos.all() })
  qc.invalidateQueries({ queryKey: queryKeys.dashboard.all() })
  qc.invalidateQueries({ queryKey: queryKeys.projectsStats.all() })
  qc.invalidateQueries({ queryKey: queryKeys.budget.all() })
}
