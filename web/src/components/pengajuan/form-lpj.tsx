"use client";

import { Send } from "lucide-react";
import { useActionState, useMemo, useState } from "react";
import type { ComboOption } from "@/components/ui/combobox";
import { Field, Textarea } from "@/components/ui/field";
import { FilePicker } from "@/components/ui/file-picker";
import { ActionFeedback, SubmitButton } from "@/components/ui/form-bits";
import type { ActionState } from "@/lib/aksi";
import { cn } from "@/lib/cn";
import { selisihLpj } from "@/lib/keuangan/hitung";
import { ajukanLpj } from "@/lib/pengajuan/actions";
import { barisBaru, jumlahBaris, type Baris } from "@/lib/pengajuan/baris";
import { jumlahkan, rupiah } from "@/lib/uang";
import { RincianEditor } from "./rincian-editor";

export function FormLpj({
  id,
  uangMuka,
  categories,
  awal,
  catatanAwal,
}: {
  id: string;
  uangMuka: string;
  categories: ComboOption[];
  awal: Baris[];
  catatanAwal: string;
}) {
  const [state, action] = useActionState<ActionState, FormData>(ajukanLpj.bind(null, id), undefined);
  const [rows, setRows] = useState<Baris[]>(awal.length ? awal : [barisBaru()]);
  const [note, setNote] = useState(catatanAwal);
  const total = useMemo(() => jumlahkan(rows.map(jumlahBaris)), [rows]);
  const um = BigInt(uangMuka);
  const s = selisihLpj(um, total);

  const json = JSON.stringify(
    rows
      .filter((r) => r.description.trim() || jumlahBaris(r) > 0n)
      .map((r) => ({ description: r.description, categoryId: r.categoryId, amount: jumlahBaris(r).toString() })),
  );

  return (
    <form action={action} className="space-y-5 pb-28">
      <input type="hidden" name="realisasi" value={json} />
      <ActionFeedback state={state} />
      <section className="rounded-xl border border-border bg-surface p-4 shadow-(--shadow-card) sm:p-5">
        <h2 className="mb-1 text-sm font-semibold">Uang dipakai untuk apa saja?</h2>
        <p className="mb-3 text-[13px] text-ink-muted">Satu baris per nota. Kategori menentukan masuk ke biaya apa di laporan.</p>
        <RincianEditor rows={rows} onChange={setRows} categories={categories} addLabel="Tambah nota" />
      </section>
      <section className="space-y-4 rounded-xl border border-border bg-surface p-4 shadow-(--shadow-card) sm:p-5">
        <FilePicker name="nota" label="Foto nota & kuitansi" hint="Satu foto per nota lebih mudah diperiksa. Maks 10 MB per berkas." maxFiles={20} />
        <Field label="Catatan" htmlFor="note" help="mis. sisa uang sudah dikembalikan tunai ke kasir.">
          <Textarea id="note" name="note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} />
        </Field>
      </section>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur lg:left-60">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <dl className="grid grid-cols-3 gap-4 text-xs">
            <div>
              <dt className="text-ink-muted">Uang muka</dt>
              <dd className="tabular text-sm font-semibold">{rupiah(um)}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Terpakai</dt>
              <dd className="tabular text-sm font-semibold">{rupiah(total)}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">{s.arah === "kurang" ? "Kurang" : "Sisa"}</dt>
              <dd className={cn("tabular text-sm font-semibold", s.arah === "kembali" && "text-masuk", s.arah === "kurang" && "text-keluar")}>
                {rupiah(s.jumlah)}
              </dd>
            </div>
          </dl>
          <SubmitButton pendingText="Mengirim…">
            <Send aria-hidden className="size-4" /> Kirim LPJ
          </SubmitButton>
        </div>
      </div>
    </form>
  );
}
