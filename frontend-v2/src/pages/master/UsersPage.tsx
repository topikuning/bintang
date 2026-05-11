import { useEffect, useState } from "react"
import { Controller, useForm } from "react-hook-form"
import type { ColumnDef } from "@tanstack/react-table"
import {
  Eye,
  EyeOff,
  FolderKanban,
  Loader2,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  User as UserIcon,
  X,
} from "lucide-react"
import { z } from "zod"
import {
  useAssignProject,
  useCreateUser,
  useDeleteUser,
  useUnassignProject,
  useUpdateUser,
  useUserProjects,
  useUsers,
} from "@/hooks/useUsers"
import { useProjects } from "@/hooks/useProjects"
import { Combobox } from "@/components/forms/Combobox"
import { useAuthStore } from "@/store/auth"
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
import type { User, UserCreateInput, UserRole } from "@/types/api"

const ROLE_LABEL: Record<UserRole, string> = {
  SUPERADMIN: "Superadmin",
  CENTRAL_ADMIN: "Admin Pusat",
  PROJECT_ADMIN: "Admin Proyek",
  EXECUTIVE: "Eksekutif",
}

const ROLE_TONE: Record<UserRole, "danger" | "warning" | "info" | "neutral"> = {
  SUPERADMIN: "danger",
  CENTRAL_ADMIN: "warning",
  PROJECT_ADMIN: "info",
  EXECUTIVE: "neutral",
}

const createSchema = z.object({
  email: z.string().email("Email tidak valid"),
  password: z.string().min(6, "Password minimal 6 karakter"),
  name: z.string().min(1, "Nama wajib"),
  role: z.enum(["SUPERADMIN", "CENTRAL_ADMIN", "PROJECT_ADMIN", "EXECUTIVE"]),
  phone: z.string().nullable().optional(),
  scope_all_projects: z.boolean(),
})

const updateSchema = z.object({
  name: z.string().min(1, "Nama wajib"),
  role: z.enum(["SUPERADMIN", "CENTRAL_ADMIN", "PROJECT_ADMIN", "EXECUTIVE"]),
  is_active: z.boolean(),
  phone: z.string().nullable().optional(),
  password: z.string().min(6, "Password minimal 6 karakter").or(z.literal("")).optional(),
  scope_all_projects: z.boolean(),
})

type FormValues = z.infer<typeof createSchema>

function buildDefaults(user: User | null): FormValues {
  return {
    email: user?.email ?? "",
    password: "",
    name: user?.name ?? "",
    role: user?.role ?? "PROJECT_ADMIN",
    phone: user?.phone ?? "",
    scope_all_projects: user?.scope_all_projects ?? false,
  }
}

