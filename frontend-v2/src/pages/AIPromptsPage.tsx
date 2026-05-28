/**
 * Halaman Prompt AI -- SUPERADMIN.
 *
 * Audit 2026-05-24 user req: admin bisa lihat prompt yg dipakai per
 * AI command + override kalau perlu tuning. Default selalu di code
 * (services/ai/prompt_registry.py), override disimpan di DB.
 *
 * Validation backend: placeholder yg di-declare di default WAJIB
 * tetap ada di override. Form save reject 400 kalau hilang.
 */
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertCircle, Edit3, Loader2, RotateCcw, Sparkles } from "lucide-react"

import { useAuthStore } from "@/store/auth"
import { api, apiErrorMessage } from "@/lib/api"
import { fmtDateTime } from "@/lib/format"
import { usePageTitle } from "@/hooks/usePageTitle"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/data/EmptyState"
import { ErrorState } from "@/components/data/ErrorState"
import { toast } from "@/components/ui/sonner"
import { cn } from "@/lib/utils"

interface PromptField {
  default: string
  current: string
  overridden: boolean
  placeholders_required: string[]
  placeholders_in_current: string[]
  updated_by_id: number | null
  updated_at: string | null
}

interface PromptFeature {
  key: string
  label: string
  description: string
  system: PromptField
  user_template: PromptField | null
}

interface PromptListResp {
  features: PromptFeature[]
}

