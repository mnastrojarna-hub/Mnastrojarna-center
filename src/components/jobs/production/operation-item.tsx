"use client";

import * as React from "react";
import {
  AlertTriangle, ArrowDown, ArrowRightCircle, ArrowUp, Check, CheckCheck, CircleCheck, Clock, FileText, Loader2, MoreHorizontal, Pencil,
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
  PLANNED_TONE, STATUS_STAMP, dayLabel, isBeforeProduction, lastNoteLine, operationStatusStamp, operationVisuals, plannedState, poChipOf, primaryAction,
  stampLabel, stepAction, stepCounterOf, whoOfOperation, type ChangedByFields, type OperationVisual,
} from "./production-helpers";
import { useOperationActions } from "./use-operation-actions";
import { WhoIcon } from "./who-picker";
import { DeadlineChip } from "./handoff/deadline-chip";
import { performerRole } from "@/lib/jobs/production-handoff";
import { stepLabel } from "@/lib/jobs/production";
import { ensureHandoffDocuments, reissueStepPurchaseOrder, sendStepPurchaseOrder } from "@/app/actions/production-handoff";
import { useRunner } from "./production-context";

const PO_TONE: Record<"amber" | "green" | "grey" | "red" | "lime", string> = {
  amber: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200",
  green: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
  grey: "bg-muted text-muted-foreground",
  red: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  lime: "bg-lime-50 text-lime-800 dark:bg-lime-500/10 dark:text-lime-300",
};