export function UsersPage() {
  const role = useAuthStore((s) => s.user?.role)
  const isAuthorized = role === "SUPERADMIN" || role === "CENTRAL_ADMIN"

  const q = useUsers()
  const [formOpen, setFormOpen] = useState(false)
  const [target, setTarget] = useState<User | null>(null)
  const [confirmDel, setConfirmDel] = useState<User | null>(null)
  const del = useDeleteUser()
  const items = q.data?.items ?? []

  if (!isAuthorized) {
    return (
      <div className="p-4 sm:p-6">
        <div className="rounded-md border border-warning-200 bg-warning-50 p-6 text-center">
          <ShieldCheck className="mx-auto h-8 w-8 text-warning-600 mb-2" />
          <h2 className="text-base font-semibold text-warning-800">Akses Terbatas</h2>
          <p className="mt-1 text-sm text-warning-700">
            Manajemen pengguna hanya untuk SUPERADMIN dan CENTRAL_ADMIN.
          </p>
        </div>
      </div>
    )
  }

  const columns: ColumnDef<User, unknown>[] = [
    {
      id: "name",
      header: "Nama",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-brand-100 text-brand-700 text-[11px] font-bold">
            {row.original.name.charAt(0).toUpperCase()}
          </span>
          <div>
            <div className="text-sm font-medium">{row.original.name}</div>
            <div className="text-[11px] text-ink-500">{row.original.email}</div>
          </div>
        </div>
      ),
      meta: { align: "left", sticky: true },
    },
    {
      id: "role",
      header: "Role",
      cell: ({ row }) => (
        <Badge tone={ROLE_TONE[row.original.role]}>{ROLE_LABEL[row.original.role]}</Badge>
      ),
      meta: { align: "center", width: "150px" },
    },
    {
      id: "scope",
      header: "Akses",
      cell: ({ row }) =>
        row.original.scope_all_projects ? (
          <span className="text-[12px] text-ink-700">Semua proyek</span>
        ) : (
          <span className="text-[12px] text-ink-500">Per proyek</span>
        ),
      meta: { align: "left", width: "130px" },
    },
    {
      id: "phone",
      header: "Telepon",
      cell: ({ row }) => (
        <span className="font-mono text-[13px]">{row.original.phone || "—"}</span>
      ),
      meta: { align: "left", width: "150px" },
    },
    {
      id: "active",
      header: "Status",
      cell: ({ row }) =>
        row.original.is_active ? (
          <Badge tone="success">Aktif</Badge>
        ) : (
          <Badge tone="neutral">Nonaktif</Badge>
        ),
      meta: { align: "center", width: "100px" },
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
          {role === "SUPERADMIN" && (
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
          )}
        </div>
      ),
      meta: { align: "right", width: "90px" },
    },
  ]

  const handleDelete = async () => {
    if (!confirmDel) return
    try {
      await del.mutateAsync(confirmDel.id)
      toast.success("Pengguna dihapus")
      setConfirmDel(null)
    } catch (err) {
      toast.error("Gagal menghapus", { description: apiErrorMessage(err) })
    }
  }

  return (
    <>
      <MasterPageShell
        title="Pengguna"
        description="Kelola akun pengguna dan hak aksesnya."
        isLoading={q.isLoading}
        error={q.error}
        onRetry={() => q.refetch()}
        items={items}
        columns={columns}
        renderCard={(u) => (
          <button
            type="button"
            onClick={() => {
              setTarget(u)
              setFormOpen(true)
            }}
            className="flex w-full flex-col gap-1.5 rounded-md border bg-surface p-3 text-left active:bg-ink-100"
          >
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-100 text-brand-700 text-sm font-bold shrink-0">
                {u.name.charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-sm font-semibold truncate">{u.name}</span>
                  {!u.is_active && <Badge tone="neutral">Nonaktif</Badge>}
                </div>
                <div className="text-[11px] text-ink-500 truncate">{u.email}</div>
              </div>
              <Badge tone={ROLE_TONE[u.role]}>{ROLE_LABEL[u.role]}</Badge>
            </div>
            {(u.phone || u.scope_all_projects) && (
              <div className="text-[11px] text-ink-500 flex items-center gap-2 ml-12">
                {u.phone && <span className="font-mono">{u.phone}</span>}
                {u.scope_all_projects && (
                  <span className="text-info-700">· Semua proyek</span>
                )}
              </div>
            )}
            {role === "SUPERADMIN" && (
              <div className="flex justify-end mt-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setConfirmDel(u)
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded text-danger-500 hover:bg-danger-50"
                  aria-label="Hapus"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            )}
          </button>
        )}
        onAdd={() => {
          setTarget(null)
          setFormOpen(true)
        }}
        emptyMessage="Belum ada pengguna selain Anda."
      />

      <UserForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false)
          setTarget(null)
        }}
        user={target}
      />

      <Dialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hapus pengguna?</DialogTitle>
            <DialogDescription>
              <strong>{confirmDel?.name}</strong> ({confirmDel?.email}) akan dihapus.
              Audit log tetap menyimpan jejak aktivitas pengguna ini.
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

