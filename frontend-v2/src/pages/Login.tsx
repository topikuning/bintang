import { useState } from "react"
import { useForm } from "react-hook-form"
import { useNavigate, useSearchParams, Navigate } from "react-router"
import { BarChart3, CheckCircle2, Eye, EyeOff, Loader2, ShieldCheck, Sparkles } from "lucide-react"
import { z } from "zod"
import { api, apiErrorMessage } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import type { TokenResponse, User } from "@/types/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "@/components/ui/sonner"
import { BrandMark } from "@/components/layout/BrandMark"

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
    <div className="grid min-h-[100dvh] bg-white lg:grid-cols-[minmax(0,1.1fr)_minmax(440px,0.9fr)]">
      <section className="relative hidden overflow-hidden bg-[var(--app-nav)] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-brand-500/20 blur-3xl" />
        <div className="absolute -bottom-40 -left-24 h-96 w-96 rounded-full bg-info-500/10 blur-3xl" />
        <BrandMark inverse className="relative" />

        <div className="relative max-w-xl">
          <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs text-slate-300">
            <Sparkles className="h-3.5 w-3.5 text-brand-300" /> Satu ruang kerja finansial
          </span>
          <h1 className="text-5xl font-bold leading-[1.08] tracking-[-0.045em]">
            Kendalikan arus dana, proyek, dan keputusan.
          </h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-slate-400">
            Visibilitas keuangan end-to-end untuk tim operasional dan pengambil keputusan—tanpa spreadsheet yang terpisah-pisah.
          </p>
          <div className="mt-10 grid grid-cols-3 gap-3">
            <LoginFeature icon={BarChart3} label="Real-time insight" />
            <LoginFeature icon={CheckCircle2} label="Approval terarah" />
            <LoginFeature icon={ShieldCheck} label="Audit siap telusur" />
          </div>
        </div>

        <p className="relative text-xs text-slate-500">Bintang Financial OS · {new Date().getFullYear()}</p>
      </section>

      <main className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden px-5 py-10 sm:px-10">
        <div className="absolute right-0 top-0 h-72 w-72 rounded-full bg-brand-100/60 blur-3xl" />
        <div className="relative w-full max-w-md">
          <BrandMark className="mb-12 lg:hidden" />
          <Card className="border-0 bg-white/90 shadow-none ring-0 sm:p-2 lg:bg-transparent">
          <CardHeader className="px-0 text-left sm:px-0">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-brand-600">Selamat datang kembali</p>
            <CardTitle className="text-3xl tracking-[-0.04em]">Masuk ke Bintang</CardTitle>
            <CardDescription>
              Gunakan akun organisasi Anda untuk melanjutkan.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0 sm:px-0">
            <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
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

              <Button type="submit" size="lg" disabled={submitting} className="mt-2 w-full">
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {submitting ? "Memproses…" : "Masuk"}
              </Button>
            </form>
          </CardContent>
          </Card>
          <p className="mt-8 text-center text-[11px] text-ink-400 lg:hidden">Bintang Financial OS · {new Date().getFullYear()}</p>
        </div>
      </main>
    </div>
  )
}

function LoginFeature({ icon: Icon, label }: { icon: typeof BarChart3; label: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.05] p-4">
      <Icon className="mb-3 h-5 w-5 text-brand-300" />
      <p className="text-xs font-medium text-slate-300">{label}</p>
    </div>
  )
}
