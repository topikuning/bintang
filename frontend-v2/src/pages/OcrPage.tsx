import { useState } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Image as ImageIcon,
  Loader2,
  ScanLine,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react"
import {
  useOcrDrafts,
  useOcrExtract,
  useOcrReview,
  type OcrDraft,
} from "@/hooks/useOcr"
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

/**
 * Halaman Asisten OCR -- gated admin.
 *
 * Backend status: adapter masih stub (return dummy data). Real OCR
 * engine (Tesseract/Vision/Claude Vision) akan integrasi via adapter
 * yg sama tanpa ubah UI.
 *
 * Flow:
 *  1. User paste URL gambar/PDF (Drive/Dropbox/file public)
 *  2. POST /ocr/extract -> backend extract data, simpan AIExtraction
 *  3. List drafts -> review (approve/reject) atau "Pakai utk buat Invoice"
 *     (navigate ke /invoices dgn data prefill -- prefill belum
 *     diimplementasi karena form belum support route param)
 */
export function OcrPage() {
  const role = useAuthStore((s) => s.user?.role)
  const isAdmin = role === "SUPERADMIN" || role === "CENTRAL_ADMIN"

  const draftsQ = useOcrDrafts()
  const extract = useOcrExtract()
  const review = useOcrReview()

  const [fileUrl, setFileUrl] = useState("")
  const [entity, setEntity] = useState<"invoice" | "receipt" | "po">("invoice")
  const [expandedId, setExpandedId] = useState<number | null>(null)

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

  const handleExtract = async () => {
    const url = fileUrl.trim()
    if (!url) return
    try {
      const result = await extract.mutateAsync({ file_url: url, entity })
      const conf = Math.round((result.confidence_score ?? 0) * 100)
      toast.success("Berhasil ekstrak data", {
        description: `Confidence ${conf}%. Periksa hasilnya di daftar di bawah.`,
      })
      setFileUrl("")
      setExpandedId(result.id)
    } catch (err) {
      toast.error("Gagal ekstrak", { description: apiErrorMessage(err) })
    }
  }

  const handleReview = async (id: number, approved: boolean) => {
    try {
      await review.mutateAsync({ id, approved })
      toast.success(approved ? "Draft disetujui" : "Draft ditolak", {
        description: "Status draft diperbarui di audit log.",
      })
    } catch (err) {
      toast.error("Gagal review", { description: apiErrorMessage(err) })
    }
  }

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-5 lg:p-6 max-w-4xl">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded bg-brand-50 text-brand-600 shrink-0">
          <ScanLine className="h-4 w-4" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-ink-900 sm:text-2xl">Asisten OCR</h1>
          <p className="text-[13px] text-ink-500 mt-0.5">
            Scan kuitansi / invoice / struk untuk auto-extract data --
            tinggal review & buat dokumen.
          </p>
        </div>
      </div>

      {/* Banner: stub status */}
      <div className="rounded-md border border-info-200 bg-info-50 p-3 sm:p-4 flex items-start gap-2">
        <Sparkles className="h-4 w-4 text-info-600 mt-0.5 shrink-0" />
        <div className="text-[12px] text-info-800 leading-relaxed">
          <strong>Beta:</strong> backend OCR adapter masih versi <em>stub</em> --
          mengembalikan data demo (deterministik) untuk validasi alur. Real
          OCR engine (Tesseract / Document AI / Claude Vision) akan integrasi
          tanpa perlu ubah UI ini.
        </div>
      </div>

      {/* Submit form */}
      <div className="rounded-md border bg-surface p-4 sm:p-5 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">Ekstrak Dokumen Baru</h2>
          <p className="text-[12px] text-ink-500 mt-0.5">
            Tempel URL gambar/PDF yang dapat diakses (Google Drive public,
            Dropbox, S3, dll). Backend akan download & extract.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_180px_auto]">
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
          <div className="flex flex-col gap-1">
            <Label className="text-[11px] uppercase tracking-wider">Jenis</Label>
            <Select
              value={entity}
              onChange={(e) => setEntity(e.target.value as typeof entity)}
            >
              <option value="invoice">Invoice</option>
              <option value="receipt">Kuitansi/Struk</option>
              <option value="po">Purchase Order</option>
            </Select>
          </div>
          <div className="flex items-end">
            <Button
              onClick={handleExtract}
              disabled={extract.isPending || !fileUrl.trim()}
              className="w-full"
            >
              {extract.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              <ScanLine className="h-4 w-4" />
              Extract
            </Button>
          </div>
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
                onApprove={() => handleReview(d.id, true)}
                onReject={() => handleReview(d.id, false)}
                isReviewing={review.isPending}
              />
            ))}
          </ul>
        ) : (
          <div className="rounded-md border border-dashed bg-surface-muted p-8 text-center">
            <ScanLine className="mx-auto h-7 w-7 text-ink-400 mb-2" />
            <p className="text-[13px] text-ink-500">
              Belum ada hasil ekstraksi. Mulai dengan paste URL di atas.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function DraftCard({
  draft,
  isExpanded,
  onToggle,
  onApprove,
  onReject,
  isReviewing,
}: {
  draft: OcrDraft
  isExpanded: boolean
  onToggle: () => void
  onApprove: () => void
  onReject: () => void
  isReviewing: boolean
}) {
  const conf = draft.confidence_score ?? 0
  const confTone =
    conf >= 0.85 ? "success" : conf >= 0.6 ? "warning" : "danger"
  const isReviewed = draft.status === "REVIEWED"
  const data = draft.extracted_data ?? {}

  // Field umum yg biasa muncul di invoice extraction
  const summary = {
    nomor: (data["invoice_number"] as string) ?? null,
    tanggal: (data["invoice_date"] as string) ?? null,
    vendor: (data["vendor_name"] as string) ?? null,
    total: (data["total"] as string | number) ?? null,
  }

  return (
    <li
      className={cn(
        "rounded-md border bg-surface",
        isReviewed && "border-success-200",
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
            {isReviewed && <Badge tone="success">Reviewed</Badge>}
            <Badge tone={confTone}>{fmtPct(conf)} confidence</Badge>
          </div>
          {summary.vendor && (
            <div className="text-sm font-medium truncate">{summary.vendor}</div>
          )}
          <div className="text-[11px] text-ink-500 truncate font-mono">
            {summary.nomor ?? "—"} · {summary.tanggal ?? "—"}
            {summary.total != null && (
              <>
                {" "}
                · Rp {Number(summary.total).toLocaleString("id-ID")}
              </>
            )}
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
              Source URL
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

          {/* Raw extracted data */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-ink-500 mb-1">
              Hasil Ekstraksi
            </div>
            <pre className="overflow-x-auto rounded border bg-surface p-2 text-[11px] font-mono text-ink-800 whitespace-pre-wrap break-all max-h-60 overflow-y-auto">
              {JSON.stringify(data, null, 2)}
            </pre>
          </div>

          {/* Actions */}
          {!isReviewed && (
            <div className="flex flex-wrap gap-2 justify-end">
              <Button
                size="sm"
                variant="outline"
                onClick={onReject}
                disabled={isReviewing}
                className="border-danger-300 text-danger-700 hover:bg-danger-50"
              >
                <XCircle className="h-3.5 w-3.5" />
                Tolak
              </Button>
              <Button size="sm" onClick={onApprove} disabled={isReviewing}>
                {isReviewing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <CheckCircle2 className="h-3.5 w-3.5" />
                Setujui & Tandai Direview
              </Button>
            </div>
          )}
          {isReviewed && (
            <p className="text-[11px] text-ink-500 italic text-right">
              Draft sudah direview. Gunakan datanya utk buat invoice/PO secara
              manual.
            </p>
          )}
        </div>
      )}
    </li>
  )
}
