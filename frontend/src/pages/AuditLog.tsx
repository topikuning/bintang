import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import PageHeader from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

export default function AuditLogPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["audit-logs"],
    queryFn: async () => (await api.get("/audit-logs?size=200")).data,
  });

  return (
    <div>
      <PageHeader back title="Audit Log" subtitle="Riwayat perubahan data" />
      {isLoading ? (
        <div className="text-sm text-slate-500">Memuat...</div>
      ) : (
        <div className="space-y-2">
          {data?.items.map((l: any) => (
            <Card key={l.id} className="!p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm">
                    <b>{l.user_name || "system"}</b> · {l.entity}#{l.entity_id}
                  </div>
                  <div className="text-[11px] text-slate-500">{new Date(l.created_at).toLocaleString("id-ID")}</div>
                  {l.note && <div className="text-xs text-slate-600 mt-0.5">{l.note}</div>}
                </div>
                <Badge>{l.action}</Badge>
              </div>
            </Card>
          ))}
          {data?.items.length === 0 && <div className="text-sm text-slate-500">Belum ada log.</div>}
        </div>
      )}
    </div>
  );
}
