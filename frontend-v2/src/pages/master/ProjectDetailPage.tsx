import { useState } from "react"
import { Link, useParams } from "react-router-dom"
import {
  ArrowLeft,
  Building2,
  FolderKanban,
  Loader2,
  Paperclip,
  Plus,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react"
import { useCompanies } from "@/hooks/useCompanies"
import { useProject } from "@/hooks/useProjects"
import {
  useProjectAttachments,
  useUploadProjectAttachment,
  useLinkProjectAttachment,
  useDeleteProjectAttachment,
  type ProjectAttachment,
} from "@/hooks/useProjectAttachments"
import {
  useProjectUsers,
  type ProjectMember,
} from "@/hooks/useProjectUsers"
import { useAssignProject, useUnassignProject, useUsers } from "@/hooks/useUsers"
import { useAuthStore } from "@/store/auth"
import { apiErrorMessage } from "@/lib/api"
import { fmtIDR } from "@/lib/format"
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
import { ErrorState } from "@/components/data/ErrorState"
import { AttachmentList } from "@/components/domain/shared/AttachmentList"
import { AttachmentUploader } from "@/components/forms/AttachmentUploader"
import { Combobox, type ComboboxOption } from "@/components/forms/Combobox"
import { toast } from "@/components/ui/sonner"
import type { Attachment } from "@/types/api"

/**
 * Halaman detail proyek -- multi-tab via accordion section:
 *  1. Info ringkas (kode, nama, perusahaan, budget, status)
 *  2. Tim (project_users assignment)
 *  3. Lampiran proyek (kontrak, BAST, dokumen pendukung)
 *
 * Dipakai di /master/projects/:id
 */
export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const projectId = Number(id)

  const projectQ = useProject(projectId)
  const companiesQ = useCompanies()

  if (projectQ.isLoading) {
    return (
      <div className="p-3 sm:p-5 lg:p-6 space-y-4">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }
  if (projectQ.error) {
    return (
      <div className="p-4 sm:p-6">
        <ErrorState
          description={apiErrorMessage(projectQ.error)}
          onRetry={() => projectQ.refetch()}
        />
      </div>
    )
  }
  if (!projectQ.data) return null
  const project = projectQ.data

  const company = companiesQ.data?.items.find((c) => c.id === project.company_id)

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-5 lg:p-6 max-w-4xl">
      <div>
        <Link
          to="/master/projects"
          className="inline-flex items-center gap-1 text-[12px] text-ink-500 hover:text-ink-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Kembali ke daftar proyek
        </Link>
        <div className="mt-2 flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded bg-brand-50 text-brand-600 shrink-0">
            <FolderKanban className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold text-ink-900 sm:text-2xl">
              {project.name}
            </h1>
            <div className="flex items-center gap-2 flex-wrap mt-0.5">
              <span className="font-mono text-[12px] text-ink-500">{project.code}</span>
              {project.is_active ? (
                <Badge tone="success">Aktif</Badge>
              ) : (
                <Badge tone="neutral">Nonaktif</Badge>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Info card */}
      <div className="rounded-md border bg-surface p-4 sm:p-5 space-y-2">
        <h2 className="text-sm font-semibold text-ink-900 mb-2">Info Proyek</h2>
        <dl className="divide-y">
          <InfoRow label="Perusahaan" icon={Building2} value={company?.name ?? "—"} />
          <InfoRow
            label="Budget"
            value={
              project.budget_amount && Number(project.budget_amount) > 0
                ? fmtIDR(project.budget_amount)
                : "—"
            }
            mono
          />
          <InfoRow label="Mata Uang" value={(project as { currency?: string }).currency ?? "IDR"} />
        </dl>
      </div>

      {/* Tim */}
      <ProjectTeamSection projectId={projectId} />

      {/* Lampiran */}
      <ProjectAttachmentsSection projectId={projectId} />
    </div>
  )
}

// ============================================================
// Tim section
// ============================================================
function ProjectTeamSection({ projectId }: { projectId: number }) {
  const role = useAuthStore((s) => s.user?.role)
  const isAdmin = role === "SUPERADMIN" || role === "CENTRAL_ADMIN"

  const teamQ = useProjectUsers(projectId)
  const usersQ = useUsers()
  const assign = useAssignProject()
  const unassign = useUnassignProject()
  const [addOpen, setAddOpen] = useState(false)
  const [pickedUserId, setPickedUserId] = useState<number | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<ProjectMember | null>(null)

  const team = teamQ.data ?? []
  const teamIds = new Set(team.map((m) => m.id))
  const allUsers = usersQ.data?.items ?? []
  // Hanya users yg belum di-assign + role yg masuk akal (skip EXECUTIVE krn read-only)
  const candidateOptions: ComboboxOption[] = allUsers
    .filter((u) => !teamIds.has(u.id) && u.is_active && u.role !== "EXECUTIVE")
    .map((u) => ({
      value: u.id,
      label: u.name,
      hint: `${u.email} · ${u.role}`,
    }))

  const handleAssign = async () => {
    if (!pickedUserId) return
    try {
      await assign.mutateAsync({ userId: pickedUserId, projectId })
      toast.success("User ditambahkan ke tim proyek")
      setAddOpen(false)
      setPickedUserId(null)
    } catch (err) {
      toast.error("Gagal menambahkan", { description: apiErrorMessage(err) })
    }
  }

  const handleRemove = async () => {
    if (!confirmRemove) return
    try {
      await unassign.mutateAsync({ userId: confirmRemove.id, projectId })
      toast.success("User dikeluarkan dari tim")
      setConfirmRemove(null)
    } catch (err) {
      toast.error("Gagal mengeluarkan", { description: apiErrorMessage(err) })
    }
  }

  return (
    <div className="rounded-md border bg-surface p-4 sm:p-5 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-semibold text-ink-900 flex items-center gap-1.5">
          <Users className="h-4 w-4 text-ink-500" />
          Tim Proyek
          {team.length > 0 && (
            <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] font-semibold text-ink-700">
              {team.length}
            </span>
          )}
        </h2>
        {isAdmin && (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <UserPlus className="h-3.5 w-3.5" />
            Tambah Anggota
          </Button>
        )}
      </div>

      {teamQ.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : team.length === 0 ? (
        <div className="rounded border border-dashed bg-surface-muted p-6 text-center text-[13px] text-ink-500">
          Belum ada anggota tim. Tambahkan user supaya mereka bisa akses
          transaksi/invoice/PO proyek ini.
        </div>
      ) : (
        <ul className="flex flex-col divide-y rounded-md border">
          {team.map((m) => (
            <li
              key={m.id}
              className="flex items-center gap-3 px-3 py-2.5"
            >
              <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-100 text-brand-700 text-[12px] font-bold shrink-0">
                {m.name.charAt(0).toUpperCase()}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{m.name}</div>
                <div className="text-[11px] text-ink-500 truncate">
                  {m.email} · <span className="font-mono">{m.role}</span>
                </div>
              </div>
              {isAdmin && m.role !== "SUPERADMIN" && (
                <button
                  type="button"
                  onClick={() => setConfirmRemove(m)}
                  className="flex h-8 w-8 items-center justify-center rounded text-danger-500 hover:bg-danger-50"
                  aria-label="Keluarkan"
                >
                  <UserMinus className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Add member dialog */}
      <Dialog open={addOpen} onOpenChange={(o) => !o && setAddOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tambah Anggota Tim</DialogTitle>
            <DialogDescription>
              User akan dapat akses ke transaksi, invoice, dan PO di proyek
              ini. Hanya user aktif & non-EXECUTIVE yang bisa di-assign.
            </DialogDescription>
          </DialogHeader>
          <Combobox
            value={pickedUserId}
            onChange={(v) => setPickedUserId(v == null ? null : Number(v))}
            options={candidateOptions}
            placeholder="Pilih user…"
            sheetTitle="Pilih User"
            emptyMessage="Semua user sudah jadi anggota / tidak ada user aktif."
          />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setAddOpen(false)}>
              Batal
            </Button>
            <Button
              onClick={handleAssign}
              disabled={!pickedUserId || assign.isPending}
            >
              {assign.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              <Plus className="h-4 w-4" />
              Tambahkan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmRemove} onOpenChange={(o) => !o && setConfirmRemove(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Keluarkan dari tim?</DialogTitle>
            <DialogDescription>
              <strong>{confirmRemove?.name}</strong> tidak akan bisa lagi
              akses transaksi/invoice/PO proyek ini. Data yg sudah dibuat
              user ini tetap ada.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmRemove(null)}>
              Batal
            </Button>
            <Button variant="danger" onClick={handleRemove} disabled={unassign.isPending}>
              {unassign.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Ya, Keluarkan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ============================================================
// Attachments section
// ============================================================
function ProjectAttachmentsSection({ projectId }: { projectId: number }) {
  const role = useAuthStore((s) => s.user?.role)
  const isAdmin = role === "SUPERADMIN" || role === "CENTRAL_ADMIN"

  const attQ = useProjectAttachments(projectId)
  const upload = useUploadProjectAttachment()
  const link = useLinkProjectAttachment()
  const del = useDeleteProjectAttachment()
  const attachments: ProjectAttachment[] = attQ.data ?? []

  // Adapter -- ProjectAttachment shape (label) ke generic Attachment
  // shape (utk reuse AttachmentList). label/file_name fallback.
  const asAttachment = (a: ProjectAttachment): Attachment => ({
    id: a.id,
    file_name: a.label || a.file_name,
    file_size: a.file_size,
    mime_type: a.mime_type,
    url: a.url,
    created_at: a.created_at,
  })

  const handleDelete = async (att: Attachment) => {
    try {
      await del.mutateAsync({ projectId, attachmentId: att.id })
      toast.success("Dokumen proyek dihapus")
    } catch (err) {
      toast.error("Gagal menghapus", { description: apiErrorMessage(err) })
    }
  }

  return (
    <div className="rounded-md border bg-surface p-4 sm:p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-900 flex items-center gap-1.5">
          <Paperclip className="h-4 w-4 text-ink-500" />
          Dokumen Proyek
          {attachments.length > 0 && (
            <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] font-semibold text-ink-700">
              {attachments.length}
            </span>
          )}
        </h2>
      </div>

      {attQ.isLoading ? (
        <Skeleton className="h-32" />
      ) : (
        <AttachmentList
          attachments={attachments.map(asAttachment)}
          canDelete={isAdmin}
          onDelete={handleDelete}
          deletingId={del.isPending ? del.variables?.attachmentId ?? null : null}
          emptyMessage={
            isAdmin
              ? "Belum ada dokumen. Tambah kontrak, BAST, atau lampiran lain di bawah."
              : "Belum ada dokumen proyek."
          }
        />
      )}

      {isAdmin && (
        <AttachmentUploader
          uploadFile={(file, onProgress) =>
            upload.mutateAsync({ projectId, file, onProgress }).then(() => undefined)
          }
          linkExternal={(url, label) =>
            link.mutateAsync({ projectId, url, label }).then(() => undefined)
          }
          isLinking={link.isPending}
        />
      )}

      {!isAdmin && (
        <p className="text-[11px] text-ink-500">
          Hanya admin yang dapat mengelola dokumen proyek.
        </p>
      )}
    </div>
  )
}

// ============================================================
// Helpers
// ============================================================
function InfoRow({
  label,
  icon: Icon,
  value,
  mono,
}: {
  label: string
  icon?: React.ComponentType<{ className?: string }>
  value: React.ReactNode
  mono?: boolean
}) {
  return (
    <div className="grid grid-cols-3 gap-3 py-2">
      <dt className="col-span-1 flex items-center gap-1.5 text-[12px] uppercase tracking-wider text-ink-500">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {label}
      </dt>
      <dd
        className={
          mono ? "col-span-2 text-sm font-mono [font-variant-numeric:tabular-nums]" : "col-span-2 text-sm"
        }
      >
        {value}
      </dd>
    </div>
  )
}
