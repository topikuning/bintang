"use client";

import { useActionState } from "react";
import { Field, Input } from "@/components/ui/field";
import { ActionFeedback, SubmitButton, Toast } from "@/components/ui/form-bits";
import type { ActionState } from "@/lib/aksi";
import { simpanProfil } from "@/lib/pengguna/actions";

export function FormProfil({ v }: { v: { fullName: string; phone: string; bankName: string; bankAccount: string; bankHolder: string } }) {
  const [state, action] = useActionState<ActionState, FormData>(simpanProfil, undefined);
  return (
    <form action={action} className="space-y-5">
      <ActionFeedback state={state} />
      <section className="grid gap-4 rounded-xl border border-border bg-surface p-4 shadow-(--shadow-card) sm:grid-cols-2 sm:p-5">
        <Field label="Nama lengkap" htmlFor="fullName" required>
          <Input id="fullName" name="fullName" defaultValue={v.fullName} required maxLength={120} />
        </Field>
        <Field label="Telepon / WA" htmlFor="phone">
          <Input id="phone" name="phone" type="tel" defaultValue={v.phone} maxLength={40} />
        </Field>
      </section>
      <section className="rounded-xl border border-border bg-surface p-4 shadow-(--shadow-card) sm:p-5">
        <h2 className="text-sm font-semibold">Rekening pribadi</h2>
        <p className="mb-3 text-[13px] text-ink-muted">Dipakai otomatis saat Anda mengajukan uang muka atau penggantian – tidak perlu mengetik ulang tiap kali.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Bank" htmlFor="bankName">
            <Input id="bankName" name="bankName" defaultValue={v.bankName} placeholder="BCA, BRI, Mandiri…" maxLength={80} />
          </Field>
          <Field label="Nomor rekening" htmlFor="bankAccount">
            <Input id="bankAccount" name="bankAccount" inputMode="numeric" defaultValue={v.bankAccount} maxLength={40} className="tabular" />
          </Field>
          <Field label="Atas nama" htmlFor="bankHolder" className="sm:col-span-2">
            <Input id="bankHolder" name="bankHolder" defaultValue={v.bankHolder} maxLength={200} />
          </Field>
        </div>
      </section>
      <div className="flex justify-end">
        <SubmitButton>Simpan profil</SubmitButton>
      </div>
      <Toast state={state} />
    </form>
  );
}
