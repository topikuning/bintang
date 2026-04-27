import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import AttachmentUploader from "@/components/AttachmentUploader";
import { Badge, statusTone } from "@/components/ui/Badge";
import { Plus, Trash2 } from "lucide-react";
import { formatIDR, todayISO } from "@/lib/utils";
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

  return (
    <div>
      <PageHeader
        back
        title={isEdit ? `Invoice ${data.number || ""}` : "Invoice Baru"}
        right={data.status && <Badge tone={statusTone(data.status)}>{data.status}</Badge>}
      />

      <Card>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Tipe">
            <Select value={data.type || "OUT"} onChange={(e) => setData({ ...data, type: e.target.value as any })}>
              <option value="OUT">Tagihan ke Client (OUT)</option>
              <option value="IN">Invoice dari Vendor (IN)</option>
            </Select>
          </Field>
          <Field label="Tanggal">
            <Input type="date" value={data.invoice_date || ""} onChange={(e) => setData({ ...data, invoice_date: e.target.value })} />
          </Field>
        </div>
        <Field label="No. Invoice">
          <Input value={data.number || ""} onChange={(e) => setData({ ...data, number: e.target.value })} />
        </Field>
        <Field label="Proyek">
          <Select disabled={isEdit} value={data.project_id ?? ""} onChange={(e) => setData({ ...data, project_id: Number(e.target.value) })}>
            <option value="">- pilih -</option>
            {projectsQ.data?.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Pihak (Vendor/Client)">
          <Select
            value={data.vendor_client_id ?? ""}
            onChange={(e) => {
              const vid = e.target.value ? Number(e.target.value) : null;
              const v = vcQ.data?.items.find((x) => x.id === vid);
              setData({ ...data, vendor_client_id: vid, party_name: v?.name || data.party_name });
            }}
          >
            <option value="">- pilih -</option>
            {vcQ.data?.items.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </Select>
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
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          Simpan
        </Button>
        {isEdit && data.status === "DRAFT" && (
          <Button variant="secondary" onClick={() => issue.mutate()}>
            Issue
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
