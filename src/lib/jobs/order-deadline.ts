import type { ExtractedBusinessDoc } from "@/lib/jobs/capture-types";
import {
  addLeadTime, czDate, isByAgreement, isRealisticDueDate, leadAmountText, leadText, parseLeadTime, parseYmd, pragueToday, type LeadTime,
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
  /** Dodací podmínky — lhůta se čte bez dalšího („4 týdny od objednání"). */
  texts: string[];
  /** Poznámka, popisy položek, shrnutí — lhůta jen u kontextového slova („dodání 4 týdny", „Lieferzeit…"). */
  notes?: string[];
  /** quotes.lead_time_days (kalendářní dny), null = neuvedeno — má přednost před texty. */
  leadTimeDays?: number | null;
  /** Doklad dávky (zdroj pole), jinak null. */
  docId?: string | null;
}

/** Požadovaný termín z poptávky zákazníka. */
export interface InquiryTerms {
  number: string;
  date: string;
  texts: string[];
  /** Poznámka, popisy položek — jen s kontextovým slovem. */
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

/** Podmínky naší nabídky z vytěženého dokladu. */
export function quoteTermsOfDoc(doc: ExtractedBusinessDoc, number: string, opts: { inSystem?: boolean; docId?: string | null } = {}): QuoteTerms {
  const itemDates = doc.items.map((i) => i.deliveryDate).filter((x) => parseYmd(x)).sort();
  return {
    number: clean(number || doc.documentNumber || doc.ourQuoteNumber),
    inSystem: opts.inSystem === true,
    date: parseYmd(doc.promisedDeliveryDate) ? doc.promisedDeliveryDate : itemDates[itemDates.length - 1] ?? "",
    texts: [doc.deliveryTerms].map(clean).filter(Boolean),
    notes: [doc.note, ...doc.items.map((i) => i.description), doc.summary].map(clean).filter(Boolean),
    docId: opts.docId ?? null,
  };
}

/** Požadovaný termín poptávky zákazníka z vytěženého dokladu. */
export function inquiryTermsOfDoc(doc: ExtractedBusinessDoc, number: string, docId: string | null = null): InquiryTerms {
  const itemDates = doc.items.map((i) => i.deliveryDate).filter((x) => parseYmd(x)).sort();
  return {
    number: clean(number || doc.documentNumber || doc.customerInquiryNumber),
    date: parseYmd(doc.requiredDeliveryDate) ? doc.requiredDeliveryDate : itemDates[0] ?? "",
    texts: [doc.deliveryTerms].map(clean).filter(Boolean),
    notes: [doc.note, ...doc.items.map((i) => i.description)].map(clean).filter(Boolean),
    docId,
  };
}

/** Nabídka v systému (quotes): dodací podmínky, poznámka, lhůta ve dnech. */
export function quoteTermsOfQuote(q: { number: string; leadTimeDays: number | null; deliveryTerms: string | null; note: string | null }): QuoteTerms {
  return {
    number: clean(q.number), inSystem: true, date: "",
    texts: [q.deliveryTerms ?? ""].map(clean).filter(Boolean),
    notes: [q.note ?? ""].map(clean).filter(Boolean),
    leadTimeDays: q.leadTimeDays,
  };
}

/** Slovo, u kterého číslo v poznámce / shrnutí znamená dodací lhůtu (bez diakritiky, malými). */
const LEAD_CONTEXT = /(dodani|dodaci|dodavk|dodame|dodat\b|lhut|termin|expedic|liefer|delivery|deliver\b|lead\s*time|\baro\b|shipping|versand)/g;

/** Bez diakritiky, malými (délka zachována — indexy sedí na původní NFC text). */
function foldText(s: string): string {
  return s.normalize("NFC").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Lhůta z poznámky / popisu / shrnutí jen u kontextového slova („Výroba dle 3D modelu, dodání 4 týdny" →
 * 4 týdny; „Kalení 2 dny" → nic). Čte se JEN klauzule s kontextovým slovem (hranice tečka, středník i čárka):
 * nejdřív za slovem, jinak těsně před ním („4 týdny dodání"); klauzule se předává celá, aby slovo před
 * „lhůta / termín" rozhodlo („Platební / Reklamační / Záruční lhůta 14 dní" = nic). „dle dohody" v klauzuli = nic.
 */
export function parseLeadTimeInContext(text: string): LeadTime | null {
  const raw = clean(text).normalize("NFC");
  if (!raw) return null;
  const f = foldText(raw);
  if (f.length !== raw.length) return null;
  const BOUND = /[.;,\n](?:\s|$)/g;
  LEAD_CONTEXT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LEAD_CONTEXT.exec(f))) {
    const at = m.index;
    const wordEnd = at + m[0].length;
    // konec klauzule za kontextovým slovem, začátek klauzule před ním
    BOUND.lastIndex = wordEnd;
    const stop = BOUND.exec(f)?.index ?? f.length;
    let start = 0;
    BOUND.lastIndex = 0;
    let b: RegExpExecArray | null;
    while ((b = BOUND.exec(f)) && b.index < at) start = b.index + b[0].length;
    while (start < at && /\s/.test(f[start])) start++;
    const clause = raw.slice(start, stop);
    // „Termín dodání dle dohody, kalení 2 dny" — dodání se dohodne, číslo jinde lhůtou není
    if (isByAgreement(clause)) return null;
    const rel = at - start;
    const lead = parseLeadTime(clause, { startAt: rel })
      ?? parseLeadTime(raw.slice(start, wordEnd), { startAt: Math.max(0, rel - 30) });
    if (lead) return lead;
  }
  return null;
}

/**
 * Lhůta nabídky: quotes.lead_time_days (zadaná v systému) má přednost, pak dodací podmínky, pak poznámka /
 * položky / shrnutí jen u kontextového slova (dodání, lhůta, termín, expedice, Lieferzeit, delivery, ARO…).
 */
export function leadOfTerms(t: Pick<QuoteTerms, "texts" | "leadTimeDays" | "notes">): LeadTime | null {
  const n = Number(t.leadTimeDays);
  if (t.leadTimeDays != null && Number.isFinite(n) && n > 0 && n < 3 * 365) return { days: Math.round(n), unit: "kalendarni", from: null, text: `${Math.round(n)} dní` };
  for (const text of t.texts) {
    const lead = parseLeadTime(text);
    if (lead) return lead;
  }
  for (const text of t.notes ?? []) {
    const lead = parseLeadTimeInContext(text);
    if (lead) return lead;
  }
  return null;
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
    return { date: q.date, from: "quote", number: q.number, docId: q.docId ?? null, label: label(detail), detail, lead: null, past: false };
  }
  const lead = leadOfTerms(q);
  if (!lead) return null;
  const base = parseYmd(orderDate) ? orderDate : today;
  const date = addLeadTime(base, lead);
  if (!date) return null;
  const detail = `${parseYmd(orderDate) ? leadText(lead) : `${leadAmountText(lead)} od dneška (objednávka bez data)`} → ${czDate(date)}`;
  return { date, from: "quote", number: q.number, docId: q.docId ?? null, label: label(detail), detail, lead, past: date < today };
}

