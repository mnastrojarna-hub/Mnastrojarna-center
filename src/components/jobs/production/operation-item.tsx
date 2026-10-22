"use client";

import * as React from "react";
import {
  AlertTriangle, ArrowDown, ArrowUp, Check, CheckCheck, CircleCheck, Clock, FileText, Loader2, MoreHorizontal, Pencil,
  Play, Plus, RotateCcw, SkipForward, StickyNote, Trash2, Undo2, UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { OPERATION_KINDS, OPERATION_STATUSES } from "@/lib/jobs/operations";
import { canDeleteOwnOperation, sortOperations } from "@/lib/jobs/production";
import type { JobOperation } from "@/lib/jobs/production-types";
import { cn } from "@/lib/utils";
import { useProduction } from "./production-context";
import {
  PLANNED_TONE, STATUS_STAMP, dayLabel, lastNoteLine, operationStatusStamp, operationVisuals, plannedState, primaryAction,
  stampLabel, whoOfOperation, type ChangedByFields, type OperationVisual,
} from "./production-helpers";
import { useOperationActions } from "./use-operation-actions";
import { WhoIcon } from "./who-picker";

/**
 * Postup výroby jako linka metra: vlevo kolej s barevnými stanicemi (hotovo =
 * zelená fajfka, probíhá = pulzující oranžová, problém = červená), vpravo karta
 * operace s jedním velkým tlačítkem (Začít / Hotovo) a menu „⋯".
 */
export function OperationTimeline({ ops }: { ops: JobOperation[] }) {
  const sorted = sortOperations(ops);
  const visuals = operationVisuals(sorted);
  return (
    <ol aria-label="Postup výroby" className="relative">
      {sorted.map((op, i) => (
        <OperationItem key={op.id} op={op} index={i} count={sorted.length} visual={visuals.get(op.id) ?? "todo"} />
      ))}
    </ol>
  );
}

const VISUAL_LABEL: Partial<Record<OperationVisual, string>> = { next: "Na řadě" };

function Station({ op, visual }: { op: JobOperation; visual: OperationVisual }) {
  const m = OPERATION_KINDS[op.kind];
  const KindIcon = m.icon;
  const cls: Record<OperationVisual, string> = {
    done: "bg-green-500 text-white",
    running: "bg-amber-500 text-white",
    problem: "bg-red-600 text-white",
    next: m.solid,
    todo: m.badge,
    skipped: "bg-muted text-muted-foreground",
  };
  const Icon = visual === "done" ? Check : visual === "problem" ? AlertTriangle : visual === "skipped" ? SkipForward : KindIcon;
  return (
    <div className="relative mt-2 h-10 w-10 shrink-0">
      {visual === "running" && <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-amber-400/50" />}
      {visual === "problem" && <span aria-hidden className="absolute -inset-1 animate-pulse rounded-full bg-red-500/25" />}
      <span
        className={cn(
          "relative flex h-10 w-10 items-center justify-center rounded-full shadow-sm ring-4 ring-background",
          cls[visual],
          visual === "next" && "ring-offset-0 outline outline-2 outline-offset-2 outline-foreground/20",
        )}
        title={OPERATION_STATUSES[op.status].label}
      >
        <Icon className="h-[18px] w-[18px]" strokeWidth={visual === "done" ? 3 : 2} />
      </span>
    </div>
  );
}

function OperationItem({ op, index, count, visual }: { op: JobOperation; index: number; count: number; visual: OperationVisual }) {
  const { today, open, events } = useProduction();
  const { advance, advancing, busy } = useOperationActions(op);
  const stamp = operationStatusStamp(events, op as JobOperation & ChangedByFields);
  const by = stamp
    ? stampLabel(stamp.auto ? "Začato navázáním" : STATUS_STAMP[op.status], stamp, today)
    : op.createdBy
      ? `Přidal ${op.createdBy.name}${dayLabel(op.createdAt, today) ? ` · ${dayLabel(op.createdAt, today)}` : ""}`
      : null;
  const m = OPERATION_KINDS[op.kind];
  const st = OPERATION_STATUSES[op.status];
  const StIcon = st.icon;
  const pa = primaryAction(op.status);
  const planned = plannedState(op, today);
  const who = whoOfOperation(op);
  const note = lastNoteLine(op.note);
  const [noteOpen, setNoteOpen] = React.useState(false);
  const last = index === count - 1;
  const started = dayLabel(op.startedAt, today);
  const finished = dayLabel(op.finishedAt, today);
  const from = dayLabel(op.plannedStart, today);

  const line = visual === "done" ? "bg-green-500" : visual === "running" ? "bg-gradient-to-b from-amber-400 to-border" : "bg-border";
  const card: Record<OperationVisual, string> = {
    done: "",
    running: "border-amber-300 bg-amber-50/60 dark:border-amber-500/40 dark:bg-amber-500/[0.06]",
    problem: "border-red-300 bg-red-50/60 dark:border-red-500/40 dark:bg-red-500/[0.06]",
    next: "border-foreground/15 shadow-md",
    todo: "",
    skipped: "opacity-60",
  };

  return (
    <li className="relative flex gap-3 pb-3 last:pb-0 sm:gap-4" aria-current={visual === "running" || visual === "problem" ? "step" : undefined}>
      {!last && <span aria-hidden className={cn("absolute bottom-[-0.5rem] left-5 top-12 w-1 -translate-x-1/2 rounded-full", line)} />}
      <Station op={op} visual={visual} />

      <div className={cn("min-w-0 flex-1 rounded-xl border bg-card p-3 shadow-sm transition sm:p-3.5", card[visual])}>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-[11px] font-bold tabular-nums text-muted-foreground">{index + 1}.</span>
              <h4 className={cn("min-w-0 break-words text-[15px] font-semibold leading-tight", visual === "skipped" && "line-through")}>{op.label}</h4>
              {op.title && (
                <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] font-medium", m.badge)}>
                  <m.icon className="h-3 w-3" /> {m.short}
                </span>
              )}
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                  visual === "next" ? "bg-foreground text-background" : st.badge,
                )}
              >
                <StIcon className={cn("h-3 w-3", op.status === "probiha" && "animate-spin [animation-duration:2.5s]")} />
                {VISUAL_LABEL[visual] ?? st.label}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              {who.type === "none" ? (
                <button
                  type="button"
                  onClick={() => open({ type: "edit", op })}
                  className="inline-flex items-center gap-1 rounded-md border border-dashed border-muted-foreground/40 px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
                >
                  <Plus className="h-3 w-3" /> Kdo to dělá?
                </button>
              ) : (
                <span className="inline-flex min-w-0 items-center gap-1.5 font-medium">
                  <WhoIcon who={who} className="h-4 w-4 shrink-0" />
                  <span className="truncate">{op.location}</span>
                  {who.type === "free" && <span className="text-[11px] font-normal text-muted-foreground">mimo adresář</span>}
                </span>
              )}
              {op.purchaseOrderNumber && (
                <span className="inline-flex items-center gap-1 rounded bg-lime-50 px-1.5 py-0.5 font-mono text-[11px] text-lime-800 dark:bg-lime-500/10 dark:text-lime-300" title="Naše objednávka dodavateli">
                  <FileText className="h-3 w-3" /> {op.purchaseOrderNumber}
                </span>
              )}
            </div>
          </div>
          <OperationMenu op={op} index={index} count={count} />
        </div>

        {(planned || from || started || finished) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
            {planned && (
              <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold", PLANNED_TONE[planned.tone])}>
                <Clock className="h-3 w-3" /> {planned.text}
              </span>
            )}
            {from && !started && <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">od {from}</span>}
            {started && <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">začato {started}</span>}
            {finished && op.status === "hotovo" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-800 dark:bg-green-500/15 dark:text-green-300">
                <CheckCheck className="h-3 w-3" /> hotovo {finished}
              </span>
            )}
          </div>
        )}

        {note && (
          <button
            type="button"
            onClick={() => setNoteOpen((v) => !v)}
            aria-expanded={noteOpen}
            className={cn(
              "mt-2 flex w-full items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-xs leading-relaxed transition",
              op.status === "problem"
                ? "bg-red-100/80 text-red-800 hover:bg-red-100 dark:bg-red-500/15 dark:text-red-200"
                : "bg-muted/60 text-muted-foreground hover:bg-muted",
            )}
            title={noteOpen ? "Sbalit poznámku" : "Celá poznámka"}
          >
            {op.status === "problem" ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />}
            <span className={cn("min-w-0 flex-1 break-words", noteOpen ? "whitespace-pre-wrap" : "line-clamp-2")}>
              {noteOpen ? op.note : note}
            </span>
          </button>
        )}

        {by && (
          <p className="mt-2 flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground" title="Kdo operaci naposledy změnil">
            <UserRound className="h-3 w-3 shrink-0" />
            <span className="truncate">{by}</span>
          </p>
        )}

        {pa && (
          <div className="mt-3 flex">
            <Button
              type="button"
              onClick={() => void advance()}
              disabled={busy}
              className={cn(
                "h-11 w-full gap-2 text-base font-semibold shadow-sm sm:h-10 sm:w-auto sm:px-5 sm:text-sm",
                pa.next === "probiha"
                  ? "bg-amber-500 text-white hover:bg-amber-600"
                  : "bg-success text-success-foreground hover:bg-success/90",
              )}
            >
              {advancing ? <Loader2 className="animate-spin" /> : pa.next === "probiha" ? <Play className="fill-current" /> : <Check strokeWidth={3} />}
              {pa.label}
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

function OperationMenu({ op, index, count }: { op: JobOperation; index: number; count: number }) {
  const { open, canDeleteAll, userId } = useProduction();
  const { setStatus, move, busy } = useOperationActions(op);
  const canDelete = canDeleteAll || (userId ? canDeleteOwnOperation({ created_by: op.createdBy?.id ?? null, created_at: op.createdAt }, userId) : false);
  const s = op.status;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="-mr-1 -mt-1 shrink-0" aria-label={`Další akce: ${op.label}`} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-5 w-5" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="truncate">{op.label}</DropdownMenuLabel>
        {s === "ceka" && (
          <DropdownMenuItem onSelect={() => void setStatus("hotovo")}>
            <CircleCheck className="!text-green-600" /> Rovnou hotovo
          </DropdownMenuItem>
        )}
        {s === "problem" && (
          <DropdownMenuItem onSelect={() => void setStatus("probiha")}>
            <RotateCcw className="!text-amber-600" /> Problém vyřešen — pokračuje
          </DropdownMenuItem>
        )}
        {s === "hotovo" && (
          <DropdownMenuItem onSelect={() => void setStatus("probiha")}>
            <Undo2 /> Vrátit — ještě probíhá
          </DropdownMenuItem>
        )}
        {s !== "ceka" && (
          <DropdownMenuItem onSelect={() => void setStatus("ceka")}>
            <Clock /> Vrátit na Čeká
          </DropdownMenuItem>
        )}
        {(s === "ceka" || s === "probiha") && (
          <DropdownMenuItem onSelect={() => open({ type: "note", op, mode: "problem" })} className="text-red-600 focus:text-red-700 dark:text-red-400">
            <AlertTriangle className="!text-current" /> Nahlásit problém…
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => open({ type: "note", op, mode: "note" })}>
          <StickyNote className="!text-amber-500" /> Připsat poznámku…
        </DropdownMenuItem>
        {s !== "preskoceno" && s !== "hotovo" && (
          <DropdownMenuItem onSelect={() => void setStatus("preskoceno")}>
            <SkipForward /> Přeskočit
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => open({ type: "edit", op })}>
          <Pencil /> Upravit…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => open({ type: "add", at: index + 1 })}>
          <Plus /> Vložit operaci za
        </DropdownMenuItem>
        {index > 0 && (
          <DropdownMenuItem onSelect={() => void move("up")}>
            <ArrowUp /> Posunout dřív
          </DropdownMenuItem>
        )}
        {index < count - 1 && (
          <DropdownMenuItem onSelect={() => void move("down")}>
            <ArrowDown /> Posunout později
          </DropdownMenuItem>
        )}
        {canDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => open({ type: "delete", op })} className="text-red-600 focus:text-red-700 dark:text-red-400">
              <Trash2 className="!text-current" /> Smazat operaci
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
