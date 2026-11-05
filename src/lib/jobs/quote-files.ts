import type { JobFile, JobQuote } from "@/lib/jobs/types";

/**
 * Nabídka ↔ její PDF v Dokumentech (job_files.quote_id) — jedna pravidla pro obě záložky karty
 * zakázky (Nabídky, Dokumenty) i server (deleteJobFile / deleteJobQuote). Smazání na jedné straně
 * se projeví na druhé („smaže se i PDF v Dokumentech" / „smaže se i nabídka NAB-…"):
 *  - k nabídce patří jen naše VYSTAVENÉ PDF (kind nabidka, origin generated); nahraný / vyfocený
 *    doklad s vazbou na nabídku je příloha — nabídku nemaže a při smazání nabídky se jen odpojí;
 *  - smazání posledního vystaveného PDF nabídky smaže i nabídku (s položkami); smazání starší verze
 *    PDF (v1 vedle v2, nebo v2 s obnovením v1) nabídku nechá;
 *  - smazání nabídky smaže všechna její vystavená PDF (všechny verze, z úložiště i z Dokumentů);
 *  - odeslanou nabídku (sent_at / odesláno / přijato) nejde smazat ani přes její PDF — jen archivovat
 *    (stejné pravidlo jako menu Nabídky: „Smazat" jen bez sent_at).
 */

export type QuoteFileRef = Pick<JobFile, "id" | "kind" | "origin" | "quoteId">;
export type QuoteRef = Pick<JobQuote, "id" | "number" | "sentAt" | "status">;

/** Naše vystavené PDF nabídky (generateJobDocument) — ne nahraný / vyfocený doklad s vazbou. */
export function isOurQuotePdf(f: Pick<JobFile, "kind" | "origin" | "quoteId">): boolean {
  return f.kind === "nabidka" && f.origin === "generated" && Boolean(f.quoteId);
}

/** Nabídka už šla zákazníkovi (odeslaná / s připomínkami / přijatá) — smazat nejde, jen archivovat. */
export function quoteIsSent(q: Pick<JobQuote, "sentAt" | "status">): boolean {
  return Boolean(q.sentAt) || q.status === "odeslano" || q.status === "prijato";
}

export const QUOTE_SENT_DELETE_BLOCK = "Odeslanou nabídku nejde smazat — archivuj ji, nebo ji nech zamítnout.";

export function quotePdfSentBlock(number: string | null): string {
  return `PDF nabídky${number ? ` ${number}` : ""} nejde smazat — nabídka už byla zákazníkovi odeslána. Archivuj ho, nebo vystav novou verzi.`;
}

/** Ostatní vystavená PDF téže nabídky (jiné verze) — po smazání `file` zůstanou. */
export function otherQuotePdfs<T extends QuoteFileRef>(file: Pick<JobFile, "id" | "quoteId">, all: T[]): T[] {
  return all.filter((f) => f.id !== file.id && f.quoteId === file.quoteId && isOurQuotePdf(f));
}

export type FileDeletePlan =
  /** Soubor bez vazby na nabídku (nebo příloha) — maže se jen on. */
  | { kind: "file" }
  /** PDF odeslané nabídky — smazat nejde. */
  | { kind: "blocked"; quote: QuoteRef; reason: string }
  /** Nabídka má ještě jiné verze PDF — zůstane. */
  | { kind: "quoteStays"; quote: QuoteRef; others: number }
  /** Poslední PDF nabídky — smaže se i nabídka. */
  | { kind: "quoteGoes"; quote: QuoteRef };

/** Co se stane při smazání dokumentu v Dokumentech (text potvrzení; server rozhoduje znovu z DB). */
export function fileDeletePlan(file: QuoteFileRef, all: QuoteFileRef[], quotes: QuoteRef[]): FileDeletePlan {
  if (!isOurQuotePdf(file)) return { kind: "file" };
  const quote = quotes.find((q) => q.id === file.quoteId);
  // vazba na nabídku, která už není (smazaná jinde) — jen soubor
  if (!quote) return { kind: "file" };
  if (quoteIsSent(quote)) return { kind: "blocked", quote, reason: quotePdfSentBlock(quote.number) };
  const others = otherQuotePdfs(file, all).length;
  return others ? { kind: "quoteStays", quote, others } : { kind: "quoteGoes", quote };
}

export interface QuoteDeletePlan {
  /** Důvod, proč nabídku smazat nejde (odeslaná). */
  blocked: string | null;
  /** Vystavená PDF (všechny verze), která se smažou s ní. */
  pdfs: number;
  /** Nahrané soubory s vazbou — zůstanou v Dokumentech bez vazby. */
  linked: number;
}

/** Co se stane při smazání nabídky v Nabídkách (text potvrzení). */
export function quoteDeletePlan(quote: QuoteRef, files: QuoteFileRef[]): QuoteDeletePlan {
  const mine = files.filter((f) => f.quoteId === quote.id);
  return {
    blocked: quoteIsSent(quote) ? QUOTE_SENT_DELETE_BLOCK : null,
    pdfs: mine.filter(isOurQuotePdf).length,
    linked: mine.filter((f) => !isOurQuotePdf(f)).length,
  };
}

/** „2 verze" / „5 verzí" (české skloňování). */
export function pdfVersionsText(n: number): string {
  return `${n} ${n === 1 ? "verze" : n >= 2 && n <= 4 ? "verze" : "verzí"}`;
}
