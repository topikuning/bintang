import { useState } from "react"
import {
  Ban,
  BadgeCheck,
  Download,
  Flame,
  Loader2,
  Pencil,
  Send,
  Trash2,
} from "lucide-react"
import {
  useApprovePO,
  useCancelPO,
  useDeletePO,
  useHardDeletePO,
  useIssuePO,
} from "@/hooks/usePOMutations"
import { useAuthStore } from "@/store/auth"
import { apiErrorMessage } from "@/lib/api"
import type { PurchaseOrder } from "@/types/api"
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
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/sonner"

interface POActionsProps {
  po: PurchaseOrder
  onEdit?: () => void
  onAfterDestroy?: () => void
  onAfterMutate?: () => void
}

/**
 * Permission matrix PO:
 *                | DRAFT | ISSUED | APPROVED | CANCELLED
 * ---------------|-------|--------|----------|------------
 * Issue          |  CW   |   -    |    -     |    -
 * Approve        | ADMIN | ADMIN  |    -     |    -
 * Cancel         | ADMIN | ADMIN  |  ADMIN   |    -
 * Edit           |  CW   | ADMIN  |  SUPER   |    -
 * Soft-delete    | ADMIN | ADMIN  |    -     |   ADMIN
 * Hard-delete    |   -   |   -    | SUPER    |   SUPER
 *
 * Cetak PDF: semua role yang punya akses (read-only juga boleh).
 */
