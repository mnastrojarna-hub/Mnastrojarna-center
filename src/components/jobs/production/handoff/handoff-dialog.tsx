"use client";

import * as React from "react";
import { AlertTriangle, ArrowRightCircle, Factory, Flag, Loader2, Plus, RefreshCw, Undo2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { prepareProductionHandoff, submitProductionHandoff } from "@/app/actions/production-handoff";
import { moveJobStage } from "@/app/actions/flow-status";
import { OPERATION_KINDS, type OperationKind } from "@/lib/jobs/operations";
import { shortDay } from "@/lib/jobs/production-suggest";
import { stageMeta, stageRank } from "@/lib/jobs/stages";
import type { HandoffErrorCode, HandoffIssue, HandoffKind, HandoffPlan, HandoffResult } from "@/lib/jobs/production-handoff-types";
import type { JobStage } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";
import { KindGrid } from "../operation-dialog";
import {
  addStep, autoSendsAll, busyLabel, canSubmit, doneToast, firstOrderEmail, inputFromState, issuesOf, itemNotePatches, newOrderCount, plainMoveOf,
  quickKinds, removeStep, stateFromPlan, stepLabels, submitLabel, summaryLine, titleOf, type HandoffState,
} from "./handoff-model";
import { saveItemTechnology } from "@/app/actions/technology";
import { HandoffStepCard } from "./handoff-step-card";
import { AiLabel, SuggestionBanner } from "./handoff-suggestions";
import { AdvanceOptions, FinishOptions, ReceiptBlock } from "./advance-options";
import { HandoffResultView } from "./handoff-result";

export interface HandoffDone {
  kind: HandoffKind;
  stage: JobStage | null;
  message: string;
  result?: HandoffResult | null;
}

export interface ProductionHandoffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  /** Druh předání; bez něj ho server odvodí z faktů (předání / doplnění / další krok). */
  kind?: HandoffKind;
  operationId?: string;
  existingPurchaseOrderId?: string;
  /** Cílový stav (ukončení / zápis výroby / vrácení — kam uživatel zakázku přetáhl). */
  target?: JobStage | null;
  /** „Přeplánovat výrobu" (titulek druhu plan). */
  replan?: boolean;
  onDone?: (done: HandoffDone) => void;
  /** Připravený plán (testy / náhled) — bez načítání ze serveru. */
  initialPlan?: HandoffPlan | null;
  /** Úvodní upozornění nad kroky (např. „Výroba ještě běží — nejdřív ji ukonči, pak zapiš dodání"). */
  intro?: React.ReactNode;
  /**
   * Vlastní druhotná akce místo „přesunout stav bez předání" (např. „Zapsat dodání bez ukončení kroků") —
   * dialog nikdy neblokuje (hlídání předání je zatím vypnuté).
   */
  plainAction?: { label: string; run: () => void } | null;
}

const KIND_ICON: Record<HandoffKind, typeof Factory> = {
  predani: Factory, doplneni: Factory, dalsi_krok: ArrowRightCircle, ukonceni: Flag, plan: Factory, zaznam: Factory, zpet: Undo2,
};

function fullDay(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  return m ? `${Number(m[3])}. ${Number(m[2])}. ${m[1]}` : (iso ?? "");
}

