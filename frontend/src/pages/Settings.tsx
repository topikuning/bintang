import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Loader2, MessageCircle, Unlink } from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";

interface TelegramStatus {
  linked: boolean;
  enabled: boolean;
}

interface LinkCode {
  code: string;
  expires_at: string;
  ttl_minutes: number;
  already_linked: boolean;
}

export default function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();

  const tgStatusQ = useQuery({
    queryKey: ["telegram-status"],
    queryFn: async () => (await api.get<TelegramStatus>("/telegram/me/status")).data,
  });

  const [code, setCode] = useState<LinkCode | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  // countdown saat kode aktif
  useEffect(() => {
    if (!code) return;
    const tick = () => {
      const ms = new Date(code.expires_at).getTime() - Date.now();
      setSecondsLeft(Math.max(0, Math.ceil(ms / 1000)));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [code]);

  const issue = useMutation({
    mutationFn: async () =>
      (await api.post<LinkCode>("/telegram/me/link-code")).data,
    onSuccess: (d) => setCode(d),
  });

  const unlink = useMutation({
    mutationFn: async () => api.post("/telegram/me/unlink"),
    onSuccess: () => {
      setCode(null);
      qc.invalidateQueries({ queryKey: ["telegram-status"] });
    },
  });

  const linked = !!tgStatusQ.data?.linked;
  const enabled = !!tgStatusQ.data?.enabled;

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
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-sky-600" />
            Hubungkan Telegram
          </div>
          {linked && (
            <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
              Terhubung
            </span>
          )}
        </div>

        {!enabled ? (
          <div className="text-xs text-slate-500 italic">
            Integrasi Telegram belum di-aktifkan oleh admin
            (<code>TELEGRAM_BOT_TOKEN</code> belum di-set).
          </div>
        ) : linked ? (
          <div>
            <div className="text-xs text-slate-600 mb-2">
              Akun ini sudah terhubung ke bot Telegram. Kamu bisa pakai
              perintah <code>/saldo</code>, <code>/keluar</code>, dan lainnya
              dari aplikasi Telegram.
            </div>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                if (confirm("Putuskan koneksi Telegram?")) unlink.mutate();
              }}
              disabled={unlink.isPending}
            >
              {unlink.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              <Unlink className="h-4 w-4" /> Putuskan
            </Button>
          </div>
        ) : (
          <div>
            {!code && (
              <>
                <div className="text-xs text-slate-600 mb-2">
                  Hubungkan akun ini ke bot supaya bisa kirim/baca data via
                  Telegram.
                </div>
                <Button
                  size="sm"
                  onClick={() => issue.mutate()}
                  disabled={issue.isPending}
                >
                  {issue.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Buat Kode Tautan
                </Button>
              </>
            )}
            {code && (
              <div className="rounded-xl border border-sky-200 bg-sky-50 p-3">
                <div className="text-[11px] uppercase font-semibold text-sky-700 mb-1">
                  Kode Tautan
                </div>
                <div className="flex items-center gap-2">
                  <div className="font-mono text-2xl font-bold tracking-[6px] text-slate-900">
                    {code.code}
                  </div>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard?.writeText(code.code)}
                    className="grid h-8 w-8 place-items-center rounded-full bg-white border border-sky-200 text-sky-600"
                    aria-label="Salin"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                </div>
                <div className="text-[11px] text-slate-600 mt-2 leading-relaxed">
                  1. Buka chat dengan bot Bintang di Telegram.<br />
                  2. Kirim: <code>/link {code.code}</code><br />
                  3. Selesai. Akun langsung tertaut.
                </div>
                <div className="mt-2 text-[11px] text-slate-500">
                  Kadaluwarsa dalam{" "}
                  <b>
                    {Math.floor(secondsLeft / 60)}m {secondsLeft % 60}s
                  </b>
                  {secondsLeft <= 0 && " (sudah expired, generate ulang)"}
                </div>
                <button
                  type="button"
                  className="text-[11px] text-sky-600 mt-1 underline"
                  onClick={() => issue.mutate()}
                >
                  Generate kode baru
                </button>
              </div>
            )}
            {issue.isError && (
              <div className="mt-2 text-xs text-rose-600">
                Gagal membuat kode. Coba lagi.
              </div>
            )}
          </div>
        )}
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
