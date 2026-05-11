import { useEffect } from "react"
import { Controller, useForm } from "react-hook-form"
import { Loader2 } from "lucide-react"
import { z } from "zod"
import {
  useProposeProject,
  type ProjectProposalInput,
} from "@/hooks/useProjectProposals"
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
import { Textarea } from "@/components/ui/textarea"
import { AmountInput } from "@/components/forms/AmountInput"
import { CompanyPicker } from "@/components/forms/CompanyPicker"
import { toast } from "@/components/ui/sonner"
import { apiErrorMessage } from "@/lib/api"
import { cn } from "@/lib/utils"

const schema = z.object({
  code: z.string().min(1, "Kode wajib").max(40, "Maks 40 karakter"),
  name: z.string().min(1, "Nama wajib"),
  company_id: z.number().min(1, "Pilih perusahaan"),
  location: z.string().nullable().optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  project_value: z.number().nonnegative(),
  budget_amount: z.number().nonnegative(),
})

type FormValues = z.infer<typeof schema>

const defaults: FormValues = {
  code: "",
  name: "",
  company_id: 0,
  location: "",
  start_date: "",
  end_date: "",
  notes: "",
  project_value: 0,
  budget_amount: 0,
}

interface Props {
  open: boolean
  onClose: () => void
}

/**
 * Form proposal proyek baru. Terbuka utk semua user login (non-EXECUTIVE).
 * Field detail (tax/marketing/dll) di-default backend -- admin tinggal
 * edit setelah approve.
 */
export function ProjectProposalForm({ open, onClose }: Props) {
  const propose = useProposeProject()

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: defaults })

  useEffect(() => {
    if (open) reset(defaults)
  }, [open, reset])

  const onSubmit = async (raw: FormValues) => {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Periksa isian")
      return
    }
    try {
      const payload: ProjectProposalInput = {
        code: parsed.data.code,
        name: parsed.data.name,
        company_id: parsed.data.company_id,
        location: parsed.data.location?.trim() || null,
        start_date: parsed.data.start_date?.trim() || null,
        end_date: parsed.data.end_date?.trim() || null,
        notes: parsed.data.notes?.trim() || null,
        project_value: parsed.data.project_value,
        budget_amount: parsed.data.budget_amount,
      }
      await propose.mutateAsync(payload)
      toast.success("Proposal terkirim", {
        description: "Proyek akan aktif setelah disetujui admin pusat.",
      })
      reset(defaults)
      onClose()
    } catch (err) {
      toast.error("Gagal ajukan proposal", {
        description: apiErrorMessage(err),
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Ajukan Proyek Baru</DialogTitle>
          <DialogDescription>
            Proyek akan berstatus <strong>Menunggu Persetujuan</strong>. Setelah
            disetujui Admin Pusat / Superadmin, proyek aktif & Anda otomatis
            di-assign sebagai anggota tim.
          </DialogDescription>
        </DialogHeader>
        <form
          id="proposal-form"
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-col gap-3"
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Kode" required error={errors.code?.message}>
              <Input
                {...register("code")}
                placeholder="Mis. KNMP-MTR"
                className="font-mono"
                autoFocus
              />
            </Field>
            <Field label="Perusahaan" required error={errors.company_id?.message}>
              <Controller
                control={control}
                name="company_id"
                render={({ field }) => (
                  <CompanyPicker
                    value={field.value || null}
                    onChange={(v) => field.onChange(v ?? 0)}
                  />
                )}
              />
            </Field>
          </div>
          <Field label="Nama Proyek" required error={errors.name?.message}>
            <Input {...register("name")} placeholder="Mis. KNMP Mataram Fase 2" />
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
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nilai Kontrak">
              <Controller
                control={control}
                name="project_value"
                render={({ field }) => (
                  <AmountInput
                    value={field.value || null}
                    onChange={(v) => field.onChange(v ?? 0)}
                  />
                )}
              />
            </Field>
            <Field label="Budget Pengeluaran">
              <Controller
                control={control}
                name="budget_amount"
                render={({ field }) => (
                  <AmountInput
                    value={field.value || null}
                    onChange={(v) => field.onChange(v ?? 0)}
                  />
                )}
              />
            </Field>
          </div>
          <Field
            label="Catatan / Justifikasi"
            hint="Jelaskan singkat alasan/keperluan proyek (bantu admin saat review)."
          >
            <Textarea {...register("notes")} rows={3} placeholder="Mis. proyek lanjutan dr SPK ..." />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" form="proposal-form" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Ajukan Proposal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
