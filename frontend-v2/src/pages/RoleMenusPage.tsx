import { useEffect, useMemo, useState } from "react"
import {
  CheckCircle2,
  Loader2,
  Save,
  ShieldCheck,
  XCircle,
} from "lucide-react"
import { useAuthStore } from "@/store/auth"
import {
  useRoleMenus,
  useUpdateRoleMenus,
  type PolicyUpdate,
} from "@/hooks/useMenuConfig"
import { apiErrorMessage } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "@/components/ui/sonner"
import { ErrorState } from "@/components/data/ErrorState"

const ROLE_LABELS: Record<string, string> = {
  CENTRAL_ADMIN: "Central Admin",
  PROJECT_ADMIN: "Project Admin",
  EXECUTIVE: "Executive",
}

const GROUP_LABELS: Record<string, string> = {
  beranda: "Beranda",
  operasional: "Operasional",
  laporan: "Laporan",
  master: "Master Data",
  sistem: "Sistem",
}

/**
 * Halaman atur visibility menu per role (SUPERADMIN only).
 *
 * Default: semua menu visible utk semua role. Toggle off = sembunyikan.
 * SUPERADMIN selalu lihat semua (tidak ada di matrix).
 */
export function RoleMenusPage() {
  const role = useAuthStore((s) => s.user?.role)
  const isSuper = role === "SUPERADMIN"

  const q = useRoleMenus()
  const update = useUpdateRoleMenus()

  // Draft: roleKey -> Set<menu_id>. Mutated on toggle. Diff dgn server
  // saat submit -> bulk PATCH.
  const [draft, setDraft] = useState<Record<string, Set<string>>>({})
  const [dirty, setDirty] = useState(false)

  // Initial load -> draft = server state
  useEffect(() => {
    if (!q.data) return
    const init: Record<string, Set<string>> = {}
    for (const r of q.data.roles) {
      init[r] = new Set(q.data.hidden[r] ?? [])
    }
    setDraft(init)
    setDirty(false)
  }, [q.data])

  // Group registry by 'group' utk render sections
  const groupedRegistry = useMemo(() => {
    const groups: Record<string, typeof q.data extends { registry: infer R } ? R : never> =
      {} as never
    const out: Record<string, { id: string; label: string }[]> = {}
    if (!q.data) return out
    for (const item of q.data.registry) {
      ;(out[item.group] ??= []).push(item)
    }
    void groups
    return out
  }, [q.data])

  if (!isSuper) {
    return (
      <div className="p-4 sm:p-6">
        <div className="rounded-md border border-warning-200 bg-warning-50 p-6 text-center">
          <ShieldCheck className="mx-auto h-8 w-8 text-warning-600 mb-2" />
          <h2 className="text-base font-semibold text-warning-800">
            Akses Terbatas
          </h2>
          <p className="mt-1 text-sm text-warning-700">
            Pengaturan akses menu hanya untuk SUPERADMIN.
          </p>
        </div>
      </div>
    )
  }

  if (q.isLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-72" />
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

  const toggle = (roleKey: string, menuId: string) => {
    setDraft((prev) => {
      const next = { ...prev }
      const set = new Set<string>(next[roleKey] ?? [])
      if (set.has(menuId)) set.delete(menuId)
      else set.add(menuId)
      next[roleKey] = set
      return next
    })
    setDirty(true)
  }

  const isVisible = (roleKey: string, menuId: string) =>
    !(draft[roleKey]?.has(menuId) ?? false)

  const handleSave = async () => {
    const updates: PolicyUpdate[] = []
    for (const roleKey of q.data!.roles) {
      const initialSet = new Set(q.data!.hidden[roleKey] ?? [])
      const draftSet = draft[roleKey] ?? new Set<string>()
      // Items that changed
      for (const m of q.data!.registry) {
        const wasHidden = initialSet.has(m.id)
        const isHidden = draftSet.has(m.id)
        if (wasHidden !== isHidden) {
          updates.push({ role: roleKey, menu_id: m.id, hidden: isHidden })
        }
      }
    }
    if (updates.length === 0) {
      toast.message("Tidak ada perubahan")
      return
    }
    try {
      await update.mutateAsync(updates)
      toast.success(`${updates.length} perubahan tersimpan`)
      setDirty(false)
    } catch (err) {
      toast.error("Gagal simpan", { description: apiErrorMessage(err) })
    }
  }

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-5 lg:p-6 max-w-5xl">
      <div className="flex items-start gap-3">
        <ShieldCheck className="h-6 w-6 text-brand-600 mt-1" />
        <div className="flex-1">
          <h1 className="text-xl font-bold text-ink-900 sm:text-2xl">
            Akses Menu per Role
          </h1>
          <p className="text-[12px] text-ink-500 mt-0.5">
            Centang = menu <strong>tampil</strong> utk role tsb. Uncheck =
            sembunyikan. SUPERADMIN selalu lihat semua (tidak di-matrix).
            Perubahan apply ke user di refresh berikutnya.
          </p>
        </div>
        <Button onClick={handleSave} disabled={!dirty || update.isPending}>
          {update.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          <Save className="h-4 w-4" />
          Simpan
        </Button>
      </div>

      {Object.entries(groupedRegistry).map(([groupKey, items]) => (
        <div
          key={groupKey}
          className="rounded-md border bg-surface overflow-hidden"
        >
          <div className="px-3 sm:px-4 py-2 bg-surface-muted/40 border-b">
            <h3 className="text-[12px] font-semibold uppercase tracking-wider text-ink-700">
              {GROUP_LABELS[groupKey] ?? groupKey}
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b bg-surface-muted/20">
                  <th className="text-left px-3 sm:px-4 py-2 font-semibold text-ink-700 w-1/2">
                    Menu
                  </th>
                  {q.data!.roles.map((r) => (
                    <th
                      key={r}
                      className="text-center px-3 py-2 font-semibold text-ink-700 whitespace-nowrap"
                    >
                      {ROLE_LABELS[r] ?? r}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((m) => (
                  <tr key={m.id} className="border-b last:border-b-0">
                    <td className="px-3 sm:px-4 py-2 text-ink-800">
                      <div className="font-medium">{m.label}</div>
                      <div className="text-[10px] text-ink-400 font-mono">
                        {m.id}
                      </div>
                    </td>
                    {q.data!.roles.map((r) => {
                      const visible = isVisible(r, m.id)
                      return (
                        <td key={r} className="text-center px-3 py-2">
                          <button
                            type="button"
                            onClick={() => toggle(r, m.id)}
                            className={
                              "inline-flex h-6 w-6 items-center justify-center rounded transition-colors " +
                              (visible
                                ? "bg-success-100 text-success-700 hover:bg-success-200"
                                : "bg-danger-100 text-danger-700 hover:bg-danger-200")
                            }
                            aria-label={
                              visible
                                ? `${m.label} terlihat utk ${r} -- klik utk sembunyikan`
                                : `${m.label} disembunyikan utk ${r} -- klik utk tampilkan`
                            }
                          >
                            {visible ? (
                              <CheckCircle2 className="h-4 w-4" />
                            ) : (
                              <XCircle className="h-4 w-4" />
                            )}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <div className="rounded-md border border-info-200 bg-info-50 p-3 text-[12px] text-info-800">
        <strong>Catatan:</strong> Filter ini hanya menyembunyikan link di
        sidebar / mobile menu. Backend tetap protect endpoint per role
        (defense in depth) — sembunyikan link bukan jaminan keamanan.
      </div>
    </div>
  )
}
