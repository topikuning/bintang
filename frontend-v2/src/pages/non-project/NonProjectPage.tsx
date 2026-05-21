import { useEffect, useMemo, useState } from "react"
import { ArrowDownLeft, ArrowUpRight, Info, Notebook, Plus, Wallet } from "lucide-react"
import { Link } from "react-router-dom"
import {
  useTransaction,
  useTransactions,
  type TransactionListParams,
} from "@/hooks/useTransactions"
import { useNonProjectCompanies } from "@/hooks/useNonProject"
import { useCategories } from "@/hooks/useCategories"
import { useNonProjectYearSettings } from "@/hooks/useNonProject"
import { usePageTitle } from "@/hooks/usePageTitle"
import { AdaptiveDataView } from "@/components/data/AdaptiveDataView"
import { Pagination } from "@/components/data/Pagination"
import { SummaryCard, SummaryCardGrid } from "@/components/data/SummaryCard"
import { EmptyState } from "@/components/data/EmptyState"
import { ErrorState } from "@/components/data/ErrorState"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { DraggableSheet } from "@/components/ui/draggable-sheet"
import { TransactionCard } from "@/components/domain/transaction/TransactionCard"
import { TransactionDetail } from "@/components/domain/transaction/TransactionDetail"
import { TransactionForm } from "@/components/domain/transaction/TransactionForm"
import { TransactionActions } from "@/components/domain/transaction/TransactionActions"
import { buildTransactionColumns } from "@/components/domain/transaction/transaction-columns"
import { fmtCompact, fmtIDR } from "@/lib/format"
import { apiErrorMessage } from "@/lib/api"
import { useBreakpoint } from "@/lib/breakpoint"
import type { Project, Transaction } from "@/types/api"
import type { Category } from "@/hooks/useCategories"

/**
 * Halaman Catatan Non-Proyek -- list + form utk tx di bucket system
 * project NON_PROJECT.
 *
 * Konsep:
 * - Tx di sini by default TIDAK ikut hitungan global (dashboard, totals,
 *   cashflow). Toggle inklusi per tahun ada di /settings/non-project
 *   (SUPERADMIN only).
 * - Halaman ini terpisah dari /transactions reguler; tx di sini tdk
 *   muncul di sana, dan sebaliknya.
 */
