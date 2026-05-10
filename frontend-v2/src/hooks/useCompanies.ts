import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import type { Company, CompanyInput, Page } from "@/types/api"

const KEY = ["companies"] as const

export function useCompanies(params: { is_active?: boolean } = {}) {
  return useQuery({
    queryKey: [...KEY, "list", params],
    queryFn: async (): Promise<Page<Company>> => {
      const { data } = await api.get<Page<Company>>("/companies", {
        params: { page: 1, size: 200, ...params },
      })
      return data
    },
    staleTime: 5 * 60_000,
  })
}

export function useCreateCompany() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: CompanyInput): Promise<Company> => {
      const { data } = await api.post<Company>("/companies", payload)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useUpdateCompany(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: Partial<CompanyInput>): Promise<Company> => {
      const { data } = await api.patch<Company>(`/companies/${id}`, payload)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useDeleteCompany() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number): Promise<void> => {
      await api.delete(`/companies/${id}`)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}
