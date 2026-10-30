import { EyeOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ANON_TONE_CLASS, fileAnonLabel, jobAnonBadge, type AnonUiStatus, type JobBadgeInput } from "./anon-status";

/**
 * Odznaky anonymizace (bez stavu — server i klient):
 *  - JobAnonBadge: řádek zakázky v Poptávkách — čipy podle naléhavosti, každý vlastní barvou, nejvýš 2 + „+N",
 *  - FileAnonBadge: dokument zakázky / výkres v archivu.
 */

export function JobAnonBadge({ badge, className }: { badge: JobBadgeInput | null | undefined; className?: string }) {
  const b = jobAnonBadge(badge);
  if (!b) return null;
  return (
    <span title={b.title} data-anon-badge={b.tone} className={cn("inline-flex max-w-full flex-wrap items-center gap-1", className)}>
      {b.visible.map((p, i) => (
        <span key={p.text} className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", ANON_TONE_CLASS[p.tone])}>
          {i === 0 && (p.tone === "busy" ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <EyeOff className="h-3 w-3" aria-hidden />)}
          {p.text}
        </span>
      ))}
      {b.more > 0 && (
        <span className="whitespace-nowrap rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground" aria-label={`a další ${b.more}`}>+{b.more}</span>
      )}
    </span>
  );
}

export function FileAnonBadge({
  status, reviewed, reason, total, backfill, stalled, className,
}: { status: AnonUiStatus | null | undefined; reviewed?: boolean; reason?: string | null; total?: number | null; backfill?: boolean; stalled?: boolean; className?: string }) {
  if (!status) return null;
  const l = fileAnonLabel({ status, reviewed, reason, total, backfill, stalled });
  const busy = l.tone === "busy";
  return (
    <span
      title={l.hint}
      data-anon-status={status}
      {...(stalled ? { "data-anon-stalled": "1" } : {})}
      className={cn("inline-flex items-center gap-0.5 whitespace-nowrap rounded-full px-1.5 py-px text-[10px] font-semibold", ANON_TONE_CLASS[l.tone], className)}
    >
      {busy ? <Loader2 className="h-2.5 w-2.5 animate-spin" aria-hidden /> : <EyeOff className="h-2.5 w-2.5" aria-hidden />}
      {l.label}
    </span>
  );
}
