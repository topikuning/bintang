import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import type { Page, Project, ProjectStatus } from "@/types/api"

interface ListParams {
  page?: number
  size?: number
  q?: string
  status?: ProjectStatus
  company_id?: number
  /** Default backend hide proyek MENUNGGU_PERSETUJUAN dr list operasional.
   *  Set true di master CRUD supaya admin tetap bisa kelola proposal. */
  include_pending?: boolean
}

export function useProjects(params: ListParams = {}) {
  return useQuery({
    queryKey: queryKeys.projects.list(params),
    queryFn: async (): Promise<Page<Project>> => {
      const { data } = await api.get<Page<Project>>("/projects", {
        params: { page: 1, size: 200, ...params },
      })
      return data
    },
    staleTime: 5 * 60_000, // proyek jarang berubah
  })
}

export function useProject(id: number | null | undefined) {
  return useQuery({
    queryKey: queryKeys.projects.detail(id ?? -1),
    queryFn: async (): Promise<Project> => {
      const { data } = await api.get<Project>(`/projects/${id}`)
      return data
    },
    enabled: id != null && id > 0,
  })
}
