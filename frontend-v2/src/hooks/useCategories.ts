import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import type { CategoryType, Page } from "@/types/api"

export interface Category {
  id: number
  name: string
  type: CategoryType
  description: string | null
  /** Audit 2026-05-23: peran akuntansi khusus. Max 1 boleh true. */
  is_marketing?: boolean
  is_penalty?: boolean
  is_profit_share?: boolean
}

export function useCategories(params: { type?: CategoryType; q?: string } = {}) {
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
