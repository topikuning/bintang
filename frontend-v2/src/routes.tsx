import { lazy, Suspense } from "react"
import { createBrowserRouter, Navigate } from "react-router-dom"
import { AppShell } from "@/components/layout/AppShell"
import { RequireAuth } from "@/components/auth/RequireAuth"
import { LoginPage } from "@/pages/Login"
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
const AuditLogPage = lazy(() =>
  import("@/pages/AuditLog").then((m) => ({ default: m.AuditLogPage })),
)
const ProjectsPage = lazy(() =>
  import("@/pages/master/ProjectsPage").then((m) => ({ default: m.ProjectsPage })),
)
const ProjectDetailPage = lazy(() =>
  import("@/pages/master/ProjectDetailPage").then((m) => ({
    default: m.ProjectDetailPage,
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

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="/dashboard" replace /> },
          { path: "dashboard", element: <L><DashboardPage /></L> },
          { path: "transactions", element: <L><TransactionsListPage /></L> },
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
          { path: "audit-log", element: <L><AuditLogPage /></L> },
          { path: "master/projects", element: <L><ProjectsPage /></L> },
          { path: "master/projects/:id", element: <L><ProjectDetailPage /></L> },
          { path: "imports", element: <L><ImportsPage /></L> },
          { path: "ocr", element: <L><OcrPage /></L> },
          { path: "master/companies", element: <L><CompaniesPage /></L> },
          { path: "master/categories", element: <L><CategoriesPage /></L> },
          { path: "master/vendors-clients", element: <L><VendorsPage /></L> },
          { path: "master/users", element: <L><UsersPage /></L> },
          { path: "settings", element: <L><SettingsPage /></L> },
          { path: "more", element: <L><MorePage /></L> },
        ],
      },
    ],
  },
  { path: "*", element: <Navigate to="/dashboard" replace /> },
])
