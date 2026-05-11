import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { AxiosProgressEvent } from "axios"
import { api } from "@/lib/api"

/** Enum tipe dokumen lampiran proyek (mirror ProjectDocType di backend).
 *  Disimpan sbg string supaya luwes -- bisa nambah tipe baru tanpa migration. */
export type ProjectDocType =
  | "SPK"
  | "SURAT_PESANAN"
  | "BAST"
  | "KONTRAK"
  | "FAKTUR_PAJAK"
  | "INVOICE"
  | "KWITANSI"
  | "BERITA_ACARA"
  | "LAINNYA"

export const PROJECT_DOC_TYPE_LABELS: Record<ProjectDocType, string> = {
  SPK: "SPK (Surat Perintah Kerja)",
  SURAT_PESANAN: "Surat Pesanan",
  BAST: "BAST (Berita Acara Serah Terima)",
  KONTRAK: "Kontrak",
  FAKTUR_PAJAK: "Faktur Pajak",
  INVOICE: "Invoice Vendor",
  KWITANSI: "Kwitansi",
  BERITA_ACARA: "Berita Acara",
  LAINNYA: "Lainnya",
}

export interface ProjectAttachment {
  id: number
  label: string | null
  doc_type: ProjectDocType | null
  file_name: string
  file_size: number
  mime_type: string
  url: string
  uploaded_by_id: number
  created_at: string
}

const KEY = (pid: number) => ["projects", "attachments", pid] as const

export function useProjectAttachments(projectId: number | null | undefined) {
  return useQuery({
    queryKey: ["projects", "attachments", projectId ?? -1],
    queryFn: async (): Promise<ProjectAttachment[]> => {
      const { data } = await api.get<ProjectAttachment[]>(
        `/projects/${projectId}/attachments`,
      )
      return data
    },
    enabled: projectId != null && projectId > 0,
  })
}

interface UploadVars {
  projectId: number
  file: File
  label?: string
  docType?: ProjectDocType | null
  onProgress?: (pct: number) => void
}

export function useUploadProjectAttachment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      projectId,
      file,
      label,
      docType,
      onProgress,
    }: UploadVars): Promise<ProjectAttachment> => {
      const fd = new FormData()
      fd.append("file", file)
      if (label) fd.append("label", label)
      // doc_type sbg query param (backend baca dr Query, bukan FormData)
      const params: Record<string, string> = {}
      if (docType) params.doc_type = docType
      const { data } = await api.post<ProjectAttachment>(
        `/projects/${projectId}/attachments`,
        fd,
        {
          params,
          headers: { "Content-Type": "multipart/form-data" },
          onUploadProgress: (e: AxiosProgressEvent) => {
            if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100))
          },
        },
      )
      return data
    },
    onSuccess: (_, vars) =>
      qc.invalidateQueries({ queryKey: KEY(vars.projectId) }),
  })
}

interface LinkVars {
  projectId: number
  url: string
  label?: string
  docType?: ProjectDocType | null
  fileName?: string
}

export function useLinkProjectAttachment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      projectId,
      url,
      label,
      docType,
      fileName,
    }: LinkVars): Promise<ProjectAttachment> => {
      const { data } = await api.post<ProjectAttachment>(
        `/projects/${projectId}/attachments/link`,
        {
          url,
          label: label ?? null,
          doc_type: docType ?? null,
          file_name: fileName ?? null,
        },
      )
      return data
    },
    onSuccess: (_, vars) =>
      qc.invalidateQueries({ queryKey: KEY(vars.projectId) }),
  })
}

export function useDeleteProjectAttachment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      projectId,
      attachmentId,
    }: {
      projectId: number
      attachmentId: number
    }): Promise<void> => {
      await api.delete(`/projects/${projectId}/attachments/${attachmentId}`)
    },
    onSuccess: (_, vars) =>
      qc.invalidateQueries({ queryKey: KEY(vars.projectId) }),
  })
}

interface PatchVars {
  projectId: number
  attachmentId: number
  label?: string | null
  docType?: ProjectDocType | null
}

export function usePatchProjectAttachment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      projectId,
      attachmentId,
      label,
      docType,
    }: PatchVars): Promise<ProjectAttachment> => {
      const { data } = await api.patch<ProjectAttachment>(
        `/projects/${projectId}/attachments/${attachmentId}`,
        {
          label: label ?? null,
          doc_type: docType ?? null,
        },
      )
      return data
    },
    onSuccess: (_, vars) =>
      qc.invalidateQueries({ queryKey: KEY(vars.projectId) }),
  })
}
