/**
 * Okamžitá odezva při přechodu mezi stránkami (skeleton). Zároveň hranice pro
 * prefetch odkazů v menu — Next.js předem načítá jen tuto kostru, ne celé
 * stránky s dotazy do databáze (dříve 18 serverových volání při každém načtení).
 */
export default function AppLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Načítám…">
      <div className="space-y-2">
        <div className="h-6 w-48 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-80 max-w-full animate-pulse rounded-md bg-muted/70" />
      </div>
      <div className="flex flex-wrap gap-2">
        {["bg-sky-500/20", "bg-amber-500/20", "bg-violet-500/20", "bg-orange-500/20", "bg-indigo-500/20", "bg-green-500/20"].map((c) => (
          <div key={c} className={`h-8 w-28 animate-pulse rounded-full ${c}`} />
        ))}
      </div>
      <div className="overflow-hidden rounded-xl border">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0">
            <div className="h-9 w-1 rounded-full bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-muted/70" />
            </div>
            <div className="hidden h-6 w-24 animate-pulse rounded-full bg-muted sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
