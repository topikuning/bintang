import { lazy, Suspense } from "react"
import { createBrowserRouter, Navigate, useParams } from "react-router-dom"
import { AppShell } from "@/components/layout/AppShell"
import { RequireAuth } from "@/components/auth/RequireAuth"
import { LoginPage } from "@/pages/Login"
import { RouteErrorBoundary } from "@/components/data/RouteErrorBoundary"
import { Skeleton } from "@/components/ui/skeleton"

// Lazy-load semua halaman -- pecah bundle per route. Login tidak
// di-lazy karena halaman pertama yg dibuka user; lazy hanya nambah
// flash saja.

const DashboardPage = lazy(() =>
  import("@/pages/Dashboard").then((m) => ({ default: m.DashboardPage })),
)
const TransactionsListPage = lazy(() =>
  import("@/pages/transactions/TransactionsListPage").then((m) => ({
    default: m.TransactionsListPage,
  })),
)
const CashAdvancePage = lazy(() =>
  import("@/pages/transactions/CashAdvancePage").then((m) => ({
    default: m.CashAdvancePage,
  })),
)
const InvoicesListPage = lazy(() =>
  import("@/pages/invoices/InvoicesListPage").then((m) => ({
    default: m.InvoicesListPage,
  })),
)
const POListPage = lazy(() =>
  import("@/pages/purchase-orders/POListPage").then((m) => ({
    default: m.POListPage,
  })),
)
const ReportsPage = lazy(() =>
  import("@/pages/Reports").then((m) => ({ default: m.ReportsPage })),
)
const InvoiceItemsReportPage = lazy(() =>
  import("@/pages/reports/InvoiceItemsReportPage").then((m) => ({
    default: m.InvoiceItemsReportPage,
  })),
)
const AuditLogPage = lazy(() =>
  import("@/pages/AuditLog").then((m) => ({ default: m.AuditLogPage })),
)
const ProjectsPage = lazy(() =>
  import("@/pages/master/ProjectsPage").then((m) => ({ default: m.ProjectsPage })),
)
const ProjectsHubPage = lazy(() =>
  import("@/pages/projects/ProjectsHubPage").then((m) => ({
    default: m.ProjectsHubPage,
  })),
)
const ProjectDashboardPage = lazy(() =>
  import("@/pages/projects/ProjectDashboardPage").then((m) => ({
    default: m.ProjectDashboardPage,
  })),
)
const ProposalQueuePage = lazy(() =>
  import("@/pages/projects/ProposalQueuePage").then((m) => ({
    default: m.ProposalQueuePage,
  })),
)
const ImportsPage = lazy(() =>
  import("@/pages/Imports").then((m) => ({ default: m.ImportsPage })),
)
const OcrPage = lazy(() =>
  import("@/pages/OcrPage").then((m) => ({ default: m.OcrPage })),
)
const CompaniesPage = lazy(() =>
  import("@/pages/master/CompaniesPage").then((m) => ({ default: m.CompaniesPage })),
)
const CategoriesPage = lazy(() =>
  import("@/pages/master/CategoriesPage").then((m) => ({ default: m.CategoriesPage })),
)
const VendorsPage = lazy(() =>
  import("@/pages/master/VendorsPage").then((m) => ({ default: m.VendorsPage })),
)
const FundersPage = lazy(() =>
  import("@/pages/master/FundersPage").then((m) => ({ default: m.FundersPage })),
)
const UsersPage = lazy(() =>
  import("@/pages/master/UsersPage").then((m) => ({ default: m.UsersPage })),
)
const SettingsPage = lazy(() =>
  import("@/pages/Settings").then((m) => ({ default: m.SettingsPage })),
)
const MorePage = lazy(() =>
  import("@/pages/More").then((m) => ({ default: m.MorePage })),
)
const Placeholder = lazy(() =>
  import("@/pages/Placeholder").then((m) => ({ default: m.Placeholder })),
)

/**
 * Page-level loading fallback. Menjaga visual stability supaya saat
 * lazy chunk loading user tetap melihat layout (skeleton), bukan
 * blank screen.
 */
function PageFallback() {
  return (
    <div className="flex flex-col gap-4 p-3 sm:p-5 lg:p-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-64" />
    </div>
  )
}

/** Wrap setiap lazy element dgn Suspense. */
function L({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageFallback />}>{children}</Suspense>
}

/** Redirect link lama /master/projects/:id ke /projects/:id (canonical). */
function RedirectMasterProject() {
  const { id } = useParams<{ id: string }>()
  return <Navigate to={`/projects/${id}`} replace />
}

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage />, errorElement: <RouteErrorBoundary /> },
  {
    element: <RequireAuth />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        element: <AppShell />,
        errorElement: <RouteErrorBoundary />,
        children: [
          { index: true, element: <Navigate to="/dashboard" replace /> },
          { path: "dashboard", element: <L><DashboardPage /></L> },
          { path: "transactions", element: <L><TransactionsListPage /></L> },
          { path: "transactions/cash-advances", element: <L><CashAdvancePage /></L> },
          { path: "invoices", element: <L><InvoicesListPage /></L> },
          { path: "purchase-orders", element: <L><POListPage /></L> },
          {
            path: "budget",
            element: (
              <L>
                <Placeholder
                  title="Budget vs Actual"
                  description="Realisasi anggaran per kategori & proyek."
                />
              </L>
            ),
          },
          { path: "reports", element: <L><ReportsPage /></L> },
          {
            path: "reports/invoice-items",
            element: <L><InvoiceItemsReportPage /></L>,
          },
          { path: "audit-log", element: <L><AuditLogPage /></L> },
          { path: "projects", element: <L><ProjectsHubPage /></L> },
          {
            path: "projects/approval-queue",
            element: <L><ProposalQueuePage /></L>,
          },
          { path: "projects/:id", element: <L><ProjectDashboardPage /></L> },
          { path: "master/projects", element: <L><ProjectsPage /></L> },
          {
            // Detail master proyek lama -> redirect ke canonical /projects/:id.
            // Kita keep route ini supaya bookmark / link lama tetap jalan.
            path: "master/projects/:id",
            element: <RedirectMasterProject />,
          },
          { path: "imports", element: <L><ImportsPage /></L> },
          { path: "ocr", element: <L><OcrPage /></L> },
          { path: "master/companies", element: <L><CompaniesPage /></L> },
          { path: "master/categories", element: <L><CategoriesPage /></L> },
          { path: "master/vendors-clients", element: <L><VendorsPage /></L> },
          { path: "master/funders", element: <L><FundersPage /></L> },
          { path: "master/users", element: <L><UsersPage /></L> },
          { path: "settings", element: <L><SettingsPage /></L> },
          { path: "more", element: <L><MorePage /></L> },
        ],
      },
    ],
  },
  { path: "*", element: <Navigate to="/dashboard" replace /> },
])
