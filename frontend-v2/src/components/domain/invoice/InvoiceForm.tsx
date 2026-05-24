import { useEffect, useMemo, useState } from "react"
import { Controller, useForm, useFieldArray } from "react-hook-form"
import { Loader2, Plus, Sparkles, Trash2 } from "lucide-react"
import { z } from "zod"
import { toApiDate, fmtIDR } from "@/lib/format"
import { apiErrorMessage } from "@/lib/api"
import {
  useCreateInvoice,
  useUpdateInvoice,
  type InvoiceCreateInput,
  useUploadInvoiceAttachment,
  useLinkInvoiceAttachment,
} from "@/hooks/useInvoiceMutations"
import type { Invoice, InvoiceType } from "@/types/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { toast } from "@/components/ui/sonner"
import { AmountInput } from "@/components/forms/AmountInput"
import { AttachmentUploader } from "@/components/forms/AttachmentUploader"
import { DateInput } from "@/components/forms/DateInput"
import { ProjectPicker } from "@/components/forms/ProjectPicker"
import { CategoryPicker } from "@/components/forms/CategoryPicker"
import { useProject } from "@/hooks/useProjects"
import { ProjectStatusBanner } from "@/components/domain/project/ProjectStatusBanner"
import {
  useAICategorizeItems,
  type CategorizeItemSuggestion,
} from "@/hooks/useAICategorizeItems"
import { ScanButton, type ExtractedFields } from "@/components/forms/ScanButton"
import { VendorPicker } from "@/components/forms/VendorPicker"
import { useBreakpoint } from "@/lib/breakpoint"

const itemSchema = z.object({
  description: z.string().min(1, "Deskripsi wajib"),
  quantity: z.number({ invalid_type_error: "Qty wajib angka" }).positive("Qty > 0"),
  unit: z.string().nullable().optional(),
  unit_price: z.number({ invalid_type_error: "Harga wajib angka" }).nonnegative(),
  // Audit 2026-05-24: per-item kategori.
  category_id: z.number().nullable().optional(),
})

const schema = z.object({
  number: z.string().min(1, "Nomor invoice wajib"),
  project_id: z.number().min(1, "Pilih proyek"),
  type: z.enum(["IN", "OUT"]),
  invoice_date: z.string().min(1, "Tanggal wajib"),
  due_date: z.string().nullable().optional(),
  vendor_client_id: z.number().nullable().optional(),
  party_name: z.string().nullable().optional(),
  tax: z.number().nonnegative(),
  notes: z.string().nullable().optional(),
  items: z.array(itemSchema).min(1, "Minimal 1 item"),
})

type FormValues = z.infer<typeof schema>

interface InvoiceFormProps {
  open: boolean
  onClose: () => void
  invoice?: Invoice | null
  lockProjectId?: number | null
  /** Dipanggil setelah save sukses (create/update). Caller bisa pakai
   * utk re-open detail panel supaya user verifikasi hasil tanpa klik ulang. */
  onSaved?: (saved: Invoice) => void
}

