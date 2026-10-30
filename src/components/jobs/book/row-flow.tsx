"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { NextActionButton } from "@/components/flow-status/next-action-button";
import { ProposalChip } from "@/components/flow-status/proposal-chip";
import { canUndoDirect, decideProposal, isDirectAction, runDirectAction, undoDirectAction } from "@/components/jobs/flow-direct";
import { FLOW_ACTIONS, type ChangeStamp, type FlowActionKey, type PaletteKey } from "@/lib/jobs/flow-status";
import type { FlowProposal, OrderDocStatus } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";
import { useSettledRefresh } from "@/components/jobs/use-settled-refresh";
import { ProductionHandoffDialog } from "@/components/jobs/production/handoff/handoff-dialog";
import type { HandoffKind } from "@/lib/jobs/production-handoff-types";

/**
 * Klientské ostrůvky řádku / karty Knihy: tlačítko dalšího kroku (sloveso) a návrh změny s ✓ / ✕.
 * Přímé akce se provedou na místě (s „Vrátit", kde to jde), akce s dialogem otevřou kartu
 * zakázky rovnou s tím dialogem (?akce=…).
 */
export function RowNextAction({
  jobId, action, quoteId, quoteUpdatedAt, reopenOrderTo, waitingNote, palette, className,
}: {
  jobId: string;
  action: { key: FlowActionKey; label: string } | null;
  quoteId?: string | null;
  /** updated_at aktivní nabídky z načtené Knihy — „Schválit“ projde jen nezměněná nabídka. */
  quoteUpdatedAt?: string | null;
  reopenOrderTo?: OrderDocStatus;
  waitingNote?: string | null;
  palette?: PaletteKey;
  className?: string;
}) {
  const router = useRouter();
  // otisk dalšího kroku: po přímé akci se musí změnit (jinak pojistka stránku načte znovu)
  const settle = useSettledRefresh(250, `${jobId}:${action?.key ?? "-"}`);
  const [handoff, setHandoff] = React.useState<{ kind?: HandoffKind; replan?: boolean } | null>(null);
  if (!action || action.key === "proposal.decide") return null;
  const ctx = { jobId, quoteId, reopenOrderTo, waitingNote, expectedUpdatedAt: quoteUpdatedAt ?? null };
  const direct = FLOW_ACTIONS[action.key].kind === "direct" && isDirectAction(action.key);
  return (
    <span title={action.label} className="inline-flex">
      <NextActionButton
        action={action}
        jobId={jobId}
        palette={palette}
        size="sm"
        className={cn("h-11 gap-1.5 px-3 text-xs sm:h-9", className)}
        onRun={async (key) => {
          // předání do výroby: dialog rovnou na řádku (kdo + termín), bez přechodu na kartu zakázky
          const kind = HANDOFF_KIND_OF[key];
          if (kind !== undefined) {
            setHandoff({ kind: kind ?? undefined, replan: key === "production.replan" });
            return { ok: true };
          }
          if (!direct) {
            router.push(`/orders/${jobId}?akce=${encodeURIComponent(key)}`);
            return { ok: true };
          }
          const res = await runDirectAction(key, ctx);
          if (res?.needsConfirm) {
            // převzetí od jiného řešitele potvrdí karta zakázky
            router.push(`/orders/${jobId}?akce=${encodeURIComponent(key)}`);
            return { ok: true };
          }
          if (res?.ok) settle();
          return res ?? { ok: false, error: "Akci nejde provést." };
        }}
        onUndo={direct && canUndoDirect(action.key) ? async (key) => {
          const res = await undoDirectAction(key, ctx);
          if (res.ok) settle();
          return res;
        } : undefined}
      />
      {handoff && (
        <ProductionHandoffDialog
          open
          onOpenChange={(o) => { if (!o) setHandoff(null); }}
          jobId={jobId}
          kind={handoff.kind}
          replan={handoff.replan}
          onDone={() => settle()}
        />
      )}
    </span>
  );
}

/** Akce předání do výroby → druh dialogu (null = odvodí server: předání / doplnění / další krok). */
const HANDOFF_KIND_OF: Partial<Record<FlowActionKey, HandoffKind | null>> = {
  "production.handoff": null,
  "production.advance": "dalsi_krok",
  "production.finish": "ukonceni",
  "production.replan": "plan",
  "production.undo": "zpet",
};

/** Návrh změny v řádku: „Návrh: Odmítnout — Kapacita · Pavel Dílna" + ✓ / ✕ pro toho, kdo smí rozhodnout. */
export function RowProposal({
  jobId, proposal, stamp, canDecide, className,
}: {
  jobId: string;
  proposal: FlowProposal;
  stamp?: ChangeStamp | null;
  canDecide: boolean;
  className?: string;
}) {
  const settle = useSettledRefresh(250, `${jobId}:${proposal.phase}:${proposal.to}:${stamp?.at ?? ""}`);
  return (
    <ProposalChip
      proposal={proposal}
      stamp={stamp}
      canDecide={canDecide}
      className={className}
      onDecide={async (accept) => {
        const res = await decideProposal(jobId, accept);
        if (res.ok) settle();
        return res;
      }}
    />
  );
}
