"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, GripVertical, Inbox, X } from "lucide-react";
import { StageCorrectionDialog, StageSelect } from "@/components/jobs/stage-select";
import { ActorStamp } from "@/components/flow-status/actor-stamp";
import { RowAction, RowStateChip } from "@/components/jobs/book/job-rows";
import { rowFlowView, type BookAccess } from "@/components/jobs/book/book-flow";
import {
  CustomerDocNumber, CustomerNoteMark, DeadlineBlock, JobCounters, JobValue, PaymentMark, PeopleStack, PriorityMark,
  ProductionLine, SourceMark, formatMoney,
} from "@/components/jobs/book/job-cells";
import { groupByStage, moveJobStage } from "@/components/jobs/book/book-params";
import { nextStage, stageMeta } from "@/lib/jobs/stages";
import { OPERATION_KINDS, isOperationKind } from "@/lib/jobs/operations";
import type { FlowActionKey } from "@/lib/jobs/flow-status";
import type { JobStage } from "@/lib/supabase/database.types";
import type { JobListItem } from "@/lib/jobs/types";
import { cn } from "@/lib/utils";

/**
 * Tabule (kanban): sloupec = stav. Tah karty do jiného sloupce (2.4): na další krok s dokladem
 * (Potvrzená objednávka, Dodáno, Faktura) otevře kartu zakázky rovnou s dialogem té akce,
 * jinak „Korekce stavu" s náhledem dopadu (u Nerealizováno / Zrušeno s povinným důvodem).
 * Na dotykových zařízeních a z klávesnice se stav mění výběrem na kartě nebo tlačítkem kroku.
 */

const COLUMN_LIMIT = 80;
const DRAG_TYPE = "application/x-zakazka";

/** Další krok, který se dělá dokladem → tah otevře dialog té akce. */
const STEP_ACTION: Partial<Record<JobStage, FlowActionKey>> = {
  potvrzeno: "order.confirm",
  dodano_zakaznikovi: "delivery.record",
  fakturovano: "payment.invoice",
};

/** Sloupec „Ve výrobě": karty pod mezititulky podle aktuálního kroku („Tepelné zpracování (3)"), řazené podle termínu kroku. */
export function productionGroups(jobs: JobListItem[]): { label: string | null; jobs: JobListItem[] }[] {
  const map = new Map<string, JobListItem[]>();
  for (const j of jobs) {
    const step = j.productionStep ?? null;
    const label = (j.productionStepTitle ?? "").trim()
      || (step === "hotovo" ? "Výroba hotová" : isOperationKind(step) ? OPERATION_KINDS[step].label : "Chybí kdo a termín");
    const list = map.get(label) ?? [];
    list.push(j);
    map.set(label, list);
  }
  const groups = [...map.entries()].map(([label, list]) => ({
    label,
    jobs: [...list].sort((a, b) => (a.productionDue ?? "9999").localeCompare(b.productionDue ?? "9999")),
  }));
  return groups.sort((a, b) => (a.jobs[0].productionDue ?? "9999").localeCompare(b.jobs[0].productionDue ?? "9999"));
}

