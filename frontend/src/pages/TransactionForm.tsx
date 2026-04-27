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
import type { Category, Page, Project, Transaction, VendorClient } from "@/types";
import { todayISO } from "@/lib/utils";
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
      if (isEdit) return (await api.patch(`/transactions/${id}`, payload)).data;
      return (await api.post("/transactions", payload)).data;
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

  return (
    <div>
      <PageHeader
        back
        title={isEdit ? `Transaksi #${id}` : "Transaksi Baru"}
        right={data.status && <Badge tone={statusTone(data.status)}>{data.status}</Badge>}
      />

      <Card>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Tipe">
            <Select disabled={isLocked} value={data.type || "OUT"} onChange={(e) => setData({ ...data, type: e.target.value as any, category_id: undefined })}>
              <option value="IN">Masuk</option>
              <option value="OUT">Keluar</option>
            </Select>
          </Field>
          <Field label="Tanggal">
            <Input disabled={isLocked} type="date" value={data.tx_date || ""} onChange={(e) => setData({ ...data, tx_date: e.target.value })} />
          </Field>
        </div>

        <Field label="Proyek">
          <Select disabled={isLocked || isEdit} value={data.project_id ?? ""} onChange={(e) => setData({ ...data, project_id: Number(e.target.value) })}>
            <option value="">- pilih -</option>
            {projectsQ.data?.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>

        <Field label="Kategori">
          <Select disabled={isLocked} value={data.category_id ?? ""} onChange={(e) => setData({ ...data, category_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">(tanpa kategori)</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>

        <Field label="Nominal (Rp)">
          <Input
            disabled={isLocked}
            type="number"
            inputMode="decimal"
            placeholder="0"
            value={data.amount ?? ""}
            onChange={(e) => setData({ ...data, amount: e.target.value })}
          />
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
          <AttachmentUploader
            attachments={attachments as any}
            onChange={setAttachments as any}
            uploadUrl={`/transactions/${id}/attachments`}
            deleteUrl={(aid) => `/transactions/${id}/attachments/${aid}`}
            disabled={isLocked}
          />
        </Card>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={() => save.mutate()} disabled={save.isPending || isLocked}>
          {isEdit ? "Simpan Perubahan" : "Simpan Draft"}
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
