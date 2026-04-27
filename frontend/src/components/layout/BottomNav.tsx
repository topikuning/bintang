import { NavLink } from "react-router-dom";
import { LayoutDashboard, Receipt, FileText, Folder, Menu } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { to: "/", icon: LayoutDashboard, label: "Beranda", end: true },
  { to: "/projects", icon: Folder, label: "Proyek" },
  { to: "/transactions", icon: Receipt, label: "Transaksi" },
  { to: "/invoices", icon: FileText, label: "Invoice" },
  { to: "/more", icon: Menu, label: "Lainnya" },
];

export default function BottomNav() {
  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-3xl">
        {items.map(({ to, icon: Icon, label, end }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "flex flex-col items-center justify-center gap-0.5 py-2.5 text-[11px]",
                  isActive ? "text-slate-900" : "text-slate-400",
                )
              }
            >
              <Icon className="h-5 w-5" />
              <span>{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
