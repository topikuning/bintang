import { useMemo } from "react"
import { useCompanies } from "@/hooks/useCompanies"
import { Combobox, type ComboboxOption } from "./Combobox"

interface CompanyPickerProps {
  value: number | null | undefined
  onChange: (id: number | null) => void
  placeholder?: string
  disabled?: boolean
}

export function CompanyPicker({
  value,
  onChange,
  placeholder = "Pilih perusahaan",
  disabled,
}: CompanyPickerProps) {
  const { data, isLoading } = useCompanies()
  const options = useMemo<ComboboxOption[]>(() => {
    return (data?.items ?? []).map((c) => ({
      value: c.id,
      label: c.name,
      hint: c.npwp ?? undefined,
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
      sheetTitle="Pilih Perusahaan"
      emptyMessage="Belum ada perusahaan"
    />
  )
}