export function POActions({ po, onEdit, onAfterDestroy, onAfterMutate }: POActionsProps) {
  const role = useAuthStore((s) => s.user?.role)
  const isSuperAdmin = role === "SUPERADMIN"
  const isAdmin = role === "SUPERADMIN" || role === "CENTRAL_ADMIN"
  const isReadOnly = role === "EXECUTIVE"

  const issue = useIssuePO()
  const approve = useApprovePO()
  const cancel = useCancelPO()
  const del = useDeletePO()
  const hardDel = useHardDeletePO()

  type Confirm =
    | null
    | { kind: "issue" | "approve" | "delete" }
    | { kind: "cancel"; reason: string }
    | { kind: "hardDelete"; typed: string }
  const [confirm, setConfirm] = useState<Confirm>(null)

  const status = po.status
  const id = po.id

  const canIssue = !isReadOnly && status === "DRAFT"
  const canApprove = isAdmin && (status === "DRAFT" || status === "ISSUED")
  const canCancel = isAdmin && status !== "CANCELLED"
  const canEdit =
    (status === "DRAFT" && !isReadOnly) ||
    (status === "ISSUED" && isAdmin) ||
    (status === "APPROVED" && isSuperAdmin)
  const canSoftDelete = isAdmin && status !== "APPROVED"
  const canHardDelete = isSuperAdmin && (status === "APPROVED" || status === "CANCELLED")

  const isBusy =
    issue.isPending ||
    approve.isPending ||
    cancel.isPending ||
    del.isPending ||
    hardDel.isPending

  const handleIssue = async () => {
    try {
      await issue.mutateAsync(id)
      toast.success("PO diterbitkan")
      setConfirm(null)
      onAfterMutate?.()
    } catch (err) {
      toast.error("Gagal terbitkan PO", { description: apiErrorMessage(err) })
    }
  }
  const handleApprove = async () => {
    try {
      await approve.mutateAsync(id)
      toast.success("PO disetujui")
      setConfirm(null)
      onAfterMutate?.()
    } catch (err) {
      toast.error("Gagal approve", { description: apiErrorMessage(err) })
    }
  }
  const handleCancel = async (reason: string) => {
    try {
      await cancel.mutateAsync({ id, reason })
      toast.success("PO dibatalkan")
      setConfirm(null)
      onAfterMutate?.()
    } catch (err) {
      toast.error("Gagal cancel", { description: apiErrorMessage(err) })
    }
  }
  const handleDelete = async () => {
    try {
      await del.mutateAsync(id)
      toast.success("PO dihapus")
      setConfirm(null)
      onAfterDestroy?.()
    } catch (err) {
      toast.error("Gagal hapus", { description: apiErrorMessage(err) })
    }
  }
  const handleHardDelete = async () => {
    try {
      await hardDel.mutateAsync(id)
      toast.success("PO dihapus permanen")
      setConfirm(null)
      onAfterDestroy?.()
    } catch (err) {
      toast.error("Gagal hard-delete", { description: apiErrorMessage(err) })
    }
  }

  const hasAny =
    canIssue || canApprove || canCancel || canEdit || canSoftDelete || canHardDelete

  // PDF download tersedia utk semua role
  const apiBase = import.meta.env.VITE_API_BASE_URL || "/api/v1"
  const pdfUrl = `${apiBase}/purchase-orders/${id}/pdf`

  if (!hasAny) {
    return (
      <div className="flex items-center px-3 py-2 sm:p-4 border-t bg-surface">
        <Button asChild size="sm" variant="secondary">
          <a href={pdfUrl} target="_blank" rel="noopener noreferrer">
            <Download className="h-3.5 w-3.5" />
            Cetak PDF
          </a>
        </Button>
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 sm:gap-2 sm:p-4 border-t bg-surface">
        {canIssue && (
          <Button size="sm" variant="primary" disabled={isBusy} onClick={() => setConfirm({ kind: "issue" })}>
            <Send className="h-3.5 w-3.5" />
            Terbitkan
          </Button>
        )}
        {canApprove && (
          <Button size="sm" variant="primary" disabled={isBusy} onClick={() => setConfirm({ kind: "approve" })}>
            <BadgeCheck className="h-3.5 w-3.5" />
            Setujui
          </Button>
        )}
        {canCancel && (
          <Button
            size="sm"
            variant="outline"
            disabled={isBusy}
            onClick={() => setConfirm({ kind: "cancel", reason: "" })}
            className="border-warning-300 text-warning-700 hover:bg-warning-50"
          >
            <Ban className="h-3.5 w-3.5" />
            Batalkan
          </Button>
        )}
        {canEdit && onEdit && (
          <Button size="sm" variant="secondary" onClick={onEdit} disabled={isBusy}>
            <Pencil className="h-3.5 w-3.5" />
            Edit
            {status === "APPROVED" && (
              <span className="ml-1 rounded bg-warning-100 text-warning-700 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider leading-none">
                God
              </span>
            )}
          </Button>
        )}
        <Button asChild size="sm" variant="ghost">
          <a href={pdfUrl} target="_blank" rel="noopener noreferrer">
            <Download className="h-3.5 w-3.5" />
            PDF
          </a>
        </Button>
        {canSoftDelete && (
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={isBusy}
            onClick={() => setConfirm({ kind: "delete" })}
            className="text-danger-600 hover:bg-danger-50 hover:text-danger-700 ml-auto"
            aria-label="Hapus"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
        {canHardDelete && (
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={isBusy}
            onClick={() => setConfirm({ kind: "hardDelete", typed: "" })}
            className="text-danger-700 hover:bg-danger-100 ml-auto"
            aria-label="Hapus Permanen"
          >
            <Flame className="h-4 w-4" />
          </Button>
        )}
      </div>

      <Dialog open={confirm?.kind === "issue"} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Terbitkan PO?</DialogTitle>
            <DialogDescription>
              Status berubah dari DRAFT ke ISSUED. Setelah terbit, hanya admin
              yang bisa edit lebih lanjut.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirm(null)}>Batal</Button>
            <Button onClick={handleIssue} disabled={issue.isPending}>
              {issue.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Terbitkan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirm?.kind === "approve"} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Setujui PO ini?</DialogTitle>
            <DialogDescription>
              Status APPROVED -- final dan terkunci. Hanya SUPERADMIN yang
              dapat edit setelah ini. Tindakan tercatat di audit log.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirm(null)}>Batal</Button>
            <Button onClick={handleApprove} disabled={approve.isPending}>
              {approve.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Ya, Setujui
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirm?.kind === "cancel"} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Batalkan PO?</DialogTitle>
            <DialogDescription>
              Status berubah ke CANCELLED. Berikan alasan untuk audit log.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={confirm?.kind === "cancel" ? confirm.reason : ""}
            onChange={(e) =>
              setConfirm(
                confirm?.kind === "cancel" ? { kind: "cancel", reason: e.target.value } : confirm,
              )
            }
            rows={3}
            placeholder="Mis. Vendor membatalkan, perubahan spesifikasi…"
          />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirm(null)}>Tidak</Button>
            <Button
              variant="danger"
              onClick={() => confirm?.kind === "cancel" && handleCancel(confirm.reason.trim())}
              disabled={cancel.isPending || (confirm?.kind === "cancel" && !confirm.reason.trim())}
            >
              {cancel.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Ya, Batalkan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirm?.kind === "delete"} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hapus PO?</DialogTitle>
            <DialogDescription>
              PO akan dihapus dari daftar (soft-delete). Audit log tetap menyimpan jejak.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirm(null)}>Batal</Button>
            <Button variant="danger" onClick={handleDelete} disabled={del.isPending}>
              {del.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Ya, Hapus
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirm?.kind === "hardDelete"} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-danger-700">
              <Flame className="inline h-4 w-4 mr-1" />
              Hapus PERMANEN (God-mode)
            </DialogTitle>
            <DialogDescription>
              PO + items akan dihapus <strong>permanen dari database</strong>.
              Tindakan tidak bisa dibatalkan. Ketik
              <span className="font-mono font-bold mx-1">HAPUS</span> untuk
              konfirmasi.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="Ketik HAPUS"
            value={confirm?.kind === "hardDelete" ? confirm.typed : ""}
            onChange={(e) =>
              setConfirm(
                confirm?.kind === "hardDelete"
                  ? { kind: "hardDelete", typed: e.target.value }
                  : confirm,
              )
            }
            className="font-mono"
          />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirm(null)}>Batal</Button>
            <Button
              variant="danger"
              onClick={handleHardDelete}
              disabled={
                hardDel.isPending ||
                (confirm?.kind === "hardDelete" && confirm.typed !== "HAPUS")
              }
            >
              {hardDel.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Hapus Permanen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
