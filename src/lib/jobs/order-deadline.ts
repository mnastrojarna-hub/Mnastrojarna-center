import type { ExtractedBusinessDoc } from "@/lib/jobs/capture-types";
import {
  addLeadTime, czDate, hasLeadCue, isLeadBlocked, isRealisticDueDate, leadAmountText, leadOfExtracted, leadText, mentionsLead, parseLeadTime, parseYmd, pragueToday,
  type LeadBlocked, type LeadTime,
} from "@/lib/jobs/lead-time";

/**
 * Termín objednávky z nabídky (čistá logika, majitel): „Když zákazník nemá na objednávce termín, který je
 * realistický (v budoucnosti, ne stejný jako datum objednávky), anebo chybí, ber vždycky termín z nabídky —
 * tam bývá třeba 4 týdny, bere se od data objednání." Reálný termín objednávky se nikdy nepřepisuje
 * (jen upozornění, liší-li se od nabídky). Bez naší nabídky poptávka zákazníka (požadovaný termín), pak nic.
 */

/** Dodací podmínky naší nabídky (doklad z dávky, dříve uložený doklad, nebo nabídka v systému). */
export interface QuoteTerms {
  /** „NAB-6", „136/026" */
  number: string;
  /** Nabídka je už v systému (quotes / dříve uložený doklad zakázky). */
  inSystem: boolean;
  /** Absolutní termín z nabídky (RRRR-MM-DD, "" = neuveden). */
  date: string;
  /** Dodací podmínky — gramatika v režimu dodacího pole (navíc holá doba, je-li to celé pole: „4 týdny"). */
  texts: string[];
  /** Poznámka, popisy položek, shrnutí — gramatika ve volném textu (jen klauzule s kotvou „dodací lhůta / Lieferzeit…"). */
  notes?: string[];
  /** quotes.lead_time_days (kalendářní dny), null = neuvedeno — má přednost před vším. */
  leadTimeDays?: number | null;
  /**
   * Strukturovaná dodací lhůta z AI (deliveryLeadTime) — hned po lead_time_days. Blok (AI: běží od něčeho
   * jiného; text pole odmítnutý záporným filtrem) = u této nabídky nečíst dodací podmínky ani poznámky.
   */
  structured?: LeadTime | LeadBlocked | null;
  /** Doklad dávky (zdroj pole), jinak null. */
  docId?: string | null;
}

/** Požadovaný termín z poptávky zákazníka. */
export interface InquiryTerms {
  number: string;
  date: string;
  texts: string[];
  /** Poznámka, popisy položek — gramatika ve volném textu. */
  notes?: string[];
  docId?: string | null;
}

/** Termín nabídky jen jako konkrétní datum, které už uplynulo / je před objednávkou (bez lhůty). */
export interface StaleQuoteDate {
  number: string;
  date: string;
  docId: string | null;
  why: "before_order" | "past";
}

export interface DeadlineProposal {
  /** RRRR-MM-DD */
  date: string;
  from: "quote" | "inquiry";
  number: string;
  docId: string | null;
  /** „z nabídky NAB-6 (4 týdny od objednání → 20. 11. 2026)" */
  label: string;
  /** „4 týdny od objednání → 20. 11. 2026" */
  detail: string;
  lead: LeadTime | null;
  /** Termín vychází do minulosti (stará objednávka) — jen upozornit. */
  past: boolean;
  /** Termín odvozený z textu (nebo AI nesedí s textem) — ukázat ke kontrole, nikdy plná automatika. */
  review: boolean;
}

export type UnrealisticReason = "missing" | "same_as_order" | "before_order" | "past" | "too_far";

export interface OrderDeadline {
  /** Termín objednávky je reálný (pak se nic nenavrhuje). */
  realistic: boolean;
  /** Termín objednávky (hlavička, jinak nejbližší reálný termín položky). */
  current: string;
  /** Termín vzat z položek objednávky (hlavička bez reálného termínu). */
  fromItems: boolean;
  reason: UnrealisticReason | null;
  proposal: DeadlineProposal | null;
  /** Reálný termín objednávky se liší od nabídky — jen informace. */
  differs: string | null;
  /** Bez návrhu: nabídka má jen datum v minulosti / před objednávkou („doplň termín"). */
  staleQuote?: StaleQuoteDate | null;
}

const REASON_TEXT: Record<UnrealisticReason, string> = {
  missing: "chybí",
  same_as_order: "stejný jako datum objednávky",
  before_order: "před datem objednávky",
  past: "už uplynul",
  too_far: "nereálně daleko",
};

export function unrealisticText(r: UnrealisticReason): string {
  return REASON_TEXT[r];
}

