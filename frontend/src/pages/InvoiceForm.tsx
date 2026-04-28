import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Input";
import AttachmentUploader from "@/components/AttachmentUploader";
import Combobox from "@/components/ui/Combobox";
import { Badge, statusTone } from "@/components/ui/Badge";
import { ArrowDownLeft, ArrowUpRight, BadgeCheck, Plus, Trash2 } from "lucide-react";
import { cn, formatIDR, todayISO } from "@/lib/utils";
import type { Invoice, Page, Project, VendorClient } from "@/types";

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

  const [data, setData] = useState<Partial<Invoice>>({
    type: "OUT",
    invoice_date: todayISO(),
    tax: "0",
  });
  const [items, setItems] = useState<ItemRow[]>([
    { description: "", quantity: 1, unit: "", unit_price: 0 },
  ]);
  const [attachments, setAttachments] = useState<any[]>([]);

  const projectsQ = useQuery({
    queryKey: ["projects-light"],
    queryFn: async () => (await api.get<Page<Project>>("/projects?size=200")).data,
  });
  const vcQ = useQuery({
    queryKey: ["vendors-clients"],
    queryFn: async () => (await api.get<Page<VendorClient>>("/vendors-clients?size=500")).data,
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
      setData((d) => ({ ...d, project_id: projectsQ.data!.items[0]?.id }));
    }
  }, [projectsQ.data, isEdit]);

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
      if (isEdit) return (await api.patch(`/invoices/${id}`, payload)).data;
      return (await api.post("/invoices", payload)).data;
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
          Hutang (Invoice dari Vendor)
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
              value: p.id, label: p.name, hint: p.code,
            }))}
            placeholder="Cari proyek..."
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
          <AttachmentUploader
            attachments={attachments as any}
            onChange={setAttachments as any}
            uploadUrl={`/invoices/${id}/attachments`}
            deleteUrl={(_aid) => `/invoices/${id}/attachments/${_aid}`}
          />
        </Card>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className={cn(
            data.type === "OUT"
              ? "!bg-emerald-600 hover:!bg-emerald-500 !text-white"
              : "!bg-rose-600 hover:!bg-rose-500 !text-white",
          )}
        >
          Simpan
        </Button>
        {isEdit && data.status === "DRAFT" && (
          <Button variant="secondary" onClick={() => issue.mutate()}>
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
            disabled={markPaid.isPending}
          >
            <BadgeCheck className="h-4 w-4" /> Tandai Lunas
          </Button>
        )}
      </div>
      {save.isError && (
        <div className="mt-2 text-sm text-rose-600">
          {(save.error as any)?.response?.data?.detail || "Gagal menyimpan"}
        </div>
      )}
    </div>
  );
}
