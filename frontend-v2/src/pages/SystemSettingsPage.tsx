import { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  MessageCircle,
  Save,
  ScanLine,
  Server,
  ShieldCheck,
  Trash2,
} from "lucide-react"
import { useAuthStore } from "@/store/auth"
import {
  useDeleteSystemSetting,
  useSystemSettings,
  useUpdateSystemSettings,
  type SystemSettingItem,
} from "@/hooks/useSystemSettings"
import { apiErrorMessage } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "@/components/ui/sonner"
import { ErrorState } from "@/components/data/ErrorState"

const GROUP_META: Record<
  string,
  { label: string; icon: typeof KeyRound; description: string }
> = {
  ocr: {
    label: "OCR (Claude / Mistral)",
    icon: ScanLine,
    description:
      "API key OCR engine + default engine. Pilih engine saat upload — setting di sini hanya menentukan default awal di dropdown.",
  },
  telegram: {
    label: "Telegram Bot",
    icon: MessageCircle,
    description:
      "Token bot dari @BotFather + webhook secret. Restart deploy untuk re-register webhook setelah ubah.",
  },
  whatsapp: {
    label: "WhatsApp (WAHA)",
    icon: MessageCircle,
    description:
      "WAHA self-hosted: base URL, session name, API key opsional. Tanpa konfigurasi = integrasi WA off.",
  },
  system: {
    label: "Sistem",
    icon: Server,
    description:
      "URL publik backend (utk webhook Telegram/WAHA). Wajib kalau pakai integrasi chat.",
  },
}

/**
 * Halaman Pengaturan Sistem (SUPERADMIN-only).
 *
 * Manage runtime config (API key OCR, Telegram bot token, WAHA URL, dll)
 * tanpa restart deploy. Secret values di-encrypt at rest di DB.
 * Fallback: kalau DB kosong, pakai env vars (transparent migration).
 */
