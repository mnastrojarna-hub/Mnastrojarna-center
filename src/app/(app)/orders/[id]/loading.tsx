/**
 * Kostra karty zakázky — okamžitě po kliknutí na řádek Knihy (prefetch odkazu načte jen tuto kostru,
 * data karty se dotahují souběžně). Tvar odpovídá kartě: lišta, hlavička, časová osa, termíny, záložky.
 */
export default function JobDetailLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Načítám…">
      <div className="flex items-center justify-between gap-2">
        <div className="h-8 w-28 animate-pulse rounded-md bg-muted" />
        <div className="flex gap-2">
          <div className="h-8 w-24 animate-pulse rounded-md bg-muted/70" />
          <div className="h-8 w-8 animate-pulse rounded-md bg-muted/70" />
        </div>
      </div>
      <div className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <div className="h-7 w-32 animate-pulse rounded-md bg-muted" />
          <div className="h-6 w-24 animate-pulse rounded-full bg-orange-500/20" />
        </div>
        <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
        <div className="h-4 w-1/3 animate-pulse rounded bg-muted/70" />
      </div>
      <div className="flex gap-2 overflow-hidden rounded-2xl border bg-card p-3">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-10 flex-1 animate-pulse rounded-lg bg-muted/60" />
        ))}
      </div>
      <div className="h-20 animate-pulse rounded-2xl border bg-muted/30" />
      <div className="flex gap-1 rounded-xl bg-muted/50 p-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-8 w-24 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-48 animate-pulse rounded-2xl border bg-muted/30" />
        <div className="h-48 animate-pulse rounded-2xl border bg-muted/30" />
      </div>
    </div>
  );
}
