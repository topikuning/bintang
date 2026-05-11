import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Coins,
  Loader2,
  Plus,
  Trash2,
  Users,
  Wallet,
} from "lucide-react"
import { z } from "zod"
import { useFieldArray, useForm, Controller } from "react-hook-form"
import {
  useCashAdvanceBalances,
  useCashAdvanceOutstanding,
  useCashAdvanceSettlement,
  useDeleteCashAdvanceSettlement,
  useSettleCashAdvance,
  type SettlementInput,
} from "@/hooks/useCashAdvances"
import { apiErrorMessage } from "@/lib/api"
import { ErrorState } from "@/components/data/ErrorState"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/sonner"
import { AmountInput } from "@/components/forms/AmountInput"
import { CategoryPicker } from "@/components/forms/CategoryPicker"
import { DateInput } from "@/components/forms/DateInput"
import { fmtIDR, toApiDate } from "@/lib/format"
import type { CashAdvanceOutstandingRow } from "@/types/api"

function Page({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-4 p-3 sm:p-5 lg:p-6">{children}</div>
}

/**
 * Hub Uang Muka Karyawan (Cash Advance).
 *
 * 2 view:
 *  - "Outstanding": list per-tx advance yg belum di-settle (action: settle)
 *  - "Saldo per Penerima": agregat per karyawan/staff (utk monitoring)
 */
export function CashAdvancePage() {
  const [tab, setTab] = useState<"outstanding" | "balances">("outstanding")
  const [settleTarget, setSettleTarget] = useState<CashAdvanceOutstandingRow | null>(
    null,
  )

  const outstandingQ = useCashAdvanceOutstanding()
  const balancesQ = useCashAdvanceBalances()

  return (
    <Page>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink-900 sm:text-2xl flex items-center gap-2">
            <Wallet className="h-5 w-5 text-brand-600" />
            Uang Muka Karyawan
          </h1>
          <p className="text-[12px] text-ink-500 mt-0.5">
            Kelola uang muka (kasbon) -- bukan beban, masih piutang. Settle dgn
            pertanggungjawaban (struk/kwitansi) supaya jadi beban resmi.
          </p>
        </div>
      </div>

      {/* Tab */}
      <div className="flex rounded border border-border-strong bg-surface text-[13px] overflow-hidden w-fit">
        <button
          type="button"
          onClick={() => setTab("outstanding")}
          className={
            "px-4 h-9 " +
            (tab === "outstanding"
              ? "bg-brand-50 text-brand-700 font-semibold"
              : "hover:bg-ink-50")
          }
        >
          Belum di-settle ({outstandingQ.data?.length ?? 0})
        </button>
        <button
          type="button"
          onClick={() => setTab("balances")}
          className={
            "px-4 h-9 " +
            (tab === "balances"
              ? "bg-brand-50 text-brand-700 font-semibold"
              : "hover:bg-ink-50")
          }
        >
          Saldo per Penerima ({balancesQ.data?.length ?? 0})
        </button>
      </div>

      {tab === "outstanding" ? (
        <OutstandingList
          q={outstandingQ}
          onSettle={(row) => setSettleTarget(row)}
        />
      ) : (
        <BalancesList q={balancesQ} />
      )}

      {settleTarget && (
        <SettlementDialog
          target={settleTarget}
          onClose={() => setSettleTarget(null)}
        />
      )}
    </Page>
  )
}

// ============================================================
// Outstanding list
// ============================================================
function OutstandingList({
  q,
  onSettle,
}: {
  q: ReturnType<typeof useCashAdvanceOutstanding>
  onSettle: (row: CashAdvanceOutstandingRow) => void
}) {
  if (q.isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    )
  }
  if (q.error) {
    return <ErrorState description={apiErrorMessage(q.error)} onRetry={() => q.refetch()} />
  }
  const rows = q.data ?? []
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed bg-surface-muted/40 p-6 text-center">
        <CheckCircle2 className="mx-auto h-8 w-8 text-success-600" />
        <p className="mt-2 text-sm font-medium">Semua uang muka sudah di-settle</p>
        <p className="text-[12px] text-ink-500 mt-1">
          Buat uang muka baru: Transaksi → Pengeluaran → "Uang Muka Personal".
        </p>
      </div>
    )
  }
  return (
    <ul className="divide-y rounded-md border bg-surface">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center gap-3 px-3 py-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded bg-brand-50 text-brand-600 shrink-0">
            <Coins className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm truncate">
                {r.recipient_display || "(tanpa nama)"}
              </span>
              {r.age_days >= 14 && (
                <Badge tone="warning">
                  <AlertTriangle className="h-3 w-3" />
                  {r.age_days} hari
                </Badge>
              )}
            </div>
            <div className="text-[12px] text-ink-500 flex items-center gap-2 flex-wrap">
              <span>{r.tx_date}</span>
              <span>·</span>
              <Link
                to={`/transactions/${r.id}`}
                className="text-brand-600 hover:underline"
              >
                Tx #{r.id}
              </Link>
              {r.description && (
                <>
                  <span>·</span>
                  <span className="truncate">{r.description}</span>
                </>
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="font-semibold tabular-nums text-sm">
              {fmtIDR(Number(r.amount))}
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onSettle(r)}
              className="mt-1"
            >
              Settle <ArrowRight className="h-3 w-3" />
            </Button>
          </div>
        </li>
      ))}
    </ul>
  )
}

