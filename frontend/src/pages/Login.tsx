import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, Loader2, Mail } from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Input";

export default function LoginPage() {
  const nav = useNavigate();
  const setToken = useAuthStore((s) => s.setToken);
  const setUser = useAuthStore((s) => s.setUser);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLoading(true);
    setError(null);
    try {
      const body = new URLSearchParams();
      body.set("username", email.trim());
      body.set("password", password);
      const { data } = await api.post("/auth/login", body, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      setToken(data.access_token);
      const me = await api.get("/auth/me");
      setUser(me.data);
      nav("/");
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setError(
        detail === "invalid_credentials"
          ? "Email atau password salah."
          : detail || "Gagal masuk. Coba lagi.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center text-white">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-amber-400 text-slate-900 shadow-lg">
            <span className="text-2xl font-black">B</span>
          </div>
          <div className="text-2xl font-bold tracking-tight">Bintang</div>
          <div className="text-xs text-slate-300">
            Biaya, Investasi dan Tata Anggaran Gerak
          </div>
        </div>

        <div className="rounded-3xl bg-white p-6 shadow-2xl">
          <form onSubmit={submit} noValidate>
            <Field label="Email">
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="nama@perusahaan.com"
                  className="pl-9"
                />
              </div>
            </Field>

            <Field label="Password">
              <div className="relative">
                <Input
                  type={showPass ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  aria-label={showPass ? "Sembunyikan password" : "Tampilkan password"}
                  className="absolute right-2 top-1/2 -translate-y-1/2 grid h-7 w-7 place-items-center rounded-full text-slate-400 hover:bg-slate-100"
                >
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>

            {error && (
              <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {error}
              </div>
            )}

            <Button
              size="lg"
              className="w-full"
              disabled={loading || !email.trim() || !password}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Memproses...
                </>
              ) : (
                "Masuk"
              )}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-[11px] text-slate-400">
          © {new Date().getFullYear()} Bintang. Semua hak dilindungi.
        </p>
      </div>
    </div>
  );
}
