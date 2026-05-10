import { useState } from "react"
import { BadgeCheck, Ban, Flame, Loader2, Pencil, Send, Trash2, XCircle } from "lucide-react"
import {
  useCancelTransaction,
  useDeleteTransaction,
  useHardDeleteTransaction,
  useRejectTransaction,
  useSubmitTransaction,
  useVerifyTransaction,
} from "@/hooks/useTransactionMutations"
import { useAuthStore } from "@/store/auth"
import { apiErrorMessage } from "@/lib/api"
import type { Transaction } from "@/types/api"
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

interface TransactionActionsProps {
  transaction: Transaction
  onEdit?: () => void
  /** Dipanggil setelah aksi yang menutup detail (delete/hard-delete). */
  onAfterDestroy?: () => void
  /** Dipanggil setelah mutasi yg tidak destruktif (submit/verify/reject/cancel). */
  onAfterMutate?: () => void
}

/**
 * Permission matrix (sesuai rule disepakati):
 *
 *                     | DRAFT | SUBMITTED | VERIFIED | REJECTED | CANCELLED
 * --------------------|-------|-----------|----------|----------|-----------
 * Submit              |  CW   |    -      |    -     |   CW     |    -
 * Verify              |  -    |   ADMIN   |    -     |   -      |    -
 * Reject              |  -    |   ADMIN   |    -     |   -      |    -
 * Cancel              |  -    |    -      |  ADMIN   |   -      |    -
 * Edit                |  CW   |    -      |  SUPER   |   CW     |    -
 * Soft-delete         |  ADM  |   ADMIN   |    -     |  ADMIN   |   ADMIN
 * Hard-delete (god)   |  -    |    -      |  SUPER   |   -      |    -
 *
 * Legend:
 *   CW    = require_can_write (semua role kecuali EXECUTIVE)
 *   ADMIN = SUPERADMIN + CENTRAL_ADMIN (require_admin di backend)
 *   SUPER = SUPERADMIN only (god-mode -- hanya endpoint /hard)
 */
