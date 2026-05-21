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
  /** Default false -- exclude system project NON_PROJECT. Set true di
   *  form Catatan Non-Proyek (utk locked project_id). */
  includeNonProject?: boolean
  /** Optional: scope list ke 1 company. Berguna utk skenario pindah
   *  proyek dlm 1 perusahaan (mis. DRAFT tx) supaya picker tidak
   *  menampilkan proyek company lain. */
  companyId?: number | null
}

export function ProjectPicker({
  value,
  onChange,
  placeholder = "Pilih proyek",
  disabled,
  activeOnly = true,
  includeNonProject = false,
  companyId,
}: ProjectPickerProps) {
  const { data, isLoading } = useProjects({
    ...(activeOnly ? { status: "AKTIF" } : {}),
    ...(includeNonProject ? { include_non_project: true } : {}),
    ...(companyId ? { company_id: companyId } : {}),
  })
  const options = useMemo<ComboboxOption[]>(() => {
    return (data?.items ?? []).map((p) => {
      // System project NON_PROJECT punya nama generik "Catatan Non-Proyek"
      // -- 1 per company. Tanpa suffix company_name, multi-company user
      // lihat banyak baris identik. Tambah suffix supaya bisa dibedakan.
      const isNp = p.kind === "NON_PROJECT"
      const label = isNp && p.company_name
        ? `${p.name} — ${p.company_name}`
        : p.name
      return { value: p.id, label, hint: p.code }
    })
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
