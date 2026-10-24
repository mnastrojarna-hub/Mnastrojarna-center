import { approvedStampText, quoteApprovalFlag, type QuoteApprovalFlag, type QuoteFacts } from "@/lib/jobs/flow-status";
import type { JobQuote } from "@/lib/jobs/types";
import { returnedSuffix } from "@/components/flow/quote-approval-copy";

/**
 * Štítek schválení pro hlavičku karty zakázky (#25): čekající / vrácená verze, jinak schválená aktivní
 * nabídka s razítkem „Připravil(a) … · Schválil … · datum“ (jména z plných nabídek karty).
 */
export function jobApprovalFlag(
  flowQuotes: readonly QuoteFacts[] | null | undefined,
  quotes: readonly JobQuote[],
): { flag: QuoteApprovalFlag; suffix: string | null; at: string | null } | null {
  const flag = quoteApprovalFlag(flowQuotes ?? []);
  if (!flag) return null;
  const q = quotes.find((x) => x.id === flag.quoteId) ?? null;
  if (flag.kind === "approved") {
    // schválení bez nutnosti (nabídka super admina, AI v plné automatice) razítko nepotřebuje
    if (!q?.approvedBy || (!q.adminApprovalRequired && !q.aiGenerated)) return null;
    return {
      flag: { ...flag, label: approvedStampText(q.createdBy?.name ?? null, q.approvedBy.name ?? null, q.approvedAt) },
      suffix: null,
      at: q.approvedAt,
    };
  }
  if (flag.kind === "returned") {
    return { flag, suffix: returnedSuffix(q?.returnedBy?.name ?? null, q?.returnedAt ?? null), at: q?.returnedAt ?? null };
  }
  return { flag, suffix: null, at: null };
}

/**
 * Nápověda pod stavem karty, když nabídka čeká na super admina a uživatel nemá další krok
 * (popis fáze „Připravujeme cenu…“ by byl zavádějící — cena je hotová, čeká se na schválení).
 */
export function approvalHint(kind: QuoteApprovalFlag["kind"] | null | undefined): string | null {
  if (kind === "pending") return "Nabídka čeká na schválení super admina — pak ji půjde odeslat zákazníkovi.";
  if (kind === "returned") return "Nabídka je vrácená autorovi k přepracování — čeká na jeho úpravu.";
  return null;
}

/** Štítek neschválené / vrácené nabídky pro její kartu (volající ví, že je zobrazená jako „Neschválená“). */
export function quoteCardFlag(q: JobQuote): QuoteApprovalFlag | null {
  if (q.archived) return null;
  return quoteApprovalFlag([{
    id: q.id, number: q.number, revision: q.revision, status: q.status, state: "ke_schvaleni", approvedBy: q.approvedBy?.id ?? null,
    approvalRequired: q.approvalRequired ?? true, createdBy: q.createdBy?.id ?? null, archived: false, sentAt: q.sentAt,
    validUntil: q.validUntil, aiGenerated: q.aiGenerated, supersededBy: null, createdAt: q.createdAt,
    adminApprovalRequired: q.adminApprovalRequired, returnedAt: q.returnedAt ?? null, returnNote: q.returnNote ?? null, total: q.total,
  }]);
}

/** Razítko schválené nabídky pro kartu nabídky (null = nabídka schválení nepotřebovala nebo ho nemá). */
export function quoteApprovedStamp(q: JobQuote): string | null {
  if (!q.approvedBy) return null;
  if (!q.adminApprovalRequired && !q.aiGenerated && !q.approvalRequired) return null;
  return approvedStampText(q.createdBy?.name ?? null, q.approvedBy.name ?? null, q.approvedAt);
}
