import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { AxiosProgressEvent } from "axios"
import { api } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import type { Attachment } from "@/types/api"

interface UploadVars {
  transactionId: number
  file: File
  onProgress?: (pct: number) => void
}

/**
 * Upload file (multipart) sebagai bukti transaksi.
 * Backend simpan ke storage (lokal/S3) lalu return Attachment metadata.
 */
export function useUploadTransactionAttachment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ transactionId, file, onProgress }: UploadVars): Promise<Attachment> => {
      const fd = new FormData()
      fd.append("file", file)
      const { data } = await api.post<Attachment>(
        `/transactions/${transactionId}/attachments`,
        fd,
        {
          headers: { "Content-Type": "multipart/form-data" },
          onUploadProgress: (e: AxiosProgressEvent) => {
            if (onProgress && e.total) {
              onProgress(Math.round((e.loaded / e.total) * 100))
            }
          },
        },
      )
      return data
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.transactions.detail(vars.transactionId) })
      qc.invalidateQueries({ queryKey: queryKeys.transactions.all() })
    },
  })
}

interface LinkVars {
  transactionId: number
  url: string
  label?: string
  fileName?: string
}

/**
 * Tambahkan link eksternal (Google Drive, Dropbox, dll) sebagai bukti.
 * Backend normalisasi URL & ekstrak metadata kalau bisa.
 */
export function useLinkTransactionAttachment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ transactionId, url, label, fileName }: LinkVars): Promise<Attachment> => {
      const { data } = await api.post<Attachment>(
        `/transactions/${transactionId}/attachments/link`,
        { url, label: label ?? null, file_name: fileName ?? null },
      )
      return data
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.transactions.detail(vars.transactionId) })
      qc.invalidateQueries({ queryKey: queryKeys.transactions.all() })
    },
  })
}

interface DeleteVars {
  transactionId: number
  attachmentId: number
}

export function useDeleteTransactionAttachment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ transactionId, attachmentId }: DeleteVars): Promise<void> => {
      await api.delete(`/transactions/${transactionId}/attachments/${attachmentId}`)
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.transactions.detail(vars.transactionId) })
      qc.invalidateQueries({ queryKey: queryKeys.transactions.all() })
    },
  })
}
