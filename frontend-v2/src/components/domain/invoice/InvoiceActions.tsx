import { useState } from "react"
import {
  Ban,
  CheckCircle2,
  Flame,
  Link2,
  Loader2,
  Pencil,
  Printer,
  Send,
  Trash2,
} from "lucide-react"
import { AllocationManager } from "./AllocationManager"
import { PrintPdfDialog } from "@/components/domain/shared/PrintPdfDialog"
import {
  useCancelInvoice,
  useDeleteInvoice,
  useHardDeleteInvoice,
  useIssueInvoice,
  useMarkPaidInvoice,
} from "@/hooks/useInvoiceMutations"
import { useAuthStore } from "@/store/auth"
import { apiErrorMessage } from "@/lib/api"
import type { Invoice } from "@/types/api"
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
import { toast } from "@/components/ui/sonner"

interface InvoiceActionsProps {
  invoice: Invoice
  onEdit?: () => void
  onAfterDestroy?: () => void
  onAfterMutate?: () => void
  /** Default nama penanggung jawab TTD (dr company.director_name). */
  companyDirectorName?: string | null
}

/**
 * Permission matrix invoice (sesuai rule: dokumen sudah PAID/CANCELLED
 * = audit kuat, hanya SUPERADMIN bisa modifikasi):
 *
 *                     | DRAFT | ISSUED | PARTIALLY_PAID | PAID  | CANCELLED | OVERDUE
 * --------------------|-------|--------|----------------|-------|-----------|--------
 * Issue (DRAFT->ISS)  |  CW   |   -    |      -         |  -    |     -     |   -
 * Mark-Paid manual    |  -    | ADMIN  |    ADMIN       |  -    |     -     | ADMIN
 * Cancel              |  -    | ADMIN  |    ADMIN       |  -    |     -     | ADMIN
 * Cetak PDF           |  ALL  |  ALL   |    ALL         | ALL   |   ALL     |  ALL
 * Edit                |  CW   |   CW   |     CW         | SUPER |     -     |   CW
 * Soft-delete         | ADMIN | ADMIN  |    ADMIN       |  -    |   ADMIN   |  ADMIN
 * Hard-delete (god)   |  -    |   -    |      -         | SUPER | SUPER     |   -
 *
 * Legend:
 *   ALL   = read-only oke (cetak PDF tidak ubah data)
 *   CW    = role !== EXECUTIVE (require_can_write)
 *   ADMIN = SUPERADMIN | CENTRAL_ADMIN
 *   SUPER = SUPERADMIN only (god-mode)
 */
