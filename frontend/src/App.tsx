import { Navigate, Route, Routes } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import LoginPage from "@/pages/Login";
import AppShell from "@/components/layout/AppShell";
import DashboardGlobal from "@/pages/DashboardGlobal";
import DashboardProject from "@/pages/DashboardProject";
import ProjectsPage from "@/pages/Projects";
import CompaniesPage from "@/pages/Companies";
import CategoriesPage from "@/pages/Categories";
import VendorsPage from "@/pages/Vendors";
import UsersPage from "@/pages/Users";
import TransactionsPage from "@/pages/Transactions";
import TransactionForm from "@/pages/TransactionForm";
import InvoicesPage from "@/pages/Invoices";
import InvoiceForm from "@/pages/InvoiceForm";
import POPage from "@/pages/PurchaseOrders";
import POForm from "@/pages/PurchaseOrderForm";
import ReportsPage from "@/pages/Reports";
import AuditLogPage from "@/pages/AuditLog";
import SettingsPage from "@/pages/Settings";
import MorePage from "@/pages/More";

function Protected({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <Protected>
            <AppShell />
          </Protected>
        }
      >
        <Route index element={<DashboardGlobal />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:id" element={<DashboardProject />} />
        <Route path="transactions" element={<TransactionsPage />} />
        <Route path="transactions/new" element={<TransactionForm />} />
        <Route path="transactions/:id" element={<TransactionForm />} />
        <Route path="invoices" element={<InvoicesPage />} />
        <Route path="invoices/new" element={<InvoiceForm />} />
        <Route path="invoices/:id" element={<InvoiceForm />} />
        <Route path="purchase-orders" element={<POPage />} />
        <Route path="purchase-orders/new" element={<POForm />} />
        <Route path="purchase-orders/:id" element={<POForm />} />
        <Route path="companies" element={<CompaniesPage />} />
        <Route path="categories" element={<CategoriesPage />} />
        <Route path="vendors-clients" element={<VendorsPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="audit-logs" element={<AuditLogPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="more" element={<MorePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
