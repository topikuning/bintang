import { CheckCircle2, Info, Loader2, MessageCircle, Send, XCircle } from "lucide-react"
import {
  useMessagingConfig,
  useUpdateMessagingConfig,
  useWhatsAppTest,
  type WhatsAppTestResult,
} from "@/hooks/useMessaging"
import { useAuthStore } from "@/store/auth"
import { apiErrorMessage } from "@/lib/api"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { toast } from "@/components/ui/sonner"
import { cn } from "@/lib/utils"

interface MessagingSectionProps {
  className?: string
}

/**
 * Section di SettingsPage utk toggle integrasi notifikasi
 * Telegram & WhatsApp.
 *
 * Status configured (env var token tersedia di backend) read-only;
 * yang bisa diubah hanya enabled flag (DB row), gated SUPERADMIN.
 *
 * Kalau belum configured, toggle disabled + petunjuk set env var.
 */
export function MessagingSection({ className }: MessagingSectionProps) {
  const role = useAuthStore((s) => s.user?.role)
  const isSuperAdmin = role === "SUPERADMIN"
  const q = useMessagingConfig()
  const update = useUpdateMessagingConfig()
  const waTest = useWhatsAppTest()

  if (q.isLoading) {
    return (
      <div className={cn("rounded-md border bg-surface p-4 sm:p-5 space-y-3", className)}>
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </div>
    )
  }
  if (q.error || !q.data) {
    return (
      <div
        className={cn(
          "rounded-md border border-danger-200 bg-danger-50 p-4 text-[13px] text-danger-700",
          className,
        )}
      >
        Gagal muat konfigurasi messaging: {apiErrorMessage(q.error)}
      </div>
    )
  }
  const cfg = q.data

  const toggle = async (
    field: "telegram_enabled" | "whatsapp_enabled",
    value: boolean,
  ) => {
    try {
      await update.mutateAsync({ [field]: value })
      toast.success(
        value
          ? `${field === "telegram_enabled" ? "Telegram" : "WhatsApp"} diaktifkan`
          : `${field === "telegram_enabled" ? "Telegram" : "WhatsApp"} dimatikan`,
      )
    } catch (err) {
      toast.error("Gagal update", { description: apiErrorMessage(err) })
    }
  }

  return (
    <div className={cn("rounded-md border bg-surface p-4 sm:p-5 space-y-3", className)}>
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded bg-ink-100 text-ink-700 shrink-0">
          <MessageCircle className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-ink-900">Notifikasi</h3>
          <p className="text-[12px] text-ink-500 leading-relaxed mt-0.5">
            Aktifkan integrasi Telegram / WhatsApp untuk auto-notify saat ada
            transaksi pending validasi, invoice overdue, dst. Token dikonfigurasi
            via env var di backend.
          </p>
        </div>
      </div>

      <ChannelRow
        icon={Send}
        title="Telegram"
        description="Notifikasi via bot Telegram. Backend harus punya TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID di env."
        enabled={cfg.telegram_enabled}
        configured={cfg.telegram_configured}
        canToggle={isSuperAdmin}
        isUpdating={update.isPending}
        onToggle={(v) => toggle("telegram_enabled", v)}
      />
      <ChannelRow
        icon={MessageCircle}
        title="WhatsApp"
        description="Notifikasi via WAHA gateway. Backend butuh WHATSAPP_BASE_URL + session aktif."
        enabled={cfg.whatsapp_enabled}
        configured={cfg.whatsapp_configured}
        canToggle={isSuperAdmin}
        isUpdating={update.isPending}
        onToggle={(v) => toggle("whatsapp_enabled", v)}
        meta={
          cfg.whatsapp_configured && cfg.whatsapp_base_url
            ? `${cfg.whatsapp_base_url} · session ${cfg.whatsapp_session ?? "default"}`
            : undefined
        }
        testButton={
          isSuperAdmin ? (
            <WhatsAppTestPanel
              isPending={waTest.isPending}
              result={waTest.data}
              error={waTest.error}
              onTest={() => {
                waTest.mutate(undefined, {
                  onError: (err) =>
                    toast.error("Test gagal", { description: apiErrorMessage(err) }),
                })
              }}
            />
          ) : undefined
        }
      />

      {!isSuperAdmin && (
        <div className="flex items-start gap-1.5 text-[11px] text-ink-500">
          <Info className="h-3 w-3 mt-0.5 shrink-0" />
          <span>Hanya SUPERADMIN yang dapat mengubah toggle notifikasi.</span>
        </div>
      )}
    </div>
  )
}

