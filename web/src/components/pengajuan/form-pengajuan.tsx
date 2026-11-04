"use client";

import { AlertTriangle, Banknote, HandCoins, Send, UserRound, Wallet, Zap } from "lucide-react";
import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { ActionFeedback } from "@/components/ui/form-bits";
import { FilePicker } from "@/components/ui/file-picker";
import { Field, FieldError, Input, Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/lapisan";
import { Segmented } from "@/components/ui/tabs";
import type { ActionState } from "@/lib/aksi";
import { cn } from "@/lib/cn";
import { REQUEST_KIND_HINT } from "@/lib/lifecycle";
import { simpanPengajuan, tambahPihakCepat } from "@/lib/pengajuan/actions";
import { jumlahkan, rupiah } from "@/lib/uang";
import { barisBaru, barisKeJson, jumlahBaris, RincianEditor, type Baris } from "./rincian-editor";

export type PihakOpsi = {
  id: string;
  name: string;
  kind: string;
  bankName: string | null;
  bankAccount: string | null;
  bankHolder: string | null;
};

export type Rekening = { bankName: string | null; bankAccount: string | null; bankHolder: string | null };

export type NilaiAwal = {
  id: string;
  projectId: string;
  kind: "pembayaran" | "uang_muka" | "penggantian";
  title: string;
  description: string;
  urgent: boolean;
  neededDate: string;
  partyId: string;
  payeeName: string;
  bankName: string;
  bankAccount: string;
  bankHolder: string;
  rows: Baris[];
  status: string;
};

const JENIS = [
  { value: "pembayaran", label: "Bayar pihak lain", icon: Banknote },
  { value: "uang_muka", label: "Uang muka", icon: Wallet },
  { value: "penggantian", label: "Penggantian", icon: HandCoins },
] as const;

export function FormPengajuan({
  projects,
  categories,
  parties: partiesAwal,
  me,
  initial,
  defaultProjectId,
  canCreateParty,
}: {
  projects: ComboOption[];
  categories: ComboOption[];
  parties: PihakOpsi[];
  me: { fullName: string } & Rekening;
  initial?: NilaiAwal;
  defaultProjectId?: string;
  canCreateParty: boolean;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(simpanPengajuan, undefined);
  const err = state?.fields ?? {};

  const [kind, setKind] = useState<NilaiAwal["kind"]>(initial?.kind ?? "pembayaran");
  const [projectId, setProjectId] = useState(initial?.projectId ?? defaultProjectId ?? (projects.length === 1 ? projects[0].value : ""));
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [urgent, setUrgent] = useState(initial?.urgent ?? false);
  const [neededDate, setNeededDate] = useState(initial?.neededDate ?? "");
  const [rows, setRows] = useState<Baris[]>(initial?.rows.length ? initial.rows : [barisBaru()]);

  // Penerima.
  const [parties, setParties] = useState(partiesAwal);
  const [partyId, setPartyId] = useState(initial?.partyId ?? "");
  const awalDiriSendiri =
    !initial || initial.kind === "pembayaran" ? true : !initial.payeeName || initial.payeeName === me.fullName;
  const [penerimaDiri, setPenerimaDiri] = useState(awalDiriSendiri);
  const [payeeName, setPayeeName] = useState(initial?.payeeName ?? "");
  const [bankName, setBankName] = useState(initial?.bankName ?? "");
  const [bankAccount, setBankAccount] = useState(initial?.bankAccount ?? "");
  const [bankHolder, setBankHolder] = useState(initial?.bankHolder ?? "");
  const [ubahRekening, setUbahRekening] = useState(false);
  const [pihakBaru, setPihakBaru] = useState<string | null>(null);

  const total = useMemo(() => jumlahkan(rows.map(jumlahBaris)), [rows]);

  function pilihPihak(id: string) {
    setPartyId(id);
    const p = parties.find((x) => x.id === id);
    if (p) {
      setPayeeName(p.name);
      setBankName(p.bankName ?? "");
      setBankAccount(p.bankAccount ?? "");
      setBankHolder(p.bankHolder ?? "");
      setUbahRekening(false);
    }
  }

  // Nilai penerima yang benar-benar dikirim.
  const kirim =
    kind === "pembayaran"
      ? { partyId, payeeName, bankName, bankAccount, bankHolder }
      : penerimaDiri
        ? { partyId: "", payeeName: me.fullName, bankName: me.bankName ?? "", bankAccount: me.bankAccount ?? "", bankHolder: me.bankHolder ?? "" }
        : { partyId: "", payeeName, bankName, bankAccount, bankHolder };

  const pihakOpsi: ComboOption[] = parties.map((p) => ({
    value: p.id,
    label: p.name,
    hint: [p.bankName, p.bankAccount].filter(Boolean).join(" · ") || undefined,
  }));
  const pihakTerpilih = parties.find((p) => p.id === partyId);
  const editMode = !!initial;
  const sudahDiajukan = initial && initial.status !== "draft";

  return (
    <form action={action} className="space-y-5 pb-28 lg:pb-24">
      {initial ? <input type="hidden" name="id" value={initial.id} /> : null}
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="items" value={barisKeJson(rows)} />
      <input type="hidden" name="partyId" value={kirim.partyId} />
      <input type="hidden" name="payeeName" value={kirim.payeeName} />
      <input type="hidden" name="bankName" value={kirim.bankName} />
      <input type="hidden" name="bankAccount" value={kirim.bankAccount} />
      <input type="hidden" name="bankHolder" value={kirim.bankHolder} />
      <input type="hidden" name="urgent" value={urgent ? "1" : ""} />

      <ActionFeedback state={state} />

      {/* 1. Jenis */}
      <section className="rounded-xl border border-border bg-surface p-4 shadow-(--shadow-card) sm:p-5">
        <h2 className="mb-1 text-sm font-semibold text-ink">1. Jenis pengajuan</h2>
        <p className="mb-3 text-[13px] text-ink-muted">Pilih yang paling sesuai – menentukan alur setelah dibayar.</p>
        <div role="radiogroup" aria-label="Jenis pengajuan" className="grid grid-cols-3 gap-2">
          {JENIS.map((j) => {
            const aktif = kind === j.value;
            const Ikon = j.icon;
            return (
              <button
                key={j.value}
                type="button"
                role="radio"
                aria-checked={aktif}
                onClick={() => setKind(j.value)}
                className={cn(
                  "flex min-w-0 flex-col items-center gap-2 rounded-lg border p-3 text-center transition-colors sm:flex-row sm:items-start sm:text-left",
                  aktif
                    ? "border-primary-400 bg-primary-50 ring-1 ring-primary-400"
                    : "border-border hover:border-border-strong hover:bg-surface-muted",
                )}
              >
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-md",
                    aktif ? "bg-primary text-white" : "bg-surface-inset text-ink-muted",
                  )}
                >
                  <Ikon aria-hidden className="size-4.5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] leading-tight font-semibold text-ink sm:text-sm">{j.label}</span>
                  {/* Di ponsel penjelasannya cukup satu, di bawah kisi – tiga
                      paragraf berjajar di layar 390 px hanya jadi tembok teks. */}
                  <span className="hidden text-[12.5px] leading-snug text-ink-muted sm:block">{REQUEST_KIND_HINT[j.value]}</span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[13px] text-ink-muted sm:hidden">{REQUEST_KIND_HINT[kind]}</p>
      </section>

      {/* 2. Keperluan */}
      <section className="space-y-4 rounded-xl border border-border bg-surface p-4 shadow-(--shadow-card) sm:p-5">
        <h2 className="text-sm font-semibold text-ink">2. Keperluan</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Proyek" required error={err.projectId} className="sm:col-span-2">
            <Combobox
              name="projectId"
              options={projects}
              value={projectId}
              onChange={setProjectId}
              placeholder="Pilih proyek…"
              invalid={!!err.projectId}
              aria-label="Proyek"
            />
          </Field>
          <Field label="Untuk keperluan apa?" htmlFor="title" required error={err.title} className="sm:col-span-2">
            <Input
              id="title"
              name="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={kind === "uang_muka" ? "mis. Uang muka operasional lapangan minggu ini" : "mis. Semen & besi pengecoran lantai 2"}
              maxLength={200}
              required
              invalid={!!err.title}
            />
          </Field>
          <Field label="Keterangan tambahan" htmlFor="description" help="Opsional. Alasan, nomor penawaran, atau hal yang perlu diketahui pemberi persetujuan." className="sm:col-span-2">
            <Textarea id="description" name="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={2000} />
          </Field>
          <Field label="Dibutuhkan paling lambat" htmlFor="neededDate" help="Opsional.">
            <Input id="neededDate" name="neededDate" type="date" value={neededDate} onChange={(e) => setNeededDate(e.target.value)} />
          </Field>
          <div className="flex items-end">
            <button
              type="button"
              role="switch"
              aria-checked={urgent}
              onClick={() => setUrgent((u) => !u)}
              className={cn(
                "flex h-10 w-full items-center gap-3 rounded-md border px-3 text-left text-sm transition-colors pointer-coarse:h-11",
                urgent ? "border-danger-border bg-danger-soft text-danger" : "border-border text-ink-muted hover:border-border-strong",
              )}
            >
              <span className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", urgent ? "bg-danger" : "bg-border-strong")}>
                <span className={cn("absolute top-0.5 size-4 rounded-full bg-white shadow transition-[left]", urgent ? "left-4.5" : "left-0.5")} />
              </span>
              <Zap aria-hidden className="size-4" />
              <span className="font-medium">Mendesak</span>
            </button>
          </div>
        </div>
      </section>

      {/* 3. Rincian */}
      <section className="rounded-xl border border-border bg-surface p-4 shadow-(--shadow-card) sm:p-5">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">3. Rincian biaya</h2>
          <p className="tabular text-sm font-semibold text-ink">{rupiah(total)}</p>
        </div>
        {err.items ? <FieldError className="mb-2">{err.items}</FieldError> : null}
        <RincianEditor rows={rows} onChange={setRows} categories={categories} errors={err} />
      </section>

      {/* 4. Penerima */}
      <section className="space-y-3 rounded-xl border border-border bg-surface p-4 shadow-(--shadow-card) sm:p-5">
        <h2 className="text-sm font-semibold text-ink">4. Dibayarkan ke</h2>
        {kind === "pembayaran" ? (
          <>
            <Combobox
              options={pihakOpsi}
              value={partyId}
              onChange={pilihPihak}
              placeholder="Cari vendor / penerima…"
              aria-label="Penerima"
              emptyText="Belum ada di daftar"
              onCreate={canCreateParty ? (q) => setPihakBaru(q) : undefined}
              createLabel="Tambah penerima"
              searchThreshold={0}
            />
            {pihakTerpilih ? (
              <KartuRekening
                nama={payeeName}
                bankName={bankName}
                bankAccount={bankAccount}
                bankHolder={bankHolder}
                ubah={ubahRekening}
                onUbah={() => setUbahRekening(true)}
                setBankName={setBankName}
                setBankAccount={setBankAccount}
                setBankHolder={setBankHolder}
              />
            ) : (
              <p className="text-[13px] text-ink-muted">
                Ketik nama vendor, tukang, atau instansi. {canCreateParty ? "Kalau belum ada, tambahkan langsung dari sini." : ""}
              </p>
            )}
          </>
        ) : (
          <>
            <Segmented
              name="_penerima"
              value={penerimaDiri ? "diri" : "lain"}
              onChange={(v) => setPenerimaDiri(v === "diri")}
              options={[
                { value: "diri", label: "Saya sendiri" },
                { value: "lain", label: "Orang lain" },
              ]}
            />
            {penerimaDiri ? (
              me.bankAccount ? (
                <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-muted p-3">
                  <UserRound aria-hidden className="size-5 text-ink-muted" />
                  <div className="min-w-0 text-sm">
                    <p className="font-medium">{me.fullName}</p>
                    <p className="text-ink-muted">
                      {me.bankName} · <span className="tabular">{me.bankAccount}</span> · a.n. {me.bankHolder ?? me.fullName}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-start gap-2 rounded-lg border border-warning-border bg-warning-soft p-3 text-[13px]">
                  <AlertTriangle aria-hidden className="mt-0.5 size-4 text-warning" />
                  <p className="min-w-0 flex-1 text-ink">
                    Rekening Anda belum tercatat, jadi Keuangan belum tahu harus transfer ke mana.{" "}
                    <Link href="/profil" className="font-semibold text-primary-700 underline">
                      Lengkapi di profil
                    </Link>{" "}
                    (pengajuan tetap bisa dikirim, dibayar tunai pun bisa).
                  </p>
                </div>
              )
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Nama penerima" htmlFor="pn" required className="sm:col-span-2" error={err.payeeName}>
                  <Input id="pn" value={payeeName} onChange={(e) => setPayeeName(e.target.value)} maxLength={200} />
                </Field>
                <RekeningFields
                  bankName={bankName}
                  bankAccount={bankAccount}
                  bankHolder={bankHolder}
                  setBankName={setBankName}
                  setBankAccount={setBankAccount}
                  setBankHolder={setBankHolder}
                />
              </div>
            )}
          </>
        )}
      </section>

      {/* 5. Lampiran */}
      <section className="rounded-xl border border-border bg-surface p-4 shadow-(--shadow-card) sm:p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink">5. Bukti pendukung</h2>
        <FilePicker
          name="lampiran"
          label={kind === "penggantian" ? "Foto nota / kuitansi yang sudah Anda bayar" : "Penawaran, invoice, atau foto nota"}
          hint="Opsional tapi sangat membantu persetujuan lebih cepat. Foto/PDF, maks 10 MB."
        />
      </section>

      {/* Bilah aksi lengket */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur lg:left-60">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium tracking-wide text-ink-muted uppercase">Total</p>
            <p className="tabular truncate text-lg leading-tight font-semibold text-ink">{rupiah(total)}</p>
          </div>
          <div className="flex gap-2">
            {!sudahDiajukan ? (
              <Button type="submit" name="intent" value="draft" variant="secondary" disabled={pending}>
                Simpan draf
              </Button>
            ) : null}
            <Button type="submit" name="intent" value="ajukan" loading={pending}>
              <Send aria-hidden className="size-4" />
              {editMode && initial?.status === "perlu_revisi" ? "Kirim ulang" : "Ajukan"}
            </Button>
          </div>
        </div>
      </div>

      <SheetPihakBaru
        nama={pihakBaru}
        onClose={() => setPihakBaru(null)}
        onCreated={(p) => {
          setParties((s) => [...s, p].sort((a, b) => a.name.localeCompare(b.name)));
          setPartyId(p.id);
          setPayeeName(p.name);
          setBankName(p.bankName ?? "");
          setBankAccount(p.bankAccount ?? "");
          setBankHolder(p.bankHolder ?? "");
          setPihakBaru(null);
        }}
      />
    </form>
  );
}

function RekeningFields(p: {
  bankName: string;
  bankAccount: string;
  bankHolder: string;
  setBankName: (v: string) => void;
  setBankAccount: (v: string) => void;
  setBankHolder: (v: string) => void;
}) {
  return (
    <>
      <Field label="Bank" htmlFor="bn">
        <Input id="bn" value={p.bankName} onChange={(e) => p.setBankName(e.target.value)} placeholder="BCA, BRI, Mandiri…" maxLength={80} />
      </Field>
      <Field label="Nomor rekening" htmlFor="ba">
        <Input id="ba" inputMode="numeric" value={p.bankAccount} onChange={(e) => p.setBankAccount(e.target.value)} maxLength={40} className="tabular" />
      </Field>
      <Field label="Atas nama" htmlFor="bh" className="sm:col-span-2">
        <Input id="bh" value={p.bankHolder} onChange={(e) => p.setBankHolder(e.target.value)} maxLength={200} />
      </Field>
    </>
  );
}

function KartuRekening(p: {
  nama: string;
  bankName: string;
  bankAccount: string;
  bankHolder: string;
  ubah: boolean;
  onUbah: () => void;
  setBankName: (v: string) => void;
  setBankAccount: (v: string) => void;
  setBankHolder: (v: string) => void;
}) {
  if (p.ubah) {
    return (
      <div className="grid gap-3 rounded-lg border border-border bg-surface-muted p-3 sm:grid-cols-2">
        <RekeningFields {...p} />
        <p className="text-[12px] text-ink-muted sm:col-span-2">Perubahan hanya untuk pengajuan ini; data master penerima tidak berubah.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-muted p-3">
      <div className="min-w-0 text-sm">
        <p className="font-medium">{p.nama}</p>
        <p className="text-ink-muted">
          {p.bankAccount ? (
            <>
              {p.bankName} · <span className="tabular">{p.bankAccount}</span>
              {p.bankHolder ? ` · a.n. ${p.bankHolder}` : ""}
            </>
          ) : (
            "Rekening belum tercatat – isi bila dibayar transfer."
          )}
        </p>
      </div>
      <Button size="sm" variant="secondary" onClick={p.onUbah}>
        {p.bankAccount ? "Ubah rekening" : "Isi rekening"}
      </Button>
    </div>
  );
}

function SheetPihakBaru({
  nama,
  onClose,
  onCreated,
}: {
  nama: string | null;
  onClose: () => void;
  onCreated: (p: PihakOpsi) => void;
}) {
  const [name, setName] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankAccount, setBankAccount] = useState("");
  const [bankHolder, setBankHolder] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [terakhir, setTerakhir] = useState<string | null>(null);
  if (nama !== terakhir) {
    setTerakhir(nama);
    if (nama) {
      setName(nama);
      setBankName("");
      setBankAccount("");
      setBankHolder(nama);
      setError(null);
    }
  }
  async function simpan() {
    setSibuk(true);
    setError(null);
    const r = await tambahPihakCepat({ name, bankName, bankAccount, bankHolder });
    setSibuk(false);
    if (!r.ok) return setError(r.error);
    onCreated({ id: r.id, name: r.name, kind: "vendor", bankName: bankName || null, bankAccount: bankAccount || null, bankHolder: bankHolder || null });
  }
  return (
    <Sheet
      open={nama !== null}
      onClose={onClose}
      title="Penerima baru"
      description="Disimpan ke daftar penerima supaya pengajuan berikutnya tinggal pilih."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button onClick={simpan} loading={sibuk}>
            Simpan penerima
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {error ? <p className="text-[13px] text-danger sm:col-span-2">{error}</p> : null}
        <Field label="Nama" htmlFor="np" required className="sm:col-span-2">
          <Input id="np" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
        </Field>
        <RekeningFields
          bankName={bankName}
          bankAccount={bankAccount}
          bankHolder={bankHolder}
          setBankName={setBankName}
          setBankAccount={setBankAccount}
          setBankHolder={setBankHolder}
        />
      </div>
    </Sheet>
  );
}
