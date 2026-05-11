import { useState } from "react"
import { Loader2, Printer } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api } from "@/lib/api"
import { apiErrorMessage } from "@/lib/api"
import { toast } from "@/components/ui/sonner"
import { cn } from "@/lib/utils"

export type PrintSignatures = "both" | "creator" | "approver" | "none"

interface PrintPdfDialogProps {
  open: boolean
  onClose: () => void
  /** Endpoint relative API (mis. `/invoices/123/pdf`, `/purchase-orders/45/pdf`). */
  pdfPath: string
  /** Default nama penanggung jawab (mis. company.director_name). Bisa kosong. */
  defaultResponsibleName?: string | null
  /** Default jabatan, default 'Direktur'. */
  defaultResponsibleTitle?: string
  /** Label dokumen utk title dialog (mis. 'Invoice INV-001'). */
  documentLabel?: string
}

/**
 * Dialog opsi cetak PDF -- user pilih siapa yg TTD (Pembuat /
 * Penanggung Jawab / Keduanya / Tidak ada) + override nama penanggung
 * jawab + jabatan. Backend baca dr query params signatures/
 * responsible_name/responsible_title.
 */
export function PrintPdfDialog({
  open,
  onClose,
  pdfPath,
  defaultResponsibleName,
  defaultResponsibleTitle = "Direktur",
  documentLabel,
}: PrintPdfDialogProps) {
  const [signatures, setSignatures] = useState<PrintSignatures>("both")
  const [responsibleName, setResponsibleName] = useState<string>(
    defaultResponsibleName ?? "",
  )
  const [responsibleTitle, setResponsibleTitle] = useState<string>(
    defaultResponsibleTitle,
  )
  const [printing, setPrinting] = useState(false)

  const handlePrint = async () => {
    setPrinting(true)
    try {
      const params = new URLSearchParams()
      params.set("signatures", signatures)
      if (signatures !== "none" && signatures !== "creator") {
        if (responsibleName.trim()) {
          params.set("responsible_name", responsibleName.trim())
        }
        if (responsibleTitle.trim()) {
          params.set("responsible_title", responsibleTitle.trim())
        }
      }
      const url = `${pdfPath}?${params.toString()}`
      const res = await api.get(url, { responseType: "blob", timeout: 60_000 })
      const blob = new Blob([res.data], { type: "application/pdf" })
      const objUrl = URL.createObjectURL(blob)
      window.open(objUrl, "_blank")
      setTimeout(() => URL.revokeObjectURL(objUrl), 60_000)
      onClose()
    } catch (err) {
      toast.error("Gagal cetak PDF", { description: apiErrorMessage(err) })
    } finally {
      setPrinting(false)
    }
  }

  const showApproverFields = signatures === "both" || signatures === "approver"

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !printing && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Opsi Cetak PDF</DialogTitle>
          <DialogDescription>
            {documentLabel ? `Cetak ${documentLabel}. ` : ""}
            Atur siapa yg TTD di dokumen ini.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* Signatures radio */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-[11px] uppercase tracking-wider">
              Tanda Tangan
            </Label>
            <div className="grid grid-cols-1 gap-1.5">
              <RadioRow
                value="both"
                current={signatures}
                onClick={() => setSignatures("both")}
                label="Pembuat & Penanggung Jawab"
                hint="Default. Tampil 2 kotak TTD di footer."
              />
              <RadioRow
                value="creator"
                current={signatures}
                onClick={() => setSignatures("creator")}
                label="Hanya Pembuat"
                hint="Cukup yg membuat dokumen."
              />
              <RadioRow
                value="approver"
                current={signatures}
                onClick={() => setSignatures("approver")}
                label="Hanya Penanggung Jawab"
                hint="Cukup atasan yg mengetahui/menyetujui."
              />
              <RadioRow
                value="none"
                current={signatures}
                onClick={() => setSignatures("none")}
                label="Tanpa TTD"
                hint="Tidak ada kotak TTD di footer."
              />
            </div>
          </div>

          {/* Penanggung jawab fields */}
          {showApproverFields && (
            <div className="flex flex-col gap-2 rounded border bg-surface-muted/40 p-3">
              <div className="flex flex-col gap-1.5">
                <Label className="text-[11px] uppercase tracking-wider">
                  Nama Penanggung Jawab
                </Label>
                <Input
                  value={responsibleName}
                  onChange={(e) => setResponsibleName(e.target.value)}
                  placeholder={defaultResponsibleName ?? "Mis. H. Budi Santoso"}
                />
                <p className="text-[11px] text-ink-500">
                  Override default. Kalau kosong, pakai{" "}
                  {defaultResponsibleName ? (
                    <span className="font-medium">{defaultResponsibleName}</span>
                  ) : (
                    "default sistem (Direktur perusahaan)"
                  )}
                  .
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-[11px] uppercase tracking-wider">Jabatan</Label>
                <Input
                  value={responsibleTitle}
                  onChange={(e) => setResponsibleTitle(e.target.value)}
                  placeholder="Direktur"
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={printing}>
            Batal
          </Button>
          <Button onClick={handlePrint} disabled={printing}>
            {printing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Printer className="h-4 w-4" />
            )}
            Cetak PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RadioRow({
  value,
  current,
  onClick,
  label,
  hint,
}: {
  value: PrintSignatures
  current: PrintSignatures
  onClick: () => void
  label: string
  hint: string
}) {
  const active = value === current
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-start gap-2 rounded border px-3 py-2 text-left transition-colors",
        active
          ? "border-brand-500 bg-brand-50"
          : "border-border hover:border-brand-300 hover:bg-ink-50",
      )}
    >
      <span
        className={cn(
          "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border-2",
          active ? "border-brand-600" : "border-ink-400",
        )}
      >
        {active && <span className="h-2 w-2 rounded-full bg-brand-600" />}
      </span>
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-[11px] text-ink-500">{hint}</div>
      </div>
    </button>
  )
}
