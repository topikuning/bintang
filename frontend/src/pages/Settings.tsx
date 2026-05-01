import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Copy,
  Loader2,
  MessageCircle,
  Phone,
  QrCode,
  RefreshCw,
  Unlink,
} from "lucide-react";
import PageHeader from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/api";
import { isAdmin, useAuthStore } from "@/store/auth";

interface ChannelStatus {
  linked: boolean;
  enabled: boolean;
  configured?: boolean;
}

interface LinkCode {
  code: string;
  expires_at: string;
  ttl_minutes: number;
  already_linked: boolean;
}

interface MessagingConfig {
  telegram_enabled: boolean;
  whatsapp_enabled: boolean;
  telegram_configured: boolean;
  whatsapp_configured: boolean;
  whatsapp_base_url: string | null;
  whatsapp_session: string | null;
}

interface WahaSession {
  status?: string;
  me?: { id?: string; pushName?: string };
  engine?: string;
}

export default function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const admin = isAdmin(user);

  return (
    <div>
      <PageHeader back title="Pengaturan" />

      <Card>
        <div className="text-sm font-semibold mb-2">Profil</div>
        <div className="text-sm">{user?.name}</div>
        <div className="text-xs text-slate-500">{user?.email}</div>
        <div className="text-xs text-slate-500">{user?.role}</div>
      </Card>

      {admin && <MessagingConfigCard />}
      <TelegramCard />
      <WhatsAppCard admin={admin} />

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

// ---------------------------------------------------------------------------
// Master toggle (admin only)
// ---------------------------------------------------------------------------

function MessagingConfigCard() {
  const qc = useQueryClient();
  const cfg = useQuery({
    queryKey: ["messaging-config"],
    queryFn: async () => (await api.get<MessagingConfig>("/messaging/config")).data,
  });

  const patch = useMutation({
    mutationFn: async (body: Partial<Pick<MessagingConfig, "telegram_enabled" | "whatsapp_enabled">>) =>
      (await api.patch<MessagingConfig>("/messaging/config", body)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["messaging-config"] });
      qc.invalidateQueries({ queryKey: ["telegram-status"] });
      qc.invalidateQueries({ queryKey: ["whatsapp-status"] });
    },
  });

  const c = cfg.data;

  return (
    <Card className="mt-3">
      <div className="text-sm font-semibold mb-2">Integrasi Pesan</div>
      <div className="text-xs text-slate-500 mb-3">
        Hidupkan/matikan saluran notifikasi tanpa redeploy. Detail koneksi
        (token, server) di-set lewat env Railway.
      </div>

      {!c ? (
        <div className="text-xs text-slate-400 italic">Memuat…</div>
      ) : (
        <div className="space-y-3">
          <ToggleRow
            label="Telegram"
            configured={c.telegram_configured}
            enabled={c.telegram_enabled}
            disabled={patch.isPending}
            onChange={(v) => patch.mutate({ telegram_enabled: v })}
            unconfiguredHint="TELEGRAM_BOT_TOKEN belum di-set."
          />
          <ToggleRow
            label="WhatsApp (WAHA)"
            configured={c.whatsapp_configured}
            enabled={c.whatsapp_enabled}
            disabled={patch.isPending}
            onChange={(v) => patch.mutate({ whatsapp_enabled: v })}
            unconfiguredHint="WHATSAPP_BASE_URL belum di-set."
            extra={
              c.whatsapp_configured && (
                <div className="text-[11px] text-slate-500 mt-1">
                  Server: <code>{c.whatsapp_base_url}</code> · session{" "}
                  <code>{c.whatsapp_session}</code>
                </div>
              )
            }
          />
        </div>
      )}
    </Card>
  );
}

