"use client";

import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { StageBadge } from "@/components/jobs/stage-badge";
import { ReasonDialog } from "@/components/flow-status/reason-dialog";
import { useSettledRefresh } from "@/components/jobs/use-settled-refresh";
import { useAccess } from "@/components/access-provider";
import { moveJobStage } from "@/app/actions/flow-status";
import { previewJobStage } from "@/app/actions/job-flow";
import { STAGE_ORDER, SIDE_STAGES, stageMeta } from "@/lib/jobs/stages";
import {
  reasonRequired, stageEffect, stageEffectText, transitionFeature, type FlowFacts, type QuoteFacts,
} from "@/lib/jobs/flow-status";
import type { JobStage } from "@/lib/supabase/database.types";
import { stageMoveIntent } from "@/lib/jobs/production-handoff";
import type { HandoffKind } from "@/lib/jobs/production-handoff-types";
import { ProductionHandoffDialog } from "@/components/jobs/production/handoff/handoff-dialog";
import { cn } from "@/lib/utils";

/** Tok zakázky včetně volitelných kroků (sklad, montáž) v pořadí knihy. */
export const FLOW_STAGES: JobStage[] = STAGE_ORDER.filter((s) => !SIDE_STAGES.includes(s));

const NEGATIVE: JobStage[] = ["nerealizovano", "zruseno"];

function StageRow({ stage, current, hint }: { stage: JobStage; current: boolean; hint?: string | null }) {
  const m = stageMeta(stage);
  const Icon = m.icon;
  return (
    <>
      <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full", m.badge)}>
        <Icon className="!size-3.5 !text-current" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block text-sm font-medium leading-tight", current && m.text)}>{m.label}</span>
        <span className="block truncate text-[11px] leading-tight text-muted-foreground">{hint ?? m.description}</span>
      </span>
      {current && <Check className={cn("!size-4 shrink-0", m.text)} />}
    </>
  );
}

/**
 * Dialog ruční korekce hlavního stavu (R9): náhled dopadu (nabídky, dílčí stavy, varování),
 * u negativních konců povinný důvod, vždy volitelná poznámka (jde do historie s autorem).
 * Fakta toku (flow, quotes) dávají náhled hned; bez nich si ho dialog načte ze serveru.
 */
