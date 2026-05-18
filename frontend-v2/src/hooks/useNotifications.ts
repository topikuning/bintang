import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"

export type NotificationKind =
  | "tx_pending_verify"
  | "tx_my_draft"
  | "invoice_overdue"
  | "po_pending_approval"

export interface NotificationItem {
  kind: NotificationKind
  label: string
  count: number
  to: string
  tone: "info" | "warning" | "danger"
}

export interface NotificationSummary {
  total: number
  items: NotificationItem[]
}

/**
 * Poll notification summary tiap 60s.
 * Background refetch (window focus) supaya saat user kembali ke tab,
 * count langsung fresh.
 */
export function useNotifications() {
  return useQuery({
    queryKey: ["notifications", "summary"],
    queryFn: async (): Promise<NotificationSummary> => {
      const { data } = await api.get<NotificationSummary>("/notifications/summary")
      return data
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  })
}
