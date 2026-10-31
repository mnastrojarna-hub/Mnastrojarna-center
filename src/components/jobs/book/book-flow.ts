import type { Feature } from "@/lib/auth/permissions";
import type { JobListItem } from "@/lib/jobs/types";
import type { UserRole } from "@/lib/supabase/database.types";
import {
  deriveFlow, nextAction, primaryChip, quoteApprovalFlag, transitionFeature, type ActionCtx, type ChangeStamp,
  type FlowActionKey, type FlowSnapshot, type PhaseChip, type QuoteApprovalFlag, type QuoteApprover,
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
  /** Nabídky uživatele musí schválit super admin (profil, 31. 10.). */
  quoteNeedsApproval?: boolean;
  /** 31. 10.: schvalovatelé (ne super admin) — štítek „čeká na schválení (V. Volný nebo super admin)“. */
  quoteApprovers?: QuoteApprover[];
}

export function actionCtxOf(access: BookAccess | null | undefined, job?: Pick<JobListItem, "assignee"> & Partial<Pick<JobListItem, "owner">>): ActionCtx {
  const features = access?.features ?? [];
  return {
    can: (f) => features.includes(f),
    userId: access?.userId ?? "",
    isSuperAdmin: access?.role === "super_admin",
    assigneeId: job?.assignee?.id ?? null,
    assigneeName: job?.assignee?.name ?? null,
    ownerId: job?.owner?.id ?? null,
    quoteNeedsApproval: access?.quoteNeedsApproval,
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
  /**
   * #25: „Neschválená — čeká na schválení super admina“ / „Vráceno k přepracování“ za hlavním chipem
   * (v každé fázi; ne když hlavní chip už sám je „Neschválená“). Schválenou Kniha neoznačuje.
   */
  approval: QuoteApprovalFlag | null;
  /**
   * Hlavní chip je sám „Neschválená · NAB-…“ (fáze nabídky): řádek místo něj ukáže výrazný štítek
   * schválení s číslem (fialový chip by vypadal stejně jako „Schválená“).
   */
  chipIsApproval: boolean;
}

function sameStamp(a: ChangeStamp | null | undefined, b: ChangeStamp | null | undefined): boolean {
  return Boolean(a && b && a.at === b.at && (a.by?.id ?? null) === (b.by?.id ?? null));
}

export function rowFlowView(job: JobListItem, access?: BookAccess | null, today?: string): RowFlowView {
  if (!job.flow) {
    return {
      snapshot: null, chip: null, next: null, stamp: job.stamps?.stage ?? null, chipStamp: null, canDecideProposal: false,
      activeQuoteId: null, approval: null, chipIsApproval: false,
    };
  }
  const facts = { ...job.flow, stage: job.stage };
  const snapshot = deriveFlow(facts, job.flowQuotes ?? [], today);
  const chip = primaryChip(facts, snapshot, job.stamps ?? null);
  const ctx = actionCtxOf(access, job);
  const next = access ? nextAction(facts, snapshot, ctx) : null;
  const stamp = job.stamps?.stage ?? null;
  const chipStamp = chip && chip.phase !== "proposal" && chip.stamp && !sameStamp(chip.stamp, stamp) ? chip.stamp : null;
  const proposal = facts.proposal;
  const approval = rowApprovalFlag(job, access?.quoteApprovers);
  return {
    approval,
    chipIsApproval: approval?.kind === "pending" && isPendingQuoteChip(chip),
    snapshot,
    chip,
    next,
    stamp,
    chipStamp,
    canDecideProposal: Boolean(proposal && access && ctx.can(transitionFeature(proposal.phase, proposal.to))),
    activeQuoteId: snapshot.activeQuote?.id ?? null,
  };
}

/** Hlavní chip řádku je „Neschválená · NAB-…“ (stav nabídky ke_schvaleni). */
export function isPendingQuoteChip(chip: PhaseChip | null | undefined): boolean {
  return chip?.phase === "quote" && chip.key === "ke_schvaleni";
}

/**
 * Štítek schválení řádku Knihy (pending / returned; schválenou Kniha neoznačuje). Když je hlavní chip
 * sám „Neschválená“, řádek štítek ukáže MÍSTO chipu (`chipIsApproval`), jinak za ním.
 */
export function rowApprovalFlag(job: Pick<JobListItem, "flowQuotes">, approvers?: readonly QuoteApprover[] | null): QuoteApprovalFlag | null {
  const flag = quoteApprovalFlag(job.flowQuotes ?? [], null, approvers);
  if (!flag || flag.kind === "approved") return null;
  return flag;
}
