import { lazy, Suspense } from "react"
import { createBrowserRouter, Navigate, useParams } from "react-router-dom"
import { AppShell } from "@/components/layout/AppShell"
import { RequireAuth } from "@/components/auth/RequireAuth"
import { LoginPage } from "@/pages/Login"
import { NotFoundPage } from "@/pages/NotFound"
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
const UsersPage = lazy(() =>
  import("@/pages/master/UsersPage").then((m) => ({ default: m.UsersPage })),
)
const SettingsPage = lazy(() =>
  import("@/pages/Settings").then((m) => ({ default: m.SettingsPage })),
)
const SystemSettingsPage = lazy(() =>
  import("@/pages/SystemSettingsPage").then((m) => ({
    default: m.SystemSettingsPage,
  })),
)
const RoleMenusPage = lazy(() =>
  import("@/pages/RoleMenusPage").then((m) => ({ default: m.RoleMenusPage })),
)
const OrphanFilesPage = lazy(() =>
  import("@/pages/OrphanFilesPage").then((m) => ({ default: m.OrphanFilesPage })),
)
const MorePage = lazy(() =>
  import("@/pages/More").then((m) => ({ default: m.MorePage })),
)
const BudgetPage = lazy(() =>
  import("@/pages/budget/BudgetPage").then((m) => ({ default: m.BudgetPage })),
)
const NonProjectPage = lazy(() =>
  import("@/pages/non-project/NonProjectPage").then((m) => ({
    default: m.NonProjectPage,
  })),
)
const NonProjectSettingsPage = lazy(() =>
  import("@/pages/non-project/NonProjectSettingsPage").then((m) => ({
    default: m.NonProjectSettingsPage,
  })),
)
const CashRequestsListPage = lazy(() =>
  import("@/pages/cash-requests/CashRequestsListPage").then((m) => ({
    default: m.CashRequestsListPage,
  })),
)
const CashRequestDetailPage = lazy(() =>
  import("@/pages/cash-requests/CashRequestDetailPage").then((m) => ({
    default: m.CashRequestDetailPage,
  })),
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
          { path: "budget", element: <L><BudgetPage /></L> },
          { path: "non-project", element: <L><NonProjectPage /></L> },
          { path: "settings/non-project", element: <L><NonProjectSettingsPage /></L> },
          { path: "cash-requests", element: <L><CashRequestsListPage /></L> },
          { path: "cash-requests/:id", element: <L><CashRequestDetailPage /></L> },
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
          {
            // Backward-compat: link lama /master/funders redirect ke
            // /master/users?role=EXECUTIVE (pendana sekarang user EXECUTIVE).
            path: "master/funders",
            element: <Navigate to="/master/users?role=EXECUTIVE" replace />,
          },
          { path: "master/users", element: <L><UsersPage /></L> },
          { path: "settings", element: <L><SettingsPage /></L> },
          { path: "settings/system", element: <L><SystemSettingsPage /></L> },
          { path: "settings/role-menus", element: <L><RoleMenusPage /></L> },
          { path: "settings/orphan-files", element: <L><OrphanFilesPage /></L> },
          { path: "more", element: <L><MorePage /></L> },
        ],
      },
    ],
  },
  // Catch-all 404 -- tampilkan NotFound (BUKAN silent redirect ke dashboard)
  // supaya user tahu URL-nya salah, bukan crash atau "mysteriously redirected".
  { path: "*", element: <NotFoundPage /> },
])
