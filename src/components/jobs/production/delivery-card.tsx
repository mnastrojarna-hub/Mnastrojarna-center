"use client";

import * as React from "react";
import { Check, PackageCheck, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProgressPill } from "@/components/flow-status/progress-pill";
import { StateChip } from "@/components/flow-status/state-chip";
import { useFlowActions } from "@/components/jobs/detail/flow-actions";
import { formatQty } from "@/components/jobs/detail/detail-helpers";
import { DELIVERY_STATES, flowRank } from "@/lib/jobs/flow-status";
import type { JobDetail } from "@/lib/jobs/types";
import { cn } from "@/lib/utils";
import { deliveredSummary } from "./delivery-dialog";

/**
 * Dodání zákazníkovi po položkách: „2/3 položek" (nikdy součet kusů různých dílů), u každé
 * položky dodáno / objednáno, tlačítko Zapsat dodání / Dodat zbytek. Zakázka bez položek má
 * částečnou dodávku poznámkou. Při 100 % posune zakázku na Dodáno zákazníkovi DB.
 */
export function DeliveryCard({ job, className }: { job: JobDetail; className?: string }) {
  const flow = useFlowActions();
  const facts = flow?.facts;
  if (!flow || !facts?.orderStatus) return null;
  if (job.stage === "reklamace" || job.stage === "nerealizovano" || job.stage === "zruseno") return null;
  const rank = flowRank(job.stage);
  if (rank < 3 && job.stage !== "pozastaveno") return null;
  const key = flow.snapshot?.delivery ?? null;
  const items = job.items;
  const summary = items.length ? deliveredSummary(items) : null;
  const allDone = summary ? summary.done === summary.total : rank >= 9;
  const can = flow.ctx.can("workflow");

  return (
    <section aria-label="Dodání zákazníkovi" className={cn("overflow-hidden rounded-2xl border bg-card shadow-sm", className)}>
      <header className="flex items-center gap-2.5 border-b px-4 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300">
          <Truck className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-tight">Dodání zákazníkovi</h3>
          <p className="text-xs text-muted-foreground">{items.length ? "po položkách — při 100 % se zakázka posune sama" : "zakázka bez položek"}</p>
        </div>
        {key && <StateChip meta={DELIVERY_STATES[key]} size="xs" />}
      </header>
      <div className="space-y-3 p-4">
        {summary && <ProgressPill progress={summary} hue="green" className="text-sm font-medium" />}
        {items.length > 0 && (
          <ul className="divide-y rounded-lg border text-xs">
            {items.map((i) => {
              const done = Boolean(i.deliveryClosed) || (i.deliveredQuantity ?? 0) >= i.quantity;
              return (
                <li key={i.id} className="flex items-center gap-2 px-2.5 py-1.5">
                  {done ? <Check className="h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-400" aria-label="dodáno" /> : <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-muted-foreground/40" aria-hidden />}
                  <span className="min-w-0 flex-1 truncate">{(i.name ?? "").trim() || i.drawingNumber || i.description || "Položka"}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatQty(i.deliveredQuantity ?? 0)}/{formatQty(i.quantity)} {i.unit}
                    {i.deliveryClosed && " · uzavřeno"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {!items.length && facts.partialDeliveryAt && (
          <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-900 dark:bg-green-500/10 dark:text-green-200">Částečná dodávka zapsána — zbytek označ „Dodáno vše“.</p>
        )}
        {can && !allDone && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="success" className="h-11 sm:h-9" onClick={() => flow.run(items.length ? "delivery.record" : "delivery.partialNote")}>
              <Truck /> {key === "castecne" ? "Dodat zbytek" : "Zapsat dodání"}
            </Button>
            {key === "castecne" && items.length > 0 && (
              <Button type="button" variant="outline" className="h-11 sm:h-9" onClick={() => flow.run("delivery.closeShort")}>
                <PackageCheck className="text-green-600" /> Uzavřít s menším množstvím
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