export function InvoiceForm({ open, onClose, invoice, lockProjectId, onSaved }: InvoiceFormProps) {
  const bp = useBreakpoint()
  const isEdit = !!invoice
  const todayIso = useMemo(() => toApiDate(new Date()) ?? "", [])
  const initialProjectId = invoice?.project_id ?? lockProjectId ?? 0

  const defaultValues: FormValues = useMemo(
    () => ({
      number: invoice?.number ?? "",
      project_id: initialProjectId,
      type: invoice?.type ?? "IN",
      invoice_date: invoice?.invoice_date ?? todayIso,
      due_date: invoice?.due_date ?? null,
      vendor_client_id: invoice?.vendor_client_id ?? null,
      party_name: invoice?.party_name ?? "",
      tax: invoice ? Number(invoice.tax) : 0,
      notes: invoice?.notes ?? "",
      items:
        invoice?.items && invoice.items.length > 0
          ? invoice.items.map((it) => ({
              description: it.description,
              quantity: Number(it.quantity),
              unit: it.unit,
              unit_price: Number(it.unit_price),
              category_id: it.category_id ?? null,
            }))
          : [{
              description: "", quantity: 1, unit: null,
              unit_price: 0, category_id: null,
            }],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [invoice?.id, todayIso, initialProjectId],
  )

  const {
    control,
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues })

  const itemsField = useFieldArray({ control, name: "items" })

  // Audit 2026-05-24: AI bulk categorize per item.
  const aiCategorizeMut = useAICategorizeItems()
  const [aiSuggestions, setAiSuggestions] = useState<Record<number, CategorizeItemSuggestion>>({})

  const handleAICategorize = async () => {
    const data = getValues()
    const items = (data.items ?? []).filter((it) => it.description?.trim())
    if (items.length === 0) {
      toast.error("Isi deskripsi item dulu")
      return
    }
    const partyName = data.party_name ?? null
    try {
      const result = await aiCategorizeMut.mutateAsync({
        items: items.map((it) => ({
          description: it.description,
          quantity: it.quantity,
          unit: it.unit ?? null,
          unit_price: it.unit_price,
        })),
        direction: (data.type as "IN" | "OUT") || null,
        party_name: partyName,
        project_id: data.project_id,
        context_label: data.number ? `Invoice ${data.number}` : null,
      })
      // Map suggestion ke state + auto-fill kategori kalau confidence >= 0.7
      const byIdx: Record<number, CategorizeItemSuggestion> = {}
      let filled = 0
      let total = 0
      result.items.forEach((s) => {
        byIdx[s.index] = s
        total += 1
        if (s.category_id != null && s.confidence >= 0.7) {
          // Auto-fill kalau cell saat ini kosong; user yg sudah pilih
          // manual tdk di-overwrite.
          const cur = getValues(`items.${s.index}.category_id`)
          if (cur == null) {
            setValue(`items.${s.index}.category_id`, s.category_id, {
              shouldDirty: true,
            })
            filled += 1
          }
        }
      })
      setAiSuggestions(byIdx)
      toast.success(
        `AI selesai · ${filled}/${total} item auto-fill`,
        { description: "Item dgn confidence ≥ 70% diisi otomatis. Sisanya cek suggestion di bawah picker." },
      )
    } catch (e) {
      toast.error("AI kategori gagal", { description: apiErrorMessage(e) })
    }
  }

  // Audit 2026-05-23 UX integration A: scan button populate form values
  // dari OCR. Vendor match (kalau ada) di-suggest via toast, user bisa
  // accept/ignore (defer ke VendorPicker manual).
  const handleScanResult = (extracted: ExtractedFields) => {
    if (extracted.invoice_number)
      setValue("number", extracted.invoice_number, { shouldDirty: true })
    if (extracted.invoice_date)
      setValue("invoice_date", extracted.invoice_date, { shouldDirty: true })
    if (extracted.due_date)
      setValue("due_date", extracted.due_date, { shouldDirty: true })
    if (extracted.vendor_name && !getValues("party_name"))
      setValue("party_name", extracted.vendor_name, { shouldDirty: true })
    if (extracted.tax != null)
      setValue("tax", Number(extracted.tax) || 0, { shouldDirty: true })
    if (extracted.items && extracted.items.length > 0) {
      const mapped = extracted.items.map((it) => ({
        description: it.description || "(tanpa deskripsi)",
        quantity: Number(it.qty ?? 1) || 1,
        unit: it.unit ?? null,
        unit_price: Number(it.price ?? it.amount ?? 0) || 0,
      }))
      setValue("items", mapped, { shouldDirty: true })
    }
    if (extracted.notes)
      setValue("notes", (getValues("notes") || "") + (getValues("notes") ? "\n" : "") + extracted.notes, { shouldDirty: true })
    // Vendor match suggestion: tampilkan info toast (user pilih
    // manual via VendorPicker krn kompleks utk auto-set FK).
    if (extracted.vendor_match) {
      toast.message("Vendor cocok di database", {
        description: `${extracted.vendor_match.name} (skor ${Math.round(extracted.vendor_match.score * 100)}%). Pilih manual di dropdown vendor.`,
      })
    }
  }

  useEffect(() => {
    if (open) reset(defaultValues)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoice?.id])

  const create = useCreateInvoice()
  const update = useUpdateInvoice(invoice?.id ?? 0)
  const upload = useUploadInvoiceAttachment()
  const link = useLinkInvoiceAttachment()
  const [submitting, setSubmitting] = useState(false)
  // After CREATE -> switch ke attachment phase (sama dgn TransactionForm).
  const [justCreatedInv, setJustCreatedInv] = useState<Invoice | null>(null)

  useEffect(() => {
    if (!open) setJustCreatedInv(null)
  }, [open])

  const finishAndClose = () => {
    const saved = justCreatedInv
    setJustCreatedInv(null)
    onClose()
    if (saved) onSaved?.(saved)
  }

  // Live total
  const items = watch("items") ?? []
  const tax = watch("tax") ?? 0
  const subtotal = items.reduce(
    (s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0),
    0,
  )
  const total = subtotal + (Number(tax) || 0)

  const onSubmit = async (raw: FormValues) => {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      toast.error("Periksa kembali isian")
      return
    }
    setSubmitting(true)
    try {
      const payload: InvoiceCreateInput = {
        number: parsed.data.number,
        project_id: parsed.data.project_id,
        type: parsed.data.type,
        invoice_date: parsed.data.invoice_date,
        due_date: parsed.data.due_date || null,
        vendor_client_id: parsed.data.vendor_client_id ?? null,
        party_name: parsed.data.party_name?.trim() || null,
        tax: parsed.data.tax,
        notes: parsed.data.notes?.trim() || null,
        items: parsed.data.items.map((it) => ({
          description: it.description,
          quantity: it.quantity,
          unit: it.unit ?? null,
          unit_price: it.unit_price,
        })),
      }
      if (isEdit) {
        const saved = await update.mutateAsync(payload)
        toast.success("Invoice diperbarui")
        onClose()
        onSaved?.(saved)
      } else {
        const saved = await create.mutateAsync(payload)
        toast.success("Invoice tersimpan", {
          description: "Lanjut tambah bukti, atau klik Selesai.",
        })
        // Switch ke attachment phase -- user langsung upload bukti tanpa
        // harus tutup form + buka detail (konsisten dgn TransactionForm).
        setJustCreatedInv(saved)
      }
    } catch (err) {
      toast.error(isEdit ? "Gagal memperbarui" : "Gagal membuat invoice", {
        description: apiErrorMessage(err),
      })
    } finally {
      setSubmitting(false)
    }
  }

  const currentType = watch("type") as InvoiceType
  // Audit 2026-05-24 Phase 1: banner inline kalau proyek terpilih closed.
  const watchedProjectId = watch("project_id")
  const { data: selectedProject } = useProject(
    watchedProjectId && watchedProjectId > 0 ? watchedProjectId : null,
  )

  return (
    <Sheet open={open} onOpenChange={(v) => !v && (justCreatedInv ? finishAndClose() : onClose())}>
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
            onClick={justCreatedInv ? finishAndClose : onClose}
            className="text-sm font-medium text-ink-600 hover:text-ink-900"
          >
            {justCreatedInv ? "Selesai" : "Batal"}
          </button>
          <SheetTitle className="text-center flex-1">
            {justCreatedInv
              ? `Tambah Bukti — Invoice #${justCreatedInv.id}`
              : isEdit ? "Edit Invoice" : "Tambah Invoice"}
          </SheetTitle>
          {!justCreatedInv && !isEdit ? (
            <ScanButton
              onResult={handleScanResult}
              label="Scan"
              size="sm"
              iconStyle="camera"
              disabled={isSubmitting}
            />
          ) : (
            <div className="w-12" />
          )}
        </SheetHeader>

        {justCreatedInv ? (
          <InvoiceAttachmentPhase
            invoice={justCreatedInv}
            upload={upload}
            link={link}
            onFinish={finishAndClose}
          />
        ) : (
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-col flex-1 overflow-hidden"
        >
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 sm:px-5">
            {/* Banner status proyek non-AKTIF -- audit 2026-05-24 Phase 1. */}
            {selectedProject && (
              <ProjectStatusBanner
                status={selectedProject.status}
                sinceIso={selectedProject.updated_at}
              />
            )}
            {/* IN/OUT toggle */}
            <Controller
              control={control}
              name="type"
              render={({ field }) => (
                <div className="grid grid-cols-2 gap-2 rounded-md border border-border-strong bg-surface-muted p-1">
                  {(["IN", "OUT"] as const).map((v) => {
                    const active = field.value === v
                    return (
                      <button
                        key={v}
                        type="button"
                        onClick={() => field.onChange(v)}
                        className={
                          active
                            ? "h-9 rounded text-sm font-semibold bg-surface shadow " +
                              (v === "IN" ? "text-warning-700" : "text-info-700")
                            : "h-9 rounded text-sm text-ink-600"
                        }
                      >
                        {v === "IN" ? "Hutang (Inv. Masuk)" : "Piutang (Inv. Keluar)"}
                      </button>
                    )
                  })}
                </div>
              )}
            />

            <Field label="Nomor Invoice" required error={errors.number?.message}>
              <Input
                {...register("number")}
                placeholder={
                  currentType === "IN" ? "Mis. INV-VENDOR-2025-001" : "Mis. INV/2025/12/001"
                }
                className="font-mono"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Tanggal Invoice" required error={errors.invoice_date?.message}>
                <Controller
                  control={control}
                  name="invoice_date"
                  render={({ field }) => (
                    <DateInput value={field.value} onChange={(v) => field.onChange(v ?? "")} />
                  )}
                />
              </Field>
              <Field label="Jatuh Tempo">
                <Controller
                  control={control}
                  name="due_date"
                  render={({ field }) => (
                    <DateInput value={field.value} onChange={(v) => field.onChange(v)} />
                  )}
                />
              </Field>
            </div>

            <Field
              label="Proyek"
              required
              error={errors.project_id?.message}
              hint={
                isEdit
                  ? "Proyek tdk bisa diubah via edit. Kalau salah proyek: cancel invoice ini, lalu buat ulang di proyek benar."
                  : undefined
              }
            >
              <Controller
                control={control}
                name="project_id"
                render={({ field }) => (
                  <ProjectPicker
                    value={field.value || null}
                    onChange={(v) => field.onChange(v ?? 0)}
                    // Lock saat edit: project IMMUTABLE (backend 400).
                    disabled={isEdit || !!lockProjectId}
                  />
                )}
              />
            </Field>

            <Field label="Vendor / Klien">
              <Controller
                control={control}
                name="vendor_client_id"
                render={({ field }) => (
                  <VendorPicker value={field.value ?? null} onChange={field.onChange} />
                )}
              />
            </Field>

            <Field label="Nama Pihak (alternatif)" hint="Kalau vendor/klien belum terdaftar.">
              <Input {...register("party_name")} placeholder="Mis. PT Beton Jaya" />
            </Field>

            {/* Items */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <Label>Item / Rincian</Label>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleAICategorize}
                    disabled={aiCategorizeMut.isPending || itemsField.fields.length === 0}
                    title="AI saran kategori utk semua item"
                  >
                    {aiCategorizeMut.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    Saran kategori AI
                  </Button>
                </div>
              </div>
              <div className="flex items-center justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    itemsField.append({
                      description: "", quantity: 1, unit: null,
                      unit_price: 0, category_id: null,
                    })
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
                    <div
                      key={row.id}
                      className="rounded-md border bg-surface p-3 space-y-2"
                    >
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
                          {/* Audit 2026-05-24: per-item kategori. */}
                          <div>
                            <Label className="text-[10px]">Kategori</Label>
                            <Controller
                              control={control}
                              name={`items.${idx}.category_id` as const}
                              render={({ field }) => {
                                const sug = aiSuggestions[idx]
                                return (
                                  <div>
                                    <CategoryPicker
                                      value={field.value ?? null}
                                      onChange={(id) => field.onChange(id)}
                                      type={currentType as "IN" | "OUT"}
                                    />
                                    {sug && sug.category_id && (
                                      <div className="mt-1 text-[10px] text-ink-500 truncate">
                                        AI: <span className={
                                          sug.confidence >= 0.85
                                            ? "text-success-700"
                                            : sug.confidence >= 0.6
                                            ? "text-warning-700"
                                            : "text-ink-500"
                                        }>
                                          {sug.category_name}
                                          {" "}({Math.round(sug.confidence * 100)}%)
                                        </span>
                                        {" — "}{sug.reason}
                                      </div>
                                    )}
                                  </div>
                                )
                              }}
                            />
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

            <Field label="Pajak" hint="PPN/PPh kalau dipisah dari item.">
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

            <Field label="Catatan">
              <Textarea {...register("notes")} rows={2} placeholder="Catatan tambahan…" />
            </Field>

            {/* Live total preview */}
            <div className="rounded-md border bg-surface-muted p-3 space-y-1.5">
              <div className="flex justify-between text-[13px]">
                <span className="text-ink-600">Subtotal</span>
                <span className="font-mono font-semibold [font-variant-numeric:tabular-nums]">
                  {fmtIDR(subtotal)}
                </span>
              </div>
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
              {isEdit ? "Simpan Perubahan" : "Simpan Invoice"}
            </Button>
          </div>
        </form>
        )}
      </SheetContent>
    </Sheet>
  )
}