/** Konečný termín (zákazník) nahoře v dialogu — vždy jasně, s kým je dohodnutý. */
function FinalDateBlock({ plan, state, onChange }: { plan: HandoffPlan; state: HandoffState; onChange: (s: HandoffState) => void }) {
  const f = plan.finalDate;
  const margins = plan.permissions.canConfirmCustomerDate;
  if (f.date) {
    const unconfirmed = f.source === "customer_required_date" && !state.confirmRequested;
    return (
      <div className={cn("flex items-start gap-2 rounded-xl px-3 py-2 text-sm",
        unconfirmed ? "bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200" : "bg-rose-50 text-rose-900 dark:bg-rose-500/10 dark:text-rose-200")}
        data-testid="handoff-final">
        <Flag className="mt-0.5 h-4 w-4 shrink-0" />
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium">
            Konečný termín (zákazník) {fullDay(f.date)} — {unconfirmed ? "požadavek zákazníka, zatím nepotvrzený" : "dohodnuto se zákazníkem"}
            {f.maxTolerated ? ` · max. tolerovaný ${shortDay(f.maxTolerated)}` : ""}
          </span>
          {f.source === "customer_required_date" && margins && (
            <button type="button" onClick={() => onChange({ ...state, confirmRequested: !state.confirmRequested })}
              className="text-xs font-semibold underline-offset-2 hover:underline">
              {state.confirmRequested ? "Nechat jako požadavek" : "Potvrdit jako dohodnutý"}
            </button>
          )}
        </span>
      </div>
    );
  }
  const v = state.finalDate ?? { date: "", confirmed: false };
  return (
    <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50/60 p-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
      <label htmlFor="handoff-final-date" className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Konečný termín (zákazník) *</label>
      <Input id="handoff-final-date" type="date" value={v.date} onChange={(e) => onChange({ ...state, finalDate: { ...v, date: e.target.value } })}
        className="h-11 w-auto min-w-[10.5rem] text-base sm:h-10 sm:text-sm" />
      {margins ? (
        <fieldset className="space-y-1">
          <legend className="text-xs font-medium text-muted-foreground">Je termín dohodnutý se zákazníkem?</legend>
          <label className="flex min-h-10 cursor-pointer items-center gap-2"><input type="radio" name="final-confirmed" className="h-4 w-4 accent-green-600" checked={v.confirmed} onChange={() => onChange({ ...state, finalDate: { ...v, confirmed: true } })} /> Ano — potvrzený</label>
          <label className="flex min-h-10 cursor-pointer items-center gap-2"><input type="radio" name="final-confirmed" className="h-4 w-4 accent-green-600" checked={!v.confirmed} onChange={() => onChange({ ...state, finalDate: { ...v, confirmed: false } })} /> Ne — jen požadavek zákazníka</label>
        </fieldset>
      ) : (
        <p className="text-xs text-muted-foreground">Zapíše se jako požadavek zákazníka. Potvrzený termín zákazníkovi zapíše obchodník nebo admin.</p>
      )}
    </div>
  );
}

function IssueList({ issues, acceptLate, onAcceptLate, show }: { issues: HandoffIssue[]; acceptLate: boolean; onAcceptLate: (v: boolean) => void; show: boolean }) {
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");
  const infos = issues.filter((i) => i.level === "info");
  const late = warnings.some((w) => w.acceptLate);
  if (!errors.length && !warnings.length && !infos.length) return null;
  return (
    <div className="space-y-2">
      {show && errors.length > 0 && (
        <ul role="alert" className="space-y-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300" data-testid="handoff-errors">
          {errors.map((e, i) => <li key={`e${i}`}>{e.message}</li>)}
        </ul>
      )}
      {warnings.length > 0 && (
        <div className="space-y-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200" data-testid="handoff-warnings">
          <ul className="space-y-1">
            {warnings.map((w, i) => <li key={`w${i}`} className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {w.message}</li>)}
          </ul>
          {late && (
            <label className="flex min-h-11 cursor-pointer items-center gap-2 font-medium sm:min-h-9">
              <input type="checkbox" className="h-4 w-4 accent-amber-600" checked={acceptLate} onChange={(e) => onAcceptLate(e.target.checked)} />
              Vím o tom — termín se zákazníkem domluvím.
            </label>
          )}
        </div>
      )}
      {infos.map((x, i) => <p key={`i${i}`} className="text-xs text-muted-foreground">{x.message}</p>)}
    </div>
  );
}