export function StageCorrectionDialog({
  open, onOpenChange, jobId, from, to, flow, quotes, onDone, title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  from: JobStage;
  to: JobStage | null;
  flow?: FlowFacts | null;
  quotes?: QuoteFacts[] | null;
  /** Po úspěšné korekci (stav z DB). */
  onDone?: (stage: JobStage) => void;
  title?: string;
}) {
  // otisk = výchozí stav: po korekci se musí změnit (jinak pojistka stránku načte znovu)
  const settle = useSettledRefresh(250, `${jobId}:${from}`);
  const [remote, setRemote] = React.useState<{ to: JobStage; lines: string[]; error?: string } | null>(null);
  const [openedFrom, setOpenedFrom] = React.useState<JobStage | null>(open ? from : null);
  // „Přesunout i tak" u zakázky bez objednávky zákazníka: korekce postaru (hlídání předání je zatím vypnuté)
  const [legacy, setLegacy] = React.useState(false);
  React.useEffect(() => {
    if (open) setOpenedFrom((f) => f ?? from);
    else { setOpenedFrom(null); setLegacy(false); }
  }, [open, from]);
  const local = React.useMemo(() => {
    if (!to || !flow) return null;
    return stageEffectText(stageEffect({ ...flow, stage: from }, quotes ?? [], { kind: "stage", to }));
  }, [to, flow, quotes, from]);

  React.useEffect(() => {
    if (!open || !to || flow) return;
    let alive = true;
    setRemote(null);
    previewJobStage(jobId, to)
      .then((r) => {
        if (alive) setRemote({ to, lines: r.ok ? r.lines ?? [] : [], error: r.ok ? undefined : r.error });
      })
      .catch(() => alive && setRemote({ to, lines: [], error: "Náhled dopadu se nepodařilo načíst." }));
    return () => { alive = false; };
  }, [open, to, flow, jobId]);

  if (!to) return null;
  // přesun do / z / přes výrobu: povinné předání (kdo + termín), ukončení, zápis výroby nebo vrácení.
  // Výchozí stav platí z chvíle otevření — po předání se stránka obnoví (stav = cíl) a otevřený
  // dialog (výsledek předání) se nesmí přepnout na obyčejnou korekci „Ve výrobě → Ve výrobě“.
  const intent = stageMoveIntent(openedFrom ?? from, to, {
    openSteps: flow ? Math.max(0, (flow.productionTotal ?? 0) - (flow.productionDone ?? 0)) : 1,
    doneSteps: flow?.productionDone ?? 0,
    deliveredPurchaseOrders: flow?.deliveredPurchaseOrders ?? 0,
  });
  if (intent.kind === "blocked" && !legacy) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent aria-describedby={undefined} className="w-[calc(100%-1.5rem)] sm:max-w-md">
          <div className="space-y-3 p-5">
            <DialogTitle className="pr-8">Do výroby teď předat nejde</DialogTitle>
            <p className="text-sm text-muted-foreground" role="alert">
              {intent.code === "NO_CUSTOMER_ORDER"
                ? "Zákazník ještě neobjednal — nejdřív zapiš objednávku zákazníka."
                : "Uzavřenou zakázku nelze předat do výroby — nejdřív ji obnov."}
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {/* hlídání předání je zatím vypnuté (majitel 29. 10.) — přesun postaru jde, zapíše se do historie */}
              <button type="button" onClick={() => setLegacy(true)} data-testid="stage-legacy-move"
                className="inline-flex h-11 items-center justify-center rounded-md px-4 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground sm:h-10">
                Přesunout i tak (bez předání)
              </button>
              <button type="button" onClick={() => onOpenChange(false)} className="inline-flex h-11 items-center justify-center rounded-md border px-4 text-sm font-medium hover:bg-accent sm:h-10">Rozumím</button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }
  if (intent.kind !== "none" && intent.kind !== "blocked") {
    const kind: HandoffKind = intent.kind;
    return (
      <ProductionHandoffDialog
        open={open}
        onOpenChange={onOpenChange}
        jobId={jobId}
        kind={kind}
        target={intent.kind === "predani" ? null : to}
        onDone={(d) => {
          onDone?.(d.stage ?? to);
          settle();
        }}
      />
    );
  }
  const needsReason = reasonRequired("job", to);
  const loading = !flow && (!remote || remote.to !== to);
  const lines = local ?? (remote?.to === to ? remote.lines : []);
  const effect = loading ? ["Načítám, co se stane…"] : lines.length ? lines : ["Jen se změní hlavní stav — doklady ani nabídky se nemění."];
  const fromLabel = stageMeta(from).label;
  const toLabel = stageMeta(to).label;

  return (
    <ReasonDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title ?? `Korekce stavu: ${fromLabel} → ${toLabel}`}
      description={needsReason
        ? "Uzavření zakázky — vyber důvod. Zapíše se do historie s tvým jménem."
        : "Ruční změna bez dokladu. Běžně stav posouvají akce a doklady samy; korekce se zapíše do historie s tvým jménem."}
      phase={needsReason ? "job" : undefined}
      to={to}
      reasons={needsReason ? undefined : []}
      destructive={NEGATIVE.includes(to)}
      confirmLabel={needsReason ? `Uzavřít: ${toLabel}` : `Změnit na ${toLabel}`}
      notePlaceholder="Proč měníš stav ručně (nepovinné)"
      effect={[...effect, ...(remote?.to === to && remote.error ? [remote.error] : [])]}
      onConfirm={async ({ reason, note }) => {
        const res = await moveJobStage(jobId, to, { reason, note });
        if (!res.ok) return { ok: false, error: res.error ?? "Stav se nepodařilo změnit." };
        onDone?.(res.stage ?? to);
        settle();
        return { ok: true };
      }}
    />
  );
}

/**
 * Barevný stav zakázky s menu „Korekce stavu…" — výběr cílového stavu otevře dialog s náhledem
 * dopadu (StageCorrectionDialog). Primární posun dělají akce dalšího kroku (nextAction).
 */
