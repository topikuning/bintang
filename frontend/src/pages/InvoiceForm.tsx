import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import AttachmentUploader from "@/components/AttachmentUploader";
import { Badge, statusTone } from "@/components/ui/Badge";
import { formatIDR, todayISO } from "@/lib/utils";
import type { Invoice, Page, Project, VendorClient } from "@/types";

export default function InvoiceForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const nav = useNavigate();
  const qc = useQueryClient();
  const [data, setData] = useState<Partial<Invoice>>({
    type: "OUT",
    invoice_date: todayISO(),
    subtotal: "0",
    tax: "0",
    total: "0",
  });
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
    }
  }, [detailQ.data]);

  useEffect(() => {
    if (!isEdit && projectsQ.data && !data.project_id) {
      setData((d) => ({ ...d, project_id: projectsQ.data!.items[0]?.id }));
    }
  }, [projectsQ.data, isEdit]);

  // recompute total
  useEffect(() => {
    const sub = Number(data.subtotal || 0);
    const tax = Number(data.tax || 0);
    setData((d) => ({ ...d, total: String(sub + tax) }));
  }, [data.subtotal, data.tax]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        ...data,
        subtotal: String(data.subtotal ?? "0"),
        tax: String(data.tax ?? "0"),
        total: String(data.total ?? "0"),
      };
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
          <Select value={data.vendor_client_id ?? ""} onChange={(e) => setData({ ...data, vendor_client_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">- pilih -</option>
            {vcQ.data?.items.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </Select>
        </Field>
        <Field label="Nama Pihak (manual)">
          <Input value={data.party_name || ""} onChange={(e) => setData({ ...data, party_name: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Tanggal Jatuh Tempo">
            <Input type="date" value={data.due_date || ""} onChange={(e) => setData({ ...data, due_date: e.target.value })} />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Subtotal"><Input type="number" inputMode="decimal" value={data.subtotal ?? "0"} onChange={(e) => setData({ ...data, subtotal: e.target.value })} /></Field>
          <Field label="Pajak"><Input type="number" inputMode="decimal" value={data.tax ?? "0"} onChange={(e) => setData({ ...data, tax: e.target.value })} /></Field>
          <Field label="Total"><Input value={`Rp ${formatIDR(data.total)}`} disabled /></Field>
        </div>
        <Field label="Catatan"><Textarea value={data.notes || ""} onChange={(e) => setData({ ...data, notes: e.target.value })} /></Field>

        {isEdit && data.paid_amount != null && (
          <div className="mt-2 text-xs text-slate-600 grid grid-cols-2 gap-2">
            <div>Sudah dibayar: <b className="tabular-nums">Rp {formatIDR(data.paid_amount)}</b></div>
            <div>Sisa: <b className="tabular-nums">Rp {formatIDR(data.remaining)}</b></div>
          </div>
        )}
      </Card>

      {isEdit && (
        <Card className="mt-3">
          <AttachmentUploader
            attachments={attachments as any}
            onChange={setAttachments as any}
            uploadUrl={`/invoices/${id}/attachments`}
            deleteUrl={(aid) => `/invoices/${id}/attachments/${aid}`}
          />
        </Card>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>Simpan</Button>
        {isEdit && data.status === "DRAFT" && (
          <Button variant="secondary" onClick={() => issue.mutate()}>Issue</Button>
        )}
      </div>
    </div>
  );
}
