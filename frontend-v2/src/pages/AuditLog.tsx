import { useMemo, useState } from "react"
import {
  ArrowLeftRight,
  BadgeCheck,
  Ban,
  ChevronDown,
  ChevronRight,
  CircleDot,
  ClipboardList,
  FileMinus,
  FileText,
  History,
  Pencil,
  Plus,
  Send,
  ShieldCheck,
  ShoppingCart,
  Trash2,
  XCircle,
} from "lucide-react"
import type { AuditLogEntry } from "@/types/api"
import { useAuditLogs } from "@/hooks/useAuditLogs"
import { useUsers } from "@/hooks/useUsers"
import { useAuthStore } from "@/store/auth"
import { fmtDate, fmtDateTime } from "@/lib/format"
import { apiErrorMessage } from "@/lib/api"
import { ErrorState } from "@/components/data/ErrorState"
import { Pagination } from "@/components/data/Pagination"
import { DateInput } from "@/components/forms/DateInput"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

const ENTITY_OPTIONS = [
  { value: "transaction", label: "Transaksi", icon: ArrowLeftRight },
  { value: "invoice", label: "Invoice", icon: FileMinus },
  { value: "purchase_order", label: "Purchase Order", icon: ShoppingCart },
  { value: "project", label: "Proyek", icon: ClipboardList },
  { value: "user", label: "Pengguna", icon: ShieldCheck },
  { value: "category", label: "Kategori", icon: FileText },
  { value: "vendor_client", label: "Vendor/Klien", icon: FileText },
] as const

const ACTION_META: Record<
  string,
  {
    label: string
    icon: React.ComponentType<{ className?: string }>
    tone: "success" | "warning" | "danger" | "info" | "neutral"
  }
> = {
  CREATE: { label: "Tambah", icon: Plus, tone: "success" },
  UPDATE: { label: "Ubah", icon: Pencil, tone: "info" },
  DELETE: { label: "Hapus", icon: Trash2, tone: "danger" },
  SUBMIT: { label: "Ajukan", icon: Send, tone: "info" },
  VERIFY: { label: "Validasi", icon: BadgeCheck, tone: "success" },
  REJECT: { label: "Tolak", icon: XCircle, tone: "danger" },
  CANCEL: { label: "Batalkan", icon: Ban, tone: "warning" },
  APPROVE: { label: "Setujui", icon: BadgeCheck, tone: "success" },
}

function getActionMeta(action: string) {
  return (
    ACTION_META[action.toUpperCase()] ?? {
      label: action,
      icon: CircleDot,
      tone: "neutral" as const,
    }
  )
}

function getEntityLabel(entity: string): string {
  return (
    ENTITY_OPTIONS.find((e) => e.value === entity)?.label ??
    entity.charAt(0).toUpperCase() + entity.slice(1)
  )
}

function getEntityIcon(entity: string): React.ComponentType<{ className?: string }> {
  return ENTITY_OPTIONS.find((e) => e.value === entity)?.icon ?? FileText
}

