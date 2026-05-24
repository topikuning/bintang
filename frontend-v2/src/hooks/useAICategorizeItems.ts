import { useMutation } from "@tanstack/react-query"
import { api } from "@/lib/api"

export interface CategorizeItemInput {
  description: string
  quantity?: number | string | null
  unit?: string | null
  unit_price?: number | string | null
}

export interface CategorizeItemSuggestion {
  index: number
  category_id: number | null
  category_name: string | null
  confidence: number
  reason: string
}

export interface CategorizeItemsRequest {
  items: CategorizeItemInput[]
  direction?: "IN" | "OUT" | null
  party_name?: string | null
  project_id?: number | null
  context_label?: string | null
}

export interface CategorizeItemsResponse {
  items: CategorizeItemSuggestion[]
  _meta?: { model: string; cached: boolean; cost_usd: string }
}

export function useAICategorizeItems() {
  return useMutation({
    mutationFn: async (
      payload: CategorizeItemsRequest,
    ): Promise<CategorizeItemsResponse> => {
      const { data } = await api.post<CategorizeItemsResponse>(
        "/ai/categorize-items",
        payload,
      )
      return data
    },
  })
}
