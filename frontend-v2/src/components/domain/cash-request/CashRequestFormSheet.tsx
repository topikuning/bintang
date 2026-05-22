import { useEffect } from "react"
import { Loader2, Plus, Trash2 } from "lucide-react"
import { useForm, useFieldArray, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { DraggableSheet } from "@/components/ui/draggable-sheet"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/sonner"
import { ProjectPicker } from "@/components/forms/ProjectPicker"
import {
  useCreateCashRequest,
  useUpdateCashRequest,
} from "@/hooks/useCashRequests"
import { useUsersLookup } from "@/hooks/useUsers"
import { useCategories } from "@/hooks/useCategories"
import { apiErrorMessage } from "@/lib/api"
import { useBreakpoint } from "@/lib/breakpoint"
import { fmtIDR } from "@/lib/format"
import type {
  CashRequest,
  CashRequestCreateInput,
  CashRequestItemInput,
  CashRequestUpdateInput,
} from "@/types/api"

interface Props {
  open: boolean
  onClose: () => void
  target: CashRequest | null
}

// Audit 2026-05-22 #H7: refactor dari 7 useState ad-hoc ke RHF + zod.
// Manfaat: validasi terpusat, field array utk items, control re-render
// per-field (sebelumnya tiap keystroke re-render seluruh form).
//
// Strategi parsing angka: input string ("5.000.000" Indonesian thousands),
// disimpan as string di form, di-parse jadi number saat submit/total.
// Validasi di submit time -- bukan di-coerce di schema -- supaya placeholder
// tdk dianggap invalid saat user belum input.

const itemSchema = z.object({
  category_id: z.number().nullable(),
  description: z.string(),
  quantity: z.string(),
  unit_price: z.string(),
  amount: z.string(),
})

const formSchema = z.object({
  project_id: z.number().nullable(),
  recipient_user_id: z.number().nullable(),
  request_date: z.string().min(1, "Tanggal wajib"),
  title: z.string().trim().min(1, "Judul wajib").max(200),
  notes: z.string(),
  items: z.array(itemSchema).min(1),
})

type FormValues = z.infer<typeof formSchema>

function emptyItem(): FormValues["items"][number] {
  return {
    category_id: null,
    description: "",
    quantity: "",
    unit_price: "",
    amount: "",
  }
}

function toNum(s: string): number {
  if (!s) return 0
  // Buang semua selain digit dan titik. Indonesian users sering pakai
  // "5.000.000" -- diperlakukan sebagai pemisah ribuan, jadi strip dots.
  const cleaned = s.replace(/\./g, "").replace(/,/g, ".")
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

function defaultValues(target: CashRequest | null): FormValues {
  if (target) {
    return {
      project_id: target.project_id,
      recipient_user_id: target.recipient_user_id ?? null,
      request_date: target.request_date,
      title: target.title,
      notes: target.notes ?? "",
      items:
        target.items.length > 0
          ? target.items.map((it) => ({
              category_id: it.category_id,
              description: it.description,
              quantity: it.quantity ?? "",
              unit_price: it.unit_price ?? "",
              amount: String(it.amount),
            }))
          : [emptyItem()],
    }
  }
  return {
    project_id: null,
    recipient_user_id: null,
    request_date: new Date().toISOString().slice(0, 10),
    title: "",
    notes: "",
    items: [emptyItem()],
  }
}

export function CashRequestFormSheet({ open, onClose, target }: Props) {
  const bp = useBreakpoint()
  const isEdit = !!target
  const create = useCreateCashRequest()
  const update = useUpdateCashRequest(target?.id ?? 0)
  const usersQuery = useUsersLookup()
  const catQuery = useCategories()

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: defaultValues(target),
    mode: "onSubmit",
  })
  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { isSubmitting },
  } = form
  const { fields, append, remove } = useFieldArray({ control, name: "items" })

  // Re-seed values saat sheet dibuka utk target berbeda.
  useEffect(() => {
    if (open) reset(defaultValues(target))
  }, [open, target, reset])

  const items = watch("items")
  const totalAmount = items.reduce((sum, it) => sum + toNum(it.amount), 0)

  // Auto-fill amount dari qty * unit_price saat keduanya terisi.
  const handleQtyOrPriceChange = (idx: number) => {
    const cur = items[idx]
    if (!cur) return
    const qty = toNum(cur.quantity)
    const price = toNum(cur.unit_price)
    if (qty > 0 && price > 0) {
      setValue(`items.${idx}.amount`, String(Math.round(qty * price)), {
        shouldDirty: true,
      })
    }
  }

  const onSubmit = async (values: FormValues) => {
    // project_id null guarded di submit (zod schema nullable supaya
    // resolver type tdk konflik dgn defaultValues null).
    if (values.project_id == null) {
      toast.error("Pilih proyek")
      return
    }
    const projectId = values.project_id
    const validItems = values.items
      .filter((it) => it.description.trim() && toNum(it.amount) > 0)
      .map<CashRequestItemInput>((it) => ({
        category_id: it.category_id,
        description: it.description.trim(),
        quantity: it.quantity ? toNum(it.quantity) : null,
        unit_price: it.unit_price ? toNum(it.unit_price) : null,
        amount: toNum(it.amount),
      }))
    if (validItems.length === 0) {
      toast.error("Minimal 1 item dgn deskripsi & jumlah > 0")
      return
    }
    try {
      if (isEdit) {
        const payload: CashRequestUpdateInput = {
          project_id: projectId,
          recipient_user_id: values.recipient_user_id,
          request_date: values.request_date,
          title: values.title.trim(),
          notes: values.notes.trim() || null,
          items: validItems,
        }
        await update.mutateAsync(payload)
        toast.success("Pengajuan diperbarui")
      } else {
        const payload: CashRequestCreateInput = {
          project_id: projectId,
          recipient_user_id: values.recipient_user_id,
          request_date: values.request_date,
          title: values.title.trim(),
          notes: values.notes.trim() || null,
          items: validItems,
        }
        await create.mutateAsync(payload)
        toast.success("Pengajuan dibuat", {
          description: "Menunggu approval CENTRAL/SUPERADMIN.",
        })
      }
      onClose()
    } catch (err) {
      toast.error(isEdit ? "Gagal update" : "Gagal buat pengajuan", {
        description: apiErrorMessage(err),
      })
    }
  }

  const onInvalid = (errors: typeof form.formState.errors) => {
    const first = errors.title?.message || errors.request_date?.message
    if (typeof first === "string") toast.error(first)
  }

  const users = usersQuery.data ?? []
  const categories = catQuery.data?.items ?? []

  const body = (
    <div className="flex flex-col gap-3 px-4 py-4 sm:px-5">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tanggal" required>
          <Input type="date" {...register("request_date")} />
        </Field>
        <Field label="Proyek" required>
          {/* Sengaja TIDAK include NON_PROJECT: pengajuan dana adalah
              workflow operasional proyek, bukan bucket Catatan Non-Proyek
              (yg SUPERADMIN-only & untuk pencatatan langsung tanpa
              workflow). Backend juga reject project_id NON_PROJECT. */}
          <Controller
            control={control}
            name="project_id"
            render={({ field }) => (
              <ProjectPicker
                value={field.value}
                onChange={(v) => field.onChange(v)}
              />
            )}
          />
        </Field>
      </div>
      <Field label="Judul / Maksud Pengajuan" required>
        <Input
          placeholder="Mis. Belanja material minggu 12 Mei"
          maxLength={200}
          {...register("title")}
        />
      </Field>
      <Field
        label="Penerima Dana"
        hint="Kosongkan kalau penerima = pengaju (Anda sendiri)."
      >
        <Controller
          control={control}
          name="recipient_user_id"
          render={({ field }) => (
            <Select
              value={field.value ?? ""}
              onChange={(e) =>
                field.onChange(e.target.value ? Number(e.target.value) : null)
              }
            >
              <option value="">— Saya sendiri —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          )}
        />
      </Field>

      {/* Items */}
      <div className="flex flex-col gap-2 rounded-md border bg-ink-50 p-3">
        <div className="flex items-center justify-between">
          <Label className="text-[12px] uppercase tracking-wider">
            Rincian Belanja
          </Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => append(emptyItem())}
            className="h-7 text-[12px]"
          >
            <Plus className="h-3 w-3" />
            Tambah baris
          </Button>
        </div>

        {fields.map((f, idx) => (
          <div
            key={f.id}
            className="flex flex-col gap-2 rounded border bg-surface p-2"
          >
            <div className="flex items-start gap-2">
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-2">
                <Input
                  placeholder="Deskripsi (mis. Semen 50 sak)"
                  maxLength={300}
                  {...register(`items.${idx}.description`)}
                />
                <Controller
                  control={control}
                  name={`items.${idx}.category_id`}
                  render={({ field }) => (
                    <Select
                      value={field.value ?? ""}
                      onChange={(e) =>
                        field.onChange(
                          e.target.value ? Number(e.target.value) : null,
                        )
                      }
                    >
                      <option value="">Tanpa kategori</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                  )}
                />
              </div>
              {fields.length > 1 && (
                <button
                  type="button"
                  onClick={() => remove(idx)}
                  className="flex h-9 w-9 items-center justify-center rounded text-danger-500 hover:bg-danger-50 shrink-0"
                  aria-label="Hapus baris"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Qty" compact>
                <Input
                  inputMode="decimal"
                  placeholder="(opsional)"
                  className="font-mono text-right"
                  {...register(`items.${idx}.quantity`, {
                    onChange: () => handleQtyOrPriceChange(idx),
                  })}
                />
              </Field>
              <Field label="Harga Satuan" compact>
                <Input
                  inputMode="decimal"
                  placeholder="(opsional)"
                  className="font-mono text-right"
                  {...register(`items.${idx}.unit_price`, {
                    onChange: () => handleQtyOrPriceChange(idx),
                  })}
                />
              </Field>
              <Field label="Total" compact>
                <Input
                  inputMode="decimal"
                  placeholder="0"
                  className="font-mono text-right font-semibold"
                  {...register(`items.${idx}.amount`)}
                />
              </Field>
            </div>
          </div>
        ))}

        <div className="mt-1 flex items-center justify-between rounded bg-brand-50 px-3 py-2 text-sm">
          <span className="font-medium text-brand-800">Total Pengajuan</span>
          <span className="font-mono text-base font-bold text-brand-900">
            Rp {fmtIDR(totalAmount)}
          </span>
        </div>
      </div>

      <Field label="Catatan" hint="Opsional. Tampil di detail pengajuan.">
        <Textarea
          rows={2}
          placeholder="Detail tambahan / justifikasi"
          {...register("notes")}
        />
      </Field>
    </div>
  )

  const footer = (
    <div className="flex gap-2 px-4 py-3 sm:px-5 border-t bg-surface pb-safe">
      <Button
        type="button"
        variant="secondary"
        onClick={onClose}
        className="flex-1"
      >
        Batal
      </Button>
      <Button
        type="button"
        onClick={handleSubmit(onSubmit, onInvalid)}
        className="flex-1"
        disabled={isSubmitting}
      >
        {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
        {isEdit ? "Simpan" : "Ajukan"}
      </Button>
    </div>
  )

  if (bp === "mobile") {
    return (
      <DraggableSheet
        open={open}
        onOpenChange={(o) => !o && onClose()}
        title={isEdit ? "Edit Pengajuan" : "Pengajuan Dana Baru"}
        footer={footer}
      >
        {body}
      </DraggableSheet>
    )
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl flex flex-col p-0"
      >
        <SheetHeader className="border-b">
          <SheetTitle>
            {isEdit ? "Edit Pengajuan" : "Pengajuan Dana Baru"}
          </SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto">{body}</div>
        {footer}
      </SheetContent>
    </Sheet>
  )
}

function Field({
  label,
  required,
  hint,
  compact,
  children,
}: {
  label: string
  required?: boolean
  hint?: string
  compact?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label className={compact ? "text-[10px] uppercase tracking-wider text-ink-500" : "text-[12px] uppercase tracking-wider"}>
        {label}
        {required && <span className="text-danger-600 ml-0.5">*</span>}
      </Label>
      {children}
      {hint && <p className="text-[11px] text-ink-500">{hint}</p>}
    </div>
  )
}
