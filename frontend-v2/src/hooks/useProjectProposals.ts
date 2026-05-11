import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import type { Page, Project } from "@/types/api"

export interface ProjectProposalInput {
  code: string
  name: string
  location?: string | null
  company_id: number
  client_name?: string | null
  start_date?: string | null
  end_date?: string | null
  notes?: string | null
  project_value?: number
  budget_amount?: number
}

/** Queue proposal yg menunggu approval. Admin only. */
export function useProposalQueue(params: { page?: number; size?: number } = {}) {
  return useQuery({
    queryKey: ["projects", "proposals", "queue", params],
    queryFn: async (): Promise<Page<Project>> => {
      const { data } = await api.get<Page<Project>>("/projects/proposals/queue", {
        params: { page: 1, size: 50, ...params },
      })
      return data
    },
    staleTime: 30_000,
  })
}

/** Hitungan proposal pending utk badge nav. Admin only. */
export function useProposalCount() {
  return useQuery({
    queryKey: ["projects", "proposals", "count"],
    queryFn: async (): Promise<{ count: number }> => {
      const { data } = await api.get<{ count: number }>("/projects/proposals/count")
      return data
    },
    staleTime: 30_000,
    // Endpoint admin-only -- biarkan 403 utk non-admin (graceful: tdk render badge).
    retry: false,
  })
}

export function useProposeProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: ProjectProposalInput): Promise<Project> => {
      const { data } = await api.post<Project>("/projects/proposals", payload)
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.projects.all() })
      qc.invalidateQueries({ queryKey: ["projects", "proposals"] })
    },
  })
}

export function useApproveProposal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number): Promise<Project> => {
      const { data } = await api.post<Project>(`/projects/${id}/approve`)
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.projects.all() })
      qc.invalidateQueries({ queryKey: ["projects", "proposals"] })
      qc.invalidateQueries({ queryKey: ["projects-stats"] })
    },
  })
}

export function useRejectProposal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { id: number; reason: string }): Promise<Project> => {
      const { data } = await api.post<Project>(`/projects/${vars.id}/reject`, {
        reason: vars.reason,
      })
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.projects.all() })
      qc.invalidateQueries({ queryKey: ["projects", "proposals"] })
    },
  })
}
