/** Kerangka saat halaman dimuat – bentuknya mirip isi sungguhan supaya tidak "melompat". */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Memuat" className="space-y-5">
      <div className="space-y-2">
        <div className="bintang-skeleton h-4 w-32 rounded" />
        <div className="bintang-skeleton h-7 w-64 rounded" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bintang-skeleton h-20 rounded-lg" />
        ))}
      </div>
      <div className="space-y-px overflow-hidden rounded-lg border border-border bg-surface">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-4">
            <div className="bintang-skeleton size-8 rounded-full" />
            <div className="flex-1 space-y-2">
              <div className="bintang-skeleton h-3.5 w-2/3 rounded" />
              <div className="bintang-skeleton h-3 w-1/3 rounded" />
            </div>
            <div className="bintang-skeleton h-4 w-20 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
