import { useMutation, useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"

export interface ImportEntity {
  key: string
  label: string
  headers: string[]
  note?: string | null
}

export interface ImportPreviewResult {
  entity: string
  total_rows: number
  new_count: number
  dup_count: number
  error_count: number
  committed: boolean
  dup_action: "skip" | "update" | "error"
  samples: Array<Record<string, unknown>>
  dupes: Array<Record<string, unknown>>
  errors: Array<Record<string, unknown>>
}

export function useImportEntities() {
  return useQuery({
    queryKey: ["imports", "entities"],
    queryFn: async (): Promise<ImportEntity[]> => {
      const { data } = await api.get<ImportEntity[]>("/imports/")
      return data
    },
    staleTime: 5 * 60_000,
  })
}

export function usePreviewImport() {
  return useMutation({
    mutationFn: async ({
      entity,
      file,
    }: {
      entity: string
      file: File
    }): Promise<ImportPreviewResult> => {
      const fd = new FormData()
      fd.append("file", file)
      const { data } = await api.post<ImportPreviewResult>(
        `/imports/${entity}/preview`,
        fd,
        { headers: { "Content-Type": "multipart/form-data" } },
      )
      return data
    },
  })
}

export function useCommitImport() {
  return useMutation({
    mutationFn: async ({
      entity,
      file,
      dupAction,
    }: {
      entity: string
      file: File
      dupAction: "skip" | "update" | "error"
    }): Promise<ImportPreviewResult> => {
      const fd = new FormData()
      fd.append("file", file)
      // Audit 2026-05-23 bug: backend pakai Form(), bukan Query.
      // Sebelumnya FE kirim ?dup_action=update di URL -> di-ignore
      // backend -> fallback ke default 'skip' -> data lama tdk
      // overwrite walau user pilih update.
      fd.append("dup_action", dupAction)
      const { data } = await api.post<ImportPreviewResult>(
        `/imports/${entity}/commit`,
        fd,
        { headers: { "Content-Type": "multipart/form-data" } },
      )
      return data
    },
  })
}
