import { useEffect, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { ArrowDownLeft, ArrowUpRight, Loader2, Pencil, Sparkles, Trash2 } from "lucide-react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { api, apiErrorMessage } from "@/lib/api"
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
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/sonner"
import { useBreakpoint } from "@/lib/breakpoint"
import type { CategoryInput, CategoryType } from "@/types/api"

// Peran akuntansi -- mutually exclusive (max 1 boleh dipilih). UI
// pakai radio supaya jelas exclusive. 'operating' = default (none).
const ROLE_OPTIONS = ["operating", "marketing", "penalty", "profit_share"] as const
type AccountingRole = typeof ROLE_OPTIONS[number]
const ROLE_LABEL: Record<AccountingRole, string> = {
  operating: "Operasional (default)",
  marketing: "Marketing (di-exclude dr budget bar)",
  penalty: "Denda (info di Rincian Keuangan)",
  profit_share: "Bagi Hasil (info di Rincian Keuangan)",
}

const schema = z.object({
  name: z.string().min(1, "Nama wajib"),
  type: z.enum(["IN", "OUT", "BOTH"]),
  description: z.string().nullable().optional(),
  accounting_role: z.enum(ROLE_OPTIONS).optional(),
})

type FormValues = z.infer<typeof schema>

const TYPE_LABEL: Record<CategoryType, string> = {
  IN: "Pemasukan",
  OUT: "Pengeluaran",
  BOTH: "Keduanya",
}
const TYPE_TONE: Record<CategoryType, "success" | "danger" | "neutral"> = {
  IN: "success",
  OUT: "danger",
  BOTH: "neutral",
}

function buildDefaults(c: Category | null): FormValues {
  return {
    name: c?.name ?? "",
    type: (c?.type as CategoryType) ?? "OUT",
    description: c?.description ?? "",
    accounting_role: (
      c?.is_marketing ? "marketing" :
      c?.is_penalty ? "penalty" :
      c?.is_profit_share ? "profit_share" :
      "operating"
    ) as AccountingRole,
  }
}

export function CategoriesPage() {
  const q = useCategories()
  const [formOpen, setFormOpen] = useState(false)
  const [target, setTarget] = useState<Category | null>(null)
  const [confirmDel, setConfirmDel] = useState<Category | null>(null)
  const [cleanupOpen, setCleanupOpen] = useState(false)
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
        return <Badge tone={TYPE_TONE[t]}>{TYPE_LABEL[t]}</Badge>
      },
      meta: { align: "center", width: "150px" },
    },
    {
      id: "description",
      header: "Deskripsi",
      cell: ({ row }) => (
        <span className="text-[13px] text-ink-700 truncate">
          {row.original.description || "—"}
        </span>
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
                <div className="text-[11px] text-ink-500 truncate">
                  {c.description || TYPE_LABEL[c.type]}
                </div>
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
        headerExtra={
          <Button
            variant="secondary"
            onClick={() => setCleanupOpen(true)}
            title="Hapus kategori yg belum pernah dipakai"
          >
            <Sparkles className="h-4 w-4" />
            Bersihkan tidak terpakai
          </Button>
        }
        emptyMessage="Belum ada kategori. Tambahkan supaya transaksi bisa dikategorisasi."
      />

      {cleanupOpen && (
        <CleanupDialog
          onClose={() => setCleanupOpen(false)}
          onDone={() => {
            setCleanupOpen(false)
            q.refetch()
          }}
        />
      )}

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
    defaultValues: buildDefaults(category),
  })

  useEffect(() => {
    if (open) reset(buildDefaults(category))
  }, [category, open, reset])

  const onSubmit = async (raw: FormValues) => {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      toast.error("Periksa kembali isian")
      return
    }
    try {
      const role = parsed.data.accounting_role ?? "operating"
      const payload: CategoryInput = {
        name: parsed.data.name,
        type: parsed.data.type,
        description: parsed.data.description?.trim() || null,
        is_marketing: role === "marketing",
        is_penalty: role === "penalty",
        is_profit_share: role === "profit_share",
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
      <Field label="Deskripsi" hint="Penjelasan singkat (opsional)">
        <Textarea {...register("description")} rows={2} placeholder="Mis. Pembelian semen, batu, pasir" />
      </Field>
      <Field
        label="Peran Akuntansi"
        hint="Mutually exclusive: pilih SATU. Mempengaruhi treatment di Rincian Keuangan + Budget Pengeluaran."
      >
        <div className="flex flex-col gap-1.5">
          {ROLE_OPTIONS.map((role) => (
            <label key={role} className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                value={role}
                {...register("accounting_role")}
                className="mt-1 h-4 w-4 accent-brand-600"
              />
              <span className="text-sm leading-tight">{ROLE_LABEL[role]}</span>
            </label>
          ))}
        </div>
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


// ============================================================
// Cleanup dialog -- hapus massal kategori yg belum pernah dipakai.
// Audit 2026-05-24 user req: salah import, 127 kategori byk yg tdk
// pernah dipakai. SAFETY: backend tolak ID dgn usage>0.
// ============================================================
interface UsageItem {
  id: number
  name: string
  type: string
  usage_count: number
}
interface UsageResp {
  items: UsageItem[]
  total: number
  unused_count: number
}

function CleanupDialog({
  onClose,
  onDone,
}: {
  onClose: () => void
  onDone: () => void
}) {
  const usageQ = useQuery({
    queryKey: ["categories", "usage", "unused"],
    queryFn: async (): Promise<UsageResp> => {
      const { data } = await api.get<UsageResp>(
        "/categories/usage?only_unused=true",
      )
      return data
    },
  })
  const items = usageQ.data?.items ?? []
  const [selected, setSelected] = useState<Set<number>>(new Set())

  // Auto-select semua saat data load
  const allIds = items.map((i) => i.id)
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id))
  const toggleAll = () => {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(allIds))
  }
  const toggleOne = (id: number) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  const delMut = useMutation({
    mutationFn: async (ids: number[]) => {
      const { data } = await api.post("/categories/bulk-delete", { ids })
      return data
    },
    onSuccess: (res) => {
      toast.success(
        `Hapus ${res.success_count}/${res.total_requested} kategori`,
        {
          description:
            res.skipped.length > 0
              ? `Skipped: ${res.skipped.length} (sudah dipakai / not found)`
              : undefined,
        },
      )
      onDone()
    },
    onError: (e) =>
      toast.error("Gagal hapus", { description: apiErrorMessage(e) }),
  })

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bersihkan Kategori Tidak Terpakai</DialogTitle>
        </DialogHeader>
        {usageQ.isLoading && (
          <div className="py-6 text-center text-ink-500">
            <Loader2 className="h-5 w-5 animate-spin inline" /> Loading...
          </div>
        )}
        {usageQ.error && (
          <p className="text-danger-700 text-sm py-3">
            {apiErrorMessage(usageQ.error)}
          </p>
        )}
        {usageQ.data && (
          <>
            {items.length === 0 ? (
              <div className="py-6 text-center text-ink-500">
                Semua {usageQ.data.total} kategori sudah pernah dipakai. Tdk
                ada yg perlu dibersihkan.
              </div>
            ) : (
              <>
                <p className="text-[13px] text-ink-600">
                  Ada <strong>{items.length}</strong> kategori belum pernah
                  dipakai (dari total {usageQ.data.total}). Pilih yg mau
                  dihapus -- yg sudah dipakai TIDAK muncul di sini.
                </p>
                <div className="flex items-center gap-2 border-b pb-2">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="h-4 w-4 accent-brand-600"
                    id="select-all-cat"
                  />
                  <label htmlFor="select-all-cat" className="text-[12px] cursor-pointer">
                    Pilih semua ({selected.size}/{items.length})
                  </label>
                </div>
                <div className="max-h-96 overflow-y-auto rounded border">
                  <table className="w-full text-sm">
                    <tbody>
                      {items.map((c) => (
                        <tr
                          key={c.id}
                          className="border-t hover:bg-ink-50/50 cursor-pointer"
                          onClick={() => toggleOne(c.id)}
                        >
                          <td className="px-3 py-2 w-8">
                            <input
                              type="checkbox"
                              checked={selected.has(c.id)}
                              onChange={() => toggleOne(c.id)}
                              className="h-4 w-4 accent-brand-600"
                            />
                          </td>
                          <td className="px-3 py-2">{c.name}</td>
                          <td className="px-3 py-2 text-[11px] text-ink-500">
                            {c.type}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
        <div className="flex items-center justify-end gap-2 pt-2 border-t">
          <Button variant="secondary" onClick={onClose}>Tutup</Button>
          {items.length > 0 && (
            <Button
              variant="danger"
              onClick={() => {
                if (selected.size === 0) {
                  toast.error("Pilih minimal 1 kategori")
                  return
                }
                if (!confirm(`Hapus ${selected.size} kategori?`)) return
                delMut.mutate([...selected])
              }}
              disabled={selected.size === 0 || delMut.isPending}
            >
              {delMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Hapus ({selected.size})
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
