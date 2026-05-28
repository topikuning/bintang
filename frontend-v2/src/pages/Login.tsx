import { useState } from "react"
import { useForm } from "react-hook-form"
import { useNavigate, useSearchParams, Navigate } from "react-router-dom"
import { Eye, EyeOff, Loader2 } from "lucide-react"
import { z } from "zod"
import { api, apiErrorMessage } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import type { TokenResponse, User } from "@/types/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "@/components/ui/sonner"

// Identifier = email atau username. Validasi minimal saja (server yg
// otoritatif). Email kalau berisi '@', else dianggap username.
const schema = z.object({
  identifier: z
    .string()
    .min(1, "Email atau username wajib diisi")
    .max(255),
  password: z.string().min(1, "Password wajib diisi"),
})

type FormValues = z.infer<typeof schema>

export function LoginPage() {
  const navigate = useNavigate()
  const [search] = useSearchParams()
  const next = search.get("next") || "/dashboard"
  const { token, setSession } = useAuthStore()
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: { identifier: "", password: "" },
  })

  // Sudah login? Redirect.
  if (token) return <Navigate to={next} replace />

  const onSubmit = async (values: FormValues) => {
    const parsed = schema.safeParse(values)
    if (!parsed.success) {
      toast.error("Periksa kembali input Anda")
      return
    }
    setSubmitting(true)
    try {
      // Backend pakai OAuth2PasswordRequestForm -- WAJIB form-encoded
      // body dgn field 'username' (di sisi OAuth2 spec) + 'password'.
      // Server detect '@' di nilai utk pilih lookup email vs username.
      const form = new URLSearchParams()
      form.set("username", parsed.data.identifier.trim())
      form.set("password", parsed.data.password)
      const { data: token } = await api.post<TokenResponse>(
        "/auth/login",
        form,
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
      )
      // Token lulus -> simpan dulu (interceptor akan attach Authorization)
      // lalu fetch profile user dr /auth/me.
      setSession(token.access_token, {
        // Placeholder user supaya guard tidak redirect; akan di-overwrite
        // dgn data dari /auth/me di bawah.
        id: 0, email: "", name: "",
        role: "EXECUTIVE", scope_all_projects: false, is_active: true,
      })
      const { data: me } = await api.get<User>("/auth/me")
      setSession(token.access_token, me)
      navigate(next, { replace: true })
    } catch (err) {
      toast.error("Login gagal", { description: apiErrorMessage(err) })
      // Bersihkan token kalau /auth/me gagal setelah login berhasil.
      useAuthStore.getState().logout()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-[100dvh] flex flex-col bg-gradient-to-br from-brand-50 via-surface to-ink-50">
      {/* Brand strip */}
      <div className="flex items-center gap-2 p-4 sm:p-6">
        <div className="flex h-9 w-9 items-center justify-center rounded bg-brand-500 text-white font-bold">
          C
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-base font-bold">CACAK</span>
          <span className="text-[11px] uppercase tracking-wider text-ink-500">
            Catatan Arus Cash &amp; Anggaran Kerja
          </span>
        </div>
      </div>

      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <Card className="w-full max-w-md shadow-md">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Masuk ke akun Anda</CardTitle>
            <CardDescription>
              Catatan Arus Cash dan Anggaran Kerja
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="identifier">Email atau Username</Label>
                <Input
                  id="identifier"
                  type="text"
                  inputMode="email"
                  autoComplete="username"
                  autoFocus
                  placeholder="nama@perusahaan.id atau username"
                  aria-invalid={!!errors.identifier}
                  {...register("identifier")}
                />
                {errors.identifier && (
                  <p className="text-[12px] text-danger-600">{errors.identifier.message}</p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    aria-invalid={!!errors.password}
                    {...register("password")}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-ink-500 hover:text-ink-900"
                    aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {errors.password && (
                  <p className="text-[12px] text-danger-600">{errors.password.message}</p>
                )}
              </div>

              <Button type="submit" size="lg" disabled={submitting} className="mt-2">
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {submitting ? "Memproses…" : "Masuk"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>

      <footer className="p-4 text-center text-[11px] text-ink-500">
        CACAK v2.0 · {new Date().getFullYear()}
      </footer>
    </div>
  )
}
