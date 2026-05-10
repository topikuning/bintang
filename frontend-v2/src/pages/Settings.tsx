import { useState } from "react"
import { useForm } from "react-hook-form"
import {
  Eye,
  EyeOff,
  Loader2,
  LogOut,
  Settings as SettingsIcon,
  ShieldCheck,
  User as UserIcon,
} from "lucide-react"
import { z } from "zod"
import { useNavigate } from "react-router-dom"
import { useAuthStore } from "@/store/auth"
import { useUIPrefs } from "@/store/ui-prefs"
import { useUpdateUser } from "@/hooks/useUsers"
import { useProjects } from "@/hooks/useProjects"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { toast } from "@/components/ui/sonner"
import { apiErrorMessage } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { UserRole } from "@/types/api"

const ROLE_LABEL: Record<UserRole, string> = {
  SUPERADMIN: "Superadmin",
  CENTRAL_ADMIN: "Admin Pusat",
  PROJECT_ADMIN: "Admin Proyek",
  EXECUTIVE: "Eksekutif",
}

const profileSchema = z.object({
  name: z.string().min(1, "Nama wajib"),
  phone: z.string().nullable().optional(),
})

const passwordSchema = z
  .object({
    new_password: z.string().min(6, "Password baru minimal 6 karakter"),
    confirm: z.string(),
  })
  .refine((d) => d.new_password === d.confirm, {
    message: "Konfirmasi tidak cocok",
    path: ["confirm"],
  })

type ProfileForm = z.infer<typeof profileSchema>
type PasswordForm = z.infer<typeof passwordSchema>