function fromInquiry(inq: InquiryTerms, orderDate: string, today: string): DeadlineProposal | null {
  const label = (detail: string) => `z poptávky${inq.number ? ` ${inq.number}` : ""} (${detail})`;
  if (inq.date && isRealisticDueDate(inq.date, orderDate, today)) {
    const detail = `požadovaný termín ${czDate(inq.date)}`;
    return { date: inq.date, from: "inquiry", number: inq.number, docId: inq.docId ?? null, label: label(detail), detail, lead: null, past: false };
  }
  const lead = leadOfTerms({ texts: inq.texts, notes: inq.notes });
  if (!lead) return null;
  const base = parseYmd(orderDate) ? orderDate : today;
  const date = addLeadTime(base, lead);
  if (!date) return null;
  const detail = `${leadText(lead)} → ${czDate(date)}`;
  return { date, from: "inquiry", number: inq.number, docId: inq.docId ?? null, label: label(detail), detail, lead, past: date < today };
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

/** „Objednávka nemá reálný termín (chybí) — převzat z nabídky NAB-6 (4 týdny od objednání → 20. 11. 2026)." */
export function deadlineMessage(d: OrderDeadline): string | null {
  if (!d.proposal || !d.reason) return null;
  const past = d.proposal.past ? " Pozor: i tento termín už uplynul — zkontroluj ho." : "";
  return `Objednávka nemá reálný termín (${unrealisticText(d.reason)}) — převzat ${d.proposal.label}.${past}`;
}
