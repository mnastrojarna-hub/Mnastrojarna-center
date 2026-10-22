"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, GripVertical, Inbox, X } from "lucide-react";
import { StageSelect } from "@/components/jobs/stage-select";
import {
  CustomerDocNumber, DeadlineBlock, JobCounters, JobValue, PeopleStack, PriorityMark, SourceMark, formatMoney,
} from "@/components/jobs/book/job-cells";
import { groupByStage, moveJobStage } from "@/components/jobs/book/book-params";
import { setJobStage } from "@/app/actions/jobs";
import { stageMeta } from "@/lib/jobs/stages";
import type { JobStage } from "@/lib/supabase/database.types";
import type { JobListItem } from "@/lib/jobs/types";
import { cn } from "@/lib/utils";

/**
 * Tabule (kanban): sloupec = stav. Kartu stačí přetáhnout do jiného sloupce
 * (změna se ukáže hned, při chybě se vrátí a ukáže důvod). Na dotykových
 * zařízeních a z klávesnice se stav mění výběrem na kartě.
 */

const COLUMN_LIMIT = 80;
const DRAG_TYPE = "application/x-zakazka";

export function JobBoard({ jobs, stages, today }: { jobs: JobListItem[]; stages: JobStage[]; today: string }) {
  const router = useRouter();
  const [local, setLocal] = React.useState(jobs);
  const [synced, setSynced] = React.useState(jobs);
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [overStage, setOverStage] = React.useState<JobStage | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [, startTransition] = React.useTransition();

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

  async function move(id: string, to: JobStage) {
    const job = local.find((j) => j.id === id);
    if (!job || job.stage === to) return;
    const from = job.stage;
    setLocal((cur) => moveJobStage(cur, id, to));
    setError(null);
    try {
      const res = await setJobStage(id, to);
      if (!res.ok) {
        setLocal((cur) => moveJobStage(cur, id, from));
        setError(`${job.number}: ${res.error ?? "stav se nepodařilo změnit."}`);
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setLocal((cur) => moveJobStage(cur, id, from));
      setError(`${job.number}: stav se nepodařilo změnit — zkus to znovu.`);
    }
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
                {shown.map((job) => (
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
                  />
                ))}
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
}: {
  job: JobListItem;
  today: string;
  dragging: boolean;
  onDragStart: (e: React.DragEvent<HTMLLIElement>) => void;
  onDragEnd: () => void;
  onStageChanged: (s: JobStage) => void;
}) {
  const m = stageMeta(job.stage);
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
        <GripVertical className="ml-auto h-3.5 w-3.5 text-muted-foreground/50" aria-hidden />
      </div>
      <p className="mt-1 truncate text-sm font-semibold">{job.customer?.name ?? <span className="italic text-muted-foreground">Bez zákazníka</span>}</p>
      <p className="truncate text-xs text-muted-foreground">{job.title || "Bez názvu"}</p>
      <CustomerDocNumber job={job} className="mt-1.5" />
      <div className="mt-2 flex items-end justify-between gap-2">
        <DeadlineBlock job={job} today={today} compact />
        <div className="flex flex-col items-end gap-0.5">
          <JobValue job={job} className="text-xs" />
          <JobCounters job={job} />
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2">
        <div className="relative z-10">
          <StageSelect jobId={job.id} stage={job.stage} size="sm" onChanged={onStageChanged} />
        </div>
        <PeopleStack owner={job.owner} assignee={job.assignee} />
      </div>
    </li>
  );
}
