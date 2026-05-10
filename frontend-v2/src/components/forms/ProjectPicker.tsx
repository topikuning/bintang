import { useMemo } from "react"
import { useProjects } from "@/hooks/useProjects"
import { Combobox, type ComboboxOption } from "./Combobox"

interface ProjectPickerProps {
  value: number | null | undefined
  onChange: (id: number | null) => void
  placeholder?: string
  disabled?: boolean
  /** Default true -- hanya tampilkan proyek aktif. */
  activeOnly?: boolean
}

export function ProjectPicker({
  value,
  onChange,
  placeholder = "Pilih proyek",
  disabled,
  activeOnly = true,
}: ProjectPickerProps) {
  const { data, isLoading } = useProjects(activeOnly ? { status: "AKTIF" } : {})
  const options = useMemo<ComboboxOption[]>(() => {
    return (data?.items ?? []).map((p) => ({
      value: p.id,
      label: p.name,
      hint: p.code,
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
      sheetTitle="Pilih Proyek"
      emptyMessage="Tidak ada proyek yang cocok"
    />
  )
}
