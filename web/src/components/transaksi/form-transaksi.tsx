"use client";

import { ArrowDownLeft, ArrowUpRight, Plus, Save, Trash2 } from "lucide-react";
import { useActionState, useMemo, useState } from "react";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { Field, Input } from "@/components/ui/field";
import { FilePicker } from "@/components/ui/file-picker";
import { ActionFeedback, SubmitButton } from "@/components/ui/form-bits";
import { MoneyInput } from "@/components/ui/money-input";
import { Segmented } from "@/components/ui/tabs";
import type { ActionState } from "@/lib/aksi";
import { cn } from "@/lib/cn";
import { catatTransaksi } from "@/lib/transaksi/actions";
import { jumlahkan, parseRupiah, rupiah } from "@/lib/uang";

type Baris = { key: string; categoryId: string; description: string; amount: string };
const baru = (): Baris => ({ key: Math.random().toString(36).slice(2), categoryId: "", description: "", amount: "" });

export function FormTransaksi({
  projects,
  accounts,
  catMasuk,
  catKeluar,
  parties,
  today,
  akanLangsung,
}: {
  projects: ComboOption[];
  accounts: ComboOption[];
  catMasuk: ComboOption[];
  catKeluar: ComboOption[];
  parties: ComboOption[];
  today: string;
  akanLangsung: boolean;
}) {
  const [state, action] = useActionState<ActionState, FormData>(catatTransaksi, undefined);
  const err = state?.fields ?? {};
  const [kind, setKind] = useState<"pemasukan" | "pengeluaran">("pengeluaran");
  const [projectId, setProjectId] = useState(projects.length === 1 ? projects[0].value : "");
  const [accountId, setAccountId] = useState(accounts[0]?.value ?? "");
  const [partyId, setPartyId] = useState("");
  const [method, setMethod] = useState("transfer");
  const [rows, setRows] = useState<Baris[]>([baru()]);
  const cats = kind === "pemasukan" ? catMasuk : catKeluar;
  const total = useMemo(() => jumlahkan(rows.map((r) => parseRupiah(r.amount) ?? 0n)), [rows]);
  const ubah = (i: number, p: Partial<Baris>) => setRows((s) => s.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const masuk = kind === "pemasukan";

  return (
    <form action={action} className="space-y-5 pb-28">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="method" value={method} />
      <input
        type="hidden"
        name="items"
        value={JSON.stringify(rows.filter((r) => r.amount).map((r) => ({ categoryId: r.categoryId, description: r.description, amount: r.amount })))}
      />
      <ActionFeedback state={state} />

      <section className="rounded-xl border border-border bg-surface p-4 shadow-(--shadow-card) sm:p-5">
        <div role="radiogroup" aria-label="Arah uang" className="grid grid-cols-2 gap-2">
          {(["pemasukan", "pengeluaran"] as const).map((k) => {
            const aktif = kind === k;
            const m = k === "pemasukan";
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={aktif}
                onClick={() => {
                  setKind(k);
                  setRows((s) => s.map((r) => ({ ...r, categoryId: "" })));
                }}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-lg border px-3 py-3 text-sm font-semibold transition-colors",
                  aktif
                    ? m
                      ? "border-masuk bg-masuk-soft text-masuk ring-1 ring-masuk"
                      : "border-keluar bg-keluar-soft text-keluar ring-1 ring-keluar"
                    : "border-border text-ink-muted hover:bg-surface-muted",
                )}
              >
                {m ? <ArrowDownLeft aria-hidden className="size-4" /> : <ArrowUpRight aria-hidden className="size-4" />}
                {m ? "Uang masuk" : "Uang keluar"}
              </button>
            );
          })}
        </div>
        {!masuk ? (
          <p className="mt-2 text-[13px] text-ink-muted">
            Untuk belanja yang butuh persetujuan, pakai <span className="font-medium text-ink">Pengajuan</span> – kas keluar tercatat otomatis saat dibayar.
          </p>
        ) : null}
      </section>

      <section className="grid gap-4 rounded-xl border border-border bg-surface p-4 shadow-(--shadow-card) sm:grid-cols-2 sm:p-5">
        <Field label="Proyek" required error={err.projectId} className="sm:col-span-2">
          <Combobox name="projectId" options={projects} value={projectId} onChange={setProjectId} placeholder="Pilih proyek…" aria-label="Proyek" />
        </Field>
        <Field label="Keterangan" htmlFor="description" required error={err.description} className="sm:col-span-2">
          <Input id="description" name="description" required maxLength={300} placeholder={masuk ? "mis. Termin 2 (20%) Gedung Dinas PU" : "mis. Fotokopi & jilid dokumen"} />
        </Field>
        <Field label="Tanggal" htmlFor="date" required>
          <Input id="date" name="date" type="date" defaultValue={today} max={today} required />
        </Field>
        <Field label={masuk ? "Masuk ke rekening" : "Keluar dari rekening"}>
          <Combobox name="accountId" options={accounts} value={accountId} onChange={setAccountId} placeholder="Pilih rekening/kas" aria-label="Rekening" />
        </Field>
        <div className="sm:col-span-2">
          <p className="mb-1 text-[13px] font-medium">Cara</p>
          <Segmented
            name="_m"
            value={method}
            onChange={setMethod}
            options={[
              { value: "transfer", label: "Transfer" },
              { value: "tunai", label: "Tunai" },
              { value: "qris", label: "QRIS" },
              { value: "giro", label: "Giro" },
            ]}
          />
        </div>
        <Field label={masuk ? "Dari" : "Kepada"} help="Opsional.">
          <Combobox name="partyId" options={parties} value={partyId} onChange={setPartyId} clearLabel="–" placeholder="Pilih pihak" aria-label="Pihak" />
        </Field>
        <Field label="No. referensi" htmlFor="reference" help="Opsional. No. bukti transfer/kuitansi.">
          <Input id="reference" name="reference" maxLength={120} />
        </Field>
      </section>

      <section className="rounded-xl border border-border bg-surface p-4 shadow-(--shadow-card) sm:p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Jumlah & kategori</h2>
          <span className="text-[12px] text-ink-muted">Pecah jadi beberapa baris bila satu nota berisi beberapa kategori.</span>
        </div>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={r.key} className="grid gap-2 rounded-lg border border-border bg-surface-muted/60 p-2.5 sm:grid-cols-[12rem_minmax(0,1fr)_11rem_auto]">
              <Combobox
                options={cats}
                value={r.categoryId}
                onChange={(v) => ubah(i, { categoryId: v })}
                placeholder="Kategori"
                aria-label={`Kategori baris ${i + 1}`}
                invalid={!!err[`items.${i}.categoryId`]}
              />
              <Input placeholder="Rincian (opsional)" aria-label={`Rincian baris ${i + 1}`} value={r.description} onChange={(e) => ubah(i, { description: e.target.value })} maxLength={300} />
              <MoneyInput aria-label={`Jumlah baris ${i + 1}`} value={r.amount} onChange={(v) => ubah(i, { amount: v })} />
              <button
                type="button"
                aria-label="Hapus baris"
                onClick={() => setRows((s) => (s.length === 1 ? [baru()] : s.filter((_, j) => j !== i)))}
                className="flex size-10 items-center justify-center justify-self-end rounded-md text-ink-faint hover:bg-danger-soft hover:text-danger"
              >
                <Trash2 aria-hidden className="size-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setRows((s) => [...s, baru()])}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong text-sm font-medium text-primary-700 hover:bg-primary-50"
          >
            <Plus aria-hidden className="size-4" /> Tambah baris
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-surface p-4 shadow-(--shadow-card) sm:p-5">
        <FilePicker name="lampiran" label="Bukti" hint="Foto nota, bukti transfer, atau PDF." />
      </section>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur lg:left-60">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium tracking-wide text-ink-muted uppercase">{masuk ? "Total masuk" : "Total keluar"}</p>
            <p className={cn("tabular text-lg leading-tight font-semibold", masuk ? "text-masuk" : "text-keluar")}>{rupiah(total)}</p>
          </div>
          <div className="text-right">
            <SubmitButton pendingText="Menyimpan…">
              <Save aria-hidden className="size-4" /> Simpan
            </SubmitButton>
            {!akanLangsung ? <p className="mt-1 text-[11px] text-ink-muted">Akan diverifikasi Keuangan</p> : null}
          </div>
        </div>
      </div>
    </form>
  );
}
