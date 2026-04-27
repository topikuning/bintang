import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import AttachmentUploader from "@/components/AttachmentUploader";
import PendingAttachmentPicker from "@/components/PendingAttachmentPicker";
import Combobox from "@/components/ui/Combobox";
import { Badge, statusTone } from "@/components/ui/Badge";
import type { Category, Page, Project, Transaction, VendorClient } from "@/types";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { cn, todayISO } from "@/lib/utils";
import { useAuthStore, isSuper } from "@/store/auth";

export default function TransactionForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const nav = useNavigate();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const [data, setData] = useState<Partial<Transaction>>({
    tx_date: todayISO(),
    type: "OUT",
    payment_method: "TRANSFER",
    party_type: "COMPANY",
  });
  const [attachments, setAttachments] = useState<any[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const projectsQ = useQuery({
    queryKey: ["projects-light"],
    queryFn: async () => (await api.get<Page<Project>>("/projects?size=200")).data,
  });
  const catsQ = useQuery({
    queryKey: ["categories"],
    queryFn: async () => (await api.get<Page<Category>>("/categories?size=500")).data,
  });
  const vcQ = useQuery({
    queryKey: ["vendors-clients"],
    queryFn: async () => (await api.get<Page<VendorClient>>("/vendors-clients?size=500")).data,
  });

  const detailQ = useQuery({
    enabled: isEdit,
    queryKey: ["transaction", id],
    queryFn: async () => (await api.get<Transaction>(`/transactions/${id}`)).data,
  });

  useEffect(() => {
    if (detailQ.data) {
      setData(detailQ.data);
      setAttachments(detailQ.data.attachments || []);
    }
  }, [detailQ.data]);

  useEffect(() => {
    if (!isEdit && projectsQ.data && !data.project_id) {
      setData((d) => ({ ...d, project_id: projectsQ.data!.items[0]?.id }));
    }
  }, [projectsQ.data, isEdit]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        ...data,
        amount: String(data.amount ?? "0"),
      };
      const saved: Transaction = isEdit
        ? (await api.patch(`/transactions/${id}`, payload)).data
        : (await api.post("/transactions", payload)).data;

      // Setelah create, upload file yang sudah dipilih (mode Baru)
      if (!isEdit && pendingFiles.length > 0) {
        setUploadError(null);
        for (const f of pendingFiles) {
          try {
            const fd = new FormData();
            fd.append("file", f);
            await api.post(`/transactions/${saved.id}/attachments`, fd, {
              headers: { "Content-Type": "multipart/form-data" },
            });
          } catch (e: any) {
            setUploadError(`Gagal upload ${f.name}: ${e?.response?.data?.detail || e.message}`);
          }
        }
        setPendingFiles([]);
      }
      return saved;
    },
    onSuccess: (res: Transaction) => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["dashboard-global"] });
      qc.invalidateQueries({ queryKey: ["dashboard-project"] });
      if (!isEdit) nav(`/transactions/${res.id}`, { replace: true });
    },
  });

  const action = useMutation({
    mutationFn: async (vars: { kind: "submit" | "verify" | "reject" | "cancel"; reason?: string }) => {
      const url = `/transactions/${id}/${vars.kind}`;
      const body = vars.kind === "reject" || vars.kind === "cancel" ? { reason: vars.reason || "" } : undefined;
      return (await api.post(url, body)).data;
    },
    onSuccess: (res: Transaction) => {
      setData(res);
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["dashboard-global"] });
    },
  });

  const cats = (catsQ.data?.items || []).filter((c) => !data.type || c.type === data.type);

  const isLocked = data.status === "VERIFIED" && !isSuper(user);
  const isIn = data.type === "IN";

  function setType(next: "IN" | "OUT") {
    if (isLocked || data.type === next) return;
    setData({ ...data, type: next, category_id: null });
  }

  return (
    <div>
      <PageHeader
        back
        title={isEdit ? `Transaksi #${id}` : "Transaksi Baru"}
        right={data.status && <Badge tone={statusTone(data.status)}>{data.status}</Badge>}
      />

      <div className="mb-3 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">
        <button
          type="button"
          onClick={() => setType("IN")}
          disabled={isLocked}
          aria-pressed={isIn}
          className={cn(
            "flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-all active:scale-[0.98]",
            isIn
              ? "bg-emerald-500 text-white shadow-md ring-2 ring-emerald-300/50"
              : "bg-transparent text-slate-500 hover:text-slate-700",
            isLocked && "opacity-60 cursor-not-allowed",
          )}
        >
          <ArrowDownLeft className="h-5 w-5" />
          Uang Masuk
        </button>
        <button
          type="button"
          onClick={() => setType("OUT")}
          disabled={isLocked}
          aria-pressed={!isIn}
          className={cn(
            "flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-all active:scale-[0.98]",
            !isIn
              ? "bg-rose-500 text-white shadow-md ring-2 ring-rose-300/50"
              : "bg-transparent text-slate-500 hover:text-slate-700",
            isLocked && "opacity-60 cursor-not-allowed",
          )}
        >
          <ArrowUpRight className="h-5 w-5" />
          Uang Keluar
        </button>
      </div>

      <Card
        className={cn(
          "border-l-4",
          isIn ? "border-l-emerald-500" : "border-l-rose-500",
        )}
      >
        <Field label="Tanggal">
          <Input
            disabled={isLocked}
            type="date"
            value={data.tx_date || ""}
            onChange={(e) => setData({ ...data, tx_date: e.target.value })}
          />
        </Field>

        <Field label="Proyek">
          <Combobox
            disabled={isLocked || isEdit}
            value={data.project_id ?? null}
            onChange={(v) => setData({ ...data, project_id: v == null ? undefined : Number(v) })}
            options={(projectsQ.data?.items || []).map((p) => ({
              value: p.id,
              label: p.name,
              hint: p.code,
            }))}
            placeholder="Cari nama / kode proyek..."
            clearable={false}
          />
        </Field>

        <Field label="Kategori">
          <Select disabled={isLocked} value={data.category_id ?? ""} onChange={(e) => setData({ ...data, category_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">(tanpa kategori)</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>

        <Field label={isIn ? "Jumlah Uang Masuk (Rp)" : "Jumlah Uang Keluar (Rp)"}>
          <div className="relative">
            <span
              className={cn(
                "absolute left-3 top-1/2 -translate-y-1/2 text-base font-semibold pointer-events-none",
                isIn ? "text-emerald-600" : "text-rose-600",
              )}
            >
              {isIn ? "+" : "-"} Rp
            </span>
            <Input
              disabled={isLocked}
              type="number"
              inputMode="decimal"
              placeholder="0"
              value={data.amount ?? ""}
              onChange={(e) => setData({ ...data, amount: e.target.value })}
              className={cn(
                "h-14 pl-16 pr-3 text-xl font-bold tabular-nums tracking-tight",
                isIn
                  ? "border-emerald-200 bg-emerald-50/50 text-emerald-900 focus:border-emerald-400 focus:ring-emerald-200"
                  : "border-rose-200 bg-rose-50/50 text-rose-900 focus:border-rose-400 focus:ring-rose-200",
              )}
            />
          </div>
        </Field>

        {data.type === "OUT" && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Tipe Penerima">
              <Select disabled={isLocked} value={data.party_type || ""} onChange={(e) => setData({ ...data, party_type: e.target.value as any })}>
                <option value="COMPANY">Perusahaan/Vendor</option>
                <option value="PERSONAL">Personal</option>
                <option value="EMPLOYEE">Karyawan</option>
                <option value="INTERNAL">Operasional Internal</option>
                <option value="OTHER">Lainnya</option>
              </Select>
            </Field>
            <Field label="Vendor (jika ada)">
              <Select disabled={isLocked} value={data.vendor_client_id ?? ""} onChange={(e) => setData({ ...data, vendor_client_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">- pilih -</option>
                {vcQ.data?.items.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </Select>
            </Field>
          </div>
        )}

        <Field label="Nama Pihak">
          <Input disabled={isLocked} value={data.party_name || ""} onChange={(e) => setData({ ...data, party_name: e.target.value })} />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Metode Pembayaran">
            <Select disabled={isLocked} value={data.payment_method || "TRANSFER"} onChange={(e) => setData({ ...data, payment_method: e.target.value as any })}>
              <option value="CASH">Cash</option>
              <option value="TRANSFER">Transfer</option>
              <option value="QRIS">QRIS</option>
              <option value="GIRO">Giro</option>
              <option value="OTHER">Lainnya</option>
            </Select>
          </Field>
          <Field label="No. Referensi">
            <Input disabled={isLocked} value={data.reference_no || ""} onChange={(e) => setData({ ...data, reference_no: e.target.value })} />
          </Field>
        </div>

        <Field label="Deskripsi">
          <Textarea disabled={isLocked} value={data.description || ""} onChange={(e) => setData({ ...data, description: e.target.value })} />
        </Field>

        <Field label="Keterangan Penggunaan Dana">
          <Textarea disabled={isLocked} value={data.usage_note || ""} onChange={(e) => setData({ ...data, usage_note: e.target.value })} />
        </Field>
      </Card>

      <Card className="mt-3">
        {isEdit ? (
          <AttachmentUploader
            attachments={attachments as any}
            onChange={setAttachments as any}
            uploadUrl={`/transactions/${id}/attachments`}
            deleteUrl={(aid) => `/transactions/${id}/attachments/${aid}`}
            disabled={isLocked}
          />
        ) : (
          <PendingAttachmentPicker files={pendingFiles} onChange={setPendingFiles} />
        )}
        {uploadError && <div className="mt-2 text-xs text-rose-600">{uploadError}</div>}
      </Card>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          onClick={() => save.mutate()}
          disabled={save.isPending || isLocked}
          className={cn(
            isIn
              ? "!bg-emerald-600 hover:!bg-emerald-500 !text-white"
              : "!bg-rose-600 hover:!bg-rose-500 !text-white",
          )}
        >
          {isEdit ? "Simpan Perubahan" : isIn ? "Simpan Uang Masuk" : "Simpan Uang Keluar"}
        </Button>
        {isEdit && data.status === "DRAFT" && (
          <Button variant="secondary" onClick={() => action.mutate({ kind: "submit" })}>Submit</Button>
        )}
        {isEdit && isSuper(user) && (data.status === "SUBMITTED" || data.status === "DRAFT") && (
          <>
            <Button variant="success" onClick={() => action.mutate({ kind: "verify" })}>Verifikasi</Button>
            <Button
              variant="danger"
              onClick={() => {
                const reason = prompt("Alasan tolak:") || "";
                if (reason) action.mutate({ kind: "reject", reason });
              }}
            >
              Tolak
            </Button>
          </>
        )}
        {isEdit && isSuper(user) && data.status === "VERIFIED" && (
          <Button
            variant="danger"
            onClick={() => {
              const reason = prompt("Alasan pembatalan transaksi yang sudah verified:") || "";
              if (reason) action.mutate({ kind: "cancel", reason });
            }}
          >
            Batalkan
          </Button>
        )}
      </div>
      {save.isError && (
        <div className="mt-2 text-sm text-rose-600">{(save.error as any)?.response?.data?.detail || "Gagal menyimpan"}</div>
      )}
    </div>
  );
}
