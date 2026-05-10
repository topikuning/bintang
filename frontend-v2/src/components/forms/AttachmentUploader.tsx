import { useRef, useState } from "react"
import {
  AlertCircle,
  CheckCircle2,
  Link2,
  Loader2,
  Plus,
  Upload,
  X,
} from "lucide-react"
import { z } from "zod"
import { apiErrorMessage } from "@/lib/api"
import { fmtFileSize, validateFile } from "@/lib/file"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "@/components/ui/sonner"

interface AttachmentUploaderProps {
  /** Callback upload satu file. Implementasi-spesifik (transaction/invoice/po). */
  uploadFile: (file: File, onProgress: (pct: number) => void) => Promise<void>
  /** Callback link eksternal. Optional -- kalau tidak ada, tombol Link hilang. */
  linkExternal?: (url: string, label?: string) => Promise<void>
  isLinking?: boolean
  /** Disable upload (mis. status terkunci). */
  disabled?: boolean
  /** Pesan saat disabled. */
  disabledReason?: string
  /** Maks ukuran MB, default 25. */
  maxSizeMB?: number
}

interface QueueItem {
  id: string
  file: File
  progress: number
  status: "queued" | "uploading" | "done" | "error"
  error?: string
}

const linkSchema = z.object({
  url: z.string().url("URL tidak valid"),
  label: z.string().max(120).optional(),
})

/**
 * Komponen upload bukti/lampiran -- generic untuk transaksi/invoice/PO.
 *  - Drag-drop area + file picker
 *  - Multi-file dgn queue + progress per item
 *  - Tombol "Link Eksternal" (opsional via linkExternal)
 *
 * Caller bertanggung jawab implement upload mutation -- hook ini hanya
 * UI + queue management.
 */
