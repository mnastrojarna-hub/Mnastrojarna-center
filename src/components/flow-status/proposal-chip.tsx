"use client";

import * as React from "react";
import { Check, Hand, Loader2, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { CHIP_BASE, CHIP_ICON, FLOW_PALETTE, actorName, lostReasonLabel, type ChangeStamp } from "@/lib/jobs/flow-status";
import type { FlowProposal } from "@/lib/supabase/database.types";

/**
 * „Duch" návrhu změny (zaměstnanec / AI navrhne, rozhodne člověk s právem):
 * „Návrh: Odmítnout (Kapacita) · Pavel Dílna" + ✓ / ✕ pro toho, kdo smí rozhodnout.
 */
export function ProposalChip({
  proposal, stamp, canDecide, onDecide, className,
}: {
  proposal: FlowProposal;
  stamp?: ChangeStamp | null;
  canDecide: boolean;
  onDecide?: (accept: boolean) => Promise<{ ok: boolean; error?: string } | void> | void;
  className?: string;
}) {
  const [pending, setPending] = React.useState<null | boolean>(null);
  const [error, setError] = React.useState<string | null>(null);
  const Icon = proposal.kind === "ai" ? Sparkles : Hand;
  const who = stamp ? actorName(stamp) : proposal.kind === "ai" ? "✨ AI" : null;
  const reason = proposal.reason ? lostReasonLabel(proposal.reason) : null;
  const text = `Návrh: ${proposal.label}`;

  async function decide(accept: boolean) {
    if (!onDecide || pending !== null) return;
    setPending(accept);
    setError(null);
    try {
      const res = await onDecide(accept);
      if (res && !res.ok) setError(res.error ?? "Nepodařilo se rozhodnout.");
    } finally {
      setPending(null);
    }
  }

  return (
    <span className={cn("inline-flex min-w-0 max-w-full flex-wrap items-center gap-1", className)}>
      {/* chip se v úzkém sloupci zkrátí (celý text v title), navrhovatel je vždy vidět na vlastním řádku */}
      <span
        className={cn(CHIP_BASE, "min-w-0 max-w-full", FLOW_PALETTE["ghost.proposal"].badge)}
        title={[text, reason && !proposal.label.includes(reason) ? `(${reason})` : null, proposal.note].filter(Boolean).join(" ")}
      >
        <Icon className={CHIP_ICON} aria-hidden />
        <span className="truncate">{text}</span>
        {reason && !proposal.label.includes(reason) && <span className="truncate font-normal">({reason})</span>}
      </span>
      {canDecide && onDecide && (
        <>
          <button
            type="button"
            onClick={() => decide(true)}
            disabled={pending !== null}
            aria-label={`Přijmout návrh: ${proposal.label}`}
            className="inline-flex size-9 items-center justify-center rounded-full border border-green-300 text-green-700 hover:bg-green-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 dark:border-green-500/40 dark:text-green-300 dark:hover:bg-green-500/10 sm:size-7"
          >
            {pending === true ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
          </button>
          <button
            type="button"
            onClick={() => decide(false)}
            disabled={pending !== null}
            aria-label={`Zamítnout návrh: ${proposal.label}`}
            className="inline-flex size-9 items-center justify-center rounded-full border border-border text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 sm:size-7"
          >
            {pending === false ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <X className="size-4" aria-hidden />}
          </button>
        </>
      )}
      {who && <span className="w-full truncate text-[11px] leading-4 text-muted-foreground">navrhuje: {who}</span>}
      {error && <span role="alert" className="w-full text-[11px] text-red-600 dark:text-red-400">{error}</span>}
    </span>
  );
}
