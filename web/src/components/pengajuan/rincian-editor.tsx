"use client";

import { Calculator, Plus, Trash2 } from "lucide-react";
import { Combobox, type ComboOption } from "@/components/ui/combobox";
import { FieldError, Input } from "@/components/ui/field";
import { MoneyInput } from "@/components/ui/money-input";
import { cn } from "@/lib/cn";
import { barisBaru, jumlahBaris, type Baris } from "@/lib/pengajuan/baris";
import { formatIsian, rupiah } from "@/lib/uang";

export { barisBaru, barisKeJson, jumlahBaris, type Baris } from "@/lib/pengajuan/baris";

export function RincianEditor({
  rows,
  onChange,
  categories,
  errors,
  allowDetail = true,
  addLabel = "Tambah rincian",
}: {
  rows: Baris[];
  onChange: (rows: Baris[]) => void;
  categories: ComboOption[];
  errors?: Record<string, string>;
  allowDetail?: boolean;
  addLabel?: string;
}) {
  const ubah = (i: number, patch: Partial<Baris>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const hapus = (i: number) => onChange(rows.length === 1 ? [barisBaru()] : rows.filter((_, j) => j !== i));

  return (
    <div className="space-y-3">
      {rows.map((r, i) => {
        const err = (k: string) => errors?.[`items.${i}.${k}`];
        const total = jumlahBaris(r);
        return (
          <div key={r.key} className="rounded-lg border border-border bg-surface-muted/60 p-3">
            <div className="flex items-start gap-2">
              <span className="tabular mt-2.5 w-5 shrink-0 text-center text-xs font-semibold text-ink-faint">{i + 1}</span>
              <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_12rem]">
                <div className="min-w-0">
                  <Input
                    aria-label={`Uraian rincian ${i + 1}`}
                    placeholder="Uraian, mis. Semen 50 kg"
                    value={r.description}
                    onChange={(e) => ubah(i, { description: e.target.value })}
                    invalid={!!err("description")}
                    maxLength={300}
                  />
                  <FieldError>{err("description")}</FieldError>
                </div>
                <div className="min-w-0">
                  <Combobox
                    aria-label={`Kategori rincian ${i + 1}`}
                    options={categories}
                    value={r.categoryId}
                    onChange={(v) => ubah(i, { categoryId: v })}
                    placeholder="Kategori"
                    invalid={!!err("categoryId") && !r.categoryId}
                  />
                  {!r.categoryId ? <FieldError>{err("categoryId")}</FieldError> : null}
                </div>
              </div>
              <button
                type="button"
                onClick={() => hapus(i)}
                aria-label={`Hapus rincian ${i + 1}`}
                className="flex size-10 shrink-0 items-center justify-center rounded-md text-ink-faint hover:bg-danger-soft hover:text-danger"
              >
                <Trash2 aria-hidden className="size-4" />
              </button>
            </div>

            <div className="mt-2 flex flex-wrap items-end gap-2 pl-7 sm:pr-12">
              {r.rinci ? (
                <>
                  <div className="w-20">
                    <Input
                      aria-label="Kuantitas"
                      inputMode="decimal"
                      placeholder="Qty"
                      value={r.quantity}
                      onChange={(e) => ubah(i, { quantity: e.target.value.replace(/[^\d.,]/g, "") })}
                      className="text-right"
                    />
                  </div>
                  <div className="w-20">
                    <Input
                      aria-label="Satuan"
                      placeholder="sak"
                      value={r.unit}
                      onChange={(e) => ubah(i, { unit: e.target.value })}
                      maxLength={20}
                    />
                  </div>
                  <span className="pb-2.5 text-ink-faint">×</span>
                  <MoneyInput
                    aria-label="Harga satuan"
                    className="w-36"
                    value={r.unitPrice}
                    onChange={(v) => ubah(i, { unitPrice: v })}
                  />
                  <span className="pb-2.5 text-ink-faint">=</span>
                  <span className="tabular min-w-28 flex-1 pb-2 text-right text-sm font-semibold">{rupiah(total)}</span>
                </>
              ) : (
                <MoneyInput
                  aria-label={`Jumlah rincian ${i + 1}`}
                  className="min-w-40 flex-1 sm:max-w-56 sm:flex-none"
                  value={r.amount}
                  onChange={(v) => ubah(i, { amount: v })}
                  invalid={!!err("amount")}
                />
              )}
              {allowDetail ? (
                <button
                  type="button"
                  onClick={() =>
                    ubah(
                      i,
                      r.rinci
                        ? { rinci: false, amount: total > 0n ? formatIsian(total.toString()) : r.amount }
                        : { rinci: true, quantity: r.quantity || "1", unitPrice: r.unitPrice || r.amount },
                    )
                  }
                  className={cn(
                    "inline-flex h-10 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium pointer-coarse:h-11",
                    r.rinci ? "text-primary-700 hover:bg-primary-50" : "text-ink-muted hover:bg-surface-inset hover:text-ink",
                  )}
                >
                  <Calculator aria-hidden className="size-4" />
                  {r.rinci ? "Jumlah langsung" : "Qty × harga"}
                </button>
              ) : null}
            </div>
            {err("amount") ? <FieldError className="pl-7">{err("amount")}</FieldError> : null}
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => onChange([...rows, barisBaru()])}
        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong text-sm font-medium text-primary-700 hover:border-primary-400 hover:bg-primary-50 pointer-coarse:h-11"
      >
        <Plus aria-hidden className="size-4" /> {addLabel}
      </button>
    </div>
  );
}
