import { useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import type { Category } from "@/hooks/useCategories"
import type { CategoryInput } from "@/types/api"

export function useCreateCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: CategoryInput): Promise<Category> => {
      const { data } = await api.post<Category>("/categories", payload)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.categories.all() }),
  })
}

export function useUpdateCategory(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: Partial<CategoryInput>): Promise<Category> => {
      const { data } = await api.patch<Category>(`/categories/${id}`, payload)
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.categories.all() }),
  })
}

export function useDeleteCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number): Promise<void> => {
      await api.delete(`/categories/${id}`)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.categories.all() }),
  })
}