function ChannelRow({
  icon: Icon,
  title,
  description,
  enabled,
  configured,
  canToggle,
  isUpdating,
  onToggle,
  meta,
  testButton,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  enabled: boolean
  configured: boolean
  canToggle: boolean
  isUpdating: boolean
  onToggle: (next: boolean) => void
  meta?: string
  testButton?: React.ReactNode
}) {
  const disabled = !canToggle || !configured

  return (
    <div className="rounded-md border bg-surface p-3 space-y-2">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded bg-brand-50 text-brand-600 shrink-0">
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-ink-900">{title}</span>
            {configured ? (
              <Badge tone="success">
                <CheckCircle2 className="inline h-3 w-3 mr-1" />
                Configured
              </Badge>
            ) : (
              <Badge tone="neutral">
                <XCircle className="inline h-3 w-3 mr-1" />
                Belum dikonfigurasi
              </Badge>
            )}
            {enabled ? (
              <Badge tone="info">Aktif</Badge>
            ) : (
              <Badge tone="neutral">Nonaktif</Badge>
            )}
          </div>
          <p className="text-[12px] text-ink-500 mt-0.5 leading-relaxed">
            {description}
          </p>
          {meta && (
            <p className="mt-1 font-mono text-[11px] text-ink-500 truncate">{meta}</p>
          )}
        </div>
        <Toggle
          checked={enabled}
          disabled={disabled || isUpdating}
          onChange={onToggle}
        />
      </div>
      {!configured && (
        <p className="flex items-start gap-1 rounded bg-warning-50 px-2 py-1.5 text-[11px] text-warning-800">
          <Info className="h-3 w-3 mt-0.5 shrink-0" />
          Set env var di backend service Railway, lalu redeploy backend.
          Toggle baru dapat di-aktifkan setelah backend mendeteksi token.
        </p>
      )}
      {testButton}
    </div>
  )
}

// ---------------------------------------------------------------------------
// WhatsApp test panel
// ---------------------------------------------------------------------------

function CheckItem({ ok, label, detail }: { ok: boolean | null; label: string; detail?: string }) {
  return (
    <div className="flex items-start gap-2 text-[12px]">
      {ok === null ? (
        <span className="h-4 w-4 shrink-0 rounded-full bg-ink-200 mt-0.5" />
      ) : ok ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-success-600 mt-0.5" />
      ) : (
        <XCircle className="h-4 w-4 shrink-0 text-danger-500 mt-0.5" />
      )}
      <div>
        <span className={cn("font-medium", ok === false && "text-danger-700")}>{label}</span>
        {detail && <span className="ml-1 text-ink-500">{detail}</span>}
      </div>
    </div>
  )
}

function WhatsAppTestPanel({
  isPending,
  result,
  error,
  onTest,
}: {
  isPending: boolean
  result?: WhatsAppTestResult
  error?: unknown
  onTest: () => void
}) {
  const allOk =
    result &&
    result.configured &&
    result.toggle_enabled &&
    result.waha_reachable &&
    result.session_status === "WORKING"

  return (
    <div className="border-t pt-2 mt-1 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
          Test Koneksi
        </span>
        <button
          type="button"
          onClick={onTest}
          disabled={isPending}
          className={cn(
            "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[12px] font-medium transition-colors",
            "bg-brand-50 text-brand-700 hover:bg-brand-100",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
          {isPending ? "Mengecek…" : "Cek Sekarang"}
        </button>
      </div>

      {error && !result && (
        <p className="text-[12px] text-danger-600">
          Gagal menjalankan test. Pastikan kamu login sebagai SUPERADMIN.
        </p>
      )}

      {result && (
        <div className="rounded-md bg-ink-50 p-3 space-y-1.5">
          <div className="flex items-center gap-1.5 mb-2">
            {allOk ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-success-600" />
                <span className="text-[13px] font-semibold text-success-700">Semua OK — WhatsApp terhubung</span>
              </>
            ) : (
              <>
                <XCircle className="h-4 w-4 text-danger-500" />
                <span className="text-[13px] font-semibold text-danger-700">Ada masalah koneksi</span>
              </>
            )}
          </div>

          <CheckItem
            ok={result.configured}
            label="WHATSAPP_BASE_URL dikonfigurasi"
            detail={result.waha_url ?? undefined}
          />
          <CheckItem
            ok={result.toggle_enabled}
            label="Toggle diaktifkan"
            detail={result.toggle_enabled ? undefined : "Aktifkan toggle di atas"}
          />
          <CheckItem
            ok={result.waha_reachable}
            label="WAHA dapat dihubungi"
            detail={result.configured && !result.waha_reachable ? "Periksa URL dan API key" : undefined}
          />
          <CheckItem
            ok={result.session_status === "WORKING"}
            label="Session aktif"
            detail={
              result.session_status
                ? `status: ${result.session_status}${result.engine ? ` · ${result.engine}` : ""}${result.session_name ? ` · session: ${result.session_name}` : ""}`
                : result.waha_reachable
                ? "Session tidak ditemukan"
                : undefined
            }
          />
        </div>
      )}
    </div>
  )
}

function Toggle({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2",
        checked ? "bg-brand-500" : "bg-ink-300",
        disabled && "opacity-50 cursor-not-allowed",
      )}
    >
      <span className="sr-only">{checked ? "Aktif" : "Nonaktif"}</span>
      <span
        className={cn(
          "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition",
          checked ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  )
}