interface InvoiceAttachmentPhaseProps {
  invoice: Invoice
  upload: ReturnType<typeof useUploadInvoiceAttachment>
  link: ReturnType<typeof useLinkInvoiceAttachment>
  onFinish: () => void
}

function InvoiceAttachmentPhase({
  invoice,
  upload,
  link,
  onFinish,
}: InvoiceAttachmentPhaseProps) {
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        <div className="rounded-md border border-success-200 bg-success-50 p-3 text-[13px] text-success-800">
          Invoice <span className="font-mono font-semibold">#{invoice.id}</span>{" "}
          tersimpan sebagai DRAFT. Tambah bukti (file/link), atau klik{" "}
          <span className="font-semibold">Selesai</span> untuk tutup.
        </div>

        <div>
          <h3 className="text-sm font-semibold text-ink-900 mb-2">
            Bukti Invoice
          </h3>
          <AttachmentUploader
            uploadFile={(file, onProgress) =>
              upload
                .mutateAsync({ invoiceId: invoice.id, file, onProgress })
                .then(() => undefined)
            }
            linkExternal={(url, label) =>
              link
                .mutateAsync({ invoiceId: invoice.id, url, label })
                .then(() => undefined)
            }
            isLinking={link.isPending}
          />
        </div>

        <p className="text-[11px] text-ink-500">
          Tip: bisa skip dulu, tambah bukti dari detail invoice kapan saja.
        </p>
      </div>

      <div className="border-t bg-surface px-5 py-3 flex gap-2 pb-safe sticky bottom-0">
        <Button onClick={onFinish} className="flex-1">
          Selesai
        </Button>
      </div>
    </div>
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