export function InvoiceActions({
  invoice,
  onEdit,
  onAfterDestroy,
  onAfterMutate,
  companyDirectorName,
}: InvoiceActionsProps) {
  const role = useAuthStore((s) => s.user?.role)
  const isSuperAdmin = role === "SUPERADMIN"
  const isAdmin = role === "SUPERADMIN" || role === "CENTRAL_ADMIN"
  const isReadOnly = role === "EXECUTIVE"

  const issue = useIssueInvoice()
  const markPaid = useMarkPaidInvoice()
  const cancel = useCancelInvoice()
  const del = useDeleteInvoice()
  const hardDel = useHardDeleteInvoice()

  type Confirm =
    | null
    | { kind: "issue" | "markPaid" | "cancel" | "delete" }
    | { kind: "hardDelete"; typed: string }
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [allocOpen, setAllocOpen] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)

  const status = invoice.status
  const id = invoice.id

  const canIssue = !isReadOnly && status === "DRAFT"
  const canMarkPaid =
    isAdmin && (status === "ISSUED" || status === "PARTIALLY_PAID" || status === "OVERDUE")
  const canCancel =
    isAdmin && (status === "ISSUED" || status === "PARTIALLY_PAID" || status === "OVERDUE")

  // Sambungkan pembayaran: butuh write, status outstanding, dan masih ada sisa
  const remaining = Number(invoice.outstanding_amount ?? invoice.remaining ?? 0)
  const canAllocate =
    !isReadOnly &&
    remaining > 0 &&
    (status === "ISSUED" || status === "PARTIALLY_PAID" || status === "OVERDUE")

  // Edit DRAFT/ISSUED/PARTIALLY_PAID/OVERDUE: write-capable
  // Edit PAID: SUPERADMIN only (audit-kuat)
  // Edit CANCELLED: tidak boleh
  const canEdit =
    (!isReadOnly && (status === "DRAFT" || status === "ISSUED" || status === "PARTIALLY_PAID" || status === "OVERDUE")) ||
    (isSuperAdmin && status === "PAID")

  // Soft-delete: admin, semua status kecuali PAID
  const canSoftDelete = isAdmin && status !== "PAID"
  // Hard-delete (god-mode): SUPERADMIN, hanya utk PAID atau CANCELLED
  // (status closed) supaya tidak duplikat dgn soft-delete biasa
  const canHardDelete =
    isSuperAdmin && (status === "PAID" || status === "CANCELLED")

  // Cetak PDF: selalu boleh karena invoice yang sampai ke FE pasti aktif
  // (backend list/get filter deleted_at.is_(None)). Read-only, tidak peduli
  // status atau role.
  const canPrint = true

  const isBusy =
    issue.isPending ||
    markPaid.isPending ||
    cancel.isPending ||
    del.isPending ||
    hardDel.isPending

  const handleIssue = async () => {
    try {
      await issue.mutateAsync(id)
      toast.success("Invoice diterbitkan", {
        description: "Status berubah ke ISSUED.",
      })
      setConfirm(null)
      onAfterMutate?.()
    } catch (err) {
      toast.error("Gagal terbitkan invoice", { description: apiErrorMessage(err) })
    }
  }

  const handleMarkPaid = async () => {
    try {
      await markPaid.mutateAsync(id)
      toast.success("Invoice ditandai lunas")
      setConfirm(null)
      onAfterMutate?.()
    } catch (err) {
      toast.error("Gagal mark paid", { description: apiErrorMessage(err) })
    }
  }

  const handleCancel = async () => {
    try {
      await cancel.mutateAsync(id)
      toast.success("Invoice dibatalkan", {
        description: "Status: CANCELLED. Tercatat di audit log.",
      })
      setConfirm(null)
      onAfterMutate?.()
    } catch (err) {
      toast.error("Gagal membatalkan invoice", { description: apiErrorMessage(err) })
    }
  }

  const handleDelete = async () => {
    try {
      await del.mutateAsync(id)
      toast.success("Invoice dihapus")
      setConfirm(null)
      onAfterDestroy?.()
    } catch (err) {
      toast.error("Gagal menghapus invoice", { description: apiErrorMessage(err) })
    }
  }

  const handleHardDelete = async () => {
    try {
      await hardDel.mutateAsync(id)
      toast.success("Invoice dihapus permanen", {
        description: "GOD-MODE: alokasi pembayaran ikut dibersihkan.",
      })
      setConfirm(null)
      onAfterDestroy?.()
    } catch (err) {
      toast.error("Gagal hard-delete", { description: apiErrorMessage(err) })
    }
  }

  const hasAny =
    canIssue ||
    canMarkPaid ||
    canCancel ||
    canAllocate ||
    canEdit ||
    canPrint ||
    canSoftDelete ||
    canHardDelete

  if (!hasAny) return null

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 sm:gap-2 sm:p-4 border-t bg-surface">
        {canIssue && (
          <Button
            size="sm"
            variant="primary"
            disabled={isBusy}
            onClick={() => setConfirm({ kind: "issue" })}
          >
            <Send className="h-3.5 w-3.5" />
            Terbitkan
          </Button>
        )}
        {canMarkPaid && (
          <Button
            size="sm"
            variant="primary"
            disabled={isBusy}
            onClick={() => setConfirm({ kind: "markPaid" })}
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Tandai Lunas
          </Button>
        )}
        {canAllocate && (
          <Button
            size="sm"
            variant="primary"
            disabled={isBusy}
            onClick={() => setAllocOpen(true)}
            className="bg-success-500 hover:bg-success-600 active:bg-success-700"
          >
            <Link2 className="h-3.5 w-3.5" />
            Sambungkan
          </Button>
        )}
        {canCancel && (
          <Button
            size="sm"
            variant="outline"
            disabled={isBusy}
            onClick={() => setConfirm({ kind: "cancel" })}
            className="border-warning-300 text-warning-700 hover:bg-warning-50"
          >
            <Ban className="h-3.5 w-3.5" />
            Batalkan
          </Button>
        )}
        {canPrint && (
          <Button
            size="sm"
            variant="secondary"
            disabled={isBusy}
            onClick={() => setPrintOpen(true)}
          >
            <Printer className="h-3.5 w-3.5" />
            Cetak PDF
          </Button>
        )}
        {canEdit && onEdit && (
          <Button size="sm" variant="secondary" onClick={onEdit} disabled={isBusy}>
            <Pencil className="h-3.5 w-3.5" />
            Edit
            {status === "PAID" && (
              <span className="ml-1 rounded bg-warning-100 text-warning-700 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider leading-none">
                God
              </span>
            )}
          </Button>
        )}
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

      {/* Issue confirm */}
      <Dialog open={confirm?.kind === "issue"} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Terbitkan invoice ini?</DialogTitle>
            <DialogDescription>
              Status berubah dari DRAFT ke ISSUED. Setelah terbit, invoice
              dapat di-bayar dan akan masuk laporan piutang/hutang.
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

      {/* Mark paid confirm */}
      <Dialog open={confirm?.kind === "markPaid"} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tandai lunas manual?</DialogTitle>
            <DialogDescription>
              Status invoice akan langsung jadi PAID tanpa membuat alokasi
              transaksi. Gunakan ini untuk skenario seperti settlement non-kas
              atau koreksi data lama. Tindakan tercatat di audit log.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirm(null)}>Batal</Button>
            <Button onClick={handleMarkPaid} disabled={markPaid.isPending}>
              {markPaid.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Ya, Tandai Lunas
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel confirm */}
      <Dialog open={confirm?.kind === "cancel"} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Batalkan invoice?</DialogTitle>
            <DialogDescription>
              Status berubah ke CANCELLED. Invoice tidak dihitung di laporan
              piutang/hutang lagi. Alokasi pembayaran yang sudah ada tetap
              tersimpan untuk audit.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirm(null)}>Tidak</Button>
            <Button variant="danger" onClick={handleCancel} disabled={cancel.isPending}>
              {cancel.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Ya, Batalkan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Soft-delete confirm */}
      <Dialog open={confirm?.kind === "delete"} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hapus invoice?</DialogTitle>
            <DialogDescription>
              Invoice akan dihapus dari daftar (soft-delete). Audit log tetap
              menyimpan jejak.
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

      {/* Hard-delete confirm */}
      <Dialog open={confirm?.kind === "hardDelete"} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-danger-700">
              <Flame className="inline h-4 w-4 mr-1" />
              Hapus PERMANEN (God-mode)
            </DialogTitle>
            <DialogDescription>
              Invoice akan dihapus <strong>permanen dari database</strong>
              beserta items, lampiran, dan SEMUA alokasi pembayaran (transaksi
              yg menunjuk invoice ini akan di-unlink, tetapi transaksi-nya
              sendiri tidak terhapus).
              <br /><br />
              Tindakan ini <strong>tidak bisa dibatalkan</strong>. Ketik
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

      <AllocationManager
        open={allocOpen}
        onClose={() => setAllocOpen(false)}
        invoice={invoice}
        onApplied={() => onAfterMutate?.()}
      />

      <PrintPdfDialog
        open={printOpen}
        onClose={() => setPrintOpen(false)}
        pdfPath={`/invoices/${id}/pdf`}
        defaultResponsibleName={companyDirectorName ?? undefined}
        documentLabel={`Invoice ${invoice.number}`}
      />
    </>
  )
}
