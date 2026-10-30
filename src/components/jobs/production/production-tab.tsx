"use client";

import * as React from "react";
import { AlertTriangle, ArrowRightCircle, ChevronDown, Clock, Factory, Flag, Plus, RefreshCw, Trash2, Undo2, Workflow } from "lucide-react";
import { routeHealth } from "@/lib/jobs/production-handoff";
import { isStepReady } from "@/lib/jobs/production";
import { stageRank } from "@/lib/jobs/stages";
import { shortDate } from "@/components/jobs/book/book-params";
import type { JobStage } from "@/lib/supabase/database.types";
import { ProductionHandoffDialog } from "./handoff/handoff-dialog";
import type { HandoffAccess } from "./production-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deleteJobOperation } from "@/app/actions/production";
import { OPERATION_KINDS, OPERATION_TEMPLATES } from "@/lib/jobs/operations";
import { sortOperations } from "@/lib/jobs/production";
import type { JobDetail } from "@/lib/jobs/types";
import type { JobOperation, JobProductionSummary, JobClosingInfo } from "@/lib/jobs/production-types";
import { useAccess } from "@/components/access-provider";
import { useJobDetail } from "@/components/jobs/detail/detail-context";
import { ConfirmDialog } from "@/components/jobs/detail/confirm-dialog";
import { todayInPrague } from "@/components/jobs/book/book-params";
import { cn } from "@/lib/utils";
import { ProductionProvider, type DialogState, type ProductionCtxValue } from "./production-context";
import { ProductionSummary } from "./production-summary";
import { OperationTimeline } from "./operation-item";
import { ProductionEmpty } from "./production-empty";
import { OperationDialog } from "./operation-dialog";
import { TemplateDialog, CompleteDeliveryDialog } from "./template-dialog";
import { NoteDialog } from "./note-dialog";
import { CustomerNoteCard } from "./customer-note-card";
import { ClosingCard } from "./closing-card";
import { DeliveryCard } from "./delivery-card";
import { TechnologySection } from "./technology-section";
import type { JobFlowData } from "@/components/jobs/detail/job-detail-view";

export interface JobProductionData {
  operations: JobOperation[];
  summary: JobProductionSummary;
  closing: JobClosingInfo | null;
  /** Předání do výroby: práva a konečný termín (zákazník). */
  handoff?: {
    permissions: HandoffAccess;
    finalDate: { date: string | null; source: "due_date" | "customer_required_date" | null; maxTolerated: string | null };
  } | null;
}

/** Stav zakázky před výrobou (předání ještě neproběhlo). */
function beforeProduction(stage: JobStage): boolean {
  const r = stageRank(stage);
  return (r >= 0 && r < 5) || stage === "pozastaveno" || stage === "reklamace";
}

/**
 * Banner nad postupem (H.4): před výrobou „Předat do výroby…", ve výrobě bez kdo / termínu
 * „Doplnit kdo a termín…", varování o celém postupu (termíny se překrývají, konec po konečném termínu).
 */
