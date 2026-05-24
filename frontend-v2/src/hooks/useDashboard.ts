import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import type {
  GlobalDashboardResponse,
  ProjectDashboardResponse,
} from "@/types/dashboard"

export interface GlobalDashboardParams {
  q?: string
  company_id?: number
  // Multi-value (repeat query param). Empty list = no filter.
  location?: string[]
  client_name?: string[]
  funder_id?: number[]
  // Audit 2026-05-24: include proyek SELESAI/DIBATALKAN di warning
  // counters. Default false (operational view).
  include_closed?: boolean
}

export function useGlobalDashboard(params?: GlobalDashboardParams) {
  return useQuery({
    queryKey: ["dashboard", "global", params ?? {}],
    queryFn: async (): Promise<GlobalDashboardResponse> => {
      const { data } = await api.get<GlobalDashboardResponse>("/dashboard/global", {
        params,
      })
      return data
    },
    staleTime: 60_000,
  })
}

interface ProjectDashboardParams {
  date_from?: string
  date_to?: string
}

export function useProjectDashboard(
  projectId: number | null | undefined,
  params: ProjectDashboardParams = {},
) {
  return useQuery({
    queryKey: ["dashboard", "project", projectId ?? -1, params],
    queryFn: async (): Promise<ProjectDashboardResponse> => {
      const { data } = await api.get<ProjectDashboardResponse>(
        `/dashboard/project/${projectId}`,
        { params },
      )
      return data
    },
    enabled: projectId != null && projectId > 0,
    staleTime: 60_000,
  })
}
