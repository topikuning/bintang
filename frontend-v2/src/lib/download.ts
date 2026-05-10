import { api } from "@/lib/api"

/**
 * Trigger download file dari endpoint backend yg perlu Authorization header.
 * Tidak bisa pakai plain <a href> karena token harus attach via interceptor.
 */
export async function downloadFile(
  url: string,
  params: Record<string, string | number | boolean | undefined | null>,
  filename: string,
): Promise<void> {
  // Strip null/undefined dr params supaya server tidak parse "null"
  const cleanParams: Record<string, string | number | boolean> = {}
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== "") cleanParams[k] = v as string | number | boolean
  })

  const response = await api.get<Blob>(url, {
    params: cleanParams,
    responseType: "blob",
  })
  const blobUrl = window.URL.createObjectURL(response.data)

  const a = document.createElement("a")
  a.href = blobUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)

  // Free memory after a brief delay (let browser process click)
  setTimeout(() => window.URL.revokeObjectURL(blobUrl), 1000)
}
