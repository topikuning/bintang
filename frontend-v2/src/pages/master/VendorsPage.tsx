import { useEffect, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { Loader2, Pencil, Trash2 } from "lucide-react"
import { z } from "zod"
import { useForm } from "react-hook-form"
import { useVendors, type VendorClient } from "@/hooks/useVendors"
import {
  useCreateVendor,
  useDeleteVendor,
  useUpdateVendor,
} from "@/hooks/useVendorMutations"
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
import { apiErrorMessage } from "@/lib/api"
import { useBreakpoint } from "@/lib/breakpoint"
import type { VendorClientInput, VendorClientType } from "@/types/api"

const schema = z.object({
  name: z.string().min(1, "Nama wajib"),
  type: z.enum(["VENDOR", "CLIENT", "BOTH"]),
  npwp: z.string().nullable().optional(),
  contact: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z
    .union([z.string().email("Email tidak valid"), z.literal(""), z.null()])
    .optional(),
  address: z.string().nullable().optional(),
  bank_account: z.string().nullable().optional(),
})

type FormValues = z.infer<typeof schema>

const KIND_LABEL: Record<VendorClientType, string> = {
  VENDOR: "Vendor",
  CLIENT: "Klien",
  BOTH: "Keduanya",
}

function buildDefaults(v: VendorClient | null): FormValues {
  return {
    name: v?.name ?? "",
    type: (v?.type as VendorClientType) ?? "VENDOR",
    npwp: v?.npwp ?? "",
    contact: v?.contact ?? "",
    phone: v?.phone ?? "",
    email: v?.email ?? "",
    address: v?.address ?? "",
    bank_account: v?.bank_account ?? "",
  }
}

export function VendorsPage() {
  const q = useVendors()
  const [formOpen, setFormOpen] = useState(false)
  const [target, setTarget] = useState<VendorClient | null>(null)
  const [confirmDel, setConfirmDel] = useState<VendorClient | null>(null)
  const del = useDeleteVendor()

  const items = q.data?.items ?? []

  const columns: ColumnDef<VendorClient, unknown>[] = [
    {
      id: "name",
      header: "Nama",
      accessorKey: "name",
      cell: ({ getValue }) => <span className="font-medium">{getValue<string>()}</span>,
      meta: { align: "left", sticky: true },
    },
    {
      id: "type",
      header: "Jenis",
      cell: ({ row }) => <Badge tone="neutral">{KIND_LABEL[row.original.type]}</Badge>,
      meta: { align: "center", width: "120px" },
    },
    {
      id: "npwp",
      header: "NPWP",
      accessorKey: "npwp",
      cell: ({ getValue }) => (
        <span className="font-mono text-[13px]">{getValue<string>() || "—"}</span>
      ),
      meta: { align: "left", width: "180px" },
    },
    {
      id: "contact",
      header: "Kontak",
      accessorKey: "contact",
      cell: ({ getValue }) => <span className="text-[13px]">{getValue<string>() || "—"}</span>,
      meta: { align: "left", width: "150px" },
    },
    {
      id: "phone",
      header: "Telepon",
      accessorKey: "phone",
      cell: ({ getValue }) => (
        <span className="font-mono text-[13px]">{getValue<string>() || "—"}</span>
      ),
      meta: { align: "left", width: "150px" },
    },
    {
      id: "email",
      header: "Email",
      accessorKey: "email",
      cell: ({ getValue }) => <span className="text-[13px]">{getValue<string>() || "—"}</span>,
      meta: { align: "left" },
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
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
      meta: { align: "right", width: "90px" },
    },
  ]

  const handleDelete = async () => {
    if (!confirmDel) return
    try {
      await del.mutateAsync(confirmDel.id)
      toast.success("Vendor/klien dihapus")
      setConfirmDel(null)
    } catch (err) {
      toast.error("Gagal menghapus", { description: apiErrorMessage(err) })
    }
  }

  return (
    <>
      <MasterPageShell
        title="Vendor / Klien"
        description="Daftar vendor (supplier) dan klien (pemberi pekerjaan)."
        isLoading={q.isLoading}
        error={q.error}
        onRetry={() => q.refetch()}
        items={items}
        columns={columns}
        renderCard={(v) => (
          <button
            type="button"
            onClick={() => {
              setTarget(v)
              setFormOpen(true)
            }}
            className="flex w-full flex-col gap-1 rounded-md border bg-surface p-3 text-left active:bg-ink-100"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{v.name}</div>
                {v.npwp && (
                  <div className="font-mono text-[11px] text-ink-500">NPWP {v.npwp}</div>
                )}
              </div>
              <Badge tone="neutral">{KIND_LABEL[v.type]}</Badge>
            </div>
            {(v.contact || v.phone || v.email) && (
              <div className="text-[11px] text-ink-500 truncate">
                {v.contact && <span>{v.contact}</span>}
                {v.contact && (v.phone || v.email) && " · "}
                {v.phone && <span className="font-mono">{v.phone}</span>}
                {v.phone && v.email && " · "}
                {v.email}
              </div>
            )}
            <div className="flex justify-end mt-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setConfirmDel(v)
                }}
                className="flex h-8 w-8 items-center justify-center rounded text-danger-500 hover:bg-danger-50"
                aria-label="Hapus"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </button>
        )}
        onAdd={() => {
          setTarget(null)
          setFormOpen(true)
        }}
        emptyMessage="Belum ada vendor/klien."
      />

      <VendorForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false)
          setTarget(null)
        }}
        vendor={target}
      />

      <Dialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hapus vendor/klien?</DialogTitle>
            <DialogDescription>
              <strong>{confirmDel?.name}</strong> akan dihapus. Transaksi/Invoice
              yang menunjuk ke entitas ini akan kehilangan referensi.
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

