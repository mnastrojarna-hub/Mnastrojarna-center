import { OPERATION_KINDS, isOperationKind } from "@/lib/jobs/operations";
import { cn } from "@/lib/utils";
import { miniSegments, type MiniSegment } from "./production-helpers";

/**
 * Mini pruh průběhu výroby (hotovo / celkem) — bez stavu, funguje na serveru
 * i v klientu (řádek knihy, karta tabule, hlavička zakázky). Aktuální úsek má
 * barvu druhu operace, problém je červený.
 */
export function ProductionMiniBar({
  done, total, step, problem, className,
}: {
  done: number;
  total: number;
  /** Druh aktuální operace / „hotovo". */
  step: string | null | undefined;
  problem?: boolean;
  className?: string;
}) {
  const finished = step === "hotovo";
  const segments = miniSegments(done, total, { problem, finished });
  const kindDot = isOperationKind(step) ? OPERATION_KINDS[step].dot : "bg-amber-500";
  const tone = (s: MiniSegment) => (s === "done" ? "bg-green-500" : s === "problem" ? "bg-red-500" : "bg-muted-foreground/20");

  if (!segments) {
    const pct = total > 0 ? Math.max(0, Math.min(100, Math.round((done / total) * 100))) : 0;
    return (
      <span aria-hidden className={cn("flex h-1.5 w-full overflow-hidden rounded-full bg-muted-foreground/20", className)}>
        <span className={cn("h-full rounded-full", problem ? "bg-red-500" : "bg-green-500")} style={{ width: `${pct}%` }} />
      </span>
    );
  }
  return (
    <span aria-hidden className={cn("flex h-1.5 w-full gap-0.5", className)}>
      {segments.map((s, i) => (
        <span key={i} className={cn("relative h-full min-w-[4px] flex-1 overflow-hidden rounded-full", tone(s))}>
          {/* aktuální operace: rozdělaná (napůl v barvě druhu) */}
          {s === "current" && <span className={cn("absolute inset-y-0 left-0 w-1/2 rounded-full", kindDot)} />}
        </span>
      ))}
    </span>
  );
}