export function JobBoard({
  jobs, stages, today, access,
}: { jobs: JobListItem[]; stages: JobStage[]; today: string; access?: BookAccess | null }) {
  const router = useRouter();
  const [local, setLocal] = React.useState(jobs);
  const [synced, setSynced] = React.useState(jobs);
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [overStage, setOverStage] = React.useState<JobStage | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pendingMove, setPendingMove] = React.useState<{ job: JobListItem; to: JobStage } | null>(null);

  // nová data ze serveru přepíšou optimistický stav
  if (jobs !== synced) {
    setSynced(jobs);
    setLocal(jobs);
  }

  React.useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(t);
  }, [error]);

  const columns = groupByStage(local, stages);

  function move(id: string, to: JobStage) {
    const job = local.find((j) => j.id === id);
    if (!job || job.stage === to) return;
    setError(null);
    const step = nextStage(job.stage) === to ? STEP_ACTION[to] : undefined;
    if (step) {
      router.push(`/orders/${job.id}?akce=${encodeURIComponent(step)}`);
      return;
    }
    setPendingMove({ job, to });
  }

  return (
    <div className="relative">
      <div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-3 scrollbar-thin md:snap-none">
        {columns.map((col) => {
          const m = stageMeta(col.stage);
          const Icon = m.icon;
          const over = overStage === col.stage && dragId !== null;
          const shown = col.jobs.slice(0, COLUMN_LIMIT);
          return (
            <section
              key={col.stage}
              aria-label={`${m.label} (${col.jobs.length})`}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (overStage !== col.stage) setOverStage(col.stage);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverStage((s) => (s === col.stage ? null : s));
              }}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData(DRAG_TYPE) || dragId;
                setOverStage(null);
                setDragId(null);
                if (id) void move(id, col.stage);
              }}
              className={cn(
                "flex w-[17rem] shrink-0 snap-start flex-col rounded-xl border bg-muted/40 transition-colors sm:w-72",
                over && "border-dashed ring-2",
                over && m.ring,
              )}
            >
              <header className="flex items-center gap-2 rounded-t-xl border-b bg-card px-3 py-2.5">
                <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full", m.badge)}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className={cn("truncate text-sm font-semibold", m.text)}>{m.label}</h3>
                  {col.value > 0 && <p className="text-[11px] text-muted-foreground tabular-nums">{formatMoney(col.value)}</p>}
                </div>
                <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold tabular-nums", m.solid)}>{col.jobs.length}</span>
              </header>
              <div className={cn("h-1 w-full", m.bar)} aria-hidden />

              <ul role="list" className="flex min-h-[8rem] flex-1 flex-col gap-2 p-2">
                {(col.stage === "ve_vyrobe" ? productionGroups(shown) : [{ label: null, jobs: shown }]).flatMap((g) => [
                  ...(g.label ? [(
                    <li key={`g:${g.label}`} className="px-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground" data-testid="board-step-group">
                      {g.label} ({g.jobs.length})
                    </li>
                  )] : []),
                  ...g.jobs.map((job) => (
                  <BoardCard
                    key={job.id}
                    job={job}
                    today={today}
                    dragging={dragId === job.id}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DRAG_TYPE, job.id);
                      e.dataTransfer.setData("text/plain", job.number);
                      e.dataTransfer.effectAllowed = "move";
                      setDragId(job.id);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverStage(null);
                    }}
                    onStageChanged={(s) => setLocal((cur) => moveJobStage(cur, job.id, s))}
                    access={access ?? null}
                  />
                  )),
                ])}
                {col.jobs.length > shown.length && (
                  <li className="px-2 py-1 text-center text-xs text-muted-foreground">
                    + {col.jobs.length - shown.length} dalších — zpřesni hledání
                  </li>
                )}
                {col.jobs.length === 0 && (
                  <li
                    className={cn(
                      "flex flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground",
                      over && "border-solid bg-card",
                    )}
                  >
                    <Inbox className="h-5 w-5 opacity-60" />
                    {dragId ? "Pusť kartu sem" : "Nic tu není"}
                  </li>
                )}
              </ul>
            </section>
          );
        })}
      </div>

      <StageCorrectionDialog
        open={pendingMove !== null}
        onOpenChange={(o) => !o && setPendingMove(null)}
        jobId={pendingMove?.job.id ?? ""}
        from={pendingMove?.job.stage ?? "poptavka"}
        to={pendingMove?.to ?? null}
        flow={pendingMove?.job.flow}
        quotes={pendingMove?.job.flowQuotes}
        title={pendingMove ? `${pendingMove.job.number}: ${stageMeta(pendingMove.job.stage).label} → ${stageMeta(pendingMove.to).label}` : undefined}
        onDone={(s) => {
          const id = pendingMove?.job.id;
          if (id) setLocal((cur) => moveJobStage(cur, id, s));
        }}
      />

      {error && (
        <div
          role="alert"
          className="fixed inset-x-4 bottom-20 z-50 mx-auto flex max-w-md items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800 shadow-lg dark:border-red-500/30 dark:bg-red-950 dark:text-red-200 md:bottom-6"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Zavřít" className="rounded p-0.5 hover:bg-red-100 dark:hover:bg-red-900">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function BoardCard({
  job,
  today,
  dragging,
  onDragStart,
  onDragEnd,
  onStageChanged,
  access,
}: {
  job: JobListItem;
  today: string;
  dragging: boolean;
  onDragStart: (e: React.DragEvent<HTMLLIElement>) => void;
  onDragEnd: () => void;
  onStageChanged: (s: JobStage) => void;
  access: BookAccess | null;
}) {
  const m = stageMeta(job.stage);
  const view = rowFlowView(job, access, today);
  return (
    <li
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "group relative cursor-grab overflow-hidden rounded-lg border bg-card p-2.5 pl-3.5 shadow-sm transition active:cursor-grabbing",
        "hover:border-foreground/15 hover:shadow-md focus-within:ring-2 focus-within:ring-ring/40",
        dragging && "rotate-1 opacity-50",
      )}
    >
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", m.bar)} />
      <div className="flex items-center gap-1.5">
        <Link
          href={`/orders/${job.id}`}
          draggable={false}
          aria-label={`Otevřít zakázku ${job.number}`}
          className="font-mono text-xs font-bold outline-none after:absolute after:inset-0 after:content-[''] group-hover:text-primary"
        >
          {job.number}
        </Link>
        <PriorityMark priority={job.priority} />
        <SourceMark source={job.source} aiFilled={job.aiFilled} />
        <CustomerNoteMark note={job.customerNote} />
        <GripVertical className="ml-auto h-3.5 w-3.5 text-muted-foreground/50" aria-hidden />
      </div>
      <p className="mt-1 truncate text-sm font-semibold">{job.customer?.name ?? <span className="italic text-muted-foreground">Bez zákazníka</span>}</p>
      <p className="truncate text-xs text-muted-foreground">{job.title || "Bez názvu"}</p>
      <CustomerDocNumber job={job} className="mt-1.5" />
      <RowStateChip job={job} view={view} shortFlag className="relative z-10 mt-1.5" />
      <ProductionLine job={job} compact today={today} className="mt-2" />
      <div className="mt-2 flex items-end justify-between gap-2">
        <DeadlineBlock job={job} today={today} compact />
        <div className="flex flex-col items-end gap-0.5">
          <JobValue job={job} className="text-xs" />
          <JobCounters job={job} />
          <PaymentMark job={job} today={today} />
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2">
        <div className="relative z-10 flex min-w-0 flex-col items-start gap-0.5">
          <StageSelect jobId={job.id} stage={job.stage} size="sm" onChanged={onStageChanged} flow={job.flow} quotes={job.flowQuotes} />
          <ActorStamp stamp={view.stamp} short className="max-w-[9.5rem]" />
        </div>
        <PeopleStack owner={job.owner} assignee={job.assignee} />
      </div>
      {view.next && view.next.key !== "proposal.decide" && (
        <div className="relative z-10 mt-2 flex justify-end">
          <RowAction job={job} view={view} />
        </div>
      )}
    </li>
  );
}
