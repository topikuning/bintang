"use client";

import { useActionState } from "react";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { ActionFeedback, SubmitButton, Toast } from "@/components/ui/form-bits";
import { MoneyInput } from "@/components/ui/money-input";
import type { ActionState } from "@/lib/aksi";
import { simpanPengaturan } from "@/lib/pengaturan-aksi/actions";

export function FormPengaturan({ v }: { v: { orgName: string; financeApproveCap: string; requireProof: boolean } }) {
  const [state, action] = useActionState<ActionState, FormData>(simpanPengaturan, undefined);
  return (
    <form action={action} className="space-y-5">
      <ActionFeedback state={state} />
      <section className="space-y-4 rounded-xl border border-border bg-surface p-4 shadow-(--shadow-card) sm:p-5">
        <Field label="Nama organisasi" htmlFor="orgName" required help="Tampil di bilah atas dan kaki halaman cetak.">
          <Input id="orgName" name="orgName" defaultValue={v.orgName} required maxLength={120} />
        </Field>
      </section>
      <section className="space-y-4 rounded-xl border border-border bg-surface p-4 shadow-(--shadow-card) sm:p-5">
        <h2 className="text-sm font-semibold">Aturan persetujuan & pembayaran</h2>
        <Field
          label="Batas persetujuan Keuangan"
          help="Pengajuan DI ATAS nilai ini hanya bisa disetujui Pimpinan atau Admin Sistem. Kosongkan/0 = Keuangan boleh menyetujui berapa pun."
        >
          <MoneyInput name="financeApproveCap" defaultValue={v.financeApproveCap} aria-label="Batas persetujuan Keuangan" className="sm:max-w-xs" />
        </Field>
        <Checkbox
          name="requireProof"
          value="1"
          defaultChecked={v.requireProof}
          label="Wajib unggah bukti bayar"
          description="Pembayaran tidak bisa dicatat tanpa foto/PDF bukti transfer atau kuitansi."
        />
        <p className="rounded-md bg-surface-muted p-3 text-[13px] text-ink-muted">
          Selalu berlaku, tidak bisa dimatikan: pemohon tidak bisa menyetujui pengajuannya sendiri, dan setiap langkah tercatat di riwayat & jejak audit.
        </p>
      </section>
      <div className="flex justify-end">
        <SubmitButton>Simpan pengaturan</SubmitButton>
      </div>
      <Toast state={state} />
    </form>
  );
}
