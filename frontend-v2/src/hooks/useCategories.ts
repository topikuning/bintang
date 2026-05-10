import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import type { Page } from "@/types/api"

export interface Category {
  id: number
  name: string
  parent_id: number | null
  type: "IN" | "OUT" | "BOTH"
}

export function useCategories(params: { type?: "IN" | "OUT" | "BOTH" } = {}) {
  return useQuery({
    queryKey: queryKeys.categories.list(params),
    queryFn: async (): Promise<Page<Category>> => {
      const { data } = await api.get<Page<Category>>("/categories", {
        params: { page: 1, size: 500, ...params },
      })
      return data
    },
    staleTime: 5 * 60_000,
  })
}

/** Map ID -> Category utk lookup cepat di tabel/card. */
export function useCategoryMap() {
  const q = useCategories()
  const map = new Map<number, Category>()
  q.data?.items.forEach((c) => map.set(c.id, c))
  return { map, isLoading: q.isLoading }
}