export function StageSelect({
  jobId,
  stage,
  onChanged,
  size = "md",
  disabled,
  flow,
  quotes,
}: {
  jobId: string;
  stage: JobStage;
  onChanged?: (stage: JobStage) => void;
  size?: "sm" | "md";
  disabled?: boolean;
  /** Fakta toku pro okamžitý náhled dopadu (jinak se načte ze serveru). */
  flow?: FlowFacts | null;
  quotes?: QuoteFacts[] | null;
}) {
  const { can, features } = useAccess();
  const [target, setTarget] = React.useState<JobStage | null>(null);
  const [open, setOpen] = React.useState(false);
  // oprávnění se na klient dostanou až po načtení layoutu — do té doby nic neskrývat
  const known = features.length > 0;

  const item = (s: JobStage) => {
    const allowed = !known || can(transitionFeature("job", s));
    return (
      <DropdownMenuItem
        key={s}
        disabled={s === stage || !allowed}
        onSelect={() => {
          if (s === stage || !allowed) return;
          setTarget(s);
          setOpen(true);
        }}
        className={cn("items-center gap-2.5 py-1.5", s === stage && "bg-accent/60 opacity-100")}
      >
        <StageRow stage={s} current={s === stage} hint={allowed ? null : "Uzavřít smí obchodník nebo admin — navrhni v menu ⋯"} />
      </DropdownMenuItem>
    );
  };

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <button
            type="button"
            aria-label={`Stav zakázky: ${stageMeta(stage).label} — změnit`}
            title="Korekce stavu…"
            className={cn(
              "group inline-flex items-center gap-1 rounded-full outline-none transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60",
              !disabled && "hover:brightness-95 active:scale-[0.98]",
            )}
          >
            <StageBadge stage={stage} size={size === "sm" ? "sm" : "md"} className="pr-1.5" />
            <span className={cn("-ml-1 inline-flex items-center", stageMeta(stage).text)}>
              <ChevronDown className={cn("transition-transform group-data-[state=open]:rotate-180", size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4")} aria-hidden />
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[70vh] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto">
          <DropdownMenuLabel className="space-y-0.5">
            <span className="block">Korekce stavu…</span>
            <span className="block text-[11px] font-normal text-muted-foreground">Bez dokladu — ukážu, co se stane, a zapíšu tvoje jméno.</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Tok zakázky</DropdownMenuLabel>
          {FLOW_STAGES.map(item)}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Speciální stavy</DropdownMenuLabel>
          {SIDE_STAGES.map(item)}
        </DropdownMenuContent>
      </DropdownMenu>
      <StageCorrectionDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setTarget(null);
        }}
        jobId={jobId}
        from={stage}
        to={target}
        flow={flow}
        quotes={quotes}
        onDone={(s) => onChanged?.(s)}
      />
    </div>
  );
}

/**
 * Výběr cílového stavu pro „Korekce stavu…" z menu akcí (bez rozbalovacího odznaku):
 * mřížka stavů → StageCorrectionDialog.
 */
export function StagePickerDialog({
  open, onOpenChange, jobId, stage, flow, quotes, onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  stage: JobStage;
  flow?: FlowFacts | null;
  quotes?: QuoteFacts[] | null;
  onDone?: (stage: JobStage) => void;
}) {
  const { can, features } = useAccess();
  const [target, setTarget] = React.useState<JobStage | null>(null);
  const known = features.length > 0;
  const id = React.useId();
  React.useEffect(() => { if (open) setTarget(null); }, [open]);
  const pick = (s: JobStage) => {
    const allowed = !known || can(transitionFeature("job", s));
    const m = stageMeta(s);
    return (
      <button
        key={s}
        type="button"
        disabled={s === stage || !allowed}
        onClick={() => setTarget(s)}
        className={cn(
          "flex min-h-11 items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-left transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          s === stage && "border-foreground/30 bg-accent/60",
        )}
        aria-label={`${m.label}${s === stage ? " (aktuální)" : ""}`}
      >
        <StageRow stage={s} current={s === stage} />
      </button>
    );
  };
  if (target) {
    return (
      <StageCorrectionDialog
        open={open}
        onOpenChange={(o) => {
          if (!o) setTarget(null);
          onOpenChange(o);
        }}
        jobId={jobId}
        from={stage}
        to={target}
        flow={flow}
        quotes={quotes}
        onDone={onDone}
      />
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={`${id}-desc`}
        className={cn(
          "bottom-0 left-0 top-auto max-h-[90dvh] max-w-none translate-x-0 overflow-y-auto rounded-b-none pb-[max(1rem,env(safe-area-inset-bottom))]",
          "sm:bottom-auto sm:left-1/2 sm:top-[10%] sm:max-w-xl sm:-translate-x-1/2 sm:rounded-xl",
        )}
      >
        <div className="space-y-3 p-4 sm:p-5">
          <div className="pr-8">
            <DialogTitle>Korekce stavu — vyber nový stav</DialogTitle>
            <p id={`${id}-desc`} className="mt-1 text-sm text-muted-foreground">
              Ruční změna bez dokladu. Dalším krokem uvidíš, co se stane s nabídkami a dílčími stavy.
            </p>
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {FLOW_STAGES.map(pick)}
            {SIDE_STAGES.map(pick)}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
