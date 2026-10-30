import { CalendarClock, Flag } from "lucide-react";
import { deadlinePill, deadlineText, type DeadlineOp, type PillTone } from "@/lib/jobs/production-handoff";
import { cn } from "@/lib/utils";

export const PILL_TONE: Record<PillTone, string> = {
  grey: "bg-muted text-foreground/80",
  green: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  red: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
};

/**
 * Termín kroku: krátký štítek („mezitermín 13. 11. · Hrubý · odhad" / „konečný 20. 11. · zákazník")
 * a celé znění pod ním (s kým a jak jistě je termín dohodnutý). Nikdy „dohodnuto", když to nikdo nedohodl.
 */
export function DeadlineChip({
  op, finalDate, today, compact, className,
}: {
  op: DeadlineOp;
  finalDate?: { date: string | null; source: "due_date" | "customer_required_date" | null } | null;
  today: string;
  /** Jen štítek (bez dlouhého textu). */
  compact?: boolean;
  className?: string;
}) {
  const ctx = { finalDate: finalDate ?? null, today };
  const pill = deadlinePill(op, ctx);
  if (!pill) return null;
  const text = deadlineText(op, ctx);
  const Icon = op.endsAtCustomerDate ? Flag : CalendarClock;
  return (
    <span className={cn("flex min-w-0 max-w-full flex-col gap-0.5", className)}>
      <span className={cn("inline-flex w-fit max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", PILL_TONE[pill.tone])} title={text ?? undefined}>
        <Icon className="h-3 w-3 shrink-0" />
        <span className="truncate">{pill.text}</span>
      </span>
      {!compact && text && <span className="break-words text-[11.5px] leading-snug text-muted-foreground">{text}</span>}
    </span>
  );
}
