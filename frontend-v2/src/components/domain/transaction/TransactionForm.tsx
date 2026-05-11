import { useEffect, useMemo, useState } from "react"
import { useForm, Controller, useFieldArray } from "react-hook-form"
import { Loader2, Plus, Trash2 } from "lucide-react"
import { z } from "zod"
import { toApiDate } from "@/lib/format"
import { apiErrorMessage } from "@/lib/api"
import { useUIPrefs } from "@/store/ui-prefs"
import {
  useCreateTransaction,
  useUpdateTransaction,
  type TransactionInput,
} from "@/hooks/useTransactionMutations"
import { useUsers } from "@/hooks/useUsers"
import { useAuthStore } from "@/store/auth"
import type { PaymentMethod, Transaction, TxnKind, TxnType } from "@/types/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { toast } from "@/components/ui/sonner"
import { AmountInput } from "@/components/forms/AmountInput"
import { DateInput } from "@/components/forms/DateInput"
import { ProjectPicker } from "@/components/forms/ProjectPicker"
import { CategoryPicker } from "@/components/forms/CategoryPicker"
import { VendorPicker } from "@/components/forms/VendorPicker"
import { useBreakpoint } from "@/lib/breakpoint"

const PAYMENT_OPTIONS: Array<{ value: PaymentMethod; label: string }> = [
  { value: "TRANSFER", label: "Transfer Bank" },
  { value: "CASH", label: "Tunai" },
  { value: "QRIS", label: "QRIS" },
  { value: "OTHER", label: "Lainnya" },
]

const itemSchema = z.object({
  category_id: z.number().nullable().optional(),
  description: z.string().min(1, "Deskripsi wajib"),
  amount: z.number().positive("Harus > 0"),
})

const schema = z.object({
  project_id: z.number({ required_error: "Pilih proyek" }).min(1, "Pilih proyek"),
  tx_date: z.string().min(1, "Tanggal wajib diisi"),
  type: z.enum(["IN", "OUT"]),
  kind: z.enum(["INVOICE_PAYMENT", "CASH_ADVANCE", "DIRECT_EXPENSE"]),
  amount: z.number({ required_error: "Nominal wajib diisi" }).positive("Nominal harus lebih dari 0"),
  category_id: z.number().nullable().optional(),
  vendor_client_id: z.number().nullable().optional(),
  party_name: z.string().nullable().optional(),
  payment_method: z.enum(["TRANSFER", "CASH", "QRIS", "OTHER"]),
  reference_no: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  // CASH_ADVANCE recipient (hybrid)
  recipient_user_id: z.number().nullable().optional(),
  recipient_name: z.string().nullable().optional(),
  // DIRECT_EXPENSE rincian items
  items: z.array(itemSchema).default([]),
})

type FormValues = z.infer<typeof schema>

const KIND_LABEL: Record<TxnKind, { label: string; hint: string }> = {
  INVOICE_PAYMENT: {
    label: "Bayar Invoice",
    hint: "Pembayaran ke vendor (ada nomor invoice/PO).",
  },
  CASH_ADVANCE: {
    label: "Uang Muka Personal",
    hint: "Kasbon ke karyawan/staff. Perlu pertanggungjawaban (settle) nanti.",
  },
  DIRECT_EXPENSE: {
    label: "Beban Langsung",
    hint: "Pengeluaran tanpa invoice (struk/kwitansi). Rincikan per item.",
  },
}

interface TransactionFormProps {
  open: boolean
  onClose: () => void
  /** Kalau diisi -> mode edit. Kalau null -> mode create. */
  transaction?: Transaction | null
  /** Jika create dr context proyek tertentu, lock proyek. */
  lockProjectId?: number | null
}

