import type { Feature } from "@/lib/auth/permissions";
import type { JobListItem } from "@/lib/jobs/types";
import type { UserRole } from "@/lib/supabase/database.types";
import {
  deriveFlow, nextAction, primaryChip, transitionFeature, type ActionCtx, type ChangeStamp, type FlowActionKey,
  type FlowSnapshot, type PhaseChip,
} from "@/lib/jobs/flow-status";

/**
 * Řádek / karta Knihy: chip podle tabulky 1.11 (primaryChip), další krok (nextAction, sloveso)
 * a „kdo · kdy": pod hlavním stavem jen jeho autor, pod dílčím chipem autor dílčího stavu
 * (autor návrhu jen v chipu návrhu). Čistá logika (server i klient, testy v book-flow.test.ts).
 */

/** Přístup uživatele pro výpočet akcí na serveru (stránka ho předá řádkům). */
export interface BookAccess {
  features: Feature[];
  userId: string | null;
  role: UserRole | null;
}

export function actionCtxOf(access: BookAccess | null | undefined, job?: Pick<JobListItem, "assignee">): ActionCtx {
  const features = access?.features ?? [];
  return {
    can: (f) => features.includes(f),
    userId: access?.userId ?? "",
    isSuperAdmin: access?.role === "super_admin",
    assigneeId: job?.assignee?.id ?? null,
    assigneeName: job?.assignee?.name ?? null,
  };
}

export interface RowFlowView {
  snapshot: FlowSnapshot | null;
  chip: PhaseChip | null;
  next: { key: FlowActionKey; label: string } | null;
  /** Kdo posunul HLAVNÍ stav — text pod StageBadge na všech šířkách. */
  stamp: ChangeStamp | null;
  /** Kdo změnil dílčí stav chipu (jen když je to jiná změna než hlavní stav). */
  chipStamp: ChangeStamp | null;
  /** Smí uživatel rozhodnout čekající návrh (✓ / ✕)? */
  canDecideProposal: boolean;
  activeQuoteId: string | null;
}

function sameStamp(a: ChangeStamp | null | undefined, b: ChangeStamp | null | undefined): boolean {
  return Boolean(a && b && a.at === b.at && (a.by?.id ?? null) === (b.by?.id ?? null));
}

export function rowFlowView(job: JobListItem, access?: BookAccess | null, today?: string): RowFlowView {
  if (!job.flow) {
    return { snapshot: null, chip: null, next: null, stamp: job.stamps?.stage ?? null, chipStamp: null, canDecideProposal: false, activeQuoteId: null };
  }
  const facts = { ...job.flow, stage: job.stage };
  const snapshot = deriveFlow(facts, job.flowQuotes ?? [], today);
  const chip = primaryChip(facts, snapshot, job.stamps ?? null);
  const ctx = actionCtxOf(access, job);
  const next = access ? nextAction(facts, snapshot, ctx) : null;
  const stamp = job.stamps?.stage ?? null;
  const chipStamp = chip && chip.phase !== "proposal" && chip.stamp && !sameStamp(chip.stamp, stamp) ? chip.stamp : null;
  const proposal = facts.proposal;
  return {
    snapshot,
    chip,
    next,
    stamp,
    chipStamp,
    canDecideProposal: Boolean(proposal && access && ctx.can(transitionFeature(proposal.phase, proposal.to))),
    activeQuoteId: snapshot.activeQuote?.id ?? null,
  };
}
