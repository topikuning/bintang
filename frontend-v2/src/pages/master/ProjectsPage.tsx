import { useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { ExternalLink, FolderKanban, Pencil, Trash2 } from "lucide-react"
import { Link as RouterLink } from "react-router-dom"
import { useProjects } from "@/hooks/useProjects"
import { useDeleteProject } from "@/hooks/useProjectMutations"
import { useCompanies } from "@/hooks/useCompanies"
import { MasterPageShell } from "@/components/master/MasterPageShell"
import { ProjectForm, PROJECT_STATUS_LABEL } from "@/components/domain/project/ProjectForm"
import { ConfirmDeleteDialog } from "@/components/data/ConfirmDeleteDialog"
import { Badge } from "@/components/ui/badge"
import { toast } from "@/components/ui/sonner"
import { fmtCompact, fmtIDR } from "@/lib/format"
import { apiErrorMessage } from "@/lib/api"
import type { Project, ProjectStatus } from "@/types/api"

const STATUS_TONE: Record<ProjectStatus, "success" | "neutral" | "warning" | "danger" | "info"> = {
  MENUNGGU_PERSETUJUAN: "info",
  AKTIF: "success",
  SELESAI: "neutral",
  DITAHAN: "warning",
  DIBATALKAN: "danger",
}

export function ProjectsPage() {
  const q = useProjects({ size: 200, include_pending: true })
  const companiesQ = useCompanies()
  const [formOpen, setFormOpen] = useState(false)
  const [target, setTarget] = useState<Project | null>(null)
  const [confirmDel, setConfirmDel] = useState<Project | null>(null)
  const del = useDeleteProject()

  const items = q.data?.items ?? []
  const companyMap = new Map<number, string>()
  companiesQ.data?.items.forEach((c) => companyMap.set(c.id, c.name))

  const columns: ColumnDef<Project, unknown>[] = [
    {
      id: "code",
      header: "Kode",
      accessorKey: "code",
      cell: ({ getValue }) => (
        <span className="font-mono text-[13px] font-semibold">{getValue<string>()}</span>
      ),
      meta: { align: "left", width: "140px", sticky: true },
    },
    {
      id: "name",
      header: "Nama",
      accessorKey: "name",
      cell: ({ getValue }) => <span className="font-medium">{getValue<string>()}</span>,
      meta: { align: "left" },
    },
    {
      id: "company",
      header: "Perusahaan",
      cell: ({ row }) => (
        <span className="text-[13px]">
          {row.original.company_name || companyMap.get(row.original.company_id) || "—"}
        </span>
      ),
      meta: { align: "left", width: "200px" },
    },
    {
      id: "budget",
      header: "Budget",
      cell: ({ row }) => (
        <span data-num className="font-mono [font-variant-numeric:tabular-nums]">
          {fmtCompact(row.original.budget_amount)}
        </span>
      ),
      meta: { align: "num", width: "140px" },
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => {
        const s = row.original.status ?? "AKTIF"
        return <Badge tone={STATUS_TONE[s]}>{PROJECT_STATUS_LABEL[s]}</Badge>
      },
      meta: { align: "center", width: "110px" },
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          <RouterLink
            to={`/projects/${row.original.id}`}
            onClick={(e) => e.stopPropagation()}
            className="flex h-8 w-8 items-center justify-center rounded text-info-600 hover:bg-info-50"
            aria-label="Detail"
            title="Detail proyek (tim, lampiran)"
          >
            <ExternalLink className="h-4 w-4" />
          </RouterLink>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setTarget(row.original)
              setFormOpen(true)
            }}
            className="flex h-8 w-8 items-center justify-center rounded text-ink-500 hover:bg-ink-100"
            aria-label="Edit"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setConfirmDel(row.original)
            }}
            className="flex h-8 w-8 items-center justify-center rounded text-danger-500 hover:bg-danger-50"
            aria-label="Hapus"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ),
      meta: { align: "right", width: "120px" },
    },
  ]

  const handleDelete = async () => {
    if (!confirmDel) return
    try {
      await del.mutateAsync(confirmDel.id)
      toast.success("Proyek dihapus")
      setConfirmDel(null)
    } catch (err) {
      toast.error("Gagal menghapus", { description: apiErrorMessage(err) })
    }
  }

  return (
    <>
      <MasterPageShell
        title="Proyek"
        description="Daftar proyek -- klik kartu/baris untuk membuka dashboard proyek."
        isLoading={q.isLoading}
        error={q.error}
        onRetry={() => q.refetch()}
        items={items}
        columns={columns}
        renderCard={(p) => {
          const s = p.status ?? "AKTIF"
          return (
            <button
              type="button"
              onClick={() => {
                setTarget(p)
                setFormOpen(true)
              }}
              className="flex w-full flex-col gap-1.5 rounded-md border bg-surface p-3 text-left active:bg-ink-100"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <FolderKanban className="h-4 w-4 text-ink-500 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate">{p.name}</div>
                    <div className="font-mono text-[11px] text-ink-500">{p.code}</div>
                  </div>
                </div>
                <Badge tone={STATUS_TONE[s]}>{PROJECT_STATUS_LABEL[s]}</Badge>
              </div>
              <div className="text-[11px] text-ink-500">
                {p.company_name || companyMap.get(p.company_id) || "—"}
              </div>
              <div
                data-num
                className="text-[12px] text-ink-700 font-mono [font-variant-numeric:tabular-nums]"
              >
                Budget {fmtIDR(p.budget_amount)}
              </div>
              <div className="flex items-center justify-end gap-1 mt-1">
                <RouterLink
                  to={`/projects/${p.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="flex h-8 w-8 items-center justify-center rounded text-info-600 hover:bg-info-50"
                  aria-label="Detail"
                >
                  <ExternalLink className="h-4 w-4" />
                </RouterLink>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setConfirmDel(p)
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded text-danger-500 hover:bg-danger-50"
                  aria-label="Hapus"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </button>
          )
        }}
        onAdd={() => {
          setTarget(null)
          setFormOpen(true)
        }}
        emptyMessage="Belum ada proyek."
      />

      <ProjectForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false)
          setTarget(null)
        }}
        project={target}
      />

      <ConfirmDeleteDialog
        open={!!confirmDel}
        onOpenChange={(o) => !o && setConfirmDel(null)}
        title="Hapus proyek?"
        description={
          <>
            <strong>{confirmDel?.name}</strong> akan dihapus. Transaksi,
            invoice, dan PO yang menunjuk proyek ini{" "}
            <strong>tidak akan ikut terhapus</strong> -- referensi
            proyeknya jadi orphan. Tindakan ini tidak bisa di-undo via UI.
          </>
        }
        confirmLabel="Ya, Hapus Proyek"
        requireTypeText={confirmDel?.code}
        retypeLabel={
          confirmDel ? (
            <>
              Ketik kode proyek{" "}
              <code className="font-mono bg-ink-100 px-1.5 py-0.5 rounded text-[11px]">
                {confirmDel.code}
              </code>{" "}
              untuk konfirmasi
            </>
          ) : undefined
        }
        isPending={del.isPending}
        onConfirm={handleDelete}
      />
    </>
  )
}

