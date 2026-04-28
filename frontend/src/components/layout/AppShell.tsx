import { Outlet, useNavigate } from "react-router-dom";
import BottomNav from "./BottomNav";
import { Plus } from "lucide-react";
import { canWrite, useAuthStore } from "@/store/auth";

export default function AppShell() {
  const nav = useNavigate();
  const user = useAuthStore((s) => s.user);
  return (
    <div className="min-h-screen bg-slate-50">
      <main className="mx-auto max-w-3xl px-3 pt-3 pb-28">
        <Outlet />
      </main>

      {canWrite(user) && (
        <button
          onClick={() => nav("/transactions/new")}
          aria-label="Tambah Transaksi"
          className="fixed bottom-20 right-4 z-30 grid h-14 w-14 place-items-center rounded-full bg-slate-900 text-white shadow-lg active:scale-95"
        >
          <Plus className="h-6 w-6" />
        </button>
      )}

      <BottomNav />
    </div>
  );
}
