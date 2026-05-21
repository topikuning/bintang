import { useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Loader2,
  Pencil,
  Trash2,
  XCircle,
} from "lucide-react"
import {
  useApproveCashRequest,
  useCancelCashRequest,
  useCashRequest,
  useDeleteCashRequest,
  useRejectCashRequest,
} from "@/hooks/useCashRequests"
import { usePageTitle } from "@/hooks/usePageTitle"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "@/components/ui/sonner"
import { ErrorState } from "@/components/data/ErrorState"
import { CashRequestFormSheet } from "@/components/domain/cash-request/CashRequestFormSheet"
import { fmtIDR } from "@/lib/format"
import { apiErrorMessage } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import type { CashRequestStatus } from "@/types/api"

const STATUS_LABEL: Record<CashRequestStatus, string> = {
  PENDING: "Menunggu Approval",
  APPROVED: "Disetujui",
  REJECTED: "Ditolak",
  CANCELLED: "Dibatalkan",
}

function StatusPill({ status }: { status: CashRequestStatus }) {
  const map = {
    PENDING: {
      bg: "bg-warning-100",
      text: "text-warning-800",
      Icon: Clock,
    },
    APPROVED: {
      bg: "bg-success-100",
      text: "text-success-800",
      Icon: CheckCircle2,
    },
    REJECTED: {
      bg: "bg-danger-100",
      text: "text-danger-800",
      Icon: XCircle,
    },
    CANCELLED: {
      bg: "bg-ink-100",
      text: "text-ink-600",
      Icon: XCircle,
    },
  }[status]
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold ${map.bg} ${map.text}`}
    >
      <map.Icon className="h-3.5 w-3.5" />
      {STATUS_LABEL[status]}
    </span>
  )
}

export function CashRequestDetailPage() {
  const { id } = useParams<{ id: string }>()
  const cid = Number(id)
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const canApprove =
    user?.role === "CENTRAL_ADMIN" || user?.role === "SUPERADMIN"

  const query = useCashRequest(Number.isFinite(cid) ? cid : null)
  const cr = query.data
  usePageTitle(cr ? `${cr.number} — Pengajuan Dana` : "Pengajuan Dana")

  const approveMut = useApproveCashRequest()
  const rejectMut = useRejectCashRequest()
  const cancelMut = useCancelCashRequest()
  const deleteMut = useDeleteCashRequest()

  const [rejectOpen, setRejectOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [editOpen, setEditOpen] = useState(false)

  if (query.isLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-3">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    )
  }
  if (query.error || !cr) {
    return (
      <div className="p-4 sm:p-6">
        <ErrorState
          description={
            query.error
              ? apiErrorMessage(query.error)
              : "Pengajuan tidak ditemukan."
          }
          onRetry={() => query.refetch()}
        />
        <Button
          variant="ghost"
          onClick={() => navigate("/cash-requests")}
          className="mt-3"
        >
          <ArrowLeft className="h-4 w-4" /> Kembali
        </Button>
      </div>
    )
  }

  const isPending = cr.status === "PENDING"
  const isOwner = user?.id === cr.requester_id
  const canEdit = isPending && (isOwner || canApprove)
  const canCancel = isPending && (isOwner || canApprove)
  const canDelete = isPending && (isOwner || canApprove)

  const handleApprove = async () => {
    if (!confirm(
      `Approve pengajuan ${cr.number} senilai Rp ${fmtIDR(cr.total_amount)}?\n\n` +
      "Sistem akan otomatis membuat transaksi Dana Operasional (DRAFT) yang siap " +
      "di-verifikasi saat dana ditransfer."
    )) return
    try {
      await approveMut.mutateAsync(cr.id)
      toast.success("Pengajuan disetujui", {
        description: "Transaksi DRAFT dibuat, verify saat dana ditransfer.",
      })
    } catch (err) {
      toast.error("Gagal approve", { description: apiErrorMessage(err) })
    }
  }

  const handleReject = async () => {
    if (!reason.trim()) {
      toast.error("Alasan penolakan wajib diisi")
      return
    }
    try {
      await rejectMut.mutateAsync({ id: cr.id, reason: reason.trim() })
      toast.success("Pengajuan ditolak")
      setRejectOpen(false)
      setReason("")
    } catch (err) {
      toast.error("Gagal reject", { description: apiErrorMessage(err) })
    }
  }

  const handleCancel = async () => {
    try {
      await cancelMut.mutateAsync({
        id: cr.id,
        reason: reason.trim() || undefined,
      })
      toast.success("Pengajuan dibatalkan")
      setCancelOpen(false)
      setReason("")
    } catch (err) {
      toast.error("Gagal cancel", { description: apiErrorMessage(err) })
    }
  }

  const handleDelete = async () => {
    try {
      await deleteMut.mutateAsync(cr.id)
      toast.success("Pengajuan dihapus")
      navigate("/cash-requests")
    } catch (err) {
      toast.error("Gagal hapus", { description: apiErrorMessage(err) })
    }
  }

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-5 lg:p-6">
      {/* Back + actions */}
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" onClick={() => navigate("/cash-requests")} className="shrink-0">
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Kembali</span>
        </Button>
        <div className="flex gap-2">
          {canEdit && (
            <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" />
              <span className="hidden sm:inline">Edit</span>
            </Button>
          )}
          {canDelete && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeleteOpen(true)}
              className="text-danger-600 hover:bg-danger-50"
            >
              <Trash2 className="h-4 w-4" />
              <span className="hidden sm:inline">Hapus</span>
            </Button>
          )}
        </div>
      </div>

      {/* Header */}
      <div className="rounded-md border bg-surface p-4 sm:p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-ink-500 shrink-0" />
              <h1 className="text-xl font-bold text-ink-900 sm:text-2xl truncate">
                {cr.title}
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-500">
              <span className="font-mono font-semibold">{cr.number}</span>
              <span>·</span>
              <span>{cr.request_date}</span>
              <span>·</span>
              <Link
                to={`/projects/${cr.project_id}`}
                className="hover:text-brand-600 hover:underline"
              >
                {cr.project_code} — {cr.project_name}
              </Link>
            </div>
          </div>
          <div className="flex flex-col items-start sm:items-end gap-1 shrink-0">
            <StatusPill status={cr.status} />
            <span className="font-mono text-lg font-bold text-brand-900">
              Rp {fmtIDR(cr.total_amount)}
            </span>
          </div>
        </div>

        {/* Meta grid */}
        <div className="mt-4 grid grid-cols-1 gap-3 border-t pt-4 sm:grid-cols-2 lg:grid-cols-4">
          <Meta label="Pengaju">{cr.requester_name}</Meta>
          <Meta label="Penerima Dana">
            {cr.recipient_name && cr.recipient_name !== cr.requester_name
              ? cr.recipient_name
              : `${cr.requester_name} (sendiri)`}
          </Meta>
          {cr.approved_by_name && (
            <Meta label="Disetujui oleh">
              <div className="text-[13px]">{cr.approved_by_name}</div>
              <div className="text-[11px] text-ink-500">
                {cr.approved_at &&
                  new Date(cr.approved_at).toLocaleString("id-ID")}
              </div>
            </Meta>
          )}
          {cr.rejected_by_name && (
            <Meta label="Ditolak oleh">
              <div className="text-[13px]">{cr.rejected_by_name}</div>
              <div className="text-[11px] text-ink-500">
                {cr.rejected_at &&
                  new Date(cr.rejected_at).toLocaleString("id-ID")}
              </div>
            </Meta>
          )}
        </div>

        {cr.notes && (
          <div className="mt-3 rounded bg-ink-50 px-3 py-2 text-[13px] text-ink-700">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
              Catatan
            </span>
            <div className="mt-1 whitespace-pre-wrap">{cr.notes}</div>
          </div>
        )}

        {cr.rejection_reason && (
          <div className="mt-3 rounded border border-danger-300 bg-danger-50 px-3 py-2 text-[13px] text-danger-800">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-danger-700">
              {cr.status === "REJECTED" ? "Alasan Penolakan" : "Alasan Pembatalan"}
            </span>
            <div className="mt-1 whitespace-pre-wrap">{cr.rejection_reason}</div>
          </div>
        )}

        {cr.disbursement_tx_id && (
          <div className="mt-3 flex items-center justify-between rounded border border-success-300 bg-success-50 px-3 py-2">
            <div className="text-[13px] text-success-800">
              <strong>Transaksi pencairan:</strong> dana operasional DRAFT
              sudah dibuat, verify saat ditransfer.
            </div>
            <Link
              to={`/transactions?id=${cr.disbursement_tx_id}`}
              className="inline-flex items-center gap-1 rounded bg-success-600 px-2 py-1 text-[12px] font-medium text-white hover:bg-success-700"
            >
              <ExternalLink className="h-3 w-3" />
              Buka Tx
            </Link>
          </div>
        )}
      </div>

      {/* Items */}
      <div className="rounded-md border bg-surface">
        <div className="border-b px-4 py-2.5">
          <h2 className="text-[13px] font-semibold text-ink-800 uppercase tracking-wider">
            Rincian Belanja
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-[11px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="text-left px-3 py-2 w-10">#</th>
                <th className="text-left px-3 py-2">Deskripsi</th>
                <th className="text-left px-3 py-2 w-32">Kategori</th>
                <th className="text-right px-3 py-2 w-20">Qty</th>
                <th className="text-right px-3 py-2 w-32">Harga Satuan</th>
                <th className="text-right px-3 py-2 w-36">Total</th>
              </tr>
            </thead>
            <tbody>
              {cr.items.map((it, idx) => (
                <tr key={it.id} className="border-t">
                  <td className="px-3 py-2 text-ink-500">{idx + 1}</td>
                  <td className="px-3 py-2">{it.description}</td>
                  <td className="px-3 py-2 text-ink-600 text-[12px]">
                    {it.category_name ?? <span className="text-ink-400">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-600">
                    {it.quantity ? fmtIDR(it.quantity) : <span className="text-ink-400">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-600">
                    {it.unit_price ? `Rp ${fmtIDR(it.unit_price)}` : <span className="text-ink-400">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">
                    Rp {fmtIDR(it.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t bg-brand-50">
                <td colSpan={5} className="px-3 py-2.5 text-right font-semibold text-brand-800">
                  TOTAL
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums font-bold text-brand-900">
                  Rp {fmtIDR(cr.total_amount)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Action bar */}
      {isPending && (
        <div className="sticky bottom-0 flex flex-wrap gap-2 rounded-md border bg-surface px-4 py-3 shadow-sm pb-safe">
          {canApprove && (
            <>
              <Button
                onClick={handleApprove}
                disabled={approveMut.isPending}
                className="flex-1 sm:flex-initial"
              >
                {approveMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                <CheckCircle2 className="h-4 w-4" />
                Setujui
              </Button>
              <Button
                variant="danger"
                onClick={() => setRejectOpen(true)}
                className="flex-1 sm:flex-initial"
              >
                <XCircle className="h-4 w-4" />
                Tolak
              </Button>
            </>
          )}
          {canCancel && (
            <Button
              variant="ghost"
              onClick={() => setCancelOpen(true)}
              className="text-ink-600"
            >
              Batalkan Pengajuan
            </Button>
          )}
        </div>
      )}

      {/* Reject dialog */}
      <Dialog open={rejectOpen} onOpenChange={(v) => !v && setRejectOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tolak Pengajuan</DialogTitle>
            <DialogDescription>
              {cr.number} — Rp {fmtIDR(cr.total_amount)}. Berikan alasan
              penolakan supaya pengaju paham apa yang perlu diperbaiki.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Mis. Anggaran sedang ketat — pending sampai minggu depan."
            rows={3}
            autoFocus
          />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRejectOpen(false)}>
              Batal
            </Button>
            <Button
              variant="danger"
              onClick={handleReject}
              disabled={rejectMut.isPending}
            >
              {rejectMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Tolak
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel dialog */}
      <Dialog open={cancelOpen} onOpenChange={(v) => !v && setCancelOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Batalkan Pengajuan?</DialogTitle>
            <DialogDescription>
              {cr.number} akan dibatalkan. Status berubah jadi CANCELLED dan
              tidak bisa diaktifkan lagi.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Alasan (opsional)"
            rows={2}
          />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCancelOpen(false)}>
              Tidak
            </Button>
            <Button
              variant="danger"
              onClick={handleCancel}
              disabled={cancelMut.isPending}
            >
              {cancelMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Ya, Batalkan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete dialog */}
      <Dialog open={deleteOpen} onOpenChange={(v) => !v && setDeleteOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hapus Pengajuan?</DialogTitle>
            <DialogDescription>
              {cr.number} akan dihapus permanen dari daftar pengajuan
              (soft-delete). Karena masih PENDING dan belum punya tx, ini
              aman dilakukan.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
              Batal
            </Button>
            <Button
              variant="danger"
              onClick={handleDelete}
              disabled={deleteMut.isPending}
            >
              {deleteMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Ya, Hapus
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CashRequestFormSheet
        open={editOpen}
        onClose={() => setEditOpen(false)}
        target={cr}
      />
    </div>
  )
}

function Meta({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
        {label}
      </span>
      <div className="text-sm text-ink-800">{children}</div>
    </div>
  )
}
