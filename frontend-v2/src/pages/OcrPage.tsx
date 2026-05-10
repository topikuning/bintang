import { useRef, useState, type DragEvent } from "react"
import { Link as RouterLink } from "react-router-dom"
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Link2,
  Loader2,
  PenLine,
  Receipt,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Upload,
  X,
  XCircle,
} from "lucide-react"
import {
  useOcrCreateInvoice,
  useOcrDiscardDraft,
  useOcrDrafts,
  useOcrExtract,
  useOcrExtractUpload,
  useOcrTestConnection,
  type OcrDraft,
} from "@/hooks/useOcr"
import { ProjectPicker } from "@/components/forms/ProjectPicker"
import { VendorPicker } from "@/components/forms/VendorPicker"
import { useAuthStore } from "@/store/auth"
import { apiErrorMessage } from "@/lib/api"
import { fmtDateTime, fmtPct } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorState } from "@/components/data/ErrorState"
import { toast } from "@/components/ui/sonner"
import { cn } from "@/lib/utils"

const ACCEPT = "image/jpeg,image/jpg,image/png,image/webp,image/heic,image/heif,application/pdf"
const MAX_MB = 20

type Mode = "upload" | "url"
type Entity = "invoice" | "receipt" | "po"

interface OcrItem {
  description?: string
  qty?: number | string
  unit?: string
  price?: number | string
  amount?: number | string
}

/**
 * Halaman Asisten OCR -- gated admin.
 *
 * Engine: Claude Vision (Haiku 4.5) bila ANTHROPIC_API_KEY + OCR_ENGINE=claude
 * di-set di backend; selain itu adapter jatuh ke stub mode (data demo).
 *
 * Flow:
 *  1. Pilih mode: Upload langsung (drag/drop atau pick file) atau paste URL
 *  2. POST /ocr/extract-upload (multipart) atau /ocr/extract (JSON URL)
 *  3. Backend simpan AIExtraction draft -> muncul di list dgn ringkasan
 *  4. Klik Buat Invoice (pilih project + IN/OUT + vendor opsional) -> Invoice
 *     DRAFT tercipta dgn data + lampiran. Edit/koreksi field di InvoiceForm
 *     setelah submit (status DRAFT semua field editable).
 *  5. Hapus Draft kalau hasil OCR salah/blur dan tidak akan dipakai.
 */
