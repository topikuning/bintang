import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import AttachmentUploader from "@/components/AttachmentUploader";
import PendingAttachmentPicker from "@/components/PendingAttachmentPicker";
import Combobox from "@/components/ui/Combobox";
import Modal from "@/components/Modal";
import { Badge, statusTone } from "@/components/ui/Badge";
import { ArrowDownLeft, ArrowUpRight, BadgeCheck, Link2, Loader2, Plus, Printer, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { canWrite, isSuper, useAuthStore } from "@/store/auth";
import { cn, formatDate, formatIDR, todayISO } from "@/lib/utils";
import type {
  AllocatableTransaction,
  Invoice,
  Page,
  PaymentMethod,
  Project,
  VendorClient,
} from "@/types";

interface ItemRow {
  description: string;
  quantity: string | number;
  unit?: string;
  unit_price: string | number;
}

export default function InvoiceForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const nav = useNavigate();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [searchParams] = useSearchParams();
  const presetProjectId = searchParams.get("project_id");

  const [data, setData] = useState<Partial<Invoice>>({
    type: "IN",  // default: Hutang/Pengajuan internal (paling umum)
    invoice_date: todayISO(),
    tax: "0",
    project_id: presetProjectId ? Number(presetProjectId) : undefined,
  });
  const [payOpen, setPayOpen] = useState(false);
  const [payTab, setPayTab] = useState<"existing" | "new">("existing");
  const [allocSelections, setAllocSelections] = useState<Record<number, string>>({});
  const [payment, setPayment] = useState<{
    tx_date: string;
    amount: string;
    payment_method: PaymentMethod;
    reference_no: string;
    description: string;
  }>({
    tx_date: todayISO(),
    amount: "",
    payment_method: "TRANSFER",
    reference_no: "",
    description: "",
  });
  const [items, setItems] = useState<ItemRow[]>([
    { description: "", quantity: 1, unit: "", unit_price: 0 },
  ]);
  const [attachments, setAttachments] = useState<any[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingLinks, setPendingLinks] = useState<{ url: string; label: string }[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const projectsQ = useQuery({
    queryKey: ["projects-light"],
    queryFn: async () => (await api.get<Page<Project>>("/projects?size=1000")).data,
  });
  const vcQ = useQuery({
    queryKey: ["vendors-clients"],
    queryFn: async () => (await api.get<Page<VendorClient>>("/vendors-clients?size=1000")).data,
  });
  const detailQ = useQuery({
    enabled: isEdit,
    queryKey: ["invoice", id],
    queryFn: async () => (await api.get<Invoice>(`/invoices/${id}`)).data,
  });

  useEffect(() => {
    if (detailQ.data) {
      setData(detailQ.data);
      setAttachments(detailQ.data.attachments || []);
      setItems(
        (detailQ.data.items || []).length > 0
          ? detailQ.data.items.map((it) => ({
              description: it.description,
              quantity: it.quantity,
              unit: it.unit || "",
              unit_price: it.unit_price,
            }))
          : [{ description: "", quantity: 1, unit: "", unit_price: 0 }],
      );
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

  const subtotal = useMemo(
    () => items.reduce((acc, it) => acc + Number(it.unit_price || 0) * Number(it.quantity || 0), 0),
    [items],
  );
  const total = subtotal + Number(data.tax || 0);

  const save = useMutation({
    mutationFn: async () => {
      const payload: any = {
        number: data.number,
        type: data.type,
        invoice_date: data.invoice_date,
        due_date: data.due_date,
        vendor_client_id: data.vendor_client_id,
        party_name: data.party_name,
        tax: String(data.tax || 0),
        notes: data.notes,
        items: items
          .filter((it) => it.description.trim().length > 0)
          .map((it) => ({
            description: it.description,
            quantity: String(it.quantity || 0),
            unit: it.unit || null,
            unit_price: String(it.unit_price || 0),
          })),
      };
      if (!isEdit) payload.project_id = data.project_id;
      const saved: Invoice = isEdit
        ? (await api.patch(`/invoices/${id}`, payload)).data
        : (await api.post("/invoices", payload)).data;

      // upload pending files + pending links yang dipilih sebelum invoice tersimpan
      if (!isEdit) {
        setUploadError(null);
        for (const f of pendingFiles) {
          try {
            const fd = new FormData();
            fd.append("file", f);
            await api.post(`/invoices/${saved.id}/attachments`, fd, {
              headers: { "Content-Type": "multipart/form-data" },
            });
          } catch (e: any) {
            setUploadError(`Gagal upload ${f.name}: ${e?.response?.data?.detail || e.message}`);
          }
        }
        for (const l of pendingLinks) {
          try {
            await api.post(`/invoices/${saved.id}/attachments/link`, {
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
    onSuccess: (res: Invoice) => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      if (!isEdit) nav(`/invoices/${res.id}`, { replace: true });
    },
  });

  const issue = useMutation({
    mutationFn: async () => (await api.post(`/invoices/${id}/issue`)).data,
    onSuccess: (res: Invoice) => setData(res),
  });

  const markPaid = useMutation({
    mutationFn: async () => (await api.post(`/invoices/${id}/mark-paid`)).data,
    onSuccess: (res: Invoice) => {
      setData(res);
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["dashboard-global"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      const linked = Number(res.paid_amount || 0);
      const total = Number(res.total || 0);
      if (linked < total) {
        alert(
          `Invoice ditandai LUNAS.\n\nKekurangan Rp ${(total - linked).toLocaleString("id-ID")} otomatis dibuatkan transaksi DRAFT (lihat menu Transaksi).`,
        );
      }
    },
    onError: (e: any) =>
      alert(e?.response?.data?.detail || "Gagal menandai lunas"),
  });

  // Daftar transaksi existing yang masih punya remaining untuk dialokasikan
  const allocatableQ = useQuery({
    enabled: isEdit && payOpen && payTab === "existing",
    queryKey: ["allocatable-transactions", id],
    queryFn: async () =>
      (await api.get<AllocatableTransaction[]>(
        `/invoices/${id}/allocatable-transactions`,
      )).data,
  });

  const payFromExisting = useMutation({
    mutationFn: async () => {
      const items = Object.entries(allocSelections)
        .filter(([, v]) => v && Number(v) > 0)
        .map(([txId, v]) => ({ transaction_id: Number(txId), requested_amount: v }));
      if (items.length === 0) throw new Error("Pilih minimal satu transaksi.");
      return (await api.post(`/invoices/${id}/allocations`, { items })).data;
    },
    onSuccess: async () => {
      setPayOpen(false);
      setAllocSelections({});
      const fresh = (await api.get<Invoice>(`/invoices/${id}`)).data;
      setData(fresh);
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["dashboard-global"] });
      qc.invalidateQueries({ queryKey: ["dashboard-project"] });
      qc.invalidateQueries({ queryKey: ["allocatable-transactions"] });
    },
    onError: (e: any) =>
      alert(e?.response?.data?.detail || e?.message || "Gagal alokasi"),
  });

  const payManual = useMutation({
    mutationFn: async () => {
      // 1) Buat transaksi pembayaran (tanpa invoice_id - skema lama).
      // 2) Alokasikan transaksi tsb ke invoice ini lewat endpoint allocation.
      const txType = data.type === "IN" ? "OUT" : "IN";
      const txPayload = {
        project_id: data.project_id,
        tx_date: payment.tx_date,
        type: txType,
        amount: payment.amount,
        party_name: data.party_name,
        vendor_client_id: data.vendor_client_id,
        payment_method: payment.payment_method,
        reference_no: payment.reference_no || null,
        description: payment.description || `Pembayaran invoice ${data.number || ""}`.trim(),
      };
      const tx = (await api.post("/transactions", txPayload)).data;
      await api.post(`/invoices/${id}/allocations`, {
        items: [{ transaction_id: tx.id, requested_amount: payment.amount }],
        note: "manual payment from invoice",
      });
      return tx;
    },
    onSuccess: async () => {
      setPayOpen(false);
      setPayment({
        tx_date: todayISO(),
        amount: "",
        payment_method: "TRANSFER",
        reference_no: "",
        description: "",
      });
      // Refresh invoice (untuk dapat payments terbaru)
      const fresh = (await api.get<Invoice>(`/invoices/${id}`)).data;
      setData(fresh);
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["dashboard-global"] });
    },
    onError: (e: any) =>
      alert(e?.response?.data?.detail || "Gagal membuat pembayaran"),
  });

  return (
    <div>
      <PageHeader
        back
        title={isEdit ? `Invoice ${data.number || ""}` : "Invoice Baru"}
        right={data.status && <Badge tone={statusTone(data.status)}>{data.status}</Badge>}
      />

      <div className="mb-3 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">
        <button
          type="button"
          onClick={() => setData({ ...data, type: "OUT" })}
          aria-pressed={data.type === "OUT"}
          className={cn(
            "flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-all active:scale-[0.98]",
            data.type === "OUT"
              ? "bg-emerald-500 text-white shadow-md ring-2 ring-emerald-300/50"
              : "bg-transparent text-slate-500 hover:text-slate-700",
          )}
        >
          <ArrowDownLeft className="h-5 w-5" />
          Piutang (Tagihan ke Client)
        </button>
        <button
          type="button"
          onClick={() => setData({ ...data, type: "IN" })}
          aria-pressed={data.type === "IN"}
          className={cn(
            "flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-all active:scale-[0.98]",
            data.type === "IN"
              ? "bg-rose-500 text-white shadow-md ring-2 ring-rose-300/50"
              : "bg-transparent text-slate-500 hover:text-slate-700",
          )}
        >
          <ArrowUpRight className="h-5 w-5" />
          Invoice / Pengajuan (Hutang)
        </button>
      </div>

      <Card
        className={cn(
          "border-l-4",
          data.type === "OUT" ? "border-l-emerald-500" : "border-l-rose-500",
        )}
      >
        <Field label="Tanggal">
          <Input type="date" value={data.invoice_date || ""} onChange={(e) => setData({ ...data, invoice_date: e.target.value })} />
        </Field>
        <Field label="No. Invoice">
          <Input value={data.number || ""} onChange={(e) => setData({ ...data, number: e.target.value })} />
        </Field>
        <Field label="Proyek">
          <Combobox
            disabled={isEdit}
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
        <Field label="Pihak (Vendor/Client)">
          <Combobox
            value={data.vendor_client_id ?? null}
            onChange={(v) => {
              const vid = v == null ? null : Number(v);
              const item = vcQ.data?.items.find((x) => x.id === vid);
              setData({
                ...data,
                vendor_client_id: vid,
                party_name: item?.name || data.party_name,
              });
            }}
            options={(vcQ.data?.items || []).map((v) => ({
              value: v.id,
              label: v.name,
              hint: v.type,
            }))}
            placeholder="Cari vendor / client..."
          />
        </Field>
        <Field label="Nama Pihak (manual)">
          <Input value={data.party_name || ""} onChange={(e) => setData({ ...data, party_name: e.target.value })} />
        </Field>
        <Field label="Tanggal Jatuh Tempo">
          <Input type="date" value={data.due_date || ""} onChange={(e) => setData({ ...data, due_date: e.target.value })} />
        </Field>
      </Card>

      <Card className="mt-3">
        <div className="text-sm font-semibold mb-2">Item Tagihan</div>
        {items.map((it, i) => (
          <div key={i} className="rounded-xl border border-slate-200 p-2 mb-2">
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <Field label="Deskripsi">
                  <Input
                    value={it.description}
                    onChange={(e) =>
                      setItems(items.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))
                    }
                  />
                </Field>
                <div className="grid grid-cols-3 gap-2">
                  <Field label="Qty">
                    <Input
                      type="number"
                      inputMode="decimal"
                      value={it.quantity}
                      onChange={(e) =>
                        setItems(items.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))
                      }
                    />
                  </Field>
                  <Field label="Unit">
                    <Input
                      value={it.unit || ""}
                      onChange={(e) =>
                        setItems(items.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))
                      }
                    />
                  </Field>
                  <Field label="Harga Satuan">
                    <Input
                      type="number"
                      inputMode="decimal"
                      value={it.unit_price}
                      onChange={(e) =>
                        setItems(items.map((x, j) => (j === i ? { ...x, unit_price: e.target.value } : x)))
                      }
                    />
                  </Field>
                </div>
                <div className="text-xs text-slate-600">
                  Subtotal:{" "}
                  <b>Rp {formatIDR(Number(it.quantity || 0) * Number(it.unit_price || 0))}</b>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setItems(items.filter((_, j) => j !== i))}
                className="grid h-9 w-9 place-items-center rounded-full bg-rose-100 text-rose-700"
                aria-label="Hapus item"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setItems([...items, { description: "", quantity: 1, unit: "", unit_price: 0 }])}
        >
          <Plus className="h-4 w-4" /> Tambah item
        </Button>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Field label="Pajak">
            <Input
              type="number"
              inputMode="decimal"
              value={data.tax ?? "0"}
              onChange={(e) => setData({ ...data, tax: e.target.value })}
            />
          </Field>
        </div>
        <div className="text-sm space-y-1">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <b className="tabular-nums">Rp {formatIDR(subtotal)}</b>
          </div>
          <div className="flex justify-between">
            <span>Pajak</span>
            <b className="tabular-nums">Rp {formatIDR(data.tax)}</b>
          </div>
          <div className="flex justify-between text-base">
            <span>Total</span>
            <b className="tabular-nums">Rp {formatIDR(total)}</b>
          </div>
        </div>
        <Field label="Catatan">
          <Textarea value={data.notes || ""} onChange={(e) => setData({ ...data, notes: e.target.value })} />
        </Field>

        {isEdit && data.paid_amount != null && (
          <div className="mt-2 text-xs text-slate-600 grid grid-cols-2 gap-2">
            <div>
              Sudah dibayar: <b className="tabular-nums">Rp {formatIDR(data.paid_amount)}</b>
            </div>
            <div>
              Sisa: <b className="tabular-nums">Rp {formatIDR(data.remaining)}</b>
            </div>
          </div>
        )}
      </Card>

      {isEdit && (
        <Card className="mt-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold flex items-center gap-2">
              <Link2 className="h-4 w-4 text-slate-500" />
              Transaksi Pembayaran
              {(data.payments?.length ?? 0) > 0 && (
                <Badge tone="neutral">{data.payments?.length ?? 0}</Badge>
              )}
            </div>
            {data.status !== "PAID" && data.status !== "CANCELLED" && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setPayOpen(true)}
                disabled={!data.project_id}
              >
                <Plus className="h-4 w-4" /> Tambah Pembayaran
              </Button>
            )}
          </div>

          {(data.payments?.length ?? 0) === 0 ? (
            <div className="text-xs text-slate-500 italic">
              Belum ada transaksi pembayaran terhubung.
              Klik <b>Tandai Lunas</b> di bawah untuk auto-create, atau
              <b> Tambah Pembayaran</b> untuk catat manual.
            </div>
          ) : (
            <ul className="divide-y">
              {(data.payments ?? []).map((p) => (
                <li key={p.id} className="py-2 flex items-center gap-2">
                  <div
                    className={`h-7 w-7 shrink-0 rounded-full grid place-items-center text-xs font-bold ${
                      p.type === "IN"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-rose-100 text-rose-700"
                    }`}
                  >
                    {p.type === "IN" ? "+" : "-"}
                  </div>
                  <Link to={`/transactions/${p.id}`} className="flex-1 min-w-0">
                    <div className="text-sm truncate">
                      {p.description || `Pembayaran #${p.id}`}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {formatDate(p.tx_date)} · {p.payment_method}
                      {p.reference_no ? ` · ${p.reference_no}` : ""}
                    </div>
                  </Link>
                  <div className="text-right shrink-0">
                    <div
                      className={`tabular-nums font-semibold text-sm ${
                        p.type === "IN" ? "text-emerald-700" : "text-rose-700"
                      }`}
                    >
                      Rp {formatIDR(p.amount)}
                    </div>
                    <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card className="mt-3">
        {isEdit ? (
          <AttachmentUploader
            attachments={attachments as any}
            onChange={setAttachments as any}
            uploadUrl={`/invoices/${id}/attachments`}
            linkUrl={`/invoices/${id}/attachments/link`}
            deleteUrl={(_aid) => `/invoices/${id}/attachments/${_aid}`}
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

      {/* Modal: Tambah Pembayaran */}
      <Modal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        title="Tambah Pembayaran"
        footer={
          payTab === "existing" ? (
            <>
              <Button variant="ghost" onClick={() => setPayOpen(false)}>Batal</Button>
              <Button
                onClick={() => payFromExisting.mutate()}
                disabled={
                  payFromExisting.isPending ||
                  Object.values(allocSelections).filter((v) => Number(v) > 0).length === 0
                }
              >
                {payFromExisting.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {payFromExisting.isPending ? "Mengalokasi..." : "Alokasikan"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setPayOpen(false)}>Batal</Button>
              <Button
                onClick={() => payManual.mutate()}
                disabled={
                  payManual.isPending ||
                  !payment.amount ||
                  Number(payment.amount) <= 0
                }
              >
                {payManual.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {payManual.isPending ? "Menyimpan..." : "Simpan & Alokasikan"}
              </Button>
            </>
          )
        }
      >
        <div className="text-xs text-slate-500 mb-2">
          Sisa invoice saat ini: <b>Rp {formatIDR(data.remaining)}</b>. Alokasi
          akan otomatis di-cap kalau melebihi sisa transaksi atau sisa invoice.
        </div>

        <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-xs">
          <button
            type="button"
            onClick={() => setPayTab("existing")}
            className={cn(
              "rounded-lg py-2 font-semibold transition-all",
              payTab === "existing"
                ? "bg-white shadow text-slate-900"
                : "text-slate-500 hover:text-slate-700",
            )}
          >
            Pakai Transaksi Existing
          </button>
          <button
            type="button"
            onClick={() => setPayTab("new")}
            className={cn(
              "rounded-lg py-2 font-semibold transition-all",
              payTab === "new"
                ? "bg-white shadow text-slate-900"
                : "text-slate-500 hover:text-slate-700",
            )}
          >
            Buat Transaksi Baru
          </button>
        </div>

        {payTab === "existing" ? (
          <div className="space-y-2">
            {allocatableQ.isLoading && (
              <div className="text-xs text-slate-500">Memuat transaksi...</div>
            )}
            {!allocatableQ.isLoading && (allocatableQ.data?.length ?? 0) === 0 && (
              <div className="text-xs text-slate-500 italic">
                Belum ada transaksi {data.type === "IN" ? "OUT" : "IN"} di proyek
                ini yang masih punya sisa.
              </div>
            )}
            {(allocatableQ.data || []).map((t) => {
              const remaining = Number(t.remaining_amount);
              const value = allocSelections[t.id] ?? "";
              const setValue = (v: string) =>
                setAllocSelections((s) => ({ ...s, [t.id]: v }));
              return (
                <div key={t.id} className="rounded-xl border border-slate-200 p-2">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        #{t.id} · {t.description || t.party_name || "Transaksi"}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {t.tx_date} · {t.payment_method} · status {t.status}
                      </div>
                      <div className="text-[11px] text-slate-600">
                        Total Rp {formatIDR(t.total_amount)} · sudah dipakai Rp{" "}
                        {formatIDR(t.allocated_amount)} · <b>sisa Rp {formatIDR(remaining)}</b>
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
                            remaining,
                            Number(data.remaining || 0),
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
            {payFromExisting.isError && (
              <div className="text-xs text-rose-600">
                {(payFromExisting.error as any)?.response?.data?.detail ||
                  (payFromExisting.error as any)?.message ||
                  "Gagal alokasi"}
              </div>
            )}
          </div>
        ) : (
          <div>
            <div className="text-xs text-slate-500 mb-2">
              Akan membuat transaksi DRAFT{" "}
              <b className={data.type === "IN" ? "text-rose-600" : "text-emerald-600"}>
                {data.type === "IN" ? "OUT" : "IN"}
              </b>{" "}
              dan langsung dialokasikan ke invoice ini.
            </div>
            <Field label="Tanggal">
              <Input
                type="date"
                value={payment.tx_date}
                onChange={(e) => setPayment({ ...payment, tx_date: e.target.value })}
              />
            </Field>
            <Field label="Jumlah (Rp)">
              <Input
                type="number"
                inputMode="decimal"
                value={payment.amount}
                onChange={(e) => setPayment({ ...payment, amount: e.target.value })}
                placeholder={`Sisa: ${formatIDR(data.remaining)}`}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Metode">
                <Select
                  value={payment.payment_method}
                  onChange={(e) =>
                    setPayment({ ...payment, payment_method: e.target.value as PaymentMethod })
                  }
                >
                  <option value="CASH">Cash</option>
                  <option value="TRANSFER">Transfer</option>
                  <option value="QRIS">QRIS</option>
                  <option value="GIRO">Giro</option>
                  <option value="OTHER">Lainnya</option>
                </Select>
              </Field>
              <Field label="No. Referensi">
                <Input
                  value={payment.reference_no}
                  onChange={(e) => setPayment({ ...payment, reference_no: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Keterangan">
              <Input
                value={payment.description}
                onChange={(e) => setPayment({ ...payment, description: e.target.value })}
                placeholder={`Pembayaran invoice ${data.number || ""}`}
              />
            </Field>
          </div>
        )}
      </Modal>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          onClick={() => save.mutate()}
          disabled={save.isPending || !canWrite(user) || issue.isPending || markPaid.isPending}
          className={cn(
            data.type === "OUT"
              ? "!bg-emerald-600 hover:!bg-emerald-500 !text-white"
              : "!bg-rose-600 hover:!bg-rose-500 !text-white",
          )}
        >
          {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {save.isPending ? "Menyimpan..." : "Simpan"}
        </Button>
        {isEdit && data.status === "DRAFT" && (
          <Button
            variant="secondary"
            onClick={() => issue.mutate()}
            disabled={issue.isPending || save.isPending}
          >
            {issue.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Terbitkan (Issue)
          </Button>
        )}
        {isEdit && data.status && !["DRAFT", "PAID", "CANCELLED"].includes(data.status) && (
          <Button
            variant="success"
            onClick={() => {
              const linked = Number(data.paid_amount || 0);
              const total = Number(data.total || 0);
              const diff = total - linked;
              const msg =
                diff > 0
                  ? `Tandai invoice LUNAS?\n\nKekurangan Rp ${diff.toLocaleString("id-ID")} akan otomatis dibuatkan transaksi DRAFT.`
                  : "Tandai invoice LUNAS?";
              if (confirm(msg)) markPaid.mutate();
            }}
            disabled={markPaid.isPending || save.isPending}
          >
            {markPaid.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <BadgeCheck className="h-4 w-4" />
            )}
            Tandai Lunas
          </Button>
        )}
        {isEdit && (
          <Button
            type="button"
            variant="secondary"
            onClick={async () => {
              try {
                const res = await api.get(`/invoices/${id}/pdf`, { responseType: "blob" });
                const blob = new Blob([res.data], { type: "application/pdf" });
                const url = URL.createObjectURL(blob);
                window.open(url, "_blank");
                setTimeout(() => URL.revokeObjectURL(url), 60000);
              } catch (e) {
                alert("Gagal membuka PDF");
              }
            }}
          >
            <Printer className="h-4 w-4" /> Cetak PDF
          </Button>
        )}
        {isEdit && isSuper(user) && (
          <Button
            variant="danger"
            onClick={async () => {
              const c1 = prompt(
                `GOD-MODE: hapus PERMANEN invoice ${data.number || `#${id}`}?\nTransaksi pembayaran tidak dihapus, hanya di-unlink.\nKetik HAPUS untuk konfirmasi.`,
              );
              if (c1 !== "HAPUS") return;
              try {
                await api.delete(`/invoices/${id}/hard`);
                qc.invalidateQueries({ queryKey: ["invoices"] });
                qc.invalidateQueries({ queryKey: ["transactions"] });
                qc.invalidateQueries({ queryKey: ["dashboard-global"] });
                nav("/invoices");
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
      {issue.isError && (
        <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {(issue.error as any)?.response?.data?.detail || "Gagal terbitkan invoice"}
        </div>
      )}
    </div>
  );
}
