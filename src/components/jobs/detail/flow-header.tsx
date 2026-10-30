"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActorStamp } from "@/components/flow-status/actor-stamp";
import { FlowStatusChip } from "@/components/flow-status/state-chip";
import { NextActionButton } from "@/components/flow-status/next-action-button";
import { StateMenu } from "@/components/flow-status/state-menu";
import { ProposalChip } from "@/components/flow-status/proposal-chip";
import { decideProposal, isDirectAction } from "@/components/jobs/flow-direct";
import {
  CAUSE_LABELS, FLOW_ACTIONS, phaseTrail, primaryChip, transitionFeature, type ChangeStamp, type FlowCause, type JobStamps,
} from "@/lib/jobs/flow-status";
import { actionPalette } from "@/components/flow/flow-state";
import { useJobDetail } from "./detail-context";
import { useFlowActions } from "./flow-actions";
import { cn } from "@/lib/utils";
import { useSettledRefresh } from "@/components/jobs/use-settled-refresh";

const EMPTY_STAMPS: JobStamps = {
  stage: null, inquiry: null, order: null, confirmed: null, confirmationSent: null, deliveryNote: null, invoiced: null,
  paid: null, lost: null, proposal: null, stageHistory: {},
};

/** „⚙ Automaticky (výroba začala)" u automatického posunu, jinak bez prefixu. */
export function stageStampVerb(s: ChangeStamp | null | undefined): string | undefined {
  if (!s || s.via !== "automaticky") return undefined;
  const cause = s.cause ? CAUSE_LABELS[s.cause as FlowCause] ?? s.cause : null;
  return cause ? `⚙ Automaticky (${cause})` : "⚙ Automaticky";
}

/** Kdo naposledy změnil hlavní stav — text na všech šířkách, ťuknutím detail. */
export function StageStamp({ className }: { className?: string }) {
  const flow = useFlowActions();
  const s = flow?.stamps?.stage ?? null;
  if (!s) return null;
  return <ActorStamp stamp={s} verb={stageStampVerb(s)} className={className} />;
}

function sameStamp(a: ChangeStamp | null | undefined, b: ChangeStamp | null | undefined): boolean {
  return Boolean(a && b && a.at === b.at && (a.by?.id ?? null) === (b.by?.id ?? null));
}

/**
 * Klíčový dílčí stav pod hlavním stavem (jako v Knize): „Aktualizovaná (rev 2)", „Částečně dodáno 1/2",
 * „Potvrzeno bez dokladu" — vidět i na mobilu bez posouvání řádku průběhu. Návrh má vlastní řádek.
 */