export function AuditLogPage() {
  const role = useAuthStore((s) => s.user?.role)
  const isAuthorized = role === "SUPERADMIN" || role === "CENTRAL_ADMIN"

  const [entity, setEntity] = useState<string>("")
  const [userId, setUserId] = useState<string>("")
  const [dateFrom, setDateFrom] = useState<string | null>(null)
  const [dateTo, setDateTo] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(50)
  const [expanded, setExpanded] = useState<number | null>(null)

  const usersQ = useUsers()
  const q = useAuditLogs({
    page,
    size,
    entity: entity || undefined,
    user_id: userId ? Number(userId) : undefined,
    date_from: dateFrom ?? undefined,
    date_to: dateTo ?? undefined,
  })

  // Group by date utk timeline
  const grouped = useMemo(() => {
    const items = q.data?.items ?? []
    const map = new Map<string, AuditLogEntry[]>()
    items.forEach((item) => {
      const dateKey = item.created_at.slice(0, 10) // YYYY-MM-DD
      if (!map.has(dateKey)) map.set(dateKey, [])
      map.get(dateKey)!.push(item)
    })
    return Array.from(map.entries())
  }, [q.data])

  if (!isAuthorized) {
    return (
      <div className="p-4 sm:p-6">
        <div className="rounded-md border border-warning-200 bg-warning-50 p-6 text-center">
          <ShieldCheck className="mx-auto h-8 w-8 text-warning-600 mb-2" />
          <h2 className="text-base font-semibold text-warning-800">Akses Terbatas</h2>
          <p className="mt-1 text-sm text-warning-700">
            Audit log hanya dapat diakses oleh SUPERADMIN dan CENTRAL_ADMIN.
          </p>
        </div>
      </div>
    )
  }

  if (q.error) {
    return (
      <div className="p-4 sm:p-6">
        <ErrorState
          description={apiErrorMessage(q.error)}
          onRetry={() => q.refetch()}
        />
      </div>
    )
  }

  const total = q.data?.total ?? 0

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-5 lg:p-6">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded bg-brand-50 text-brand-600 shrink-0">
          <History className="h-4 w-4" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-ink-900 sm:text-2xl">Audit Log</h1>
          <p className="text-[13px] text-ink-500 mt-0.5">
            Riwayat lengkap semua perubahan data di sistem -- siapa, kapan, apa yg berubah.
          </p>
        </div>
      </div>

      {/* Filter */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 rounded-md border bg-surface p-3 sm:p-4">
        <div className="flex flex-col gap-1">
          <Label className="text-[11px] uppercase tracking-wider">Entity</Label>
          <Select
            value={entity}
            onChange={(e) => {
              setEntity(e.target.value)
              setPage(1)
            }}
          >
            <option value="">Semua entity</option>
            {ENTITY_OPTIONS.map((e) => (
              <option key={e.value} value={e.value}>
                {e.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[11px] uppercase tracking-wider">Pengguna</Label>
          <Select
            value={userId}
            onChange={(e) => {
              setUserId(e.target.value)
              setPage(1)
            }}
          >
            <option value="">Semua pengguna</option>
            {usersQ.data?.items.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.email})
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[11px] uppercase tracking-wider">Dari</Label>
          <DateInput
            value={dateFrom}
            onChange={(v) => {
              setDateFrom(v)
              setPage(1)
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[11px] uppercase tracking-wider">Sampai</Label>
          <DateInput
            value={dateTo}
            onChange={(v) => {
              setDateTo(v)
              setPage(1)
            }}
          />
        </div>
      </div>

      {/* Timeline */}
      {q.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : grouped.length === 0 ? (
        <div className="rounded-md border border-dashed bg-surface-muted p-12 text-center">
          <History className="mx-auto h-8 w-8 text-ink-400 mb-2" />
          <p className="text-sm text-ink-500">Tidak ada aktivitas yang cocok dengan filter.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {grouped.map(([dateKey, items]) => (
            <div key={dateKey} className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="h-px flex-1 bg-ink-200" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
                  {fmtDate(dateKey, { fullMonth: true })}
                </span>
                <div className="h-px flex-1 bg-ink-200" />
              </div>
              <ul className="flex flex-col gap-1.5">
                {items.map((entry) => (
                  <AuditEntry
                    key={entry.id}
                    entry={entry}
                    isExpanded={expanded === entry.id}
                    onToggle={() => setExpanded((cur) => (cur === entry.id ? null : entry.id))}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {total > 0 && (
        <Pagination
          page={page}
          size={size}
          total={total}
          onPageChange={setPage}
          onSizeChange={(s) => {
            setSize(s)
            setPage(1)
          }}
        />
      )}
    </div>
  )
}

function AuditEntry({
  entry,
  isExpanded,
  onToggle,
}: {
  entry: AuditLogEntry
  isExpanded: boolean
  onToggle: () => void
}) {
  const action = getActionMeta(entry.action)
  const ActionIcon = action.icon
  const EntityIcon = getEntityIcon(entry.entity)
  const hasDiff =
    (entry.before && Object.keys(entry.before).length > 0) ||
    (entry.after && Object.keys(entry.after).length > 0) ||
    !!entry.note

  const time = new Date(entry.created_at).toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  })

  return (
    <li className="rounded-md border bg-surface">
      <button
        type="button"
        onClick={onToggle}
        disabled={!hasDiff}
        className={cn(
          "flex w-full items-start gap-3 px-3 py-2.5 text-left",
          hasDiff && "hover:bg-surface-muted",
          !hasDiff && "cursor-default",
        )}
      >
        <div className="flex flex-col items-center gap-0.5 shrink-0 pt-0.5">
          <span className="font-mono text-[11px] text-ink-500 [font-variant-numeric:tabular-nums]">
            {time}
          </span>
          <span
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-full",
              action.tone === "success" && "bg-success-50 text-success-700",
              action.tone === "warning" && "bg-warning-50 text-warning-700",
              action.tone === "danger" && "bg-danger-50 text-danger-700",
              action.tone === "info" && "bg-info-50 text-info-700",
              action.tone === "neutral" && "bg-ink-100 text-ink-700",
            )}
          >
            <ActionIcon className="h-3.5 w-3.5" />
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-medium text-ink-900">
              {entry.user_name ?? `User #${entry.user_id}`}
            </span>
            <Badge tone={action.tone}>{action.label}</Badge>
            <span className="inline-flex items-center gap-1 text-[12px] text-ink-600">
              <EntityIcon className="h-3.5 w-3.5" />
              {getEntityLabel(entry.entity)} <span className="font-mono">#{entry.entity_id}</span>
            </span>
          </div>
          {entry.note && (
            <p className="text-[12px] text-ink-600 mt-0.5 italic line-clamp-2">"{entry.note}"</p>
          )}
        </div>
        {hasDiff && (
          <div className="shrink-0 pt-1">
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-ink-400" />
            ) : (
              <ChevronRight className="h-4 w-4 text-ink-400" />
            )}
          </div>
        )}
      </button>

      {isExpanded && hasDiff && (
        <div className="border-t bg-surface-muted px-3 py-3 space-y-2">
          <div className="text-[11px] text-ink-500">
            {fmtDateTime(entry.created_at, { fullMonth: true })}
          </div>
          {entry.note && (
            <div className="rounded border bg-surface p-2 text-[12px] italic text-ink-700">
              <span className="text-[10px] uppercase tracking-wider text-ink-500 mr-1">
                Catatan:
              </span>
              {entry.note}
            </div>
          )}
          {entry.before && Object.keys(entry.before).length > 0 && (
            <DiffBlock label="Sebelum" data={entry.before} tone="danger" />
          )}
          {entry.after && Object.keys(entry.after).length > 0 && (
            <DiffBlock label="Sesudah" data={entry.after} tone="success" />
          )}
        </div>
      )}
    </li>
  )
}

function DiffBlock({
  label,
  data,
  tone,
}: {
  label: string
  data: Record<string, unknown>
  tone: "success" | "danger"
}) {
  return (
    <div className="rounded border bg-surface">
      <div
        className={cn(
          "px-2 py-1 text-[10px] font-semibold uppercase tracking-wider rounded-t",
          tone === "success" ? "bg-success-50 text-success-700" : "bg-danger-50 text-danger-700",
        )}
      >
        {label}
      </div>
      <pre className="overflow-x-auto p-2 text-[11px] font-mono text-ink-800 whitespace-pre-wrap break-all">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  )
}
