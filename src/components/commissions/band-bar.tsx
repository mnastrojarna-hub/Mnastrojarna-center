import { TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  bandBar, bandTone, compactCzk, czk, formatRate, tierRangeLabel, type CommissionBandView, type CommissionTierView,
} from "./model";

/**
 * Lišta pásmové provize: segmenty podle pásem (0 / 10 / 15 / 20 %), naplnění
 * inkasem v pásmu, značka měsíčního inkasa a pod tím rozpad — kolik inkasa
 * a zisku spadlo do pásma a jaká z něj je provize. Čísla pásem dodává DB.
 */
export function BandBar({
  bands, revenue, showNext = false, compact = false, className,
}: {
  bands: (CommissionTierView & Partial<Pick<CommissionBandView, "revenue" | "profit" | "commission">>)[];
  revenue: number;
  /** Ukázat, kolik chybí do vyššího pásma (běžící měsíc). */
  showNext?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const m = bandBar(bands, revenue);
  if (!m.segments.length) return null;
  let acc = 0;
  const ticks = m.segments.map((s) => {
    const at = acc;
    acc += s.width;
    return { at, value: s.from };
  });

  return (
    <div className={cn("space-y-3", className)}>
      <div className="relative pt-6">
        {/* značka inkasa */}
        <div
          className="absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-foreground px-2 py-0.5 text-[10px] font-semibold text-background shadow"
          style={{ left: `${Math.min(92, Math.max(8, m.markerPct))}%` }}
        >
          inkaso {compactCzk(revenue)}
        </div>
        <div className="relative flex h-9 overflow-hidden rounded-xl ring-1 ring-border" role="img" aria-label={`Měsíční inkaso ${czk(revenue)} v pásmech provize`}>
          {m.segments.map((s) => {
            const t = bandTone(s.index);
            return (
              <div key={s.index} className={cn("relative h-full border-r border-background/80 last:border-r-0", t.track)} style={{ width: `${s.width}%` }}>
                <div className={cn("absolute inset-y-0 left-0 transition-all duration-700", t.fill, s.fill < 1 && s.fill > 0 && "rounded-r-md")} style={{ width: `${s.fill * 100}%` }} />
                {s.width >= 8 && (
                  <span className={cn("absolute inset-0 flex items-center justify-center text-xs font-bold", s.fill > 0.5 ? "text-white drop-shadow" : t.text)}>
                    {formatRate(s.rate)}
                  </span>
                )}
              </div>
            );
          })}
          <span className="absolute inset-y-0 z-10 w-0.5 bg-foreground" style={{ left: `${m.markerPct}%` }} aria-hidden />
        </div>
        <div className="relative mt-1 h-4 text-[10px] tabular-nums text-muted-foreground">
          {ticks.map((t, i) => (
            <span key={i} className={cn("absolute", i === 0 ? "translate-x-0" : "-translate-x-1/2")} style={{ left: `${t.at}%` }}>
              {i === 0 ? "0" : compactCzk(t.value)}
            </span>
          ))}
        </div>
      </div>

      {showNext && m.next && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
          Do pásma <strong className={bandTone(m.segments.findIndex((s) => s.from === m.next?.from)).text}>{formatRate(m.next.rate)}</strong> chybí{" "}
          <strong className="text-foreground">{czk(m.next.missing)}</strong> inkasa.
        </p>
      )}

      {!compact && (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {m.segments.map((s) => {
            const t = bandTone(s.index);
            return (
              <li key={s.index} className={cn("rounded-xl border p-2.5 text-xs transition", s.reached ? "bg-card shadow-sm" : "bg-muted/20 opacity-70", s.current && "ring-2 ring-foreground/15")}>
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", t.chip)}>{formatRate(s.rate)}</span>
                  <span className="truncate text-muted-foreground">{tierRangeLabel(s, true)}</span>
                </div>
                <dl className="mt-2 space-y-0.5">
                  <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Inkaso v pásmu</dt><dd className="font-medium tabular-nums">{czk(s.revenue)}</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Zisk pásma</dt><dd className="font-medium tabular-nums">{czk(s.profit)}</dd></div>
                  <div className="flex justify-between gap-2 border-t pt-1"><dt className="font-medium">Provize</dt><dd className={cn("font-bold tabular-nums", s.commission > 0 ? t.text : "text-muted-foreground")}>{czk(s.commission)}</dd></div>
                </dl>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
