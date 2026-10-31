"use client";

import * as React from "react";
import { Check, Download, FileText, PackageCheck, Send, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProgressPill } from "@/components/flow-status/progress-pill";
import { StateChip } from "@/components/flow-status/state-chip";
import { useFlowActions } from "@/components/jobs/detail/flow-actions";
import { formatQty } from "@/components/jobs/detail/detail-helpers";
import { DELIVERY_STATES, flowRank } from "@/lib/jobs/flow-status";
import type { JobDetail } from "@/lib/jobs/types";
import { cn } from "@/lib/utils";
import { deliveredSummary } from "./delivery-dialog";
import { noteDownloadHref } from "./delivery-note-result";
import { PrintButton } from "@/components/print/print-button";
import { DocumentSendDialog } from "@/components/flow/document-send-dialog";
import { currentDeliveryNotes } from "@/lib/jobs/delivery-notes";

/**
 * Dodání zákazníkovi po položkách: „2/3 položek" (nikdy součet kusů různých dílů), u každé
 * položky dodáno / objednáno, tlačítko Zapsat dodání / Dodat zbytek. Zakázka bez položek má
 * částečnou dodávku poznámkou. Při 100 % posune zakázku na Dodáno zákazníkovi DB.
 */
export function DeliveryCard({ job, className }: { job: JobDetail; className?: string }) {
  const flow = useFlowActions();
  const [sending, setSending] = React.useState<{ id: string; filename: string; number: string } | null>(null);
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
  const notes = currentDeliveryNotes(job.files ?? []);
  // hlavní tlačítko v hlavičce je právě zápis dodání → druhé stejné tlačítko v kartě se neukazuje;
  // ve výrobě (hlavička = posun výroby) je karta nejviditelnější cesta k dodání a DL — zůstává
  const sameAsHeader = flow.next?.key === "delivery.record" || flow.next?.key === "delivery.partialNote";

  return (
    <section id="dodani-zakaznikovi" aria-label="Dodání zákazníkovi" className={cn("overflow-hidden rounded-2xl border bg-card shadow-sm", className)}>
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
            {sameAsHeader ? (
              <p className="w-full text-xs text-muted-foreground">
                Dodání zapíšeš tlačítkem <strong className="font-semibold text-foreground">{flow.next?.label}</strong> nahoře — vystaví dodací list s dodanými kusy.
              </p>
            ) : (
              <Button type="button" variant="success" className="h-11 sm:h-9" onClick={() => flow.run(items.length ? "delivery.record" : "delivery.partialNote")}>
                <Truck /> {key === "castecne" ? "Dodat zbytek" : items.length ? "Zapsat dodání a dodací list" : "Zapsat dodání"}
              </Button>
            )}
            {key === "castecne" && items.length > 0 && (
              <Button type="button" variant="outline" className="h-11 sm:h-9" onClick={() => flow.run("delivery.closeShort")}>
                <PackageCheck className="text-green-600" /> Uzavřít s menším množstvím
              </Button>
            )}
          </div>
        )}
        {notes.length > 0 && (
          <div className="space-y-1.5">
            <h4 className="text-xs font-medium text-muted-foreground">Dodací listy</h4>
            <ul className="divide-y rounded-lg border text-sm" aria-label="Dodací listy">
              {notes.map((n) => (
                <li key={n.id} className="flex flex-wrap items-center gap-2 px-2.5 py-1.5">
                  <FileText className="h-4 w-4 shrink-0 text-green-600 dark:text-green-400" aria-hidden />
                  <a href={`/api/jobs/files/${n.id}`} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate font-mono text-xs font-medium hover:underline">
                    {n.number}{n.label && <span className="font-sans font-normal text-muted-foreground"> · {n.label}</span>}
                  </a>
                  <Button asChild size="sm" variant="ghost" className="h-9 px-2">
                    <a href={noteDownloadHref(n.id)} download={n.filename} aria-label={`Stáhnout ${n.number}`}><Download /></a>
                  </Button>
                  <PrintButton href={`/api/jobs/files/${n.id}`} filename={n.filename} label={`Tisknout ${n.number}`} size="sm" className="h-9 px-2" />
                  <Button type="button" size="sm" variant="ghost" className="h-9 px-2" aria-label={`Poslat ${n.number} zákazníkovi`} onClick={() => setSending(n)}>
                    <Send />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {sending && (
        <DocumentSendDialog
          open
          onOpenChange={(o) => { if (!o) setSending(null); }}
          jobId={job.id}
          kind="dodaci_list"
          fileId={sending.id}
          filename={sending.filename}
          title={`Poslat dodací list ${sending.number} zákazníkovi`}
          onSent={() => setSending(null)}
        />
      )}
    </section>
  );
}
