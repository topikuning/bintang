import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"

export interface NonProjectCompanyEntry {
  company_id: number
  company_name: string
  project_id: number
  project_code: string
}

export interface NonProjectYearStatus {
  company_id: number
  company_name: string
  year: number
  include_in_global: boolean
  notes: string | null
  updated_at: string | null
  updated_by_name: string | null
  tx_count: number
  total_in: number
  total_out: number
}

/**
 * Daftar (company, system project NON_PROJECT) yg user akses.
 * Dipakai di /catatan-non-proyek utk:
 *  - tahu project_id default saat create tx
 *  - tampil dropdown company kalau user akses >1 company
 */
export function useNonProjectCompanies() {
  return useQuery({
    queryKey: queryKeys.nonProject.companies(),
    queryFn: async (): Promise<NonProjectCompanyEntry[]> => {
      const { data } = await api.get<NonProjectCompanyEntry[]>(
        "/non-project/companies",
      )
      return data
    },
  })
}

/**
 * Daftar status inklusi per tahun. Gabungan (a) setting tersimpan dgn
 * (b) tahun yg auto-detect dari tx_date. Default tahun blm di-setup =
 * OFF.
 */
export function useNonProjectYearSettings(company_id?: number) {
  return useQuery({
    queryKey: queryKeys.nonProject.years({ company_id: company_id ?? null }),
    queryFn: async (): Promise<NonProjectYearStatus[]> => {
      const { data } = await api.get<NonProjectYearStatus[]>(
        "/non-project/settings/years",
        { params: company_id ? { company_id } : {} },
      )
      return data
    },
  })
}

export interface NonProjectYearUpdateInput {
  company_id: number
  year: number
  include_in_global: boolean
  notes?: string | null
}

/**
 * Upsert toggle inklusi per (company, year). SUPERADMIN only -- backend
 * reject 403 utk role lain. UI gating-nya di FE (tombol disabled).
 */
export function useUpdateNonProjectYear() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: NonProjectYearUpdateInput) => {
      const { company_id, year, ...rest } = input
      const { data } = await api.put<NonProjectYearStatus>(
        `/non-project/settings/years/${year}`,
        { company_id, ...rest },
      )
      return data
    },
    onSuccess: () => {
      // Invalidate semua list tahun + dashboard global (totals
      // berubah ketika toggle dipencet).
      qc.invalidateQueries({ queryKey: queryKeys.nonProject.all() })
      qc.invalidateQueries({ queryKey: ["dashboard"] })
      qc.invalidateQueries({ queryKey: queryKeys.transactions.all() })
    },
  })
}
