import { Link, useNavigate } from "react-router-dom";
import PageHeader from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { useAuthStore, isSuper } from "@/store/auth";
import {
  Building2,
  Users,
  Tags,
  ClipboardList,
  FileBarChart2,
  ShieldCheck,
  ScrollText,
  LogOut,
  Settings as SettingsIcon,
  Sparkles,
} from "lucide-react";

const items = [
  { to: "/companies", icon: Building2, label: "Perusahaan" },
  { to: "/categories", icon: Tags, label: "Kategori Transaksi" },
  { to: "/vendors-clients", icon: Users, label: "Vendor & Client" },
  { to: "/purchase-orders", icon: ClipboardList, label: "Purchase Order" },
  { to: "/reports", icon: FileBarChart2, label: "Laporan" },
];

const adminOnly = [
  { to: "/users", icon: ShieldCheck, label: "Pengguna" },
  { to: "/audit-logs", icon: ScrollText, label: "Audit Log" },
];

export default function MorePage() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const nav = useNavigate();
  const all = [...items, ...(isSuper(user) ? adminOnly : [])];
  return (
    <div>
      <PageHeader title="Menu Lainnya" subtitle={user ? `${user.name} · ${user.role}` : ""} />
      <Card className="mb-3 !p-3 flex items-center gap-3">
        <Sparkles className="h-5 w-5 text-amber-500" />
        <div className="text-sm">
          <div className="font-semibold">AI Invoice Extraction</div>
          <div className="text-[11px] text-slate-500">Future-ready (OCR adapter aktif sebagai stub)</div>
        </div>
      </Card>
      <div className="grid grid-cols-2 gap-2.5">
        {all.map((it) => (
          <Link key={it.to} to={it.to}>
            <Card className="!p-4 active:bg-slate-50">
              <it.icon className="h-5 w-5 mb-2 text-slate-700" />
              <div className="font-medium text-sm">{it.label}</div>
            </Card>
          </Link>
        ))}
        <Link to="/settings">
          <Card className="!p-4 active:bg-slate-50">
            <SettingsIcon className="h-5 w-5 mb-2 text-slate-700" />
            <div className="font-medium text-sm">Pengaturan</div>
          </Card>
        </Link>
        <button
          onClick={() => { logout(); nav("/login"); }}
          className="text-left"
        >
          <Card className="!p-4 active:bg-slate-50">
            <LogOut className="h-5 w-5 mb-2 text-rose-600" />
            <div className="font-medium text-sm text-rose-600">Keluar</div>
          </Card>
        </button>
      </div>
    </div>
  );
}
