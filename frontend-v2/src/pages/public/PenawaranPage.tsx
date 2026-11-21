import { useEffect, useMemo, useState } from "react"
import { useParams } from "react-router"
import { useMutation, useQuery } from "@tanstack/react-query"
import { CheckCircle2, Loader2, PackageOpen, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { AmountInput } from "@/components/forms/AmountInput"
import { api, apiErrorMessage } from "@/lib/api"
import { fmtIDR } from "@/lib/format"
import { cn } from "@/lib/utils"

interface Barang {
  no: number
  uraian: string
  jumlah: string
  satuan: string | null
  harga: string
}

interface Penawaran {
  kode: string
  nomor: string
  perusahaan: string
  proyek: string | null
  pemasok: string
  barang: Barang[]
  tempo_hari: number | null
  terbuka: boolean
  keadaan: string
}

const PILIHAN_TEMPO = [0, 7, 14, 30, 45, 60]

function angka(s: string): string {
  return Number(s).toLocaleString("id-ID")
}

/**
 * Halaman isi harga untuk pemasok -- dibuka dari tautan di pesan WhatsApp
 * pesanan, TANPA login. Satu tautan = satu PO; berlaku selama PO masih
 * menunggu jawaban pemasok.
 */
export function PenawaranPage() {
  const { token = "" } = useParams<{ token: string }>()
  const q = useQuery({
    queryKey: ["penawaran", token],
    queryFn: async () => (await api.get<Penawaran>(`/penawaran/${token}`)).data,
    retry: false,
  })

  const [harga, setHarga] = useState<Record<number, number | null>>({})
  const [tempo, setTempo] = useState<number | null>(null)
  const [tempoLain, setTempoLain] = useState(false)
  const [menolak, setMenolak] = useState(false)
  const [alasan, setAlasan] = useState("")

  useEffect(() => {
    if (!q.data) return
    setHarga(
      Object.fromEntries(q.data.barang.map((b) => [b.no, Number(b.harga) > 0 ? Number(b.harga) : null])),
    )
    setTempo(q.data.tempo_hari)
    setTempoLain(q.data.tempo_hari != null && !PILIHAN_TEMPO.includes(q.data.tempo_hari))
  }, [q.data])

  const kirim = useMutation({
    mutationFn: async (body: object) =>
      (await api.post<{ ok: boolean; pesan: string }>(`/penawaran/${token}`, body)).data,
  })

  const total = useMemo(
    () => (q.data?.barang ?? []).reduce((s, b) => s + (harga[b.no] ?? 0) * Number(b.jumlah), 0),
    [q.data, harga],
  )
  const kosong = (q.data?.barang ?? []).filter((b) => !harga[b.no]).map((b) => b.no)
  const siap = kosong.length === 0 && tempo != null

  if (q.isLoading) {
    return (
      <Bingkai>
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-ink-400" />
        </div>
      </Bingkai>
    )
  }
  if (q.isError || !q.data) {
    return (
      <Bingkai>
        <Keterangan
          ikon={<XCircle className="h-10 w-10 text-danger-600" />}
          judul="Tautan tidak berlaku"
          isi="Tautan ini salah atau sudah kedaluwarsa. Silakan balas langsung pesan WhatsApp pesanan dari kami."
        />
      </Bingkai>
    )
  }

  const d = q.data
  if (kirim.isSuccess) {
    return (
      <Bingkai>
        <Keterangan
          ikon={<CheckCircle2 className="h-10 w-10 text-success-600" />}
          judul="Terima kasih"
          isi={kirim.data.pesan}
        />
      </Bingkai>
    )
  }
  if (!d.terbuka) {
    return (
      <Bingkai>
        <Keterangan
          ikon={<CheckCircle2 className="h-10 w-10 text-success-600" />}
          judul={`${d.kode} sudah dijawab`}
          isi={`Status pesanan: ${d.keadaan}. Tidak ada yang perlu diisi lagi.`}
        />
      </Bingkai>
    )
  }

  const kirimPenawaran = () =>
    kirim.mutate({
      aksi: "kirim",
      tempo_hari: tempo,
      harga: Object.fromEntries(
        Object.entries(harga).filter(([, v]) => v != null && v > 0),
      ),
    })

  return (
    <Bingkai>
      <header className="border-b px-4 pb-4 pt-5">
        <div className="text-[12px] font-medium uppercase tracking-wider text-ink-500">
          Pesanan dari {d.perusahaan}
        </div>
        <h1 className="mt-1 text-xl font-bold text-ink-900">Pesanan Barang {d.kode}</h1>
        <div className="mt-1 text-[13px] text-ink-600">
          No. PO {d.nomor}
          {d.proyek ? ` · proyek ${d.proyek}` : ""}
        </div>
        <p className="mt-3 rounded-md bg-brand-50 px-3 py-2 text-[13px] text-brand-700">
          Isi harga satuan setiap barang dan tempo pembayaran, lalu tekan <b>Kirim penawaran</b>.
        </p>
      </header>

      <ol className="divide-y">
        {d.barang.map((b) => {
          const h = harga[b.no] ?? null
          return (
            <li key={b.no} className="px-4 py-3">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-ink-100 text-[12px] font-semibold text-ink-700">
                  {b.no}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-ink-900">{b.uraian}</div>
                  <div className="text-[13px] text-ink-500">
                    {angka(b.jumlah)} {b.satuan ?? ""}
                  </div>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 pl-8">
                <AmountInput
                  aria-label={`Harga satuan barang ${b.no}`}
                  value={h}
                  onChange={(v) => setHarga((s) => ({ ...s, [b.no]: v }))}
                  placeholder="Harga satuan"
                  className={cn(!h && "border-warning-500")}
                />
                <div className="min-w-[7rem] text-right text-[13px] tabular-nums text-ink-700">
                  {h ? fmtIDR(h * Number(b.jumlah)) : "—"}
                </div>
              </div>
            </li>
          )
        })}
      </ol>

      <section className="border-t px-4 py-4">
        <div className="text-sm font-semibold text-ink-900">Tempo pembayaran</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {PILIHAN_TEMPO.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTempo(t)
                setTempoLain(false)
              }}
              className={cn(
                "h-9 rounded-full border px-3.5 text-sm",
                !tempoLain && tempo === t
                  ? "border-brand-600 bg-brand-600 text-white"
                  : "bg-surface text-ink-700",
              )}
            >
              {t === 0 ? "Tunai" : `${t} hari`}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setTempoLain(true)
              setTempo(null)
            }}
            className={cn(
              "h-9 rounded-full border px-3.5 text-sm",
              tempoLain ? "border-brand-600 bg-brand-600 text-white" : "bg-surface text-ink-700",
            )}
          >
            Lainnya
          </button>
        </div>
        {tempoLain && (
          <div className="mt-2 flex items-center gap-2">
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              max={365}
              aria-label="Tempo (hari)"
              className="w-28"
              value={tempo ?? ""}
              onChange={(e) => setTempo(e.target.value === "" ? null : Number(e.target.value))}
            />
            <span className="text-sm text-ink-600">hari setelah barang diterima</span>
          </div>
        )}
      </section>

      {!menolak && (
        <div className="px-4 pb-4">
          <button
            type="button"
            className="w-full py-1 text-[13px] text-ink-500 underline"
            onClick={() => setMenolak(true)}
          >
            Tidak bisa memenuhi pesanan ini
          </button>
        </div>
      )}

      {menolak && (
        <section className="border-t px-4 py-4">
          <div className="text-sm font-semibold text-ink-900">Tidak bisa memenuhi pesanan?</div>
          <Textarea
            className="mt-2"
            rows={2}
            placeholder="Alasan, mis. stok habis"
            value={alasan}
            onChange={(e) => setAlasan(e.target.value)}
          />
          <div className="mt-2 flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setMenolak(false)}>
              Kembali
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              disabled={kirim.isPending}
              onClick={() => kirim.mutate({ aksi: "tolak", alasan })}
            >
              Kirim penolakan
            </Button>
          </div>
        </section>
      )}

      {/* Bagian bawah menempel: total + tombol kirim */}
      <footer className="sticky bottom-0 border-t bg-surface px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-ink-600">Total</span>
          <span className="text-lg font-bold tabular-nums text-ink-900">{fmtIDR(total)}</span>
        </div>
        {kirim.isError && (
          <p className="mt-1 text-[13px] text-danger-600">{apiErrorMessage(kirim.error)}</p>
        )}
        {!siap && !kirim.isError && (
          <p className="mt-1 text-[12px] text-ink-500">
            {kosong.length > 0
              ? `Harga barang nomor ${kosong.join(", ")} belum diisi.`
              : "Pilih tempo pembayaran."}
          </p>
        )}
        <Button
          size="lg"
          className="mt-2 w-full"
          disabled={!siap || kirim.isPending}
          onClick={kirimPenawaran}
        >
          {kirim.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Kirim penawaran
        </Button>
      </footer>
    </Bingkai>
  )
}

function Bingkai({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-surface-muted sm:py-6">
      <main className="mx-auto min-h-dvh max-w-lg bg-surface sm:min-h-0 sm:rounded-lg sm:border sm:shadow-sm">
        {children}
      </main>
    </div>
  )
}

function Keterangan({ ikon, judul, isi }: { ikon: React.ReactNode; judul: string; isi: string }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      {ikon ?? <PackageOpen className="h-10 w-10 text-ink-400" />}
      <h1 className="mt-3 text-lg font-semibold text-ink-900">{judul}</h1>
      <p className="mt-1 text-sm text-ink-600">{isi}</p>
    </div>
  )
}
