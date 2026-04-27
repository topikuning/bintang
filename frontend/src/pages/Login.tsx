import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Input";

export default function LoginPage() {
  const nav = useNavigate();
  const setToken = useAuthStore((s) => s.setToken);
  const setUser = useAuthStore((s) => s.setUser);

  const [email, setEmail] = useState("admin@bintang.local");
  const [password, setPassword] = useState("admin123");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const body = new URLSearchParams();
      body.set("username", email);
      body.set("password", password);
      const { data } = await api.post("/auth/login", body, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      setToken(data.access_token);
      const me = await api.get("/auth/me");
      setUser(me.data);
      nav("/");
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Gagal login");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-gradient-to-b from-slate-900 to-slate-700 px-4">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl">
        <div className="mb-5 text-center">
          <div className="text-2xl font-bold tracking-tight">Bintang</div>
          <div className="text-xs text-slate-500">
            Biaya, Investasi dan Tata Anggaran Gerak
          </div>
        </div>
        <form onSubmit={submit} noValidate>
          <Field label="Email">
            <Input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {error && <p className="mb-2 text-sm text-rose-600">{error}</p>}
          <Button size="lg" className="w-full" disabled={loading}>
            {loading ? "Memproses..." : "Masuk"}
          </Button>
        </form>
        <p className="mt-4 text-center text-xs text-slate-500">
          Demo: admin@bintang.local / admin123
        </p>
      </div>
    </div>
  );
}