export function TransactionForm({
  open,
  onClose,
  transaction,
  lockProjectId,
}: TransactionFormProps) {
  const bp = useBreakpoint()
  const { defaultProjectId } = useUIPrefs()
  const isEdit = !!transaction
  const initialProjectId =
    transaction?.project_id ?? lockProjectId ?? defaultProjectId ?? 0

  const todayIso = useMemo(() => toApiDate(new Date()) ?? "", [])

  const defaultValues: FormValues = useMemo(
    () => ({
      project_id: initialProjectId,
      tx_date: transaction?.tx_date ?? todayIso,
      type: transaction?.type ?? "OUT",
      kind: (transaction?.kind as TxnKind | undefined) ?? "INVOICE_PAYMENT",
      amount: transaction ? Number(transaction.amount) : 0,
      category_id: transaction?.category_id ?? null,
      vendor_client_id: transaction?.vendor_client_id ?? null,
      party_name: transaction?.party_name ?? "",
      payment_method: transaction?.payment_method ?? "TRANSFER",
      reference_no: transaction?.reference_no ?? "",
      description: transaction?.description ?? "",
      recipient_user_id: transaction?.recipient_user_id ?? null,
      recipient_name: transaction?.recipient_name ?? "",
      items:
        (transaction?.items ?? []).map((it) => ({
          category_id: it.category_id ?? null,
          description: it.description,
          amount: Number(it.amount ?? 0),
        })),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transaction?.id, todayIso, initialProjectId],
  )

  const {
    control,
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues })

  const itemsArr = useFieldArray({ control, name: "items" })
  const usersQ = useUsers({ size: 200 })
  // God-mode: SUPERADMIN bisa ubah kind walau edit -- selama tx belum
  // ter-alokasi ke invoice. Backend tetap validate (403 kalau non-superadmin
  // atau 409 kalau ada allocation).
  const role = useAuthStore((s) => s.user?.role)
  const isSuperAdmin = role === "SUPERADMIN"
  const kindLocked = isEdit && !isSuperAdmin

  // Reset saat sheet baru dibuka atau transaction berubah
  useEffect(() => {
    if (open) reset(defaultValues)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, transaction?.id])

  const create = useCreateTransaction()
  const update = useUpdateTransaction(transaction?.id ?? 0)
  const [submitting, setSubmitting] = useState(false)

  const onSubmit = async (raw: FormValues) => {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      toast.error("Periksa kembali isian")
      return
    }
    setSubmitting(true)
    try {
      const d = parsed.data
      // Untuk IN, kind selalu INVOICE_PAYMENT (CASH_ADVANCE & DIRECT_EXPENSE OUT-only)
      const effectiveKind: TxnKind = d.type === "IN" ? "INVOICE_PAYMENT" : d.kind
      const isAdvance = effectiveKind === "CASH_ADVANCE"
      const isDirect = effectiveKind === "DIRECT_EXPENSE"
      // Validate recipient (CASH_ADVANCE)
      if (isAdvance && !d.recipient_user_id && !d.recipient_name?.trim()) {
        toast.error("Penerima uang muka wajib diisi (pilih user atau ketik nama)")
        setSubmitting(false)
        return
      }
      // Validate items + amount sum (DIRECT_EXPENSE)
      if (isDirect) {
        if (d.items.length === 0) {
          toast.error("Tambahkan minimal 1 rincian item")
          setSubmitting(false)
          return
        }
        const sum = d.items.reduce((acc, it) => acc + Number(it.amount || 0), 0)
        if (Math.abs(sum - d.amount) > 0.01) {
          toast.error("Total nominal tidak cocok dgn jumlah rincian", {
            description: `Nominal: ${d.amount.toLocaleString("id-ID")} | Sum item: ${sum.toLocaleString("id-ID")}`,
          })
          setSubmitting(false)
          return
        }
      }
      const payload: TransactionInput = {
        project_id: d.project_id,
        tx_date: d.tx_date,
        type: d.type,
        kind: effectiveKind,
        amount: d.amount,
        category_id: d.category_id ?? null,
        vendor_client_id: isAdvance || isDirect ? null : d.vendor_client_id ?? null,
        party_name: isAdvance || isDirect ? null : d.party_name?.trim() || null,
        payment_method: d.payment_method,
        reference_no: d.reference_no?.trim() || null,
        description: d.description?.trim() || null,
        recipient_user_id: isAdvance ? d.recipient_user_id ?? null : null,
        recipient_name: isAdvance ? d.recipient_name?.trim() || null : null,
        items: isDirect
          ? d.items.map((it) => ({
              category_id: it.category_id ?? null,
              description: it.description,
              amount: Number(it.amount),
            }))
          : undefined,
      }
      if (isEdit && transaction) {
        await update.mutateAsync(payload)
        toast.success("Transaksi diperbarui")
      } else {
        await create.mutateAsync(payload)
        toast.success("Transaksi berhasil dibuat", {
          description: "Status awal: Draft. Submit utk validasi.",
        })
      }
      onClose()
    } catch (err) {
      toast.error(isEdit ? "Gagal memperbarui" : "Gagal membuat transaksi", {
        description: apiErrorMessage(err),
      })
    } finally {
      setSubmitting(false)
    }
  }

  const currentType = watch("type") as TxnType
  const currentKind = watch("kind") as TxnKind
  // Untuk IN, paksa INVOICE_PAYMENT supaya conditional logic konsisten.
  const effectiveKind: TxnKind = currentType === "IN" ? "INVOICE_PAYMENT" : currentKind
  const isAdvance = effectiveKind === "CASH_ADVANCE"
  const isDirect = effectiveKind === "DIRECT_EXPENSE"
  const items = watch("items") || []
  const itemsSum = items.reduce(
    (acc, it) => acc + Number(it?.amount || 0),
    0,
  )

  // Auto-sync amount = sum(items) untuk DIRECT_EXPENSE.
  useEffect(() => {
    if (isDirect) {
      setValue("amount", itemsSum, { shouldValidate: false })
    }
  }, [isDirect, itemsSum, setValue])

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side={bp === "mobile" ? "full" : "right"}
        className={
          bp === "mobile"
            ? "flex flex-col p-0 pb-safe"
            : "w-full sm:max-w-lg flex flex-col p-0"
        }
        hideClose
      >
        {/* Header */}
        <SheetHeader className="border-b py-3 flex-row items-center justify-between gap-3 space-y-0 sticky top-0 bg-surface z-10">
          <button
            type="button"
            onClick={onClose}
            className="text-sm font-medium text-ink-600 hover:text-ink-900"
          >
            Batal
          </button>
          <SheetTitle className="text-center flex-1">
            {isEdit ? "Edit Transaksi" : "Tambah Transaksi"}
          </SheetTitle>
          <div className="w-12" />
        </SheetHeader>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-col flex-1 overflow-hidden"
        >
          {/* Body scroll */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {/* IN / OUT toggle */}
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
                              (v === "IN" ? "text-success-700" : "text-danger-700")
                            : "h-9 rounded text-sm text-ink-600"
                        }
                      >
                        {v === "IN" ? "Pemasukan" : "Pengeluaran"}
                      </button>
                    )
                  })}
                </div>
              )}
            />

            {/* Kind picker -- hanya tampil utk OUT. IN selalu INVOICE_PAYMENT. */}
            {currentType === "OUT" && (
              <Field
                label="Jenis Pengeluaran"
                required
                hint={KIND_LABEL[effectiveKind].hint}
              >
                <Controller
                  control={control}
                  name="kind"
                  render={({ field }) => (
                    <div className="grid grid-cols-3 gap-1.5">
                      {(Object.keys(KIND_LABEL) as TxnKind[]).map((k) => {
                        const active = field.value === k
                        return (
                          <button
                            key={k}
                            type="button"
                            disabled={kindLocked}
                            onClick={() => field.onChange(k)}
                            className={
                              "h-9 rounded border text-[12px] font-medium px-1 " +
                              (active
                                ? "border-brand-500 bg-brand-50 text-brand-700"
                                : "border-border-strong bg-surface text-ink-600 hover:bg-ink-50") +
                              (kindLocked ? " opacity-60 cursor-not-allowed" : "")
                            }
                            title={KIND_LABEL[k].hint}
                          >
                            {KIND_LABEL[k].label}
                          </button>
                        )
                      })}
                    </div>
                  )}
                />
                {isEdit && kindLocked && (
                  <p className="text-[11px] text-ink-500">
                    Jenis terkunci setelah transaksi dibuat (audit). Hubungi
                    SUPERADMIN bila perlu koreksi.
                  </p>
                )}
                {isEdit && isSuperAdmin && (
                  <p className="text-[11px] text-warning-700">
                    God-mode: jenis bisa diubah selama tx belum ter-alokasi
                    ke invoice. Pindah jenis akan reset field yg tdk berlaku
                    (mis. invoice_id, recipient, items).
                  </p>
                )}
              </Field>
            )}

            <Field label="Tanggal" required error={errors.tx_date?.message}>
              <Controller
                control={control}
                name="tx_date"
                render={({ field }) => (
                  <DateInput value={field.value} onChange={(v) => field.onChange(v ?? "")} />
                )}
              />
            </Field>

            <Field
              label={isDirect ? "Nominal Total (otomatis = sum rincian)" : "Nominal"}
              required
              error={errors.amount?.message}
            >
              <Controller
                control={control}
                name="amount"
                render={({ field }) => (
                  <AmountInput
                    value={field.value || null}
                    onChange={(v) => field.onChange(v ?? 0)}
                    placeholder="0"
                    disabled={isDirect}
                  />
                )}
              />
            </Field>

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

            {/* CASH_ADVANCE: recipient picker (User combobox + nama bebas) */}
            {isAdvance && (
              <>
                <Field
                  label="Penerima (User)"
                  hint="Pilih kalau penerima sudah punya akun. Kalau tidak, kosongkan dan isi 'Nama penerima' di bawah."
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
                        <option value="">— Pilih user —</option>
                        {(usersQ.data?.items ?? []).map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name} ({u.email})
                          </option>
                        ))}
                      </Select>
                    )}
                  />
                </Field>
                <Field label="Nama penerima (alternatif)">
                  <Input
                    {...register("recipient_name")}
                    placeholder="Mis. Pak Joko (mandor lapangan)"
                  />
                </Field>
              </>
            )}

            {/* DIRECT_EXPENSE: multi-line items */}
            {isDirect && (
              <Field
                label="Rincian Pengeluaran"
                required
                hint="Tambahkan per item belanja (mis. ATK, bensin, parkir, dll)."
              >
                <div className="rounded border bg-surface-muted/40 p-2 space-y-2">
                  {itemsArr.fields.length === 0 ? (
                    <p className="text-[12px] text-ink-500 italic px-1">
                      Belum ada rincian. Klik "Tambah Item" di bawah.
                    </p>
                  ) : (
                    itemsArr.fields.map((f, idx) => (
                      <div
                        key={f.id}
                        className="grid grid-cols-12 gap-1.5 items-start rounded bg-surface p-2 border"
                      >
                        <div className="col-span-12 sm:col-span-5">
                          <Input
                            {...register(`items.${idx}.description`)}
                            placeholder="Deskripsi (mis. Beli ATK)"
                            className="h-9 text-sm"
                          />
                        </div>
                        <div className="col-span-5 sm:col-span-3">
                          <Controller
                            control={control}
                            name={`items.${idx}.category_id`}
                            render={({ field }) => (
                              <CategoryPicker
                                value={field.value ?? null}
                                onChange={field.onChange}
                                type="OUT"
                              />
                            )}
                          />
                        </div>
                        <div className="col-span-6 sm:col-span-3">
                          <Controller
                            control={control}
                            name={`items.${idx}.amount`}
                            render={({ field }) => (
                              <AmountInput
                                value={field.value || null}
                                onChange={(v) => field.onChange(v ?? 0)}
                                placeholder="0"
                              />
                            )}
                          />
                        </div>
                        <div className="col-span-1 flex justify-end">
                          <button
                            type="button"
                            onClick={() => itemsArr.remove(idx)}
                            className="flex h-8 w-8 items-center justify-center rounded text-danger-500 hover:bg-danger-50"
                            aria-label="Hapus item"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      itemsArr.append({
                        category_id: null,
                        description: "",
                        amount: 0,
                      })
                    }
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Tambah Item
                  </Button>
                  {items.length > 0 && (
                    <div className="text-right text-[12px] text-ink-700 pt-1 border-t">
                      Total:{" "}
                      <span className="font-semibold tabular-nums">
                        Rp {itemsSum.toLocaleString("id-ID")}
                      </span>
                    </div>
                  )}
                </div>
              </Field>
            )}

            {/* Kategori, vendor, party -- hanya tampil utk INVOICE_PAYMENT */}
            {!isAdvance && !isDirect && (
              <>
                <Field label="Kategori">
                  <Controller
                    control={control}
                    name="category_id"
                    render={({ field }) => (
                      <CategoryPicker
                        value={field.value ?? null}
                        onChange={field.onChange}
                        type={currentType}
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
                  <Input
                    {...register("party_name")}
                    placeholder="Mis. PT Beton Jaya"
                  />
                </Field>
              </>
            )}

            <Field label="Metode Pembayaran" required>
              <Controller
                control={control}
                name="payment_method"
                render={({ field }) => (
                  <Select value={field.value} onChange={(e) => field.onChange(e.target.value as PaymentMethod)}>
                    {PAYMENT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </Select>
                )}
              />
            </Field>

            <Field label="No. Referensi" hint="No. invoice, kuitansi, dll.">
              <Input {...register("reference_no")} placeholder="Mis. INV/2025/12/001" />
            </Field>

            <Field label="Deskripsi">
              <Textarea {...register("description")} rows={3} placeholder="Catatan tambahan…" />
            </Field>
          </div>

          {/* Footer sticky */}
          <div className="border-t bg-surface px-5 py-3 flex gap-2 pb-safe sticky bottom-0">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              className="flex-1"
              disabled={submitting || isSubmitting}
            >
              Batal
            </Button>
            <Button
              type="submit"
              className="flex-1"
              disabled={submitting || isSubmitting}
            >
              {(submitting || isSubmitting) && <Loader2 className="h-4 w-4 animate-spin" />}
              {isEdit ? "Simpan Perubahan" : "Simpan Transaksi"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}

interface FieldProps {
  label: string
  required?: boolean
  hint?: string
  error?: string
  children: React.ReactNode
}

function Field({ label, required, hint, error, children }: FieldProps) {
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
