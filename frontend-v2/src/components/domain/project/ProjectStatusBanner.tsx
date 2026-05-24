/**
 * Banner status proyek non-AKTIF utk muncul di detail proyek + form
 * create TX/Invoice/PO. Audit 2026-05-24 Phase 1: lock create di proyek
 * SELESAI/DIBATALKAN/MENUNGGU_PERSETUJUAN -- user perlu visual hint.
 *
 * Variant warna:
 * - SELESAI:   kuning (financial frozen, tp reopen-able)
 * - DITAHAN:   kuning muda (warn-only, blm block backend)
 * - DIBATALKAN: merah (read-only audit trail)
 * - MENUNGGU_PERSETUJUAN: abu-abu (pending approval)
 */
import { AlertCircle, AlertTriangle, BanIcon, ClockIcon } from "lucide-react"
import { fmtDate } from "@/lib/format"
import { cn } from "@/lib/utils"

interface ProjectStatusBannerProps {
  status: string | undefined | null
  /** ISO datetime sejak kapan status ini (proxy: project.updated_at). */
  sinceIso?: string | null
  /** Sticker compact mode utk header form (1 line). */
  compact?: boolean
  className?: string
}

const CONFIG: Record<
  string,
  { tone: "warn" | "warn-soft" | "danger" | "muted"; icon: typeof AlertTriangle; label: string; desc: string }
> = {
  SELESAI: {
    tone: "warn",
    icon: AlertTriangle,
    label: "Proyek SELESAI",
    desc: "Snapshot keuangan dianggap final. Mutasi baru ditolak -- reopen lewat Edit Proyek dulu kalau perlu.",
  },
  DITAHAN: {
    tone: "warn-soft",
    icon: ClockIcon,
    label: "Proyek DITAHAN",
    desc: "Operasional dipause. Mutasi masih boleh, tapi pastikan memang perlu.",
  },
  DIBATALKAN: {
    tone: "danger",
    icon: BanIcon,
    label: "Proyek DIBATALKAN",
    desc: "Read-only audit trail. Mutasi baru ditolak.",
  },
  MENUNGGU_PERSETUJUAN: {
    tone: "muted",
    icon: AlertCircle,
    label: "Menunggu Persetujuan",
    desc: "Proyek belum disetujui admin. Mutasi belum bisa dibuat.",
  },
}

export function ProjectStatusBanner({
  status,
  sinceIso,
  compact,
  className,
}: ProjectStatusBannerProps) {
  if (!status || status === "AKTIF") return null
  const cfg = CONFIG[status]
  if (!cfg) return null
  const Icon = cfg.icon
  const sinceLabel = sinceIso ? fmtDate(sinceIso) : null

  const toneClass =
    cfg.tone === "danger"
      ? "border-danger-200 bg-danger-50 text-danger-800"
      : cfg.tone === "warn"
      ? "border-warning-200 bg-warning-50 text-warning-800"
      : cfg.tone === "warn-soft"
      ? "border-warning-200 bg-warning-50/60 text-warning-800"
      : "border-ink-200 bg-ink-50 text-ink-700"

  if (compact) {
    return (
      <div
        className={cn(
          "flex items-center gap-1.5 rounded border px-2 py-1 text-[12px]",
          toneClass,
          className,
        )}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="font-semibold">{cfg.label}</span>
        {sinceLabel && (
          <span className="opacity-70">· sejak {sinceLabel}</span>
        )}
      </div>
    )
  }

  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2 text-sm flex items-start gap-2",
        toneClass,
        className,
      )}
    >
      <Icon className="h-4 w-4 shrink-0 mt-0.5" />
      <div className="flex flex-col gap-0.5">
        <div className="font-semibold">
          {cfg.label}
          {sinceLabel && (
            <span className="ml-1 font-normal opacity-70">
              sejak {sinceLabel}
            </span>
          )}
        </div>
        <div className="text-[12px] opacity-90">{cfg.desc}</div>
      </div>
    </div>
  )
}
