import { useRef, useState } from "react"
import { Loader2, MessageCircle, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/sonner"
import { useBayarPO } from "@/hooks/usePOMutations"
import { apiErrorMessage } from "@/lib/api"
import { fmtDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useAuthStore } from "@/store/auth"
import type { POWaTahap, PurchaseOrder } from "@/types/api"

const TAHAP: Record<POWaTahap, { label: string; tone: string; langkah: string }> = {
  MENUNGGU_PEMASOK: {
    label: "Menunggu jawaban pemasok",
    tone: "bg-warning-50 text-warning-700 border-warning-100",
    langkah: "Pemasok membalas SETUJU / UBAH / TOLAK di WhatsApp.",
  },
  MENUNGGU_PENGAJU: {
    label: "Penawaran masuk - menunggu diajukan",
    tone: "bg-info-50 text-info-700 border-info-100",
    langkah: "Pengaju membalas AJUKAN {kode} di WhatsApp.",
  },
  MENUNGGU_PERSETUJUAN: {
    label: "Menunggu persetujuan",
    tone: "bg-warning-50 text-warning-700 border-warning-100",
    langkah: "Keuangan/pimpinan: SETUJUI {kode} di WhatsApp, atau tombol Setujui di aplikasi.",
  },
  FINAL: {
    label: "Disetujui - menunggu barang",
    tone: "bg-info-50 text-info-700 border-info-100",
    langkah: "Saat barang datang: kirim foto surat jalan dengan keterangan TERIMA {kode}.",
  },
  DITERIMA: {
    label: "Barang diterima - menunggu pembayaran",
    tone: "bg-warning-50 text-warning-700 border-warning-100",
    langkah: "Keuangan: kirim foto bukti transfer dengan keterangan BAYAR {kode}, atau unggah di bawah.",
  },
  LUNAS: {
    label: "Lunas - bukti terkirim ke pemasok",
    tone: "bg-success-50 text-success-700 border-success-100",
    langkah: "",
  },
  DITOLAK_PEMASOK: {
    label: "Ditolak pemasok",
    tone: "bg-danger-50 text-danger-700 border-danger-100",
    langkah: "",
  },
  DIBATALKAN: {
    label: "Dibatalkan",
    tone: "bg-danger-50 text-danger-700 border-danger-100",
    langkah: "",
  },
}

const RE_KASBON =
  /\b(kasbon|kas\s*bon|upah|gaji|honor|ongkos\s*(kerja|tukang)|borongan|uang\s*muka|panjar|bon\s*pekerja|dp)\b/i

function nomorTampil(chatId: string | null | undefined): string {
  if (!chatId) return "-"
  const digits = chatId.split("@")[0] ?? chatId
  return digits.startsWith("62") ? `0${digits.slice(2)}` : digits
}

function tambahHari(iso: string, hari: number): string {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + hari)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Panel alur PO lewat WhatsApp di detail PO. Tidak tampil untuk PO biasa. */
export function POAlurWA({ po }: { po: PurchaseOrder }) {
  const role = useAuthStore((s) => s.user?.role)
  const isAdmin = role === "SUPERADMIN" || role === "CENTRAL_ADMIN"
  const bayar = useBayarPO()
  const input = useRef<HTMLInputElement>(null)
  const [berkas, setBerkas] = useState<File | null>(null)

  if (!po.wa_tahap) return null
  // Kasbon/upah ditagih saat PO disetujui dan bisa dibayar sebelum barang datang
  // (aturan sama dengan backend wa_po_flow.adalah_kasbon).
  const adaKasbon = (po.items ?? []).some((it) => RE_KASBON.test(it.description ?? ""))
  const bisaBayar = po.wa_tahap === "DITERIMA" || (po.wa_tahap === "FINAL" && adaKasbon)
  const kode = `PO${po.id}`
  const t = TAHAP[po.wa_tahap]
  const jatuhTempo =
    po.diterima_at && po.tempo_days != null ? tambahHari(po.diterima_at, po.tempo_days) : null

  const kirim = () => {
    if (!berkas) return
    bayar.mutate(
      { id: po.id, bukti: berkas },
      {
        onSuccess: () => {
          toast.success(`${kode} dibayar. Bukti dikirim ke WhatsApp pemasok.`)
          setBerkas(null)
          if (input.current) input.current.value = ""
        },
        onError: (e) => toast.error(apiErrorMessage(e)),
      },
    )
  }

  return (
    <div className="border-b p-5">
      <div className="mb-2 flex items-center gap-1.5 text-[12px] uppercase tracking-wider text-ink-500">
        <MessageCircle className="h-3.5 w-3.5" />
        <span>Alur WhatsApp · kode {kode}</span>
      </div>
      <div className={cn("rounded-md border px-3 py-2 text-sm font-medium", t.tone)}>{t.label}</div>
      {t.langkah && (
        <p className="mt-2 text-[12px] text-ink-600">{t.langkah.replace("{kode}", kode)}</p>
      )}
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <dt className="text-[11px] text-ink-500">WA pemasok</dt>
          <dd className="font-mono">{nomorTampil(po.supplier_wa)}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-ink-500">Tempo</dt>
          <dd>
            {po.tempo_days == null ? "-" : po.tempo_days === 0 ? "Tunai" : `${po.tempo_days} hari`}
          </dd>
        </div>
        {po.diterima_at && (
          <div>
            <dt className="text-[11px] text-ink-500">Barang diterima</dt>
            <dd>{fmtDate(po.diterima_at, { fullMonth: true })}</dd>
          </div>
        )}
        {jatuhTempo && (
          <div>
            <dt className="text-[11px] text-ink-500">Jatuh tempo</dt>
            <dd className="font-semibold">{fmtDate(jatuhTempo, { fullMonth: true })}</dd>
          </div>
        )}
      </dl>

      {bisaBayar && isAdmin && (
        <div className="mt-4 rounded-md border bg-surface-muted p-3">
          <div className="text-sm font-medium text-ink-900">
            {po.wa_tahap === "FINAL" ? "Bayar kasbon & kirim bukti" : "Bayar & kirim bukti ke pemasok"}
          </div>
          <p className="mt-0.5 text-[12px] text-ink-500">
            Dicatat sebagai kas keluar (terverifikasi) sebesar sisa tagihan. Bukti transfer dikirim
            ke WhatsApp pemasok.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              ref={input}
              type="file"
              accept="image/*,application/pdf"
              className="max-w-full text-sm"
              onChange={(e) => setBerkas(e.target.files?.[0] ?? null)}
            />
            <Button size="sm" disabled={!berkas || bayar.isPending} onClick={kirim}>
              {bayar.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Bayar & kirim bukti
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
