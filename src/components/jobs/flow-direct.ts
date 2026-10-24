import { decideFlowProposal, setInquiryStatus, setOrderStatus, setQuoteState, takeInquiry } from "@/app/actions/flow-status";
import { newJobQuoteRevision } from "@/app/actions/jobs";
import type { FlowActionKey } from "@/lib/jobs/flow-status";
import type { OrderDocStatus } from "@/lib/supabase/database.types";

/**
 * Přímé akce dalšího kroku (jeden zápis, bez dialogu) — sdílí řádek Knihy, karta tabule
 * i karta zakázky. Vrací null, když akce přímá není (otevře se dialog / odkaz).
 */
export interface DirectCtx {
  jobId: string;
  /** Aktivní nabídka (akce quote.*). */
  quoteId?: string | null;
  /** Kam obnovit stornovanou objednávku (potvrzená, pokud už jednou potvrzená byla). */
  reopenOrderTo?: OrderDocStatus;
  /** Poznámka čekání na podklady (pro „Vrátit" u „Podklady máme"). */
  waitingNote?: string | null;
  /** Převzít i od jiného řešitele (po potvrzení). */
  force?: boolean;
  /**
   * updated_at nabídky, jak ji uživatel viděl — „Schválit“ projde jen nezměněná nabídka
   * (mezitím upravenou server odmítne „Nabídku mezitím někdo upravil…“). null = nevíme (stará data).
   */
  expectedUpdatedAt?: string | null;
}

export type DirectResult = { ok: boolean; error?: string; needsConfirm?: string };

const QUOTE_DIRECT: Partial<Record<FlowActionKey, "ke_schvaleni" | "schvalena" | "odeslana" | "prijata">> = {
  "quote.requestApproval": "ke_schvaleni",
  "quote.approve": "schvalena",
  "quote.answerNoChange": "odeslana",
  "quote.accept": "prijata",
  "quote.reopen": "odeslana",
};

/** Je akce přímá (lze ji provést bez dialogu)? */
export function isDirectAction(key: FlowActionKey): boolean {
  return key === "inquiry.take" || key === "inquiry.resume" || key === "inquiry.reopen" || key === "quote.newRevision"
    || key === "order.reopen" || key in QUOTE_DIRECT;
}

export async function runDirectAction(key: FlowActionKey, c: DirectCtx): Promise<DirectResult | null> {
  if (key === "inquiry.take") {
    const r = await takeInquiry(c.jobId, { force: c.force });
    return { ok: r.ok, error: r.error, needsConfirm: r.needsConfirm };
  }
  if (key === "inquiry.resume" || key === "inquiry.reopen") return setInquiryStatus(c.jobId, "v_reseni");
  if (key === "order.reopen") return setOrderStatus(c.jobId, c.reopenOrderTo ?? "dorucena");
  const q = QUOTE_DIRECT[key];
  if (q || key === "quote.newRevision") {
    if (!c.quoteId) return { ok: false, error: "Zakázka nemá aktivní nabídku." };
    if (key === "quote.newRevision") return newJobQuoteRevision(c.quoteId);
    if (key === "quote.approve") return setQuoteState(c.quoteId, "schvalena", { expectedUpdatedAt: c.expectedUpdatedAt ?? null });
    return setQuoteState(c.quoteId, q!);
  }
  return null;
}

/** „Vrátit" po přímé akci — jen tam, kde existuje povolený zpětný přechod. */
export function canUndoDirect(key: FlowActionKey): boolean {
  return key === "quote.approve" || key === "inquiry.resume";
}

export async function undoDirectAction(key: FlowActionKey, c: DirectCtx): Promise<DirectResult> {
  if (key === "quote.approve" && c.quoteId) return setQuoteState(c.quoteId, "rozpracovana");
  if (key === "inquiry.resume") {
    return setInquiryStatus(c.jobId, "ceka_na_podklady", { note: c.waitingNote?.trim() || "vráceno — podklady stále chybí" });
  }
  return { ok: false, error: "Tuto akci vrátit nejde." };
}

/** Rozhodnutí návrhu změny (✓ / ✕). */
export async function decideProposal(jobId: string, accept: boolean): Promise<DirectResult> {
  return decideFlowProposal(jobId, accept);
}
