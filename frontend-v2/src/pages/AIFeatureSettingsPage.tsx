/**
 * Halaman Setting AI per Fitur -- SUPERADMIN.
 *
 * Audit 2026-05-24 user req: admin atur sendiri provider/model/budget
 * tiap AI command. Default selalu di code, override per feature di DB.
 *
 * Field yg bisa di-override: provider, model, max_tokens, cache_ttl_days,
 * rate_limit_per_min, web_search_enabled, monthly_budget_usd.
 *
 * Monthly spending ditampilkan real-time vs budget cap kalau diset.
 */
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangle, Cpu, DollarSign, Globe, Loader2, RotateCcw,
  SlidersHorizontal,
} from "lucide-react"

import { useAuthStore } from "@/store/auth"
import { api, apiErrorMessage } from "@/lib/api"
import { usePageTitle } from "@/hooks/usePageTitle"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/data/EmptyState"
import { ErrorState } from "@/components/data/ErrorState"
import { toast } from "@/components/ui/sonner"
import { cn } from "@/lib/utils"

interface FeatureSettings {
  feature_key: string
  label: string
  description: string
  provider: string | null
  model: string | null
  model_hint: string
  max_tokens: number
  cache_ttl_days: number
  rate_limit_per_min: number
  web_search_enabled: boolean
  monthly_budget_usd: string | number | null
  overridden_fields: string[]
  monthly_spend_usd: string | number
  defaults: Record<string, unknown>
  updated_at: string | null
  updated_by_id: number | null
}

interface SupportedModel {
  id: string
  provider: string
  label: string
}

interface ListResp {
  features: FeatureSettings[]
  supported_models: SupportedModel[]
}

