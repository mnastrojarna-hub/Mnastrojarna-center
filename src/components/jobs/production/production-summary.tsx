"use client";

import * as React from "react";
import { AlertTriangle, ArrowRight, Check, CircleCheckBig, Clock, Loader2, Play, Truck } from "lucide-react";
import { useFlowActions } from "@/components/jobs/detail/flow-actions";
import { Button } from "@/components/ui/button";
import { OPERATION_KINDS } from "@/lib/jobs/operations";
import { operationDisplayName, stepLabel, summarizeOperations } from "@/lib/jobs/production";
import { DeadlineChip } from "./handoff/deadline-chip";
import type { JobOperation } from "@/lib/jobs/production-types";
import { cn } from "@/lib/utils";
import { useProduction } from "./production-context";
import {
  currentOperation, dayLabel, lastNoteLine, operationStatusStamp, overdueOperations, plannedState, primaryAction,
  problemOperations, progressSegments, stepAction, stepCounterOf, upcomingOperation, type ChangedByFields, type ProgressSegment,
} from "./production-helpers";
import { useOperationActions } from "./use-operation-actions";

/** Velký pruh průběhu: úsek = operace v barvě druhu (hotovo zeleně, problém červeně). */
export function ProgressBar({ segments, labels = true }: { segments: ProgressSegment[]; labels?: boolean }) {
  if (!segments.length) return null;
  return (
    <div>
      <div className="flex h-3.5 gap-1" role="img" aria-label={`Hotovo ${segments.filter((s) => s.state === "done").length} z ${segments.length} operací`}>
        {segments.map((s) => {
          const m = OPERATION_KINDS[s.kind];
          return (
            <span
              key={s.id}
              title={`${s.label}${s.location !== "—" ? ` · ${s.location}` : ""}`}
              className={cn(
                "relative h-full min-w-[6px] flex-1 overflow-hidden rounded-full",
                s.state === "done" && m.dot,
                s.state === "problem" && "bg-red-500",
                s.state === "running" && "bg-amber-200 dark:bg-amber-500/30",
                s.state === "next" && "bg-muted-foreground/25 ring-2 ring-inset ring-foreground/30",
                s.state === "todo" && "bg-muted-foreground/15",
              )}
            >
              {s.state === "running" && <span className={cn("absolute inset-y-0 left-0 w-1/2 animate-pulse rounded-full", m.dot)} />}
              {s.state === "done" && <Check className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 text-white" strokeWidth={4} />}
            </span>
          );
        })}
      </div>
      {labels && segments.length <= 8 && (
        <div className="mt-1.5 hidden gap-1 sm:flex">
          {segments.map((s) => (
            <span
              key={s.id}
              className={cn(
                "min-w-0 flex-1 truncate text-center text-[10.5px]",
                s.state === "done" ? "text-muted-foreground" : s.state === "todo" ? "text-muted-foreground/70" : "font-semibold text-foreground",
                s.state === "problem" && "text-red-600 dark:text-red-400",
              )}
            >
              {OPERATION_KINDS[s.kind].short}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function CurrentAction({ op, label }: { op: JobOperation; label: string }) {
  const { ops, stage, open } = useProduction();
  const { advance, advancing, busy } = useOperationActions(op);
  const pa = primaryAction(op.status);
  const action = stage ? stepAction(op, ops, stage) : pa ? { mode: "advance" as const, ...pa } : null;
  if (!action) return null;
  if (action.mode === "handoff") {
    return (
      <Button
        type="button"
        onClick={() => open({ type: "handoff", kind: action.kind, operationId: action.operationId })}
        className="h-12 w-full gap-2 bg-rose-600 text-base font-semibold text-white shadow-md hover:bg-rose-700 sm:h-11 sm:w-auto sm:px-6"
        data-testid="summary-handoff"
      >
        <ArrowRight /> {action.label}
      </Button>
    );
  }
  return (
    <Button
      type="button"
      onClick={() => void advance()}
      disabled={busy}
      className={cn(
        "h-12 w-full gap-2 text-base font-semibold shadow-md sm:h-11 sm:w-auto sm:px-6",
        action.next === "probiha" ? "bg-amber-500 text-white hover:bg-amber-600" : "bg-success text-success-foreground hover:bg-success/90",
      )}
    >
      {advancing ? <Loader2 className="animate-spin" /> : action.next === "probiha" ? <Play className="fill-current" /> : <Check strokeWidth={3} />}
      {action.next === "probiha" ? `Začít: ${label}` : `Hotovo: ${label}`}
    </Button>
  );
}

/**
 * Dodání během výroby (dílčí dodávka, výroba končí u dodavatele): jediné tlačítko „Zapsat dodání a dodací
 * list" je v kartě „Dodání zákazníkovi" (a v ⋯) — souhrn nahoře na něj jen odkáže (na mobilu je karta níž).
 */
export function summaryOffersDelivery(flow: ReturnType<typeof useFlowActions>): boolean {
  const f = flow?.facts;
  if (!flow || !f || !flow.ctx.can("workflow") || f.itemsCount <= 0) return false;
  const delivery = flow.snapshot?.delivery ?? null;
  if (flow.next?.key === "delivery.record" || delivery === "dodano" || delivery === "dl_potvrzen") return false;
  const total = f.productionTotal ?? 0;
  return total > 0 && (f.productionDone ?? 0) < total && f.productionStep !== "hotovo";
}

function DeliveryShortcut() {
  const flow = useFlowActions();
  if (!flow || !summaryOffersDelivery(flow)) return null;
  return (
    <a
      href="#dodani-zakaznikovi"
      onClick={(e) => {
        const card = document.getElementById("dodani-zakaznikovi");
        if (!card) return;
        e.preventDefault();
        card.scrollIntoView({ behavior: "smooth", block: "start" });
      }}
      className="inline-flex min-h-9 items-center gap-1.5 text-xs font-medium text-green-700 hover:underline dark:text-green-400"
      data-testid="summary-delivery"
    >
      <Truck className="h-3.5 w-3.5" /> Hotové kusy dodáš i během výroby — Dodání zákazníkovi ↓
    </a>
  );
}

/**
 * Souhrn nahoře: kde se zakázka právě nachází, kolik je hotovo, velký pruh
 * průběhu, hlavní tlačítko pro aktuální operaci, problémy a zpoždění.
 */
export function ProductionSummary({ ops }: { ops: JobOperation[] }) {
  const { today, events, finalDate } = useProduction();
  const summary = summarizeOperations(ops);
  const segments = progressSegments(ops);
  const current = currentOperation(ops);
  const upcoming = upcomingOperation(ops);
  const problems = problemOperations(ops);
  const late = overdueOperations(ops, today).filter((o) => o.status !== "problem");
  const finished = summary.step === "hotovo";
  const meta = current ? OPERATION_KINDS[current.kind] : null;
  const Icon = meta?.icon ?? CircleCheckBig;
  const running = current && (current.status === "probiha" || current.status === "problem");
  const planned = current ? plannedState(current, today) : null;
  const since = current ? dayLabel(current.startedAt, today) : null;
  const stamp = current && running ? operationStatusStamp(events, current as JobOperation & ChangedByFields) : null;

  return (
    <section
      aria-label="Kde je zakázka"
      className={cn(
        "overflow-hidden rounded-2xl border bg-card shadow-sm",
        finished && "border-green-300 dark:border-green-500/40",
        summary.problem && "border-red-300 dark:border-red-500/40",
      )}
    >
      <div className={cn("h-1.5 w-full", finished ? "bg-green-500" : summary.problem ? "bg-red-500" : meta?.dot ?? "bg-yellow-500")} />
      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl shadow-sm sm:h-14 sm:w-14",
              finished ? "bg-green-500 text-white" : current?.status === "problem" ? "bg-red-600 text-white" : meta?.solid ?? "bg-muted",
            )}
          >
            {running && current?.status === "probiha" && <span aria-hidden className="absolute -right-1 -top-1 h-3.5 w-3.5 animate-pulse rounded-full bg-amber-400 ring-2 ring-card" />}
            {current?.status === "problem" ? <AlertTriangle className="h-6 w-6" /> : <Icon className="h-6 w-6 sm:h-7 sm:w-7" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {finished ? "Výroba" : running ? "Teď" : "Na řadě"}
            </p>
            {finished ? (
              <p className="text-lg font-bold leading-tight text-green-700 dark:text-green-400 sm:text-xl">Výroba hotová ✓</p>
            ) : current ? (
              <p className="break-words text-lg font-bold leading-tight sm:text-xl" data-testid="production-now">
                {stepCounterOf(current, ops) && <span className="font-semibold text-muted-foreground">{stepCounterOf(current, ops)} · </span>}
                {stepLabel(current, ops)}
                {current.location !== "—" && <span className="font-semibold text-muted-foreground"> · {current.location}</span>}
              </p>
            ) : (
              <p className="text-lg font-bold">Bez postupu</p>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              {finished && <span>Všechny operace jsou hotové — dodej zákazníkovi: „Zapsat dodání a dodací list“, pak faktura.</span>}
              {!finished && current?.status === "ceka" && <span>čeká na začátek</span>}
              {!finished && running && (since || stamp) && (
                <span>
                  {[
                    since ? `${current?.status === "problem" ? "běží od" : "probíhá od"} ${since}` : null,
                    stamp ? `${current?.status === "problem" ? "problém" : "začátek"}: ${stamp.name}${stamp.auto ? " (navázalo samo)" : ""}` : null,
                  ].filter(Boolean).join(" · ")}
                </span>
              )}
              {!finished && current?.plannedEnd ? (
                <DeadlineChip
                  compact
                  op={{
                    plannedEnd: current.plannedEnd, endsAtCustomerDate: current.endsAtCustomerDate, deadlineState: current.deadlineState ?? null,
                    deadlineSource: current.deadlineSource ?? null, inHouse: current.inHouse, location: current.location, status: current.status,
                    purchaseOrder: current.purchaseOrder ? { number: current.purchaseOrder.number, status: current.purchaseOrder.status, confirmedDate: current.purchaseOrder.confirmedDate } : null,
                  }}
                  finalDate={finalDate ?? null}
                  today={today}
                />
              ) : !finished && planned && (
                <span className={cn("inline-flex items-center gap-1 font-medium", planned.tone === "overdue" && "text-red-600 dark:text-red-400", (planned.tone === "today" || planned.tone === "soon") && "text-amber-700 dark:text-amber-400")}>
                  <Clock className="h-3 w-3" /> {planned.text}
                </span>
              )}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-2xl font-bold leading-none tabular-nums sm:text-3xl">
              {summary.done}
              <span className="text-base font-semibold text-muted-foreground sm:text-lg">/{summary.total}</span>
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">hotovo · {summary.percent} %</p>
          </div>
        </div>

        <ProgressBar segments={segments} />

        {problems.map((p) => (
          <div key={p.id} role="alert" className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0">
              <p className="font-semibold">Problém: {operationDisplayName(p)}</p>
              {lastNoteLine(p.note) && <p className="mt-0.5 break-words text-xs opacity-90">{lastNoteLine(p.note, 300)}</p>}
            </div>
          </div>
        ))}

        {late.length > 0 && (
          <div className="flex items-start gap-2.5 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2.5 text-sm text-orange-900 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-200">
            <Clock className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0">
              <p className="font-semibold">Po termínu {late.length === 1 ? "je 1 operace" : `jsou ${late.length} ${late.length < 5 ? "operace" : "operací"}`}</p>
              <ul className="mt-0.5 space-y-0.5 text-xs">
                {late.slice(0, 4).map((o) => (
                  <li key={o.id} className="break-words">{operationDisplayName(o)} — {plannedState(o, today)?.text}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {!finished && current && (
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <CurrentAction op={current} label={stepLabel(current, ops)} />
              <DeliveryShortcut />
            </div>
            {upcoming && upcoming.id !== current.id && (
              <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                <ArrowRight className="h-3.5 w-3.5 shrink-0" /> Pak:
                <span className={cn("truncate font-medium", OPERATION_KINDS[upcoming.kind].text)}>{operationDisplayName(upcoming)}</span>
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
