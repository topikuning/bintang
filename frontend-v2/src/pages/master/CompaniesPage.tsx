import { useEffect, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { Building2, Loader2, Pencil, Trash2 } from "lucide-react"
import { z } from "zod"
import { useForm } from "react-hook-form"
import {
  useCompanies,
  useCreateCompany,
  useDeleteCompany,
  useUpdateCompany,
} from "@/hooks/useCompanies"
import { MasterPageShell } from "@/components/master/MasterPageShell"
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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { DraggableSheet } from "@/components/ui/draggable-sheet"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/sonner"
import { apiErrorMessage } from "@/lib/api"
import { useBreakpoint } from "@/lib/breakpoint"
import type { Company, CompanyInput } from "@/types/api"

const schema = z.object({
  name: z.string().min(1, "Nama wajib"),
  npwp: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z
    .union([z.string().email("Email tidak valid"), z.literal(""), z.null()])
    .optional(),
  address: z.string().nullable().optional(),
  director_name: z.string().nullable().optional(),
  bank_account: z.string().nullable().optional(),
  logo_url: z.string().nullable().optional(),
  letterhead_url: z.string().nullable().optional(),
})

type FormValues = z.infer<typeof schema>

function buildDefaults(c: Company | null): FormValues {
  return {
    name: c?.name ?? "",
    npwp: c?.npwp ?? "",
    phone: c?.phone ?? "",
    email: c?.email ?? "",
    address: c?.address ?? "",
    director_name: c?.director_name ?? "",
    bank_account: c?.bank_account ?? "",
    logo_url: c?.logo_url ?? "",
    letterhead_url: c?.letterhead_url ?? "",
  }
}

export function CompaniesPage() {
  const q = useCompanies()
  const [formOpen, setFormOpen] = useState(false)
  const [target, setTarget] = useState<Company | null>(null)
  const [confirmDel, setConfirmDel] = useState<Company | null>(null)
  const del = useDeleteCompany()

  const items = q.data?.items ?? []

  const columns: ColumnDef<Company, unknown>[] = [
    {
      id: "name",
      header: "Nama",
      accessorKey: "name",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-ink-500" />
          <span className="font-medium">{row.original.name}</span>
        </div>
      ),
      meta: { align: "left", sticky: true },
    },
    {
      id: "npwp",
      header: "NPWP",
      cell: ({ row }) => (
        <span className="font-mono text-[13px]">{row.original.npwp || "—"}</span>
      ),
      meta: { align: "left", width: "180px" },
    },
    {
      id: "director",
      header: "Direktur",
      cell: ({ row }) => (
        <span className="text-[13px]">{row.original.director_name || "—"}</span>
      ),
      meta: { align: "left", width: "200px" },
    },
    {
      id: "address",
      header: "Alamat",
      cell: ({ row }) => (
        <span className="text-[13px] text-ink-700 truncate">{row.original.address || "—"}</span>
      ),
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
      toast.success("Perusahaan dihapus")
      setConfirmDel(null)
    } catch (err) {
      toast.error("Gagal menghapus", { description: apiErrorMessage(err) })
    }
  }

  return (
    <>
      <MasterPageShell
        title="Perusahaan"
        description="Daftar entitas perusahaan/PT yang menerbitkan PO/invoice."
        isLoading={q.isLoading}
        error={q.error}
        onRetry={() => q.refetch()}
        items={items}
        columns={columns}
        renderCard={(c) => (
          <button
            type="button"
            onClick={() => {
              setTarget(c)
              setFormOpen(true)
            }}
            className="flex w-full flex-col gap-1 rounded-md border bg-surface p-3 text-left active:bg-ink-100"
          >
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-ink-500 shrink-0" />
              <div className="text-sm font-semibold truncate">{c.name}</div>
            </div>
            {c.npwp && (
              <div className="font-mono text-[11px] text-ink-500">NPWP {c.npwp}</div>
            )}
            {c.director_name && (
              <div className="text-[11px] text-ink-500 truncate">
                Direktur: {c.director_name}
              </div>
            )}
            {c.address && <div className="text-[11px] text-ink-500 truncate">{c.address}</div>}
            <div className="flex justify-end mt-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setConfirmDel(c)
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
        emptyMessage="Belum ada perusahaan."
      />

      <CompanyForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false)
          setTarget(null)
        }}
        company={target}
      />

      <Dialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hapus perusahaan?</DialogTitle>
            <DialogDescription>
              <strong>{confirmDel?.name}</strong> akan dihapus. Pastikan tidak ada
              proyek yang masih menunjuk ke perusahaan ini.
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

function CompanyForm({
  open,
  onClose,
  company,
}: {
  open: boolean
  onClose: () => void
  company: Company | null
}) {
  const bp = useBreakpoint()
  const isEdit = !!company
  const create = useCreateCompany()
  const update = useUpdateCompany(company?.id ?? 0)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: buildDefaults(company),
  })

  useEffect(() => {
    if (open) reset(buildDefaults(company))
  }, [company, open, reset])

  const onSubmit = async (raw: FormValues) => {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Periksa isian")
      return
    }
    try {
      const payload: CompanyInput = {
        name: parsed.data.name,
        npwp: parsed.data.npwp?.trim() || null,
        phone: parsed.data.phone?.trim() || null,
        email: parsed.data.email?.trim() || null,
        address: parsed.data.address?.trim() || null,
        director_name: parsed.data.director_name?.trim() || null,
        bank_account: parsed.data.bank_account?.trim() || null,
        logo_url: parsed.data.logo_url?.trim() || null,
        letterhead_url: parsed.data.letterhead_url?.trim() || null,
      }
      if (isEdit) {
        await update.mutateAsync(payload)
        toast.success("Perusahaan diperbarui")
      } else {
        await create.mutateAsync(payload)
        toast.success("Perusahaan ditambahkan")
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
      id="company-form"
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col gap-3 px-4 py-4 sm:px-5"
    >
      <Field label="Nama" required error={errors.name?.message}>
        <Input
          {...register("name")}
          placeholder="Mis. PT Berkah Karya Makmur Sentosa"
          autoFocus
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="NPWP">
          <Input {...register("npwp")} placeholder="01.234.567.8-901.000" className="font-mono" />
        </Field>
        <Field label="Direktur">
          <Input {...register("director_name")} placeholder="Nama direktur" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Telepon">
          <Input {...register("phone")} inputMode="tel" className="font-mono" />
        </Field>
        <Field label="Email" error={errors.email?.message}>
          <Input {...register("email")} type="email" inputMode="email" />
        </Field>
      </div>
      <Field label="Alamat">
        <Textarea {...register("address")} rows={3} placeholder="Alamat lengkap" />
      </Field>
      <Field label="Rekening Bank" hint="Tampil di footer invoice (mis. BCA 1234567890 a.n. PT ...)">
        <Input {...register("bank_account")} placeholder="BCA 1234567890 a.n. PT ABC" />
      </Field>
      <div className="grid grid-cols-1 gap-3">
        <Field label="URL Logo" hint="Logo perusahaan utk PDF (opsional)">
          <Input {...register("logo_url")} placeholder="https://..." />
        </Field>
        <Field label="URL Kop Surat" hint="Header letterhead utk PDF (opsional)">
          <Input {...register("letterhead_url")} placeholder="https://..." />
        </Field>
      </div>
    </form>
  )

  const footer = (
    <div className="flex gap-2 px-4 py-3 sm:px-5 border-t bg-surface pb-safe">
      <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
        Batal
      </Button>
      <Button type="submit" form="company-form" className="flex-1" disabled={isSubmitting}>
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
        title={isEdit ? "Edit Perusahaan" : "Tambah Perusahaan"}
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
          <SheetTitle>{isEdit ? "Edit Perusahaan" : "Tambah Perusahaan"}</SheetTitle>
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
