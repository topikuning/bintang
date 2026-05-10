import { useState } from "react"
import { Check, ChevronDown, FolderKanban } from "lucide-react"
import { useProjects } from "@/hooks/useProjects"
import { useUIPrefs } from "@/store/ui-prefs"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useBreakpoint } from "@/lib/breakpoint"
import { cn } from "@/lib/utils"

/**
 * Picker proyek aktif di topbar.
 * Desktop/tablet: dropdown.
 * Mobile: bottom sheet (lebih ergonomis utk thumb).
 */
export function ProjectSwitcher() {
  const bp = useBreakpoint()
  const { defaultProjectId, setDefaultProject } = useUIPrefs()
  const { data, isLoading } = useProjects({ is_active: true })
  const [sheetOpen, setSheetOpen] = useState(false)

  const projects = data?.items ?? []
  const current = projects.find((p) => p.id === defaultProjectId) ?? null

  const buttonContent = (
    <>
      <FolderKanban className="h-4 w-4 text-ink-500" />
      <span className="truncate max-w-[160px] sm:max-w-[240px] text-left">
        {isLoading ? "Memuat…" : current?.name ?? "Semua Proyek"}
      </span>
      <ChevronDown className="h-4 w-4 text-ink-400 shrink-0" />
    </>
  )

  if (bp === "mobile") {
    return (
      <>
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="inline-flex h-10 items-center gap-2 rounded border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-muted"
        >
          {buttonContent}
        </button>
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent side="bottom" className="max-h-[80vh] flex flex-col">
            <SheetHeader>
              <SheetTitle>Pilih Proyek</SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto px-2 py-2">
              <ProjectListItem
                isAll
                selected={defaultProjectId == null}
                onClick={() => {
                  setDefaultProject(null)
                  setSheetOpen(false)
                }}
              />
              {projects.map((p) => (
                <ProjectListItem
                  key={p.id}
                  name={p.name}
                  code={p.code}
                  selected={defaultProjectId === p.id}
                  onClick={() => {
                    setDefaultProject(p.id)
                    setSheetOpen(false)
                  }}
                />
              ))}
            </div>
          </SheetContent>
        </Sheet>
      </>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" className="gap-2">
          {buttonContent}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72 max-h-[60vh] overflow-y-auto">
        <DropdownMenuLabel>Proyek</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => setDefaultProject(null)}>
          {defaultProjectId == null && <Check className="h-4 w-4 text-brand-600" />}
          <span className={cn("flex-1", defaultProjectId == null && "font-semibold text-brand-700")}>
            Semua Proyek
          </span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {projects.map((p) => (
          <DropdownMenuItem key={p.id} onSelect={() => setDefaultProject(p.id)}>
            {defaultProjectId === p.id && <Check className="h-4 w-4 text-brand-600" />}
            <div className={cn("flex flex-col gap-0.5 flex-1 min-w-0", defaultProjectId === p.id && "text-brand-700")}>
              <span className="truncate text-sm font-medium">{p.name}</span>
              <span className="text-[11px] text-ink-500">{p.code}</span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ProjectListItem({
  name,
  code,
  isAll,
  selected,
  onClick,
}: {
  name?: string
  code?: string
  isAll?: boolean
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded px-3 py-3 text-left transition-colors",
        selected ? "bg-brand-50" : "hover:bg-ink-100",
      )}
    >
      <div className="flex h-8 w-8 items-center justify-center rounded bg-brand-100 text-brand-700">
        <FolderKanban className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        {isAll ? (
          <div className="font-semibold">Semua Proyek</div>
        ) : (
          <>
            <div className="truncate text-sm font-medium">{name}</div>
            <div className="text-[11px] text-ink-500">{code}</div>
          </>
        )}
      </div>
      {selected && <Check className="h-5 w-5 text-brand-600 shrink-0" />}
    </button>
  )
}
