import { useRef, useState } from "react"
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  FileSpreadsheet,
  Loader2,
  ShieldCheck,
  Upload,
} from "lucide-react"
import {
  useCommitImport,
  useImportEntities,
  usePreviewImport,
  type ImportEntity,
  type ImportPreviewResult,
} from "@/hooks/useImports"
import { useAuthStore } from "@/store/auth"
import { downloadFile } from "@/lib/download"
import { apiErrorMessage } from "@/lib/api"
import { fmtFileSize } from "@/lib/file"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "@/components/ui/sonner"
import { cn } from "@/lib/utils"

/**
 * Halaman Import (bulk upload Excel) -- gated admin.
 * Flow:
 *  1. Pilih entity (transaksi/invoice/PO/kategori/vendor/dst)
 *  2. Download template -> isi file Excel
 *  3. Upload file -> preview (tidak ke DB) -> lihat counts new/dup/errors
 *  4. Pilih dup_action -> Commit -> data masuk DB
 */
export function ImportsPage() {
  const role = useAuthStore((s) => s.user?.role)
  const isAdmin = role === "SUPERADMIN" || role === "CENTRAL_ADMIN"

  const entitiesQ = useImportEntities()
  const previewMut = usePreviewImport()
  const commitMut = useCommitImport()

  const [selectedKey, setSelectedKey] = useState<string>("")
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null)
  const [dupAction, setDupAction] = useState<"skip" | "update" | "error">("skip")
  const [downloading, setDownloading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  if (!isAdmin) {
    return (
      <div className="p-4 sm:p-6">
        <div className="rounded-md border border-warning-200 bg-warning-50 p-6 text-center">
          <ShieldCheck className="mx-auto h-8 w-8 text-warning-600 mb-2" />
          <h2 className="text-base font-semibold text-warning-800">Akses Terbatas</h2>
          <p className="mt-1 text-sm text-warning-700">
            Import bulk hanya untuk SUPERADMIN dan CENTRAL_ADMIN.
          </p>
        </div>
      </div>
    )
  }

  const entity = entitiesQ.data?.find((e) => e.key === selectedKey) ?? null

  const handleSelectEntity = (key: string) => {
    setSelectedKey(key)
    setFile(null)
    setPreview(null)
  }

  const handleFile = (f: File) => {
    setFile(f)
    setPreview(null)
  }

  const handleDownloadTemplate = async () => {
    if (!selectedKey) return
    setDownloading(true)
    try {
      await downloadFile(
        `/imports/${selectedKey}/template`,
        {},
        `template-${selectedKey}.xlsx`,
      )
      toast.success("Template diunduh")
    } catch (err) {
      toast.error("Gagal unduh template", { description: apiErrorMessage(err) })
    } finally {
      setDownloading(false)
    }
  }

  const handlePreview = async () => {
    if (!selectedKey || !file) return
    try {
      const result = await previewMut.mutateAsync({ entity: selectedKey, file })
      setPreview(result)
      if (result.error_count > 0) {
        toast.warning(`Ada ${result.error_count} baris error`, {
          description: "Periksa daftar error di bawah sebelum commit.",
        })
      } else {
        toast.success(`Preview berhasil: ${result.new_count} baris siap di-import`)
      }
    } catch (err) {
      toast.error("Gagal preview", { description: apiErrorMessage(err) })
    }
  }

  const handleCommit = async () => {
    if (!selectedKey || !file) return
    try {
      const result = await commitMut.mutateAsync({
        entity: selectedKey,
        file,
        dupAction,
      })
      toast.success("Import berhasil", {
        description: `${result.new_count} baris baru, ${result.dup_count} duplikat (${dupAction}), ${result.error_count} error.`,
      })
      // Reset
      setFile(null)
      setPreview(null)
      if (fileRef.current) fileRef.current.value = ""
    } catch (err) {
      toast.error("Gagal commit", { description: apiErrorMessage(err) })
    }
  }

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-5 lg:p-6 max-w-4xl">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded bg-brand-50 text-brand-600 shrink-0">
          <Database className="h-4 w-4" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-ink-900 sm:text-2xl">Import Data</h1>
          <p className="text-[13px] text-ink-500 mt-0.5">
            Upload massal dr Excel -- bagus utk migrasi data atau input rutin
            dr template fixed.
          </p>
        </div>
      </div>

      {/* Step 1: Pilih entity */}
      <div className="rounded-md border bg-surface p-4 sm:p-5 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">Langkah 1 — Pilih Jenis Data</h2>
          <p className="text-[12px] text-ink-500 mt-0.5">
            Setiap jenis punya format kolom yg berbeda.
          </p>
        </div>

        {entitiesQ.isLoading ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : entitiesQ.error ? (
          <div className="rounded border border-danger-200 bg-danger-50 p-3 text-[13px] text-danger-700">
            {apiErrorMessage(entitiesQ.error)}
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {entitiesQ.data?.map((e) => (
              <EntityCard
                key={e.key}
                entity={e}
                selected={selectedKey === e.key}
                onClick={() => handleSelectEntity(e.key)}
              />
            ))}
          </div>
        )}
      </div>

      {entity && (
        <>
          {/* Step 2: Download template */}
          <div className="rounded-md border bg-surface p-4 sm:p-5 space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h2 className="text-sm font-semibold text-ink-900">
                  Langkah 2 — Download Template
                </h2>
                <p className="text-[12px] text-ink-500 mt-0.5">
                  Pakai template Excel ini sbg dasar -- kolom & format harus
                  match. {entity.note && <em>{entity.note}</em>}
                </p>
              </div>
              <Button onClick={handleDownloadTemplate} disabled={downloading} size="sm">
                {downloading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                Template {entity.label}
              </Button>
            </div>
            <div className="rounded border bg-surface-muted p-2.5">
              <div className="text-[11px] uppercase tracking-wider text-ink-500 mb-1">
                Kolom yang dibutuhkan
              </div>
              <div className="flex flex-wrap gap-1">
                {entity.headers.map((h) => (
                  <code
                    key={h}
                    className="rounded bg-surface border px-1.5 py-0.5 text-[11px] font-mono text-ink-800"
                  >
                    {h}
                  </code>
                ))}
              </div>
            </div>
          </div>

          {/* Step 3: Upload */}
          <div className="rounded-md border bg-surface p-4 sm:p-5 space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-ink-900">
                Langkah 3 — Upload Excel
              </h2>
              <p className="text-[12px] text-ink-500 mt-0.5">
                File .xlsx, max 20MB.
              </p>
            </div>

            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                const f = e.dataTransfer.files[0]
                if (f) handleFile(f)
              }}
              className="rounded-md border-2 border-dashed bg-surface-muted px-4 py-8 text-center"
            >
              <FileSpreadsheet className="mx-auto h-8 w-8 text-success-600" />
              {file ? (
                <div className="mt-2">
                  <div className="text-sm font-medium">{file.name}</div>
                  <div className="text-[11px] text-ink-500">{fmtFileSize(file.size)}</div>
                  <button
                    type="button"
                    onClick={() => {
                      setFile(null)
                      setPreview(null)
                      if (fileRef.current) fileRef.current.value = ""
                    }}
                    className="mt-2 text-[11px] text-danger-600 hover:underline"
                  >
                    Ganti file
                  </button>
                </div>
              ) : (
                <div className="mt-2">
                  <span className="text-sm text-ink-700">
                    <span className="hidden sm:inline">Tarik file ke sini atau </span>
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="font-semibold text-brand-600 hover:underline"
                    >
                      pilih file Excel
                    </button>
                  </span>
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xlsm"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleFile(f)
                }}
              />
            </div>

            {file && !preview && (
              <div className="flex justify-end">
                <Button onClick={handlePreview} disabled={previewMut.isPending}>
                  {previewMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  <Upload className="h-4 w-4" />
                  Preview
                </Button>
              </div>
            )}
          </div>

          {/* Step 4: Preview & commit */}
          {preview && (
            <div className="rounded-md border bg-surface p-4 sm:p-5 space-y-3">
              <div>
                <h2 className="text-sm font-semibold text-ink-900">
                  Langkah 4 — Konfirmasi & Commit
                </h2>
                <p className="text-[12px] text-ink-500 mt-0.5">
                  Review hasil preview di bawah. Tekan Commit untuk simpan ke
                  database.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <SummaryCard
                  tone="success"
                  icon={CheckCircle2}
                  count={preview.new_count}
                  label="Baris Baru"
                />
                <SummaryCard
                  tone="warning"
                  icon={AlertTriangle}
                  count={preview.dup_count}
                  label="Duplikat"
                />
                <SummaryCard
                  tone="danger"
                  icon={AlertCircle}
                  count={preview.error_count}
                  label="Error"
                />
              </div>

              {preview.error_count > 0 && (
                <div className="rounded border border-danger-200 bg-danger-50 p-3">
                  <div className="text-[12px] font-semibold text-danger-700 mb-1">
                    Daftar Error (max 50)
                  </div>
                  <pre className="text-[11px] font-mono text-danger-800 overflow-x-auto whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                    {JSON.stringify(preview.errors, null, 2)}
                  </pre>
                </div>
              )}

              {preview.dup_count > 0 && (
                <div className="flex flex-col gap-1.5">
                  <Label className="text-[11px] uppercase tracking-wider">
                    Aksi untuk Duplikat
                  </Label>
                  <Select
                    value={dupAction}
                    onChange={(e) => setDupAction(e.target.value as typeof dupAction)}
                  >
                    <option value="skip">Skip (lewati duplikat)</option>
                    <option value="update">Update (timpa data lama)</option>
                    <option value="error">Error (batalkan kalau ada duplikat)</option>
                  </Select>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setPreview(null)}>
                  Reset
                </Button>
                <Button
                  onClick={handleCommit}
                  disabled={
                    commitMut.isPending ||
                    (preview.error_count > 0 && dupAction === "error")
                  }
                >
                  {commitMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  <Database className="h-4 w-4" />
                  Commit ({preview.new_count + (dupAction === "skip" ? 0 : preview.dup_count)} baris)
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function EntityCard({
  entity,
  selected,
  onClick,
}: {
  entity: ImportEntity
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md border p-3 text-left transition-colors",
        selected
          ? "border-brand-500 bg-brand-50/50"
          : "bg-surface hover:border-border-strong hover:bg-surface-muted",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-semibold">{entity.label}</div>
        {selected && <Badge tone="info">Dipilih</Badge>}
      </div>
      <div className="text-[11px] text-ink-500 mt-1">
        {entity.headers.length} kolom · {entity.key}
      </div>
    </button>
  )
}

function SummaryCard({
  tone,
  icon: Icon,
  count,
  label,
}: {
  tone: "success" | "warning" | "danger"
  icon: React.ComponentType<{ className?: string }>
  count: number
  label: string
}) {
  const toneCls = {
    success: "bg-success-50 border-success-200 text-success-800",
    warning: "bg-warning-50 border-warning-200 text-warning-800",
    danger: "bg-danger-50 border-danger-200 text-danger-800",
  }[tone]
  return (
    <div className={cn("rounded-md border p-3 text-center", toneCls)}>
      <Icon className="mx-auto h-5 w-5 mb-1" />
      <div data-num className="text-2xl font-bold font-mono [font-variant-numeric:tabular-nums]">
        {count}
      </div>
      <div className="text-[11px] uppercase tracking-wider mt-0.5">{label}</div>
    </div>
  )
}
