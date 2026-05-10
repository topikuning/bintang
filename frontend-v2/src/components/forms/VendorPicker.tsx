import { useMemo } from "react"
import { useVendors } from "@/hooks/useVendors"
import type { VendorClientType } from "@/types/api"
import { Combobox, type ComboboxOption } from "./Combobox"

interface VendorPickerProps {
  value: number | null | undefined
  onChange: (id: number | null) => void
  /** Filter by type: VENDOR (supplier), CLIENT (pemberi pekerjaan), atau BOTH. */
  kind?: VendorClientType
  placeholder?: string
  disabled?: boolean
}

export function VendorPicker({
  value,
  onChange,
  kind,
  placeholder = "Pilih vendor / klien",
  disabled,
}: VendorPickerProps) {
  const { data, isLoading } = useVendors(kind ? { type: kind } : {})
  const options = useMemo<ComboboxOption[]>(() => {
    return (data?.items ?? []).map((v) => ({
      value: v.id,
      label: v.name,
      hint: v.npwp ? `NPWP ${v.npwp}` : undefined,
    }))
  }, [data])

  return (
    <Combobox
      value={value ?? null}
      onChange={(v) => onChange(v == null ? null : Number(v))}
      options={options}
      placeholder={placeholder}
      isLoading={isLoading}
      disabled={disabled}
      clearable
      sheetTitle="Pilih Vendor / Klien"
      emptyMessage="Belum ada vendor / klien"
    />
  )
}
