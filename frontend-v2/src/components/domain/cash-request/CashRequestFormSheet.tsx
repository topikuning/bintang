import { useEffect, useState } from "react"
import { Loader2, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { DraggableSheet } from "@/components/ui/draggable-sheet"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/sonner"
import { ProjectPicker } from "@/components/forms/ProjectPicker"
import {
  useCreateCashRequest,
  useUpdateCashRequest,
} from "@/hooks/useCashRequests"
import { useUsersLookup } from "@/hooks/useUsers"
import { useCategories } from "@/hooks/useCategories"
import { apiErrorMessage } from "@/lib/api"
import { useBreakpoint } from "@/lib/breakpoint"
import { fmtIDR } from "@/lib/format"
import type {
  CashRequest,
  CashRequestCreateInput,
  CashRequestItemInput,
  CashRequestUpdateInput,
} from "@/types/api"

interface Props {
  open: boolean
  onClose: () => void
  target: CashRequest | null
}

interface FormItem {
  category_id: number | null
  description: string
  quantity: string
  unit_price: string
  amount: string
}

function emptyItem(): FormItem {
  return {
    category_id: null,
    description: "",
    quantity: "",
    unit_price: "",
    amount: "",
  }
}

function toNum(s: string): number {
  if (!s) return 0
  // Buang semua selain digit dan titik. Indonesian users sering pakai
  // "5.000.000" -- diperlakukan sebagai pemisah ribuan, jadi strip dots.
  const cleaned = s.replace(/\./g, "").replace(/,/g, ".")
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

export function CashRequestFormSheet({ open, onClose, target }: Props) {
  const bp = useBreakpoint()
  const isEdit = !!target
  const create = useCreateCashRequest()
  const update = useUpdateCashRequest(target?.id ?? 0)
  const usersQuery = useUsersLookup()
  const catQuery = useCategories()

  const [projectId, setProjectId] = useState<number | null>(null)
  const [recipientUserId, setRecipientUserId] = useState<number | null>(null)
  const [requestDate, setRequestDate] = useState(
    new Date().toISOString().slice(0, 10),
  )
  const [title, setTitle] = useState("")
  const [notes, setNotes] = useState("")
  const [items, setItems] = useState<FormItem[]>([emptyItem()])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    if (target) {
      setProjectId(target.project_id)
      setRecipientUserId(target.recipient_user_id ?? null)
      setRequestDate(target.request_date)
      setTitle(target.title)
      setNotes(target.notes ?? "")
      setItems(
        target.items.length > 0
          ? target.items.map((it) => ({
              category_id: it.category_id,
              description: it.description,
              quantity: it.quantity ?? "",
              unit_price: it.unit_price ?? "",
              amount: String(it.amount),
            }))
          : [emptyItem()],
      )
    } else {
      setProjectId(null)
      setRecipientUserId(null)
      setRequestDate(new Date().toISOString().slice(0, 10))
      setTitle("")
      setNotes("")
      setItems([emptyItem()])
    }
  }, [open, target])

  const totalAmount = items.reduce((sum, it) => sum + toNum(it.amount), 0)

  // Auto-fill amount dari qty * unit_price kalau user isi keduanya.
  const updateItem = (idx: number, patch: Partial<FormItem>) => {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it
        const next = { ...it, ...patch }
        if (
          ("quantity" in patch || "unit_price" in patch) &&
          next.quantity &&
          next.unit_price
        ) {
          const qty = toNum(next.quantity)
          const price = toNum(next.unit_price)
          if (qty > 0 && price > 0) {
            next.amount = String(Math.round(qty * price))
          }
        }
        return next
      }),
    )
  }

  const addItem = () => setItems((p) => [...p, emptyItem()])
  const removeItem = (idx: number) =>
    setItems((p) => (p.length <= 1 ? p : p.filter((_, i) => i !== idx)))

  const handleSubmit = async () => {
    if (!projectId) {
      toast.error("Pilih proyek")
      return
    }
    if (!title.trim()) {
      toast.error("Judul pengajuan wajib diisi")
      return
    }
    const validItems = items
      .filter((it) => it.description.trim() && toNum(it.amount) > 0)
      .map<CashRequestItemInput>((it) => ({
        category_id: it.category_id,
        description: it.description.trim(),
        quantity: it.quantity ? toNum(it.quantity) : null,
        unit_price: it.unit_price ? toNum(it.unit_price) : null,
        amount: toNum(it.amount),
      }))
    if (validItems.length === 0) {
      toast.error("Minimal 1 item dgn deskripsi & jumlah > 0")
      return
    }
    setSubmitting(true)
    try {
      if (isEdit) {
        const payload: CashRequestUpdateInput = {
          project_id: projectId,
          recipient_user_id: recipientUserId,
          request_date: requestDate,
          title: title.trim(),
          notes: notes.trim() || null,
          items: validItems,
        }
        await update.mutateAsync(payload)
        toast.success("Pengajuan diperbarui")
      } else {
        const payload: CashRequestCreateInput = {
          project_id: projectId,
          recipient_user_id: recipientUserId,
          request_date: requestDate,
          title: title.trim(),
          notes: notes.trim() || null,
          items: validItems,
        }
        await create.mutateAsync(payload)
        toast.success("Pengajuan dibuat", {
          description: "Menunggu approval CENTRAL/SUPERADMIN.",
        })
      }
      onClose()
    } catch (err) {
      toast.error(isEdit ? "Gagal update" : "Gagal buat pengajuan", {
        description: apiErrorMessage(err),
      })
    } finally {
      setSubmitting(false)
    }
  }

  const users = usersQuery.data ?? []
  const categories = catQuery.data?.items ?? []

  const body = (
    <div className="flex flex-col gap-3 px-4 py-4 sm:px-5">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tanggal" required>
          <Input
            type="date"
            value={requestDate}
            onChange={(e) => setRequestDate(e.target.value)}
          />
        </Field>
        <Field label="Proyek" required>
          {/* Sengaja TIDAK include NON_PROJECT: pengajuan dana adalah
              workflow operasional proyek, bukan bucket Catatan Non-Proyek
              (yg SUPERADMIN-only & untuk pencatatan langsung tanpa
              workflow). Backend juga reject project_id NON_PROJECT. */}
          <ProjectPicker value={projectId} onChange={setProjectId} />
        </Field>
      </div>
      <Field label="Judul / Maksud Pengajuan" required>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Mis. Belanja material minggu 12 Mei"
          maxLength={200}
        />
      </Field>
      <Field
        label="Penerima Dana"
        hint="Kosongkan kalau penerima = pengaju (Anda sendiri)."
      >
        <Select
          value={recipientUserId ?? ""}
          onChange={(e) =>
            setRecipientUserId(e.target.value ? Number(e.target.value) : null)
          }
        >
          <option value="">— Saya sendiri —</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
      </Field>

      {/* Items */}
      <div className="flex flex-col gap-2 rounded-md border bg-ink-50 p-3">
        <div className="flex items-center justify-between">
          <Label className="text-[12px] uppercase tracking-wider">
            Rincian Belanja
          </Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={addItem}
            className="h-7 text-[12px]"
          >
            <Plus className="h-3 w-3" />
            Tambah baris
          </Button>
        </div>

        {items.map((it, idx) => (
          <div
            key={idx}
            className="flex flex-col gap-2 rounded border bg-surface p-2"
          >
            <div className="flex items-start gap-2">
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-2">
                <Input
                  value={it.description}
                  onChange={(e) =>
                    updateItem(idx, { description: e.target.value })
                  }
                  placeholder="Deskripsi (mis. Semen 50 sak)"
                  maxLength={300}
                />
                <Select
                  value={it.category_id ?? ""}
                  onChange={(e) =>
                    updateItem(idx, {
                      category_id: e.target.value
                        ? Number(e.target.value)
                        : null,
                    })
                  }
                >
                  <option value="">Tanpa kategori</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
              {items.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeItem(idx)}
                  className="flex h-9 w-9 items-center justify-center rounded text-danger-500 hover:bg-danger-50 shrink-0"
                  aria-label="Hapus baris"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Qty" compact>
                <Input
                  value={it.quantity}
                  onChange={(e) =>
                    updateItem(idx, { quantity: e.target.value })
                  }
                  inputMode="decimal"
                  placeholder="(opsional)"
                  className="font-mono text-right"
                />
              </Field>
              <Field label="Harga Satuan" compact>
                <Input
                  value={it.unit_price}
                  onChange={(e) =>
                    updateItem(idx, { unit_price: e.target.value })
                  }
                  inputMode="decimal"
                  placeholder="(opsional)"
                  className="font-mono text-right"
                />
              </Field>
              <Field label="Total" compact>
                <Input
                  value={it.amount}
                  onChange={(e) => updateItem(idx, { amount: e.target.value })}
                  inputMode="decimal"
                  placeholder="0"
                  className="font-mono text-right font-semibold"
                />
              </Field>
            </div>
          </div>
        ))}

        <div className="mt-1 flex items-center justify-between rounded bg-brand-50 px-3 py-2 text-sm">
          <span className="font-medium text-brand-800">Total Pengajuan</span>
          <span className="font-mono text-base font-bold text-brand-900">
            Rp {fmtIDR(totalAmount)}
          </span>
        </div>
      </div>

      <Field label="Catatan" hint="Opsional. Tampil di detail pengajuan.">
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Detail tambahan / justifikasi"
        />
      </Field>
    </div>
  )

  const footer = (
    <div className="flex gap-2 px-4 py-3 sm:px-5 border-t bg-surface pb-safe">
      <Button
        type="button"
        variant="secondary"
        onClick={onClose}
        className="flex-1"
      >
        Batal
      </Button>
      <Button
        type="button"
        onClick={handleSubmit}
        className="flex-1"
        disabled={submitting}
      >
        {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
        {isEdit ? "Simpan" : "Ajukan"}
      </Button>
    </div>
  )

  if (bp === "mobile") {
    return (
      <DraggableSheet
        open={open}
        onOpenChange={(o) => !o && onClose()}
        title={isEdit ? "Edit Pengajuan" : "Pengajuan Dana Baru"}
        footer={footer}
      >
        {body}
      </DraggableSheet>
    )
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl flex flex-col p-0"
      >
        <SheetHeader className="border-b">
          <SheetTitle>
            {isEdit ? "Edit Pengajuan" : "Pengajuan Dana Baru"}
          </SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto">{body}</div>
        {footer}
      </SheetContent>
    </Sheet>
  )
}

function Field({
  label,
  required,
  hint,
  compact,
  children,
}: {
  label: string
  required?: boolean
  hint?: string
  compact?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label className={compact ? "text-[10px] uppercase tracking-wider text-ink-500" : "text-[12px] uppercase tracking-wider"}>
        {label}
        {required && <span className="text-danger-600 ml-0.5">*</span>}
      </Label>
      {children}
      {hint && <p className="text-[11px] text-ink-500">{hint}</p>}
    </div>
  )
}