/** Objednávka kroku: stav + jedno tlačítko (Odeslat / vystavit znovu / vytvořit PDF) pro obchodníka / admina. */
function PoChip({ op, chip, canSend }: { op: JobOperation; chip: NonNullable<ReturnType<typeof poChipOf>>; canSend: boolean }) {
  const { run, isBusy } = useRunner();
  const key = `po:${op.id}`;
  const busy = isBusy(key);
  const po = op.purchaseOrder;
  const pdfMissing = canSend && po && !po.fileId && po.status !== "zrusena" && op.handoffId;
  return (
    <span className="inline-flex flex-wrap items-center gap-1" data-testid="step-po">
      <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium", PO_TONE[chip.tone])} title="Naše objednávka dodavateli">
        <FileText className="h-3 w-3 shrink-0" /> {chip.text}
      </span>
      {canSend && po?.fileId && (
        <a href={`/api/jobs/files/${po.fileId}`} target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-sky-700 hover:underline dark:text-sky-400">PDF</a>
      )}
      {canSend && chip.action === "send" && po && (
        <button type="button" disabled={busy} onClick={() => void run(key, () => sendStepPurchaseOrder(po.id), { success: `Objednávka ${po.number ?? ""} odeslána dodavateli.` })}
          className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Odeslat
        </button>
      )}
      {canSend && chip.action === "reissue" && (
        <button type="button" disabled={busy} onClick={() => void run(key, () => reissueStepPurchaseOrder(op.id), { success: (r) => `Vystavena nová objednávka ${(r as { number?: string }).number ?? ""}.` })}
          className="inline-flex h-7 items-center rounded-md border px-2 text-[11px] font-semibold hover:bg-accent disabled:opacity-60">
          Vystavit znovu
        </button>
      )}
      {pdfMissing && (
        <button type="button" disabled={busy} onClick={() => void run(key, () => ensureHandoffDocuments(op.jobId, op.handoffId as string), { success: "PDF objednávky vytvořeno." })}
          className="inline-flex h-7 items-center rounded-md border px-2 text-[11px] font-semibold hover:bg-accent disabled:opacity-60">
          PDF chybí — vytvořit
        </button>
      )}
    </span>
  );
}

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
  const { today, open, events, ops, stage, finalDate, items, permissions } = useProduction();
  const { advance, advancing, busy } = useOperationActions(op);
  const action = stage ? stepAction(op, ops, stage) : (() => { const p = primaryAction(op.status); return p ? { mode: "advance" as const, ...p } : null; })();
  const counter = stepCounterOf(op, ops);
  const title = stepLabel(op, ops);
  const role = performerRole(op, ops);
  const po = poChipOf(op, today);
  const scoped = op.orderItemIds && items && items.length ? items.filter((i) => op.orderItemIds!.includes(i.id)) : null;
  const deadlineStamp = op.deadlineChangedBy && op.deadlineChangedAt ? stampLabel("termín", { name: op.deadlineChangedBy.name, at: op.deadlineChangedAt }, today) : null;
  const stamp = operationStatusStamp(events, op as JobOperation & ChangedByFields);
  const by = stamp
    ? stampLabel(
        stamp.auto ? "Navázalo samo · spustil" : op.status === "ceka" && !op.startedAt ? "Naplánoval" : STATUS_STAMP[op.status],
        stamp,
        today,
      )
    : op.createdBy
      ? `Přidal ${op.createdBy.name}${dayLabel(op.createdAt, today) ? ` · ${dayLabel(op.createdAt, today)}` : ""}`
      : null;
  const m = OPERATION_KINDS[op.kind];
  const st = OPERATION_STATUSES[op.status];
  const StIcon = st.icon;
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
              <span className="text-[11px] font-bold tabular-nums text-muted-foreground">{counter ?? `${index + 1}.`}</span>
              <h4 className={cn("min-w-0 break-words text-[15px] font-semibold leading-tight", visual === "skipped" && "line-through")}>{title}</h4>
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
                  {role && role !== "u nás" && <span className="text-[11px] font-normal text-muted-foreground">({role})</span>}
                  {who.type === "free" && <span className="text-[11px] font-normal text-muted-foreground">mimo adresář</span>}
                </span>
              )}
              {po && <PoChip op={op} chip={po} canSend={Boolean(permissions?.canSend)} />}
            </div>
            {scoped && scoped.length < (items?.length ?? 0) && (
              <p className="mt-1 text-[11.5px] text-muted-foreground">
                Díly: {scoped.length} ze {items!.length} ({scoped.map((i) => i.drawingNumber || i.name || "díl").join(", ")})
              </p>
            )}
          </div>
          <OperationMenu op={op} index={index} count={count} />
        </div>

        {op.plannedEnd && op.status !== "hotovo" && op.status !== "preskoceno" && (
          <div className="mt-2" data-testid="step-deadline">
            <DeadlineChip
              op={{
                plannedEnd: op.plannedEnd, endsAtCustomerDate: op.endsAtCustomerDate, deadlineState: op.deadlineState ?? null,
                deadlineSource: op.deadlineSource ?? null, inHouse: op.inHouse, location: op.location, status: op.status,
                deadlineChangedBy: op.deadlineChangedBy ?? null, deadlineChangedAt: op.deadlineChangedAt ?? null,
                purchaseOrder: op.purchaseOrder ? { number: op.purchaseOrder.number, status: op.purchaseOrder.status, confirmedDate: op.purchaseOrder.confirmedDate } : null,
              }}
              finalDate={finalDate ?? null}
              today={today}
            />
            {deadlineStamp && <p className="mt-0.5 text-[10.5px] text-muted-foreground">{deadlineStamp}</p>}
          </div>
        )}
        {(from || started || finished || (planned && (op.status === "hotovo" || op.status === "preskoceno"))) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
            {planned && (op.status === "hotovo" || op.status === "preskoceno") && (
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

        {action && (
          <div className="mt-3 flex">
            <Button
              type="button"
              onClick={() => {
                if (action.mode === "handoff") open({ type: "handoff", kind: action.kind, operationId: action.operationId });
                else void advance();
              }}
              disabled={busy}
              data-testid={action.mode === "handoff" ? "step-handoff" : "step-advance"}
              className={cn(
                "h-11 w-full gap-2 text-base font-semibold shadow-sm sm:h-10 sm:w-auto sm:px-5 sm:text-sm",
                action.mode === "handoff"
                  ? "bg-rose-600 text-white hover:bg-rose-700"
                  : action.next === "probiha"
                    ? "bg-amber-500 text-white hover:bg-amber-600"
                    : "bg-success text-success-foreground hover:bg-success/90",
              )}
            >
              {advancing ? <Loader2 className="animate-spin" /> : action.mode === "handoff" ? <ArrowRightCircle /> : action.next === "probiha" ? <Play className="fill-current" /> : <Check strokeWidth={3} />}
              {action.label}
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

function OperationMenu({ op, index, count }: { op: JobOperation; index: number; count: number }) {
  const { open, canDeleteAll, userId, stage } = useProduction();
  const { setStatus, move, busy } = useOperationActions(op);
  const canDelete = canDeleteAll || (userId ? canDeleteOwnOperation({ created_by: op.createdBy?.id ?? null, created_at: op.createdAt }, userId) : false);
  const s = op.status;
  // před výrobou by krok „Probíhá / Hotovo / Problém" zakázku sám přesunul do výroby (bez kdo a termínu):
  // místo toho dialog předání (kdo + termín + objednávka) nebo zápis výroby (už hotovo)
  const pre = Boolean(stage && isBeforeProduction(stage));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="-mr-1 -mt-1 shrink-0" aria-label={`Další akce: ${op.label}`} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-5 w-5" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="truncate">{op.label}</DropdownMenuLabel>
        {s === "ceka" && pre && (
          <>
            <DropdownMenuItem onSelect={() => open({ type: "handoff", kind: "predani" })} data-testid="step-menu-handoff">
              <ArrowRightCircle className="!text-rose-600" /> Předat do výroby…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => open({ type: "handoff", kind: "zaznam", target: "dodano_k_nam" })} data-testid="step-menu-record">
              <CircleCheck className="!text-green-600" /> Už vyrobeno — zapsat výrobu…
            </DropdownMenuItem>
          </>
        )}
        {s === "ceka" && !pre && (
          <DropdownMenuItem onSelect={() => void setStatus("hotovo")}>
            <CircleCheck className="!text-green-600" /> Rovnou hotovo
          </DropdownMenuItem>
        )}
        {s === "problem" && !pre && (
          <DropdownMenuItem onSelect={() => void setStatus("probiha")}>
            <RotateCcw className="!text-amber-600" /> Problém vyřešen — pokračuje
          </DropdownMenuItem>
        )}
        {s === "hotovo" && !pre && (
          <DropdownMenuItem onSelect={() => void setStatus("probiha")}>
            <Undo2 /> Vrátit — ještě probíhá
          </DropdownMenuItem>
        )}
        {s !== "ceka" && (
          <DropdownMenuItem onSelect={() => void setStatus("ceka")}>
            <Clock /> Vrátit na Čeká
          </DropdownMenuItem>
        )}
        {(s === "probiha" || (s === "ceka" && !pre)) && (
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
