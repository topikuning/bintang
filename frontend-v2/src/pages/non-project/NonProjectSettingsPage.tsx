import { useState } from "react"
import { CheckCircle2, Lock, ShieldAlert, SlidersHorizontal, XCircle } from "lucide-react"
import {
  useNonProjectYearSettings,
  useUpdateNonProjectYear,
} from "@/hooks/useNonProject"
import { usePageTitle } from "@/hooks/usePageTitle"
import { useAuthStore } from "@/store/auth"
import { EmptyState } from "@/components/data/EmptyState"
import { ErrorState } from "@/components/data/ErrorState"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { toast } from "@/components/ui/sonner"
import { fmtIDR } from "@/lib/format"
import { apiErrorMessage } from "@/lib/api"

/**
 * Pengaturan inklusi Catatan Non-Proyek per tahun per perusahaan.
 *
 * Default: OFF -- tahun yg belum di-setel tidak ikut hitungan global.
 * SUPERADMIN only utk modify (audit-sensitive: berdampak ke laporan
 * yg dilihat semua user incl. EXECUTIVE/pendana). Role lain bisa lihat
 * status (read-only).
 */
export function NonProjectSettingsPage() {
  usePageTitle("Inklusi Catatan Non-Proyek")
  const user = useAuthStore((s) => s.user)
  const canEdit = user?.role === "SUPERADMIN"
  const settingsQuery = useNonProjectYearSettings()
  const updateMut = useUpdateNonProjectYear()

  // Tahun yg user mau tambahkan manual (kalau belum ada tx tahun itu
  // tapi mau setup ahead-of-time).
  const [manualYear, setManualYear] = useState<string>("")
  const [manualCompanyId, setManualCompanyId] = useState<number | null>(null)

  const items = settingsQuery.data ?? []

  if (settingsQuery.error) {
    return (
      <div className="p-4 sm:p-6">
        <ErrorState
          description={apiErrorMessage(settingsQuery.error)}
          onRetry={() => settingsQuery.refetch()}
        />
      </div>
    )
  }

  const handleToggle = async (
    companyId: number,
    year: number,
    nextValue: boolean,
    notes: string | null,
  ) => {
    if (!canEdit) {
      toast.error("Hanya SUPERADMIN yang bisa mengubah pengaturan ini.")
      return
    }
    try {
      await updateMut.mutateAsync({
        company_id: companyId,
        year,
        include_in_global: nextValue,
        notes,
      })
      toast.success(
        `${year}: ${nextValue ? "IKUT" : "TIDAK ikut"} hitungan global.`,
      )
    } catch (err) {
      toast.error(apiErrorMessage(err))
    }
  }

  // Group by company_name supaya rapi
  const byCompany = new Map<string, typeof items>()
  for (const it of items) {
    const arr = byCompany.get(it.company_name) ?? []
    arr.push(it)
    byCompany.set(it.company_name, arr)
  }

  const distinctCompanies = Array.from(
    new Map(items.map((i) => [i.company_id, i.company_name])).entries(),
  )

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-5 lg:p-6">
      <div>
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-5 w-5 text-ink-500" />
          <h1 className="text-xl font-bold text-ink-900 sm:text-2xl">
            Inklusi Catatan Non-Proyek
          </h1>
        </div>
        <p className="text-[13px] text-ink-500 mt-1 max-w-2xl">
          Toggle per-tahun apakah catatan non-proyek di tahun itu ikut
          hitungan global (dashboard, saldo, laporan). Default <strong>OFF</strong>
          {" "}-- tahun yang dimatikan jadi <em>side ledger</em> yang tidak
          menyentuh angka apapun di laporan utama.
        </p>
      </div>

      {!canEdit && (
        <div className="flex items-start gap-2 rounded-md border border-warning-300 bg-warning-50 px-3 py-2.5 text-[13px] text-warning-800">
          <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            Hanya <strong>SUPERADMIN</strong> yang bisa mengubah pengaturan ini.
            Anda hanya bisa melihat status.
          </div>
        </div>
      )}

      {settingsQuery.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={SlidersHorizontal}
          title="Belum ada data catatan non-proyek"
          description="Mulai catat transaksi di /catatan-non-proyek dulu. Tahun yang punya catatan akan otomatis muncul di sini."
          tone="neutral"
        />
      ) : (
        <div className="space-y-5">
          {Array.from(byCompany.entries()).map(([companyName, rows]) => (
            <section key={companyName}>
              <h2 className="text-sm font-semibold text-ink-800 mb-2">
                {companyName}
              </h2>
              <div className="overflow-x-auto rounded-md border bg-surface">
                <table className="w-full text-sm">
                  <thead className="bg-ink-50 text-[11px] uppercase tracking-wider text-ink-500">
                    <tr>
                      <th className="text-left px-3 py-2 w-20">Tahun</th>
                      <th className="text-center px-3 py-2 w-24">Status</th>
                      <th className="text-right px-3 py-2 w-28">Tx</th>
                      <th className="text-right px-3 py-2 w-40">Masuk</th>
                      <th className="text-right px-3 py-2 w-40">Keluar</th>
                      <th className="text-left px-3 py-2">Catatan</th>
                      <th className="text-left px-3 py-2 w-40">Diubah</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={`${r.company_id}-${r.year}`}
                        className="border-t hover:bg-ink-50/50"
                      >
                        <td className="px-3 py-2.5 font-mono font-semibold text-ink-800">
                          {r.year}
                        </td>
                        <td className="text-center px-3 py-2.5">
                          <button
                            type="button"
                            onClick={() =>
                              handleToggle(
                                r.company_id,
                                r.year,
                                !r.include_in_global,
                                r.notes,
                              )
                            }
                            disabled={!canEdit || updateMut.isPending}
                            className={
                              "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-semibold transition-colors " +
                              (r.include_in_global
                                ? "bg-success-100 text-success-700 hover:bg-success-200"
                                : "bg-ink-100 text-ink-700 hover:bg-ink-200") +
                              (canEdit ? "" : " opacity-60 cursor-not-allowed")
                            }
                            title={
                              canEdit
                                ? r.include_in_global
                                  ? "Klik utk matikan (jadi side ledger)"
                                  : "Klik utk aktifkan (masuk hitungan global)"
                                : "SUPERADMIN only"
                            }
                          >
                            {r.include_in_global ? (
                              <>
                                <CheckCircle2 className="h-3.5 w-3.5" /> AKTIF
                              </>
                            ) : (
                              <>
                                <XCircle className="h-3.5 w-3.5" /> OFF
                              </>
                            )}
                            {!canEdit && <Lock className="h-3 w-3 ml-1" />}
                          </button>
                        </td>
                        <td className="text-right px-3 py-2.5 tabular-nums text-ink-700">
                          {r.tx_count}
                        </td>
                        <td className="text-right px-3 py-2.5 tabular-nums">
                          {r.total_in > 0 ? (
                            <span className="text-success-700">
                              {fmtIDR(r.total_in)}
                            </span>
                          ) : (
                            <span className="text-ink-400">—</span>
                          )}
                        </td>
                        <td className="text-right px-3 py-2.5 tabular-nums">
                          {r.total_out > 0 ? (
                            <span className="text-danger-700">
                              {fmtIDR(r.total_out)}
                            </span>
                          ) : (
                            <span className="text-ink-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-ink-600 text-[12px]">
                          {r.notes || (
                            <span className="text-ink-400 italic">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-ink-500 text-[11px]">
                          {r.updated_at ? (
                            <>
                              <div>
                                {new Date(r.updated_at).toLocaleDateString("id-ID")}
                              </div>
                              {r.updated_by_name && (
                                <div className="text-ink-400">
                                  oleh {r.updated_by_name}
                                </div>
                              )}
                            </>
                          ) : (
                            <span className="text-ink-400">belum pernah</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Manual tambah tahun (jarang dipakai -- mostly auto-detect) */}
      {canEdit && distinctCompanies.length > 0 && (
        <details className="rounded-md border bg-surface p-3 text-sm">
          <summary className="cursor-pointer font-medium text-ink-700">
            Tambah pengaturan tahun manual (opsional)
          </summary>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-ink-500 mb-1">
                Perusahaan
              </label>
              <select
                value={manualCompanyId ?? ""}
                onChange={(e) =>
                  setManualCompanyId(Number(e.target.value) || null)
                }
                className="h-10 rounded border border-border-strong bg-surface px-3 text-sm"
              >
                <option value="">Pilih…</option>
                {distinctCompanies.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-ink-500 mb-1">
                Tahun
              </label>
              <Input
                type="number"
                min={2000}
                max={2100}
                placeholder="2027"
                value={manualYear}
                onChange={(e) => setManualYear(e.target.value)}
                className="w-28"
              />
            </div>
            <button
              type="button"
              disabled={
                !manualCompanyId || !manualYear || updateMut.isPending
              }
              onClick={async () => {
                const y = Number(manualYear)
                if (!Number.isFinite(y) || y < 1900 || y > 2100) {
                  toast.error("Tahun tidak valid")
                  return
                }
                await handleToggle(manualCompanyId!, y, false, null)
                setManualYear("")
              }}
              className="h-10 rounded bg-brand-500 text-white px-4 text-sm font-medium hover:bg-brand-600 disabled:opacity-50"
            >
              Tambahkan (default OFF)
            </button>
          </div>
        </details>
      )}
    </div>
  )
}