function HandoffBanner({ stage, ops, finalDate, today, onOpen }: {
  stage: JobStage;
  ops: JobOperation[];
  finalDate: { date: string | null; source: "due_date" | "customer_required_date" | null } | null;
  today: string;
  onOpen: (d: Exclude<DialogState, null>) => void;
}) {
  const live = ops.filter((o) => o.status !== "preskoceno");
  const cur = live.find((o) => o.status === "probiha" || o.status === "problem") ?? live.find((o) => o.status === "ceka") ?? null;
  const health = routeHealth(ops.map((o) => ({ ...o })), { dueDate: finalDate?.source === "due_date" ? finalDate.date : null, customerRequiredDate: finalDate?.source === "customer_required_date" ? finalDate.date : null }, today)
    .filter((h) => h.code !== "step_overdue");
  const box = "flex flex-col gap-2 rounded-2xl border p-3 text-sm sm:flex-row sm:items-center sm:p-4";
  const btn = "h-11 shrink-0 gap-2 bg-rose-600 px-4 text-base font-semibold text-white hover:bg-rose-700 sm:h-10 sm:text-sm";
  return (
    <div className="space-y-2">
      {beforeProduction(stage) && live.length > 0 && (
        <div className={cn(box, "border-rose-200 bg-rose-50/70 dark:border-rose-500/30 dark:bg-rose-500/10")} data-testid="handoff-banner">
          <Factory className="h-5 w-5 shrink-0 text-rose-600" />
          <p className="flex-1 font-medium">Postup je připravený — zakázka ještě není ve výrobě.</p>
          <Button type="button" className={btn} onClick={() => onOpen({ type: "handoff", kind: "predani" })}>Předat do výroby…</Button>
        </div>
      )}
      {stage === "ve_vyrobe" && (!cur || !isStepReady(cur)) && (
        <div role="alert" className={cn(box, "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200")} data-testid="handoff-legacy">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <p className="flex-1 font-medium">Zakázka je ve výrobě, ale chybí, kdo to dělá a termín.</p>
          <Button type="button" className={btn} onClick={() => onOpen({ type: "handoff", kind: "doplneni", operationId: cur?.id })}>Doplnit kdo a termín…</Button>
        </div>
      )}
      {health.map((h, i) => (
        <div key={`${h.code}-${i}`} className={cn(box, "border-orange-200 bg-orange-50 text-orange-900 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-200")}>
          <Clock className="h-5 w-5 shrink-0" />
          <p className="flex-1">{h.message}</p>
          {(h.code === "final_changed" || h.code === "route_late") && (
            <Button type="button" variant="outline" className="h-11 shrink-0 sm:h-9" onClick={() => onOpen({ type: "handoff", kind: "plan", replan: true })}>Přeplánovat výrobu…</Button>
          )}
        </div>
      ))}
    </div>
  );
}

/** Konec postupu: dodání zákazníkovi s konečným termínem (s kým dohodnuto) a kdy bude výroba hotová. */
function EndStation({ ops, finalDate, today }: { ops: JobOperation[]; finalDate: { date: string | null; source: "due_date" | "customer_required_date" | null } | null; today: string }) {
  const live = ops.filter((o) => o.status !== "preskoceno");
  if (!live.length) return null;
  const end = live.map((o) => o.plannedEnd).filter((x): x is string => Boolean(x)).sort().pop() ?? null;
  return (
    <div className="mt-3 flex items-start gap-3 rounded-xl border border-dashed border-rose-300 bg-rose-50/40 p-3 text-sm dark:border-rose-500/30 dark:bg-rose-500/5" data-testid="end-station">
      <Flag className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
      <div className="min-w-0">
        <p className="font-semibold">
          Dodání zákazníkovi
          {finalDate?.date
            ? ` · konečný termín ${shortDate(finalDate.date, today)} — ${finalDate.source === "customer_required_date" ? "požadavek zákazníka, zatím nepotvrzený" : "dohodnuto se zákazníkem"}`
            : " · konečný termín (zákazník) zatím chybí"}
        </p>
        {end && <p className="text-xs text-muted-foreground">Výroba hotová do: {shortDate(end, today)}</p>}
      </div>
    </div>
  );
}

/**
 * Záložka „Výroba" karty zakázky: kde se zakázka právě nachází, podrobný
 * postup (linka metra s jedním tlačítkem Začít / Hotovo), domluvy se
 * zákazníkem a konec toku — potvrzený dodací list → faktura → zaplaceno.
 */