// ============================================================
// Balances list (per recipient)
// ============================================================
function BalancesList({
  q,
}: {
  q: ReturnType<typeof useCashAdvanceBalances>
}) {
  if (q.isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    )
  }
  if (q.error) {
    return <ErrorState description={apiErrorMessage(q.error)} onRetry={() => q.refetch()} />
  }
  const rows = q.data ?? []
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed bg-surface-muted/40 p-6 text-center">
        <Users className="mx-auto h-8 w-8 text-ink-400" />
        <p className="mt-2 text-sm">Belum ada riwayat uang muka.</p>
      </div>
    )
  }
  return (
    <ul className="divide-y rounded-md border bg-surface">
      {rows.map((r, i) => {
        const outstanding = Number(r.outstanding)
        const totalAdv = Number(r.advance_total)
        const settled = Number(r.settled_total)
        return (
          <li
            key={`${r.recipient_user_id ?? "x"}-${i}`}
            className="flex items-center gap-3 px-3 py-3"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded bg-ink-100 text-ink-700 shrink-0">
              <Users className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm truncate">{r.recipient_name}</div>
              <div className="text-[11px] text-ink-500 flex gap-2 flex-wrap mt-0.5">
                <span>{r.advance_count} advance</span>
                {r.unsettled_count > 0 && (
                  <>
                    <span>·</span>
                    <span className="text-warning-700">
                      {r.unsettled_count} blm settle
                    </span>
                  </>
                )}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div
                className={
                  "font-semibold tabular-nums text-sm " +
                  (outstanding > 0 ? "text-warning-700" : "text-success-700")
                }
              >
                {fmtIDR(outstanding)}
              </div>
              <div className="text-[11px] text-ink-500 tabular-nums mt-0.5">
                {fmtIDR(settled)} / {fmtIDR(totalAdv)}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

// ============================================================
// Settlement dialog
// ============================================================
const settlementSchema = z.object({
  settled_at: z.string().min(1),
  returned_to_kas: z.number().min(0, "Tidak boleh negatif"),
  notes: z.string().nullable().optional(),
  items: z
    .array(
      z.object({
        category_id: z.number().nullable().optional(),
        description: z.string().min(1, "Deskripsi wajib"),
        amount: z.number().positive("> 0"),
        receipt_url: z.string().nullable().optional(),
      }),
    )
    .min(1, "Minimal 1 item"),
})

type SettlementFormValues = z.infer<typeof settlementSchema>

function SettlementDialog({
  target,
  onClose,
}: {
  target: CashAdvanceOutstandingRow
  onClose: () => void
}) {
  const todayIso = useMemo(() => toApiDate(new Date()) ?? "", [])
  const settleMu = useSettleCashAdvance()
  const delMu = useDeleteCashAdvanceSettlement()
  // Re-check existing settlement (dalam kasus user buka via direct link).
  const existingQ = useCashAdvanceSettlement(target.id)
  const hasExisting = !!existingQ.data

  const advanceAmount = Number(target.amount)

  const defaultValues: SettlementFormValues = {
    settled_at: todayIso,
    returned_to_kas: 0,
    notes: "",
    items: [
      {
        category_id: null,
        description: "",
        amount: advanceAmount,
        receipt_url: null,
      },
    ],
  }

  const {
    control,
    register,
    handleSubmit,
    watch,
    formState: { isSubmitting },
  } = useForm<SettlementFormValues>({ defaultValues })
  const itemsArr = useFieldArray({ control, name: "items" })

  const items = watch("items") || []
  const returned = Number(watch("returned_to_kas") || 0)
  const itemsSum = items.reduce((acc, it) => acc + Number(it?.amount || 0), 0)
  const total = itemsSum + returned
  const diff = total - advanceAmount
  const ok = diff >= 0
  const willCreateTopup = diff > 0

  const onSubmit = async (raw: SettlementFormValues) => {
    const parsed = settlementSchema.safeParse(raw)
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Periksa isian")
      return
    }
    if (!ok) {
      toast.error(
        `sum(rincian) + dikembalikan = ${total.toLocaleString("id-ID")} < advance ${advanceAmount.toLocaleString("id-ID")}. ` +
          `Sisanya hrs masuk 'Dikembalikan ke kas'.`,
      )
      return
    }
    try {
      const payload: SettlementInput = {
        settled_at: parsed.data.settled_at,
        returned_to_kas: parsed.data.returned_to_kas,
        notes: parsed.data.notes?.trim() || null,
        items: parsed.data.items.map((i) => ({
          category_id: i.category_id ?? null,
          description: i.description,
          amount: i.amount,
          receipt_url: i.receipt_url ?? null,
        })),
      }
      const result = await settleMu.mutateAsync({
        txId: target.id,
        payload,
      })
      if (willCreateTopup) {
        toast.success("Pertanggungjawaban tersimpan + top-up tx dibuat", {
          description: `Top-up tx #${result.topup_tx_id} sebesar ${diff.toLocaleString("id-ID")} (selisih kelebihan klaim).`,
        })
      } else {
        toast.success("Pertanggungjawaban tersimpan")
      }
      onClose()
    } catch (err) {
      toast.error("Gagal settle", { description: apiErrorMessage(err) })
    }
  }

  const handleDelete = async () => {
    if (!confirm("Hapus pertanggungjawaban ini? Top-up tx (kalau ada) ikut hilang."))
      return
    try {
      await delMu.mutateAsync(target.id)
      toast.success("Pertanggungjawaban dihapus")
      onClose()
    } catch (err) {
      toast.error("Gagal hapus", { description: apiErrorMessage(err) })
    }
  }

  if (existingQ.isLoading) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent>
          <Skeleton className="h-24" />
        </DialogContent>
      </Dialog>
    )
  }

  if (hasExisting) {
    // Tampilkan sebagai read-only summary (sudah settled).
    const s = existingQ.data!
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Pertanggungjawaban</DialogTitle>
            <DialogDescription>
              Uang muka #{target.id} ({fmtIDR(advanceAmount)}) sudah di-settle
              {s.settled_by_name && ` oleh ${s.settled_by_name}`}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <ul className="divide-y rounded border bg-surface">
              {s.items.map((it) => (
                <li key={it.id} className="flex justify-between px-3 py-2">
                  <span>{it.description}</span>
                  <span className="tabular-nums">{fmtIDR(Number(it.amount))}</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-between text-[12px] pt-1">
              <span>Dikembalikan ke kas:</span>
              <span className="tabular-nums">{fmtIDR(Number(s.returned_to_kas))}</span>
            </div>
            {s.topup_tx_id && (
              <div className="flex justify-between text-[12px] text-warning-700">
                <span>
                  Top-up tx (kelebihan klaim){" "}
                  <Link
                    to={`/transactions/${s.topup_tx_id}`}
                    className="text-brand-600 hover:underline"
                  >
                    #{s.topup_tx_id}
                  </Link>
                  :
                </span>
                <span className="tabular-nums">{fmtIDR(Number(s.topup_amount ?? 0))}</span>
              </div>
            )}
            {s.notes && (
              <div className="text-[12px] text-ink-500 italic">{s.notes}</div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="danger"
              onClick={handleDelete}
              disabled={delMu.isPending}
            >
              {delMu.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              <Trash2 className="h-4 w-4" />
              Hapus Settlement
            </Button>
            <Button variant="secondary" onClick={onClose}>
              Tutup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Pertanggungjawaban Uang Muka -- {target.recipient_display}
          </DialogTitle>
          <DialogDescription>
            Advance #{target.id}: <strong>{fmtIDR(advanceAmount)}</strong>. Rincikan
            penggunaan + sisanya kembalikan ke kas. Kelebihan klaim otomatis bikin
            transaksi top-up.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-3"
          id="settlement-form"
        >
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <Label className="text-[11px] uppercase tracking-wider">
                Tanggal settle
              </Label>
              <Controller
                control={control}
                name="settled_at"
                render={({ field }) => (
                  <DateInput value={field.value} onChange={(v) => field.onChange(v ?? "")} />
                )}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[11px] uppercase tracking-wider">
                Dikembalikan ke kas
              </Label>
              <Controller
                control={control}
                name="returned_to_kas"
                render={({ field }) => (
                  <AmountInput
                    value={field.value || null}
                    onChange={(v) => field.onChange(v ?? 0)}
                    placeholder="0"
                  />
                )}
              />
            </div>
          </div>

          <div>
            <Label className="text-[11px] uppercase tracking-wider">Rincian</Label>
            <div className="rounded border bg-surface-muted/40 p-2 space-y-2 mt-1">
              {itemsArr.fields.map((f, idx) => (
                <div
                  key={f.id}
                  className="grid grid-cols-12 gap-1.5 items-start rounded bg-surface p-2 border"
                >
                  <div className="col-span-12 sm:col-span-5">
                    <Input
                      {...register(`items.${idx}.description`)}
                      placeholder="Deskripsi (mis. Beli ATK)"
                      className="h-9 text-sm"
                    />
                  </div>
                  <div className="col-span-5 sm:col-span-3">
                    <Controller
                      control={control}
                      name={`items.${idx}.category_id`}
                      render={({ field }) => (
                        <CategoryPicker
                          value={field.value ?? null}
                          onChange={field.onChange}
                          type="OUT"
                        />
                      )}
                    />
                  </div>
                  <div className="col-span-6 sm:col-span-3">
                    <Controller
                      control={control}
                      name={`items.${idx}.amount`}
                      render={({ field }) => (
                        <AmountInput
                          value={field.value || null}
                          onChange={(v) => field.onChange(v ?? 0)}
                          placeholder="0"
                        />
                      )}
                    />
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <button
                      type="button"
                      onClick={() => itemsArr.remove(idx)}
                      className="flex h-8 w-8 items-center justify-center rounded text-danger-500 hover:bg-danger-50"
                      aria-label="Hapus item"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  itemsArr.append({
                    category_id: null,
                    description: "",
                    amount: 0,
                    receipt_url: null,
                  })
                }
              >
                <Plus className="h-3.5 w-3.5" />
                Tambah Item
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <Label className="text-[11px] uppercase tracking-wider">
              Catatan (opsional)
            </Label>
            <Textarea
              {...register("notes")}
              rows={2}
              placeholder="Catatan tambahan…"
            />
          </div>

          {/* Live summary */}
          <div className="rounded border bg-surface p-2 text-[12px] space-y-1">
            <div className="flex justify-between">
              <span>Sum rincian:</span>
              <span className="tabular-nums">{fmtIDR(itemsSum)}</span>
            </div>
            <div className="flex justify-between">
              <span>Dikembalikan ke kas:</span>
              <span className="tabular-nums">{fmtIDR(returned)}</span>
            </div>
            <div className="flex justify-between border-t pt-1">
              <span>Total terhitung:</span>
              <span className="tabular-nums">{fmtIDR(total)}</span>
            </div>
            <div className="flex justify-between text-ink-500">
              <span>Advance amount:</span>
              <span className="tabular-nums">{fmtIDR(advanceAmount)}</span>
            </div>
            {diff !== 0 && (
              <div
                className={
                  "flex justify-between font-medium pt-1 border-t " +
                  (ok ? "text-warning-700" : "text-danger-700")
                }
              >
                <span>{ok ? "Top-up (selisih klaim):" : "Kurang (hrs dikembalikan):"}</span>
                <span className="tabular-nums">{fmtIDR(Math.abs(diff))}</span>
              </div>
            )}
            {willCreateTopup && (
              <p className="text-[11px] text-ink-500 italic pt-1">
                Sistem akan auto-create transaksi top-up (DIRECT_EXPENSE) untuk
                selisih ini.
              </p>
            )}
          </div>
        </form>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting || settleMu.isPending}>
            Batal
          </Button>
          <Button
            type="submit"
            form="settlement-form"
            disabled={isSubmitting || settleMu.isPending || !ok}
          >
            {settleMu.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            <ChevronRight className="h-4 w-4" />
            Simpan Settlement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
