import { useEffect, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { Coins, Loader2, Pencil, Trash2 } from "lucide-react"
import { z } from "zod"
import { useForm } from "react-hook-form"
import {
  useCreateFunder,
  useDeleteFunder,
  useFunders,
  useUpdateFunder,
} from "@/hooks/useFunders"
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
import { toast } from "@/components/ui/sonner"
import { apiErrorMessage } from "@/lib/api"
import { useBreakpoint } from "@/lib/breakpoint"
import type { Funder, FunderInput } from "@/types/api"

const schema = z.object({
  name: z.string().min(1, "Nama wajib"),
})

type FormValues = z.infer<typeof schema>

function buildDefaults(f: Funder | null): FormValues {
  return { name: f?.name ?? "" }
}

export function FundersPage() {
  const q = useFunders()
  const [formOpen, setFormOpen] = useState(false)
  const [target, setTarget] = useState<Funder | null>(null)
  const [confirmDel, setConfirmDel] = useState<Funder | null>(null)
  const del = useDeleteFunder()

  const items = q.data?.items ?? []

  const columns: ColumnDef<Funder, unknown>[] = [
    {
      id: "name",
      header: "Nama",
      accessorKey: "name",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Coins className="h-4 w-4 text-ink-500" />
          <span className="font-medium">{row.original.name}</span>
        </div>
      ),
      meta: { align: "left", sticky: true },
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
      toast.success("Pendana dihapus")
      setConfirmDel(null)
    } catch (err) {
      toast.error("Gagal menghapus", { description: apiErrorMessage(err) })
    }
  }

  return (
    <>
      <MasterPageShell
        title="Pendana"
        description="Master pendana proyek (APBN/APBD/Swasta/Hibah/dll). 1 proyek bisa multi pendana, 1 pendana bisa di banyak proyek."
        isLoading={q.isLoading}
        error={q.error}
        onRetry={() => q.refetch()}
        items={items}
        columns={columns}
        renderCard={(f) => (
          <button
            type="button"
            onClick={() => {
              setTarget(f)
              setFormOpen(true)
            }}
            className="flex w-full items-center justify-between gap-3 rounded-md border bg-surface p-3 text-left active:bg-ink-100"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <Coins className="h-4 w-4 text-ink-500 shrink-0" />
              <div className="truncate text-sm font-medium">{f.name}</div>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setConfirmDel(f)
              }}
              className="flex h-8 w-8 items-center justify-center rounded text-danger-500 hover:bg-danger-50"
              aria-label="Hapus"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </button>
        )}
        onAdd={() => {
          setTarget(null)
          setFormOpen(true)
        }}
        emptyMessage="Belum ada pendana. Tambahkan supaya bisa di-attach ke proyek."
      />

      <FunderForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false)
          setTarget(null)
        }}
        funder={target}
      />

      <Dialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hapus pendana?</DialogTitle>
            <DialogDescription>
              <strong>{confirmDel?.name}</strong> akan dihapus. Link ke proyek
              yg ada akan ikut terhapus (CASCADE) -- proyek tidak hilang, hanya
              kehilangan reference pendana ini.
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

function FunderForm({
  open,
  onClose,
  funder,
}: {
  open: boolean
  onClose: () => void
  funder: Funder | null
}) {
  const bp = useBreakpoint()
  const isEdit = !!funder
  const create = useCreateFunder()
  const update = useUpdateFunder(funder?.id ?? 0)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: buildDefaults(funder) })

  useEffect(() => {
    if (open) reset(buildDefaults(funder))
  }, [funder, open, reset])

  const onSubmit = async (raw: FormValues) => {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Periksa isian")
      return
    }
    try {
      const payload: FunderInput = { name: parsed.data.name.trim() }
      if (isEdit) {
        await update.mutateAsync(payload)
        toast.success("Pendana diperbarui")
      } else {
        await create.mutateAsync(payload)
        toast.success("Pendana ditambahkan")
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
      id="funder-form"
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col gap-3 px-4 py-4 sm:px-5"
    >
      <div className="flex flex-col gap-1.5">
        <Label className="text-[12px] uppercase tracking-wider">
          Nama Pendana <span className="text-danger-600 ml-0.5">*</span>
        </Label>
        <Input
          {...register("name")}
          placeholder="Mis. APBN 2025, APBD Kota Mataram, Hibah USAID"
          autoFocus
        />
        {errors.name && (
          <p className="text-[11px] text-danger-600">{errors.name.message}</p>
        )}
      </div>
    </form>
  )

  const footer = (
    <div className="flex gap-2 px-4 py-3 sm:px-5 border-t bg-surface pb-safe">
      <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
        Batal
      </Button>
      <Button type="submit" form="funder-form" className="flex-1" disabled={isSubmitting}>
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
        title={isEdit ? "Edit Pendana" : "Tambah Pendana"}
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
          <SheetTitle>{isEdit ? "Edit Pendana" : "Tambah Pendana"}</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto">{body}</div>
        {footer}
      </SheetContent>
    </Sheet>
  )
}