export function ProductionTab({ job, data, flow }: { job: JobDetail; data: JobProductionData | null; flow?: JobFlowData | null }) {
  const { perms, options, notify, refresh, refreshing } = useJobDetail();
  const { userId } = useAccess();
  const today = todayInPrague();
  const serverOps = data?.operations;
  const [ops, setOps] = React.useState<JobOperation[]>(serverOps ?? []);
  const [synced, setSynced] = React.useState(serverOps);
  const [dialog, setDialog] = React.useState<DialogState>(null);

  // nová data ze serveru přepíšou optimistický stav
  if (serverOps !== synced) {
    setSynced(serverOps);
    setOps(serverOps ?? []);
  }

  const handoff = data?.handoff ?? null;
  const items = React.useMemo(() => job.items.map((i) => ({ id: i.id, drawingNumber: i.drawingNumber ?? null, name: i.name ?? null })), [job.items]);
  const ctx = React.useMemo<ProductionCtxValue>(() => ({
    jobId: job.id, today, ops, setOps, suppliers: options.suppliers, events: job.events, canDeleteAll: perms.canDelete, userId,
    open: setDialog, stage: job.stage, permissions: handoff?.permissions ?? null, finalDate: handoff?.finalDate ?? null, items,
  }), [job.id, today, ops, options.suppliers, job.events, perms.canDelete, userId, job.stage, handoff, items]);

  const close = React.useCallback(() => setDialog(null), []);
  const sorted = sortOperations(ops);
  const note = data?.closing ? data.closing.customerNote : job.customerNote ?? null;

  return (
    <ProductionProvider value={ctx}>
      <div className="space-y-4">
        {!data && (
          <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200 sm:flex-row sm:items-center">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <p className="flex-1">Výrobu se teď nepodařilo načíst. Zkus obnovit — nic se neztratilo.</p>
            <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
              <RefreshCw className={cn(refreshing && "animate-spin")} /> Obnovit
            </Button>
          </div>
        )}

        {data && <HandoffBanner stage={job.stage} ops={sorted} finalDate={handoff?.finalDate ?? null} today={today} onOpen={setDialog} />}

        {data && sorted.length > 0 && <ProductionSummary ops={sorted} />}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem] xl:items-start">
          <div className="min-w-0">
            {data && (sorted.length > 0 ? (
              <section aria-label="Průběh výroby" className="rounded-2xl border bg-muted/30 p-3 sm:p-4" data-testid="production-route">
                <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">
                    Průběh výroby <span className="font-normal text-muted-foreground">· {sorted.length} {sorted.length === 1 ? "operace" : sorted.length < 5 ? "operace" : "operací"}</span>
                  </h3>
                  <div className="flex items-center gap-1.5">
                    <TemplateMenu onPick={(key) => setDialog({ type: "template", key })} />
                    <Button type="button" size="sm" variant="outline" onClick={() => setDialog({ type: "add" })}>
                      <Plus className="text-yellow-600" /> Operace
                    </Button>
                    {job.stage === "ve_vyrobe" && <RouteMenu onOpen={setDialog} />}
                  </div>
                </header>
                <OperationTimeline ops={sorted} />
                <EndStation ops={sorted} finalDate={handoff?.finalDate ?? null} today={today} />
                <button
                  type="button"
                  onClick={() => setDialog({ type: "add" })}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-muted-foreground/25 py-3 text-sm font-medium text-muted-foreground transition hover:border-yellow-500/60 hover:bg-yellow-50/50 hover:text-foreground dark:hover:bg-yellow-500/5"
                >
                  <Plus className="h-4 w-4" /> Přidat další operaci
                </button>
              </section>
            ) : job.stage === "ve_vyrobe" ? null : (
              // ve výrobě bez postupu (přesun bez předání) je jediná výzva banner „Doplnit kdo a termín…" nahoře
              <ProductionEmpty stage={job.stage} />
            ))}
            {/* technologie po položkách (postup / kompletně zadáno / poznámky pro dodavatele → objednávka) */}
            <div className="mt-4">
              <TechnologySection jobId={job.id} items={job.items} ops={sorted} onSaved={refresh} />
            </div>
          </div>

          <div className="min-w-0 space-y-4">
            <CustomerNoteCard jobId={job.id} note={note} />
            <DeliveryCard job={job} />
            {data?.closing && (
              <ClosingCard
                job={job}
                closing={data.closing}
                margins={perms.margins}
                payments={flow?.payments}
                stamps={flow?.stamps ?? null}
              />
            )}
          </div>
        </div>
      </div>

      {dialog?.type === "add" && (
        <OperationDialog
          mode="add"
          at={dialog.at}
          initialKind={dialog.kind}
          afterLabel={dialog.at !== undefined && dialog.at > 0 ? sorted[dialog.at - 1]?.label ?? null : null}
          onClose={close}
        />
      )}
      {dialog?.type === "edit" && <OperationDialog key={dialog.op.id} mode="edit" op={dialog.op} onClose={close} />}
      {dialog?.type === "note" && <NoteDialog op={dialog.op} mode={dialog.mode} onClose={close} />}
      {dialog?.type === "template" && <TemplateDialog templateKey={dialog.key} onClose={close} />}
      {dialog?.type === "complete" && <CompleteDeliveryDialog onClose={close} />}
      {dialog?.type === "handoff" && (
        <ProductionHandoffDialog
          open
          onOpenChange={(o) => { if (!o) close(); }}
          jobId={job.id}
          kind={dialog.kind}
          operationId={dialog.operationId}
          existingPurchaseOrderId={dialog.existingPurchaseOrderId}
          target={dialog.target ?? null}
          replan={dialog.replan}
          onDone={(d) => {
            notify("success", d.message);
            refresh();
          }}
        />
      )}
      {dialog?.type === "delete" && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && close()}
          icon={Trash2}
          tone="bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400"
          title={`Smazat operaci ${dialog.op.label}?`}
          confirmLabel="Ano, smazat"
          confirmVariant="destructive"
          onConfirm={async () => {
            const op = dialog.op;
            const res = await deleteJobOperation(op.id);
            if (!res.ok) return res.error ?? "Operaci se nepodařilo smazat.";
            setOps((list) => list.filter((o) => o.id !== op.id));
            notify("success", `Operace ${op.label} smazána.`);
            refresh();
            return null;
          }}
        >
          Operace zmizí z postupu (v historii zakázky zůstane záznam). Když se jen nedělá, raději ji označ jako <em>přeskočenou</em>.
        </ConfirmDialog>
      )}
    </ProductionProvider>
  );
}

