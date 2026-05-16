import { useMemo } from "react"
import { useProjects } from "@/hooks/useProjects"
import { MultiCombobox } from "./MultiCombobox"
import type { ComboboxOption } from "./Combobox"

interface MultiProjectPickerProps {
  value: number[]
  onChange: (ids: number[]) => void
  placeholder?: string
  disabled?: boolean
  /** Default true -- hanya proyek aktif. */
  activeOnly?: boolean
  className?: string
}

/**
 * Multi-select picker proyek aktif. Kepakai di filter list pages
 * (Transaksi/Invoice/PO) supaya user bisa cek beberapa proyek
 * sekaligus.
 *
 * Lihat juga `ProjectPicker` utk single-select (mis. di form create
 * tx -- 1 tx = 1 proyek).
 */
export function MultiProjectPicker({
  value,
  onChange,
  placeholder = "Semua proyek",
  disabled,
  activeOnly = true,
  className,
}: MultiProjectPickerProps) {
  const { data, isLoading } = useProjects(activeOnly ? { status: "AKTIF" } : {})
  const options = useMemo<ComboboxOption[]>(() => {
    return (data?.items ?? []).map((p) => ({
      value: p.id,
      label: p.name,
      hint: p.code,
    }))
  }, [data])

  return (
    <MultiCombobox<number>
      value={value}
      onChange={onChange}
      options={options}
      placeholder={placeholder}
      isLoading={isLoading}
      disabled={disabled}
      sheetTitle="Filter Proyek"
      emptyMessage="Belum ada proyek aktif."
      className={className}
    />
  )
}
