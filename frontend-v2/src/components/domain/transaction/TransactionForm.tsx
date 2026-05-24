import { useEffect, useMemo, useState } from "react"
import { useForm, Controller, useFieldArray } from "react-hook-form"
import { Loader2, Plus, Sparkles, Trash2 } from "lucide-react"
import { z } from "zod"
import { fmtIDR, toApiDate } from "@/lib/format"
import { apiErrorMessage } from "@/lib/api"
import {
  useCreateTransaction,
  useUpdateTransaction,
  type TransactionInput,
} from "@/hooks/useTransactionMutations"
import {
  useLinkTransactionAttachment,
  useUploadTransactionAttachment,
} from "@/hooks/useTransactionAttachments"
import { useUsersLookup } from "@/hooks/useUsers"
import { useAuthStore } from "@/store/auth"
import type { PaymentMethod, Transaction, TxnKind, TxnType } from "@/types/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { toast } from "@/components/ui/sonner"
import { AmountInput } from "@/components/forms/AmountInput"
import { DateInput } from "@/components/forms/DateInput"
import { AttachmentUploader } from "@/components/forms/AttachmentUploader"
import { ProjectPicker } from "@/components/forms/ProjectPicker"
import { useProject } from "@/hooks/useProjects"
import { ProjectStatusBanner } from "@/components/domain/project/ProjectStatusBanner"
import { useSuggestCategory } from "@/hooks/useAI"
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
    label: "Dana Operasional",
    hint: "Dana operasional ke karyawan/staff -- bisa utk beban langsung atau bayar invoice. Perlu pertanggungjawaban (settle) nanti.",
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
  /** Jika true, propagate ke ProjectPicker supaya project NON_PROJECT
   * juga muncul di options (kebutuhan halaman Catatan Non-Proyek yg
   * pakai lockProjectId ke system project). */
  allowNonProject?: boolean
  /** Dipanggil setelah save sukses (create/update). Caller bisa pakai
   * utk re-open detail panel supaya user bisa verifikasi hasil edit
   * tanpa harus klik ulang dr list. */
  onSaved?: (saved: Transaction) => void
}