function VendorForm({
  open,
  onClose,
  vendor,
}: {
  open: boolean
  onClose: () => void
  vendor: VendorClient | null
}) {
  const bp = useBreakpoint()
  const isEdit = !!vendor
  const create = useCreateVendor()
  const update = useUpdateVendor(vendor?.id ?? 0)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: buildDefaults(vendor),
  })

  useEffect(() => {
    if (open) reset(buildDefaults(vendor))
  }, [vendor, open, reset])

  const onSubmit = async (raw: FormValues) => {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Periksa isian")
      return
    }
    try {
      const payload: VendorClientInput = {
        name: parsed.data.name,
        type: parsed.data.type,
        npwp: parsed.data.npwp?.trim() || null,
        contact: parsed.data.contact?.trim() || null,
        phone: parsed.data.phone?.trim() || null,
        email: parsed.data.email?.trim() || null,
        address: parsed.data.address?.trim() || null,
        bank_account: parsed.data.bank_account?.trim() || null,
      }
      if (isEdit) {
        await update.mutateAsync(payload)
        toast.success("Vendor diperbarui")
      } else {
        await create.mutateAsync(payload)
        toast.success("Vendor ditambahkan")
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
      id="vendor-form"
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col gap-3 px-4 py-4 sm:px-5"
    >
      <Field label="Nama" required error={errors.name?.message}>
        <Input {...register("name")} placeholder="Mis. PT Beton Jaya" autoFocus />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Jenis" required>
          <Select {...register("type")}>
            <option value="VENDOR">Vendor</option>
            <option value="CLIENT">Klien</option>
            <option value="BOTH">Keduanya</option>
          </Select>
        </Field>
        <Field label="NPWP">
          <Input {...register("npwp")} placeholder="01.234.567.8-901.000" className="font-mono" />
        </Field>
      </div>
      <Field label="Nama Kontak" hint="PIC / contact person (opsional)">
        <Input {...register("contact")} placeholder="Mis. Bapak Andi" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Telepon">
          <Input
            {...register("phone")}
            inputMode="tel"
            placeholder="0812 3456 7890"
            className="font-mono"
          />
        </Field>
        <Field label="Email" error={errors.email?.message}>
          <Input
            {...register("email")}
            type="email"
            inputMode="email"
            placeholder="vendor@email.com"
          />
        </Field>
      </div>
      <Field label="Alamat">
        <Textarea {...register("address")} rows={2} placeholder="Alamat lengkap" />
      </Field>
      <Field label="Rekening Bank" hint="Mis. BCA 1234567890 a.n. PT Beton Jaya">
        <Input {...register("bank_account")} placeholder="BCA 1234567890 a.n. ..." />
      </Field>
    </form>
  )

  const footer = (
    <div className="flex gap-2 px-4 py-3 sm:px-5 border-t bg-surface pb-safe">
      <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
        Batal
      </Button>
      <Button type="submit" form="vendor-form" className="flex-1" disabled={isSubmitting}>
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
        title={isEdit ? "Edit Vendor / Klien" : "Tambah Vendor / Klien"}
        footer={footer}
      >
        {body}
      </DraggableSheet>
    )
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col p-0">
        <SheetHeader className="border-b">
          <SheetTitle>{isEdit ? "Edit Vendor / Klien" : "Tambah Vendor / Klien"}</SheetTitle>
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