export function AIFeatureSettingsPage() {
  usePageTitle("Setting AI per Fitur")
  const role = useAuthStore((s) => s.user?.role)
  const qc = useQueryClient()
  const [editing, setEditing] = useState<FeatureSettings | null>(null)

  const listQ = useQuery({
    queryKey: ["ai-feature-settings"],
    queryFn: async (): Promise<ListResp> => {
      const { data } = await api.get<ListResp>("/ai-feature-settings/")
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
          <SlidersHorizontal className="h-5 w-5 text-brand-600" />
          <h1 className="text-xl font-bold text-ink-900 sm:text-2xl">
            Setting AI per Fitur
          </h1>
        </div>
        <p className="text-[13px] text-ink-500 mt-0.5">
          Atur provider / model / budget / cache per AI command. Default
          selalu fallback dari kode kalau field kosong. Spending bulanan
          ditampilkan real-time.
        </p>
      </div>

      {listQ.isLoading && <Skeleton className="h-96" />}
      {listQ.error && <ErrorState description={apiErrorMessage(listQ.error)} />}

      {listQ.data && (
        <div className="flex flex-col gap-3">
          {listQ.data.features.map((feat) => (
            <FeatureCard
              key={feat.feature_key}
              feature={feat}
              onEdit={() => setEditing(feat)}
              onReset={async () => {
                if (!confirm(`Reset semua setting "${feat.label}" ke default?`)) return
                try {
                  await api.delete(`/ai-feature-settings/${feat.feature_key}`)
                  toast.success("Direset ke default")
                  qc.invalidateQueries({ queryKey: ["ai-feature-settings"] })
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
          feature={editing}
          models={listQ.data?.supported_models ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["ai-feature-settings"] })
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

// ============================================================
function FeatureCard({
  feature,
  onEdit,
  onReset,
}: {
  feature: FeatureSettings
  onEdit: () => void
  onReset: () => void
}) {
  const hasOverride = feature.overridden_fields.length > 0
  const spend = Number(feature.monthly_spend_usd)
  const budget = feature.monthly_budget_usd != null ? Number(feature.monthly_budget_usd) : null
  const pct = budget ? (spend / budget) * 100 : 0
  const overBudget = budget != null && spend >= budget
  return (
    <div className="rounded-md border bg-surface p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-ink-900">{feature.label}</h2>
            <code className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] font-mono text-ink-600">
              {feature.feature_key}
            </code>
            {hasOverride && (
              <span className="rounded bg-warning-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-warning-800">
                Custom
              </span>
            )}
          </div>
          <p className="text-[12px] text-ink-500 mt-0.5">{feature.description}</p>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={onEdit}>
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Edit
          </Button>
          {hasOverride && (
            <Button size="sm" variant="ghost" onClick={onReset} className="text-danger-700">
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12px]">
        <Field
          icon={Cpu}
          label="Model"
          value={feature.model ?? `auto (${feature.model_hint})`}
          overridden={feature.overridden_fields.includes("model") || feature.overridden_fields.includes("provider")}
        />
        <Field
          icon={Globe}
          label="Web Search"
          value={feature.web_search_enabled ? "Aktif" : "Mati"}
          overridden={feature.overridden_fields.includes("web_search_enabled")}
        />
        <Field
          label="Max tokens"
          value={String(feature.max_tokens)}
          overridden={feature.overridden_fields.includes("max_tokens")}
        />
        <Field
          label="Cache TTL"
          value={`${feature.cache_ttl_days} hari`}
          overridden={feature.overridden_fields.includes("cache_ttl_days")}
        />
      </div>

      <div className="mt-3 rounded border bg-surface-muted/40 px-3 py-2">
        <div className="flex items-center justify-between text-[12px]">
          <div className="flex items-center gap-1.5 text-ink-600">
            <DollarSign className="h-3.5 w-3.5" />
            Spending bulan ini
          </div>
          <div className={cn(
            "font-mono",
            overBudget ? "text-danger-700 font-bold" : "text-ink-900",
          )}>
            ${spend.toFixed(4)}
            {budget != null && <span className="text-ink-500"> / ${budget.toFixed(4)}</span>}
          </div>
        </div>
        {budget != null && (
          <div className="mt-1 h-1.5 rounded bg-ink-100 overflow-hidden">
            <div
              className={cn(
                "h-full transition-all",
                overBudget ? "bg-danger-500" :
                pct > 80 ? "bg-warning-500" : "bg-brand-500",
              )}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
        )}
        {overBudget && (
          <div className="mt-1 flex items-center gap-1 text-[11px] text-danger-700">
            <AlertTriangle className="h-3 w-3" />
            Budget bulanan habis -- panggilan AI ke fitur ini sementara ditolak.
          </div>
        )}
      </div>
    </div>
  )
}

function Field({
  icon: Icon,
  label,
  value,
  overridden,
}: {
  icon?: typeof Cpu
  label: string
  value: string
  overridden: boolean
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-ink-500">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
      </div>
      <div className={cn(
        "font-mono text-[12px] truncate",
        overridden ? "text-warning-800 font-semibold" : "text-ink-900",
      )}>
        {value}
      </div>
    </div>
  )
}

// ============================================================
function EditDialog({
  feature,
  models,
  onClose,
  onSaved,
}: {
  feature: FeatureSettings
  models: SupportedModel[]
  onClose: () => void
  onSaved: () => void
}) {
  const [provider, setProvider] = useState<string>(feature.provider ?? "")
  const [model, setModel] = useState<string>(feature.model ?? "")
  const [maxTokens, setMaxTokens] = useState<string>(String(feature.max_tokens))
  const [cacheTtl, setCacheTtl] = useState<string>(String(feature.cache_ttl_days))
  const [rateLimit, setRateLimit] = useState<string>(String(feature.rate_limit_per_min))
  const [webSearch, setWebSearch] = useState<boolean>(feature.web_search_enabled)
  const [budget, setBudget] = useState<string>(
    feature.monthly_budget_usd != null ? String(feature.monthly_budget_usd) : "",
  )

  const defaults = feature.defaults

  const filteredModels = provider
    ? models.filter((m) => m.provider === provider)
    : models

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        provider: provider || null,
        model: model || null,
        max_tokens: Number(maxTokens),
        cache_ttl_days: Number(cacheTtl),
        rate_limit_per_min: Number(rateLimit),
        web_search_enabled: webSearch,
        monthly_budget_usd: budget ? Number(budget) : null,
      }
      const { data } = await api.put(
        `/ai-feature-settings/${feature.feature_key}`, payload,
      )
      return data
    },
    onSuccess: () => {
      toast.success("Setting tersimpan")
      onSaved()
    },
    onError: (e) => toast.error("Gagal simpan", { description: apiErrorMessage(e) }),
  })

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Setting AI — {feature.label}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label className="text-[11px] uppercase tracking-wider">
                Provider
              </Label>
              <Select
                value={provider}
                onChange={(e) => {
                  setProvider(e.target.value)
                  if (e.target.value && model) {
                    const m = models.find((mm) => mm.id === model)
                    if (m && m.provider !== e.target.value) setModel("")
                  }
                }}
              >
                <option value="">— Pakai default sistem —</option>
                <option value="mistral">Mistral</option>
                <option value="claude">Claude (Anthropic)</option>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[11px] uppercase tracking-wider">
                Model
              </Label>
              <Select value={model} onChange={(e) => setModel(e.target.value)}>
                <option value="">— Auto (hint: {feature.model_hint}) —</option>
                {filteredModels.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label className="text-[11px] uppercase tracking-wider">
                Max Output Tokens
              </Label>
              <Input
                type="number"
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
                min={1} max={200000}
              />
              <span className="text-[10px] text-ink-500">
                default: {String(defaults.max_tokens)}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[11px] uppercase tracking-wider">
                Cache TTL (hari)
              </Label>
              <Input
                type="number"
                value={cacheTtl}
                onChange={(e) => setCacheTtl(e.target.value)}
                min={0} max={365}
              />
              <span className="text-[10px] text-ink-500">
                default: {String(defaults.cache_ttl_days)} · 0 = tdk cache
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label className="text-[11px] uppercase tracking-wider">
                Rate Limit /menit (per user)
              </Label>
              <Input
                type="number"
                value={rateLimit}
                onChange={(e) => setRateLimit(e.target.value)}
                min={1}
              />
              <span className="text-[10px] text-ink-500">
                default: {String(defaults.rate_limit_per_min)}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[11px] uppercase tracking-wider">
                Budget Bulanan (USD)
              </Label>
              <Input
                type="number"
                step="0.01"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                placeholder="kosong = unlimited"
              />
              <span className="text-[10px] text-ink-500">
                Hard cap. Lewat → AI call ditolak sampai bulan depan.
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded border px-3 py-2">
            <input
              type="checkbox"
              id="web-search"
              checked={webSearch}
              onChange={(e) => setWebSearch(e.target.checked)}
              className="h-4 w-4 accent-brand-600"
            />
            <Label htmlFor="web-search" className="cursor-pointer flex-1">
              Web Search aktif
              <span className="block text-[11px] text-ink-500 font-normal">
                Hanya berlaku untuk fitur agentic (price check, /tanya v2, dst).
                Butuh model yg support web search (Claude Sonnet/Opus).
              </span>
            </Label>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t">
            <Button variant="secondary" onClick={onClose}>Batal</Button>
            <Button
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending}
            >
              {saveMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Simpan
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
