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
  funder_ids?: number[]
  funder_names?: string[]
}

interface Params {
  q?: string
  status?: string
  company_id?: number
  // Multi-value (repeated query params). Empty array = no filter.
  location?: string[]
  client_name?: string[]
  funder_id?: number[]
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

export interface ProjectFilters {
  locations: string[]
  clients: string[]
  funders: Array<{ id: number; name: string }>
}

/** Distinct values utk dropdown filter di hub proyek. */
export function useProjectFilters() {
  return useQuery({
    queryKey: ["projects-filters"],
    queryFn: async (): Promise<ProjectFilters> => {
      const { data } = await api.get<ProjectFilters>("/projects/filters")
      return data
    },
    staleTime: 5 * 60_000,
  })
}
