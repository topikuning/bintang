import { useEffect, useMemo, useState } from "react"
import { Controller, useForm, useFieldArray } from "react-hook-form"
import { Loader2, Plus, Trash2 } from "lucide-react"
import { z } from "zod"
import { fmtIDR, toApiDate } from "@/lib/format"
import { apiErrorMessage } from "@/lib/api"
import { useUIPrefs } from "@/store/ui-prefs"
import {
  useCreatePO,
  useUpdatePO,
  type POCreateInput,
} from "@/hooks/usePOMutations"
import type { PurchaseOrder } from "@/types/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { toast } from "@/components/ui/sonner"
import { AmountInput } from "@/components/forms/AmountInput"
import { DateInput } from "@/components/forms/DateInput"
import { ProjectPicker } from "@/components/forms/ProjectPicker"
import { CompanyPicker } from "@/components/forms/CompanyPicker"
import { VendorPicker } from "@/components/forms/VendorPicker"
import { useBreakpoint } from "@/lib/breakpoint"

const itemSchema = z.object({
  description: z.string().min(1, "Deskripsi wajib"),
  quantity: z.number().positive("Qty > 0"),
  unit: z.string().nullable().optional(),
  unit_price: z.number().nonnegative(),
})

const schema = z.object({
  project_id: z.number().min(1, "Pilih proyek"),
  company_id: z.number().min(1, "Pilih perusahaan"),
  vendor_client_id: z.number().nullable().optional(),
  vendor_name: z.string().nullable().optional(),
  po_date: z.string().min(1, "Tanggal wajib"),
  needed_date: z.string().nullable().optional(),
  tax: z.number().nonnegative(),
  discount: z.number().nonnegative(),
  payment_terms: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  items: z.array(itemSchema).min(1, "Minimal 1 item"),
})

type FormValues = z.infer<typeof schema>

interface POFormProps {
  open: boolean
  onClose: () => void
  po?: PurchaseOrder | null
  lockProjectId?: number | null
}

