import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import AttachmentUploader from "@/components/AttachmentUploader";
import PendingAttachmentPicker from "@/components/PendingAttachmentPicker";
import Modal from "@/components/Modal";
import Combobox from "@/components/ui/Combobox";
import { Badge, statusTone } from "@/components/ui/Badge";
import type {
  AllocatableInvoice,
  Category,
  Page,
  Project,
  Transaction,
  VendorClient,
} from "@/types";
import { ArrowDownLeft, ArrowUpRight, Link2, Loader2, Plus, Trash2 } from "lucide-react";
import { cn, formatIDR, todayISO } from "@/lib/utils";
import { useAuthStore, isSuper, isAdmin, canWrite } from "@/store/auth";

export default function TransactionForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const nav = useNavigate();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [searchParams] = useSearchParams();
  const presetProjectId = searchParams.get("project_id");

  const [data, setData] = useState<Partial<Transaction>>({
    tx_date: todayISO(),
    type: "OUT",
    payment_method: "TRANSFER",
    party_type: "COMPANY",
    project_id: presetProjectId ? Number(presetProjectId) : undefined,
  });
  const [attachments, setAttachments] = useState<any[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingLinks, setPendingLinks] = useState<{ url: string; label: string }[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const projectsQ = useQuery({
    queryKey: ["projects-light"],
    queryFn: async () => (await api.get<Page<Project>>("/projects?size=1000")).data,
  });
  const catsQ = useQuery({
    queryKey: ["categories"],
    queryFn: async () => (await api.get<Page<Category>>("/categories?size=1000")).data,
  });
  const vcQ = useQuery({
    queryKey: ["vendors-clients"],
    queryFn: async () => (await api.get<Page<VendorClient>>("/vendors-clients?size=1000")).data,
  });

  // Daftar invoice yang masih punya outstanding & cocok arah-nya
  const allocatableInvoicesQ = useQuery({
    enabled: isEdit,
    queryKey: ["allocatable-invoices", id],
    queryFn: async () =>
      (await api.get<AllocatableInvoice[]>(
        `/transactions/${id}/allocatable-invoices`,
      )).data,
  });

  const [allocPickerOpen, setAllocPickerOpen] = useState(false);
  const [allocPickerSelections, setAllocPickerSelections] = useState<
    Record<number, string>
  >({});

  const allocate = useMutation({
    mutationFn: async () => {
      const items = Object.entries(allocPickerSelections)
        .filter(([, v]) => v && Number(v) > 0)
        .map(([invId, v]) => ({ invoice_id: Number(invId), requested_amount: v }));
      if (items.length === 0) throw new Error("Pilih minimal satu invoice.");
      return (await api.post(`/transactions/${id}/allocations`, { items })).data;
    },
    onSuccess: async () => {
      setAllocPickerOpen(false);
      setAllocPickerSelections({});
      const fresh = (await api.get<Transaction>(`/transactions/${id}`)).data;
      setData(fresh);
      setAttachments(fresh.attachments || []);
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["dashboard-global"] });
      qc.invalidateQueries({ queryKey: ["dashboard-project"] });
      qc.invalidateQueries({ queryKey: ["allocatable-invoices"] });
    },
    onError: (e: any) =>
      alert(e?.response?.data?.detail || e?.message || "Gagal alokasi"),
  });

  const removeAllocation = useMutation({
    mutationFn: async (allocId: number) =>
      api.delete(`/allocations/${allocId}`),
    onSuccess: async () => {
      const fresh = (await api.get<Transaction>(`/transactions/${id}`)).data;
      setData(fresh);
      setAttachments(fresh.attachments || []);
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["dashboard-global"] });
      qc.invalidateQueries({ queryKey: ["dashboard-project"] });
      qc.invalidateQueries({ queryKey: ["allocatable-invoices"] });
    },
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
      const fallback = presetProjectId
        ? Number(presetProjectId)
        : projectsQ.data.items[0]?.id;
      setData((d) => ({ ...d, project_id: fallback }));
    }
  }, [projectsQ.data, isEdit, presetProjectId]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        ...data,
        amount: String(data.amount ?? "0"),
      };
      const saved: Transaction = isEdit
        ? (await api.patch(`/transactions/${id}`, payload)).data
        : (await api.post("/transactions", payload)).data;

      // Setelah create, upload file + link yang sudah dipilih (mode Baru)
      if (!isEdit) {
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
        for (const l of pendingLinks) {
          try {
            await api.post(`/transactions/${saved.id}/attachments/link`, {
              url: l.url,
              label: l.label || null,
            });
          } catch (e: any) {
            setUploadError(`Gagal lampirkan link ${l.url}: ${e?.response?.data?.detail || e.message}`);
          }
        }
        setPendingFiles([]);
        setPendingLinks([]);
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

  const isLocked = (data.status === "VERIFIED" && !isAdmin(user)) || !canWrite(user);
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
              hint: p.company_name ? `${p.code} · ${p.company_name}` : p.code,
            }))}
            placeholder="Cari nama proyek / kode / perusahaan..."
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

      {isEdit && (
        <Card className="mt-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold flex items-center gap-2">
              <Link2 className="h-4 w-4 text-slate-500" />
              Alokasi ke Invoice
              {(data.allocations?.length ?? 0) > 0 && (
                <Badge tone="neutral">{data.allocations?.length ?? 0}</Badge>
              )}
            </div>
            {!isLocked && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setAllocPickerOpen(true)}
                disabled={Number(data.remaining_amount || 0) <= 0}
              >
                <Plus className="h-4 w-4" /> Tambah
              </Button>
            )}
          </div>
          <div className="text-[11px] text-slate-500 mb-2 grid grid-cols-3 gap-2">
            <div>
              Total: <b className="tabular-nums">Rp {formatIDR(data.amount)}</b>
            </div>
            <div>
              Dialokasi:{" "}
              <b className="tabular-nums">Rp {formatIDR(data.allocated_amount)}</b>
            </div>
            <div>
              Sisa:{" "}
              <b
                className={cn(
                  "tabular-nums",
                  Number(data.remaining_amount || 0) <= 0 && "text-emerald-700",
                )}
              >
                Rp {formatIDR(data.remaining_amount)}
              </b>
            </div>
          </div>
          {(data.allocations?.length ?? 0) === 0 ? (
            <div className="text-xs text-slate-500 italic">
              Belum ada alokasi. Klik <b>Tambah</b> untuk hubungkan transaksi ini
              ke satu atau lebih invoice.
            </div>
          ) : (
            <ul className="divide-y">
              {(data.allocations || []).map((a) => (
                <li key={a.id} className="py-2 flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      INV {a.invoice_number || `#${a.invoice_id}`}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Total invoice Rp {formatIDR(a.invoice_total)} ·{" "}
                      <Badge tone={statusTone(a.invoice_status)}>
                        {a.invoice_status}
                      </Badge>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="tabular-nums font-semibold text-sm">
                      Rp {formatIDR(a.allocated_amount)}
                    </div>
                  </div>
                  {!isLocked && (
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Lepas alokasi ke INV ${a.invoice_number}?`))
                          removeAllocation.mutate(a.id);
                      }}
                      className="grid h-8 w-8 place-items-center rounded-full bg-rose-100 text-rose-700"
                      aria-label="Lepas alokasi"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* Modal: Pilih invoice untuk dialokasikan */}
      <Modal
        open={allocPickerOpen}
        onClose={() => setAllocPickerOpen(false)}
        title="Alokasikan ke Invoice"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAllocPickerOpen(false)}>
              Batal
            </Button>
            <Button
              onClick={() => allocate.mutate()}
              disabled={
                allocate.isPending ||
                Object.values(allocPickerSelections).filter((v) => Number(v) > 0).length === 0
              }
            >
              {allocate.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {allocate.isPending ? "Mengalokasi..." : "Alokasikan"}
            </Button>
          </>
        }
      >
        <div className="text-xs text-slate-500 mb-2">
          Sisa transaksi:{" "}
          <b>Rp {formatIDR(data.remaining_amount)}</b>. Backend akan auto-cap
          jika permintaanmu melebihi sisa transaksi atau outstanding invoice.
        </div>
        {allocatableInvoicesQ.isLoading && (
          <div className="text-xs text-slate-500">Memuat invoice...</div>
        )}
        {!allocatableInvoicesQ.isLoading &&
          (allocatableInvoicesQ.data?.length ?? 0) === 0 && (
            <div className="text-xs text-slate-500 italic">
              Belum ada invoice {data.type === "IN" ? "OUT" : "IN"} di proyek ini
              yang masih punya outstanding.
            </div>
          )}
        <div className="space-y-2">
          {(allocatableInvoicesQ.data || []).map((inv: AllocatableInvoice) => {
            const outstanding = Number(inv.outstanding_amount);
            const value = allocPickerSelections[inv.id] ?? "";
            const setValue = (v: string) =>
              setAllocPickerSelections((s) => ({ ...s, [inv.id]: v }));
            return (
              <div key={inv.id} className="rounded-xl border border-slate-200 p-2">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      INV {inv.number}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {inv.invoice_date} · {inv.party_name || "-"} ·{" "}
                      <Badge tone={statusTone(inv.status)}>{inv.status}</Badge>
                    </div>
                    <div className="text-[11px] text-slate-600">
                      Total Rp {formatIDR(inv.total_amount)} · sudah dibayar Rp{" "}
                      {formatIDR(inv.paid_amount)} ·{" "}
                      <b>outstanding Rp {formatIDR(outstanding)}</b>
                    </div>
                  </div>
                  <div className="w-32 shrink-0">
                    <Input
                      type="number"
                      inputMode="decimal"
                      placeholder="Alokasi"
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                    />
                    <button
                      type="button"
                      className="text-[10px] text-sky-600 mt-0.5"
                      onClick={() => {
                        const cap = Math.min(
                          outstanding,
                          Number(data.remaining_amount || 0),
                        );
                        setValue(String(cap));
                      }}
                    >
                      Pakai max
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Modal>

      <Card className="mt-3">
        {isEdit ? (
          <AttachmentUploader
            attachments={attachments as any}
            onChange={setAttachments as any}
            uploadUrl={`/transactions/${id}/attachments`}
            linkUrl={`/transactions/${id}/attachments/link`}
            deleteUrl={(aid) => `/transactions/${id}/attachments/${aid}`}
            disabled={isLocked}
          />
        ) : (
          <PendingAttachmentPicker
            files={pendingFiles}
            onChange={setPendingFiles}
            links={pendingLinks}
            onLinksChange={setPendingLinks}
          />
        )}
        {uploadError && <div className="mt-2 text-xs text-rose-600">{uploadError}</div>}
      </Card>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          onClick={() => save.mutate()}
          disabled={save.isPending || isLocked || action.isPending}
          className={cn(
            isIn
              ? "!bg-emerald-600 hover:!bg-emerald-500 !text-white"
              : "!bg-rose-600 hover:!bg-rose-500 !text-white",
          )}
        >
          {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {save.isPending
            ? "Menyimpan..."
            : isEdit
              ? "Simpan Perubahan"
              : isIn
                ? "Simpan Uang Masuk"
                : "Simpan Uang Keluar"}
        </Button>
        {isEdit && data.status === "DRAFT" && (
          <Button
            variant="secondary"
            onClick={() => action.mutate({ kind: "submit" })}
            disabled={action.isPending || save.isPending}
          >
            {action.isPending && action.variables?.kind === "submit" && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            Submit
          </Button>
        )}
        {isEdit && isAdmin(user) && (data.status === "SUBMITTED" || data.status === "DRAFT") && (
          <>
            <Button
              variant="success"
              onClick={() => action.mutate({ kind: "verify" })}
              disabled={action.isPending || save.isPending}
            >
              {action.isPending && action.variables?.kind === "verify" && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Verifikasi
            </Button>
            <Button
              variant="danger"
              disabled={action.isPending || save.isPending}
              onClick={() => {
                const reason = prompt("Alasan tolak:") || "";
                if (reason) action.mutate({ kind: "reject", reason });
              }}
            >
              {action.isPending && action.variables?.kind === "reject" && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Tolak
            </Button>
          </>
        )}
        {isEdit && isAdmin(user) && data.status === "VERIFIED" && (
          <Button
            variant="danger"
            disabled={action.isPending || save.isPending}
            onClick={() => {
              const reason = prompt("Alasan pembatalan transaksi yang sudah verified:") || "";
              if (reason) action.mutate({ kind: "cancel", reason });
            }}
          >
            {action.isPending && action.variables?.kind === "cancel" && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            Batalkan
          </Button>
        )}
        {isEdit && isSuper(user) && (
          <Button
            variant="danger"
            onClick={async () => {
              const c1 = prompt(
                `GOD-MODE: hapus PERMANEN transaksi #${id}?\nKetik HAPUS untuk konfirmasi.`,
              );
              if (c1 !== "HAPUS") return;
              try {
                await api.delete(`/transactions/${id}/hard`);
                qc.invalidateQueries({ queryKey: ["transactions"] });
                qc.invalidateQueries({ queryKey: ["dashboard-global"] });
                nav("/transactions");
              } catch (e: any) {
                alert(e?.response?.data?.detail || "Gagal hard delete");
              }
            }}
          >
            🔥 Hapus Permanen (God-mode)
          </Button>
        )}
      </div>
      {save.isError && (
        <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {(save.error as any)?.response?.data?.detail || "Gagal menyimpan"}
        </div>
      )}
      {action.isError && (
        <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {(action.error as any)?.response?.data?.detail || "Aksi gagal"}
        </div>
      )}
    </div>
  );
}
