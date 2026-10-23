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

/**
 * Klientské ostrůvky řádku / karty Knihy: tlačítko dalšího kroku (sloveso) a návrh změny s ✓ / ✕.
 * Přímé akce se provedou na místě (s „Vrátit", kde to jde), akce s dialogem otevřou kartu
 * zakázky rovnou s tím dialogem (?akce=…).
 */
export function RowNextAction({
  jobId, action, quoteId, reopenOrderTo, waitingNote, palette, className,
}: {
  jobId: string;
  action: { key: FlowActionKey; label: string } | null;
  quoteId?: string | null;
  reopenOrderTo?: OrderDocStatus;
  waitingNote?: string | null;
  palette?: PaletteKey;
  className?: string;
}) {
  const router = useRouter();
  // otisk dalšího kroku: po přímé akci se musí změnit (jinak pojistka stránku načte znovu)
  const settle = useSettledRefresh(250, `${jobId}:${action?.key ?? "-"}`);
  if (!action || action.key === "proposal.decide") return null;
  const ctx = { jobId, quoteId, reopenOrderTo, waitingNote };
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
    </span>
  );
}

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
