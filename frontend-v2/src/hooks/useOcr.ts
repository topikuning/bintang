import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"

export interface OcrDraft {
  id: number
  entity: string
  status: string
  confidence_score: number
  extracted_data: Record<string, unknown> | null
  source_url: string
  reviewed_at: string | null
}

export interface OcrExtractResult {
  id: number
  status: string
  confidence_score: number
  extracted_data: Record<string, unknown> | null
  needs_review: boolean
}

export function useOcrDrafts() {
  return useQuery({
    queryKey: ["ocr", "drafts"],
    queryFn: async (): Promise<OcrDraft[]> => {
      const { data } = await api.get<OcrDraft[]>("/ocr/drafts")
      return data
    },
  })
}

export function useOcrExtract() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      file_url,
      entity = "invoice",
    }: {
      file_url: string
      entity?: string
    }): Promise<OcrExtractResult> => {
      const { data } = await api.post<OcrExtractResult>("/ocr/extract", {
        file_url,
        entity,
      })
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ocr", "drafts"] }),
  })
}

export function useOcrReview() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      approved,
      note,
    }: {
      id: number
      approved: boolean
      note?: string
    }): Promise<{ id: number; approved: boolean }> => {
      const { data } = await api.post<{ id: number; approved: boolean }>(
        `/ocr/drafts/${id}/review`,
        { approved, note: note ?? null },
      )
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ocr", "drafts"] }),
  })
}
