import { useEffect, useMemo, useState } from "react"
import { useForm, Controller } from "react-hook-form"
import { Loader2 } from "lucide-react"
import { z } from "zod"
import { toApiDate } from "@/lib/format"
import { apiErrorMessage } from "@/lib/api"
import { useUIPrefs } from "@/store/ui-prefs"
import {
  useCreateTransaction,
  useUpdateTransaction,
  type TransactionInput,
} from "@/hooks/useTransactionMutations"
import type { PaymentMethod, Transaction, TxnType } from "@/types/api"
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

const schema = z.object({
  project_id: z.number({ required_error: "Pilih proyek" }).min(1, "Pilih proyek"),
  tx_date: z.string().min(1, "Tanggal wajib diisi"),
  type: z.enum(["IN", "OUT"]),
  amount: z.number({ required_error: "Nominal wajib diisi" }).positive("Nominal harus lebih dari 0"),
  category_id: z.number().nullable().optional(),
  vendor_client_id: z.number().nullable().optional(),
  party_name: z.string().nullable().optional(),
  payment_method: z.enum(["TRANSFER", "CASH", "QRIS", "OTHER"]),
  reference_no: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
})

type FormValues = z.infer<typeof schema>

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
      amount: transaction ? Number(transaction.amount) : 0,
      category_id: transaction?.category_id ?? null,
      vendor_client_id: transaction?.vendor_client_id ?? null,
      party_name: transaction?.party_name ?? "",
      payment_method: transaction?.payment_method ?? "TRANSFER",
      reference_no: transaction?.reference_no ?? "",
      description: transaction?.description ?? "",
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
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues })

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
      const payload: TransactionInput = {
        project_id: parsed.data.project_id,
        tx_date: parsed.data.tx_date,
        type: parsed.data.type,
        amount: parsed.data.amount,
        category_id: parsed.data.category_id ?? null,
        vendor_client_id: parsed.data.vendor_client_id ?? null,
        party_name: parsed.data.party_name?.trim() || null,
        payment_method: parsed.data.payment_method,
        reference_no: parsed.data.reference_no?.trim() || null,
        description: parsed.data.description?.trim() || null,
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

            <Field label="Tanggal" required error={errors.tx_date?.message}>
              <Controller
                control={control}
                name="tx_date"
                render={({ field }) => (
                  <DateInput value={field.value} onChange={(v) => field.onChange(v ?? "")} />
                )}
              />
            </Field>

            <Field label="Nominal" required error={errors.amount?.message}>
              <Controller
                control={control}
                name="amount"
                render={({ field }) => (
                  <AmountInput
                    value={field.value || null}
                    onChange={(v) => field.onChange(v ?? 0)}
                    placeholder="0"
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