export function FlowStageChip({ className, hidePendingQuote, deliveryNote }: {
  className?: string;
  /** #25: chip „Neschválená · NAB-…“ vynechat — hlavička pod ním ukazuje výrazný štítek schválení. */
  hidePendingQuote?: boolean;
  /** Poslední dodací list — chip dodání („Dodáno", „Částečně dodáno") na něj odkazuje. */
  deliveryNote?: { id: string; number: string } | null;
}) {
  const flow = useFlowActions();
  if (!flow?.facts || !flow.snapshot) return null;
  const chip = primaryChip(flow.facts, flow.snapshot, flow.stamps);
  if (!chip || chip.phase === "proposal") return null;
  if (hidePendingQuote && chip.phase === "quote" && chip.key === "ke_schvaleni") return null;
  const stamp = chip.stamp && !sameStamp(chip.stamp, flow.stamps?.stage) ? chip.stamp : null;
  return (
    <div className={cn("flex min-w-0 max-w-full flex-col items-start gap-0.5 lg:items-end", className)}>
      {deliveryNote && chip.phase === "delivery" && chip.key !== "k_expedici" ? (
        <a
          href={`/api/jobs/files/${deliveryNote.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-full hover:opacity-90"
          title={`Dodací list ${deliveryNote.number} (PDF)`}
          data-testid="delivery-chip-link"
        >
          <FlowStatusChip chip={chip} />
          <span className="whitespace-nowrap font-mono text-[11px] font-medium text-green-700 underline-offset-2 hover:underline dark:text-green-400">{deliveryNote.number}</span>
        </a>
      ) : (
        <FlowStatusChip chip={chip} />
      )}
      {stamp && <ActorStamp stamp={stamp} className="max-w-[18rem]" />}
    </div>
  );
}

/** Nápověda pod stavem: další krok (sloveso), jinak popis hlavního stavu. */
export function FlowNextHint({ fallback, className }: { fallback: string; className?: string }) {
  const flow = useFlowActions();
  const next = flow?.next ?? null;
  return <p className={className}>{next ? `Další krok: ${next.label.replace(/…$/, "")}` : fallback}</p>;
}

/**
 * Jediné primární tlačítko karty (sloveso dalšího kroku) + menu „⋯" s ručními přechody,
 * destruktivními akcemi dole a „Korekce stavu…" na konci. Přímé akce mají „Vrátit".
 */
export function FlowActionBar({ className }: { className?: string }) {
  const flow = useFlowActions();
  const { jobId, notify } = useJobDetail();
  if (!flow?.facts || !flow.snapshot) return null;
  const { next, menu, run, runDirect, undo, canUndo } = flow;
  // barva podle akce (jako v Knize), ne podle chipu
  const tone = next ? actionPalette(next.key) : null;
  const palette = tone && tone !== "ghost.proposal" ? tone : undefined;
  const meta = next ? FLOW_ACTIONS[next.key] : null;
  const Icon = meta?.icon;
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {next && meta && Icon && (meta.kind === "link" ? (
        <Button type="button" className="min-h-11 sm:min-h-9" onClick={() => run(next.key)}>
          <Icon aria-hidden /> {next.label}
        </Button>
      ) : (
        <NextActionButton
          action={next}
          jobId={jobId}
          palette={palette}
          onRun={async (key) => {
            if (isDirectAction(key)) {
              const res = await runDirect(key);
              // #25: schválení má vlastní text (kdo ji teď může odeslat), ne jen „Hotovo“
              if (res?.ok && !res.needsConfirm && key === "quote.approve") notify("success", flow.approveToast);
              return res ?? { ok: false, error: "Akci nejde provést." };
            }
            run(key);
            return { ok: true };
          }}
          onUndo={next && isDirectAction(next.key) && canUndo(next.key) && undo ? undo : undefined}
        />
      ))}
      <StateMenu actions={menu} onAction={(k) => run(k)} label="Akce se stavem" />
    </div>
  );
}

/** Čekající návrh změny (zaměstnanec / AI) — „duch" s ✓ / ✕ pro toho, kdo smí rozhodnout. */
export function FlowProposalLine({ className }: { className?: string }) {
  const flow = useFlowActions();
  const { jobId } = useJobDetail();
  const p = flow?.facts?.proposal;
  const settle = useSettledRefresh(250, p ? `${p.phase}:${p.to}:${flow?.stamps?.proposal?.at ?? ""}` : "");
  if (!flow || !p) return null;
  return (
    <ProposalChip
      proposal={p}
      stamp={flow.stamps?.proposal}
      canDecide={flow.ctx.can(transitionFeature(p.phase, p.to))}
      className={className}
      onDecide={async (accept) => {
        const res = await decideProposal(jobId, accept);
        if (res.ok) settle();
        return res;
      }}
    />
  );
}

/**
 * Jeden řádek průběhu v hlavičce (M9): hotové fáze „✓ Poptávka · J. Novák", aktuální fáze
 * rozbalená do chipu, budoucí ztlumené. Na mobilu se posouvá do strany.
 */
export function FlowTrail({ className }: { className?: string }) {
  const flow = useFlowActions();
  const list = React.useRef<HTMLOListElement>(null);
  const steps = flow?.facts && flow.snapshot ? phaseTrail(flow.facts, flow.snapshot, flow.stamps ?? EMPTY_STAMPS) : [];
  const currentPhase = steps.find((st) => st.current)?.phase ?? null;
  // na úzkém displeji posunout řádek na aktuální fázi (jen vodorovně — stránka neposkočí)
  React.useEffect(() => {
    const ol = list.current;
    const li = ol?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!ol || !li || ol.scrollWidth <= ol.clientWidth) return;
    ol.scrollLeft = Math.max(0, li.offsetLeft - ol.offsetLeft - 8);
  }, [currentPhase]);
  if (!steps.length) return null;
  return (
    <ol ref={list} aria-label="Průběh obchodu" className={cn("-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 scrollbar-thin", className)}>
      {steps.map((st) => (
        <li
          key={st.phase}
          aria-current={st.current ? "step" : undefined}
          className={cn(
            "flex min-w-0 shrink-0 flex-col gap-0.5 rounded-lg border px-2.5 py-1.5",
            st.current ? "border-foreground/20 bg-background shadow-sm" : st.done ? "bg-background/60" : "border-dashed opacity-60",
            st.skipped && "bg-transparent",
          )}
        >
          <span className={cn("inline-flex items-center gap-1 text-xs font-medium", !st.done && !st.current && "text-muted-foreground")}>
            {st.done && <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" aria-hidden />}
            {st.label}
            {st.done && <span className="sr-only"> — hotovo</span>}
            {st.skipped && <span className="font-normal"> · přeskočena</span>}
          </span>
          {st.current && st.chip ? <FlowStatusChip chip={st.chip} size="xs" /> : null}
          {(st.done || st.current) && st.stamp ? <ActorStamp stamp={st.stamp} short className="max-w-[12rem]" /> : null}
        </li>
      ))}
    </ol>
  );
}