export function TransactionForm({
  open,
  onClose,
  transaction,
  lockProjectId,
  allowNonProject,
  onSaved,
}: TransactionFormProps) {
  const bp = useBreakpoint()
  const isEdit = !!transaction
  // DRAFT tx boleh pindah proyek (termasuk ke/dari Catatan Non-Proyek).
  // Status lain di-block backend (audit trail keuangan harus kuat).
  const isDraftEdit = isEdit && transaction?.status === "DRAFT"
  // Saat DRAFT-move: scope ProjectPicker ke company tx -- mencegah
  // cross-company move (jarang dimaksudkan & bikin NON_PROJECT picker
  // tampil 28 baris di multi-company tenant).
  const { data: currentProject } = useProject(
    isDraftEdit ? transaction?.project_id : null,
  )
  const initialProjectId =
    transaction?.project_id ?? lockProjectId ?? 0

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
  const usersQ = useUsersLookup({ limit: 200 })
  // Kind change rule (mirror backend):
  // - Tx VERIFIED: hanya SUPERADMIN (god-mode bypass audit lock).
  // - Selain VERIFIED: siapa pun yg punya write access (sdh sampai
  //   form edit) boleh ubah kind. Tx DRAFT/SUBMITTED/REJECTED masih
  //   editable.
  // - Backend tetap cek allocation (409 kalau sdh ada invoice link).
  const role = useAuthStore((s) => s.user?.role)
  const isSuperAdmin = role === "SUPERADMIN"
  const isVerified = transaction?.status === "VERIFIED"
  const kindLocked = isEdit && isVerified && !isSuperAdmin

  // Reset saat sheet baru dibuka atau transaction berubah
  useEffect(() => {
    if (open) reset(defaultValues)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, transaction?.id])

  const create = useCreateTransaction()
  const update = useUpdateTransaction(transaction?.id ?? 0)
  const upload = useUploadTransactionAttachment()
  const link = useLinkTransactionAttachment()
  const [submitting, setSubmitting] = useState(false)
  // After successful CREATE, switch form ke "attachment phase":
  // tx sudah ter-save, user bisa langsung upload bukti tanpa harus
  // tutup form + buka detail. Diisi hanya saat create (edit close-then
  // re-open detail seperti biasa).
  const [justCreatedTx, setJustCreatedTx] = useState<Transaction | null>(null)

  // Reset attachment phase saat form ditutup atau di-reopen.
  useEffect(() => {
    if (!open) setJustCreatedTx(null)
  }, [open])

  const finishAndClose = () => {
    const saved = justCreatedTx
    setJustCreatedTx(null)
    onClose()
    if (saved) onSaved?.(saved)
  }

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
        toast.error("Penerima dana operasional wajib diisi (pilih user atau ketik nama)")
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
            description: `Nominal: ${fmtIDR(d.amount)} | Sum item: ${fmtIDR(sum)}`,
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
        const saved = await update.mutateAsync(payload)
        toast.success("Transaksi diperbarui")
        onClose()
        onSaved?.(saved)
      } else {
        const saved = await create.mutateAsync(payload)
        toast.success("Transaksi tersimpan", {
          description: "Lanjut tambah bukti, atau klik Selesai.",
        })
        // Jangan close -- switch ke attachment phase supaya user bisa
        // langsung upload bukti tanpa harus buka detail dr list.
        setJustCreatedTx(saved)
      }
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
  // Watch project_id -> tarik info status proyek utk banner inline kalau
  // closed (SELESAI/DIBATALKAN). Audit 2026-05-24 Phase 1.
  const watchedProjectId = watch("project_id")
  const { data: selectedProject } = useProject(
    watchedProjectId && watchedProjectId > 0 ? watchedProjectId : null,
  )
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
    <Sheet open={open} onOpenChange={(v) => !v && (justCreatedTx ? finishAndClose() : onClose())}>
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
            onClick={justCreatedTx ? finishAndClose : onClose}
            className="text-sm font-medium text-ink-600 hover:text-ink-900"
          >
            {justCreatedTx ? "Selesai" : "Batal"}
          </button>
          <SheetTitle className="text-center flex-1">
            {justCreatedTx
              ? `Tambah Bukti — Tx #${justCreatedTx.id}`
              : isEdit ? "Edit Transaksi" : "Tambah Transaksi"}
          </SheetTitle>
          {/* sr-only deskripsi -- penuhi Radix Dialog a11y requirement
              (aria-describedby). Tanpa ini console warning. */}
          <SheetDescription className="sr-only">
            {justCreatedTx
              ? "Lampirkan bukti transaksi (struk, kwitansi, foto)."
              : isEdit
                ? "Form edit transaksi yang sudah ada."
                : "Form input transaksi baru: tanggal, nominal, proyek, kategori, vendor, dan deskripsi."}
          </SheetDescription>
          <div className="w-12" />
        </SheetHeader>

        {justCreatedTx ? (
          <AttachmentPhase
            tx={justCreatedTx}
            upload={upload}
            link={link}
            onFinish={finishAndClose}
          />
        ) : (
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-col flex-1 overflow-hidden"
        >
          {/* Body scroll */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {/* Banner status proyek non-AKTIF -- audit 2026-05-24 Phase 1.
                SELESAI/DIBATALKAN -> backend reject 409 saat submit.
                DITAHAN -> warn only (submit lolos). */}
            {selectedProject && (
              <ProjectStatusBanner
                status={selectedProject.status}
                sinceIso={selectedProject.updated_at}
              />
            )}
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
                    Tx sudah tervalidasi -- hanya SUPERADMIN yg bisa ubah
                    jenis (god-mode).
                  </p>
                )}
                {isEdit && !kindLocked && (
                  <p className="text-[11px] text-ink-500">
                    Bisa ubah jenis selama tx belum ter-alokasi ke invoice.
                    Pindah jenis akan reset field yg tdk berlaku (mis.
                    invoice_id, recipient, items).
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

            <Field
              label="Proyek"
              required
              error={errors.project_id?.message}
              hint={
                isDraftEdit
                  ? "Tx masih DRAFT -- boleh pindah ke proyek lain dlm perusahaan yg sama (termasuk Catatan Non-Proyek)."
                  : isEdit
                  ? "Proyek tdk bisa diubah setelah submit. Kalau salah proyek: cancel tx, buat ulang di proyek benar."
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
                    // Lock saat edit non-DRAFT: project IMMUTABLE via
                    // UPDATE (backend reject 400 utk status non-DRAFT).
                    // Saat edit DRAFT: ALLOW pindah proyek (termasuk
                    // ke/dari Catatan Non-Proyek).
                    // Saat create: lock kalau ada lockProjectId (mis.
                    // quick-add dari ProjectDashboard).
                    disabled={(isEdit && !isDraftEdit) || !!lockProjectId}
                    // Halaman Catatan Non-Proyek pakai lockProjectId ke
                    // system project NON_PROJECT -- propagate supaya
                    // label proyek tampil benar (bukan placeholder).
                    // Saat DRAFT-edit: izinkan picker tampilkan NON_PROJECT
                    // supaya user bisa pindah tx ke side ledger.
                    includeNonProject={allowNonProject || isDraftEdit}
                    companyId={
                      isDraftEdit ? currentProject?.company_id ?? null : null
                    }
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
                        {(usersQ.data ?? []).map((u) => (
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
                        {fmtIDR(itemsSum)}
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
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
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
                    </div>
                    <AISuggestCategoryButton
                      getContext={() => ({
                        description: watch("description") || null,
                        party_name: watch("party_name") || null,
                        amount: watch("amount") || null,
                        kind: watch("kind") || null,
                      })}
                      direction={currentType === "IN" ? "IN" : "OUT"}
                      onSuggested={(id) => setValue("category_id", id, { shouldDirty: true })}
                    />
                  </div>
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
        )}
      </SheetContent>
    </Sheet>
  )
}

interface AttachmentPhaseProps {
  tx: Transaction
  upload: ReturnType<typeof useUploadTransactionAttachment>
  link: ReturnType<typeof useLinkTransactionAttachment>
  onFinish: () => void
}

/**
 * Sub-view setelah create tx sukses: user langsung bisa upload bukti
 * (gambar/PDF) atau link external tanpa harus tutup form + buka detail
 * dari list. Mengurangi friction "save -> close -> reopen detail ->
 * scroll ke section bukti".
 */
function AttachmentPhase({ tx, upload, link, onFinish }: AttachmentPhaseProps) {
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        <div className="rounded-md border border-success-200 bg-success-50 p-3 text-[13px] text-success-800">
          Transaksi <span className="font-mono font-semibold">#{tx.id}</span>{" "}
          tersimpan sebagai Draft. Tambah bukti (struk/foto/link) sekarang,
          atau klik <span className="font-semibold">Selesai</span> untuk
          tutup.
        </div>

        <div>
          <h3 className="text-sm font-semibold text-ink-900 mb-2">
            Bukti Transaksi
          </h3>
          <AttachmentUploader
            uploadFile={(file, onProgress) =>
              upload
                .mutateAsync({ transactionId: tx.id, file, onProgress })
                .then(() => undefined)
            }
            linkExternal={(url, label) =>
              link
                .mutateAsync({ transactionId: tx.id, url, label })
                .then(() => undefined)
            }
            isLinking={link.isPending}
          />
        </div>

        <p className="text-[11px] text-ink-500">
          Tip: kamu juga bisa skip dulu, lalu tambah bukti dari detail tx
          kapan saja.
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


/**
 * Tombol AI saran kategori. Baca konteks form (description, party_name,
 * amount, kind) -> /ai/suggest-category -> setValue category_id.
 *
 * Audit 2026-05-23 UX integration AI-1 + perbaikan konteks:
 * sebelumnya cuma description (sering kosong saat user masih input
 * amount). Sekarang AI dapat sinyal dari party_name + amount + kind
 * juga -- bisa suggest walau description belum diisi (mis. cuma vendor
 * 'PT Beton Jaya' + amount 5jt = strong signal "Material Beton").
 */
function AISuggestCategoryButton({
  getContext,
  direction,
  onSuggested,
}: {
  getContext: () => {
    description: string | null
    party_name: string | null
    amount: number | string | null
    kind: string | null
  }
  direction: "IN" | "OUT"
  onSuggested: (id: number | null) => void
}) {
  const suggest = useSuggestCategory()
  const handleClick = async () => {
    const ctx = getContext()
    // Minimum: salah satu dari description atau party_name harus ada.
    const hasDesc = (ctx.description || "").trim().length >= 3
    const hasParty = (ctx.party_name || "").trim().length >= 2
    if (!hasDesc && !hasParty) {
      toast.error("Isi deskripsi atau vendor/klien dulu", {
        description: "AI butuh konteks (min 3 huruf deskripsi atau 2 huruf nama vendor).",
      })
      return
    }
    try {
      const result = await suggest.mutateAsync({
        description: ctx.description,
        party_name: ctx.party_name,
        amount: ctx.amount,
        kind: ctx.kind,
        direction,
      })
      if (result.category_id == null) {
        toast.message("Tdk ada kategori cocok", { description: result.reason })
        return
      }
      onSuggested(result.category_id)
      const conf = Math.round(result.confidence * 100)
      toast.success(`AI pilih: ${result.category_name}`, {
        description: `${result.reason} (${conf}% yakin)`,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : "AI gagal"
      toast.error("Saran AI gagal", { description: msg })
    }
  }
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleClick}
      disabled={suggest.isPending}
      className="shrink-0 gap-1"
      title="AI saran kategori dari deskripsi"
    >
      {suggest.isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Sparkles className="h-3.5 w-3.5" />
      )}
      <span className="text-[12px]">AI</span>
    </Button>
  )
}