/** Přidat další krok: rychlé volby podle výkresu + celý výběr druhu. */
function AddStepBar({ plan, state, onAdd }: { plan: HandoffPlan; state: HandoffState; onAdd: (k: OperationKind) => void }) {
  const [grid, setGrid] = React.useState(false);
  const quick = quickKinds(plan, state);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="inline-flex h-11 items-center gap-1.5 rounded-full border-2 border-dashed px-4 text-sm font-semibold text-muted-foreground transition hover:border-foreground/30 hover:text-foreground sm:h-9" data-testid="handoff-add-step">
              <Plus className="h-4 w-4" /> Přidat další krok
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72 max-w-[calc(100vw-2rem)]">
            <DropdownMenuLabel>Další krok postupu</DropdownMenuLabel>
            {quick.map((q) => {
              const m = OPERATION_KINDS[q.kind];
              return (
                <DropdownMenuItem key={q.kind} onSelect={() => onAdd(q.kind)} className="gap-2">
                  <m.icon className={cn("h-4 w-4", m.text)} /> <span className="truncate">{q.label}</span>
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setGrid(true)}>Jiná operace…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {quick.filter((q) => q.kind === "tepelne_zpracovani" || q.kind === "povrchova_uprava").filter((q) => q.label.includes("(")).map((q) => (
          <button key={q.kind} type="button" onClick={() => onAdd(q.kind)}
            className="inline-flex h-9 items-center gap-1 rounded-full bg-violet-100 px-3 text-xs font-semibold text-violet-800 hover:brightness-95 dark:bg-violet-500/15 dark:text-violet-200">
            + {q.label}
          </button>
        ))}
      </div>
      {grid && <KindGrid value={null} onPick={(k) => { setGrid(false); onAdd(k); }} />}
    </div>
  );
}

/**
 * Předání do výroby (povinné kdo + termín, víc kroků, nejlevnější nabídka předvyplněná, automatická
 * objednávka dodavateli s PDF). Jeden dialog pro všechny druhy: předání, doplnění, další krok, ukončení,
 * plán, zápis výroby, vrácení. Kontrola naživo = stejná pravidla jako na serveru.
 */
export function ProductionHandoffDialog({
  open, onOpenChange, jobId, kind, operationId, existingPurchaseOrderId, target, replan, onDone, initialPlan, intro, plainAction,
}: ProductionHandoffDialogProps) {
  const [plan, setPlan] = React.useState<HandoffPlan | null>(initialPlan ?? null);
  const [state, setState] = React.useState<HandoffState | null>(initialPlan ? initState(initialPlan, target) : null);
  const [loadError, setLoadError] = React.useState<{ message: string; code?: HandoffErrorCode } | null>(null);
  const [loading, setLoading] = React.useState(!initialPlan);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<{ message: string; code?: HandoffErrorCode } | null>(null);
  const [tried, setTried] = React.useState(false);
  const [result, setResult] = React.useState<HandoffResult | null>(null);
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set(initialPlan ? defaultExpanded(initialPlan) : []));
  const [kindNow, setKindNow] = React.useState<HandoffKind | undefined>(kind);
  const [routeBusy, setRouteBusy] = React.useState<string | null>(null);
  const [plainNote, setPlainNote] = React.useState<{ on: boolean; text: string }>({ on: false, text: "" });
  const descId = React.useId();

  const load = React.useCallback(async (k?: HandoffKind, route?: string) => {
    setLoading(true);
    setLoadError(null);
    setError(null);
    try {
      const r = await prepareProductionHandoff(jobId, {
        ...(k ? { kind: k } : {}), ...(operationId ? { operationId } : {}), ...(existingPurchaseOrderId ? { existingPurchaseOrderId } : {}),
        ...(target ? { target } : {}), ...(route ? { route } : {}),
      });
      if (!r.ok || !r.plan) {
        setLoadError({ message: r.error ?? "Předání se nepodařilo připravit.", code: r.code });
        return;
      }
      setPlan(r.plan);
      setState(initState(r.plan, target));
      setExpanded(new Set(defaultExpanded(r.plan)));
      setTried(false);
    } catch {
      setLoadError({ message: "Spojení se nepovedlo — zkus to znovu." });
    } finally {
      setLoading(false);
      setRouteBusy(null);
    }
  }, [jobId, operationId, existingPurchaseOrderId, target]);

  React.useEffect(() => {
    if (!open) return;
    setResult(null);
    setKindNow(kind);
    setPlainNote({ on: false, text: "" });
    if (!initialPlan) void load(kind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, jobId, kind]);

  const close = (o: boolean) => {
    if (busy) return;
    if (!o && result && plan) {
      onDone?.({ kind: result.kind, stage: result.stage, message: doneToast(result.kind, state?.finishTarget), result });
    }
    onOpenChange(o);
  };

  const issues = React.useMemo(() => (plan && state ? extraIssues(plan, state, issuesOf(plan, state)) : []), [plan, state]);
  const ok = plan && state ? canSubmit(plan, state, issues) : false;
  const k = state?.kind ?? kindNow ?? "predani";
  const Icon = KIND_ICON[k];
  const title = plan ? titleOf(plan, k, { replan }) : k === "dalsi_krok" ? "Posunout dál" : titleOf({ current: null } as unknown as HandoffPlan, k, { replan });

  // přesun „postaru" bez předání — hlídání předání je zatím vypnuté (majitel 29. 10.): dialog nikdy nezablokuje
  const move = plainAction
    ? { to: (target ?? "ve_vyrobe") as JobStage, label: plainAction.label, note: "" }
    : plainMoveOf(state?.kind ?? kindNow ?? (kind as HandoffKind), { stage: plan?.stage ?? null, target, finishTarget: state?.finishTarget ?? null });
  async function movePlain() {
    if (plainAction) { if (!busy) plainAction.run(); return; }
    if (!move) return;
    setBusy(true);
    setError(null);
    try {
      const r = await moveJobStage(jobId, move.to, { note: move.note });
      if (!r.ok) { setError({ message: r.error ?? "Stav se nepodařilo změnit." }); return; }
      const stage = r.stage ?? move.to;
      onDone?.({ kind: state?.kind ?? kindNow ?? "predani", stage, message: `Přesunuto: ${stageMeta(stage).label} — bez předání (zapsáno do historie)` });
      onOpenChange(false);
    } catch {
      setError({ message: "Spojení se nepovedlo — zkus to znovu." });
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!plan || !state) return;
    setTried(true);
    // „Jen opravit stav — důvod *": bez důvodu nic (jinak platí kontrola předání)
    if (plainNote.on ? !plainNote.text.trim() : !ok) return;
    setBusy(true);
    setError(null);
    try {
      // poznámky pro dodavatele upravené v dialogu → k položkám (objednávka je pak vytiskne)
      const notes = plainNote.on ? [] : itemNotePatches(plan, state);
      if (notes.length) {
        const n = await saveItemTechnology(jobId, notes);
        if (!n.ok) { setError({ message: n.error ?? "Poznámky pro dodavatele se nepodařilo uložit." }); return; }
      }
      if (plainNote.on) {
        // korekce bez kroku / bez výroby (enforcement je zatím vypnutý — WP4 doplní correctionOnly / skipProduction)
        const to: JobStage = state.kind === "zpet" ? (target ?? "potvrzeno") : state.kind === "zaznam" ? state.finishTarget : "ve_vyrobe";
        const r = await moveJobStage(jobId, to, { note: plainNote.text.trim() });
        if (!r.ok) { setError({ message: r.error ?? "Stav se nepodařilo změnit." }); return; }
        onDone?.({ kind: state.kind, stage: r.stage ?? to, message: `Stav opraven: ${stageMeta(r.stage ?? to).label}` });
        onOpenChange(false);
        return;
      }
      const r = await submitProductionHandoff(jobId, inputFromState(plan, state));
      if (!r.ok || !r.result) {
        setError({ message: r.error ?? "Předání se nepodařilo uložit.", code: r.code });
        return;
      }
      const res = r.result;
      const showScreen = res.purchaseOrders.length > 0 || (res.stornos?.length ?? 0) > 0 || res.issues.some((x) => x.level === "warning");
      if (showScreen) {
        setResult(res);
        return;
      }
      onDone?.({ kind: res.kind, stage: res.stage, message: doneToast(res.kind, state.finishTarget), result: res });
      onOpenChange(false);
    } catch {
      setError({ message: "Spojení se nepovedlo — zkus to znovu." });
    } finally {
      setBusy(false);
    }
  }

  const sheet = cn(
    "bottom-0 left-0 top-auto flex max-h-[94dvh] max-w-none translate-x-0 flex-col rounded-b-none",
    "sm:bottom-auto sm:left-1/2 sm:top-[3%] sm:max-h-[94vh] sm:max-w-2xl sm:-translate-x-1/2 sm:rounded-xl",
  );

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        aria-describedby={descId}
        className={sheet}
        onInteractOutside={(e) => { if (busy || (plan && state && !result)) e.preventDefault(); }}
        onEscapeKeyDown={(e) => { if (busy) e.preventDefault(); }}
        data-testid="handoff-dialog"
      >
        <div className="flex items-start gap-3 border-b px-4 py-2.5 pr-12 sm:px-5 sm:py-3.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <DialogTitle>{result ? doneToast(result.kind, state?.finishTarget) : title}</DialogTitle>
            <p id={descId} className="mt-0.5 truncate text-[13px] text-muted-foreground sm:whitespace-normal sm:text-sm">
              {!plan
                ? "Načítám předvyplněné kroky…"
                : result
                  ? [plan.jobNumber, plan.customerName].filter(Boolean).join(" · ")
                  : subtitleOf(plan, k)}
            </p>
          </div>
        </div>

        {result && plan ? (
          <div className="min-h-0 flex-1 overflow-y-auto pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            <HandoffResultView jobId={jobId} kind={result.kind} result={result} canSend={plan.permissions.canSend}
              senderEmail={plan.automation.senderEmail} target={state?.finishTarget} onClose={() => close(false)} />
          </div>
        ) : loading && !plan ? (
          <div className="flex min-h-40 items-center justify-center gap-2 p-6 text-sm text-muted-foreground" aria-busy>
            <Loader2 className="h-5 w-5 animate-spin" /> Připravuji předání — hledám nejlevnější nabídky…
          </div>
        ) : loadError || !plan || !state ? (
          <div className="space-y-3 p-5">
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {loadError?.message ?? "Předání se nepodařilo připravit."}
            </div>
            {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error.message}</p>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" className="h-11 sm:h-9" onClick={() => onOpenChange(false)} disabled={busy}>Zavřít</Button>
              {move && (
                <Button type="button" variant="outline" className="h-11 sm:h-9" onClick={() => void movePlain()} disabled={busy} data-testid="handoff-plain-move">
                  {busy ? <Loader2 className="animate-spin" /> : null} {move.label}
                </Button>
              )}
              {loadError?.code !== "NO_CUSTOMER_ORDER" && <Button type="button" variant="outline" className="h-11 sm:h-9" onClick={() => void load(kindNow)} disabled={busy}><RefreshCw /> Zkusit znovu</Button>}
            </div>
          </div>
        ) : (
          <>
            <div className={cn("min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 sm:px-5", loading && "pointer-events-none opacity-60")}>
              {intro && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200" data-testid="handoff-intro">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> <div className="min-w-0">{intro}</div>
                </div>
              )}
              <Body
                plan={plan} state={state} setState={setState} expanded={expanded} setExpanded={setExpanded}
                onUseRoute={(key) => { setRouteBusy(key); void load(state.kind, key); }} routeBusy={routeBusy}
                onFinish={() => { setKindNow("ukonceni"); void load("ukonceni"); }}
                plainNote={plainNote} setPlainNote={setPlainNote}
              />
              {!plainNote.on && <IssueList issues={issues} acceptLate={state.acceptLate} onAcceptLate={(v) => setState({ ...state, acceptLate: v })} show={tried || issues.some((x) => x.level === "error" && x.code !== "deadline_missing" && x.code !== "who_missing")} />}
              {error && (
                <div role="alert" className="flex flex-wrap items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> <span className="min-w-0 flex-1">{error.message}</span>
                  {(error.code === "STAGE_CHANGED" || error.code === "STEP_CHANGED") && (
                    <Button type="button" size="sm" variant="outline" onClick={() => void load(state.kind)}><RefreshCw /> Obnovit</Button>
                  )}
                </div>
              )}
            </div>
            <Footer plan={plan} state={state} setState={setState} busy={busy} ok={plainNote.on ? Boolean(plainNote.text.trim()) : ok}
              plain={plainNote.on} onCancel={() => close(false)} onSubmit={() => void submit()}
              move={plainNote.on ? null : move} onMove={() => void movePlain()} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function initState(plan: HandoffPlan, target?: JobStage | null): HandoffState {
  const s = stateFromPlan(plan, { target: target ?? null });
  // oprava / dodělání po výrobě: nový krok „Oprava / dodělání" (kdo = poslední, kdo to dělal)
  if (plan.kind === "predani" && stageRank(plan.stage) >= 6 && s.steps.length === 1 && !s.steps[0].operationId) {
    s.steps = [{ ...s.steps[0], title: "Oprava / dodělání" }];
  }
  // další krok bez připraveného kroku: rovnou „Jiný další krok…"
  if (plan.kind === "dalsi_krok" && !s.steps.length) s.advance = "other";
  return s;
}

function defaultExpanded(plan: HandoffPlan): string[] {
  const keys = plan.steps.slice(0, 1).map((s) => s.key);
  // kroky bez kdo / termínu (musí se vyplnit) jsou rozbalené
  for (const s of plan.steps) {
    if ((s.start || s.status === "probiha" || s.status === "problem") && s.who.type === "none") keys.push(s.key);
    if (!s.plannedEnd) keys.push(s.key);
  }
  return keys;
}

/** Další kontroly dialogu (mimo serverová pravidla): důvod přeskočení dodání, „Jiný další krok" bez kroku. */
function extraIssues(plan: HandoffPlan, state: HandoffState, issues: HandoffIssue[]): HandoffIssue[] {
  const out = [...issues];
  if (state.kind === "ukonceni" && stageRank(state.finishTarget) >= 9 && !state.note.trim()) {
    out.push({ code: "po_reason_missing", level: "error", message: "Napiš, proč přeskakuješ dodání." });
  }
  if (state.kind === "dalsi_krok" && !state.steps.length) {
    out.push({ code: "who_missing", level: "error", message: "Vyber, kam díl jde dál (další krok, nebo Ukončit výrobu)." });
  }
  if ((state.kind === "predani" || state.kind === "plan" || state.kind === "doplneni") && !state.steps.length && !plan.current) {
    if (!out.some((x) => x.message === "Přidej aspoň jeden krok výroby.")) out.push({ code: "who_missing", level: "error", message: "Přidej aspoň jeden krok výroby." });
  }
  return out;
}

function subtitleOf(plan: HandoffPlan, kind: HandoffKind): string {
  const head = [plan.jobNumber, plan.customerName].filter(Boolean).join(" · ");
  const cur = plan.current;
  switch (kind) {
    case "predani": return `${head} — komu to zadáváš a do kdy.`;
    case "doplneni": return "Zakázka je ve výrobě, ale chybí, kdo to dělá a termín.";
    case "dalsi_krok": return cur && (cur.status === "probiha" || cur.status === "problem") ? `${cur.label} u ${cur.location} — kam díl jde dál?` : `${head} — další krok čeká na předání (kdo + termín).`;
    case "ukonceni": return `${head} — kam jdou hotové díly?`;
    case "plan": return `${head} — kroky výroby dopředu (nic se teď nespouští).`;
    case "zaznam": return `${head} — kdo díl vyrobil a kdy (zakázka přeskakuje výrobu).`;
    case "zpet": return `${head} — zakázka se vrátí před předání do výroby.`;
  }
}

function Body({
  plan, state, setState, expanded, setExpanded, onUseRoute, routeBusy, onFinish, plainNote, setPlainNote,
}: {
  plan: HandoffPlan;
  state: HandoffState;
  setState: (s: HandoffState) => void;
  expanded: Set<string>;
  setExpanded: (s: Set<string>) => void;
  onUseRoute: (key: string) => void;
  routeBusy: string | null;
  onFinish: () => void;
  plainNote: { on: boolean; text: string };
  setPlainNote: (v: { on: boolean; text: string }) => void;
}) {
  const kind = state.kind;
  const labels = stepLabels(plan, state.steps);
  const currency = plan.steps.find((s) => s.poPreview)?.poPreview?.currency ?? "CZK";
  const toggle = (key: string) => {
    const n = new Set(expanded);
    if (n.has(key)) n.delete(key); else n.add(key);
    setExpanded(n);
  };
  const add = (k: OperationKind) => {
    const next = addStep(plan, state, k, kind === "dalsi_krok" ? { after: -1, start: true } : {});
    setState(next);
    const added = kind === "dalsi_krok" ? next.steps[0] : next.steps[next.steps.length - 1];
    setExpanded(new Set([...expanded, added.key]));
  };
  const rework = kind === "predani" && stageRank(plan.stage) >= 6;
  const margins = plan.permissions.canConfirmCustomerDate;

  if (kind === "zpet") {
    const sent = plan.openPurchaseOrders.filter((p) => p.status === "odeslana" || p.status === "potvrzena");
    return (
      <div className="space-y-3 text-sm">
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>Běžící krok se vrátí na Čeká, zakázka do stavu před předáním.</li>
          <li>Neodeslané objednávky z předání se zruší (dodavatel nic nedostal).</li>
        </ul>
        {!plan.client?.undoHandoffId && <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">K zakázce není předání, které jde vrátit.</p>}
        {sent.length > 0 && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            Objednávka {sent.map((p) => p.number).join(", ")} už odešla dodavateli — nejdřív ji stornuj v Nákupu (obchodník/admin), pak předání vrať.
          </p>
        )}
        <NoteField state={state} setState={setState} label="Poznámka (nepovinné)" />
        {/* „jen přesunout stav" je jedna volba — odkaz v patičce (zapíše se do historie s tvým jménem) */}
      </div>
    );
  }

  if (kind === "ukonceni") {
    return (
      <div className="space-y-3">
        <ReceiptBlock plan={plan} state={state} onChange={setState} />
        <FinishOptions plan={plan} state={state} onChange={setState} />
      </div>
    );
  }

  const planned = kind === "dalsi_krok" && plan.steps.length > 0;
  return (
    <div className="space-y-3">
      {kind !== "zaznam" && <FinalDateBlock plan={plan} state={state} onChange={setState} />}
      {(kind === "predani" || kind === "plan") && !rework && <SuggestionBanner plan={plan} currency={currency} onUseRoute={onUseRoute} busyRoute={routeBusy} />}
      {rework && <p className="flex items-center gap-1.5 text-sm text-muted-foreground"><AiLabel /> Oprava / dodělání — kdo = poslední, kdo díl dělal.</p>}

      {kind === "dalsi_krok" && (
        <>
          <ReceiptBlock plan={plan} state={state} onChange={setState} nextFirm={state.steps[0] ? labelsFirm(state) : null} />
          <AdvanceOptions
            plan={plan} state={state} nextLabel={labels[0]} hasPlannedNext={planned}
            onNext={() => { const s = stateFromPlan(plan); setState({ ...s, receipts: state.receipts, continueWithoutRest: state.continueWithoutRest }); setExpanded(new Set(defaultExpanded(plan))); }}
            onOther={(k) => {
              const base: HandoffState = { ...state, advance: "other", steps: [] };
              const next = addStep(plan, base, k, { start: true });
              setState(next);
              setExpanded(new Set([next.steps[0].key]));
            }}
            onFinish={onFinish}
          />
        </>
      )}

      {state.steps.map((s, i) => (
        <HandoffStepCard
          key={s.key}
          jobId={plan.jobId}
          plan={plan}
          state={state}
          index={i}
          label={labels[i]}
          expanded={expanded.has(s.key)}
          onExpand={() => toggle(s.key)}
          onChange={setState}
          onRemove={state.steps.length > 1 && !s.status ? () => setState(removeStep(plan, state, i)) : s.added && kind !== "dalsi_krok" && state.steps.length > 1 ? () => setState(removeStep(plan, state, i)) : undefined}
        />
      ))}

      {(kind === "predani" || kind === "plan" || kind === "doplneni") && state.steps.length < 12 && <AddStepBar plan={plan} state={state} onAdd={add} />}

      {kind === "zaznam" && <PlainCorrection label="Bez výroby (ze skladu / hotový díl)" value={plainNote} onChange={setPlainNote} />}
      {/* oprava po výrobě bez nového kroku = odkaz „Přesunout bez dodavatele a termínu" v patičce (jedna volba) */}
      {kind !== "zaznam" && <NoteField state={state} setState={setState} label={kind === "predani" ? "Poznámka k předání (nepovinné)" : "Poznámka (nepovinné)"} />}
      {/* na mobilu „Rovnou odeslat" pod kroky (patička zůstane nízká: kdo + termín + tlačítko) */}
      <SendNowBlock plan={plan} state={state} setState={setState} plain={plainNote.on} className="sm:hidden" />
    </div>
  );
}

function labelsFirm(state: HandoffState): string | null {
  const w = state.steps[0]?.who;
  if (!w) return null;
  return w.type === "supplier" ? w.name ?? null : w.type === "free" ? w.name : w.type === "u_nas" ? "U nás" : null;
}

function NoteField({ state, setState, label }: { state: HandoffState; setState: (s: HandoffState) => void; label: string }) {
  const id = React.useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      <Textarea id={id} rows={2} maxLength={500} value={state.note} onChange={(e) => setState({ ...state, note: e.target.value })}
        className="text-base sm:text-sm" placeholder="Do historie zakázky (s tvým jménem)" />
    </div>
  );
}

function PlainCorrection({ label, value, onChange }: { label: string; value: { on: boolean; text: string }; onChange: (v: { on: boolean; text: string }) => void }) {
  return (
    <div className="space-y-1.5 rounded-lg border border-dashed p-2.5 text-sm">
      <label className="flex min-h-10 cursor-pointer items-center gap-2 font-medium">
        <input type="checkbox" className="h-4 w-4" checked={value.on} onChange={(e) => onChange({ ...value, on: e.target.checked })} />
        {label} — důvod *
      </label>
      {value.on && (
        <Input value={value.text} onChange={(e) => onChange({ ...value, text: e.target.value })} placeholder="Proč (zapíše se do historie)" maxLength={500}
          className="h-11 text-base sm:h-10 sm:text-sm" aria-label={`${label} — důvod`} />
      )}
    </div>
  );
}

/** „Rovnou odeslat dodavateli" / plná automatika (jen s právem posílat a s novou objednávkou). */
function SendNowBlock({ plan, state, setState, plain, className }: {
  plan: HandoffPlan; state: HandoffState; setState: (s: HandoffState) => void; plain: boolean; className?: string;
}) {
  const orders = newOrderCount(state);
  const first = firstOrderEmail(plan, state);
  const canSend = plan.permissions.canSend && orders > 0 && !plain;
  const sender = plan.automation.senderEmail;
  const disabled = !first.email || !sender;
  const auto = canSend && autoSendsAll(plan, state);
  const reason = !plan.permissions.canSend && orders > 0 && plan.automation.reason ? plan.automation.reason : null;
  if (!auto && !canSend && !reason) return null;
  return (
    <div className={cn("space-y-2", className)}>
      {auto && (
        <p className="flex items-start gap-2 text-sm" data-testid="handoff-auto-send">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-red-600" checked disabled readOnly aria-label="Odešle se automaticky" />
          <span className="min-w-0">
            Plná automatika — objednávka odejde dodavateli sama{first.email ? ` (${first.email})` : ""}
            <span className="block text-[11px] text-muted-foreground">Odešle se z: {sender}</span>
          </span>
        </p>
      )}
      {canSend && !auto && (
        <label className={cn("flex min-h-11 cursor-pointer items-center gap-2 text-sm sm:min-h-9", disabled && "cursor-not-allowed opacity-60")} data-testid="handoff-send-now">
          <input type="checkbox" className="h-4 w-4 accent-red-600" disabled={disabled} checked={state.sendNow && !disabled}
            onChange={(e) => setState({ ...state, sendNow: e.target.checked })} />
          <span className="min-w-0">
            Rovnou odeslat dodavateli{first.email ? ` (${first.email})` : ""}
            <span className="block text-[11px] text-muted-foreground">
              {!first.email ? "Dodavatel nemá v adresáři e-mail — objednávka počká ve frontě." : !sender ? "Nemáš nastavenou schránku pro odesílání — objednávka počká ve frontě." : `Odešle se z: ${sender}`}
            </span>
          </span>
        </label>
      )}
      {reason && <p className="text-xs text-muted-foreground">{reason}</p>}
    </div>
  );
}

function Footer({
  plan, state, setState, busy, ok, plain, onCancel, onSubmit, move, onMove,
}: {
  plan: HandoffPlan; state: HandoffState; setState: (s: HandoffState) => void; busy: boolean; ok: boolean; plain: boolean;
  onCancel: () => void; onSubmit: () => void;
  /** Přesun bez předání (zatím se nehlídá — jen upozornění na zakázce). */
  move?: { label: string } | null;
  onMove?: () => void;
}) {
  const summary = plain ? "Jen změna stavu — bez kroků a objednávek" : summaryLine(plan, state);
  return (
    <div className="space-y-2 border-t bg-background/95 px-4 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] sm:rounded-b-xl sm:px-5 sm:py-3">
      <SendNowBlock plan={plan} state={state} setState={setState} plain={plain} className="hidden sm:block" />
      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
        <div className="min-w-0 flex-1 sm:space-y-1">
          {/* kdo a do kdy hned u tlačítka — na mobilu je karta kroku často pod okrajem */}
          <p className="text-[13px] font-medium text-foreground/80 sm:text-xs sm:font-normal sm:text-muted-foreground" data-testid="handoff-summary">{summary}</p>
          {move && onMove && (
            <button type="button" onClick={onMove} disabled={busy} data-testid="handoff-plain-move"
              className="inline-flex min-h-9 items-center text-left text-[13px] font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-60 sm:min-h-8 sm:text-xs">
              {move.label}
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy} className="h-11 flex-1 sm:h-9 sm:flex-none">Zrušit</Button>
          <Button type="button" variant={state.kind === "zpet" ? "destructive" : "success"} onClick={onSubmit} disabled={busy || !ok}
            className="h-11 flex-[2] text-base font-semibold sm:h-9 sm:flex-none sm:text-sm" data-testid="handoff-submit">
            {busy ? <Loader2 className="animate-spin" /> : null}
            {busy ? busyLabel(state.kind) : plain ? "Změnit stav" : submitLabel(state.kind)}
          </Button>
        </div>
      </div>
    </div>
  );
}