export function TransactionActions({
  transaction,
  onEdit,
  onAfterDestroy,
  onAfterMutate,
}: TransactionActionsProps) {
  const role = useAuthStore((s) => s.user?.role)
  const isSuperAdmin = role === "SUPERADMIN"
  const isAdmin = role === "SUPERADMIN" || role === "CENTRAL_ADMIN"
  const isReadOnly = role === "EXECUTIVE"

  const submit = useSubmitTransaction()
  const verify = useVerifyTransaction()
  const reject = useRejectTransaction()
  const cancel = useCancelTransaction()
  const del = useDeleteTransaction()
  const hardDel = useHardDeleteTransaction()

  type Confirm =
    | null
    | { kind: "submit" | "verify" | "delete" }
    | { kind: "reject"; reason: string }
    | { kind: "cancel"; reason: string }
    | { kind: "hardDelete"; typed: string }
  const [confirm, setConfirm] = useState<Confirm>(null)

  const status = transaction.status
  const id = transaction.id

  const canSubmit = !isReadOnly && (status === "DRAFT" || status === "REJECTED")
  const canVerify = isAdmin && status === "SUBMITTED"
  const canReject = isAdmin && status === "SUBMITTED"
  const canCancel = isAdmin && status === "VERIFIED"

  // Edit: DRAFT/REJECTED utk semua write-capable role; VERIFIED hanya
  // SUPERADMIN (god-mode). Sengaja TIDAK include CENTRAL_ADMIN pada
  // VERIFIED -- audit trail keuangan harus kuat.
  const canEdit =
    (!isReadOnly && (status === "DRAFT" || status === "REJECTED")) ||
    (isSuperAdmin && status === "VERIFIED")

  // Soft-delete: admin only (require_admin), tidak utk VERIFIED (backend
  // akan reject 'verified_must_be_cancelled').
  const canSoftDelete = isAdmin && status !== "VERIFIED"

  // Hard-delete (god-mode): SUPERADMIN only, hanya tampilkan utk
  // VERIFIED supaya tidak duplikat dgn soft-delete biasa.
  const canHardDelete = isSuperAdmin && status === "VERIFIED"

  const isBusy =
    submit.isPending ||
    verify.isPending ||
    reject.isPending ||
    cancel.isPending ||
    del.isPending ||
    hardDel.isPending

  const handleSubmit = async () => {
    try {
      await submit.mutateAsync(id)
      toast.success("Transaksi diajukan untuk validasi")
      setConfirm(null)
      onAfterMutate?.()
    } catch (err) {
      toast.error("Gagal submit", { description: apiErrorMessage(err) })
    }
  }

  const handleVerify = async () => {
    try {
      await verify.mutateAsync(id)
      toast.success("Transaksi tervalidasi")
      setConfirm(null)
      onAfterMutate?.()
    } catch (err) {
      toast.error("Gagal verify", { description: apiErrorMessage(err) })
    }
  }

  const handleReject = async (reason: string) => {
    try {
      await reject.mutateAsync({ id, reason })
      toast.success("Transaksi ditolak", { description: "Pembuat akan menerima notifikasi." })
      setConfirm(null)
      onAfterMutate?.()
    } catch (err) {
      toast.error("Gagal reject", { description: apiErrorMessage(err) })
    }
  }

  const handleCancel = async (reason: string) => {
    try {
      await cancel.mutateAsync({ id, reason })
      toast.success("Transaksi dibatalkan", {
        description: "Status: CANCELLED. Tercatat di audit log.",
      })
      setConfirm(null)
      onAfterMutate?.()
    } catch (err) {
      toast.error("Gagal membatalkan", { description: apiErrorMessage(err) })
    }
  }

  const handleSoftDelete = async () => {
    try {
      await del.mutateAsync(id)
      toast.success("Transaksi dihapus")
      setConfirm(null)
      onAfterDestroy?.()
    } catch (err) {
      toast.error("Gagal menghapus", { description: apiErrorMessage(err) })
    }
  }

  const handleHardDelete = async () => {
    try {
      await hardDel.mutateAsync(id)
      toast.success("Transaksi dihapus permanen", {
        description: "GOD-MODE: alokasi invoice ikut dibersihkan.",
      })
      setConfirm(null)
      onAfterDestroy?.()
    } catch (err) {
      toast.error("Gagal hard-delete", { description: apiErrorMessage(err) })
    }
  }

  const hasAnyAction =
    canSubmit ||
    canVerify ||
    canReject ||
    canCancel ||
    canEdit ||
    canSoftDelete ||
    canHardDelete

  if (!hasAnyAction) return null

  return (
    <>
      {/* Footer aksi: compact mobile (px-3 py-2 + size sm), spacious desktop. */}
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 sm:gap-2 sm:p-4 border-t bg-surface">
        {canSubmit && (
          <Button
            size="sm"
            variant="primary"
            disabled={isBusy}
            onClick={() => setConfirm({ kind: "submit" })}
          >
            <Send className="h-3.5 w-3.5" />
            Ajukan
          </Button>
        )}
        {canVerify && (
          <Button
            size="sm"
            variant="primary"
            disabled={isBusy}
            onClick={() => setConfirm({ kind: "verify" })}
          >
            <BadgeCheck className="h-3.5 w-3.5" />
            Validasi
          </Button>
        )}
        {canReject && (
          <Button
            size="sm"
            variant="outline"
            disabled={isBusy}
            onClick={() => setConfirm({ kind: "reject", reason: "" })}
            className="border-danger-300 text-danger-700 hover:bg-danger-50"
          >
            <XCircle className="h-3.5 w-3.5" />
            Tolak
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
            {status === "VERIFIED" && (
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

      <Dialog open={confirm?.kind === "submit"} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ajukan untuk validasi?</DialogTitle>
            <DialogDescription>
              Setelah diajukan, transaksi tidak bisa diedit sampai admin
              memvalidasi atau menolak. Lanjutkan?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirm(null)}>Batal</Button>
            <Button onClick={handleSubmit} disabled={submit.isPending}>
              {submit.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Ajukan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirm?.kind === "verify"} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Validasi transaksi ini?</DialogTitle>
            <DialogDescription>
              Setelah divalidasi, transaksi akan dihitung di laporan
              keuangan. Tindakan ini tercatat di audit log.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirm(null)}>Batal</Button>
            <Button onClick={handleVerify} disabled={verify.isPending}>
              {verify.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Ya, Validasi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirm?.kind === "reject"} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tolak transaksi</DialogTitle>
            <DialogDescription>
              Berikan alasan singkat. Pembuat transaksi akan melihat catatan
              ini agar bisa memperbaiki dan submit ulang.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={confirm?.kind === "reject" ? confirm.reason : ""}
            onChange={(e) =>
              setConfirm(
                confirm?.kind === "reject" ? { kind: "reject", reason: e.target.value } : confirm,
              )
            }
            rows={3}
            placeholder="Mis. Bukti tidak terbaca, nominal tidak sesuai…"
          />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirm(null)}>Batal</Button>
            <Button
              variant="danger"
              onClick={() => confirm?.kind === "reject" && handleReject(confirm.reason.trim())}
              disabled={reject.isPending || (confirm?.kind === "reject" && !confirm.reason.trim())}
            >
              {reject.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Tolak
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirm?.kind === "cancel"} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Batalkan transaksi tervalidasi?</DialogTitle>
            <DialogDescription>
              Status berubah ke CANCELLED dan tidak dihitung di laporan.
              Transaksi tidak dihapus -- hanya di-archive. Berikan alasan
              untuk audit log.
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
            placeholder="Mis. Salah input nominal, transaksi double, dll."
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
            <DialogTitle>Hapus transaksi?</DialogTitle>
            <DialogDescription>
              Transaksi akan dihapus dari daftar (soft-delete) dan tidak akan
              tampil di laporan. Audit log tetap menyimpan jejaknya.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirm(null)}>Batal</Button>
            <Button onClick={handleSoftDelete} disabled={del.isPending} variant="danger">
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
              Transaksi tervalidasi akan dihapus <strong>permanen dari
              database</strong>. Lampiran ikut terhapus dan alokasi invoice
              yg menunjuk transaksi ini akan dibersihkan otomatis. Audit log
              tetap menyimpan jejak (sebelum-state).
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
                confirm?.kind === "hardDelete" ? { kind: "hardDelete", typed: e.target.value } : confirm,
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
