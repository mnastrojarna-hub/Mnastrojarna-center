import { buildExistingTarget, buildNewTarget, type ReviewTarget } from "@/lib/jobs/capture-review";
import { DROP_REASONS, groupDeadlineOf } from "@/lib/jobs/capture-batch-reconcile";
import { docFieldValues, planJobUpdate, planNewJob } from "@/lib/jobs/apply-extraction";
import type { QuoteTerms } from "@/lib/jobs/order-deadline";
import type { ExtractedBusinessDoc } from "@/lib/jobs/capture-types";
import type { JobDetail } from "@/lib/jobs/types";

/** Část relace jednoho dokladu, kterou potřebuje návrh cíle. */
export interface SingleDocSession {
  aiUsed: boolean;
  doc: ExtractedBusinessDoc;
}

/**
 * Termín jednoho dokladu (jedna fotka objednávky = tok analyzeSingle), čistá logika sdílená s dávkou:
 * objednávka zákazníka bez reálného termínu → termín z naší nabídky zakázky v systému (lhůta od data objednávky).
 */
export interface SingleOrderDeadline {
  /** Navržený termín (RRRR-MM-DD), "" = žádný. */
  date: string;
  /** Text upozornění do „needsClarification". */
  message: string;
  /** Termín objednávky (= datum objednávky / před ním) se neuloží — pole zůstane prázdné. */
  drop: boolean;
}

function isCustomerOrder(doc: ExtractedBusinessDoc): boolean {
  return doc.docKind === "objednavka" && doc.issuer !== "my" && doc.issuer !== "dodavatel";
}

/**
 * Stejné pravidlo jako applyGroupDeadline v dávce: reálný termín objednávky = beze změny (null, nebo jen info
 * o rozdílu proti nabídce); bez reálného termínu návrh z naší nabídky; termín = datum objednávky / před ním
 * a nabídka s lhůtou chybí → drop (pole prázdné, varování „doplň termín", žádná plná automatika).
 * Volá se VŽDY u objednávky zákazníka, i bez nabídky (jedna fotka objednávky k nové zakázce).
 */
export function singleOrderDeadline(doc: ExtractedBusinessDoc, quoteTerms: QuoteTerms[] | undefined, today?: string): SingleOrderDeadline | null {
  if (!isCustomerOrder(doc)) return null;
  const d = groupDeadlineOf(doc, quoteTerms ?? [], null, null, { today });
  if (d.result.proposal) return { date: d.result.proposal.date, message: d.warnings[0]?.message ?? d.result.proposal.label, drop: false };
  if (d.result.differs) return { date: "", message: d.result.differs, drop: false };
  if (!d.result.realistic && d.result.reason && DROP_REASONS.includes(d.result.reason)) {
    return { date: "", message: d.warnings[0]?.message ?? "Objednávka nemá reálný termín — termín se neuloží, doplň termín zakázky.", drop: true };
  }
  return null;
}

/** Doklad pro plán zakázky: nereálný termín (= datum objednávky / před ním) bez návrhu se nepřenese. */
function planDoc(doc: ExtractedBusinessDoc, dl: SingleOrderDeadline | null): ExtractedBusinessDoc {
  return dl?.drop ? { ...doc, requiredDeliveryDate: "" } : doc;
}

export function singleExistingTarget(
  job: JobDetail, session: SingleDocSession, margins: boolean, reason: string | null, score: number | null,
  quoteTerms?: QuoteTerms[], today?: string,
): ReviewTarget {
  const dl = session.aiUsed ? singleOrderDeadline(session.doc, quoteTerms, today) : null;
  const doc = planDoc(session.doc, dl);
  let plan = session.aiUsed ? planJobUpdate(job, doc) : null;
  let docValues = session.aiUsed ? docFieldValues(doc) : undefined;
  if (plan && dl?.date) {
    // požadovaný termín = termín, na který zákazník nabídkou přistoupil; potvrzený = náš z nabídky (jen prázdné)
    const patch = { ...plan.patch } as Record<string, unknown>;
    if (!job.customerRequiredDate) patch.customerRequiredDate = dl.date;
    if (!job.dueDate) patch.dueDate = dl.date;
    plan = { ...plan, patch: patch as typeof plan.patch };
    if (docValues) docValues = { ...docValues, customerRequiredDate: dl.date };
  }
  return buildExistingTarget({ job, plan, docValues, reason, score, margins });
}

export function singleNewTarget(session: SingleDocSession, margins: boolean, today?: string): ReviewTarget {
  const dl = session.aiUsed ? singleOrderDeadline(session.doc, [], today) : null;
  return buildNewTarget({
    plan: session.aiUsed ? planNewJob(planDoc(session.doc, dl)) : null,
    margins,
    docKind: session.doc.docKind,
    issuer: session.doc.issuer,
  });
}
