import { useState } from "react"
import { BadgeCheck, Loader2, Send, XCircle, Pencil, Trash2 } from "lucide-react"
import {
  useSubmitTransaction,
  useVerifyTransaction,
  useRejectTransaction,
  useDeleteTransaction,
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
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/sonner"

interface TransactionActionsProps {
  transaction: Transaction
  onEdit?: () => void
  onAfterMutate?: () => void
}

export function TransactionActions({
  transaction,
  onEdit,
  onAfterMutate,
}: TransactionActionsProps) {
  const role = useAuthStore((s) => s.user?.role)
  const isVerifier = role === "SUPERADMIN" || role === "CENTRAL_ADMIN"

  const submit = useSubmitTransaction()
  const verify = useVerifyTransaction()
  const reject = useRejectTransaction()
  const del = useDeleteTransaction()
  const [confirm, setConfirm] = useState<
    | null
    | { kind: "submit" | "verify" | "delete" }
    | { kind: "reject"; reason: string }
  >(null)

  const status = transaction.status
  const id = transaction.id

  const canSubmit = status === "DRAFT" || status === "REJECTED"
  const canVerify = status === "SUBMITTED" && isVerifier
  const canReject = status === "SUBMITTED" && isVerifier
  const canEdit = status === "DRAFT" || status === "REJECTED" || (status === "VERIFIED" && isVerifier)
  const canDelete = status !== "VERIFIED" || isVerifier

  const isBusy =
    submit.isPending || verify.isPending || reject.isPending || del.isPending

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

  const handleDelete = async () => {
    try {
      await del.mutateAsync(id)
      toast.success("Transaksi dihapus")
      setConfirm(null)
      onAfterMutate?.()
    } catch (err) {
      toast.error("Gagal menghapus", { description: apiErrorMessage(err) })
    }
  }

  return (
    <>
      <div className="flex flex-wrap gap-2 p-5 border-t bg-surface">
        {canSubmit && (
          <Button
            variant="primary"
            disabled={isBusy}
            onClick={() => setConfirm({ kind: "submit" })}
          >
            <Send className="h-4 w-4" />
            Ajukan Validasi
          </Button>
        )}
        {canVerify && (
          <Button
            variant="primary"
            disabled={isBusy}
            onClick={() => setConfirm({ kind: "verify" })}
          >
            <BadgeCheck className="h-4 w-4" />
            Validasi
          </Button>
        )}
        {canReject && (
          <Button
            variant="outline"
            disabled={isBusy}
            onClick={() => setConfirm({ kind: "reject", reason: "" })}
            className="border-danger-300 text-danger-700 hover:bg-danger-50"
          >
            <XCircle className="h-4 w-4" />
            Tolak
          </Button>
        )}
        {canEdit && onEdit && (
          <Button variant="secondary" onClick={onEdit} disabled={isBusy}>
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
        )}
        {canDelete && (
          <Button
            variant="ghost"
            disabled={isBusy}
            onClick={() => setConfirm({ kind: "delete" })}
            className="text-danger-600 hover:bg-danger-50 hover:text-danger-700 ml-auto"
          >
            <Trash2 className="h-4 w-4" />
            Hapus
          </Button>
        )}
      </div>

      {/* Submit confirm */}
      <Dialog
        open={confirm?.kind === "submit"}
        onOpenChange={(o) => !o && setConfirm(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ajukan untuk validasi?</DialogTitle>
            <DialogDescription>
              Setelah diajukan, transaksi tidak bisa diedit sampai admin
              memvalidasi atau menolak. Lanjutkan?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Batal
            </Button>
            <Button onClick={handleSubmit} disabled={submit.isPending}>
              {submit.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Ajukan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Verify confirm */}
      <Dialog
        open={confirm?.kind === "verify"}
        onOpenChange={(o) => !o && setConfirm(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Validasi transaksi ini?</DialogTitle>
            <DialogDescription>
              Setelah divalidasi, transaksi akan dihitung di laporan
              keuangan. Tindakan ini tercatat di audit log.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Batal
            </Button>
            <Button onClick={handleVerify} disabled={verify.isPending}>
              {verify.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Ya, Validasi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject confirm w/ reason */}
      <Dialog
        open={confirm?.kind === "reject"}
        onOpenChange={(o) => !o && setConfirm(null)}
      >
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
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Batal
            </Button>
            <Button
              onClick={() =>
                confirm?.kind === "reject" && handleReject(confirm.reason.trim())
              }
              disabled={
                reject.isPending ||
                (confirm?.kind === "reject" && !confirm.reason.trim())
              }
              variant="danger"
            >
              {reject.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Tolak
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog
        open={confirm?.kind === "delete"}
        onOpenChange={(o) => !o && setConfirm(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hapus transaksi?</DialogTitle>
            <DialogDescription>
              Transaksi akan dihapus dari daftar (soft-delete) dan tidak akan
              tampil di laporan. Audit log tetap menyimpan jejaknya.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Batal
            </Button>
            <Button onClick={handleDelete} disabled={del.isPending} variant="danger">
              {del.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Ya, Hapus
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
