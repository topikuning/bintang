"use client";

import { Save, Search } from "lucide-react";
import { useActionState, useMemo, useState } from "react";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { Field, Input, Textarea } from "@/components/ui/field";
import { ActionFeedback, SubmitButton } from "@/components/ui/form-bits";
import { MoneyInput } from "@/components/ui/money-input";
import { Segmented } from "@/components/ui/tabs";
import type { ActionState } from "@/lib/aksi";
import { cn } from "@/lib/cn";
import { simpanProyek } from "@/lib/proyek/actions";

export type ProyekAwal = {
  id: string;
  code: string;
  name: string;
  kind: string;
  companyId: string;
  client: string;
  location: string;
  contractValue: string;
  budget: string;
  startDate: string;
  endDate: string;
  status: string;
  notes: string;
  members: string[];
};

export function FormProyek({
  companies,
  users,
  awal,
}: {
  companies: ComboOption[];
  users: { id: string; name: string; role: string; cross: boolean }[];
  awal?: ProyekAwal;
}) {
  const [state, action] = useActionState<ActionState, FormData>(simpanProyek, undefined);
  const err = state?.fields ?? {};
  const [kind, setKind] = useState(awal?.kind ?? "proyek");
  const [status, setStatus] = useState(awal?.status ?? "aktif");
  const [contract, setContract] = useState(awal?.contractValue ?? "");
  const [budget, setBudget] = useState(awal?.budget ?? "");
  const [members, setMembers] = useState<Set<string>>(new Set(awal?.members ?? []));
  const [cari, setCari] = useState("");
  const daftar = useMemo(
    () => users.filter((u) => !u.cross && u.name.toLowerCase().includes(cari.toLowerCase())),
    [users, cari],
  );

  return (
    <form action={action} className="space-y-5 pb-24">
      {awal ? <input type="hidden" name="id" value={awal.id} /> : null}
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="status" value={status} />
      {[...members].map((m) => (
        <input key={m} type="hidden" name="members" value={m} />
      ))}
      <ActionFeedback state={state} />

      <section className="grid gap-4 rounded-xl border border-border bg-surface p-4 shadow-(--shadow-card) sm:grid-cols-2 sm:p-5">
        <div className="sm:col-span-2">
          <Segmented
            name="_k"
            value={kind}
            onChange={setKind}
            options={[
              { value: "proyek", label: "Proyek" },
              { value: "operasional", label: "Operasional / kantor" },
            ]}
          />
        </div>
        <Field label="Kode" htmlFor="code" required error={err.code} help="mis. PRJ-006. Unik.">
          <Input id="code" name="code" defaultValue={awal?.code} maxLength={30} required className="uppercase" />
        </Field>
        <Field label="Perusahaan" required error={err.companyId}>
          <Combobox name="companyId" options={companies} defaultValue={awal?.companyId ?? (companies.length === 1 ? companies[0].value : "")} aria-label="Perusahaan" />
        </Field>
        <Field label="Nama" htmlFor="name" required error={err.name} className="sm:col-span-2">
          <Input id="name" name="name" defaultValue={awal?.name} maxLength={200} required />
        </Field>
        <Field label="Klien / pemberi kerja" htmlFor="client">
          <Input id="client" name="client" defaultValue={awal?.client} maxLength={200} />
        </Field>
        <Field label="Lokasi" htmlFor="location">
          <Input id="location" name="location" defaultValue={awal?.location} maxLength={200} />
        </Field>
        <Field label="Nilai kontrak" help="Pemasukan yang diharapkan.">
          <MoneyInput name="contractValue" value={contract} onChange={setContract} aria-label="Nilai kontrak" />
        </Field>
        <Field
          label="Anggaran biaya"
          error={err.budget}
          help={
            contract && !budget ? (
              <button type="button" className="text-primary-700 underline" onClick={() => setBudget(formatPersen(contract, 70))}>
                Isi 70% dari nilai kontrak
              </button>
            ) : (
              "Batas biaya yang dipantau."
            )
          }
        >
          <MoneyInput name="budget" value={budget} onChange={setBudget} aria-label="Anggaran" />
        </Field>
        <Field label="Mulai" htmlFor="startDate">
          <Input id="startDate" name="startDate" type="date" defaultValue={awal?.startDate} />
        </Field>
        <Field label="Selesai" htmlFor="endDate" error={err.endDate}>
          <Input id="endDate" name="endDate" type="date" defaultValue={awal?.endDate} />
        </Field>
        {awal ? (
          <div className="sm:col-span-2">
            <p className="mb-1 text-[13px] font-medium">Status</p>
            <Segmented
              name="_s"
              value={status}
              onChange={setStatus}
              options={[
                { value: "aktif", label: "Aktif" },
                { value: "ditahan", label: "Ditahan" },
                { value: "selesai", label: "Selesai" },
                { value: "batal", label: "Batal" },
              ]}
            />
            <p className="mt-1 text-[12px] text-ink-muted">Proyek yang tidak aktif tidak bisa menerima pengajuan baru.</p>
          </div>
        ) : null}
        <Field label="Catatan" htmlFor="notes" className="sm:col-span-2">
          <Textarea id="notes" name="notes" defaultValue={awal?.notes} rows={2} maxLength={2000} />
        </Field>
      </section>

      <section className="rounded-xl border border-border bg-surface p-4 shadow-(--shadow-card) sm:p-5">
        <h2 className="text-sm font-semibold">Tim proyek</h2>
        <p className="mb-3 text-[13px] text-ink-muted">
          Admin proyek, staf, dan pengamat hanya melihat proyek tempat mereka menjadi anggota. Keuangan, Pimpinan, dan Admin Sistem otomatis melihat semua.
        </p>
        <div className="relative mb-2">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-faint" />
          <Input value={cari} onChange={(e) => setCari(e.target.value)} placeholder="Cari nama…" className="pl-9" aria-label="Cari anggota" />
        </div>
        <ul className="grid max-h-80 gap-1.5 overflow-y-auto sm:grid-cols-2">
          {daftar.map((u) => {
            const on = members.has(u.id);
            return (
              <li key={u.id}>
                <label
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2",
                    on ? "border-primary-300 bg-primary-50" : "border-border hover:bg-surface-muted",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      setMembers((s) => {
                        const n = new Set(s);
                        if (n.has(u.id)) n.delete(u.id);
                        else n.add(u.id);
                        return n;
                      })
                    }
                    className="size-4 accent-(--color-primary)"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{u.name}</span>
                    <span className="block text-xs text-ink-muted">{u.role}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-[12px] text-ink-muted">{members.size} anggota dipilih.</p>
      </section>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur lg:left-60">
        <div className="mx-auto flex max-w-6xl justify-end">
          <SubmitButton pendingText="Menyimpan…">
            <Save aria-hidden className="size-4" /> Simpan proyek
          </SubmitButton>
        </div>
      </div>
    </form>
  );
}

function formatPersen(nilai: string, p: number): string {
  const digit = nilai.replace(/\D/g, "");
  if (!digit) return "";
  const v = (BigInt(digit) * BigInt(p)) / 100n;
  return new Intl.NumberFormat("id-ID").format(v);
}