function UserForm({
  open,
  onClose,
  user,
}: {
  open: boolean
  onClose: () => void
  user: User | null
}) {
  const bp = useBreakpoint()
  const isEdit = !!user
  const create = useCreateUser()
  const update = useUpdateUser(user?.id ?? 0)
  const [showPassword, setShowPassword] = useState(false)

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: buildDefaults(user),
  })

  useEffect(() => {
    if (open) reset(buildDefaults(user))
  }, [user, open, reset])

  const onSubmit = async (raw: FormValues) => {
    if (isEdit) {
      const parsed = updateSchema.safeParse({
        name: raw.name,
        role: raw.role,
        is_active: user?.is_active ?? true,
        phone: raw.phone,
        password: raw.password ? raw.password : undefined,
        scope_all_projects: raw.scope_all_projects,
      })
      if (!parsed.success) {
        toast.error(parsed.error.issues[0]?.message ?? "Periksa isian")
        return
      }
      try {
        await update.mutateAsync({
          name: parsed.data.name,
          role: parsed.data.role,
          is_active: parsed.data.is_active,
          phone: parsed.data.phone?.trim() || null,
          password: parsed.data.password || undefined,
          scope_all_projects: parsed.data.scope_all_projects,
        })
        toast.success("Pengguna diperbarui")
        reset()
        onClose()
      } catch (err) {
        toast.error("Gagal update", { description: apiErrorMessage(err) })
      }
    } else {
      const parsed = createSchema.safeParse(raw)
      if (!parsed.success) {
        toast.error(parsed.error.issues[0]?.message ?? "Periksa isian")
        return
      }
      try {
        const payload: UserCreateInput = {
          email: parsed.data.email,
          password: parsed.data.password,
          name: parsed.data.name,
          role: parsed.data.role,
          phone: parsed.data.phone?.trim() || null,
          scope_all_projects: parsed.data.scope_all_projects,
        }
        await create.mutateAsync(payload)
        toast.success("Pengguna ditambahkan")
        reset()
        onClose()
      } catch (err) {
        toast.error("Gagal tambah", { description: apiErrorMessage(err) })
      }
    }
  }

  const body = (
    <form
      id="user-form"
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col gap-3 px-4 py-4 sm:px-5"
    >
      <Field label="Nama" required error={errors.name?.message}>
        <Input {...register("name")} placeholder="Mis. Andi" autoFocus />
      </Field>
      <Field label="Email" required error={errors.email?.message}>
        <Input
          {...register("email")}
          type="email"
          inputMode="email"
          placeholder="nama@perusahaan.id"
          disabled={isEdit}
        />
      </Field>
      <Field
        label={isEdit ? "Password baru (opsional)" : "Password"}
        required={!isEdit}
        hint={isEdit ? "Kosongkan kalau tidak ingin mengubah." : "Min. 6 karakter."}
        error={errors.password?.message}
      >
        <div className="relative">
          <Input
            {...register("password")}
            type={showPassword ? "text" : "password"}
            placeholder={isEdit ? "•••••• (kosongkan)" : "Min. 6 karakter"}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-ink-500 hover:text-ink-900"
            tabIndex={-1}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </Field>
      <Field label="Role" required>
        <Select {...register("role")}>
          <option value="SUPERADMIN">Superadmin (god-mode)</option>
          <option value="CENTRAL_ADMIN">Admin Pusat</option>
          <option value="PROJECT_ADMIN">Admin Proyek</option>
          <option value="EXECUTIVE">Eksekutif (read-only)</option>
        </Select>
      </Field>
      <Field label="Akses Proyek">
        <Controller
          control={control}
          name="scope_all_projects"
          render={({ field }) => (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={field.value}
                onChange={(e) => field.onChange(e.target.checked)}
                className="h-4 w-4 accent-brand-600"
              />
              <span className="text-sm">Akses semua proyek</span>
            </label>
          )}
        />
      </Field>
      <Field label="Telepon">
        <Input {...register("phone")} inputMode="tel" placeholder="0812 3456 7890" className="font-mono" />
      </Field>

      {/* Akses proyek -- daftar project_users + tombol tambah/hapus. Hanya
          muncul saat mode edit (user sudah punya id) dan user tidak scope_all
          (kalau scope_all, sudah akses semua proyek tanpa perlu assignment). */}
      {isEdit && user && (
        <UserProjectsSection
          userId={user.id}
          userName={user.name}
          scopeAll={user.scope_all_projects}
        />
      )}
    </form>
  )

  const footer = (
    <div className="flex gap-2 px-4 py-3 sm:px-5 border-t bg-surface pb-safe">
      <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
        Batal
      </Button>
      <Button type="submit" form="user-form" className="flex-1" disabled={isSubmitting}>
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
        title={isEdit ? "Edit Pengguna" : "Tambah Pengguna"}
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
          <SheetTitle>
            <UserIcon className="inline h-4 w-4 mr-1.5" />
            {isEdit ? "Edit Pengguna" : "Tambah Pengguna"}
          </SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto">{body}</div>
        {footer}
      </SheetContent>
    </Sheet>
  )
}

