import { createBrowserRouter, Navigate } from "react-router-dom"
import { AppShell } from "@/components/layout/AppShell"
import { RequireAuth } from "@/components/auth/RequireAuth"
import { LoginPage } from "@/pages/Login"
import { Placeholder } from "@/pages/Placeholder"
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
          {
            path: "dashboard",
            element: <Placeholder title="Dashboard" description="Ringkasan multi-proyek akan tampil di sini." />,
          },
          {
            path: "transactions",
            element: <TransactionsListPage />,
          },
          {
            path: "invoices",
            element: <Placeholder title="Invoice" description="Hutang & piutang dengan tracking pembayaran." />,
          },
          {
            path: "purchase-orders",
            element: <Placeholder title="Purchase Order" description="PO dengan approval & cetak." />,
          },
          {
            path: "budget",
            element: <Placeholder title="Budget vs Actual" description="Realisasi anggaran per kategori & proyek." />,
          },
          {
            path: "reports",
            element: <Placeholder title="Laporan" description="Cashflow, transaksi, invoice, hutang-piutang, budget, PO, audit." />,
          },
          {
            path: "audit-log",
            element: <Placeholder title="Audit Log" description="Riwayat aktivitas semua user." />,
          },
          {
            path: "master/projects",
            element: <Placeholder title="Proyek" description="Daftar dan kelola proyek." />,
          },
          {
            path: "master/companies",
            element: <Placeholder title="Perusahaan" />,
          },
          {
            path: "master/categories",
            element: <Placeholder title="Kategori" />,
          },
          {
            path: "master/vendors-clients",
            element: <Placeholder title="Vendor & Klien" />,
          },
          {
            path: "master/users",
            element: <Placeholder title="Pengguna" />,
          },
          {
            path: "settings",
            element: <Placeholder title="Pengaturan" description="Profil, preferensi tampilan, default proyek." />,
          },
          {
            path: "more",
            element: <Placeholder title="Menu Lainnya" description="Halaman tambahan untuk mobile." />,
          },
        ],
      },
    ],
  },
  { path: "*", element: <Navigate to="/dashboard" replace /> },
])
