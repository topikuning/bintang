import { useState } from "react"
import { Link } from "react-router-dom"
import {
  Files,
  HardDrive,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api, apiErrorMessage } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "@/components/ui/sonner"
import { ErrorState } from "@/components/data/ErrorState"

interface OrphanFile {
  path: string
  size_bytes: number
  mtime: number
  url: string
}

interface OrphanScanResult {
  upload_dir: string
  total_files: number
  referenced_count: number
  orphan_count: number
  orphan_size_bytes: number
  orphans: OrphanFile[]
}

const KEY = ["admin", "orphan-files"] as const

function useOrphans() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<OrphanScanResult> => {
      const { data } = await api.get<OrphanScanResult>("/admin/orphan-files")
      return data
    },
    // Scan disk -- jangan auto-refetch, hanya manual.
    staleTime: Infinity,
    retry: false,
  })
}

function useDeleteOrphans() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (paths: string[]) => {
      const { data } = await api.delete<{
        deleted_count: number
        deleted: string[]
        skipped: { path: string; reason: string }[]
      }>("/admin/orphan-files", { data: paths })
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function fmtDate(t: number): string {
  return new Date(t * 1000).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  })
}

/**
 * Halaman SUPERADMIN: scan file orphan (uploaded tapi tdk referenced di
 * DB). Tampilkan list + tombol bulk delete.
 *
 * Use case: setelah hard-delete transaksi/invoice/dll, file di disk
 * tetap. Lewat sini bisa cleanup.
 */
export function OrphanFilesPage() {
  const role = useAuthStore((s) => s.user?.role)
  const isSuper = role === "SUPERADMIN"

  const q = useOrphans()
  const del = useDeleteOrphans()
  const [selected, setSelected] = useState<Set<string>>(new Set())

  if (!isSuper) {
    return (
      <div className="p-4 sm:p-6">
        <div className="rounded-md border border-warning-200 bg-warning-50 p-6 text-center">
          <ShieldCheck className="mx-auto h-8 w-8 text-warning-600 mb-2" />
          <h2 className="text-base font-semibold text-warning-800">
            Akses Terbatas
          </h2>
          <p className="mt-1 text-sm text-warning-700">
            Pemeriksaan file orphan hanya untuk SUPERADMIN.
          </p>
        </div>
      </div>
    )
  }

  if (q.isLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-3">
        <Skeleton className="h-12" />
        <Skeleton className="h-48" />
      </div>
    )
  }
  if (q.error) {
    return (
      <ErrorState
        description={apiErrorMessage(q.error)}
        onRetry={() => q.refetch()}
      />
    )
  }
  if (!q.data) return null

  const d = q.data
  const orphans = d.orphans

  const toggle = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const selectAll = () => {
    if (selected.size === orphans.length) setSelected(new Set())
    else setSelected(new Set(orphans.map((o) => o.path)))
  }

  const handleDelete = async () => {
    if (selected.size === 0) {
      toast.message("Pilih file dulu")
      return
    }
    if (
      !confirm(
        `Hapus permanen ${selected.size} file? Tidak bisa di-undo.`,
      )
    )
      return
    try {
      const r = await del.mutateAsync(Array.from(selected))
      toast.success(`${r.deleted_count} file dihapus`, {
        description: r.skipped?.length
          ? `${r.skipped.length} skipped`
          : undefined,
      })
      setSelected(new Set())
    } catch (err) {
      toast.error("Gagal hapus", { description: apiErrorMessage(err) })
    }
  }

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-5 lg:p-6 max-w-5xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3">
          <HardDrive className="h-6 w-6 text-brand-600 mt-1" />
          <div>
            <h1 className="text-xl font-bold text-ink-900 sm:text-2xl">
              File Orphan
            </h1>
            <p className="text-[12px] text-ink-500 mt-0.5">
              File di storage yang sudah tidak ter-link ke entitas mana
              pun (akibat transaksi/invoice/dll yg hard-deleted). Bisa
              dihapus permanen untuk hemat disk.
            </p>
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => q.refetch()}>
          <RefreshCw className="h-4 w-4" />
          Scan ulang
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatBox label="Total File" value={d.total_files.toLocaleString("id-ID")} />
        <StatBox label="Ter-link" value={d.referenced_count.toLocaleString("id-ID")} tone="success" />
        <StatBox
          label="Orphan"
          value={d.orphan_count.toLocaleString("id-ID")}
          tone={d.orphan_count > 0 ? "warning" : "neutral"}
        />
        <StatBox
          label="Ukuran Orphan"
          value={fmtBytes(d.orphan_size_bytes)}
          tone={d.orphan_size_bytes > 0 ? "warning" : "neutral"}
        />
      </div>

      {orphans.length === 0 ? (
        <div className="rounded-md border border-success-200 bg-success-50 p-6 text-center">
          <ShieldCheck className="mx-auto h-8 w-8 text-success-600 mb-2" />
          <p className="text-sm font-medium text-success-800">
            Tidak ada file orphan. Storage bersih.
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <button
              type="button"
              onClick={selectAll}
              className="text-[12px] text-brand-600 hover:underline"
            >
              {selected.size === orphans.length
                ? "Bersihkan pilihan"
                : `Pilih semua (${orphans.length})`}
            </button>
            <Button
              variant="danger"
              disabled={selected.size === 0 || del.isPending}
              onClick={handleDelete}
            >
              {del.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              <Trash2 className="h-4 w-4" />
              Hapus {selected.size > 0 ? `${selected.size} file` : ""}
            </Button>
          </div>

          <div className="rounded-md border bg-surface overflow-hidden">
            <ul className="divide-y">
              {orphans.map((o) => (
                <li
                  key={o.path}
                  className="flex items-center gap-3 px-3 py-2"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(o.path)}
                    onChange={() => toggle(o.path)}
                    className="h-4 w-4 accent-brand-600"
                  />
                  <Files className="h-4 w-4 text-ink-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <Link
                      to={o.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[13px] text-brand-700 hover:underline font-mono truncate block"
                    >
                      {o.path}
                    </Link>
                    <div className="text-[11px] text-ink-500">
                      {fmtBytes(o.size_bytes)} · diunggah {fmtDate(o.mtime)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      <div className="rounded-md border border-info-200 bg-info-50 p-3 text-[12px] text-info-800">
        <strong>Catatan:</strong> Path = relative ke{" "}
        <code className="font-mono">{d.upload_dir}</code>. File yang
        dihapus tidak bisa di-recover. Saat delete, server re-validate
        status orphan per file (kalau baru di-link, di-skip).
      </div>
    </div>
  )
}

function StatBox({
  label,
  value,
  tone = "neutral",
}: {
  label: string
  value: string
  tone?: "neutral" | "success" | "warning"
}) {
  const toneClass =
    tone === "success"
      ? "border-success-200 bg-success-50 text-success-800"
      : tone === "warning"
        ? "border-warning-200 bg-warning-50 text-warning-800"
        : "border-border bg-surface text-ink-700"
  return (
    <div className={`rounded-md border p-3 ${toneClass}`}>
      <div className="text-[10px] uppercase tracking-wider opacity-70">
        {label}
      </div>
      <div className="text-lg font-bold tabular-nums mt-0.5">{value}</div>
    </div>
  )
}