function UserProjectsSection({
  userId,
  userName,
  scopeAll,
}: {
  userId: number
  userName: string
  scopeAll: boolean
}) {
  const projectsQ = useUserProjects(userId)
  const assign = useAssignProject()
  const unassign = useUnassignProject()
  const allProjectsQ = useProjects({ status: "AKTIF", size: 500 })

  const [pickerVal, setPickerVal] = useState<number | null>(null)
  const items = projectsQ.data ?? []
  const assignedIds = new Set(items.map((p) => p.id))
  const candidates = (allProjectsQ.data?.items ?? []).filter(
    (p) => !assignedIds.has(p.id),
  )

  const handleAdd = async () => {
    if (!pickerVal) return
    try {
      await assign.mutateAsync({ userId, projectId: pickerVal })
      toast.success("Proyek ditambahkan utk user")
      setPickerVal(null)
    } catch (err) {
      toast.error("Gagal menambah proyek", { description: apiErrorMessage(err) })
    }
  }

  const handleRemove = async (projectId: number, projectName: string) => {
    try {
      await unassign.mutateAsync({ userId, projectId })
      toast.success(`Akses ke "${projectName}" dicabut`)
    } catch (err) {
      toast.error("Gagal mencabut akses", { description: apiErrorMessage(err) })
    }
  }

  return (
    <Field
      label="Akses Proyek (per proyek)"
      hint={
        scopeAll
          ? `${userName} punya scope 'Akses semua proyek' -- daftar di bawah tdk dipakai utk authorization (semua proyek tetap bisa diakses). Hanya catatan eksplisit.`
          : "Pilih proyek di bawah utk tambah akses. User hanya bisa lihat proyek yg ditugaskan di sini."
      }
    >
      <div className="rounded-md border bg-surface-muted/40 p-2.5 space-y-2">
        {projectsQ.isLoading ? (
          <div className="text-[12px] text-ink-500">Memuat daftar proyek…</div>
        ) : items.length === 0 ? (
          <div className="text-[12px] text-ink-500 italic">
            Belum ada proyek yg ditugaskan.
          </div>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {items.map((p) => (
              <li
                key={p.id}
                className="inline-flex items-center gap-1.5 rounded border border-brand-200 bg-brand-50 pl-2 pr-1 py-0.5 text-[12px]"
              >
                <FolderKanban className="h-3 w-3 text-brand-600" />
                <span className="font-medium text-brand-800">{p.name}</span>
                <span className="font-mono text-[10px] text-ink-500">{p.code}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    handleRemove(p.id, p.name)
                  }}
                  disabled={unassign.isPending}
                  className="ml-1 flex h-5 w-5 items-center justify-center rounded text-danger-500 hover:bg-danger-50"
                  aria-label={`Cabut akses ke ${p.name}`}
                  title="Cabut akses"
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-2 pt-1">
          <div className="flex-1 min-w-0">
            <Combobox
              value={pickerVal}
              onChange={(v) => setPickerVal(v == null ? null : Number(v))}
              options={candidates.map((p) => ({
                value: p.id,
                label: p.name,
                hint: p.code,
              }))}
              placeholder={
                candidates.length === 0
                  ? "Semua proyek aktif sudah ditugaskan"
                  : "Pilih proyek utk ditambahkan…"
              }
              disabled={candidates.length === 0}
              isLoading={allProjectsQ.isLoading}
              sheetTitle="Pilih Proyek"
              emptyMessage="Tidak ada proyek tersisa"
            />
          </div>
          <Button
            type="button"
            size="sm"
            onClick={handleAdd}
            disabled={!pickerVal || assign.isPending}
          >
            {assign.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Tambah
          </Button>
        </div>
      </div>
    </Field>
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