export function OcrPage() {
  const role = useAuthStore((s) => s.user?.role)
  const isAdmin = role === "SUPERADMIN" || role === "CENTRAL_ADMIN"

  const draftsQ = useOcrDrafts()
  const extract = useOcrExtract()
  const extractUpload = useOcrExtractUpload()
  const discard = useOcrDiscardDraft()
  const testConn = useOcrTestConnection()

  const [mode, setMode] = useState<Mode>("upload")
  const [fileUrl, setFileUrl] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [filePreview, setFilePreview] = useState<string | null>(null)
  const [entity, setEntity] = useState<Entity>("invoice")
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isPending = extract.isPending || extractUpload.isPending

  if (!isAdmin) {
    return (
      <div className="p-4 sm:p-6">
        <div className="rounded-md border border-warning-200 bg-warning-50 p-6 text-center">
          <ShieldCheck className="mx-auto h-8 w-8 text-warning-600 mb-2" />
          <h2 className="text-base font-semibold text-warning-800">Akses Terbatas</h2>
          <p className="mt-1 text-sm text-warning-700">
            Asisten OCR hanya untuk SUPERADMIN dan CENTRAL_ADMIN.
          </p>
        </div>
      </div>
    )
  }

  const pickFile = (f: File | null) => {
    if (!f) {
      setFile(null)
      setFilePreview(null)
      return
    }
    if (f.size > MAX_MB * 1024 * 1024) {
      toast.error("File terlalu besar", {
        description: `Maksimal ${MAX_MB} MB. File kamu ${(f.size / 1024 / 1024).toFixed(1)} MB.`,
      })
      return
    }
    setFile(f)
    if (f.type.startsWith("image/")) {
      const url = URL.createObjectURL(f)
      setFilePreview(url)
    } else {
      setFilePreview(null)
    }
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const f = e.dataTransfer.files?.[0]
    if (f) pickFile(f)
  }

  const handleExtract = async () => {
    try {
      let result
      if (mode === "url") {
        const url = fileUrl.trim()
        if (!url) return
        result = await extract.mutateAsync({ file_url: url, entity })
        setFileUrl("")
      } else {
        if (!file) return
        setUploadPct(0)
        result = await extractUpload.mutateAsync({
          file,
          entity,
          onProgress: setUploadPct,
        })
        pickFile(null)
        if (fileInputRef.current) fileInputRef.current.value = ""
      }
      const conf = Math.round((result.confidence_score ?? 0) * 100)
      toast.success("Berhasil ekstrak data", {
        description: `Confidence ${conf}%. Periksa hasilnya di daftar di bawah.`,
      })
      setExpandedId(result.id)
    } catch (err) {
      toast.error("Gagal ekstrak", { description: apiErrorMessage(err) })
    } finally {
      setUploadPct(null)
    }
  }

  const handleTestConnection = async () => {
    try {
      const r = await testConn.mutateAsync()
      if (r.ok) {
        toast.success("Koneksi Claude API OK", {
          description: `${r.model} -- ${r.latency_ms}ms`,
        })
      } else {
        toast.error("Koneksi gagal", {
          description: r.hint ?? r.detail ?? r.error ?? "unknown",
        })
      }
    } catch (err) {
      toast.error("Test koneksi error", {
        description: apiErrorMessage(err),
      })
    }
  }

  const handleDiscard = async (id: number) => {
    if (!confirm(`Hapus draft #${id}? File asli tetap di storage.`)) return
    try {
      await discard.mutateAsync(id)
      toast.success(`Draft #${id} dihapus`, {
        description: "Hasil ekstraksi yang salah dibuang dari list.",
      })
    } catch (err) {
      toast.error("Gagal hapus draft", { description: apiErrorMessage(err) })
    }
  }

  const submitDisabled =
    isPending || (mode === "url" ? !fileUrl.trim() : !file)

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-5 lg:p-6 max-w-4xl">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded bg-brand-50 text-brand-600 shrink-0">
          <ScanLine className="h-4 w-4" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-ink-900 sm:text-2xl">Asisten OCR</h1>
          <p className="text-[13px] text-ink-500 mt-0.5">
            Scan kuitansi / invoice / struk -- termasuk tulisan tangan -- untuk
            auto-extract data.
          </p>
        </div>
      </div>

      {/* Banner: Claude Vision + Test koneksi */}
      <div className="rounded-md border border-info-200 bg-info-50 p-3 sm:p-4 flex items-start gap-2 flex-wrap">
        <Sparkles className="h-4 w-4 text-info-600 mt-0.5 shrink-0" />
        <div className="text-[12px] text-info-800 leading-relaxed flex-1 min-w-[200px]">
          <strong>Powered by Claude Vision.</strong> Mendukung dokumen cetak
          maupun tulisan tangan, ekstrak nomor, tanggal, vendor, total, dan
          tiap baris item. Confidence rendah otomatis ditandai untuk review
          manual.
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleTestConnection}
          disabled={testConn.isPending}
          className="border-info-300 text-info-700 hover:bg-info-100 shrink-0"
        >
          {testConn.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Stethoscope className="h-3.5 w-3.5" />
          )}
          Test Koneksi
        </Button>
      </div>
      {testConn.data && <TestConnectionResultCard result={testConn.data} />}

      {/* Submit form */}
      <div className="rounded-md border bg-surface p-4 sm:p-5 space-y-3">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-ink-900">Ekstrak Dokumen Baru</h2>
            <p className="text-[12px] text-ink-500 mt-0.5">
              {mode === "upload"
                ? "Drag & drop file, atau klik untuk pilih. Gambar (JPG/PNG/HEIC/WebP) atau PDF."
                : "Tempel URL gambar/PDF publik (Drive, Dropbox, S3, dll)."}
            </p>
          </div>
          {/* Mode tabs */}
          <div className="inline-flex rounded-md border bg-surface-muted p-0.5">
            <button
              type="button"
              onClick={() => setMode("upload")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1 text-[12px] rounded-sm transition-colors",
                mode === "upload"
                  ? "bg-surface text-ink-900 shadow-sm font-medium"
                  : "text-ink-500 hover:text-ink-700",
              )}
            >
              <Upload className="h-3.5 w-3.5" />
              Upload
            </button>
            <button
              type="button"
              onClick={() => setMode("url")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1 text-[12px] rounded-sm transition-colors",
                mode === "url"
                  ? "bg-surface text-ink-900 shadow-sm font-medium"
                  : "text-ink-500 hover:text-ink-700",
              )}
            >
              <Link2 className="h-3.5 w-3.5" />
              URL
            </button>
          </div>
        </div>

        {mode === "upload" ? (
          <div className="space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
            {file ? (
              <div className="flex items-start gap-3 rounded-md border bg-surface-muted p-3">
                {filePreview ? (
                  <img
                    src={filePreview}
                    alt={file.name}
                    className="h-16 w-16 rounded border object-cover bg-surface"
                  />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded border bg-surface text-ink-400">
                    <FileText className="h-6 w-6" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-ink-900 truncate">
                    {file.name}
                  </div>
                  <div className="text-[11px] text-ink-500 font-mono">
                    {file.type || "unknown"} · {(file.size / 1024).toFixed(0)} KB
                  </div>
                  {uploadPct !== null && (
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink-100">
                      <div
                        className="h-full bg-brand-500 transition-all"
                        style={{ width: `${uploadPct}%` }}
                      />
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    pickFile(null)
                    if (fileInputRef.current) fileInputRef.current.value = ""
                  }}
                  className="text-ink-400 hover:text-danger-600 p-1"
                  aria-label="Buang file"
                  disabled={isPending}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                }}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-ink-200 bg-surface-muted p-6 text-center cursor-pointer hover:border-brand-300 hover:bg-brand-50/30 transition-colors"
              >
                <Upload className="h-8 w-8 text-ink-400" />
                <div className="text-[13px] text-ink-700">
                  Drag & drop file di sini, atau{" "}
                  <span className="text-brand-600 font-medium">klik untuk pilih</span>
                </div>
                <div className="text-[11px] text-ink-500">
                  JPG / PNG / HEIC / WebP / PDF · maks {MAX_MB} MB
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <Label className="text-[11px] uppercase tracking-wider">URL File</Label>
            <Input
              value={fileUrl}
              onChange={(e) => setFileUrl(e.target.value)}
              placeholder="https://drive.google.com/…"
              type="url"
              inputMode="url"
            />
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-[180px_auto] sm:items-end">
          <div className="flex flex-col gap-1">
            <Label className="text-[11px] uppercase tracking-wider">Jenis</Label>
            <Select
              value={entity}
              onChange={(e) => setEntity(e.target.value as Entity)}
            >
              <option value="invoice">Invoice</option>
              <option value="receipt">Kuitansi/Struk</option>
              <option value="po">Purchase Order</option>
            </Select>
          </div>
          <Button
            onClick={handleExtract}
            disabled={submitDisabled}
            className="w-full sm:w-auto sm:ml-auto"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            <ScanLine className="h-4 w-4" />
            Extract
          </Button>
        </div>
      </div>

      {/* Drafts list */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-ink-900 flex items-center gap-1.5">
          <ImageIcon className="h-4 w-4 text-ink-500" />
          Riwayat Ekstraksi (max 100 terbaru)
        </h2>

        {draftsQ.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        ) : draftsQ.error ? (
          <ErrorState
            description={apiErrorMessage(draftsQ.error)}
            onRetry={() => draftsQ.refetch()}
          />
        ) : draftsQ.data && draftsQ.data.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {draftsQ.data.map((d) => (
              <DraftCard
                key={d.id}
                draft={d}
                isExpanded={expandedId === d.id}
                onToggle={() => setExpandedId((c) => (c === d.id ? null : d.id))}
                onDiscard={() => handleDiscard(d.id)}
                isDiscarding={discard.isPending}
              />
            ))}
          </ul>
        ) : (
          <div className="rounded-md border border-dashed bg-surface-muted p-8 text-center">
            <ScanLine className="mx-auto h-7 w-7 text-ink-400 mb-2" />
            <p className="text-[13px] text-ink-500">
              Belum ada hasil ekstraksi. Mulai dengan upload file atau paste URL di atas.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function fmtRupiah(v: unknown): string {
  if (v == null || v === "") return "—"
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v)
  return `Rp ${n.toLocaleString("id-ID")}`
}

function DraftCard({
  draft,
  isExpanded,
  onToggle,
  onDiscard,
  isDiscarding,
}: {
  draft: OcrDraft
  isExpanded: boolean
  onToggle: () => void
  onDiscard: () => void
  isDiscarding: boolean
}) {
  const conf = draft.confidence_score ?? 0
  const confTone =
    conf >= 0.85 ? "success" : conf >= 0.6 ? "warning" : "danger"
  const isLinked = draft.entity_id != null
  const data = (draft.extracted_data ?? {}) as Record<string, unknown>

  const summary = {
    nomor: (data["invoice_number"] as string) ?? null,
    tanggal: (data["invoice_date"] as string) ?? null,
    vendor: (data["vendor_name"] as string) ?? null,
    total: (data["total"] as string | number) ?? null,
    subtotal: (data["subtotal"] as string | number) ?? null,
    tax: (data["tax"] as string | number) ?? null,
    dueDate: (data["due_date"] as string) ?? null,
    notes: (data["notes"] as string) ?? null,
    isHandwritten: data["is_handwritten"] === true,
  }
  const items = Array.isArray(data["items"])
    ? (data["items"] as OcrItem[])
    : []

  return (
    <li
      className={cn(
        "rounded-md border bg-surface",
        isLinked && "border-success-200",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-surface-muted"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-brand-600 shrink-0">
          <ScanLine className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[12px] text-ink-700">#{draft.id}</span>
            <Badge tone="neutral">{draft.entity}</Badge>
            {isLinked && (
              <Badge tone="success">
                <CheckCircle2 className="h-3 w-3" />
                Inv. #{draft.entity_id}
              </Badge>
            )}
            {summary.isHandwritten && (
              <Badge tone="warning">
                <PenLine className="h-3 w-3" />
                Tulisan tangan
              </Badge>
            )}
            <Badge tone={confTone}>{fmtPct(conf)} confidence</Badge>
          </div>
          {summary.vendor && (
            <div className="text-sm font-medium truncate">{summary.vendor}</div>
          )}
          <div className="text-[11px] text-ink-500 truncate font-mono">
            {summary.nomor ?? "—"} · {summary.tanggal ?? "—"}
            {summary.total != null && <> · {fmtRupiah(summary.total)}</>}
          </div>
          {draft.reviewed_at && (
            <div className="text-[11px] text-ink-500">
              Direview: {fmtDateTime(draft.reviewed_at)}
            </div>
          )}
        </div>
        <div className="shrink-0 pt-1">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-ink-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-ink-400" />
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="border-t bg-surface-muted px-3 py-3 space-y-3">
          {/* Source URL */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-ink-500 mb-1">
              Source
            </div>
            <a
              href={draft.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[12px] font-mono text-brand-600 hover:underline break-all"
            >
              {draft.source_url}
            </a>
          </div>

          {/* Confidence visual */}
          <div>
            <div className="flex justify-between text-[11px] mb-1">
              <span className="text-ink-500">Confidence</span>
              <span className="font-mono font-semibold [font-variant-numeric:tabular-nums]">
                {fmtPct(conf)}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
              <div
                className={cn(
                  "h-full",
                  confTone === "success" && "bg-success-500",
                  confTone === "warning" && "bg-warning-500",
                  confTone === "danger" && "bg-danger-500",
                )}
                style={{ width: `${conf * 100}%` }}
              />
            </div>
            {conf < 0.6 && (
              <p className="mt-1 flex items-start gap-1 text-[11px] text-warning-700">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                Confidence rendah -- periksa hasil dengan teliti.
              </p>
            )}
          </div>

          {/* Field summary */}
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
            <FieldCell label="Nomor" value={summary.nomor} />
            <FieldCell label="Tanggal" value={summary.tanggal} />
            <FieldCell label="Jatuh Tempo" value={summary.dueDate} />
            <FieldCell label="Vendor" value={summary.vendor} />
            <FieldCell label="Subtotal" value={fmtRupiah(summary.subtotal)} mono />
            <FieldCell label="Pajak" value={fmtRupiah(summary.tax)} mono />
            <FieldCell label="Total" value={fmtRupiah(summary.total)} mono strong />
          </div>

          {/* Items table */}
          {items.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-ink-500 mb-1">
                Items ({items.length})
              </div>
              <div className="overflow-x-auto rounded border bg-surface">
                <table className="w-full text-[12px]">
                  <thead className="bg-surface-muted text-ink-500">
                    <tr className="[&>th]:px-2 [&>th]:py-1.5 [&>th]:text-left [&>th]:font-medium">
                      <th>Deskripsi</th>
                      <th className="text-right">Qty</th>
                      <th>Unit</th>
                      <th className="text-right">Harga</th>
                      <th className="text-right">Jumlah</th>
                    </tr>
                  </thead>
                  <tbody className="[&>tr]:border-t [&>tr>td]:px-2 [&>tr>td]:py-1.5 [&>tr>td]:align-top">
                    {items.map((it, i) => (
                      <tr key={i}>
                        <td className="text-ink-900">{it.description ?? "—"}</td>
                        <td className="text-right font-mono [font-variant-numeric:tabular-nums]">
                          {it.qty ?? "—"}
                        </td>
                        <td className="text-ink-500">{it.unit ?? "—"}</td>
                        <td className="text-right font-mono [font-variant-numeric:tabular-nums]">
                          {fmtRupiah(it.price)}
                        </td>
                        <td className="text-right font-mono [font-variant-numeric:tabular-nums] font-medium">
                          {fmtRupiah(it.amount ?? it.price)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Notes from OCR */}
          {summary.notes && (
            <div className="rounded-md border border-warning-200 bg-warning-50 p-2 text-[12px] text-warning-800 flex items-start gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-warning-600" />
              <div>
                <strong>Catatan OCR:</strong> {summary.notes}
              </div>
            </div>
          )}

          {/* Raw JSON (collapsed under <details>) */}
          <details className="text-[11px]">
            <summary className="cursor-pointer text-ink-500 hover:text-ink-700">
              Lihat JSON mentah
            </summary>
            <pre className="mt-1 overflow-x-auto rounded border bg-surface p-2 font-mono text-ink-800 whitespace-pre-wrap break-all max-h-60 overflow-y-auto">
              {JSON.stringify(data, null, 2)}
            </pre>
          </details>

          {/* Aksi: kalau sudah linked ke invoice, tampilkan badge sukses.
               Kalau belum, tampilkan panel Buat Invoice + tombol Hapus Draft.
               Step "Setujui & Tandai Direview" sengaja dihilangkan karena
               tidak punya nilai praktis -- koreksi data terjadi di
               InvoiceForm setelah submit (semua field editable saat status
               masih DRAFT). */}
          {isLinked ? (
            <div className="rounded-md border border-success-200 bg-success-50 p-3 flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 text-[12px] text-success-800">
                <CheckCircle2 className="h-4 w-4 text-success-600 shrink-0" />
                <span>
                  Sudah dibuat menjadi <strong>Invoice #{draft.entity_id}</strong>
                  {" "}-- file lampiran ikut ter-attach.
                </span>
              </div>
              <RouterLink
                to="/invoices"
                className="inline-flex items-center gap-1 text-[12px] text-brand-600 hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Lihat invoice
              </RouterLink>
            </div>
          ) : (
            <>
              <CreateInvoiceFromDraftPanel draft={draft} />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onDiscard}
                  disabled={isDiscarding}
                  className="border-danger-300 text-danger-700 hover:bg-danger-50"
                >
                  {isDiscarding && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <XCircle className="h-3.5 w-3.5" />
                  Hapus Draft
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </li>
  )
}

function CreateInvoiceFromDraftPanel({ draft }: { draft: OcrDraft }) {
  const create = useOcrCreateInvoice()
  const [open, setOpen] = useState(false)
  const [projectId, setProjectId] = useState<number | null>(null)
  const [type, setType] = useState<"IN" | "OUT">("IN")
  const [vendorId, setVendorId] = useState<number | null>(null)

  const data = (draft.extracted_data ?? {}) as Record<string, unknown>
  const itemsCount = Array.isArray(data["items"])
    ? (data["items"] as unknown[]).length
    : 0
  const totalNum =
    typeof data["total"] === "number"
      ? (data["total"] as number)
      : Number(data["total"])
  const totalLabel = Number.isFinite(totalNum)
    ? `Rp ${Number(totalNum).toLocaleString("id-ID")}`
    : "—"

  const handleSubmit = async () => {
    if (!projectId) {
      toast.error("Proyek wajib dipilih")
      return
    }
    try {
      const result = await create.mutateAsync({
        draft_id: draft.id,
        project_id: projectId,
        type,
        vendor_client_id: vendorId,
      })
      toast.success(`Invoice ${result.invoice_number} berhasil dibuat`, {
        description: `${result.items_count} item · Rp ${result.total.toLocaleString("id-ID")} · ${result.attachments_count} lampiran. Status: ${result.status}.`,
      })
      // Form di-collapse otomatis karena draft.entity_id ke-update via
      // invalidate query -> komponen ini hilang, replaced dgn linked badge.
      setOpen(false)
    } catch (err) {
      toast.error("Gagal buat invoice", { description: apiErrorMessage(err) })
    }
  }

  if (!open) {
    return (
      <div className="rounded-md border bg-surface p-3 space-y-2">
        <div className="flex items-start gap-2 text-[12px] text-ink-700">
          <Receipt className="h-4 w-4 text-brand-600 shrink-0 mt-0.5" />
          <div>
            Buat <strong>Invoice DRAFT</strong> dengan{" "}
            <span className="font-mono">{itemsCount}</span> item ({totalLabel}) +
            file gambar otomatis ter-attach sebagai lampiran. Edit / koreksi
            field di form Invoice setelah submit.
          </div>
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setOpen(true)}>
            <Receipt className="h-3.5 w-3.5" />
            Buat Invoice
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-md border border-brand-200 bg-brand-50/30 p-3 space-y-3">
      <div className="text-[12px] font-semibold text-ink-900 flex items-center gap-1.5">
        <Receipt className="h-4 w-4 text-brand-600" />
        Buat Invoice dari Draft
      </div>

      {/* Type IN/OUT segment */}
      <div className="space-y-1">
        <Label className="text-[11px] uppercase tracking-wider">
          Jenis Invoice <span className="text-danger-600">*</span>
        </Label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setType("IN")}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-[12px] transition-colors",
              type === "IN"
                ? "border-brand-500 bg-brand-50 text-brand-700 font-medium"
                : "border-ink-200 bg-surface text-ink-600 hover:border-ink-300",
            )}
          >
            <ArrowDownToLine className="h-3.5 w-3.5" />
            IN (tagihan masuk)
          </button>
          <button
            type="button"
            onClick={() => setType("OUT")}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-[12px] transition-colors",
              type === "OUT"
                ? "border-brand-500 bg-brand-50 text-brand-700 font-medium"
                : "border-ink-200 bg-surface text-ink-600 hover:border-ink-300",
            )}
          >
            <ArrowUpFromLine className="h-3.5 w-3.5" />
            OUT (tagihan kita)
          </button>
        </div>
      </div>

      {/* Project */}
      <div className="space-y-1">
        <Label className="text-[11px] uppercase tracking-wider">
          Proyek <span className="text-danger-600">*</span>
        </Label>
        <ProjectPicker
          value={projectId}
          onChange={setProjectId}
          placeholder="Pilih proyek tujuan invoice"
        />
        <p className="text-[11px] text-ink-500">
          Proyek tidak ada di OCR -- harus dipilih manual.
        </p>
      </div>

      {/* Vendor */}
      <div className="space-y-1">
        <Label className="text-[11px] uppercase tracking-wider">
          Vendor / Klien <span className="text-ink-400">(opsional)</span>
        </Label>
        <VendorPicker
          value={vendorId}
          onChange={setVendorId}
          kind={type === "IN" ? "VENDOR" : "CLIENT"}
          placeholder={
            type === "IN" ? "Pilih vendor (kalau sudah terdaftar)" : "Pilih klien"
          }
        />
        <p className="text-[11px] text-ink-500">
          Kalau kosong, nama dari OCR (
          <span className="font-mono">
            {(data["vendor_name"] as string) ?? "—"}
          </span>
          ) dipakai sebagai <em>party_name</em> bebas.
        </p>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setOpen(false)}
          disabled={create.isPending}
        >
          Batal
        </Button>
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={!projectId || create.isPending}
        >
          {create.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          <Receipt className="h-3.5 w-3.5" />
          Buat Invoice
        </Button>
      </div>
    </div>
  )
}

function FieldCell({
  label,
  value,
  mono,
  strong,
}: {
  label: string
  value: string | number | null | undefined
  mono?: boolean
  strong?: boolean
}) {
  return (
    <div className="rounded border bg-surface p-2">
      <div className="text-[10px] uppercase tracking-wider text-ink-500">
        {label}
      </div>
      <div
        className={cn(
          "text-[12px] text-ink-900 truncate",
          mono && "font-mono [font-variant-numeric:tabular-nums]",
          strong && "font-semibold",
        )}
      >
        {value == null || value === "" ? "—" : value}
      </div>
    </div>
  )
}

function TestConnectionResultCard({
  result,
}: {
  result: import("@/hooks/useOcr").OcrTestConnectionResult
}) {
  if (result.ok) {
    return (
      <div className="rounded-md border border-success-200 bg-success-50 p-3 text-[12px] text-success-800 flex items-start gap-2">
        <CheckCircle2 className="h-4 w-4 text-success-600 mt-0.5 shrink-0" />
        <div className="space-y-0.5">
          <div>
            <strong>Koneksi OK.</strong> Model {result.model}, latency{" "}
            {result.latency_ms}ms.
          </div>
          {result.reply && (
            <div className="font-mono text-[11px] text-success-700">
              Reply: {result.reply}
            </div>
          )}
          {(result.input_tokens != null || result.output_tokens != null) && (
            <div className="font-mono text-[11px] text-success-700">
              Tokens: in={result.input_tokens} out={result.output_tokens}
            </div>
          )}
        </div>
      </div>
    )
  }
  return (
    <div className="rounded-md border border-danger-200 bg-danger-50 p-3 text-[12px] text-danger-800 flex items-start gap-2">
      <XCircle className="h-4 w-4 text-danger-600 mt-0.5 shrink-0" />
      <div className="space-y-0.5 flex-1 min-w-0">
        <div>
          <strong>Koneksi gagal:</strong> {result.error ?? "unknown"}
        </div>
        {result.hint && (
          <div className="text-danger-700">💡 {result.hint}</div>
        )}
        {result.detail && (
          <details className="text-[11px]">
            <summary className="cursor-pointer text-danger-600 hover:text-danger-800">
              Detail teknis
            </summary>
            <pre className="mt-1 font-mono whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
              {result.detail}
            </pre>
          </details>
        )}
      </div>
    </div>
  )
}
