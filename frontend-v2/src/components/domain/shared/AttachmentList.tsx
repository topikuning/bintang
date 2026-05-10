import { useState } from "react"
import {
  ExternalLink,
  File as FileIcon,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Link2,
  Loader2,
  Package,
  Trash2,
} from "lucide-react"
import type { Attachment } from "@/types/api"
import { fileUrl } from "@/lib/api"
import { detectFileKind, fmtFileSize, isExternalUrl } from "@/lib/file"
import { cn } from "@/lib/utils"
import { useLightbox } from "@/store/lightbox"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface AttachmentListProps {
  attachments: Attachment[]
  /** Tampilkan tombol delete per item. */
  canDelete?: boolean
  /** Dipanggil saat user konfirmasi hapus. */
  onDelete?: (attachment: Attachment) => Promise<void> | void
  /** State delete yg sedang berjalan (utk disable tombol). */
  deletingId?: number | null
  /** Empty state kalau tidak ada lampiran. */
  emptyMessage?: string
  className?: string
}

export function AttachmentList({
  attachments,
  canDelete,
  onDelete,
  deletingId,
  emptyMessage = "Belum ada bukti.",
  className,
}: AttachmentListProps) {
  const showLightbox = useLightbox((s) => s.show)
  const [confirmDel, setConfirmDel] = useState<Attachment | null>(null)

  if (attachments.length === 0) {
    return (
      <div
        className={cn(
          "rounded-md border border-dashed bg-surface-muted p-6 text-center text-[13px] text-ink-500",
          className,
        )}
      >
        {emptyMessage}
      </div>
    )
  }

  // Pisahkan image (utk grid) vs non-image (utk list).
  const images = attachments.filter((a) => detectFileKind(a.mime_type, a.file_name) === "image")
  const nonImages = attachments.filter((a) => detectFileKind(a.mime_type, a.file_name) !== "image")

  const lightboxImages = images.map((a) => ({
    src: fileUrl(a.url) ?? a.url,
    alt: a.file_name,
  }))

  return (
    <>
      <div className={cn("flex flex-col gap-3", className)}>
        {images.length > 0 && (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
            {images.map((a, idx) => (
              <ImageThumb
                key={a.id}
                attachment={a}
                onClick={() => showLightbox(lightboxImages, idx)}
                onDelete={canDelete ? () => setConfirmDel(a) : undefined}
                deleting={deletingId === a.id}
              />
            ))}
          </div>
        )}

        {nonImages.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {nonImages.map((a) => (
              <NonImageRow
                key={a.id}
                attachment={a}
                onDelete={canDelete ? () => setConfirmDel(a) : undefined}
                deleting={deletingId === a.id}
              />
            ))}
          </div>
        )}
      </div>

      <Dialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hapus lampiran ini?</DialogTitle>
            <DialogDescription>
              <span className="font-mono break-all">{confirmDel?.file_name}</span>
              <br />
              File akan dihapus permanen dari penyimpanan. Tindakan ini
              tercatat di audit log.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmDel(null)}>
              Batal
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (confirmDel && onDelete) {
                  await onDelete(confirmDel)
                  setConfirmDel(null)
                }
              }}
              disabled={!!deletingId}
            >
              {deletingId === confirmDel?.id && <Loader2 className="h-4 w-4 animate-spin" />}
              Hapus
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function ImageThumb({
  attachment,
  onClick,
  onDelete,
  deleting,
}: {
  attachment: Attachment
  onClick: () => void
  onDelete?: () => void
  deleting?: boolean
}) {
  const src = fileUrl(attachment.url) ?? attachment.url
  return (
    <div className="relative group">
      <button
        type="button"
        onClick={onClick}
        className="block aspect-square w-full overflow-hidden rounded-md border bg-ink-100 hover:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
        title={attachment.file_name}
      >
        <img
          src={src}
          alt={attachment.file_name}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          disabled={deleting}
          className="absolute right-1 top-1 hidden rounded bg-danger-600/90 p-1 text-white hover:bg-danger-700 group-hover:flex disabled:opacity-50"
          aria-label="Hapus lampiran"
        >
          {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
        </button>
      )}
    </div>
  )
}

function NonImageRow({
  attachment,
  onDelete,
  deleting,
}: {
  attachment: Attachment
  onDelete?: () => void
  deleting?: boolean
}) {
  const kind = detectFileKind(attachment.mime_type, attachment.file_name)
  const isExt = isExternalUrl(attachment.url)
  const href = fileUrl(attachment.url) ?? attachment.url

  const iconMap = {
    pdf: <FileText className="h-5 w-5 text-danger-600" />,
    doc: <FileText className="h-5 w-5 text-info-600" />,
    spreadsheet: <FileSpreadsheet className="h-5 w-5 text-success-600" />,
    archive: <Package className="h-5 w-5 text-warning-600" />,
    image: <ImageIcon className="h-5 w-5 text-brand-600" />,
    external: <Link2 className="h-5 w-5 text-info-600" />,
    other: <FileIcon className="h-5 w-5 text-ink-500" />,
  } as const

  return (
    <div className="flex items-center gap-3 rounded-md border bg-surface px-3 py-2 hover:border-border-strong">
      {iconMap[kind]}
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-1 min-w-0"
      >
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-ink-900 hover:text-brand-700 hover:underline">
            {attachment.file_name}
          </span>
          {isExt && <ExternalLink className="h-3 w-3 text-ink-400" />}
        </div>
        <div className="text-[11px] text-ink-500">
          {isExt ? "Tautan eksternal" : fmtFileSize(attachment.file_size)}
        </div>
      </a>
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          className="flex h-8 w-8 items-center justify-center rounded text-ink-400 hover:bg-danger-50 hover:text-danger-700 disabled:opacity-50"
          aria-label="Hapus lampiran"
        >
          {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </button>
      )}
    </div>
  )
}
