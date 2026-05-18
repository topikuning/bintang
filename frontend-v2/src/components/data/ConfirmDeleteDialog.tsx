import { useEffect, useState } from "react"
import { AlertTriangle, Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface ConfirmDeleteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
  /** Penjelasan apa yg di-hapus + konsekuensi. */
  description: React.ReactNode
  /** Aksi destruktif. Async OK -- button disabled selama promise. */
  onConfirm: () => Promise<void> | void
  /** Label tombol confirm (default "Ya, Hapus"). */
  confirmLabel?: string
  /** Loading state opsional (kalau caller manage sendiri loading). */
  isPending?: boolean
  /** Aktifkan retype-guard utk aksi sangat destruktif (mis. hapus
   *  proyek + cascade orphan). User WAJIB ketik teks yg sama persis.
   *  Pass undefined utk skip retype-guard. */
  requireTypeText?: string | undefined
  /** Override label input retype (default: "Ketik {text} untuk konfirmasi"). */
  retypeLabel?: React.ReactNode
}

/**
 * Dialog konfirmasi delete generik dgn opsi retype-guard.
 *
 * Tanpa `requireTypeText`: dialog standar (Cancel / Hapus).
 * Dengan `requireTypeText`: tombol Hapus disabled sampai user ketik
 * persis teks yg diminta (mis. nama proyek). Best practice utk aksi
 * destruktif berdampak besar -- mencegah accidental click.
 */
export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  title = "Hapus item?",
  description,
  onConfirm,
  confirmLabel = "Ya, Hapus",
  isPending = false,
  requireTypeText,
  retypeLabel,
}: ConfirmDeleteDialogProps) {
  const [typed, setTyped] = useState("")

  // Reset state setiap kali dialog buka/tutup (jangan persist value).
  useEffect(() => {
    if (!open) setTyped("")
  }, [open])

  const typeOk = !requireTypeText || typed.trim() === requireTypeText.trim()
  const disabled = isPending || !typeOk

  return (
    <Dialog open={open} onOpenChange={(o) => !isPending && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-danger-50 text-danger-600">
              <AlertTriangle className="h-4 w-4" />
            </span>
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {requireTypeText && (
          <div className="flex flex-col gap-1.5 pt-2">
            <Label className="text-[12px]">
              {retypeLabel ?? (
                <>
                  Ketik <code className="font-mono bg-ink-100 px-1.5 py-0.5 rounded text-[11px]">{requireTypeText}</code> untuk konfirmasi
                </>
              )}
            </Label>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={requireTypeText}
              autoComplete="off"
              autoFocus
            />
          </div>
        )}

        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Batal
          </Button>
          <Button
            variant="danger"
            onClick={() => onConfirm()}
            disabled={disabled}
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