/** Menu postupu ve výrobě: posun, ukončení, přeplánování, vrácení předání. */
function RouteMenu({ onOpen }: { onOpen: (d: Exclude<DialogState, null>) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="sm" variant="ghost" className="gap-1" aria-label="Výroba — další akce">
          <Factory className="text-rose-600" /> Výroba <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem onSelect={() => onOpen({ type: "handoff", kind: "dalsi_krok" })}><ArrowRightCircle /> Posunout dál…</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onOpen({ type: "handoff", kind: "ukonceni" })}><Flag /> Ukončit výrobu…</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onOpen({ type: "handoff", kind: "plan", replan: true })}><Clock /> Přeplánovat výrobu…</DropdownMenuItem>
        {/* cíl = stav před předáním (dialog ho má z předání / historie) — ne vždy Potvrzená */}
        <DropdownMenuItem onSelect={() => onOpen({ type: "handoff", kind: "zpet" })} className="text-red-600 focus:text-red-700 dark:text-red-400">
          <Undo2 className="!text-current" /> Vrátit předání do výroby
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Připojit další kroky ze šablony (i k existujícímu postupu). */
function TemplateMenu({ onPick }: { onPick: (key: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="sm" variant="ghost" className="gap-1">
          <Workflow className="text-yellow-600" /> Šablona <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Připojit na konec postupu</DropdownMenuLabel>
        {OPERATION_TEMPLATES.map((t) => (
          <DropdownMenuItem key={t.key} onSelect={() => onPick(t.key)} className="flex-col items-start gap-1">
            <span className="text-sm font-medium">{t.label}</span>
            <span className="flex flex-wrap gap-1">
              {t.kinds.map((k, i) => (
                <span key={`${k}-${i}`} className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-medium", OPERATION_KINDS[k].badge)}>
                  {OPERATION_KINDS[k].short}
                </span>
              ))}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