export function AIPromptsPage() {
  usePageTitle("Prompt AI")
  const role = useAuthStore((s) => s.user?.role)
  const qc = useQueryClient()
  const [editing, setEditing] = useState<{
    feature: PromptFeature
    field: "system" | "user_template"
  } | null>(null)

  const listQ = useQuery({
    queryKey: ["ai-prompts"],
    queryFn: async (): Promise<PromptListResp> => {
      const { data } = await api.get<PromptListResp>("/ai-prompts/")
      return data
    },
  })

  if (role !== "SUPERADMIN") {
    return (
      <div className="p-3 sm:p-5 lg:p-6">
        <EmptyState
          title="Akses Ditolak"
          description="Halaman ini hanya untuk SUPERADMIN."
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-5 lg:p-6 max-w-5xl">
      <div>
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-brand-600" />
          <h1 className="text-xl font-bold text-ink-900 sm:text-2xl">Prompt AI</h1>
        </div>
        <p className="text-[13px] text-ink-500 mt-0.5">
          Setiap AI command sistem pakai prompt yg di-define di kode. Bisa
          di-override sini kalau perlu tuning. Placeholder dalam{" "}
          <code className="bg-ink-100 px-1 rounded text-[12px]">{"{kurung}"}</code>{" "}
          wajib dipertahankan supaya feature tdk error.
        </p>
      </div>

      {listQ.isLoading && <Skeleton className="h-96" />}
      {listQ.error && <ErrorState description={apiErrorMessage(listQ.error)} />}

      {listQ.data && (
        <div className="flex flex-col gap-3">
          {listQ.data.features.map((feat) => (
            <FeatureCard
              key={feat.key}
              feature={feat}
              onEdit={(field) => setEditing({ feature: feat, field })}
              onReset={async (field) => {
                if (!confirm(`Reset ${field} ke default?`)) return
                try {
                  await api.delete(`/ai-prompts/${feat.key}/${field}`)
                  toast.success("Direset ke default")
                  qc.invalidateQueries({ queryKey: ["ai-prompts"] })
                } catch (e) {
                  toast.error("Gagal reset", { description: apiErrorMessage(e) })
                }
              }}
            />
          ))}
        </div>
      )}

      {editing && (
        <EditDialog
          feature={editing.feature}
          field={editing.field}
          onClose={() => setEditing(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["ai-prompts"] })
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

// ============================================================
// Feature card
// ============================================================
function FeatureCard({
  feature,
  onEdit,
  onReset,
}: {
  feature: PromptFeature
  onEdit: (field: "system" | "user_template") => void
  onReset: (field: "system" | "user_template") => void
}) {
  return (
    <div className="rounded-md border bg-surface p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-ink-900">
              {feature.label}
            </h2>
            <code className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] font-mono text-ink-600">
              {feature.key}
            </code>
          </div>
          <p className="text-[12px] text-ink-500 mt-0.5">{feature.description}</p>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <FieldBlock
          label="System Prompt"
          field={feature.system}
          onEdit={() => onEdit("system")}
          onReset={() => onReset("system")}
        />
        {feature.user_template ? (
          <FieldBlock
            label="User Prompt Template"
            field={feature.user_template}
            onEdit={() => onEdit("user_template")}
            onReset={() => onReset("user_template")}
          />
        ) : (
          <div className="rounded border border-dashed bg-ink-50/50 p-3 text-[12px] text-ink-500">
            <em>(Tidak ada user prompt — feature ini vision-only.)</em>
          </div>
        )}
      </div>
    </div>
  )
}

function FieldBlock({
  label,
  field,
  onEdit,
  onReset,
}: {
  label: string
  field: PromptField
  onEdit: () => void
  onReset: () => void
}) {
  return (
    <div className="rounded border bg-surface-muted/30 p-2.5 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wider text-ink-600 font-semibold">
            {label}
          </span>
          {field.overridden && (
            <span className="rounded bg-warning-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-warning-800">
              Custom
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={onEdit} className="h-7 px-2">
            <Edit3 className="h-3.5 w-3.5" />
            Edit
          </Button>
          {field.overridden && (
            <Button size="sm" variant="ghost" onClick={onReset} className="h-7 px-2 text-danger-700">
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
          )}
        </div>
      </div>
      <pre className="text-[11.5px] font-mono text-ink-700 whitespace-pre-wrap break-words max-h-48 overflow-y-auto bg-surface rounded p-2 border">
        {field.current}
      </pre>
      {field.placeholders_required.length > 0 && (
        <div className="text-[11px] text-ink-500">
          Placeholder wajib:{" "}
          {field.placeholders_required.map((p) => (
            <code key={p} className="bg-ink-100 px-1 rounded font-mono">
              {`{${p}}`}
            </code>
          )).reduce<React.ReactNode[]>((acc, el, i) => {
            if (i > 0) acc.push(" ")
            acc.push(el)
            return acc
          }, [])}
        </div>
      )}
      {field.overridden && field.updated_at && (
        <div className="text-[10px] text-ink-400">
          Diubah {fmtDateTime(field.updated_at)}
        </div>
      )}
    </div>
  )
}

// ============================================================
// Edit dialog
// ============================================================
function EditDialog({
  feature,
  field,
  onClose,
  onSaved,
}: {
  feature: PromptFeature
  field: "system" | "user_template"
  onClose: () => void
  onSaved: () => void
}) {
  const target = field === "system" ? feature.system : feature.user_template!
  const [content, setContent] = useState(target.current)
  const required = new Set(target.placeholders_required)
  const present = new Set(extractPlaceholders(content))
  const missing = [...required].filter((p) => !present.has(p))

  const saveMut = useMutation({
    mutationFn: async () => {
      const { data } = await api.put(`/ai-prompts/${feature.key}/${field}`, {
        content,
      })
      return data
    },
    onSuccess: () => {
      toast.success("Tersimpan")
      onSaved()
    },
    onError: (e) =>
      toast.error("Gagal simpan", { description: apiErrorMessage(e) }),
  })

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {field === "system" ? "System Prompt" : "User Template"} —{" "}
            {feature.label}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {required.size > 0 && (
            <div className="rounded border border-info-200 bg-info-50 px-3 py-2 text-[12px] text-info-800">
              <div className="font-semibold">Placeholder wajib:</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {[...required].map((p) => (
                  <code
                    key={p}
                    className={cn(
                      "rounded px-1.5 py-0.5 font-mono text-[11px]",
                      present.has(p)
                        ? "bg-success-100 text-success-800"
                        : "bg-danger-100 text-danger-800",
                    )}
                  >
                    {`{${p}}`}
                  </code>
                ))}
              </div>
            </div>
          )}
          {missing.length > 0 && (
            <div className="rounded border border-danger-200 bg-danger-50 px-3 py-2 text-[12px] text-danger-800 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                Placeholder hilang: <strong>{missing.join(", ")}</strong>. Save
                akan ditolak backend.
              </span>
            </div>
          )}
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={20}
            className="font-mono text-[12px]"
            placeholder="Tulis prompt di sini..."
          />
          <div className="flex items-center justify-between gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setContent(target.default)}
              type="button"
            >
              Pakai default
            </Button>
            <div className="flex items-center gap-2">
              <Button size="md" variant="secondary" onClick={onClose} type="button">
                Batal
              </Button>
              <Button
                size="md"
                onClick={() => saveMut.mutate()}
                disabled={
                  saveMut.isPending ||
                  missing.length > 0 ||
                  content === target.current
                }
              >
                {saveMut.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Simpan
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Mirror extract_placeholders() di backend -- skip {{escaped}}.
function extractPlaceholders(s: string): string[] {
  const out = new Set<string>()
  let i = 0
  const n = s.length
  while (i < n) {
    const c = s[i]
    if (c === "{") {
      if (i + 1 < n && s[i + 1] === "{") {
        i += 2
        continue
      }
      let j = i + 1
      while (j < n && s[j] !== "}") j++
      if (j < n) {
        const name = s.slice(i + 1, j).trim()
        if (name && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) out.add(name)
        i = j + 1
        continue
      }
    }
    i++
  }
  return [...out]
}
