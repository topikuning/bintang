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
  source_url?: string
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

export function useOcrExtractUpload() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      file,
      entity = "invoice",
      onProgress,
    }: {
      file: File
      entity?: string
      onProgress?: (pct: number) => void
    }): Promise<OcrExtractResult> => {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("entity", entity)
      const { data } = await api.post<OcrExtractResult>(
        "/ocr/extract-upload",
        fd,
        {
          headers: { "Content-Type": "multipart/form-data" },
          // Backend OCR call (Claude) bisa makan 10-30 detik utk dokumen
          // ramai (handwriting + banyak items). Backend SDK timeout 75s,
          // beri buffer jaringan/proxy -> 110s di sini.
          timeout: 110_000,
          onUploadProgress: (e) => {
            if (onProgress && e.total) {
              onProgress(Math.round((e.loaded / e.total) * 100))
            }
          },
        },
      )
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ocr", "drafts"] }),
  })
}

export interface OcrTestConnectionResult {
  ok: boolean
  engine?: string
  model?: string
  latency_ms?: number
  reply?: string
  error?: string
  detail?: string
  hint?: string
  input_tokens?: number
  output_tokens?: number
}

export function useOcrTestConnection() {
  return useMutation({
    mutationFn: async (): Promise<OcrTestConnectionResult> => {
      const { data } = await api.get<OcrTestConnectionResult>(
        "/ocr/test-connection",
        { timeout: 70_000 },
      )
      return data
    },
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