export function SettingsPage() {
  const user = useAuthStore((s) => s.user)
  const setUser = useAuthStore((s) => s.setUser)
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()

  const update = useUpdateUser(user?.id ?? 0)
  const projectsQ = useProjects({ is_active: true })
  const { defaultProjectId, setDefaultProject } = useUIPrefs()

  const profileForm = useForm<ProfileForm>({
    defaultValues: { name: user?.name ?? "", phone: user?.phone ?? "" },
  })

  const passwordForm = useForm<PasswordForm>({
    defaultValues: { new_password: "", confirm: "" },
  })

  const [showNew, setShowNew] = useState(false)

  const onSaveProfile = async (raw: ProfileForm) => {
    const parsed = profileSchema.safeParse(raw)
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Periksa isian")
      return
    }
    try {
      const updated = await update.mutateAsync({
        name: parsed.data.name,
        phone: parsed.data.phone?.trim() || null,
      })
      // Sync auth store
      if (user) setUser({ ...user, name: updated.name, phone: updated.phone ?? null })
      toast.success("Profil diperbarui")
    } catch (err) {
      toast.error("Gagal update profil", { description: apiErrorMessage(err) })
    }
  }

  const onSavePassword = async (raw: PasswordForm) => {
    const parsed = passwordSchema.safeParse(raw)
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Periksa isian")
      return
    }
    try {
      await update.mutateAsync({ password: parsed.data.new_password })
      toast.success("Password diperbarui")
      passwordForm.reset()
    } catch (err) {
      toast.error("Gagal update password", { description: apiErrorMessage(err) })
    }
  }

  if (!user) return null

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-5 lg:p-6 max-w-3xl">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded bg-brand-50 text-brand-600">
          <SettingsIcon className="h-4 w-4" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-ink-900 sm:text-2xl">Pengaturan</h1>
          <p className="text-[13px] text-ink-500 mt-0.5">
            Kelola profil, password, dan preferensi aplikasi.
          </p>
        </div>
      </div>

      {/* Profile card */}
      <Section
        title="Profil"
        icon={UserIcon}
        description="Informasi akun -- nama & telepon bisa kamu ubah; email & role hanya admin."
      >
        <div className="flex items-start gap-3 mb-3">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-brand-100 text-brand-700 text-lg font-bold shrink-0">
            {user.name.charAt(0).toUpperCase()}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold">{user.name}</span>
              <Badge tone="info">{ROLE_LABEL[user.role]}</Badge>
              {user.scope_all_projects && (
                <Badge tone="neutral">Akses semua proyek</Badge>
              )}
            </div>
            <div className="text-[12px] text-ink-500 break-all">{user.email}</div>
          </div>
        </div>

        <form
          onSubmit={profileForm.handleSubmit(onSaveProfile)}
          className="space-y-3"
        >
          <Field label="Nama" error={profileForm.formState.errors.name?.message}>
            <Input {...profileForm.register("name")} />
          </Field>
          <Field label="Telepon">
            <Input
              {...profileForm.register("phone")}
              inputMode="tel"
              placeholder="0812 3456 7890"
              className="font-mono"
            />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" disabled={profileForm.formState.isSubmitting}>
              {profileForm.formState.isSubmitting && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Simpan Profil
            </Button>
          </div>
        </form>
      </Section>

      {/* Password */}
      <Section
        title="Ubah Password"
        icon={ShieldCheck}
        description="Pilih password yang kuat. Minimal 6 karakter -- gunakan kombinasi huruf, angka, simbol."
      >
        <form
          onSubmit={passwordForm.handleSubmit(onSavePassword)}
          className="space-y-3"
        >
          <Field
            label="Password Baru"
            error={passwordForm.formState.errors.new_password?.message}
          >
            <div className="relative">
              <Input
                {...passwordForm.register("new_password")}
                type={showNew ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Min. 6 karakter"
              />
              <button
                type="button"
                onClick={() => setShowNew((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-ink-500"
                tabIndex={-1}
              >
                {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </Field>
          <Field
            label="Konfirmasi Password"
            error={passwordForm.formState.errors.confirm?.message}
          >
            <Input
              {...passwordForm.register("confirm")}
              type={showNew ? "text" : "password"}
              autoComplete="new-password"
              placeholder="Ulangi password baru"
            />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" disabled={passwordForm.formState.isSubmitting}>
              {passwordForm.formState.isSubmitting && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Ubah Password
            </Button>
          </div>
        </form>
      </Section>

      {/* Preferences */}
      <Section
        title="Preferensi Aplikasi"
        icon={SettingsIcon}
        description="Default scope proyek saat aplikasi dibuka."
      >
        <Field label="Default Proyek">
          <Select
            value={defaultProjectId ?? ""}
            onChange={(e) =>
              setDefaultProject(e.target.value === "" ? null : Number(e.target.value))
            }
          >
            <option value="">Semua Proyek (global)</option>
            {projectsQ.data?.items.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.code})
              </option>
            ))}
          </Select>
        </Field>
        <p className="text-[11px] text-ink-500 mt-1">
          Tip: kamu juga bisa ganti proyek aktif kapan saja via picker di topbar.
        </p>
      </Section>

      {/* Logout */}
      <div className="rounded-md border bg-surface p-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Keluar</h3>
          <p className="text-[12px] text-ink-500 mt-0.5">
            Sesi akan ditutup di perangkat ini.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            logout()
            navigate("/login", { replace: true })
          }}
          className="border-danger-300 text-danger-700 hover:bg-danger-50"
        >
          <LogOut className="h-4 w-4" />
          Logout
        </Button>
      </div>
    </div>
  )
}

function Section({
  title,
  icon: Icon,
  description,
  children,
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-md border bg-surface p-4 sm:p-5 space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded bg-ink-100 text-ink-700 shrink-0">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-ink-900">{title}</h3>
          <p className="text-[12px] text-ink-500 leading-relaxed mt-0.5">{description}</p>
        </div>
      </div>
      <div>{children}</div>
    </div>
  )
}

function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("flex flex-col gap-1.5")}>
      <Label className="text-[12px] uppercase tracking-wider">{label}</Label>
      {children}
      {error && <p className="text-[11px] text-danger-600">{error}</p>}
    </div>
  )
}
