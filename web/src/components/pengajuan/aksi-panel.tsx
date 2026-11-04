"use client";

import {
  Ban,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  FilePen,
  RotateCcw,
  Send,
  Trash2,
  Undo2,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { Button, buttonClass, type ButtonVariant } from "@/components/ui/button";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { Field, Input, Textarea } from "@/components/ui/field";
import { FilePicker } from "@/components/ui/file-picker";
import { ActionFeedback, SubmitButton, ToastView } from "@/components/ui/form-bits";
import { Sheet } from "@/components/ui/lapisan";
import { Segmented } from "@/components/ui/tabs";
import type { ActionState } from "@/lib/aksi";
import { cn } from "@/lib/cn";
import * as act from "@/lib/pengajuan/actions";

type K = { boleh: boolean; alasan?: string };

export type AksiProps = {
  id: string;
  kind: "pembayaran" | "uang_muka" | "penggantian";
  status: string;
  totalLabel: string;
  payeeLabel: string;
  isRequester: boolean;
  today: string;
  requireProof: boolean;
  accounts: ComboOption[];
  k: {
    edit: K;
    hapus: K;
    batal: K;
    setujui: K;
    setujuiBayar: K;
    revisi: K;
    tolak: K;
    bayar: K;
    batalBayar: K;
    lpj: K;
    periksaLpj: K;
  };
  /** Hanya untuk LPJ: ringkasan selisih (sudah dihitung server). */
  lpj?: { arah: "pas" | "kembali" | "kurang"; jumlahLabel: string };
  approverNeeded?: string;
};

type Mode =
  | null
  | "setujui"
  | "setujuiBayar"
  | "revisi"
  | "tolak"
  | "batal"
  | "bayar"
  | "batalBayar"
  | "ajukan"
  | "hapus"
  | "terimaLpj"
  | "kembalikanLpj";

export function AksiPanel(p: AksiProps) {
  const [mode, setMode] = useState<Mode>(null);
  const [toast, setToast] = useState<{ pesan: string; at: number } | null>(null);
  const tutup = () => setMode(null);
  const berhasil = (pesan: string) => {
    setMode(null);
    const at = Date.now();
    setToast({ pesan, at });
    setTimeout(() => setToast((t) => (t?.at === at ? null : t)), 3500);
  };

  const { k } = p;
  let judul: string;
  let ket: ReactNode = null;
  let tone: "primary" | "warning" | "success" | "neutral" = "neutral";
  const tombol: ReactNode[] = [];
  const btn = (key: string, label: string, icon: ReactNode, m: Mode, variant: ButtonVariant = "secondary") =>
    tombol.push(
      <Button key={key} variant={variant} onClick={() => setMode(m)} className="flex-1 sm:flex-none">
        {icon}
        {label}
      </Button>,
    );

  switch (p.status) {
    case "draft":
      judul = "Draf – belum dikirim";
      ket = "Hanya Anda yang bisa melihat draf ini.";
      if (k.edit.boleh) {
        tombol.push(
          <Link key="ubah" href={`/pengajuan/${p.id}/ubah`} className={buttonClass("secondary", "md", "flex-1 sm:flex-none")}>
            <FilePen aria-hidden className="size-4" /> Lanjutkan isi
          </Link>,
        );
        btn("ajukan", "Ajukan sekarang", <Send aria-hidden className="size-4" />, "ajukan", "primary");
      }
      if (k.hapus.boleh) btn("hapus", "Hapus", <Trash2 aria-hidden className="size-4" />, "hapus", "ghost");
      break;
    case "diajukan":
      if (k.setujui.boleh) {
        tone = "primary";
        judul = "Menunggu persetujuan Anda";
        ket = `${p.totalLabel} untuk ${p.payeeLabel}. Periksa rincian & lampiran di bawah sebelum memutuskan.`;
        btn("setujui", "Setujui", <CheckCircle2 aria-hidden className="size-4" />, "setujui", "primary");
        if (k.setujuiBayar.boleh) btn("sb", "Setujui & bayar", <CircleDollarSign aria-hidden className="size-4" />, "setujuiBayar", "success");
        btn("revisi", "Minta revisi", <RotateCcw aria-hidden className="size-4" />, "revisi");
        btn("tolak", "Tolak", <XCircle aria-hidden className="size-4" />, "tolak");
      } else {
        tone = "warning";
        judul = "Menunggu persetujuan";
        ket = p.approverNeeded ?? (p.isRequester ? "Anda akan diberi tahu begitu ada keputusan." : k.setujui.alasan);
        if (k.batal.boleh && p.isRequester) btn("batal", "Batalkan pengajuan", <Ban aria-hidden className="size-4" />, "batal");
      }
      break;
    case "perlu_revisi":
      tone = "warning";
      judul = p.isRequester ? "Perlu Anda perbaiki" : "Dikembalikan ke pemohon";
      ket = p.isRequester ? "Baca catatan di riwayat, perbaiki, lalu kirim ulang." : "Menunggu pemohon memperbaiki.";
      if (k.edit.boleh) {
        tombol.push(
          <Link key="ubah" href={`/pengajuan/${p.id}/ubah`} className={buttonClass("primary", "md", "flex-1 sm:flex-none")}>
            <FilePen aria-hidden className="size-4" /> Perbaiki pengajuan
          </Link>,
        );
      }
      if (k.batal.boleh) btn("batal", "Batalkan", <Ban aria-hidden className="size-4" />, "batal");
      break;
    case "disetujui":
      if (k.bayar.boleh) {
        tone = "primary";
        judul = "Siap dibayar";
        ket = `Transfer ${p.totalLabel} ke ${p.payeeLabel}, lalu catat di sini.`;
        btn("bayar", "Tandai sudah dibayar", <CircleDollarSign aria-hidden className="size-4" />, "bayar", "success");
        if (k.revisi.boleh) btn("revisi", "Kembalikan", <RotateCcw aria-hidden className="size-4" />, "revisi");
        if (k.batal.boleh) btn("batal", "Batalkan", <Ban aria-hidden className="size-4" />, "batal");
      } else {
        tone = "primary";
        judul = "Disetujui – menunggu dibayar Keuangan";
        ket = "Anda akan diberi tahu begitu dana dikirim.";
      }
      break;
    case "dibayar":
      tone = "success";
      if (p.kind === "uang_muka") {
        judul = p.isRequester ? "Uang muka sudah diterima – ajukan LPJ" : "Dibayar – menunggu LPJ";
        ket = p.isRequester
          ? "Setelah dana terpakai, laporkan pemakaiannya beserta nota. Sisa uang dikembalikan, kekurangan dibayarkan."
          : "Pemegang uang muka belum melaporkan pemakaiannya.";
        if (k.lpj.boleh) {
          tombol.push(
            <Link key="lpj" href={`/pengajuan/${p.id}/lpj`} className={buttonClass("primary", "md", "flex-1 sm:flex-none")}>
              <ClipboardCheck aria-hidden className="size-4" /> Buat LPJ
            </Link>,
          );
        }
      } else {
        judul = "Sudah dibayar";
        ket = "Pengajuan selesai. Transaksi kasnya tercatat otomatis.";
      }
      if (k.batalBayar.boleh) btn("bb", "Batalkan pembayaran", <Undo2 aria-hidden className="size-4" />, "batalBayar", "ghost");
      break;
    case "lpj_diajukan":
      tone = "primary";
      judul = k.periksaLpj.boleh ? "LPJ menunggu pemeriksaan Anda" : "LPJ sedang diperiksa Keuangan";
      ket = p.lpj
        ? p.lpj.arah === "pas"
          ? "Pemakaian pas dengan uang muka."
          : p.lpj.arah === "kembali"
            ? `Ada sisa ${p.lpj.jumlahLabel} yang harus dikembalikan ke kas.`
            : `Pemakaian lebih ${p.lpj.jumlahLabel} – perlu dibayarkan ke pemegang uang muka.`
        : null;
      if (k.periksaLpj.boleh) {
        btn("terima", "Terima LPJ", <CheckCircle2 aria-hidden className="size-4" />, "terimaLpj", "primary");
        btn("kembali", "Kembalikan", <RotateCcw aria-hidden className="size-4" />, "kembalikanLpj");
      }
      break;
    case "selesai":
      tone = "success";
      judul = "Selesai";
      ket = "Uang muka sudah dipertanggungjawabkan.";
      break;
    case "ditolak":
      judul = "Ditolak";
      ket = "Lihat alasannya di riwayat. Ajukan baru bila masih diperlukan.";
      break;
    default:
      judul = "Dibatalkan";
  }

  const warna = {
    primary: "border-primary-200 bg-primary-50/70",
    warning: "border-warning-border bg-warning-soft",
    success: "border-success-border bg-success-soft",
    neutral: "border-border bg-surface",
  }[tone];

  return (
    <>
      <section className={cn("rounded-xl border p-4 sm:p-5", warna)} aria-label="Langkah berikutnya">
        <p className="text-sm font-semibold text-ink">{judul}</p>
        {ket ? <p className="mt-0.5 text-[13px] text-ink-muted">{ket}</p> : null}
        {tombol.length ? <div className="mt-3 flex flex-wrap gap-2">{tombol}</div> : null}
      </section>

      <AksiSheet
        open={mode === "setujui"}
        onClose={tutup}
        onOk={berhasil}
        title="Setujui pengajuan?"
        description={`${p.totalLabel} untuk ${p.payeeLabel}. Keuangan akan diberi tahu untuk membayar.`}
        action={act.setujuiPengajuan.bind(null, p.id)}
        submitLabel="Ya, setujui"
        note="optional"
        notePlaceholder="Catatan untuk pemohon/keuangan (opsional)"
      />
      <AksiSheet
        open={mode === "revisi"}
        onClose={tutup}
        onOk={berhasil}
        title="Minta pemohon memperbaiki"
        description="Pengajuan dikembalikan ke pemohon dan perlu disetujui ulang setelah diperbaiki."
        action={act.mintaRevisiPengajuan.bind(null, p.id)}
        submitLabel="Kembalikan"
        note="required"
        notePlaceholder="Apa yang perlu diperbaiki? mis. Lampirkan nota, nomor rekening salah…"
      />
      <AksiSheet
        open={mode === "tolak"}
        onClose={tutup}
        onOk={berhasil}
        title="Tolak pengajuan?"
        description="Pengajuan yang ditolak tidak bisa diajukan ulang – pemohon harus membuat yang baru."
        action={act.tolakPengajuan.bind(null, p.id)}
        submitLabel="Tolak"
        variant="danger"
        note="required"
        notePlaceholder="Alasan penolakan"
      />
      <AksiSheet
        open={mode === "batal"}
        onClose={tutup}
        onOk={berhasil}
        title="Batalkan pengajuan?"
        description="Pengajuan berhenti di sini dan tidak bisa dilanjutkan."
        action={act.batalkanPengajuan.bind(null, p.id)}
        submitLabel="Batalkan pengajuan"
        variant="danger"
        note="optional"
        notePlaceholder="Alasan (opsional)"
      />
      <AksiSheet
        open={mode === "ajukan"}
        onClose={tutup}
        onOk={berhasil}
        title="Kirim pengajuan?"
        description="Setelah dikirim, pengajuan tidak bisa diubah kecuali dikembalikan untuk revisi."
        action={act.ajukanDraf.bind(null, p.id)}
        submitLabel="Kirim"
      />
      <AksiSheet
        open={mode === "hapus"}
        onClose={tutup}
        onOk={berhasil}
        title="Hapus draf ini?"
        description="Draf dan lampirannya dihapus permanen."
        action={act.hapusDraf.bind(null, p.id)}
        submitLabel="Hapus draf"
        variant="danger"
      />
      <AksiSheet
        open={mode === "batalBayar"}
        onClose={tutup}
        onOk={berhasil}
        title="Batalkan pencatatan pembayaran?"
        description="Gunakan bila pembayaran salah dicatat. Transaksi kasnya ikut dibatalkan dan pengajuan kembali berstatus disetujui."
        action={act.batalkanPembayaran.bind(null, p.id)}
        submitLabel="Batalkan pembayaran"
        variant="danger"
        note="required"
        notePlaceholder="Alasan pembatalan"
      />
      <AksiSheet
        open={mode === "kembalikanLpj"}
        onClose={tutup}
        onOk={berhasil}
        title="Kembalikan LPJ"
        description="Pemegang uang muka diminta memperbaiki laporannya."
        action={act.kembalikanLpj.bind(null, p.id)}
        submitLabel="Kembalikan LPJ"
        note="required"
        notePlaceholder="Apa yang kurang? mis. nota BBM belum ada"
      />
      <BayarSheet
        open={mode === "bayar" || mode === "setujuiBayar"}
        gabung={mode === "setujuiBayar"}
        onClose={tutup}
        onOk={berhasil}
        {...p}
      />
      <TerimaLpjSheet open={mode === "terimaLpj"} onClose={tutup} onOk={berhasil} {...p} />
      {toast ? <ToastView pesan={toast.pesan} /> : null}
    </>
  );
}

function useHasil(state: ActionState, onOk: (pesan: string) => void) {
  const terakhir = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (state?.ok && state.at !== terakhir.current) {
      terakhir.current = state.at;
      onOk(state.ok);
    }
  }, [state, onOk]);
}

