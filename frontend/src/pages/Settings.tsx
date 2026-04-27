import PageHeader from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { useAuthStore } from "@/store/auth";

export default function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  return (
    <div>
      <PageHeader back title="Pengaturan" />
      <Card>
        <div className="text-sm font-semibold mb-2">Profil</div>
        <div className="text-sm">{user?.name}</div>
        <div className="text-xs text-slate-500">{user?.email}</div>
        <div className="text-xs text-slate-500">{user?.role}</div>
      </Card>
      <Card className="mt-3">
        <div className="text-sm font-semibold mb-1">Tentang Bintang</div>
        <div className="text-xs text-slate-600">
          Bintang - Biaya, Investasi dan Tata Anggaran Gerak. Aplikasi pencatatan dan
          monitoring keuangan multi-proyek dengan dashboard global, kontrol budget,
          invoice, dan purchase order. PWA mobile-first.
        </div>
      </Card>
    </div>
  );
}
