import { useState } from "react"
import { Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { downloadFile } from "@/lib/download"
import { apiErrorMessage } from "@/lib/api"
import { useUIPrefs } from "@/store/ui-prefs"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { DateInput } from "@/components/forms/DateInput"
import { ProjectPicker } from "@/components/forms/ProjectPicker"
import { toast } from "@/components/ui/sonner"
import { cn } from "@/lib/utils"

interface ReportSectionProps {
  /** Slug akhir endpoint, mis. "cashflow", "transactions", "invoices", dst. */
  slug: string
  /** Title yang tampil + dipakai utk filename. */
  title: string
  description: string
  icon?: LucideIcon
  /** Field filter tambahan (di samping date range + project). */
  extraFilters?: ExtraFilter[]
  /** Default filter, jika ada. */
  initialValues?: Record<string, string | number | undefined>
  /** Sembunyikan project picker. */
  hideProjectFilter?: boolean
  /** Sembunyikan date range. */
  hideDateRange?: boolean
}

export interface ExtraFilter {
  /** Key param utk dikirim ke backend. */
  name: string
  label: string
  /** Type: select atau text. */
  type: "select" | "text"
  /** Options utk select. */
  options?: Array<{ value: string; label: string }>
  placeholder?: string
}

/**
 * Generic section utk satu jenis laporan: judul + deskripsi + form filter
 * (date range + project + extra filters) + tombol Download PDF & Excel.
 *
 * Endpoint backend `/reports/{slug}?format=pdf|xlsx&...filter` return
 * file langsung. Frontend hanya trigger download via blob (auth-aware).
 */
export function ReportSection({
  slug,
  title,
  description,
  icon: Icon = FileText,
  extraFilters = [],
  initialValues = {},
  hideProjectFilter,
  hideDateRange,
}: ReportSectionProps) {
  const { defaultProjectId } = useUIPrefs()

  const [dateFrom, setDateFrom] = useState<string | null>(null)
  const [dateTo, setDateTo] = useState<string | null>(null)
  const [projectId, setProjectId] = useState<number | null>(defaultProjectId)
  const [extraValues, setExtraValues] = useState<Record<string, string | undefined>>(
    Object.fromEntries(
      extraFilters.map((f) => [f.name, (initialValues[f.name] as string | undefined) ?? ""]),
    ),
  )

  const [downloading, setDownloading] = useState<"pdf" | "xlsx" | null>(null)

  const handleDownload = async (format: "pdf" | "xlsx") => {
    setDownloading(format)
    try {
      const params: Record<string, string | number | undefined> = {
        format,
      }
      if (!hideDateRange) {
        if (dateFrom) params.date_from = dateFrom
        if (dateTo) params.date_to = dateTo
      }
      if (!hideProjectFilter && projectId) params.project_id = projectId
      Object.entries(extraValues).forEach(([k, v]) => {
        if (v) params[k] = v
      })
      const ts = new Date()
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d+Z?$/, "")
      const filename = `${title.toLowerCase().replace(/\s+/g, "-")}-${ts}.${format}`
      await downloadFile(`/reports/${slug}`, params, filename)
      toast.success(`Laporan ${format.toUpperCase()} berhasil diunduh`)
    } catch (err) {
      toast.error(`Gagal unduh ${format.toUpperCase()}`, {
        description: apiErrorMessage(err),
      })
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div className="rounded-md border bg-surface p-4 sm:p-5 space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded bg-brand-50 text-brand-600 shrink-0">
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-ink-900">{title}</h3>
          <p className="text-[12px] text-ink-500 leading-relaxed mt-0.5">{description}</p>
        </div>
      </div>

      {/* Filter row */}
      <div
        className={cn(
          "grid gap-2 pt-1",
          // Adaptive grid based on number of fields
          "grid-cols-1 sm:grid-cols-2",
          extraFilters.length > 0 && "lg:grid-cols-3 xl:grid-cols-4",
        )}
      >
        {!hideDateRange && (
          <>
            <div className="flex flex-col gap-1">
              <Label className="text-[11px] uppercase tracking-wider">Dari Tanggal</Label>
              <DateInput value={dateFrom} onChange={setDateFrom} />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[11px] uppercase tracking-wider">Sampai Tanggal</Label>
              <DateInput value={dateTo} onChange={setDateTo} />
            </div>
          </>
        )}
        {!hideProjectFilter && (
          <div className="flex flex-col gap-1">
            <Label className="text-[11px] uppercase tracking-wider">Proyek</Label>
            <ProjectPicker
              value={projectId}
              onChange={setProjectId}
              placeholder="Semua proyek"
            />
          </div>
        )}
        {extraFilters.map((f) => (
          <div key={f.name} className="flex flex-col gap-1">
            <Label className="text-[11px] uppercase tracking-wider">{f.label}</Label>
            {f.type === "select" ? (
              <Select
                value={extraValues[f.name] ?? ""}
                onChange={(e) =>
                  setExtraValues((prev) => ({ ...prev, [f.name]: e.target.value || undefined }))
                }
              >
                <option value="">Semua</option>
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            ) : (
              <input
                type="text"
                value={extraValues[f.name] ?? ""}
                placeholder={f.placeholder}
                onChange={(e) =>
                  setExtraValues((prev) => ({ ...prev, [f.name]: e.target.value || undefined }))
                }
                className="h-10 w-full rounded border border-border-strong bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            )}
          </div>
        ))}
      </div>

      {/* Action row */}
      <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={downloading !== null}
          onClick={() => handleDownload("xlsx")}
        >
          {downloading === "xlsx" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FileSpreadsheet className="h-3.5 w-3.5" />
          )}
          Excel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={downloading !== null}
          onClick={() => handleDownload("pdf")}
        >
          {downloading === "pdf" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          PDF
        </Button>
      </div>
    </div>
  )
}
