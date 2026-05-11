import { useState } from "react"
import { Link } from "react-router-dom"
import {
  ArrowLeft,
  Building2,
  Check,
  Clock,
  FolderKanban,
  Loader2,
  ShieldCheck,
  X,
} from "lucide-react"
import {
  useApproveProposal,
  useProposalQueue,
  useRejectProposal,
} from "@/hooks/useProjectProposals"
import { useAuthStore } from "@/store/auth"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/sonner"
import { ErrorState } from "@/components/data/ErrorState"
import { fmtCompact, fmtDate } from "@/lib/format"
import { apiErrorMessage } from "@/lib/api"
import type { Project } from "@/types/api"

/**
 * Queue approval proposal proyek. Hanya CENTRAL_ADMIN / SUPERADMIN bisa
 * lihat & action. Non-admin diblok di route layer + di sini.
 */
export function ProposalQueuePage() {
  const role = useAuthStore((s) => s.user?.role)
  const isAdmin = role === "SUPERADMIN" || role === "CENTRAL_ADMIN"

  const queueQ = useProposalQueue({ size: 100 })
  const approve = useApproveProposal()
  const reject = useRejectProposal()

  const [confirmApprove, setConfirmApprove] = useState<Project | null>(null)
  const [rejectTarget, setRejectTarget] = useState<Project | null>(null)
  const [rejectReason, setRejectReason] = useState("")

  if (!isAdmin) {
    return (
      <div className="p-4 sm:p-6 max-w-2xl">
        <div className="rounded-md border border-warning-200 bg-warning-50 p-6 text-center">
          <ShieldCheck className="mx-auto h-8 w-8 text-warning-600 mb-2" />
          <h2 className="text-base font-semibold text-warning-800">Akses Terbatas</h2>
          <p className="mt-1 text-sm text-warning-700">
            Approval proposal proyek hanya untuk SUPERADMIN dan CENTRAL_ADMIN.
          </p>
        </div>
      </div>
    )
  }

  if (queueQ.error) {
    return (
      <div className="p-4 sm:p-6">
        <ErrorState
          description={apiErrorMessage(queueQ.error)}
          onRetry={() => queueQ.refetch()}
        />
      </div>
    )
  }

  const items = queueQ.data?.items ?? []

  const handleApprove = async () => {
    if (!confirmApprove) return
    try {
      await approve.mutateAsync(confirmApprove.id)
      toast.success(`Proyek "${confirmApprove.name}" disetujui & aktif`)
      setConfirmApprove(null)
    } catch (err) {
      toast.error("Gagal approve", { description: apiErrorMessage(err) })
    }
  }

  const handleReject = async () => {
    if (!rejectTarget) return
    if (!rejectReason.trim()) {
      toast.error("Alasan penolakan wajib diisi")
      return
    }
    try {
      await reject.mutateAsync({ id: rejectTarget.id, reason: rejectReason.trim() })
      toast.success(`Proposal "${rejectTarget.name}" ditolak`)
      setRejectTarget(null)
      setRejectReason("")
    } catch (err) {
      toast.error("Gagal menolak", { description: apiErrorMessage(err) })
    }
  }

  return (
    <>
      <div className="flex flex-col gap-3 p-3 sm:p-5 lg:p-6 max-w-4xl">
        <div>
          <Link
            to="/projects"
            className="inline-flex items-center gap-1 text-[12px] text-ink-500 hover:text-ink-700"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Kembali ke Proyek
          </Link>
          <div className="mt-2 flex items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold text-ink-900 sm:text-2xl flex items-center gap-2">
                <Clock className="h-5 w-5 text-warning-600" />
                Antrian Proposal Proyek
              </h1>
              <p className="text-[13px] text-ink-500 mt-0.5">
                Proposal proyek dr user yg menunggu persetujuan. Approve → status AKTIF.
                Reject → DIBATALKAN dgn alasan.
              </p>
            </div>
            <Badge tone="warning">{items.length} pending</Badge>
          </div>
        </div>

        {queueQ.isLoading ? (
          <div className="grid grid-cols-1 gap-3">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-md border border-dashed bg-surface p-10 text-center text-[13px] text-ink-500">
            Tidak ada proposal pending. 🎉
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {items.map((p) => (
              <ProposalCard
                key={p.id}
                p={p}
                onApprove={() => setConfirmApprove(p)}
                onReject={() => {
                  setRejectTarget(p)
                  setRejectReason("")
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Approve dialog */}
      <Dialog
        open={!!confirmApprove}
        onOpenChange={(o) => !o && setConfirmApprove(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Setujui proposal?</DialogTitle>
            <DialogDescription>
              Proyek <strong>{confirmApprove?.name}</strong> ({confirmApprove?.code})
              akan diaktifkan & pengaju otomatis di-assign sbg anggota tim.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmApprove(null)}>
              Batal
            </Button>
            <Button onClick={handleApprove} disabled={approve.isPending}>
              {approve.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              <Check className="h-4 w-4" />
              Ya, Setujui
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog
        open={!!rejectTarget}
        onOpenChange={(o) => {
          if (!o) {
            setRejectTarget(null)
            setRejectReason("")
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tolak proposal?</DialogTitle>
            <DialogDescription>
              Proyek <strong>{rejectTarget?.name}</strong> akan berstatus
              DIBATALKAN. Alasan wajib supaya pengaju paham kenapa ditolak.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Alasan penolakan (wajib)…"
            rows={3}
          />
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                setRejectTarget(null)
                setRejectReason("")
              }}
            >
              Batal
            </Button>
            <Button
              variant="danger"
              onClick={handleReject}
              disabled={reject.isPending || !rejectReason.trim()}
            >
              {reject.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              <X className="h-4 w-4" />
              Ya, Tolak
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function ProposalCard({
  p,
  onApprove,
  onReject,
}: {
  p: Project
  onApprove: () => void
  onReject: () => void
}) {
  return (
    <div className="rounded-md border bg-surface p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="grid h-9 w-9 place-items-center rounded bg-warning-50 text-warning-700 shrink-0">
            <FolderKanban className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold truncate">{p.name}</h3>
            <div className="flex items-center gap-2 flex-wrap mt-0.5 text-[12px] text-ink-500">
              <span className="font-mono">{p.code}</span>
              {p.location && (
                <>
                  <span>·</span>
                  <span>{p.location}</span>
                </>
              )}
              {p.company_name && (
                <>
                  <span>·</span>
                  <Building2 className="h-3 w-3" />
                  <span>{p.company_name}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Meta info */}
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
        <Meta label="Nilai Kontrak" value={fmtCompact(p.project_value)} />
        <Meta label="Budget" value={fmtCompact(p.budget_amount)} />
        {p.start_date && <Meta label="Mulai" value={fmtDate(p.start_date)} />}
        {p.end_date && <Meta label="Selesai" value={fmtDate(p.end_date)} />}
      </div>

      {p.notes && (
        <div className="mt-2 text-[12px] text-ink-700 bg-ink-50 rounded px-2 py-1.5">
          <span className="text-ink-500 font-semibold mr-1">Catatan:</span>
          {p.notes}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-2 flex-wrap pt-2 border-t">
        <div className="text-[11px] text-ink-500">
          Diajukan oleh{" "}
          <span className="font-semibold text-ink-700">
            {p.proposed_by_name ?? `User #${p.proposed_by_id ?? "-"}`}
          </span>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={onReject}>
            <X className="h-4 w-4" />
            Tolak
          </Button>
          <Button size="sm" onClick={onApprove}>
            <Check className="h-4 w-4" />
            Setujui
          </Button>
        </div>
      </div>
    </div>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-ink-500 uppercase tracking-wider">{label}</div>
      <div
        data-num
        className="font-mono font-semibold text-ink-900 [font-variant-numeric:tabular-nums]"
      >
        {value}
      </div>
    </div>
  )
}
