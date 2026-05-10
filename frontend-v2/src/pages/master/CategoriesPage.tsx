import { useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { ArrowDownLeft, ArrowUpRight, Loader2, Pencil, Trash2 } from "lucide-react"
import { z } from "zod"
import { useForm } from "react-hook-form"
import { useCategories, type Category } from "@/hooks/useCategories"
import {
  useCreateCategory,
  useDeleteCategory,
  useUpdateCategory,
} from "@/hooks/useCategoryMutations"
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
import { toast } from "@/components/ui/sonner"
import { apiErrorMessage } from "@/lib/api"
import { useBreakpoint } from "@/lib/breakpoint"
import type { CategoryInput } from "@/types/api"

const schema = z.object({
  name: z.string().min(1, "Nama wajib"),
  type: z.enum(["IN", "OUT", "BOTH"]),
  parent_id: z.number().nullable().optional(),
})

type FormValues = z.infer<typeof schema>

const TYPE_LABEL = { IN: "Pemasukan", OUT: "Pengeluaran", BOTH: "Keduanya" } as const
const TYPE_TONE = { IN: "success", OUT: "danger", BOTH: "neutral" } as const

export function CategoriesPage() {
  const q = useCategories()
  const [formOpen, setFormOpen] = useState(false)
  const [target, setTarget] = useState<Category | null>(null)
  const [confirmDel, setConfirmDel] = useState<Category | null>(null)
  const del = useDeleteCategory()

  const items = q.data?.items ?? []

  const columns: ColumnDef<Category, unknown>[] = [
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
      cell: ({ row }) => {
        const t = row.original.type
        return (
          <Badge tone={TYPE_TONE[t] as "success" | "danger" | "neutral"}>
            {TYPE_LABEL[t]}
          </Badge>
        )
      },
      meta: { align: "center", width: "150px" },
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
            className="flex h-8 w-8 items-center justify-center rounded text-ink-500 hover:bg-ink-100 hover:text-ink-900"
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
            className="flex h-8 w-8 items-center justify-center rounded text-danger-500 hover:bg-danger-50 hover:text-danger-700"
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
      toast.success("Kategori dihapus")
      setConfirmDel(null)
    } catch (err) {
      toast.error("Gagal menghapus", { description: apiErrorMessage(err) })
    }
  }

  return (
    <>
      <MasterPageShell
        title="Kategori"
        description="Kategori transaksi -- mengelompokkan pemasukan & pengeluaran."
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
            className="flex w-full items-center justify-between gap-3 rounded-md border bg-surface p-3 text-left active:bg-ink-100"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {c.type === "IN" ? (
                <ArrowDownLeft className="h-4 w-4 text-success-600" />
              ) : c.type === "OUT" ? (
                <ArrowUpRight className="h-4 w-4 text-danger-600" />
              ) : (
                <span className="h-4 w-4 rounded-full bg-ink-300" />
              )}
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{c.name}</div>
                <div className="text-[11px] text-ink-500">{TYPE_LABEL[c.type]}</div>
              </div>
            </div>
            <div className="flex gap-1">
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
        emptyMessage="Belum ada kategori. Tambahkan supaya transaksi bisa dikategorisasi."
      />

      <CategoryForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false)
          setTarget(null)
        }}
        category={target}
      />

      <Dialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hapus kategori?</DialogTitle>
            <DialogDescription>
              <strong>{confirmDel?.name}</strong> akan dihapus. Transaksi yg
              memakai kategori ini akan kehilangan referensi (kategori jadi
              kosong).
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

function CategoryForm({
  open,
  onClose,
  category,
}: {
  open: boolean
  onClose: () => void
  category: Category | null
}) {
  const bp = useBreakpoint()
  const isEdit = !!category
  const create = useCreateCategory()
  const update = useUpdateCategory(category?.id ?? 0)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: {
      name: category?.name ?? "",
      type: category?.type ?? "OUT",
      parent_id: category?.parent_id ?? null,
    },
  })

  // Reset saat target berubah
  if (open && (category?.id ?? -1) !== ((category?.id as unknown) as number)) {
    // noop -- useEffect would be cleaner; tapi RHF handle reset di onSubmit
  }

  const onSubmit = async (raw: FormValues) => {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      toast.error("Periksa kembali isian")
      return
    }
    try {
      const payload: CategoryInput = {
        name: parsed.data.name,
        type: parsed.data.type,
        parent_id: parsed.data.parent_id ?? null,
      }
      if (isEdit) {
        await update.mutateAsync(payload)
        toast.success("Kategori diperbarui")
      } else {
        await create.mutateAsync(payload)
        toast.success("Kategori ditambahkan")
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
      id="category-form"
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col gap-3 px-4 py-4 sm:px-5"
    >
      <Field label="Nama" required error={errors.name?.message}>
        <Input
          {...register("name")}
          placeholder="Mis. Material Beton, Operasional Lapangan"
          autoFocus
        />
      </Field>
      <Field label="Jenis" required>
        <Select {...register("type")}>
          <option value="IN">Pemasukan</option>
          <option value="OUT">Pengeluaran</option>
          <option value="BOTH">Keduanya</option>
        </Select>
      </Field>
    </form>
  )

  const footer = (
    <div className="flex gap-2 px-4 py-3 sm:px-5 border-t bg-surface pb-safe">
      <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
        Batal
      </Button>
      <Button type="submit" form="category-form" className="flex-1" disabled={isSubmitting}>
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
        title={isEdit ? "Edit Kategori" : "Tambah Kategori"}
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
          <SheetTitle>{isEdit ? "Edit Kategori" : "Tambah Kategori"}</SheetTitle>
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
  error,
  children,
}: {
  label: string
  required?: boolean
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
      {error && <p className="text-[11px] text-danger-600">{error}</p>}
    </div>
  )
}
