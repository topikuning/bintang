import { Link, useLocation } from "react-router-dom"
import { ArrowLeft, Search } from "lucide-react"
import { Button } from "@/components/ui/button"

/**
 * 404 page -- friendly explain + akses balik. Lebih baik dari silent
 * redirect ke dashboard (user bingung kenapa link mereka tdk works).
 */
export function NotFoundPage() {
  const location = useLocation()

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <div className="w-full max-w-md rounded-md border bg-surface p-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-ink-100 text-ink-600">
          <Search className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-bold text-ink-900">404</h1>
        <p className="mt-1 text-sm font-medium text-ink-700">
          Halaman tidak ditemukan
        </p>
        <p className="mt-2 text-[12px] text-ink-500">
          URL{" "}
          <code className="font-mono bg-ink-100 px-1.5 py-0.5 rounded text-[11px]">
            {location.pathname}
          </code>{" "}
          tidak ada di aplikasi. Mungkin salah ketik atau link sudah usang.
        </p>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Button asChild>
            <Link to="/dashboard">
              <ArrowLeft className="h-4 w-4" />
              Ke Dashboard
            </Link>
          </Button>
          <Button asChild variant="secondary">
            <Link to="/projects">Lihat Proyek</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
