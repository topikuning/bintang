import { useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import type { Project, ProjectStatus } from "@/types/api"

export interface ProjectInput {
  code: string
  name: string
  company_id: number
  location?: string | null
  client_name?: string | null
  funder_ids?: number[]
  pic_user_id?: number | null
  start_date?: string | null
  end_date?: string | null
  status?: ProjectStatus
  notes?: string | null
  project_value?: number
  budget_amount?: number
  currency?: string
  overbudget_tolerance_pct?: number
  tax_ppn_pct?: number
  tax_pph_pct?: number
  marketing_pct?: number
}

export function useCreateProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: ProjectInput): Promise<Project> => {
      const { data } = await api.post<Project>("/projects", payload)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.projects.all() }),
  })
}

export function useUpdateProject(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: Partial<ProjectInput>): Promise<Project> => {
      const { data } = await api.patch<Project>(`/projects/${id}`, payload)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.projects.all() }),
  })
}

export function useDeleteProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number): Promise<void> => {
      await api.delete(`/projects/${id}`)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.projects.all() }),
  })
}