export function SystemSettingsPage() {
  const role = useAuthStore((s) => s.user?.role)
  const isSuper = role === "SUPERADMIN"

  const q = useSystemSettings()
  const update = useUpdateSystemSettings()
  const del = useDeleteSystemSetting()

  // Form state: { key -> string } untuk semua field. Dipisahkan dari API
  // response supaya user bisa edit sebelum submit.
  const [draft, setDraft] = useState<Record<string, string>>({})
  // Reveal/show secret yg lagi diketik.
  const [reveal, setReveal] = useState<Record<string, boolean>>({})

  // Initialize draft setelah load
  useEffect(() => {
    if (!q.data) return
    const initial: Record<string, string> = {}
    for (const item of q.data.items) {
      // Untuk non-secret: prefill dgn value effective (boleh kosong)
      // Untuk secret: prefill kosong (user ketik baru kalau mau update,
      //   biarkan kosong utk pertahankan nilai existing)
      initial[item.key] = item.is_secret ? "" : item.value ?? ""
    }
    setDraft(initial)
  }, [q.data])

  const groups = useMemo(
    () => Object.entries(q.data?.grouped ?? {}),
    [q.data],
  )

  if (!isSuper) {
    return (
      <div className="p-4 sm:p-6">
        <div className="rounded-md border border-warning-200 bg-warning-50 p-6 text-center">
          <ShieldCheck className="mx-auto h-8 w-8 text-warning-600 mb-2" />
          <h2 className="text-base font-semibold text-warning-800">
            Akses Terbatas
          </h2>
          <p className="mt-1 text-sm text-warning-700">
            Pengaturan Sistem hanya untuk SUPERADMIN.
          </p>
        </div>
      </div>
    )
  }

  if (q.isLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
    )
  }
  if (q.error) {
    return (
      <ErrorState
        description={apiErrorMessage(q.error)}
        onRetry={() => q.refetch()}
      />
    )
  }
  if (!q.data) return null

  /** Submit changes -- hanya item yg dimodifikasi (utk secret: yg di-isi).
   * Empty string utk secret = SKIP (tidak ganti). Empty utk non-secret = SET ke kosong (DELETE). */
  const handleSave = async (groupKey: string) => {
    const groupItems = q.data?.grouped[groupKey] ?? []
    const updates: { key: string; value: string | null }[] = []
    for (const item of groupItems) {
      const v = (draft[item.key] ?? "").trim()
      if (item.is_secret) {
        // Secret: hanya update kalau user ketik value baru
        if (v) updates.push({ key: item.key, value: v })
      } else {
        // Non-secret: compare dgn current effective
        const current = (item.value ?? "").trim()
        if (v !== current) {
          updates.push({ key: item.key, value: v || null })
        }
      }
    }
    if (updates.length === 0) {
      toast.message("Tidak ada perubahan")
      return
    }
    try {
      await update.mutateAsync(updates)
      toast.success(`${updates.length} setting tersimpan`, {
        description: `Group: ${GROUP_META[groupKey]?.label ?? groupKey}`,
      })
      // Clear secret draft setelah save
      setDraft((prev) => {
        const next = { ...prev }
        for (const u of updates) {
          const it = groupItems.find((i) => i.key === u.key)
          if (it?.is_secret) next[u.key] = ""
        }
        return next
      })
    } catch (err) {
      toast.error("Gagal simpan", { description: apiErrorMessage(err) })
    }
  }

  const handleDelete = async (item: SystemSettingItem) => {
    if (
      !confirm(
        `Hapus ${item.label}? Fallback akan kembali ke env vars (kalau ada).`,
      )
    )
      return
    try {
      await del.mutateAsync(item.key)
      toast.success(`${item.label} dihapus`)
      setDraft((prev) => ({ ...prev, [item.key]: "" }))
    } catch (err) {
      toast.error("Gagal hapus", { description: apiErrorMessage(err) })
    }
  }

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-5 lg:p-6 max-w-3xl">
      <div className="flex items-start gap-3">
        <KeyRound className="h-6 w-6 text-brand-600 mt-1" />
        <div>
          <h1 className="text-xl font-bold text-ink-900 sm:text-2xl">
            Pengaturan Sistem
          </h1>
          <p className="text-[12px] text-ink-500 mt-0.5">
            Manage API key & integrasi tanpa restart deploy. Secret values
            di-encrypt at rest. Fallback ke env vars kalau DB kosong.
          </p>
        </div>
      </div>

      {groups.map(([groupKey, items]) => {
        const meta = GROUP_META[groupKey] ?? {
          label: groupKey,
          icon: KeyRound,
          description: "",
        }
        const Icon = meta.icon
        return (
          <div
            key={groupKey}
            className="rounded-md border bg-surface p-4 sm:p-5 space-y-3"
          >
            <div className="flex items-start gap-2">
              <div className="grid h-9 w-9 place-items-center rounded bg-brand-50 text-brand-600 shrink-0">
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-ink-900">
                  {meta.label}
                </h3>
                <p className="text-[12px] text-ink-500 mt-0.5 leading-relaxed">
                  {meta.description}
                </p>
              </div>
            </div>

            <div className="space-y-2.5">
              {items.map((item) => (
                <SettingRow
                  key={item.key}
                  item={item}
                  value={draft[item.key] ?? ""}
                  onChange={(v) =>
                    setDraft((prev) => ({ ...prev, [item.key]: v }))
                  }
                  reveal={!!reveal[item.key]}
                  onToggleReveal={() =>
                    setReveal((prev) => ({
                      ...prev,
                      [item.key]: !prev[item.key],
                    }))
                  }
                  onDelete={() => handleDelete(item)}
                  deleting={del.isPending && del.variables === item.key}
                />
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-1 border-t mt-3">
              <Button
                onClick={() => handleSave(groupKey)}
                disabled={update.isPending}
              >
                {update.isPending && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                <Save className="h-4 w-4" />
                Simpan {meta.label}
              </Button>
            </div>
          </div>
        )
      })}

      <div className="rounded-md border border-info-200 bg-info-50 p-3 text-[12px] text-info-800">
        <strong>Catatan:</strong>{" "}
        Beberapa setting (Telegram webhook, WAHA webhook) butuh{" "}
        <em>restart deploy</em> setelah pertama kali di-set supaya backend
        register webhook ke provider. OCR & API key efek langsung (refresh
        cache 60 detik atau langsung di request baru).
      </div>
    </div>
  )
}

// ============================================================
// Setting row
// ============================================================
function SettingRow({
  item,
  value,
  onChange,
  reveal,
  onToggleReveal,
  onDelete,
  deleting,
}: {
  item: SystemSettingItem
  value: string
  onChange: (v: string) => void
  reveal: boolean
  onToggleReveal: () => void
  onDelete: () => void
  deleting: boolean
}) {
  const hasAnyValue = item.has_value || item.from_env
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Label className="text-[12px] font-medium text-ink-800">
          {item.label}
        </Label>
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider">
          {item.is_secret && (
            <span className="rounded bg-warning-100 text-warning-800 px-1.5 py-0.5">
              secret
            </span>
          )}
          {hasAnyValue ? (
            <span
              className={
                "inline-flex items-center gap-1 rounded px-1.5 py-0.5 " +
                (item.from_env
                  ? "bg-info-100 text-info-800"
                  : "bg-success-100 text-success-800")
              }
            >
              <CheckCircle2 className="h-3 w-3" />
              {item.from_env ? "dari env" : "tersimpan"}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded bg-ink-100 text-ink-600 px-1.5 py-0.5">
              <AlertTriangle className="h-3 w-3" />
              belum di-set
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <Input
          type={item.is_secret && !reveal ? "password" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            item.is_secret
              ? hasAnyValue
                ? `Sudah di-set (${item.preview ?? "•••"}) — biarkan kosong utk pertahankan`
                : "Masukkan API key…"
              : item.hint ?? ""
          }
          className="flex-1 font-mono text-[12px]"
          autoComplete="off"
        />
        {item.is_secret && (
          <button
            type="button"
            onClick={onToggleReveal}
            className="p-1.5 text-ink-500 hover:text-ink-800"
            aria-label={reveal ? "Sembunyikan" : "Tampilkan"}
          >
            {reveal ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        )}
        {item.has_value && (
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="p-1.5 text-danger-500 hover:bg-danger-50 rounded"
            aria-label="Hapus value DB (fallback ke env)"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
      {item.hint && (
        <p className="text-[11px] text-ink-500 leading-snug">{item.hint}</p>
      )}
    </div>
  )
}
