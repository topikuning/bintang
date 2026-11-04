"use client";

import { KeyRound, Pencil, Plus, Search } from "lucide-react";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { ActionFeedback, SubmitButton } from "@/components/ui/form-bits";
import { Sheet } from "@/components/ui/lapisan";
import { Avatar } from "@/components/ui/misc";
import { Salin } from "@/components/ui/salin";
import type { UserRole } from "@/generated/prisma/enums";
import { ROLE_DESCRIPTION, ROLE_LABEL, ROLES } from "@/lib/authz";
import { cn } from "@/lib/cn";
import { simpanPengguna, type SimpanPenggunaState } from "@/lib/pengguna/actions";

export type PenggunaRow = {
  id: string;
  fullName: string;
  username: string;
  email: string;
  phone: string;
  role: UserRole;
  allProjects: boolean;
  isActive: boolean;
  lastLogin: string;
  projects: number;
  me: boolean;
};

const SCOPED: UserRole[] = ["project_admin", "staff", "viewer"];

export function KelolaPengguna({ rows }: { rows: PenggunaRow[] }) {
  const [edit, setEdit] = useState<PenggunaRow | "baru" | null>(null);
  const [cari, setCari] = useState("");
  const [state, action] = useActionState<SimpanPenggunaState, FormData>(simpanPengguna, undefined);
  const [role, setRole] = useState<UserRole>("staff");
  const [hasilPw, setHasilPw] = useState<{ password: string; untuk: string } | null>(null);
  const terakhir = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (state?.ok && state.at !== terakhir.current) {
      terakhir.current = state.at;
      const pw = state.password && state.untuk ? { password: state.password, untuk: state.untuk } : null;
      queueMicrotask(() => {
        setEdit(null);
        setHasilPw(pw);
      });
    }
  }, [state]);

  const tampil = useMemo(() => {
    const q = cari.toLowerCase().trim();
    return rows.filter((r) => !q || `${r.fullName} ${r.username} ${r.email} ${ROLE_LABEL[r.role]}`.toLowerCase().includes(q));
  }, [rows, cari]);

  const buka = (r: PenggunaRow | "baru") => {
    setRole(r === "baru" ? "staff" : r.role);
    setEdit(r);
  };
  const v = edit && edit !== "baru" ? edit : null;

  return (
    <>
      {hasilPw ? (
        <div className="mb-4 rounded-xl border border-success-border bg-success-soft p-4">
          <p className="text-sm font-semibold">Password sementara untuk {hasilPw.untuk}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="rounded-md border border-border bg-surface px-3 py-1.5 text-base font-semibold tracking-wider">{hasilPw.password}</code>
            <Salin teks={hasilPw.password} />
          </div>
          <p className="mt-2 text-[13px] text-ink-muted">Hanya tampil sekali. Pengguna wajib menggantinya saat pertama masuk.</p>
        </div>
      ) : null}

      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-faint" />
          <Input value={cari} onChange={(e) => setCari(e.target.value)} placeholder="Cari nama, username, peran…" className="pl-9" aria-label="Cari pengguna" />
        </div>
        <Button onClick={() => buka("baru")}>
          <Plus aria-hidden className="size-4" /> Tambah pengguna
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-(--shadow-card)">
        <ul className="divide-y divide-border">
          {tampil.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => buka(r)} className={cn("flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-muted", !r.isActive && "opacity-60")}>
                <Avatar name={r.fullName} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {r.fullName}
                    {r.me ? <Badge tone="info">Anda</Badge> : null}
                    {!r.isActive ? <Badge>Nonaktif</Badge> : null}
                  </p>
                  <p className="truncate text-xs text-ink-muted">
                    {[r.username && `@${r.username}`, r.email].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="hidden text-right sm:block">
                  <p className="text-[13px] font-medium">{ROLE_LABEL[r.role]}</p>
                  <p className="text-xs text-ink-muted">
                    {SCOPED.includes(r.role) ? (r.allProjects ? "Semua proyek" : `${r.projects} proyek`) : "Semua proyek"} · {r.lastLogin}
                  </p>
                </div>
                <Pencil aria-hidden className="size-4 shrink-0 text-ink-faint" />
              </button>
            </li>
          ))}
        </ul>
      </div>

      <Sheet open={edit !== null} onClose={() => setEdit(null)} title={v ? `Ubah ${v.fullName}` : "Tambah pengguna"} size="lg">
        {edit !== null ? (
          <form key={v?.id ?? "baru"} action={action} className="grid gap-4 sm:grid-cols-2">
            {v ? <input type="hidden" name="id" value={v.id} /> : null}
            <input type="hidden" name="role" value={role} />
            <ActionFeedback state={state} className="sm:col-span-2" />
            <Field label="Nama lengkap" htmlFor="u-name" required className="sm:col-span-2">
              <Input id="u-name" name="fullName" defaultValue={v?.fullName} required maxLength={120} />
            </Field>
            <Field label="Username" htmlFor="u-username" help="Untuk masuk. Huruf kecil, tanpa spasi.">
              <Input id="u-username" name="username" defaultValue={v?.username} autoCapitalize="none" maxLength={50} />
            </Field>
            <Field label="Email" htmlFor="u-email">
              <Input id="u-email" name="email" type="email" defaultValue={v?.email} />
            </Field>
            <Field label="Telepon / WA" htmlFor="u-phone" className="sm:col-span-2">
              <Input id="u-phone" name="phone" type="tel" defaultValue={v?.phone} />
            </Field>
            <fieldset className="sm:col-span-2">
              <legend className="mb-1.5 text-[13px] font-medium">Peran</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {ROLES.map((r) => (
                  <label
                    key={r}
                    className={cn(
                      "cursor-pointer rounded-lg border p-3",
                      role === r ? "border-primary-400 bg-primary-50 ring-1 ring-primary-400" : "border-border hover:bg-surface-muted",
                      v?.me && role !== r && "pointer-events-none opacity-50",
                    )}
                  >
                    <input type="radio" name="_role" value={r} checked={role === r} onChange={() => setRole(r)} className="sr-only" disabled={v?.me} />
                    <span className="block text-sm font-semibold">{ROLE_LABEL[r]}</span>
                    <span className="block text-[12.5px] leading-snug text-ink-muted">{ROLE_DESCRIPTION[r]}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {SCOPED.includes(role) ? (
              <Checkbox
                name="allProjects"
                value="1"
                defaultChecked={v?.allProjects}
                label="Boleh melihat semua proyek"
                description="Kalau tidak dicentang, hanya proyek tempat ia menjadi anggota (atur di halaman proyek)."
                className="sm:col-span-2"
              />
            ) : null}
            <Checkbox name="isActive" value="1" defaultChecked={v ? v.isActive : true} disabled={v?.me} label="Aktif" description="Akun nonaktif tidak bisa masuk; semua sesinya langsung diputus." />
            {v ? (
              <Checkbox name="resetPassword" value="1" label="Reset password" description="Buat password sementara baru." />
            ) : (
              <p className="flex items-start gap-2 rounded-md bg-surface-muted p-3 text-[13px] text-ink-muted">
                <KeyRound aria-hidden className="mt-0.5 size-4 shrink-0" /> Password sementara dibuat otomatis setelah disimpan.
              </p>
            )}
            {v?.me ? <input type="hidden" name="isActive" value="1" /> : null}
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button variant="ghost" onClick={() => setEdit(null)}>
                Batal
              </Button>
              <SubmitButton>Simpan</SubmitButton>
            </div>
          </form>
        ) : null}
      </Sheet>
    </>
  );
}
