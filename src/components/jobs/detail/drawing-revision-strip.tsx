"use client";

import type { JobItem } from "@/lib/jobs/types";
import { cn } from "@/lib/utils";
import { useFlowActions } from "./flow-actions";

/**
 * Revize výkresů položek (záložka Položky): aktuální revize, štítek „rev. změněna" (z → na) a „Nová revize…"
 * u každé položky s číslem výkresu — stejný dialog jako „Aktualizace výkresu…" v menu karty.
 */
export function DrawingRevisionStrip({ items }: { items: JobItem[] }) {
  const flow = useFlowActions();
  if (!flow) return null;
  const withDrawing = items.filter((i) => (i.drawingNumber ?? "").trim());
  if (!withDrawing.length) return null;
  const changes = flow.drawingChanges ?? [];
  const canEdit = flow.ctx.can("workflow");
  if (!canEdit && !changes.length) return null;
  const closed = flow.facts?.stage === "nerealizovano" || flow.facts?.stage === "zruseno";
  return (
    <div className="flex flex-wrap gap-1.5" data-testid="drawing-revisions" aria-label="Revize výkresů">
      {withDrawing.map((i) => {
        const change = changes.find((c) => c.itemId === i.id);
        const fresh = Boolean(change && !change.acknowledgedAt);
        return (
          <span key={i.id} className={cn(
            "inline-flex min-h-8 flex-wrap items-center gap-1.5 rounded-full border px-2.5 text-xs",
            fresh ? "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-100" : "bg-background",
          )}>
            <span className="font-mono font-medium">{i.drawingNumber}</span>
            <span className="text-muted-foreground">rev. {i.revision ?? "—"}</span>
            {change && (
              <span className={cn("rounded-full px-1.5 py-0.5 text-[11px] font-medium", fresh ? "bg-rose-600 text-white" : "bg-muted text-muted-foreground")}
                title={`Revize změněna: ${change.revFrom ?? "—"} → ${change.revTo ?? "—"}`}>
                rev. změněna ({change.revFrom ?? "—"} → {change.revTo ?? "—"})
              </span>
            )}
            {!closed && canEdit && (
              <button type="button" className="min-h-8 font-medium text-primary hover:underline" onClick={() => flow.run("drawing.update", { itemId: i.id })}>
                Nová revize…
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}
