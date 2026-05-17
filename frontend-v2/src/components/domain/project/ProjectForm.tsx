/**
 * ProjectForm -- sheet/dialog reusable utk Create + Edit proyek.
 *
 * Sebelumnya di-inline di `pages/master/ProjectsPage`; di-extract supaya
 * ProjectDashboardPage juga bisa pakai tanpa user harus balik ke master
 * proyek hanya untuk edit info.
 *
 * onSaved opsional: caller bisa pakai utk show feedback / refresh extra.
 * Default invalidation queries handled by useCreateProject/useUpdateProject
 * (invalidate `projects.all()` -> hierarchical: list + detail + stats).
 */
import { useEffect } from "react"
import { Controller, useForm } from "react-hook-form"
import { Loader2 } from "lucide-react"
import { Link as RouterLink } from "react-router-dom"
import { z } from "zod"
import {
  useCreateProject,
  useUpdateProject,
  type ProjectInput,
} from "@/hooks/useProjectMutations"
import { useProjectDashboard } from "@/hooks/useDashboard"
import { useFunders } from "@/hooks/useFunders"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { DraggableSheet } from "@/components/ui/draggable-sheet"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/sonner"
import { AmountInput } from "@/components/forms/AmountInput"
import { CompanyPicker } from "@/components/forms/CompanyPicker"
import { apiErrorMessage } from "@/lib/api"
import { useBreakpoint } from "@/lib/breakpoint"
import { cn } from "@/lib/utils"
import type { Project, ProjectStatus } from "@/types/api"

export const PROJECT_STATUS_VALUES = [
  "MENUNGGU_PERSETUJUAN",
  "AKTIF",
  "SELESAI",
  "DITAHAN",
  "DIBATALKAN",
] as const

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  MENUNGGU_PERSETUJUAN: "Menunggu Persetujuan",
  AKTIF: "Aktif",
  SELESAI: "Selesai",
  DITAHAN: "Ditahan",
  DIBATALKAN: "Dibatalkan",
}

const schema = z.object({
  code: z.string().min(1, "Kode wajib"),
  name: z.string().min(1, "Nama wajib"),
  company_id: z.number().min(1, "Pilih perusahaan"),
  client_name: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  status: z.enum(PROJECT_STATUS_VALUES),
  notes: z.string().nullable().optional(),
  budget_amount: z.number().nonnegative(),
  project_value: z.number().nonnegative(),
  currency: z.string().min(1),
  overbudget_tolerance_pct: z.number().min(0).max(100),
  tax_ppn_pct: z.number().min(0).max(100),
  tax_pph_pct: z.number().min(0).max(100),
  marketing_pct: z.number().min(0).max(100),
  funder_ids: z.array(z.number()).default([]),
})

type FormValues = z.infer<typeof schema>

function buildDefaults(project: Project | null): FormValues {
  return {
    code: project?.code ?? "",
    name: project?.name ?? "",
    company_id: project?.company_id ?? 0,
    client_name: project?.client_name ?? "",
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
    funder_ids: project?.funder_ids ?? [],
  }
}

interface ProjectFormProps {
  open: boolean
  onClose: () => void
  project: Project | null
  /** Dipanggil setelah save sukses. Caller bisa pakai utk re-open
   * detail, navigate, dst. Project ID = invocation result. */
  onSaved?: (saved: Project) => void
}

export function ProjectForm({ open, onClose, project, onSaved }: ProjectFormProps) {
  const bp = useBreakpoint()
  const isEdit = !!project
  const create = useCreateProject()
  const update = useUpdateProject(project?.id ?? 0)

  // Cek aktivitas proyek -- kode immutable kalau sudah ada Tx/Invoice/PO
  // (backend update_project: PO number embed code, lookup chat pakai code,
  // Excel importer pakai code). Backend juga validate, ini hint UX supaya
  // field input langsung disabled + ada penjelasan.
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
        client_name: parsed.data.client_name?.trim() || null,
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
        funder_ids: parsed.data.funder_ids,
      }
      let saved: Project
      if (isEdit) {
        saved = await update.mutateAsync(payload)
        toast.success("Proyek diperbarui")
      } else {
        saved = await create.mutateAsync(payload)
        toast.success("Proyek ditambahkan")
      }
      reset()
      onClose()
      onSaved?.(saved)
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
            {PROJECT_STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {PROJECT_STATUS_LABEL[s]}
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
      <Field
        label="Dinas / Instansi / Klien"
        hint="Pemberi pekerjaan -- tampil di header PDF PO & Invoice. Opsional."
      >
        <Input
          {...register("client_name")}
          placeholder="Mis. Dinas PUPR Kota Mataram"
        />
      </Field>
      <Field
        label="Pendana"
        hint="Bisa lebih dari satu. Master di Lainnya → Pendana."
      >
        <Controller
          control={control}
          name="funder_ids"
          render={({ field }) => (
            <FunderMultiSelect
              value={field.value ?? []}
              onChange={field.onChange}
            />
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

function FunderMultiSelect({
  value,
  onChange,
}: {
  value: number[]
  onChange: (next: number[]) => void
}) {
  const q = useFunders()
  const items = q.data?.items ?? []
  const selected = new Set(value)

  const toggle = (id: number) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(Array.from(next))
  }

  if (q.isLoading) {
    return <div className="text-[12px] text-ink-500">Memuat pendana…</div>
  }
  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed bg-surface-muted/40 p-3 text-[12px] text-ink-500">
        Belum ada master pendana. Tambahkan dulu di menu{" "}
        <RouterLink to="/master/funders" className="text-brand-600 hover:underline">
          Master → Pendana
        </RouterLink>
        .
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {items
            .filter((f) => selected.has(f.id))
            .map((f) => (
              <span
                key={f.id}
                className="inline-flex items-center gap-1 rounded border border-brand-200 bg-brand-50 px-2 py-0.5 text-[11px] text-brand-800"
              >
                {f.name}
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    toggle(f.id)
                  }}
                  className="text-danger-500 hover:text-danger-700"
                  aria-label={`Lepas ${f.name}`}
                >
                  ×
                </button>
              </span>
            ))}
        </div>
      )}
      <div className="rounded border bg-surface max-h-40 overflow-y-auto">
        {items.map((f) => {
          const checked = selected.has(f.id)
          return (
            <label
              key={f.id}
              className="flex items-center gap-2 px-2.5 py-1.5 text-sm cursor-pointer hover:bg-ink-50 border-b last:border-b-0"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(f.id)}
                className="h-4 w-4 accent-brand-600"
              />
              <span>{f.name}</span>
            </label>
          )
        })}
      </div>
    </div>
  )
}
