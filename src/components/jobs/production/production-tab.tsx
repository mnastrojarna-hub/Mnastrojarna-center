"use client";

import * as React from "react";
import { AlertTriangle, ChevronDown, Plus, RefreshCw, Trash2, Workflow } from "lucide-react";
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
import type { JobFlowData } from "@/components/jobs/detail/job-detail-view";

export interface JobProductionData {
  operations: JobOperation[];
  summary: JobProductionSummary;
  closing: JobClosingInfo | null;
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

  const ctx = React.useMemo<ProductionCtxValue>(() => ({
    jobId: job.id, today, ops, setOps, suppliers: options.suppliers, events: job.events, canDeleteAll: perms.canDelete, userId,
    open: setDialog,
  }), [job.id, today, ops, options.suppliers, job.events, perms.canDelete, userId]);

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

        {data && sorted.length > 0 && <ProductionSummary ops={sorted} />}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem] xl:items-start">
          <div className="min-w-0">
            {data && (sorted.length > 0 ? (
              <section aria-label="Postup výroby" className="rounded-2xl border bg-muted/30 p-3 sm:p-4">
                <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">
                    Postup výroby <span className="font-normal text-muted-foreground">· {sorted.length} {sorted.length === 1 ? "operace" : sorted.length < 5 ? "operace" : "operací"}</span>
                  </h3>
                  <div className="flex items-center gap-1.5">
                    <TemplateMenu onPick={(key) => setDialog({ type: "template", key })} />
                    <Button type="button" size="sm" variant="outline" onClick={() => setDialog({ type: "add" })}>
                      <Plus className="text-yellow-600" /> Operace
                    </Button>
                  </div>
                </header>
                <OperationTimeline ops={sorted} />
                <button
                  type="button"
                  onClick={() => setDialog({ type: "add" })}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-muted-foreground/25 py-3 text-sm font-medium text-muted-foreground transition hover:border-yellow-500/60 hover:bg-yellow-50/50 hover:text-foreground dark:hover:bg-yellow-500/5"
                >
                  <Plus className="h-4 w-4" /> Přidat další operaci
                </button>
              </section>
            ) : (
              <ProductionEmpty />
            ))}
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
