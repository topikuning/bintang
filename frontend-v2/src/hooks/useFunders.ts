import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import type { Funder, FunderInput, Page } from "@/types/api"

const KEY = ["funders"] as const

export function useFunders(params: { q?: string } = {}) {
  return useQuery({
    queryKey: [...KEY, "list", params],
    queryFn: async (): Promise<Page<Funder>> => {
      const { data } = await api.get<Page<Funder>>("/funders", {
        params: { page: 1, size: 500, ...params },
      })
      return data
    },
    staleTime: 5 * 60_000,
  })
}

export function useCreateFunder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: FunderInput): Promise<Funder> => {
      const { data } = await api.post<Funder>("/funders", payload)
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY })
      qc.invalidateQueries({ queryKey: ["projects-filters"] })
    },
  })
}

export function useUpdateFunder(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: Partial<FunderInput>): Promise<Funder> => {
      const { data } = await api.patch<Funder>(`/funders/${id}`, payload)
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY })
      qc.invalidateQueries({ queryKey: ["projects-filters"] })
    },
  })
}

export function useDeleteFunder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number): Promise<void> => {
      await api.delete(`/funders/${id}`)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY })
      qc.invalidateQueries({ queryKey: ["projects-filters"] })
    },
  })
}
