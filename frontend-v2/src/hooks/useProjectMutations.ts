import { useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import type { Project } from "@/types/api"

export interface ProjectInput {
  code: string
  name: string
  company_id: number
  budget_amount?: number
  is_active?: boolean
  project_value?: number
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
