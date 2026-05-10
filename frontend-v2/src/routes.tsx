import { createBrowserRouter, Navigate } from "react-router-dom"
import { AppShell } from "@/components/layout/AppShell"
import { RequireAuth } from "@/components/auth/RequireAuth"
import { DashboardPage } from "@/pages/Dashboard"
import { InvoicesListPage } from "@/pages/invoices/InvoicesListPage"
import { LoginPage } from "@/pages/Login"
import { CategoriesPage } from "@/pages/master/CategoriesPage"
import { CompaniesPage } from "@/pages/master/CompaniesPage"
import { ProjectsPage } from "@/pages/master/ProjectsPage"
import { UsersPage } from "@/pages/master/UsersPage"
import { VendorsPage } from "@/pages/master/VendorsPage"
import { AuditLogPage } from "@/pages/AuditLog"
import { MorePage } from "@/pages/More"
import { Placeholder } from "@/pages/Placeholder"
import { POListPage } from "@/pages/purchase-orders/POListPage"
import { ReportsPage } from "@/pages/Reports"
import { SettingsPage } from "@/pages/Settings"
import { TransactionsListPage } from "@/pages/transactions/TransactionsListPage"

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="/dashboard" replace /> },
          { path: "dashboard", element: <DashboardPage /> },
          { path: "transactions", element: <TransactionsListPage /> },
          { path: "invoices", element: <InvoicesListPage /> },
          { path: "purchase-orders", element: <POListPage /> },
          {
            path: "budget",
            element: (
              <Placeholder
                title="Budget vs Actual"
                description="Realisasi anggaran per kategori & proyek."
              />
            ),
          },
          { path: "reports", element: <ReportsPage /> },
          { path: "audit-log", element: <AuditLogPage /> },
          { path: "master/projects", element: <ProjectsPage /> },
          { path: "master/companies", element: <CompaniesPage /> },
          { path: "master/categories", element: <CategoriesPage /> },
          { path: "master/vendors-clients", element: <VendorsPage /> },
          { path: "master/users", element: <UsersPage /> },
          { path: "settings", element: <SettingsPage /> },
          { path: "more", element: <MorePage /> },
        ],
      },
    ],
  },
  { path: "*", element: <Navigate to="/dashboard" replace /> },
])
