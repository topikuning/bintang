/**
 * TanStack Query keys terpusat. Pakai factory supaya autocompletion
 * konsisten dan invalidation pattern bisa hierarchical.
 *
 * Pattern: [domain, action, ...args]
 *   queryKeys.transactions.list({ project_id: 1, status: "VERIFIED" })
 *   queryKeys.transactions.detail(123)
 *   invalidate(["transactions"]) -> invalidate semua transaksi-related
 */

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
} as const
