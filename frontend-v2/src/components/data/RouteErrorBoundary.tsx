import { Link, useNavigate, useRouteError } from "react-router-dom"
import { AlertTriangle, ArrowLeft, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * Fallback global ketika route element / loader throw error.
 * Dipasang sbg `errorElement` di router config supaya user tdk dapat
 * "Unexpected Application Error!" default dr React Router.
 *
 * Strategi: tampilkan pesan yg ramah + tombol Reload + tombol Kembali ke
 * Dashboard. Saat dev / role superadmin, tampilkan juga stack utk
 * debugging.
 */
export function RouteErrorBoundary() {
  const err = useRouteError()
  const navigate = useNavigate()

  // Cari pesan terbaik dr error object (bisa Error, response API, dst).
  const message =
    (err as Error | undefined)?.message ??
    (typeof err === "string" ? err : null) ??
    "Terjadi kesalahan tak terduga di halaman ini."

  const stack = (err as Error | undefined)?.stack
  const isDev = import.meta.env.DEV

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-md border bg-surface p-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-danger-50 text-danger-600">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h1 className="text-lg font-bold text-ink-900">Terjadi kesalahan</h1>
        <p className="mt-1 text-[13px] text-ink-600">{message}</p>
        <p className="mt-2 text-[11px] text-ink-500">
          Halaman ini gagal dimuat. Coba reload, atau kembali ke dashboard.
        </p>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Button onClick={() => window.location.reload()} size="md">
            <RefreshCw className="h-4 w-4" />
            Reload Halaman
          </Button>
          <Button variant="secondary" onClick={() => navigate("/dashboard")} size="md">
            <ArrowLeft className="h-4 w-4" />
            Ke Dashboard
          </Button>
        </div>

        {isDev && stack && (
          <details className="mt-4 text-left">
            <summary className="cursor-pointer text-[11px] text-ink-500">
              Stack trace (dev only)
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded border bg-ink-50 p-2 text-[10px] font-mono text-ink-700">
              {stack}
            </pre>
          </details>
        )}

        <div className="mt-4 text-[11px] text-ink-500">
          Kalau masalah terus muncul, lapor ke admin dgn screenshot halaman ini.{" "}
          <Link to="/dashboard" className="text-brand-600 hover:underline">
            Beranda
          </Link>
        </div>
      </div>
    </div>
  )
}
