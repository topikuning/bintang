import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"

export interface OcrDraft {
  id: number
  entity: string
  entity_id: number | null  // invoice id kalau sudah dijadikan invoice
  status: string
  confidence_score: number
  extracted_data: Record<string, unknown> | null
  source_url: string
  reviewed_at: string | null
}

export interface OcrCreateInvoiceInput {
  draft_id: number
  project_id: number
  type: "IN" | "OUT"
  vendor_client_id?: number | null
  override_number?: string
  override_party_name?: string
  override_notes?: string
}

export interface OcrCreateInvoiceResult {
  invoice_id: number
  invoice_number: string
  project_id: number
  type: "IN" | "OUT"
  status: string
  total: number
  items_count: number
  attachments_count: number
  draft_id: number
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
      engine,
    }: {
      file_url: string
      entity?: string
      engine?: string | null
    }): Promise<OcrExtractResult> => {
      const { data } = await api.post<OcrExtractResult>(
        "/ocr/extract",
        { file_url, entity, engine: engine || undefined },
        // Audit 2026-05-24: OCR vision call bisa > 30s utk scan rumit.
        { timeout: 300_000 },
      )
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
      engine,
      onProgress,
    }: {
      file: File
      entity?: string
      engine?: string | null
      onProgress?: (pct: number) => void
    }): Promise<OcrExtractResult> => {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("entity", entity)
      if (engine) fd.append("engine", engine)
      const { data } = await api.post<OcrExtractResult>(
        "/ocr/extract-upload",
        fd,
        {
          headers: { "Content-Type": "multipart/form-data" },
          // Backend OCR call bisa makan 10-60 detik utk dokumen ramai
          // (handwriting + banyak items). Audit 2026-05-24: naikkan ke
          // 5 menit utk safety margin (sblm-nya 110s).
          timeout: 300_000,
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

export interface OcrEngineInfo {
  key: string                // "claude" | "mistral" | "stub"
  label: string
  model: string
  cost_per_doc: string
  available: boolean
  default: boolean
  note?: string
}

export function useOcrEngines() {
  return useQuery({
    queryKey: ["ocr", "engines"],
    queryFn: async (): Promise<OcrEngineInfo[]> => {
      const { data } = await api.get<{ engines: OcrEngineInfo[] }>("/ocr/engines")
      return data.engines
    },
    staleTime: 5 * 60_000,
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

export function useOcrCreateInvoice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (
      input: OcrCreateInvoiceInput,
    ): Promise<OcrCreateInvoiceResult> => {
      const { draft_id, ...body } = input
      const { data } = await api.post<OcrCreateInvoiceResult>(
        `/ocr/drafts/${draft_id}/create-invoice`,
        body,
      )
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ocr", "drafts"] })
      qc.invalidateQueries({ queryKey: ["invoices"] })
    },
  })
}

export function useOcrTestConnection() {
  return useMutation({
    mutationFn: async (
      engine?: string | null,
    ): Promise<OcrTestConnectionResult> => {
      const { data } = await api.get<OcrTestConnectionResult>(
        "/ocr/test-connection",
        { params: engine ? { engine } : undefined, timeout: 70_000 },
      )
      return data
    },
  })
}

/** Soft-delete draft OCR -- biasanya dipakai kalau hasil ekstraksi salah/blur
 * dan tidak akan dijadikan invoice. Tidak bisa dihapus kalau sudah linked
 * ke invoice (entity_id ter-set) supaya audit trail tetap utuh.
 */
export function useOcrDiscardDraft() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number): Promise<void> => {
      await api.delete(`/ocr/drafts/${id}`)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ocr", "drafts"] }),
  })
}
