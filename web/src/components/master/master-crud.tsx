"use client";

import { Pencil, Plus, Search } from "lucide-react";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/field";
import { ActionFeedback, SubmitButton, ToastView } from "@/components/ui/form-bits";
import { Sheet } from "@/components/ui/lapisan";
import { MoneyInput } from "@/components/ui/money-input";
import type { ActionState } from "@/lib/aksi";
import { cn } from "@/lib/cn";

export type FieldDef =
  | { name: string; label: string; type: "text" | "email" | "tel" | "number" | "textarea"; required?: boolean; help?: string; span?: 2; placeholder?: string }
  | { name: string; label: string; type: "select"; options: { value: string; label: string }[]; required?: boolean; help?: string; span?: 2; clearLabel?: string }
  | { name: string; label: string; type: "money"; help?: string; span?: 2 }
  | { name: string; label: string; type: "checkbox"; description?: string; span?: 2 };

export type Row = { id: string; values: Record<string, string>; title: string; subtitle?: string; meta?: string; active: boolean; badge?: string };

/**
 * Daftar master + lembar tambah/ubah, digerakkan konfigurasi. Satu pola
 * untuk perusahaan, kategori, penerima, rekening – supaya keempatnya terasa
 * sama dan tidak ada yang tertinggal saat satu diperbaiki.
 */
export function MasterCrud({
  rows,
  fields,
  action,
  addLabel,
  entityLabel,
  emptyText,
}: {
  rows: Row[];
  fields: FieldDef[];
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  addLabel: string;
  entityLabel: string;
  emptyText: string;
}) {
  const [edit, setEdit] = useState<Row | "baru" | null>(null);
  const [cari, setCari] = useState("");
  const [tampilNonaktif, setTampilNonaktif] = useState(false);
  const [state, formAction] = useActionState<ActionState, FormData>(action, undefined);
  const [toast, setToast] = useState<string | null>(null);
  const terakhir = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (state?.ok && state.at !== terakhir.current) {
      terakhir.current = state.at;
      const pesan = state.ok;
      queueMicrotask(() => {
        setEdit(null);
        setToast(pesan);
      });
      const t = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(t);
    }
  }, [state]);

  const nonaktif = rows.filter((r) => !r.active).length;
  const tampil = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return rows.filter(
      (r) => (tampilNonaktif || r.active) && (!q || `${r.title} ${r.subtitle ?? ""} ${r.meta ?? ""}`.toLowerCase().includes(q)),
    );
  }, [rows, cari, tampilNonaktif]);

  const nilai = edit && edit !== "baru" ? edit.values : {};

  return (
    <>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-faint" />
          <Input value={cari} onChange={(e) => setCari(e.target.value)} placeholder={`Cari ${entityLabel}…`} className="pl-9" aria-label={`Cari ${entityLabel}`} />
        </div>
        <Button onClick={() => setEdit("baru")}>
          <Plus aria-hidden className="size-4" /> {addLabel}
        </Button>
      </div>
      {nonaktif ? (
        <button type="button" onClick={() => setTampilNonaktif((v) => !v)} className="mb-2 text-[13px] text-ink-muted hover:text-ink">
          {tampilNonaktif ? "Sembunyikan" : "Tampilkan"} {nonaktif} yang nonaktif
        </button>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-(--shadow-card)">
        {tampil.length === 0 ? (
          <p className="px-4 py-10 text-center text-[13px] text-ink-muted">{cari ? "Tidak ada yang cocok." : emptyText}</p>
        ) : (
          <ul className="divide-y divide-border">
            {tampil.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setEdit(r)}
                  className={cn("flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-muted", !r.active && "opacity-60")}
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-sm font-medium">
                      {r.title}
                      {r.badge ? <Badge>{r.badge}</Badge> : null}
                      {!r.active ? <Badge tone="neutral">Nonaktif</Badge> : null}
                    </p>
                    {r.subtitle ? <p className="truncate text-xs text-ink-muted">{r.subtitle}</p> : null}
                  </div>
                  {r.meta ? <span className="tabular shrink-0 text-sm font-medium">{r.meta}</span> : null}
                  <Pencil aria-hidden className="size-4 shrink-0 text-ink-faint" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Sheet open={edit !== null} onClose={() => setEdit(null)} title={edit === "baru" ? addLabel : `Ubah ${entityLabel}`} size="lg">
        {edit !== null ? (
          <form key={edit === "baru" ? "baru" : edit.id} action={formAction} className="grid gap-4 sm:grid-cols-2">
            {edit !== "baru" ? <input type="hidden" name="id" value={edit.id} /> : null}
            <ActionFeedback state={state} className="sm:col-span-2" />
            {fields.map((f) => (
              <FieldRender key={f.name} f={f} value={nilai[f.name]} baru={edit === "baru"} error={state?.fields?.[f.name]} />
            ))}
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button variant="ghost" onClick={() => setEdit(null)}>
                Batal
              </Button>
              <SubmitButton>Simpan</SubmitButton>
            </div>
          </form>
        ) : null}
      </Sheet>
      {toast ? <ToastView pesan={toast} /> : null}
    </>
  );
}

function FieldRender({ f, value, baru, error }: { f: FieldDef; value?: string; baru: boolean; error?: string }) {
  const cls = f.span === 2 ? "sm:col-span-2" : undefined;
  const fid = `m-${f.name}`;
  switch (f.type) {
    case "checkbox":
      return <Checkbox name={f.name} label={f.label} description={f.description} defaultChecked={baru ? true : value === "1"} value="1" className={cls} />;
    case "select":
      return (
        <Field label={f.label} required={f.required} help={f.help} error={error} className={cls}>
          <Combobox name={f.name} options={f.options} defaultValue={value ?? (f.required ? f.options[0]?.value : "")} clearLabel={f.clearLabel} aria-label={f.label} />
        </Field>
      );
    case "money":
      return (
        <Field label={f.label} help={f.help} error={error} className={cls}>
          <MoneyInput name={f.name} defaultValue={value} aria-label={f.label} />
        </Field>
      );
    case "textarea":
      return (
        <Field label={f.label} htmlFor={fid} help={f.help} error={error} className={cls}>
          <Textarea id={fid} name={f.name} defaultValue={value} rows={2} />
        </Field>
      );
    default:
      return (
        <Field label={f.label} htmlFor={fid} required={f.required} help={f.help} error={error} className={cls}>
          <Input id={fid} name={f.name} type={f.type} defaultValue={value} required={f.required} placeholder={f.placeholder} />
        </Field>
      );
  }
}
