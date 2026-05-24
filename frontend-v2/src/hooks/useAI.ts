import { useMutation } from "@tanstack/react-query"
import { api } from "@/lib/api"

// ============================================================
// AI feature client hooks. Audit 2026-05-23.
// Setiap fitur AI punya hook React Query sendiri supaya konsisten
// dgn pattern existing.
// ============================================================

export interface AIMeta {
  model: string
  cached: boolean
  cost_usd: string
  latency_ms?: number
}

// ---------- AI-1 Category Suggest ----------
export interface CategorySuggestResult {
  category_id: number | null
  category_name: string | null
  confidence: number
  reason: string
  _meta: AIMeta
}

export function useSuggestCategory() {
  return useMutation({
    mutationFn: async (input: {
      description: string
      direction?: "IN" | "OUT"
    }): Promise<CategorySuggestResult> => {
      const { data } = await api.post<CategorySuggestResult>(
        "/ai/suggest-category", input,
      )
      return data
    },
  })
}

// ---------- AI-2 PO Cover Generator ----------
export interface POCoverResult {
  text: string
  _meta: AIMeta
}

export function useGeneratePOCover() {
  return useMutation({
    mutationFn: async (input: {
      po_id: number
      tone?: "formal" | "santai"
    }): Promise<POCoverResult> => {
      const { data } = await api.post<POCoverResult>(
        "/ai/generate-po-cover", input,
      )
      return data
    },
  })
}

// ---------- AI-4 Cash Request Justifier ----------
export interface CashJustifyResult {
  text: string
  _meta: AIMeta
}

export function useJustifyCashRequest() {
  return useMutation({
    mutationFn: async (input: {
      cash_request_id?: number
      project_id?: number
      title?: string
      items?: Array<{ description: string; amount: string | number }>
    }): Promise<CashJustifyResult> => {
      const { data } = await api.post<CashJustifyResult>(
        "/ai/justify-cash-request", input,
      )
      return data
    },
  })
}

// ---------- AI-5 Anomaly Detection ----------
export interface AnomalyFlag {
  tx_id: number
  severity: "high" | "medium" | "low"
  anomaly_type: string
  reason: string
}
export interface AnomalyResult {
  flagged: AnomalyFlag[]
  summary: string
  _meta?: { model: string; cost_usd: string; candidates_count: number; tx_count: number }
}

export function useScanAnomalies() {
  return useMutation({
    mutationFn: async (input: {
      date_from: string
      date_to: string
      project_id?: number
    }): Promise<AnomalyResult> => {
      const { data } = await api.post<AnomalyResult>(
        "/ai/scan-anomalies", input,
      )
      return data
    },
  })
}

// ---------- AI-6 Ask Query ----------
export interface AskQueryData {
  columns: string[]
  data: Array<Array<string | number>>
}
export interface AskQueryResult {
  template: string
  reason: string
  follow_up: string
  data: AskQueryData | null
  params_used?: Record<string, unknown>
  _meta: AIMeta
}

export function useAskQuery() {
  return useMutation({
    mutationFn: async (input: { question: string }): Promise<AskQueryResult> => {
      const { data } = await api.post<AskQueryResult>("/ai/ask", input)
      return data
    },
  })
}

// ---------- AI-7 Contract Extract ----------
export interface ContractParty {
  name: string
  role?: string
}
export interface ContractClause {
  title: string
  summary: string
}
export interface ContractKeyDate {
  label: string
  date: string
}
export interface ContractExtractResult {
  doc_type: string
  doc_number?: string
  doc_date?: string
  parties: ContractParty[]
  contract_value?: number
  currency?: string
  start_date?: string
  end_date?: string
  scope_summary: string
  key_clauses: ContractClause[]
  key_dates: ContractKeyDate[]
  notes?: string
  confidence_score: number
  source_url?: string | null
  _meta: AIMeta
}

export function useExtractContract() {
  return useMutation({
    mutationFn: async (input: {
      file: File
      save_attachment?: boolean
    }): Promise<ContractExtractResult> => {
      const fd = new FormData()
      fd.append("file", input.file)
      fd.append("save_attachment", String(input.save_attachment ?? false))
      const { data } = await api.post<ContractExtractResult>(
        "/ai/extract-contract", fd,
        {
          headers: { "Content-Type": "multipart/form-data" },
          timeout: 110_000,
        },
      )
      return data
    },
  })
}

// ---------- AI-8 Daily Summary ----------
export interface DailySummaryResult {
  text: string
  facts: string
  _meta: AIMeta
}

export function useDailySummary() {
  return useMutation({
    mutationFn: async (input: { target_date?: string } = {}): Promise<DailySummaryResult> => {
      const { data } = await api.post<DailySummaryResult>(
        "/ai/daily-summary", input,
      )
      return data
    },
  })
}

