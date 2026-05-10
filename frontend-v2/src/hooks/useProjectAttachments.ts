import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { AxiosProgressEvent } from "axios"
import { api } from "@/lib/api"

export interface ProjectAttachment {
  id: number
  label: string | null
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
  onProgress?: (pct: number) => void
}

export function useUploadProjectAttachment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      projectId,
      file,
      label,
      onProgress,
    }: UploadVars): Promise<ProjectAttachment> => {
      const fd = new FormData()
      fd.append("file", file)
      if (label) fd.append("label", label)
      const { data } = await api.post<ProjectAttachment>(
        `/projects/${projectId}/attachments`,
        fd,
        {
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
  fileName?: string
}

export function useLinkProjectAttachment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      projectId,
      url,
      label,
      fileName,
    }: LinkVars): Promise<ProjectAttachment> => {
      const { data } = await api.post<ProjectAttachment>(
        `/projects/${projectId}/attachments/link`,
        { url, label: label ?? null, file_name: fileName ?? null },
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