function ToggleRow({
  label,
  enabled,
  configured,
  disabled,
  onChange,
  unconfiguredHint,
  extra,
}: {
  label: string;
  enabled: boolean;
  configured: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  unconfiguredHint?: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium">{label}</div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          disabled={!configured || disabled}
          onClick={() => onChange(!enabled)}
          className={[
            "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors",
            !configured ? "bg-slate-200 cursor-not-allowed" : enabled ? "bg-emerald-500" : "bg-slate-300",
          ].join(" ")}
        >
          <span
            className={[
              "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
              enabled ? "translate-x-5" : "translate-x-0.5",
            ].join(" ")}
          />
        </button>
      </div>
      {!configured && unconfiguredHint && (
        <div className="text-[11px] text-slate-500 italic mt-1">{unconfiguredHint}</div>
      )}
      {extra}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Telegram link card (per-user)
// ---------------------------------------------------------------------------

function TelegramCard() {
  const qc = useQueryClient();
  const tgStatusQ = useQuery({
    queryKey: ["telegram-status"],
    queryFn: async () => (await api.get<ChannelStatus>("/telegram/me/status")).data,
  });

  const [code, setCode] = useState<LinkCode | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

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
    mutationFn: async () => (await api.post<LinkCode>("/telegram/me/link-code")).data,
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
          Integrasi Telegram belum aktif (token belum di-set atau toggle dimatikan
          admin).
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
              <Button size="sm" onClick={() => issue.mutate()} disabled={issue.isPending}>
                {issue.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Buat Kode Tautan
              </Button>
            </>
          )}
          {code && (
            <LinkCodeBox
              code={code}
              secondsLeft={secondsLeft}
              onRegen={() => issue.mutate()}
              instructions={
                <>
                  1. Buka chat dengan bot Bintang di Telegram.<br />
                  2. Kirim: <code>/link {code.code}</code><br />
                  3. Selesai. Akun langsung tertaut.
                </>
              }
            />
          )}
          {issue.isError && (
            <div className="mt-2 text-xs text-rose-600">
              Gagal membuat kode. Coba lagi.
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// WhatsApp link card (per-user) + admin session controls
// ---------------------------------------------------------------------------

function WhatsAppCard({ admin }: { admin: boolean }) {
  const qc = useQueryClient();
  const statusQ = useQuery({
    queryKey: ["whatsapp-status"],
    queryFn: async () => (await api.get<ChannelStatus>("/whatsapp/me/status")).data,
  });

  const sessionQ = useQuery({
    queryKey: ["whatsapp-session"],
    queryFn: async () => (await api.get<WahaSession>("/whatsapp/session")).data,
    enabled: admin && !!statusQ.data?.configured,
    refetchInterval: 8000,
    retry: false,
  });

  const [code, setCode] = useState<LinkCode | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [showQR, setShowQR] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);

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

  // QR code: fetch sebagai blob (perlu Authorization Bearer) lalu object URL.
  // Refresh tiap 10 detik selama panel terbuka, supaya tidak basi.
  useEffect(() => {
    if (!showQR) {
      if (qrUrl) URL.revokeObjectURL(qrUrl);
      setQrUrl(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const r = await api.get<Blob>("/whatsapp/qr", { responseType: "blob" });
        if (cancelled) return;
        const url = URL.createObjectURL(r.data);
        setQrUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
      } catch {
        // sembunyikan diam-diam — biasanya status sudah berubah
      }
    };
    load();
    const id = window.setInterval(load, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [showQR]);

  const issue = useMutation({
    mutationFn: async () => (await api.post<LinkCode>("/whatsapp/me/link-code")).data,
    onSuccess: (d) => setCode(d),
  });

  const unlink = useMutation({
    mutationFn: async () => api.post("/whatsapp/me/unlink"),
    onSuccess: () => {
      setCode(null);
      qc.invalidateQueries({ queryKey: ["whatsapp-status"] });
    },
  });

  const restart = useMutation({
    mutationFn: async () => api.post("/whatsapp/restart"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp-session"] }),
  });

  const logout = useMutation({
    mutationFn: async () => api.post("/whatsapp/logout"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp-session"] }),
  });

  const linked = !!statusQ.data?.linked;
  const enabled = !!statusQ.data?.enabled;
  const configured = !!statusQ.data?.configured;
  const sessStatus = sessionQ.data?.status;

  return (
    <Card className="mt-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold flex items-center gap-2">
          <Phone className="h-4 w-4 text-emerald-600" />
          Hubungkan WhatsApp
        </div>
        {linked && (
          <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
            Terhubung
          </span>
        )}
      </div>

      {!configured ? (
        <div className="text-xs text-slate-500 italic">
          Integrasi WhatsApp belum di-konfigurasi (<code>WHATSAPP_BASE_URL</code> kosong).
        </div>
      ) : !enabled ? (
        <div className="text-xs text-slate-500 italic">
          Integrasi WhatsApp dimatikan oleh admin di toggle &quot;Integrasi
          Pesan&quot; di atas.
        </div>
      ) : (
        <>
          {admin && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 mb-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <div>
                  <div className="text-slate-500">Status sesi WAHA</div>
                  <div className="font-semibold">
                    <SessionBadge status={sessStatus} />
                  </div>
                  {sessionQ.data?.me?.id && (
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      No. terdaftar: <code>{sessionQ.data.me.id}</code>
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  {sessStatus === "SCAN_QR_CODE" && (
                    <Button size="sm" onClick={() => setShowQR((v) => !v)}>
                      <QrCode className="h-4 w-4" />
                      {showQR ? "Sembunyikan QR" : "Tampilkan QR"}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => restart.mutate()}
                    disabled={restart.isPending}
                  >
                    <RefreshCw className="h-4 w-4" /> Restart sesi
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (confirm("Logout sesi WAHA? Perlu scan QR ulang.")) logout.mutate();
                    }}
                    disabled={logout.isPending}
                  >
                    Logout
                  </Button>
                </div>
              </div>
              {showQR && sessStatus === "SCAN_QR_CODE" && (
                <div className="grid place-items-center bg-white rounded p-2">
                  {qrUrl ? (
                    <img
                      src={qrUrl}
                      alt="WAHA QR"
                      className="h-56 w-56 object-contain"
                    />
                  ) : (
                    <div className="h-56 w-56 grid place-items-center text-xs text-slate-400">
                      <Loader2 className="h-5 w-5 animate-spin" />
                    </div>
                  )}
                  <div className="text-[11px] text-slate-500 mt-1">
                    Scan dari WhatsApp → Linked devices → Link a device.
                  </div>
                </div>
              )}
            </div>
          )}

          {linked ? (
            <div>
              <div className="text-xs text-slate-600 mb-2">
                Akun ini sudah terhubung ke bot WhatsApp. Pakai perintah{" "}
                <code>/saldo</code>, <code>/keluar</code>, dst lewat WhatsApp.
              </div>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  if (confirm("Putuskan koneksi WhatsApp?")) unlink.mutate();
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
                    Hubungkan akun ini ke bot WhatsApp supaya bisa kirim/baca data
                    via WA.
                  </div>
                  <Button size="sm" onClick={() => issue.mutate()} disabled={issue.isPending}>
                    {issue.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                    Buat Kode Tautan
                  </Button>
                </>
              )}
              {code && (
                <LinkCodeBox
                  code={code}
                  secondsLeft={secondsLeft}
                  onRegen={() => issue.mutate()}
                  instructions={
                    <>
                      1. Buka WhatsApp → chat ke nomor bot Bintang.<br />
                      2. Kirim: <code>/link {code.code}</code><br />
                      3. Selesai. Akun langsung tertaut.
                    </>
                  }
                />
              )}
              {issue.isError && (
                <div className="mt-2 text-xs text-rose-600">
                  Gagal membuat kode. Coba lagi.
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function SessionBadge({ status }: { status?: string }) {
  if (!status) return <span className="text-slate-400">Tidak diketahui</span>;
  const map: Record<string, { label: string; cls: string }> = {
    WORKING: { label: "✅ Aktif", cls: "text-emerald-700" },
    SCAN_QR_CODE: { label: "⚠️ Scan QR", cls: "text-amber-700" },
    STARTING: { label: "⏳ Starting", cls: "text-slate-700" },
    STOPPED: { label: "⏹ Berhenti", cls: "text-slate-700" },
    FAILED: { label: "❌ Gagal", cls: "text-rose-700" },
  };
  const it = map[status] ?? { label: status, cls: "text-slate-700" };
  return <span className={it.cls}>{it.label}</span>;
}

function LinkCodeBox({
  code,
  secondsLeft,
  onRegen,
  instructions,
}: {
  code: LinkCode;
  secondsLeft: number;
  onRegen: () => void;
  instructions: React.ReactNode;
}) {
  return (
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
      <div className="text-[11px] text-slate-600 mt-2 leading-relaxed">{instructions}</div>
      <div className="mt-2 text-[11px] text-slate-500">
        Kadaluwarsa dalam{" "}
        <b>
          {Math.floor(secondsLeft / 60)}m {secondsLeft % 60}s
        </b>
        {secondsLeft <= 0 && " (sudah expired, generate ulang)"}
      </div>
      <button type="button" className="text-[11px] text-sky-600 mt-1 underline" onClick={onRegen}>
        Generate kode baru
      </button>
    </div>
  );
}
