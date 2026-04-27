import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Select } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
} from "lucide-react";

interface EntityInfo {
  key: string;
  label: string;
  headers: string[];
  note?: string | null;
}

interface ImportResult {
  entity: string;
  total_rows: number;
  valid_count: number;
  error_count: number;
  committed: boolean;
  samples: any[];
  errors: { row: number; message: string; raw: any }[];
}

export default function ImportsPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [entity, setEntity] = useState<string>("transactions");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | "template" | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const entitiesQ = useQuery({
    queryKey: ["import-entities"],
    queryFn: async () => (await api.get<EntityInfo[]>("/imports/")).data,
  });

  const current = entitiesQ.data?.find((e) => e.key === entity);

  async function downloadTemplate() {
    setBusy("template");
    setError(null);
    try {
      const res = await api.get(`/imports/${entity}/template`, { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = `template-${entity}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Gagal mengunduh template");
    } finally {
      setBusy(null);
    }
  }

  async function process(action: "preview" | "commit") {
    if (!file) return;
    setBusy(action);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await api.post(`/imports/${entity}/${action}`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setResult(res.data);
    } catch (e: any) {
      let detail = e?.response?.data?.detail || e?.message || "Gagal";
      if (e?.response?.data instanceof Blob) {
        try {
          const text = await e.response.data.text();
          const j = JSON.parse(text);
          detail = j?.detail || text;
        } catch {
          /* ignore */
        }
      }
      setError(detail);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHeader
        back
        title="Import Data"
        subtitle="Unggah XLSX untuk membuat banyak data sekaligus"
      />

      <Card>
        <Field label="Modul">
          <Select value={entity} onChange={(e) => { setEntity(e.target.value); setResult(null); setError(null); }}>
            {entitiesQ.data?.map((e) => (
              <option key={e.key} value={e.key}>
                {e.label}
              </option>
            ))}
          </Select>
        </Field>

        {current && (
          <>
            <div className="text-xs text-slate-500 mb-2">
              Kolom: <span className="font-mono">{current.headers.join(", ")}</span>
            </div>
            {current.note && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-2 text-xs text-amber-800 mb-2">
                {current.note}
              </div>
            )}
            <Button variant="secondary" size="sm" onClick={downloadTemplate} disabled={busy === "template"}>
              {busy === "template" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Unduh Template
            </Button>
          </>
        )}
      </Card>

      <Card className="mt-3">
        <div className="text-sm font-semibold mb-2">1. Pilih file XLSX</div>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => {
            setFile(e.target.files?.[0] || null);
            setResult(null);
            setError(null);
          }}
        />
        <Button variant="secondary" onClick={() => fileRef.current?.click()}>
          <FileSpreadsheet className="h-4 w-4" /> Pilih File
        </Button>
        {file && (
          <div className="mt-2 text-sm text-slate-700">
            <b>{file.name}</b>{" "}
            <span className="text-slate-500">({(file.size / 1024).toFixed(1)} KB)</span>
          </div>
        )}
      </Card>

      <Card className="mt-3">
        <div className="text-sm font-semibold mb-2">2. Review (dry-run) lalu Commit</div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => process("preview")} disabled={!file || !!busy}>
            {busy === "preview" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Preview (tidak menyimpan)
          </Button>
          <Button
            variant="success"
            onClick={() => {
              if (!confirm("Yakin ingin meng-commit data ke database?")) return;
              process("commit");
            }}
            disabled={!file || !!busy || !result}
          >
            {busy === "commit" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Commit Import
          </Button>
        </div>
        {!result && file && (
          <div className="mt-2 text-xs text-slate-500">
            Klik Preview dulu untuk validasi, baru Commit setelah hasilnya OK.
          </div>
        )}
      </Card>

      {error && (
        <Card className="mt-3 border-rose-200 bg-rose-50">
          <div className="flex items-start gap-2 text-sm text-rose-700">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <div>{error}</div>
          </div>
        </Card>
      )}

      {result && (
        <Card className="mt-3">
          <div className="flex items-center gap-2 mb-2">
            <Badge tone="info">Total: {result.total_rows}</Badge>
            <Badge tone="good">Valid: {result.valid_count}</Badge>
            {result.error_count > 0 && <Badge tone="bad">Error: {result.error_count}</Badge>}
            <Badge tone={result.committed ? "good" : "warn"}>
              {result.committed ? "Sudah disimpan" : "Belum disimpan (preview)"}
            </Badge>
          </div>

          {result.errors.length > 0 && (
            <div className="mb-3">
              <div className="text-sm font-semibold text-rose-700 mb-1">Error:</div>
              <ul className="space-y-1 text-xs max-h-48 overflow-y-auto rounded border border-rose-200 bg-rose-50 p-2">
                {result.errors.map((er, i) => (
                  <li key={i} className="text-rose-800">
                    <b>Baris {er.row}:</b> {er.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.samples.length > 0 && (
            <div>
              <div className="text-sm font-semibold mb-1">Contoh data valid:</div>
              <ul className="space-y-1 text-xs max-h-48 overflow-y-auto rounded border border-slate-200 bg-slate-50 p-2 font-mono">
                {result.samples.map((s, i) => (
                  <li key={i}>{JSON.stringify(s)}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
