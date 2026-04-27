import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge, statusTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Plus } from "lucide-react";
import { formatDate, formatIDR } from "@/lib/utils";
import type { Page, PurchaseOrder } from "@/types";

export default function POPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["purchase-orders"],
    queryFn: async () => (await api.get<Page<PurchaseOrder>>("/purchase-orders?size=100")).data,
  });

  return (
    <div>
      <PageHeader
        back
        title="Purchase Order"
        right={<Link to="/purchase-orders/new"><Button size="sm"><Plus className="h-4 w-4" /> Baru</Button></Link>}
      />
      {isLoading ? (
        <div className="text-sm text-slate-500">Memuat...</div>
      ) : (
        <div className="space-y-2">
          {data?.items.map((po) => (
            <Link key={po.id} to={`/purchase-orders/${po.id}`}>
              <Card className="!p-3 active:bg-slate-50">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs text-slate-500 truncate">{po.number}</div>
                    <div className="text-sm font-medium truncate">{po.vendor_name || "-"}</div>
                    <div className="text-[11px] text-slate-500">{formatDate(po.po_date)}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="tabular-nums font-semibold text-sm">Rp {formatIDR(po.total)}</div>
                    <Badge tone={statusTone(po.status)}>{po.status}</Badge>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
          {data?.items.length === 0 && <div className="text-sm text-slate-500">Belum ada PO.</div>}
        </div>
      )}
    </div>
  );
}
