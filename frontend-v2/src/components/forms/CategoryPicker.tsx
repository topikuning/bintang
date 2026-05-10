import { useMemo } from "react"
import { useCategories } from "@/hooks/useCategories"
import type { TxnType } from "@/types/api"
import { Combobox, type ComboboxOption } from "./Combobox"

interface CategoryPickerProps {
  value: number | null | undefined
  onChange: (id: number | null) => void
  /** Filter kategori yg sesuai arah transaksi (opsional). */
  type?: TxnType
  placeholder?: string
  disabled?: boolean
}

export function CategoryPicker({
  value,
  onChange,
  type,
  placeholder = "Pilih kategori",
  disabled,
}: CategoryPickerProps) {
  const { data, isLoading } = useCategories()
  const options = useMemo<ComboboxOption[]>(() => {
    let items = data?.items ?? []
    // Filter sesuai arah kalau diberikan.
    if (type) {
      items = items.filter((c) => c.type === type || c.type === "BOTH")
    }
    return items.map((c) => ({ value: c.id, label: c.name }))
  }, [data, type])

  return (
    <Combobox
      value={value ?? null}
      onChange={(v) => onChange(v == null ? null : Number(v))}
      options={options}
      placeholder={placeholder}
      isLoading={isLoading}
      disabled={disabled}
      clearable
      sheetTitle="Pilih Kategori"
      emptyMessage="Belum ada kategori"
    />
  )
}
