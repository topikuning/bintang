/**
 * File-related utilities -- detect type, format size, dst.
 */

export type FileKind = "image" | "pdf" | "doc" | "spreadsheet" | "archive" | "external" | "other"

export function detectFileKind(mime: string, fileName?: string): FileKind {
  const m = mime.toLowerCase()
  const ext = (fileName?.split(".").pop() ?? "").toLowerCase()

  if (m.startsWith("image/")) return "image"
  if (m === "application/pdf" || ext === "pdf") return "pdf"
  if (
    m.includes("spreadsheet") ||
    m === "application/vnd.ms-excel" ||
    ["xls", "xlsx", "csv", "ods"].includes(ext)
  ) {
    return "spreadsheet"
  }
  if (
    m.includes("word") ||
    m === "application/msword" ||
    ["doc", "docx", "odt", "rtf"].includes(ext)
  ) {
    return "doc"
  }
  if (
    m.includes("zip") ||
    m.includes("compressed") ||
    ["zip", "rar", "7z", "tar", "gz"].includes(ext)
  ) {
    return "archive"
  }
  if (m === "text/url" || m.includes("external")) return "external"
  return "other"
}

export function isImageFile(mime: string, fileName?: string): boolean {
  return detectFileKind(mime, fileName) === "image"
}

/** Apakah URL menunjuk ke resource eksternal (link Drive/Dropbox dll). */
export function isExternalUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

const KB = 1024
const MB = KB * 1024
const GB = MB * 1024

export function fmtFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "-"
  if (bytes < KB) return `${bytes} B`
  if (bytes < MB) return `${(bytes / KB).toFixed(1)} KB`
  if (bytes < GB) return `${(bytes / MB).toFixed(1)} MB`
  return `${(bytes / GB).toFixed(2)} GB`
}

/** Validasi sederhana sebelum upload -- return error message kalau invalid. */
export interface FileValidationOpts {
  maxSizeMB?: number
  allowedMimes?: string[]
  allowedExts?: string[]
}

export function validateFile(file: File, opts: FileValidationOpts = {}): string | null {
  const maxSize = (opts.maxSizeMB ?? 25) * MB
  if (file.size > maxSize) {
    return `Ukuran file melebihi batas ${opts.maxSizeMB ?? 25} MB.`
  }
  if (opts.allowedMimes && opts.allowedMimes.length > 0) {
    if (!opts.allowedMimes.some((m) => file.type === m || file.type.startsWith(m))) {
      return "Jenis file tidak didukung."
    }
  }
  if (opts.allowedExts && opts.allowedExts.length > 0) {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
    if (!opts.allowedExts.includes(ext)) {
      return `Ekstensi .${ext} tidak didukung.`
    }
  }
  return null
}
