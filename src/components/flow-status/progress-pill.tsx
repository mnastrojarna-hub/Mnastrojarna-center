import { cn } from "@/lib/utils";
import { PILL_BAR, PILL_FILL, PILL_TRACK, type PillHue, type Progress } from "@/lib/jobs/flow-status";

/** Pilulka průběhu („2/3 položek") — podklad + výplň v odstínu fáze, text tabular-nums. */
export function ProgressPill({
  progress, hue = "green", showLabel = true, className,
}: {
  progress: Progress;
  hue?: PillHue;
  showLabel?: boolean;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, progress.pct));
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={progress.label}
        className={PILL_TRACK}
      >
        <span className={cn(PILL_BAR, PILL_FILL[hue])} style={{ width: `${pct}%` }} />
      </span>
      {showLabel && <span className="tabular-nums">{progress.label}</span>}
    </span>
  );
}
