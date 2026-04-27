import { ChevronLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function PageHeader({
  title,
  subtitle,
  back,
  right,
}: {
  title: string;
  subtitle?: string;
  back?: boolean;
  right?: React.ReactNode;
}) {
  const nav = useNavigate();
  return (
    <div className="mb-3 flex items-center gap-2">
      {back && (
        <button
          onClick={() => nav(-1)}
          aria-label="Kembali"
          className="grid h-9 w-9 place-items-center rounded-full bg-white border border-slate-200"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}
      <div className="flex-1 min-w-0">
        <h1 className="text-lg font-bold leading-tight truncate">{title}</h1>
        {subtitle && <p className="text-xs text-slate-500 truncate">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}