export function AttachmentUploader({
  uploadFile,
  linkExternal,
  isLinking,
  disabled,
  disabledReason,
  maxSizeMB = 25,
}: AttachmentUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = useState(false)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState("")
  const [linkLabel, setLinkLabel] = useState("")
  const [linkError, setLinkError] = useState<string | null>(null)

  const handleFiles = async (files: FileList | File[]) => {
    if (disabled) return
    const arr = Array.from(files)
    if (arr.length === 0) return

    const newItems: QueueItem[] = arr.map((file) => {
      const err = validateFile(file, { maxSizeMB })
      return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        progress: 0,
        status: err ? "error" : "queued",
        error: err ?? undefined,
      }
    })
    setQueue((prev) => [...prev, ...newItems])

    // Upload sequential supaya progress jelas + tidak overload server.
    for (const item of newItems) {
      if (item.status === "error") continue
      setQueue((prev) =>
        prev.map((q) => (q.id === item.id ? { ...q, status: "uploading" } : q)),
      )
      try {
        await uploadFile(item.file, (pct) =>
          setQueue((prev) =>
            prev.map((q) => (q.id === item.id ? { ...q, progress: pct } : q)),
          ),
        )
        setQueue((prev) =>
          prev.map((q) => (q.id === item.id ? { ...q, status: "done", progress: 100 } : q)),
        )
        setTimeout(() => {
          setQueue((prev) => prev.filter((q) => q.id !== item.id))
        }, 2000)
      } catch (err) {
        setQueue((prev) =>
          prev.map((q) =>
            q.id === item.id ? { ...q, status: "error", error: apiErrorMessage(err) } : q,
          ),
        )
        toast.error(`Gagal upload ${item.file.name}`, { description: apiErrorMessage(err) })
      }
    }
  }

  const handleSubmitLink = async () => {
    if (!linkExternal) return
    setLinkError(null)
    const parsed = linkSchema.safeParse({
      url: linkUrl.trim(),
      label: linkLabel.trim() || undefined,
    })
    if (!parsed.success) {
      setLinkError(parsed.error.issues[0]?.message ?? "URL tidak valid")
      return
    }
    try {
      await linkExternal(parsed.data.url, parsed.data.label)
      toast.success("Link eksternal ditambahkan")
      setLinkOpen(false)
      setLinkUrl("")
      setLinkLabel("")
    } catch (err) {
      setLinkError(apiErrorMessage(err))
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {disabled && disabledReason && (
        <div className="flex items-start gap-2 rounded border border-warning-200 bg-warning-50 px-3 py-2 text-[12px] text-warning-700">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{disabledReason}</span>
        </div>
      )}

      <div
        onDragEnter={(e) => {
          if (disabled) return
          e.preventDefault()
          setDragActive(true)
        }}
        onDragOver={(e) => {
          if (disabled) return
          e.preventDefault()
          setDragActive(true)
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          if (disabled) return
          e.preventDefault()
          setDragActive(false)
          if (e.dataTransfer.files?.length) {
            void handleFiles(e.dataTransfer.files)
          }
        }}
        className={cn(
          "rounded-md border-2 border-dashed bg-surface-muted px-4 py-6 text-center transition-colors",
          dragActive && !disabled && "border-brand-500 bg-brand-50",
          disabled && "opacity-50",
        )}
      >
        <Upload className="mx-auto h-7 w-7 text-ink-400" />
        <div className="mt-2 text-[13px] text-ink-700">
          <span className="hidden sm:inline">Tarik file ke sini atau </span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            className="font-semibold text-brand-600 hover:underline disabled:cursor-not-allowed"
          >
            pilih file
          </button>
        </div>
        <div className="mt-1 text-[11px] text-ink-500">
          Maks {maxSizeMB} MB / file. Bisa pilih lebih dari satu.
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) {
              void handleFiles(e.target.files)
              e.target.value = ""
            }
          }}
        />

        {linkExternal && (
          <div className="mt-3 flex justify-center">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => setLinkOpen(true)}
            >
              <Link2 className="h-3.5 w-3.5" />
              Link eksternal (Drive / Dropbox)
            </Button>
          </div>
        )}
      </div>

      {queue.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {queue.map((item) => (
            <QueueItemRow
              key={item.id}
              item={item}
              onRemove={() => setQueue((prev) => prev.filter((q) => q.id !== item.id))}
            />
          ))}
        </div>
      )}

      <Dialog
        open={linkOpen}
        onOpenChange={(o) => {
          if (!o) {
            setLinkOpen(false)
            setLinkError(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tambah Link Eksternal</DialogTitle>
            <DialogDescription>
              Tempel URL bukti yang sudah di-host di Google Drive, Dropbox,
              OneDrive, atau platform lain. Pastikan link bisa diakses oleh
              tim yang berwenang.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ext-url">URL</Label>
              <Input
                id="ext-url"
                type="url"
                inputMode="url"
                placeholder="https://drive.google.com/…"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ext-label">Nama / label (opsional)</Label>
              <Input
                id="ext-label"
                placeholder="Mis. Bukti transfer Bank Jatim 12 Des"
                value={linkLabel}
                onChange={(e) => setLinkLabel(e.target.value)}
              />
            </div>
            {linkError && <p className="text-[12px] text-danger-600">{linkError}</p>}
          </div>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                setLinkOpen(false)
                setLinkError(null)
              }}
            >
              Batal
            </Button>
            <Button onClick={handleSubmitLink} disabled={isLinking}>
              {isLinking && <Loader2 className="h-4 w-4 animate-spin" />}
              <Plus className="h-4 w-4" />
              Tambahkan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function QueueItemRow({
  item,
  onRemove,
}: {
  item: QueueItem
  onRemove: () => void
}) {
  return (
    <div
      className={cn(
        "rounded border bg-surface px-3 py-2",
        item.status === "error" && "border-danger-200 bg-danger-50",
        item.status === "done" && "border-success-200 bg-success-50",
      )}
    >
      <div className="flex items-center gap-2">
        {item.status === "uploading" && (
          <Loader2 className="h-4 w-4 animate-spin text-brand-600 shrink-0" />
        )}
        {item.status === "done" && (
          <CheckCircle2 className="h-4 w-4 text-success-700 shrink-0" />
        )}
        {item.status === "error" && (
          <AlertCircle className="h-4 w-4 text-danger-700 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="truncate text-[13px] font-medium">{item.file.name}</div>
          <div className="text-[11px] text-ink-500">
            {fmtFileSize(item.file.size)}
            {item.status === "uploading" && ` · ${item.progress}%`}
            {item.error && ` · ${item.error}`}
          </div>
        </div>
        {(item.status === "error" || item.status === "queued") && (
          <button
            type="button"
            onClick={onRemove}
            className="text-ink-400 hover:text-ink-700"
            aria-label="Hapus dari antrian"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {item.status === "uploading" && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink-200">
          <div
            className="h-full bg-brand-500 transition-all"
            style={{ width: `${item.progress}%` }}
          />
        </div>
      )}
    </div>
  )
}
