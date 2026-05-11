import { useEffect } from "react"
import { useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { Controller, useForm } from "react-hook-form"
import { ExternalLink, FolderKanban, Loader2, Pencil, Trash2 } from "lucide-react"
import { Link as RouterLink } from "react-router-dom"
import { z } from "zod"
import { useProjects } from "@/hooks/useProjects"
import {
  useCreateProject,
  useDeleteProject,
  useUpdateProject,
  type ProjectInput,
} from "@/hooks/useProjectMutations"
import { useProjectDashboard } from "@/hooks/useDashboard"
import { useCompanies } from "@/hooks/useCompanies"
import { MasterPageShell } from "@/components/master/MasterPageShell"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { DraggableSheet } from "@/components/ui/draggable-sheet"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/sonner"
import { AmountInput } from "@/components/forms/AmountInput"
import { CompanyPicker } from "@/components/forms/CompanyPicker"
import { fmtCompact, fmtIDR } from "@/lib/format"
import { apiErrorMessage } from "@/lib/api"
import { useBreakpoint } from "@/lib/breakpoint"
import { cn } from "@/lib/utils"
import type { Project, ProjectStatus } from "@/types/api"

const STATUS_VALUES = ["AKTIF", "SELESAI", "DITAHAN", "DIBATALKAN"] as const

const schema = z.object({
  code: z.string().min(1, "Kode wajib"),
  name: z.string().min(1, "Nama wajib"),
  company_id: z.number().min(1, "Pilih perusahaan"),
  location: z.string().nullable().optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  status: z.enum(STATUS_VALUES),
  notes: z.string().nullable().optional(),
  budget_amount: z.number().nonnegative(),
  project_value: z.number().nonnegative(),
  currency: z.string().min(1),
  overbudget_tolerance_pct: z.number().min(0).max(100),
  tax_ppn_pct: z.number().min(0).max(100),
  tax_pph_pct: z.number().min(0).max(100),
  marketing_pct: z.number().min(0).max(100),
})

type FormValues = z.infer<typeof schema>

const STATUS_LABEL: Record<ProjectStatus, string> = {
  AKTIF: "Aktif",
  SELESAI: "Selesai",
  DITAHAN: "Ditahan",
  DIBATALKAN: "Dibatalkan",
}

const STATUS_TONE: Record<ProjectStatus, "success" | "neutral" | "warning" | "danger"> = {
  AKTIF: "success",
  SELESAI: "neutral",
  DITAHAN: "warning",
  DIBATALKAN: "danger",
}

export function ProjectsPage() {
  const q = useProjects({ size: 200 })
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
        return <Badge tone={STATUS_TONE[s]}>{STATUS_LABEL[s]}</Badge>
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
        description="Daftar proyek -- gunakan ProjectSwitcher di topbar untuk memilih scope aktif."
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
                <Badge tone={STATUS_TONE[s]}>{STATUS_LABEL[s]}</Badge>
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

      <Dialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hapus proyek?</DialogTitle>
            <DialogDescription>
              <strong>{confirmDel?.name}</strong> akan dihapus. Transaksi/Invoice/PO
              yang menunjuk proyek ini tidak akan ikut terhapus, tetapi referensi
              proyeknya jadi orphan.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmDel(null)}>
              Batal
            </Button>
            <Button variant="danger" onClick={handleDelete} disabled={del.isPending}>
              {del.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Ya, Hapus
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function buildDefaults(project: Project | null): FormValues {
  return {
    code: project?.code ?? "",
    name: project?.name ?? "",
    company_id: project?.company_id ?? 0,
    location: project?.location ?? "",
    start_date: project?.start_date ?? "",
    end_date: project?.end_date ?? "",
    status: (project?.status as ProjectStatus) ?? "AKTIF",
    notes: project?.notes ?? "",
    budget_amount: project ? Number(project.budget_amount ?? 0) : 0,
    project_value: project ? Number(project.project_value ?? 0) : 0,
    currency: project?.currency ?? "IDR",
    overbudget_tolerance_pct: project ? Number(project.overbudget_tolerance_pct ?? 0) : 0,
    tax_ppn_pct: project ? Number(project.tax_ppn_pct ?? 11) : 11,
    tax_pph_pct: project ? Number(project.tax_pph_pct ?? 2) : 2,
    marketing_pct: project ? Number(project.marketing_pct ?? 15) : 15,
  }
}

function ProjectForm({
  open,
  onClose,
  project,
}: {
  open: boolean
  onClose: () => void
  project: Project | null
}) {
  const bp = useBreakpoint()
  const isEdit = !!project
  const create = useCreateProject()
  const update = useUpdateProject(project?.id ?? 0)

  // Cek aktivitas proyek -- kode immutable kalau sudah ada Tx/Invoice/PO
  // (lihat backend update_project: PO number embed code, lookup chat
  // pakai code, Excel importer pakai code). Backend juga validate, ini
  // hint UX supaya field input langsung disabled + ada penjelasan.
  const dashQ = useProjectDashboard(isEdit && open ? project!.id : null)
  const codeLocked =
    isEdit &&
    !!dashQ.data &&
    (dashQ.data.totals.in > 0 ||
      dashQ.data.totals.out > 0 ||
      dashQ.data.totals.pending_in > 0 ||
      dashQ.data.totals.pending_out > 0 ||
      dashQ.data.invoice_open_total > 0 ||
      dashQ.data.invoice_paid_total > 0 ||
      dashQ.data.invoices.length > 0)

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: buildDefaults(project),
  })

  // Reset form values whenever target changes -- defaultValues hanya
  // dipakai sekali saat mount, jadi edit-row ke edit-row lain perlu reset.
  useEffect(() => {
    if (open) reset(buildDefaults(project))
  }, [project, open, reset])

  const onSubmit = async (raw: FormValues) => {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Periksa isian")
      return
    }
    try {
      const payload: ProjectInput = {
        code: parsed.data.code,
        name: parsed.data.name,
        company_id: parsed.data.company_id,
        location: parsed.data.location?.trim() || null,
        start_date: parsed.data.start_date?.trim() || null,
        end_date: parsed.data.end_date?.trim() || null,
        status: parsed.data.status,
        notes: parsed.data.notes?.trim() || null,
        budget_amount: parsed.data.budget_amount,
        project_value: parsed.data.project_value,
        currency: parsed.data.currency,
        overbudget_tolerance_pct: parsed.data.overbudget_tolerance_pct,
        tax_ppn_pct: parsed.data.tax_ppn_pct,
        tax_pph_pct: parsed.data.tax_pph_pct,
        marketing_pct: parsed.data.marketing_pct,
      }
      if (isEdit) {
        await update.mutateAsync(payload)
        toast.success("Proyek diperbarui")
      } else {
        await create.mutateAsync(payload)
        toast.success("Proyek ditambahkan")
      }
      reset()
      onClose()
    } catch (err) {
      toast.error(isEdit ? "Gagal update" : "Gagal tambah", {
        description: apiErrorMessage(err),
      })
    }
  }

  const body = (
    <form
      id="project-form"
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col gap-3 px-4 py-4 sm:px-5"
    >
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Kode"
          required
          error={errors.code?.message}
          hint={
            codeLocked
              ? "Terkunci -- proyek sudah punya transaksi/invoice/PO. Kode di-embed di nomor PO + alias chat."
              : isEdit
                ? "Bisa diubah selama belum ada transaksi/invoice/PO."
                : undefined
          }
        >
          <Input
            {...register("code")}
            placeholder="Mis. KNMP-MTR"
            autoFocus={!isEdit}
            className="font-mono"
            disabled={codeLocked}
            readOnly={codeLocked}
          />
        </Field>
        <Field label="Status" required>
          <Select {...register("status")}>
            {STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Nama Proyek" required error={errors.name?.message}>
        <Input {...register("name")} placeholder="Mis. KNMP Mataram Fase 2" />
      </Field>
      <Field label="Perusahaan" required error={errors.company_id?.message}>
        <Controller
          control={control}
          name="company_id"
          render={({ field }) => (
            <CompanyPicker value={field.value || null} onChange={(v) => field.onChange(v ?? 0)} />
          )}
        />
      </Field>
      <Field label="Lokasi">
        <Input {...register("location")} placeholder="Mis. Mataram, NTB" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tanggal Mulai">
          <Input type="date" {...register("start_date")} />
        </Field>
        <Field label="Tanggal Selesai">
          <Input type="date" {...register("end_date")} />
        </Field>
      </div>
      <Field label="Nilai Kontrak" hint="Untuk hitung Nilai Cair / Profit di Dashboard.">
        <Controller
          control={control}
          name="project_value"
          render={({ field }) => (
            <AmountInput value={field.value || null} onChange={(v) => field.onChange(v ?? 0)} />
          )}
        />
      </Field>
      <Field label="Budget Pengeluaran">
        <Controller
          control={control}
          name="budget_amount"
          render={({ field }) => (
            <AmountInput value={field.value || null} onChange={(v) => field.onChange(v ?? 0)} />
          )}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Mata Uang">
          <Input {...register("currency")} placeholder="IDR" className="font-mono" />
        </Field>
        <Field label="Toleransi Overbudget (%)">
          <PctInput control={control} name="overbudget_tolerance_pct" />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="PPn (%)">
          <PctInput control={control} name="tax_ppn_pct" />
        </Field>
        <Field label="PPh (%)">
          <PctInput control={control} name="tax_pph_pct" />
        </Field>
        <Field label="Marketing (%)">
          <PctInput control={control} name="marketing_pct" />
        </Field>
      </div>
      <Field label="Catatan">
        <Textarea {...register("notes")} rows={2} placeholder="Catatan internal (opsional)" />
      </Field>
    </form>
  )

  const footer = (
    <div className="flex gap-2 px-4 py-3 sm:px-5 border-t bg-surface pb-safe">
      <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
        Batal
      </Button>
      <Button type="submit" form="project-form" className="flex-1" disabled={isSubmitting}>
        {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
        {isEdit ? "Simpan" : "Tambah"}
      </Button>
    </div>
  )

  if (bp === "mobile") {
    return (
      <DraggableSheet
        open={open}
        onOpenChange={(o) => !o && onClose()}
        title={isEdit ? "Edit Proyek" : "Tambah Proyek"}
        footer={footer}
      >
        {body}
      </DraggableSheet>
    )
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col p-0">
        <SheetHeader className="border-b">
          <SheetTitle>{isEdit ? "Edit Proyek" : "Tambah Proyek"}</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto">{body}</div>
        {footer}
      </SheetContent>
    </Sheet>
  )
}

function PctInput({
  control,
  name,
}: {
  control: ReturnType<typeof useForm<FormValues>>["control"]
  name: "tax_ppn_pct" | "tax_pph_pct" | "marketing_pct" | "overbudget_tolerance_pct"
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <div className="relative">
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            max="100"
            value={field.value ?? ""}
            onChange={(e) =>
              field.onChange(e.target.value === "" ? 0 : Number(e.target.value))
            }
            className="h-10 w-full rounded border border-border-strong bg-surface pl-3 pr-8 text-right font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 [font-variant-numeric:tabular-nums]"
          />
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-ink-500">
            %
          </span>
        </div>
      )}
    />
  )
}

function Field({
  label,
  required,
  hint,
  error,
  children,
}: {
  label: string
  required?: boolean
  hint?: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("flex flex-col gap-1.5")}>
      <Label className="text-[12px] uppercase tracking-wider">
        {label}
        {required && <span className="text-danger-600 ml-0.5">*</span>}
      </Label>
      {children}
      {hint && !error && <p className="text-[11px] text-ink-500">{hint}</p>}
      {error && <p className="text-[11px] text-danger-600">{error}</p>}
    </div>
  )
}
