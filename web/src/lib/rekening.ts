import "server-only";
import type { ComboOption } from "@/components/ui/combobox";
import { saldoRekening } from "@/lib/keuangan/queries";
import { rupiah } from "@/lib/uang";

/** Rekening aktif sebagai opsi Combobox, dengan saldo sebagai petunjuk. */
export async function opsiRekening(): Promise<ComboOption[]> {
  const rows = await saldoRekening();
  return rows
    .filter((r) => r.isActive)
    .map((r) => ({
      value: r.id,
      label: r.name,
      hint: `Saldo ${rupiah(r.saldo)}${r.bankName ? ` · ${r.bankName}` : ""}`,
    }));
}