export function POForm({ open, onClose, po, lockProjectId }: POFormProps) {
  const bp = useBreakpoint()
  const { defaultProjectId } = useUIPrefs()
  const isEdit = !!po
  const todayIso = useMemo(() => toApiDate(new Date()) ?? "", [])
  const initialProjectId = po?.project_id ?? lockProjectId ?? defaultProjectId ?? 0

  const defaultValues: FormValues = useMemo(
    () => ({
      project_id: initialProjectId,
      company_id: po?.company_id ?? 0,
      vendor_client_id: po?.vendor_client_id ?? null,
      vendor_name: po?.vendor_name ?? "",
      po_date: po?.po_date ?? todayIso,
      needed_date: po?.needed_date ?? null,
      tax: po ? Number(po.tax) : 0,
      discount: po ? Number(po.discount) : 0,
      payment_terms: po?.payment_terms ?? "",
      notes: po?.notes ?? "",
      items:
        po?.items && po.items.length > 0
          ? po.items.map((it) => ({
              description: it.description,
              quantity: Number(it.quantity),
              unit: it.unit,
              unit_price: Number(it.unit_price),
            }))
          : [{ description: "", quantity: 1, unit: null, unit_price: 0 }],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [po?.id, todayIso, initialProjectId],
  )

  const {
    control,
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues })

  const itemsField = useFieldArray({ control, name: "items" })

  useEffect(() => {
    if (open) reset(defaultValues)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, po?.id])

  const create = useCreatePO()
  const update = useUpdatePO(po?.id ?? 0)
  const [submitting, setSubmitting] = useState(false)

  const items = watch("items") ?? []
  const tax = watch("tax") ?? 0
  const discount = watch("discount") ?? 0
  const subtotal = items.reduce(
    (s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0),
    0,
  )
  const total = subtotal - (Number(discount) || 0) + (Number(tax) || 0)

  const onSubmit = async (raw: FormValues) => {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      toast.error("Periksa kembali isian")
      return
    }
    setSubmitting(true)
    try {
      const payload: POCreateInput = {
        project_id: parsed.data.project_id,
        company_id: parsed.data.company_id,
        vendor_client_id: parsed.data.vendor_client_id ?? null,
        vendor_name: parsed.data.vendor_name?.trim() || null,
        po_date: parsed.data.po_date,
        needed_date: parsed.data.needed_date || null,
        tax: parsed.data.tax,
        discount: parsed.data.discount,
        payment_terms: parsed.data.payment_terms?.trim() || null,
        notes: parsed.data.notes?.trim() || null,
        items: parsed.data.items.map((it) => ({
          description: it.description,
          quantity: it.quantity,
          unit: it.unit ?? null,
          unit_price: it.unit_price,
        })),
      }
      if (isEdit) {
        await update.mutateAsync(payload)
        toast.success("PO diperbarui")
      } else {
        await create.mutateAsync(payload)
        toast.success("PO dibuat", {
          description: "Status awal: DRAFT. Klik Terbitkan setelah final.",
        })
      }
      onClose()
    } catch (err) {
      toast.error(isEdit ? "Gagal memperbarui" : "Gagal membuat PO", {
        description: apiErrorMessage(err),
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side={bp === "mobile" ? "full" : "right"}
        className={
          bp === "mobile"
            ? "flex flex-col p-0 pb-safe"
            : "w-full sm:max-w-2xl flex flex-col p-0"
        }
        hideClose
      >
        <SheetHeader className="border-b py-3 flex-row items-center justify-between gap-3 space-y-0 sticky top-0 bg-surface z-10">
          <button
            type="button"
            onClick={onClose}
            className="text-sm font-medium text-ink-600 hover:text-ink-900"
          >
            Batal
          </button>
          <SheetTitle className="text-center flex-1">
            {isEdit ? "Edit PO" : "Tambah PO"}
          </SheetTitle>
          <div className="w-12" />
        </SheetHeader>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-col flex-1 overflow-hidden"
        >
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 sm:px-5">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tanggal PO" required error={errors.po_date?.message}>
                <Controller
                  control={control}
                  name="po_date"
                  render={({ field }) => (
                    <DateInput value={field.value} onChange={(v) => field.onChange(v ?? "")} />
                  )}
                />
              </Field>
              <Field label="Butuh Tanggal">
                <Controller
                  control={control}
                  name="needed_date"
                  render={({ field }) => (
                    <DateInput value={field.value} onChange={(v) => field.onChange(v)} />
                  )}
                />
              </Field>
            </div>

            <Field label="Proyek" required error={errors.project_id?.message}>
              <Controller
                control={control}
                name="project_id"
                render={({ field }) => (
                  <ProjectPicker
                    value={field.value || null}
                    onChange={(v) => field.onChange(v ?? 0)}
                    disabled={!!lockProjectId}
                  />
                )}
              />
            </Field>

            <Field label="Perusahaan Penerbit" required error={errors.company_id?.message}>
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

            <Field label="Vendor">
              <Controller
                control={control}
                name="vendor_client_id"
                render={({ field }) => (
                  <VendorPicker
                    value={field.value ?? null}
                    onChange={field.onChange}
                    kind="VENDOR"
                  />
                )}
              />
            </Field>

            <Field label="Nama Vendor (alternatif)" hint="Kalau vendor belum terdaftar.">
              <Input {...register("vendor_name")} placeholder="Mis. PT Beton Jaya" />
            </Field>

            <Field label="Termin Pembayaran">
              <Input
                {...register("payment_terms")}
                placeholder="Mis. NET 30, DP 50% lalu pelunasan"
              />
            </Field>

            {/* Items */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Item PO</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    itemsField.append({ description: "", quantity: 1, unit: null, unit_price: 0 })
                  }
                >
                  <Plus className="h-3.5 w-3.5" />
                  Tambah Item
                </Button>
              </div>
              {errors.items && typeof errors.items.message === "string" && (
                <p className="text-[12px] text-danger-600">{errors.items.message}</p>
              )}
              <div className="flex flex-col gap-2">
                {itemsField.fields.map((row, idx) => {
                  const itm = items[idx]
                  const lineSubtotal =
                    (Number(itm?.quantity) || 0) * (Number(itm?.unit_price) || 0)
                  return (
                    <div key={row.id} className="rounded-md border bg-surface p-3 space-y-2">
                      <div className="flex items-start gap-2">
                        <div className="flex-1 space-y-2">
                          <Input
                            placeholder="Deskripsi item"
                            {...register(`items.${idx}.description` as const)}
                          />
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <Label className="text-[10px]">Qty</Label>
                              <Controller
                                control={control}
                                name={`items.${idx}.quantity` as const}
                                render={({ field }) => (
                                  <input
                                    type="number"
                                    inputMode="decimal"
                                    step="0.01"
                                    min="0"
                                    value={field.value ?? ""}
                                    onChange={(e) =>
                                      field.onChange(e.target.value === "" ? 0 : Number(e.target.value))
                                    }
                                    className="h-9 w-full rounded border border-border-strong bg-surface px-3 text-right font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                                  />
                                )}
                              />
                            </div>
                            <div>
                              <Label className="text-[10px]">Satuan</Label>
                              <Input
                                placeholder="pcs"
                                {...register(`items.${idx}.unit` as const)}
                                className="h-9"
                              />
                            </div>
                            <div>
                              <Label className="text-[10px]">Harga Satuan</Label>
                              <Controller
                                control={control}
                                name={`items.${idx}.unit_price` as const}
                                render={({ field }) => (
                                  <AmountInput
                                    value={field.value || null}
                                    onChange={(v) => field.onChange(v ?? 0)}
                                    prefix={null}
                                    className="h-9"
                                  />
                                )}
                              />
                            </div>
                          </div>
                          <div className="text-[12px] text-ink-500 flex justify-between">
                            <span>Subtotal item:</span>
                            <span className="font-mono font-semibold text-ink-900 [font-variant-numeric:tabular-nums]">
                              {fmtIDR(lineSubtotal)}
                            </span>
                          </div>
                        </div>
                        {itemsField.fields.length > 1 && (
                          <button
                            type="button"
                            onClick={() => itemsField.remove(idx)}
                            className="flex h-8 w-8 items-center justify-center rounded text-danger-600 hover:bg-danger-50"
                            aria-label="Hapus item"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Diskon">
                <Controller
                  control={control}
                  name="discount"
                  render={({ field }) => (
                    <AmountInput
                      value={field.value || null}
                      onChange={(v) => field.onChange(v ?? 0)}
                    />
                  )}
                />
              </Field>
              <Field label="Pajak">
                <Controller
                  control={control}
                  name="tax"
                  render={({ field }) => (
                    <AmountInput
                      value={field.value || null}
                      onChange={(v) => field.onChange(v ?? 0)}
                    />
                  )}
                />
              </Field>
            </div>

            <Field label="Catatan">
              <Textarea {...register("notes")} rows={2} placeholder="Catatan tambahan…" />
            </Field>

            <div className="rounded-md border bg-surface-muted p-3 space-y-1.5">
              <div className="flex justify-between text-[13px]">
                <span className="text-ink-600">Subtotal</span>
                <span className="font-mono font-semibold [font-variant-numeric:tabular-nums]">
                  {fmtIDR(subtotal)}
                </span>
              </div>
              {Number(discount) > 0 && (
                <div className="flex justify-between text-[13px]">
                  <span className="text-ink-600">Diskon</span>
                  <span className="font-mono text-danger-700 [font-variant-numeric:tabular-nums]">
                    − {fmtIDR(discount)}
                  </span>
                </div>
              )}
              {Number(tax) > 0 && (
                <div className="flex justify-between text-[13px]">
                  <span className="text-ink-600">Pajak</span>
                  <span className="font-mono [font-variant-numeric:tabular-nums]">
                    {fmtIDR(tax)}
                  </span>
                </div>
              )}
              <div className="flex justify-between border-t pt-1.5 text-base">
                <span className="font-semibold">TOTAL</span>
                <span className="font-mono font-bold [font-variant-numeric:tabular-nums]">
                  {fmtIDR(total)}
                </span>
              </div>
            </div>
          </div>

          <div className="border-t bg-surface px-4 py-3 flex gap-2 pb-safe sticky bottom-0">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              className="flex-1"
              disabled={submitting || isSubmitting}
            >
              Batal
            </Button>
            <Button type="submit" className="flex-1" disabled={submitting || isSubmitting}>
              {(submitting || isSubmitting) && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEdit ? "Simpan Perubahan" : "Simpan PO"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
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
    <div className="flex flex-col gap-1.5">
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
