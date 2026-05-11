import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"

/** Mirror response GET /projects/stats (lihat backend/app/api/v1/projects.py). */
export interface ProjectStats {
  id: number
  code: string
  name: string
  location: string | null
  status: string
  currency: string
  company_id: number | null
  company: string | null
  project_value: number
  budget_amount: number
  total_in: number
  total_out: number
  balance: number
  invoice_open: number
  budget: {
    amount: number
    spent: number
    remaining: number
    usage_pct: number
    status: string
  }
  health: string
}

interface Params {
  q?: string
  status?: string
  company_id?: number
}

export function useProjectsStats(params: Params = {}) {
  return useQuery({
    queryKey: ["projects-stats", params],
    queryFn: async (): Promise<ProjectStats[]> => {
      const { data } = await api.get<ProjectStats[]>("/projects/stats", { params })
      return data
    },
    staleTime: 60_000,
  })
}