function reasonOf(due: string, orderDate: string, today: string): UnrealisticReason {
  const d = parseYmd(due);
  if (!d) return "missing";
  const o = parseYmd(orderDate);
  if (o && d.getTime() === o.getTime()) return "same_as_order";
  if (o && d.getTime() < o.getTime()) return "before_order";
  const t = parseYmd(today);
  if (t && d.getTime() < t.getTime()) return "past";
  return "too_far";
}

function clean(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

/** Jako clean, ale zachová konce řádků — nový řádek je pro gramatiku hranice klauzule (jeden údaj na řádek). */
function cleanLines(s: string | null | undefined): string {
  return (s ?? "").replace(/\r\n?/g, "\n").replace(/[^\S\n]+/g, " ").replace(/ ?\n\s*/g, "\n").trim();
}

/**
 * Podmínky naší nabídky z vytěženého dokladu. Pole AI, které se nepoužije (bez hodnoty / bez „od" a s textem,
 * který gramatika nepřijme), se čte jako další dodací pole (svým textem).
 */
export function quoteTermsOfDoc(doc: ExtractedBusinessDoc, number: string, opts: { inSystem?: boolean; docId?: string | null } = {}): QuoteTerms {
  const itemDates = doc.items.map((i) => i.deliveryDate).filter((x) => parseYmd(x)).sort();
  const structured = leadOfExtracted(doc.deliveryLeadTime);
  return {
    number: clean(number || doc.documentNumber || doc.ourQuoteNumber),
    inSystem: opts.inSystem === true,
    date: parseYmd(doc.promisedDeliveryDate) ? doc.promisedDeliveryDate : itemDates[itemDates.length - 1] ?? "",
    texts: [structured ? "" : doc.deliveryLeadTime?.text ?? "", doc.deliveryTerms].map(cleanLines).filter(Boolean),
    notes: [doc.note, ...doc.items.map((i) => i.description), doc.summary].map(cleanLines).filter(Boolean),
    structured,
    docId: opts.docId ?? null,
  };
}

/** Požadovaný termín poptávky zákazníka z vytěženého dokladu. */
export function inquiryTermsOfDoc(doc: ExtractedBusinessDoc, number: string, docId: string | null = null): InquiryTerms {
  const itemDates = doc.items.map((i) => i.deliveryDate).filter((x) => parseYmd(x)).sort();
  return {
    number: clean(number || doc.documentNumber || doc.customerInquiryNumber),
    date: parseYmd(doc.requiredDeliveryDate) ? doc.requiredDeliveryDate : itemDates[0] ?? "",
    texts: [doc.deliveryTerms].map(cleanLines).filter(Boolean),
    notes: [doc.note, ...doc.items.map((i) => i.description)].map(cleanLines).filter(Boolean),
    docId,
  };
}

/** Nabídka v systému (quotes): dodací podmínky, poznámka, lhůta ve dnech. */
export function quoteTermsOfQuote(q: { number: string; leadTimeDays: number | null; deliveryTerms: string | null; note: string | null }): QuoteTerms {
  return {
    number: clean(q.number), inSystem: true, date: "",
    texts: [q.deliveryTerms ?? ""].map(cleanLines).filter(Boolean),
    notes: [q.note ?? ""].map(cleanLines).filter(Boolean),
    leadTimeDays: q.leadTimeDays,
  };
}

/** Lhůta z poznámky / popisu položky / shrnutí = gramatika ve volném textu (jen klauzule s dodací kotvou). */
export function parseLeadTimeInContext(text: string): LeadTime | null {
  return parseLeadTime(text, { mode: "free-text" });
}

/** Gramatické lhůty z dodacích podmínek (dodací pole) a poznámek (volný text), v pořadí. */
function textLeads(t: Pick<QuoteTerms, "texts" | "notes">): LeadTime[] {
  const out: LeadTime[] = [];
  for (const text of t.texts) {
    const lead = parseLeadTime(text, { mode: "delivery-field" });
    if (lead) out.push(lead);
  }
  for (const text of t.notes ?? []) {
    const lead = parseLeadTimeInContext(text);
    if (lead) out.push(lead);
  }
  return out;
}

/**
 * Lhůta nabídky — první zdroj s hodnotou vyhraje: quotes.lead_time_days (> 0, náš systém) → strukturovaná
 * dodací lhůta z AI (deliveryLeadTime) → dodací podmínky (gramatika, dodací pole) → poznámka / položky /
 * shrnutí (gramatika, volný text). Zablokované pole AI („jine", odmítnutý text) = null, bez propadu na text.
 * review: lhůta z TEXTU vždy; lhůta z AI, když text nabídky (pole AI / dodací podmínky / poznámka) čte jinou
 * hodnotu, nebo kterýkoli dodací text o lhůtě (číslo / kotva — ne „EXW Vimperk") gramatika nepřečte stejně
 * (podmíněná lhůta „…, resp. od uhrazení zálohy" = null ≠ AI), totéž poznámka s dodací kotvou a dobou, nebo
 * dodací text existuje a nic se nepřečte.
 * lead_time_days nikdy.
 */
export function leadOfTerms(t: Pick<QuoteTerms, "texts" | "leadTimeDays" | "notes" | "structured">): LeadTime | null {
  const n = Number(t.leadTimeDays);
  if (t.leadTimeDays != null && Number.isFinite(n) && n > 0 && n < 3 * 365) {
    return { days: Math.round(n), unit: "kalendarni", from: null, text: `${Math.round(n)} dní`, source: "system", review: false };
  }
  if (isLeadBlocked(t.structured)) return null;
  const leads = textLeads(t);
  const s = t.structured;
  if (s && s.days > 0) {
    const same = (l: LeadTime | null) => Boolean(l && l.days === s.days && l.unit === s.unit);
    const differs = leads.some((l) => !same(l));
    // každý dodací text zvlášť: mluví o lhůtě a gramatika z něj čte nic / jinou hodnotu → člověk
    const textDisagrees = t.texts.some((text) => hasLeadCue(text) && !same(parseLeadTime(text, { mode: "delivery-field" })));
    // poznámka / shrnutí / položka mluví o dodací lhůtě (kotva + doba) a gramatika ji nečte stejně → člověk
    const noteDisagrees = (t.notes ?? []).some((text) => mentionsLead(text) && !same(parseLeadTimeInContext(text)));
    const evidence = s.evidence ?? "none";
    const review = evidence === "conflict" || differs || textDisagrees || noteDisagrees || (evidence === "none" && !leads.length && t.texts.length > 0);
    return { ...s, source: "ai", review };
  }
  // Z textu: první úroveň s lhůtou (dodací podmínky, jinak poznámka / položky / shrnutí); různé lhůty na téže
  // úrovni (položka 1 „2 týdny", položka 2 „6 týdnů") = nejednoznačné → nic, člověk doplní.
  const fieldLeads = t.texts.map((text) => parseLeadTime(text, { mode: "delivery-field" })).filter((l): l is LeadTime => Boolean(l));
  const level = fieldLeads.length ? fieldLeads : (t.notes ?? []).map(parseLeadTimeInContext).filter((l): l is LeadTime => Boolean(l));
  if (!level.length) return null;
  if (level.some((l) => l.days !== level[0].days || l.unit !== level[0].unit)) return null;
  return { ...level[0], source: "text", review: true };
}

/** „Termín odvozen z textu nabídky „Dodací lhůta 4 týdny“ — zkontroluj." (null = bez kontroly). */
export function leadReviewNote(p: Pick<DeadlineProposal, "lead" | "from" | "review">): string | null {
  if (!p.review || !p.lead) return null;
  const what = p.from === "quote" ? "nabídky" : "poptávky";
  if (p.lead.source === "ai") return `Dodací lhůta přečtená AI („${p.lead.text}“) nesedí s textem ${what} — zkontroluj termín.`;
  return `Termín odvozen z textu ${what} „${p.lead.text}“ — zkontroluj.`;
}

/** Termín objednávky: hlavička, jinak (není-li reálná) nejbližší reálný termín položky. */
function orderCurrent(doc: Pick<ExtractedBusinessDoc, "requiredDeliveryDate" | "items">, orderDate: string, today: string): { date: string; fromItems: boolean } {
  const head = clean(doc.requiredDeliveryDate);
  if (isRealisticDueDate(head, orderDate, today)) return { date: head, fromItems: false };
  const items = doc.items.map((i) => clean(i.deliveryDate)).filter((x) => isRealisticDueDate(x, orderDate, today)).sort();
  if (items.length) return { date: items[0], fromItems: true };
  return { date: head || doc.items.map((i) => clean(i.deliveryDate)).find(Boolean) || "", fromItems: false };
}

function suffix(inSystem: boolean): string {
  return inSystem ? " v systému" : "";
}

/** Termín z jedné nabídky (absolutní reálné datum, jinak lhůta od data objednávky / dneška). */
function fromQuote(q: QuoteTerms, orderDate: string, today: string): DeadlineProposal | null {
  const label = (detail: string) => `z nabídky ${q.number}${suffix(q.inSystem)} (${detail})`.replace("nabídky  ", "nabídky ");
  if (q.date && isRealisticDueDate(q.date, orderDate, today)) {
    const detail = `termín ${czDate(q.date)}`;
    return { date: q.date, from: "quote", number: q.number, docId: q.docId ?? null, label: label(detail), detail, lead: null, past: false, review: false };
  }
  const lead = leadOfTerms(q);
  if (!lead) return null;
  const base = parseYmd(orderDate) ? orderDate : today;
  const date = addLeadTime(base, lead);
  if (!date) return null;
  const detail = `${parseYmd(orderDate) ? leadText(lead) : `${leadAmountText(lead)} od dneška (objednávka bez data)`} → ${czDate(date)}`;
  return { date, from: "quote", number: q.number, docId: q.docId ?? null, label: label(detail), detail, lead, past: date < today, review: lead.review === true };
}

function fromInquiry(inq: InquiryTerms, orderDate: string, today: string): DeadlineProposal | null {
  const label = (detail: string) => `z poptávky${inq.number ? ` ${inq.number}` : ""} (${detail})`;
  if (inq.date && isRealisticDueDate(inq.date, orderDate, today)) {
    const detail = `požadovaný termín ${czDate(inq.date)}`;
    return { date: inq.date, from: "inquiry", number: inq.number, docId: inq.docId ?? null, label: label(detail), detail, lead: null, past: false, review: false };
  }
  const lead = leadOfTerms({ texts: inq.texts, notes: inq.notes });
  if (!lead) return null;
  const base = parseYmd(orderDate) ? orderDate : today;
  const date = addLeadTime(base, lead);
  if (!date) return null;
  const detail = `${leadText(lead)} → ${czDate(date)}`;
  return { date, from: "inquiry", number: inq.number, docId: inq.docId ?? null, label: label(detail), detail, lead, past: date < today, review: lead.review === true };
}

/**
 * Termín objednávky zákazníka: reálný → beze změny (jen info o rozdílu proti nabídce); jinak z naší nabídky
 * (první s termínem / lhůtou), bez ní z poptávky zákazníka, jinak nic.
 */
export function orderDeadline(input: {
  order: Pick<ExtractedBusinessDoc, "requiredDeliveryDate" | "documentDate" | "items">;
  quotes: QuoteTerms[];
  inquiry?: InquiryTerms | null;
  today?: string;
}): OrderDeadline {
  const today = input.today ?? pragueToday();
  const orderDate = parseYmd(input.order.documentDate) ? input.order.documentDate : "";
  const cur = orderCurrent(input.order, orderDate, today);
  if (isRealisticDueDate(cur.date, orderDate, today)) {
    let differs: string | null = null;
    for (const q of input.quotes) {
      const p = fromQuote(q, orderDate, today);
      if (!p) continue;
      if (p.date !== cur.date) differs = `Termín objednávky ${czDate(cur.date)} se liší od nabídky ${q.number} (${p.detail}) — platí objednávka.`;
      break;
    }
    return { realistic: true, current: cur.date, fromItems: cur.fromItems, reason: null, proposal: null, differs };
  }
  const reason = reasonOf(cur.date, orderDate, today);
  let proposal: DeadlineProposal | null = null;
  for (const q of input.quotes) {
    proposal = fromQuote(q, orderDate, today);
    if (proposal) break;
  }
  if (!proposal && input.inquiry) proposal = fromInquiry(input.inquiry, orderDate, today);
  let staleQuote: StaleQuoteDate | null = null;
  if (!proposal) {
    // nabídka jen s konkrétním datem, které uplynulo / je před objednávkou → upozornit „doplň termín"
    const q = input.quotes.find((x) => parseYmd(x.date));
    if (q) {
      const before = Boolean(orderDate) && q.date <= orderDate;
      if (before || q.date < today) staleQuote = { number: q.number, date: q.date, docId: q.docId ?? null, why: before ? "before_order" : "past" };
    }
  }
  return { realistic: false, current: cur.date, fromItems: false, reason, proposal, differs: null, staleQuote };
}

/** „Termín nabídky NAB-6 (15. 10. 2026) je před datem objednávky — doplň termín zakázky." */
export function staleQuoteMessage(s: StaleQuoteDate): string {
  return `Termín nabídky ${s.number} (${czDate(s.date)}) ${s.why === "before_order" ? "je před datem objednávky" : "už uplynul"} — doplň termín zakázky.`;
}

/**
 * „Objednávka nemá reálný termín (chybí) — převzat z nabídky NAB-6 (4 týdny od objednání → 20. 11. 2026)."
 * Termín z textu: + „Termín odvozen z textu nabídky „…“ — zkontroluj."
 */
export function deadlineMessage(d: OrderDeadline): string | null {
  if (!d.proposal || !d.reason) return null;
  const past = d.proposal.past ? " Pozor: i tento termín už uplynul — zkontroluj ho." : "";
  const review = leadReviewNote(d.proposal);
  return `Objednávka nemá reálný termín (${unrealisticText(d.reason)}) — převzat ${d.proposal.label}.${past}${review ? ` ${review}` : ""}`;
}