function AksiSheet({
  open,
  onClose,
  onOk,
  title,
  description,
  action,
  submitLabel,
  variant = "primary",
  note = "none",
  notePlaceholder,
}: {
  open: boolean;
  onClose: () => void;
  onOk: (pesan: string) => void;
  title: string;
  description: string;
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  submitLabel: string;
  variant?: ButtonVariant;
  note?: "none" | "optional" | "required";
  notePlaceholder?: string;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, undefined);
  useHasil(state, onOk);
  return (
    <Sheet open={open} onClose={onClose} title={title} description={description} size="sm">
      <form action={formAction} className="space-y-3">
        <ActionFeedback state={state} />
        {note !== "none" ? (
          <Textarea
            name="note"
            aria-label="Catatan"
            placeholder={notePlaceholder}
            rows={3}
            required={note === "required"}
            minLength={note === "required" ? 3 : undefined}
            maxLength={1000}
          />
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <SubmitButton variant={variant}>{submitLabel}</SubmitButton>
        </div>
      </form>
    </Sheet>
  );
}

const METODE = [
  { value: "transfer", label: "Transfer" },
  { value: "tunai", label: "Tunai" },
  { value: "qris", label: "QRIS" },
  { value: "giro", label: "Giro" },
];

function BayarSheet(
  p: AksiProps & { open: boolean; gabung: boolean; onClose: () => void; onOk: (pesan: string) => void },
) {
  const [state, formAction] = useActionState<ActionState, FormData>(act.bayarPengajuan.bind(null, p.id), undefined);
  const [method, setMethod] = useState("transfer");
  useHasil(state, p.onOk);
  return (
    <Sheet
      open={p.open}
      onClose={p.onClose}
      title={p.gabung ? "Setujui & catat pembayaran" : "Catat pembayaran"}
      description={`${p.totalLabel} ke ${p.payeeLabel}. Transaksi kas dibuat otomatis.`}
    >
      <form action={formAction} className="space-y-4">
        {p.gabung ? <input type="hidden" name="gabung" value="1" /> : null}
        <input type="hidden" name="method" value={method} />
        <ActionFeedback state={state} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tanggal bayar" htmlFor="paidDate" required>
            <Input id="paidDate" name="paidDate" type="date" defaultValue={p.today} max={p.today} required />
          </Field>
          <Field label="Dibayar dari" help={p.accounts.length ? undefined : "Belum ada rekening di Data Master."}>
            <Combobox name="accountId" options={p.accounts} placeholder="Pilih rekening/kas" aria-label="Dibayar dari" defaultValue={p.accounts[0]?.value} />
          </Field>
        </div>
        <div>
          <p className="mb-1 text-[13px] font-medium">Cara bayar</p>
          <Segmented name="_method" value={method} onChange={setMethod} options={METODE} />
        </div>
        <Field label="No. referensi" htmlFor="reference" help="Nomor transaksi bank / kuitansi, untuk pelacakan.">
          <Input id="reference" name="reference" maxLength={120} />
        </Field>
        <FilePicker
          name="bukti"
          label={`Bukti bayar${p.requireProof ? " (wajib)" : ""}`}
          hint="Tangkapan layar m-banking atau foto kuitansi."
          maxFiles={4}
        />
        <Textarea name="note" aria-label="Catatan" placeholder="Catatan (opsional)" rows={2} maxLength={1000} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={p.onClose}>
            Batal
          </Button>
          <SubmitButton variant="success" pendingText="Menyimpan…">
            {p.gabung ? "Setujui & simpan" : "Simpan pembayaran"}
          </SubmitButton>
        </div>
      </form>
    </Sheet>
  );
}

function TerimaLpjSheet(p: AksiProps & { open: boolean; onClose: () => void; onOk: (pesan: string) => void }) {
  const [state, formAction] = useActionState<ActionState, FormData>(act.terimaLpj.bind(null, p.id), undefined);
  const [method, setMethod] = useState("tunai");
  useHasil(state, p.onOk);
  const perluRekening = p.lpj && p.lpj.arah !== "pas";
  return (
    <Sheet
      open={p.open}
      onClose={p.onClose}
      title="Terima LPJ"
      description={
        !p.lpj || p.lpj.arah === "pas"
          ? "Pemakaian pas – biaya per kategori dicatat sesuai LPJ."
          : p.lpj.arah === "kembali"
            ? `Sisa ${p.lpj.jumlahLabel} dicatat MASUK ke rekening yang Anda pilih.`
            : `Kekurangan ${p.lpj.jumlahLabel} dicatat KELUAR dari rekening yang Anda pilih.`
      }
      size="sm"
    >
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="method" value={method} />
        <ActionFeedback state={state} />
        <Field label="Tanggal" htmlFor="lpjDate" required>
          <Input id="lpjDate" name="paidDate" type="date" defaultValue={p.today} max={p.today} required />
        </Field>
        {perluRekening ? (
          <>
            <Field label={p.lpj?.arah === "kembali" ? "Dikembalikan ke" : "Dibayar dari"} required>
              <Combobox name="accountId" options={p.accounts} placeholder="Pilih rekening/kas" defaultValue={p.accounts[0]?.value} aria-label="Rekening" />
            </Field>
            <Segmented name="_method" value={method} onChange={setMethod} options={METODE.slice(0, 2)} />
          </>
        ) : null}
        <Textarea name="note" aria-label="Catatan" placeholder="Catatan (opsional)" rows={2} maxLength={1000} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={p.onClose}>
            Batal
          </Button>
          <SubmitButton>Terima LPJ</SubmitButton>
        </div>
      </form>
    </Sheet>
  );
}
