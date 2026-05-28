import { useRef, useState } from "react"
import { Camera, Loader2, ScanLine } from "lucide-react"

import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/sonner"
import { useOcrExtractUpload } from "@/hooks/useOcr"
import { apiErrorMessage } from "@/lib/api"

export interface ExtractedFields {
  invoice_number?: string | null
  invoice_date?: string | null
  vendor_name?: string | null
  due_date?: string | null
  subtotal?: string | number | null
  tax?: string | number | null
  total?: string | number | null
  currency?: string
  items?: Array<{
    description: string
    qty?: number | null
    unit?: string | null
    price?: number | null
    amount?: number | null
  }>
  confidence_score?: number
  field_confidences?: Record<string, number>
  vendor_match?: { id: number; name: string; score: number } | null
  notes?: string | null
}

interface ScanButtonProps {
  /** Dipanggil setelah scan sukses. Caller bertanggung jawab map ke
   *  form values (mis. setValue / reset). */
  onResult: (data: ExtractedFields) => void
  /** Override label tombol. Default "Scan dari foto". */
  label?: string
  /** Tampilkan icon kamera (mobile) atau scan-line (desktop). */
  iconStyle?: "camera" | "scan"
  size?: "sm" | "md"
  /** Disable tombol -- mis. ketika form sedang submit. */
  disabled?: boolean
}

/**
 * Tombol 1-click capture: pilih file (atau ambil foto via camera HP),
 * upload ke OCR endpoint, panggil onResult dgn extracted data.
 *
 * Audit 2026-05-23 UX integration A. Reusable di InvoiceForm + POForm +
 * CashRequestForm. Tdk render highlight confidence -- caller yg
 * tentukan render-nya berdasar field_confidences.
 */
export function ScanButton({
  onResult,
  label = "Scan dari foto",
  iconStyle = "scan",
  size = "md",
  disabled,
}: ScanButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState(0)
  const upload = useOcrExtractUpload()

  const handleFile = async (file: File) => {
    setProgress(0)
    try {
      const data = await upload.mutateAsync({
        file,
        onProgress: setProgress,
      })
      // OCR endpoint return { extracted_data, confidence_score, ... }
      const extracted = (data.extracted_data ?? {}) as Record<string, unknown>
      const merged: ExtractedFields = {
        ...(extracted as ExtractedFields),
        confidence_score: data.confidence_score,
      }
      onResult(merged)
      const conf = Math.round((data.confidence_score ?? 0) * 100)
      toast.success(`Scan selesai (${conf}% confidence)`, {
        description: data.needs_review
          ? "Periksa field yang ditandai sebelum simpan."
          : undefined,
      })
    } catch (err) {
      toast.error("Scan gagal", { description: apiErrorMessage(err) })
    } finally {
      setProgress(0)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  const busy = upload.isPending
  const Icon = iconStyle === "camera" ? Camera : ScanLine

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) handleFile(f)
        }}
        disabled={disabled || busy}
      />
      <Button
        type="button"
        variant="outline"
        size={size}
        onClick={() => inputRef.current?.click()}
        disabled={disabled || busy}
        className="gap-2"
      >
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {progress > 0 && progress < 100
              ? `Upload ${progress}%`
              : "Memproses..."}
          </>
        ) : (
          <>
            <Icon className="h-4 w-4" />
            {label}
          </>
        )}
      </Button>
    </>
  )
}


/**
 * Helper utk styling field dgn confidence indicator.
 * Pakai di Field wrapper atau langsung di Input className.
 *
 * Threshold: >=0.85 green (yakin), 0.5-0.85 yellow (verify), <0.5 red (ragu).
 * Confidence undefined/0 = no styling.
 */
export function confidenceClass(score: number | undefined): string {
  if (score == null || score === 0) return ""
  if (score >= 0.85) return "border-success-500 ring-1 ring-success-200"
  if (score >= 0.5) return "border-warning-500 ring-1 ring-warning-200"
  return "border-danger-500 ring-1 ring-danger-200"
}