export function NonProjectPage() {
  usePageTitle("Catatan Non-Proyek")
  const bp = useBreakpoint()
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(50)
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Transaction | null>(null)

  const companiesQuery = useNonProjectCompanies()
  const companies = companiesQuery.data ?? []

  // Auto-select company kalau cuma 1, atau pakai pertama by default.
  useEffect(() => {
    if (selectedCompanyId == null && companies.length > 0) {
      const first = companies[0]
      if (first) setSelectedCompanyId(first.company_id)
    }
  }, [companies, selectedCompanyId])

  const selectedCompany = companies.find(
    (c) => c.company_id === selectedCompanyId,
  )
  const lockedProjectId = selectedCompany?.project_id ?? null

  // Tx list: scope ke project_id system NP company terpilih.
  const params: TransactionListParams = useMemo(
    () => ({
      page,
      size,
      non_project: true,
      project_id: lockedProjectId ? [lockedProjectId] : undefined,
    }),
    [page, size, lockedProjectId],
  )
  const txQuery = useTransactions(params)
  const detailQuery = useTransaction(selectedId)
  const catQuery = useCategories()
  const yearSettingsQuery = useNonProjectYearSettings(selectedCompanyId ?? undefined)

  // Status inklusi tahun ini -- buat banner.
  const currentYear = new Date().getFullYear()
  const currentYearStatus = yearSettingsQuery.data?.find(
    (s) => s.company_id === selectedCompanyId && s.year === currentYear,
  )

  const projectMap = useMemo(() => {
    const m = new Map<number, Project>()
    if (selectedCompany) {
      // Inject minimal Project record utk lockedProjectId supaya
      // TransactionCard bisa tampil nama "Catatan Non-Proyek".
      m.set(selectedCompany.project_id, {
        id: selectedCompany.project_id,
        code: selectedCompany.project_code,
        name: "Catatan Non-Proyek",
        company_id: selectedCompany.company_id,
        status: "AKTIF",
        kind: "NON_PROJECT",
        project_value: "0",
        budget_amount: "0",
        currency: "IDR",
        overbudget_tolerance_pct: "0",
        tax_ppn_pct: "0",
        tax_pph_pct: "0",
        marketing_pct: "0",
        company_name: selectedCompany.company_name,
      } as Project)
    }
    return m
  }, [selectedCompany])

  const categoryMap = useMemo(() => {
    const m = new Map<number, Category>()
    catQuery.data?.items.forEach((c) => m.set(c.id, c))
    return m
  }, [catQuery.data])

  const items = txQuery.data?.items ?? []
  const total = txQuery.data?.total ?? 0

  // Summary di-page (subset). Untuk total tahunan, lihat halaman pengaturan.
  const sumIn = items
    .filter((t) => t.type === "IN" && t.status === "VERIFIED")
    .reduce((s, t) => s + Number(t.amount || 0), 0)
  const sumOut = items
    .filter((t) => t.type === "OUT" && t.status === "VERIFIED")
    .reduce((s, t) => s + Number(t.amount || 0), 0)
  const balance = sumIn - sumOut

  const columns = useMemo(
    () => buildTransactionColumns({ projectMap, categoryMap, hideProject: true }),
    [projectMap, categoryMap],
  )

  const detailOpen = selectedId != null
  const closeDetail = () => setSelectedId(null)

  if (txQuery.error || companiesQuery.error) {
    return (
      <div className="p-4 sm:p-6">
        <ErrorState
          description={apiErrorMessage(txQuery.error || companiesQuery.error)}
          onRetry={() => {
            txQuery.refetch()
            companiesQuery.refetch()
          }}
        />
      </div>
    )
  }

  if (!companiesQuery.isLoading && companies.length === 0) {
    return (
      <div className="p-4 sm:p-6">
        <EmptyState
          icon={Notebook}
          title="Bucket Catatan Non-Proyek belum tersedia"
          description="Mungkin terjadi error saat seed migrasi. Hubungi admin sistem."
          tone="neutral"
        />
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-col gap-4 p-3 sm:p-5 lg:p-6">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-ink-900 sm:text-2xl">
              Catatan Non-Proyek
            </h1>
            <p className="text-[13px] text-ink-500 mt-0.5">
              Pencatatan keuangan di luar proyek (mis. keperluan pribadi, ops global).
            </p>
          </div>
          <Button
            size={bp === "mobile" ? "md" : "lg"}
            className="hidden sm:inline-flex"
            disabled={!lockedProjectId}
            onClick={() => {
              setEditTarget(null)
              setFormOpen(true)
            }}
          >
            <Plus className="h-4 w-4" />
            Tambah Catatan
          </Button>
        </div>

        {/* Banner status inklusi tahun ini */}
        <div
          className={
            "flex items-start gap-3 rounded-md border px-3 py-2.5 text-[13px] " +
            (currentYearStatus?.include_in_global
              ? "border-success-300 bg-success-50 text-success-800"
              : "border-warning-300 bg-warning-50 text-warning-800")
          }
        >
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <div className="flex-1">
            {currentYearStatus?.include_in_global ? (
              <>
                Catatan tahun <strong>{currentYear}</strong> sedang{" "}
                <strong>IKUT</strong> hitungan global (dashboard &amp; laporan).
              </>
            ) : (
              <>
                Catatan tahun <strong>{currentYear}</strong>{" "}
                <strong>tidak</strong> ikut hitungan global. Catatan di sini
                jadi <em>side ledger</em> -- tidak menyentuh saldo kas /
                beban di laporan utama.
              </>
            )}{" "}
            <Link
              to="/settings/non-project"
              className="underline font-medium hover:text-ink-900"
            >
              Atur inklusi per tahun &rarr;
            </Link>
          </div>
        </div>

        {/* Company selector kalau >1 */}
        {companies.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wider text-ink-500 shrink-0">
              Perusahaan
            </span>
            <div className="w-64">
              <Select
                value={String(selectedCompanyId ?? "")}
                onChange={(e) => {
                  setSelectedCompanyId(Number(e.target.value) || null)
                  setPage(1)
                }}
              >
                {companies.map((c) => (
                  <option key={c.company_id} value={c.company_id}>
                    {c.company_name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        )}

        {/* Summary di-page */}
        <SummaryCardGrid>
          <SummaryCard
            icon={ArrowDownLeft}
            label="Masuk (halaman ini)"
            value={fmtCompact(sumIn)}
            hint={fmtIDR(sumIn)}
            tone="success"
          />
          <SummaryCard
            icon={ArrowUpRight}
            label="Keluar (halaman ini)"
            value={fmtCompact(sumOut)}
            hint={fmtIDR(sumOut)}
            tone="danger"
          />
          <SummaryCard
            icon={Wallet}
            label="Saldo (halaman ini)"
            value={fmtCompact(balance)}
            hint={fmtIDR(balance)}
            tone={balance >= 0 ? "success" : "danger"}
          />
          <SummaryCard
            label="Total Catatan"
            value={String(total)}
            hint={total > 0 ? "tervalidasi & draft" : "belum ada catatan"}
            tone="neutral"
          />
        </SummaryCardGrid>

        {/* List */}
        <div className="rounded-md bg-surface md:bg-transparent">
          <AdaptiveDataView
            data={items}
            isLoading={txQuery.isLoading}
            columns={columns}
            onItemClick={(t) => setSelectedId(t.id)}
            emptyState={
              <EmptyState
                icon={Notebook}
                title="Belum ada catatan non-proyek"
                description={
                  lockedProjectId
                    ? "Catat pengeluaran/pemasukan yang tidak terkait proyek konstruksi."
                    : "Pilih perusahaan dulu."
                }
                actionLabel={lockedProjectId ? "Tambah Catatan" : undefined}
                onAction={
                  lockedProjectId
                    ? () => {
                        setEditTarget(null)
                        setFormOpen(true)
                      }
                    : undefined
                }
                tone="neutral"
              />
            }
            renderCard={(t) => (
              <TransactionCard
                transaction={t}
                projectName="Catatan Non-Proyek"
                categoryName={
                  t.category_id ? categoryMap.get(t.category_id)?.name : undefined
                }
                onClick={() => setSelectedId(t.id)}
              />
            )}
          />
          {bp !== "mobile" && total > 0 && (
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
          {bp === "mobile" && total > size && (
            <div className="flex justify-center py-4">
              <Button
                variant="secondary"
                onClick={() => setSize((s) => s + 50)}
                disabled={items.length >= total}
              >
                Muat lebih banyak
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Mobile FAB */}
      {lockedProjectId && (
        <Button
          size="icon"
          className="sm:hidden fixed bottom-[calc(64px+env(safe-area-inset-bottom)+12px)] right-4 z-30 h-14 w-14 rounded-full shadow-lg"
          aria-label="Tambah catatan"
          onClick={() => {
            setEditTarget(null)
            setFormOpen(true)
          }}
        >
          <Plus className="h-6 w-6" />
        </Button>
      )}

      {/* Detail sheet */}
      {bp === "mobile" ? (
        <DraggableSheet
          open={detailOpen}
          onOpenChange={(o) => !o && closeDetail()}
          title="Detail Catatan"
          maxHeight="92vh"
          footer={
            detailQuery.data && (
              <TransactionActions
                transaction={detailQuery.data}
                onEdit={() => {
                  setEditTarget(detailQuery.data!)
                  setSelectedId(null)
                  setFormOpen(true)
                }}
                onAfterDestroy={closeDetail}
              />
            )
          }
        >
          <TransactionDetail
            transaction={detailQuery.data}
            isLoading={detailQuery.isLoading}
            project={detailQuery.data ? projectMap.get(detailQuery.data.project_id) : undefined}
            category={
              detailQuery.data?.category_id
                ? categoryMap.get(detailQuery.data.category_id)
                : undefined
            }
          />
        </DraggableSheet>
      ) : (
        <Sheet open={detailOpen} onOpenChange={(open) => !open && closeDetail()}>
          <SheetContent side="right" className="w-full sm:max-w-md flex flex-col p-0">
            <SheetHeader className="border-b">
              <SheetTitle>Detail Catatan</SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto">
              <TransactionDetail
                transaction={detailQuery.data}
                isLoading={detailQuery.isLoading}
                project={detailQuery.data ? projectMap.get(detailQuery.data.project_id) : undefined}
                category={
                  detailQuery.data?.category_id
                    ? categoryMap.get(detailQuery.data.category_id)
                    : undefined
                }
              />
            </div>
            {detailQuery.data && (
              <TransactionActions
                transaction={detailQuery.data}
                onEdit={() => {
                  setEditTarget(detailQuery.data!)
                  setSelectedId(null)
                  setFormOpen(true)
                }}
                onAfterDestroy={closeDetail}
              />
            )}
          </SheetContent>
        </Sheet>
      )}

      {/* Form sheet -- lock project_id ke system NP project */}
      <TransactionForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false)
          setEditTarget(null)
        }}
        transaction={editTarget}
        lockProjectId={lockedProjectId}
        allowNonProject
        onSaved={(saved) => setSelectedId(saved.id)}
      />
    </>
  )
}
