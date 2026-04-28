import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import Combobox from "@/components/ui/Combobox";
import { Badge, statusTone } from "@/components/ui/Badge";
import { Loader2, Plus, Printer, Trash2 } from "lucide-react";
import { formatIDR, todayISO } from "@/lib/utils";
import type { Company, Page, Project, PurchaseOrder, VendorClient } from "@/types";
import { useAuthStore, isAdmin, isSuper } from "@/store/auth";

interface ItemRow {
  id?: number;
  description: string;
  quantity: string | number;
  unit?: string;
  unit_price: string | number;
}

export default function POForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const nav = useNavigate();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const [data, setData] = useState<Partial<PurchaseOrder>>({
    po_date: todayISO(),
    tax: "0",
    discount: "0",
  });
  const [items, setItems] = useState<ItemRow[]>([{ description: "", quantity: 1, unit: "pcs", unit_price: 0 }]);

  const projectsQ = useQuery({
    queryKey: ["projects-light"],
    queryFn: async () => (await api.get<Page<Project>>("/projects?size=1000")).data,
  });
  const companiesQ = useQuery({
    queryKey: ["companies"],
    queryFn: async () => (await api.get<Page<Company>>("/companies?size=1000")).data,
  });
  const vcQ = useQuery({
    queryKey: ["vendors-clients"],
    queryFn: async () => (await api.get<Page<VendorClient>>("/vendors-clients?size=1000")).data,
  });
  const detailQ = useQuery({
    enabled: isEdit,
    queryKey: ["purchase-order", id],
    queryFn: async () => (await api.get<PurchaseOrder>(`/purchase-orders/${id}`)).data,
  });

  useEffect(() => {
    if (detailQ.data) {
      setData(detailQ.data);
      setItems(detailQ.data.items.map((it) => ({
        description: it.description,
        quantity: it.quantity,
        unit: it.unit || "",
        unit_price: it.unit_price,
      })));
    }
  }, [detailQ.data]);

  useEffect(() => {
    if (!isEdit && projectsQ.data && !data.project_id) {
      const proj = projectsQ.data.items[0];
      setData((d) => ({ ...d, project_id: proj?.id, company_id: proj?.company_id }));
    }
  }, [projectsQ.data, isEdit]);

  const subtotal = useMemo(
    () => items.reduce((acc, it) => acc + Number(it.unit_price || 0) * Number(it.quantity || 0), 0),
    [items],
  );
  const total = subtotal + Number(data.tax || 0) - Number(data.discount || 0);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        project_id: data.project_id,
        company_id: data.company_id,
        vendor_client_id: data.vendor_client_id,
        vendor_name: data.vendor_name,
        po_date: data.po_date,
        needed_date: data.needed_date,
        tax: String(data.tax || 0),
        discount: String(data.discount || 0),
        payment_terms: data.payment_terms,
        notes: data.notes,
        items: items.map((it) => ({
          description: it.description,
          quantity: String(it.quantity || 0),
          unit: it.unit || null,
          unit_price: String(it.unit_price || 0),
        })),
      };
      if (isEdit) return (await api.patch(`/purchase-orders/${id}`, payload)).data;
      return (await api.post(`/purchase-orders`, payload)).data;
    },
    onSuccess: (res: PurchaseOrder) => {
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      if (!isEdit) nav(`/purchase-orders/${res.id}`, { replace: true });
    },
  });

  const action = useMutation({
    mutationFn: async (kind: "issue" | "approve" | "cancel") => {
      const body = kind === "cancel" ? { reason: prompt("Alasan batal:") || "" } : undefined;
      return (await api.post(`/purchase-orders/${id}/${kind}`, body)).data;
    },
    onSuccess: (res: PurchaseOrder) => setData(res),
  });

  return (
    <div>
      <PageHeader
        back
        title={isEdit ? `PO ${data.number || ""}` : "Purchase Order Baru"}
        right={data.status && <Badge tone={statusTone(data.status)}>{data.status}</Badge>}
      />
      <Card>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Proyek">
            <Combobox
              disabled={isEdit}
              value={data.project_id ?? null}
              onChange={(v) => {
                const pid = v == null ? undefined : Number(v);
                const proj = projectsQ.data?.items.find((p) => p.id === pid);
                setData({ ...data, project_id: pid, company_id: proj?.company_id });
              }}
              options={(projectsQ.data?.items || []).map((p) => ({
                value: p.id, label: p.name, hint: p.code,
              }))}
              placeholder="Cari proyek..."
              clearable={false}
            />
          </Field>
          <Field label="Perusahaan (kop)">
            <Select disabled={isEdit} value={data.company_id ?? ""} onChange={(e) => setData({ ...data, company_id: Number(e.target.value) })}>
              {companiesQ.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Tanggal PO"><Input type="date" value={data.po_date || ""} onChange={(e) => setData({ ...data, po_date: e.target.value })} /></Field>
          <Field label="Tanggal Kebutuhan"><Input type="date" value={data.needed_date || ""} onChange={(e) => setData({ ...data, needed_date: e.target.value })} /></Field>
        </div>
        <Field label="Vendor (terdaftar)">
          <Select value={data.vendor_client_id ?? ""} onChange={(e) => {
            const vid = e.target.value ? Number(e.target.value) : null;
            const v = vcQ.data?.items.find((x) => x.id === vid);
            setData({ ...data, vendor_client_id: vid, vendor_name: v?.name || data.vendor_name });
          }}>
            <option value="">- pilih -</option>
            {vcQ.data?.items.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </Select>
        </Field>
        <Field label="Nama Vendor (manual)">
          <Input value={data.vendor_name || ""} onChange={(e) => setData({ ...data, vendor_name: e.target.value })} />
        </Field>
        <Field label="Syarat Pembayaran">
          <Input value={data.payment_terms || ""} onChange={(e) => setData({ ...data, payment_terms: e.target.value })} placeholder="cth: NET 30 / DP 50%" />
        </Field>
      </Card>

      <Card className="mt-3">
        <div className="text-sm font-semibold mb-2">Item</div>
        {items.map((it, i) => (
          <div key={i} className="rounded-xl border border-slate-200 p-2 mb-2">
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <Field label="Deskripsi"><Input value={it.description} onChange={(e) => setItems(items.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} /></Field>
                <div className="grid grid-cols-3 gap-2">
                  <Field label="Qty"><Input type="number" inputMode="decimal" value={it.quantity} onChange={(e) => setItems(items.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))} /></Field>
                  <Field label="Unit"><Input value={it.unit || ""} onChange={(e) => setItems(items.map((x, j) => j === i ? { ...x, unit: e.target.value } : x))} /></Field>
                  <Field label="Harga"><Input type="number" inputMode="decimal" value={it.unit_price} onChange={(e) => setItems(items.map((x, j) => j === i ? { ...x, unit_price: e.target.value } : x))} /></Field>
                </div>
                <div className="text-xs text-slate-600">
                  Subtotal: <b>Rp {formatIDR(Number(it.quantity || 0) * Number(it.unit_price || 0))}</b>
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
          onClick={() => setItems([...items, { description: "", quantity: 1, unit: "pcs", unit_price: 0 }])}
        >
          <Plus className="h-4 w-4" /> Tambah item
        </Button>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Field label="Pajak"><Input type="number" inputMode="decimal" value={data.tax ?? "0"} onChange={(e) => setData({ ...data, tax: e.target.value })} /></Field>
          <Field label="Diskon"><Input type="number" inputMode="decimal" value={data.discount ?? "0"} onChange={(e) => setData({ ...data, discount: e.target.value })} /></Field>
        </div>
        <div className="text-sm space-y-1">
          <div className="flex justify-between"><span>Subtotal</span><b className="tabular-nums">Rp {formatIDR(subtotal)}</b></div>
          <div className="flex justify-between"><span>Pajak</span><b className="tabular-nums">Rp {formatIDR(data.tax)}</b></div>
          <div className="flex justify-between"><span>Diskon</span><b className="tabular-nums">Rp {formatIDR(data.discount)}</b></div>
          <div className="flex justify-between text-base"><span>Total</span><b className="tabular-nums">Rp {formatIDR(total)}</b></div>
        </div>
        <Field label="Catatan"><Textarea value={data.notes || ""} onChange={(e) => setData({ ...data, notes: e.target.value })} /></Field>
      </Card>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          onClick={() => save.mutate()}
          disabled={save.isPending || action.isPending}
        >
          {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {save.isPending ? "Menyimpan..." : "Simpan"}
        </Button>
        {isEdit && data.status === "DRAFT" && (
          <Button
            variant="secondary"
            onClick={() => action.mutate("issue")}
            disabled={action.isPending || save.isPending}
          >
            {action.isPending && action.variables === "issue" && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            Issue
          </Button>
        )}
        {isEdit && isAdmin(user) && (data.status === "DRAFT" || data.status === "ISSUED") && (
          <Button
            variant="success"
            onClick={() => action.mutate("approve")}
            disabled={action.isPending || save.isPending}
          >
            {action.isPending && action.variables === "approve" && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            Setujui
          </Button>
        )}
        {isEdit && isAdmin(user) && data.status !== "CANCELLED" && (
          <Button
            variant="danger"
            onClick={() => action.mutate("cancel")}
            disabled={action.isPending || save.isPending}
          >
            {action.isPending && action.variables === "cancel" && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            Batalkan
          </Button>
        )}
        {isEdit && (
          <Button
            type="button"
            variant="secondary"
            onClick={async () => {
              try {
                const res = await api.get(`/purchase-orders/${id}/pdf`, { responseType: "blob" });
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
