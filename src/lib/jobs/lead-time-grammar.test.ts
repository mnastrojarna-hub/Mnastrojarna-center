import { describe, it, expect } from "vitest";
import { leadOfExtracted, parseLeadTime, rejectsLeadText, type LeadTime } from "./lead-time";
import { deadlineMessage, leadOfTerms, orderDeadline, quoteTermsOfDoc, quoteTermsOfQuote, type QuoteTerms } from "./order-deadline";
import { canAutoApplyBatch, groupDeadlineOf, reconcileGroup, type GroupDraft, type ReconcileDoc } from "./capture-batch-reconcile";
import { singleOrderDeadline } from "./capture-single-deadline";
import { emptyExtracted, emptyParty, normalizeExtracted } from "./extracted-normalize";
import type { BatchApplyState, BatchReviewModel, DocExtractSummary } from "./capture-batch-types";
import type { ExtractedBusinessDoc, ExtractedLeadTime } from "./capture-types";
import type { JobDetail } from "./types";

/**
 * Dodací lhůta z textu = UZAVŘENÁ GRAMATIKA (rozhodnutí vedoucího po 3 kolech ověřování): otevřené hledání
 * vzorů v textu nekonverguje. Pořadí zdrojů: quotes.lead_time_days → strukturované pole AI → dodací podmínky
 * (gramatika) → poznámka / shrnutí / položky (gramatika). Termín z TEXTU nikdy nejde plnou automatikou.
 */

const TODAY = "2026-10-23";
const STROJ = { ...emptyParty(), name: "STROJMETAL, a. s.", ico: "45274649" };
/** Objednávka 20. 10. 2026 (út) bez termínu. */
const order20 = (): ExtractedBusinessDoc => ({
  ...emptyExtracted(), docKind: "objednavka", issuer: "zakaznik", documentNumber: "8000060875", customerOrderNumber: "8000060875",
  documentDate: "2026-10-20", customer: STROJ, confidence: 0.95,
  items: [{ drawingNumber: "F00N603W84", revision: "", name: "Díl", description: "", material: "", quantity: 120, unit: "ks", unitPrice: 0, deliveryDate: "" }],
});
const quoteDoc = (over: Partial<ExtractedBusinessDoc>): ExtractedBusinessDoc => ({
  ...emptyExtracted(), docKind: "nabidka", issuer: "my", documentNumber: "136/026", ourQuoteNumber: "136/026", documentDate: "2026-10-10",
  customer: STROJ, confidence: 0.95, ...over,
});

type Want = { days: number; unit?: LeadTime["unit"]; from?: LeadTime["from"]; range?: [number, number]; months?: number };

/** Lhůta přes všechny cesty: parseLeadTime (dodací pole / volný text), orderDeadline (deliveryTerms dokladu, quotes.delivery_terms, poznámka). */
function through(text: string) {
  const field = parseLeadTime(text, { mode: "delivery-field" });
  const free = parseLeadTime(text, { mode: "free-text" });
  const doc = orderDeadline({ order: order20(), quotes: [quoteTermsOfDoc(quoteDoc({ deliveryTerms: text }), "136/026")], today: TODAY });
  const sys = orderDeadline({ order: order20(), quotes: [quoteTermsOfQuote({ number: "136/026", leadTimeDays: null, deliveryTerms: text, note: null })], today: TODAY });
  const note = orderDeadline({ order: order20(), quotes: [quoteTermsOfDoc(quoteDoc({ deliveryTerms: "", note: text }), "136/026")], today: TODAY });
  const sysNote = orderDeadline({ order: order20(), quotes: [quoteTermsOfQuote({ number: "136/026", leadTimeDays: null, deliveryTerms: null, note: text })], today: TODAY });
  return { field, free, doc: doc.proposal?.lead ?? null, sys: sys.proposal?.lead ?? null, note: note.proposal?.lead ?? null, sysNote: sysNote.proposal?.lead ?? null };
}

function expectLead(got: LeadTime | null, want: Want | null, where: string) {
  if (want === null) {
    expect(got, where).toBeNull();
    return;
  }
  expect(got, where).not.toBeNull();
  expect(got!.days, where).toBe(want.days);
  if (want.unit) expect(got!.unit, where).toBe(want.unit);
  if (want.from !== undefined) expect(got!.from, where).toBe(want.from);
  if (want.range) expect(got!.range, where).toEqual(want.range);
  if (want.months) expect(got!.months, where).toBe(want.months);
}

// ── Musí dát NIC ────────────────────────────────────────────
const NULLS: string[] = [
  "Termín dodání potvrdíme do 3 pracovních dnů od objednávky",
  "Termín dodání bude potvrzen do 3 pracovních dnů od obdržení objednávky",
  "Potvrzení objednávky zašleme do 2 pracovních dnů",
  "Delivery date will be confirmed within 3 days after PO",
  "Liefertermin wird innerhalb von 2 Tagen nach Bestellung bestätigt",
  "Vzorky ihned, série 6 týdnů od schválení vzorků",
  "Expedice ihned po dokončení výroby",
  "Dodání ihned po zaplacení",
  "Delivery 4 weeks after PO or receipt of down payment, whichever is later",
  "Dodací lhůta 4 týdny od objednávky, resp. od uhrazení zálohy",
  "DAP Praha, dílčí dodávky jednou za 2 týdny",
  "Dodávky 1× za 2 týdny",
  "Lieferung im 2-Wochen-Takt",
  "Dodání nejpozději 2 dny před montáží",
  "Avízo dodávky 2 dny předem",
  "EXW Vimperk, uskladnění zdarma 30 dní",
  "V období celozávodní dovolené se dodací lhůta prodlužuje o 2 týdny",
  "Nabídka platí 30 dní",
  "Platební podmínky: 14 dní",
  "Záruční doba 24 měsíců",
  "Výroba dle 3D modelu",
  // další: následná klauzule, která podmiňuje začátek; jiné druhy textu
  "Dodací lhůta 4 týdny od objednávky, nebo od dodání materiálu",
  "Lieferzeit 4 Wochen nach Bestellung, bzw. nach Anzahlung",
  "Lieferzeit 4 Wochen nach Bestellung, oder nach Zahlungseingang",
  "Dodací lhůta 4 týdny (nejdříve však po zaplacení zálohy)",
  "Lead time 4 weeks after PO, subject to material availability",
  "Dodací lhůta: 4 týdny (+/- 1 týden)",
  "Dodací lhůta 4–6 týdnů (dle vytížení)",
  // předchozí klauzule téže věty omezuje platnost
  "Po zaplacení zálohy, dodací lhůta 4 týdny",
  "Pro vzorky, dodací lhůta 2 týdny",
  "Nach Anzahlung, Lieferzeit 4 Wochen",
  "Dodací lhůta 4 týdny od uhrazení zálohy",
  "Dodací lhůta 3 týdny od obdržení materiálu",
  "Dodací lhůta 4 týdny od objednávky a uhrazení zálohy",
  "Lieferzeit 4 Wochen nach Erhalt der Vorauszahlung",
  "Delivery 4 weeks after receipt of down payment",
  "dle dohody",
  "Termín dodání dle dohody",
  "Liefertermin nach Vereinbarung",
  "to be agreed",
  "ihned",
  "EXW Vimperk",
  "Dodávky každé 2 týdny",
  "Lieferung alle 2 Wochen",
  "Platnost nabídky 30 dní",
  "Splatnost 14 dní",
  "Zahlungsziel 30 Tage",
  "Payment 30 days net",
  "Garantie 12 Monate",
  "",
  // 4. kolo — nález 2: klauzule hned za lhůtou, která posouvá začátek / omezuje rozsah / je alternativa → nic
  "Dodací lhůta 4 týdny od objednávky (materiál skladem)",
  "Dodací lhůta 4 týdny, po obdržení zálohy",
  "Dodací lhůta 4 týdny, od obdržení zálohy",
  "Dodací lhůta 4 týdny od objednávky, po zaplacení zálohy",
  "Dodací lhůta 4 týdny (po zaplacení zálohy)",
  "Dodací lhůta: 4 týdny – po schválení vzorků",
  "Delivery: 4 weeks, after receipt of down payment",
  "Delivery 4 weeks ARO, upon receipt of down payment",
  "Lieferzeit: 4 Wochen, ab Zahlungseingang",
  "Lieferzeit 4 Wochen nach Bestellung, ab Zahlungseingang",
  "Lead time: 6 weeks, from receipt of advance payment",
  "Lead time: 6 weeks (after approval of first article)",
  "Dodací lhůta: 2 týdny (vzorky), 6 týdnů (série)",
  "Lieferzeit: 2 Wochen (Muster), 6 Wochen (Serie)",
  "Dodací lhůta: 1 týden (expres)",
  "Dodací lhůta: skladem, jinak 4 týdny",
  "Lieferzeit: ab Lager, sonst 4 Wochen",
  "Delivery: from stock, otherwise 4 weeks",
  "Lieferzeit 4 Wochen, nach Eingang der Anzahlung",
  "Dodací lhůta 4 týdny; pro sérii 6 týdnů",
  // nová řádka za lhůtou, která posouvá začátek → nic; předchozí řádka „Pro vzorky:" omezuje rozsah → nic
  "Dodací lhůta: 4 týdny\nod obdržení zálohy",
  "Lieferzeit: 4 Wochen\nab Zahlungseingang",
  "Lead time: 4 weeks\nafter receipt of down payment",
  "Dodací lhůta 4 týdny\nresp. od uhrazení zálohy",
  "Pro vzorky:\nDodací lhůta 2 týdny",
  "Dodací lhůta 4 týdny\nU zakázek nad 1000 ks 6 týdnů",
  "Dodací lhůta 4 týdny od objednávky, od potvrzení výkresů",
  "Dodací lhůta 4 týdny – 6 týdnů",
  "Lieferzeit 4 Wochen, 6 Wochen für Serie",
  // 4. kolo — nález 4: kalendářní týden bez tečky není doba (jednotné číslo jen u 1); strop 26 týdnů
  "Termín dodání: 48 týden",
  "Liefertermin: 48 Woche",
  "Dodání v 48 týdnu",
  "Delivery: 48 week",
  "Dodací lhůta 2 týden",
  "Dodání v 12 týdnu",
  "Lieferung in 12 Woche",
  "Termín dodání: 48. týden",
  "Liefertermin: 48. Woche",
  "Dodací lhůta 30 týdnů",
  "Lieferzeit 8 Monate",
];

describe("uzavřená gramatika — NIC (dodací pole, volný text, deliveryTerms, quotes.delivery_terms, poznámka)", () => {
  it.each(NULLS)("„%s“ → žádná lhůta", (text) => {
    const r = through(text);
    expectLead(r.field, null, `pole: ${text}`);
    expectLead(r.free, null, `volný text: ${text}`);
    expectLead(r.doc, null, `deliveryTerms: ${text}`);
    expectLead(r.sys, null, `quotes.delivery_terms: ${text}`);
    expectLead(r.note, null, `poznámka: ${text}`);
    expectLead(r.sysNote, null, `quotes.note: ${text}`);
  });
});

// ── Musí se NAJÍT ───────────────────────────────────────────
/** [text, lhůta, jen dodací pole (holá doba)]. */
const FOUND: [string, Want, boolean?][] = [
  ["Dodací lhůta 4 týdny", { days: 28, unit: "kalendarni", from: null }],
  ["Dodací lhůta: 4–6 týdnů od objednávky", { days: 42, range: [28, 42], from: "objednavka" }],
  ["Termín dodání 5 týdnů od obdržení objednávky", { days: 35, from: "objednavka" }],
  ["dodání do 3 týdnů od objednání", { days: 21, from: "objednavka" }],
  ["Expedice do 10 pracovních dnů", { days: 10, unit: "pracovni" }],
  ["Lieferzeit ca. 3 Wochen nach Auftragseingang", { days: 21, from: "objednavka" }],
  ["Lieferzeit: 4 Wochen", { days: 28 }],
  ["Delivery time 4 weeks after PO", { days: 28, from: "objednavka" }],
  ["Lead time: 6 weeks ARO", { days: 42, from: "objednavka" }],
  ["Dodací lhůta: skladem", { days: 3, unit: "pracovni", range: [0, 3] }],
  ["EXW Vimperk, 4 týdny", { days: 28 }, true],
  ["4–6 týdnů od objednávky", { days: 42, range: [28, 42], from: "objednavka" }, true],
  ["Dodací lhůta 4 týdny od závazné objednávky", { days: 28, from: "objednavka" }],
  ["Platnost nabídky 30 dní, dodací lhůta 4 týdny", { days: 28 }],
  // další gramatické tvary
  ["Dodací lhůta – 4 týdny", { days: 28 }],
  ["Dodací lhůta: cca 6 týdnů", { days: 42 }],
  ["dodací lhůta 5 týdnů od potvrzení objednávky", { days: 35, from: "potvrzeni" }],
  ["Dodací lhůta 3 týdny od dodání výkresů", { days: 21, from: "podklady" }],
  ["Termín dodání: 3 měsíce", { days: 90, months: 3 }],
  ["Dodáme do 3 týdnů od objednání", { days: 21, from: "objednavka" }],
  ["Výroba a dodání do 6 týdnů", { days: 42 }],
  ["Dodací lhůta čtyři týdny", { days: 28 }],
  ["Lieferzeit 6-8 Wo.", { days: 56, range: [42, 56] }],
  ["Lieferzeit beträgt ca. 5 Wochen nach Erhalt der Bestellung", { days: 35, from: "objednavka" }],
  ["Lieferzeit 4 Wochen nach Auftragsbestätigung", { days: 28, from: "potvrzeni" }],
  ["Lieferzeit 6 Wochen nach Freigabe der Zeichnungen", { days: 42, from: "podklady" }],
  ["Lieferung innerhalb von 10 Arbeitstagen", { days: 10, unit: "pracovni" }],
  ["Lieferung ab Lager", { days: 3, unit: "pracovni", range: [0, 3] }],
  ["Delivery: 6-8 weeks after receipt of order", { days: 56, range: [42, 56], from: "objednavka" }],
  ["Lead time 15 business days from order confirmation", { days: 15, unit: "pracovni", from: "potvrzeni" }],
  ["Payment 30 days net, lead time 2 weeks", { days: 14 }],
  ["Splatnost 14 dní. Dodání 10 pracovních dní od objednávky.", { days: 10, unit: "pracovni", from: "objednavka" }],
  ["4 týdny", { days: 28, from: null }, true],
  ["do 4 týdnů od objednání", { days: 28, from: "objednavka" }, true],
  ["30 pracovních dnů", { days: 30, unit: "pracovni" }, true],
  ["10 Arbeitstage nach Auftragsbestätigung", { days: 10, unit: "pracovni", from: "potvrzeni" }, true],
  ["4 weeks ARO", { days: 28, from: "objednavka" }, true],
  ["Dodací podmínky: EXW Vimperk, 6 týdnů od objednávky", { days: 42, from: "objednavka" }, true],
  ["6 týdnů, DAP Kladno", { days: 42 }, true],
  // 4. kolo — nález 3: víceřádkové poznámky / dodací podmínky (jeden údaj na řádek)
  ["Dodací lhůta: 4 týdny\nCeny jsou uvedeny bez DPH", { days: 28 }],
  ["Platnost nabídky 30 dní\nDodací lhůta 4 týdny", { days: 28 }],
  ["Děkujeme za Vaši poptávku\nDodací lhůta: 4 týdny od objednávky\nS pozdravem", { days: 28, from: "objednavka" }],
  ["EXW Vimperk\nDodací lhůta 4 týdny od objednávky", { days: 28, from: "objednavka" }],
  ["Dodací podmínky: EXW Vimperk\nDodací lhůta: 4 týdny od objednávky", { days: 28, from: "objednavka" }],
  ["Lieferzeit: 4 Wochen\nPreise ab Werk", { days: 28 }],
  ["Lieferzeit: 4 Wochen\nAb Werk Vimperk", { days: 28 }],
  ["Payment: 30 days net\nLead time: 4 weeks ARO", { days: 28, from: "objednavka" }],
  ["Dodací lhůta: 4 týdny od objednávky\nV případě dotazů nás kontaktujte", { days: 28, from: "objednavka" }],
  ["Dodací podmínky:\nDodací lhůta 4 týdny", { days: 28 }],
  ["Dodací lhůta: 4 týdny od objednávky\nV případě dotazů volejte 603 123 456", { days: 28, from: "objednavka" }],
  // OD na další klauzuli / řádku
  ["Lieferzeit: 4 Wochen\nab Auftragseingang", { days: 28, from: "objednavka" }],
  ["Dodací lhůta 4 týdny, od obdržení objednávky", { days: 28, from: "objednavka" }],
  // jednotné číslo jen u 1; strop 26 týdnů / 6 měsíců
  ["Dodací lhůta 1 týden", { days: 7 }],
  ["Lieferzeit eine Woche", { days: 7 }],
  ["Lieferzeit 1 Woche nach Bestellung", { days: 7, from: "objednavka" }],
  ["Delivery 1 week", { days: 7 }],
  ["Dodání 1 pracovní den", { days: 1, unit: "pracovni" }],
  ["Termín dodání: 1 měsíc", { days: 30, months: 1 }],
  ["Dodací lhůta 26 týdnů", { days: 182 }],
  ["Dodaci lhuta 6 tydnu od objednavky", { days: 42, from: "objednavka" }],
  ["Dodací lhůta 1,5 týdne", { days: 11 }],
  ["Dodací lhůta 6 měsíců", { days: 180, months: 6 }],
];

describe("uzavřená gramatika — NAJDE (stejná gramatika pro dodací pole i volný text)", () => {
  it.each(FOUND)("„%s“", (text, want, fieldOnly) => {
    const r = through(text);
    expectLead(r.field, want, `pole: ${text}`);
    expectLead(r.doc, want, `deliveryTerms: ${text}`);
    expectLead(r.sys, want, `quotes.delivery_terms: ${text}`);
    expectLead(r.free, fieldOnly ? null : want, `volný text: ${text}`);
    expectLead(r.note, fieldOnly ? null : want, `poznámka: ${text}`);
    expectLead(r.sysNote, fieldOnly ? null : want, `quotes.note: ${text}`);
  });
  it("„Dodací lhůta 4 týdny od objednávky (materiál skladem)“ nikdy „ihned“ (závorka hned za lhůtou = nic)", () => {
    expect(parseLeadTime("Dodací lhůta 4 týdny od objednávky (materiál skladem)")).toBeNull();
    expect(parseLeadTime("Dodací lhůta 4 týdny od objednávky (materiál skladem)", { mode: "free-text" })).toBeNull();
  });
  it("text lhůty obsahuje i navazující klauzuli téže věty (zobrazí se ke kontrole)", () => {
    expect(parseLeadTime("Dodací lhůta 4 týdny, balení v ceně")?.text).toBe("Dodací lhůta 4 týdny, balení v ceně");
    expect(parseLeadTime("Dodací lhůta 4 týdny\nCeny bez DPH")?.text).toBe("Dodací lhůta 4 týdny");
    const d = orderDeadline({ order: order20(), quotes: [quoteTermsOfQuote({ number: "N", leadTimeDays: null, deliveryTerms: "Dodací lhůta 4 týdny, balení v ceně", note: null })], today: TODAY });
    expect(deadlineMessage(d)).toMatch(/„Dodací lhůta 4 týdny, balení v ceně“ — zkontroluj/);
  });
  it("víceřádkové quotes.note / doc.note → termín 17. 11. 2026 (jako a663cce)", () => {
    for (const note of ["Dodací lhůta: 4 týdny\nCeny jsou uvedeny bez DPH", "Payment: 30 days net\nLead time: 4 weeks ARO"]) {
      expect(orderDeadline({ order: order20(), quotes: [quoteTermsOfQuote({ number: "N", leadTimeDays: null, deliveryTerms: null, note })], today: TODAY }).proposal?.date, note).toBe("2026-11-17");
      expect(orderDeadline({ order: order20(), quotes: [quoteTermsOfDoc(quoteDoc({ note }), "N")], today: TODAY }).proposal?.date, note).toBe("2026-11-17");
    }
  });
  it("kalendářní týden bez tečky nedá termín přes orderDeadline", () => {
    for (const t of ["Termín dodání: 48 týden", "Liefertermin: 48 Woche", "Dodání v 48 týdnu"]) {
      expect(orderDeadline({ order: order20(), quotes: [quoteTermsOfQuote({ number: "N", leadTimeDays: null, deliveryTerms: t, note: t })], today: TODAY }).proposal, t).toBeNull();
    }
  });
  it("text = celá gramatická klauzule z původního textu (s diakritikou)", () => {
    expect(parseLeadTime("Platnost nabídky 30 dní, Dodací lhůta: do 4 týdnů od objednání")?.text).toBe("Dodací lhůta: do 4 týdnů od objednání");
    expect(parseLeadTime("EXW Vimperk, 4 týdny")?.text).toBe("4 týdny");
    expect(parseLeadTime("Dodací lhůta 4 týdny")?.source).toBe("text");
  });
  it("dvě gramatické klauzule s různou lhůtou = nejistota → nic; se stejnou → ta první", () => {
    expect(parseLeadTime("Dodací lhůta 4 týdny; Lieferzeit 6 Wochen")).toBeNull();
    expect(parseLeadTime("Dodací lhůta 4 týdny; Lieferzeit 4 Wochen")).toMatchObject({ days: 28 });
  });
  it("termín přes orderDeadline: od data objednávky, pracovní dny přes víkend a 28. 10., rozpětí = horní mez", () => {
    // út 20. 10. + 28 dní
    expect(orderDeadline({ order: order20(), quotes: [quoteTermsOfDoc(quoteDoc({ deliveryTerms: "Dodací lhůta 4 týdny" }), "136/026")], today: TODAY }).proposal?.date).toBe("2026-11-17");
    // út 20. 10. + 10 prac. dnů: 21, 22, 23, 26, 27, (28 svátek) 29, 30, 2, 3, 4 → 4. 11.
    expect(orderDeadline({ order: order20(), quotes: [quoteTermsOfDoc(quoteDoc({ deliveryTerms: "Expedice do 10 pracovních dnů" }), "136/026")], today: TODAY }).proposal?.date).toBe("2026-11-04");
    // 4–6 týdnů → 6 týdnů → 1. 12.
    expect(orderDeadline({ order: order20(), quotes: [quoteTermsOfDoc(quoteDoc({ deliveryTerms: "4–6 týdnů od objednávky" }), "136/026")], today: TODAY }).proposal?.date).toBe("2026-12-01");
    // objednávka bez data → od dneška
    const noDate = orderDeadline({ order: { ...order20(), documentDate: "" }, quotes: [quoteTermsOfDoc(quoteDoc({ deliveryTerms: "Dodací lhůta 4 týdny" }), "136/026")], today: TODAY });
    expect(noDate.proposal?.date).toBe("2026-11-20");
  });
  it("reálný termín objednávky se nikdy nepřepisuje", () => {
    const d = orderDeadline({ order: { ...order20(), requiredDeliveryDate: "2026-12-04" }, quotes: [quoteTermsOfDoc(quoteDoc({ deliveryTerms: "Dodací lhůta 4 týdny" }), "136/026")], today: TODAY });
    expect(d).toMatchObject({ realistic: true, current: "2026-12-04", proposal: null });
  });
});

// ── Strukturované pole AI ───────────────────────────────────
describe("deliveryLeadTime z AI — přijetí, záporný filtr textu, stop bez propadu na text", () => {
  const ai = (x: Partial<ExtractedLeadTime>): ExtractedLeadTime => ({ value: 4, unit: "tydny", from: "objednavka", text: "", ...x });
  it("normalizace: jednotky, od čeho, prázdné = null", () => {
    const d = normalizeExtracted({ docKind: "nabidka", issuer: "my", deliveryLeadTime: { value: "4", unit: "týdny", from: "objednávka", text: " 4 týdny od objednávky " } });
    expect(d.deliveryLeadTime).toEqual({ value: 4, unit: "tydny", from: "objednavka", text: "4 týdny od objednávky" });
    expect(normalizeExtracted({ deliveryLeadTime: { value: 0, unit: "", from: "", text: "" } }).deliveryLeadTime).toBeNull();
    expect(normalizeExtracted({ deliveryLeadTime: { value: 30, unit: "pracovní dny", from: "", text: "" } }).deliveryLeadTime)
      .toEqual({ value: 30, unit: "pracovni_dny", from: null, text: "" });
  });
  it("přijaté: hodnota > 0, známá jednotka, od objednávky / potvrzení / podkladů", () => {
    expect(leadOfExtracted(ai({ text: "4 týdny od objednávky" }))).toMatchObject({ days: 28, unit: "kalendarni", from: "objednavka", source: "ai" });
    expect(leadOfExtracted(ai({ value: 20, unit: "pracovni_dny", from: "potvrzeni" }))).toMatchObject({ days: 20, unit: "pracovni", from: "potvrzeni" });
    expect(leadOfExtracted(ai({ value: 3, unit: "mesice", from: "podklady" }))).toMatchObject({ days: 90, months: 3 });
    expect(leadOfExtracted(ai({ value: 6, from: "objednavka", text: "4–6 týdnů od obdržení závazné objednávky" }))).toMatchObject({ days: 42, range: [28, 42] });
    // od potvrzení / Auftragsbestätigung / order confirmation není „potvrzení termínu"
    expect(leadOfExtracted(ai({ from: "potvrzeni", text: "4 Wochen nach Auftragsbestätigung" }))).toMatchObject({ days: 28 });
    expect(leadOfExtracted(ai({ from: "potvrzeni", text: "4 weeks after order confirmation" }))).toMatchObject({ days: 28 });
    expect(leadOfExtracted(ai({ from: "potvrzeni", text: "Dodací lhůta 4 týdny od potvrzení objednávky" }))).toMatchObject({ days: 28 });
  });
  it("„od“ neuvedeno: jen s textem, který gramatika přijme; jinak se pole nepoužije (čte se zbytek nabídky)", () => {
    expect(leadOfExtracted(ai({ from: null, text: "Dodací lhůta 4 týdny" }))).toMatchObject({ days: 28, source: "ai" });
    expect(leadOfExtracted(ai({ from: null, text: "" }))).toBeNull();
    expect(leadOfExtracted(ai({ from: null, text: "Výroba 4 týdny" }))).toBeNull();
    expect(leadOfExtracted(ai({ value: 0, text: "Lieferzeit 5 Wochen" }))).toBeNull();
    expect(leadOfExtracted(null)).toBeNull();
  });
  it.each([
    "Termín dodání potvrdíme do 3 pracovních dnů od objednávky",
    "Termín dodání bude potvrzen do 3 pracovních dnů od obdržení objednávky",
    "Delivery date will be confirmed within 3 days after PO",
    "Liefertermin wird innerhalb von 2 Tagen nach Bestellung bestätigt",
    "Nabídka platí 30 dní", "Offer valid 30 days", "Angebot gültig 30 Tage", "Bindefrist 30 Tage",
    "Splatnost 14 dní", "Payment 30 days", "Zahlung 30 Tage netto", "2 % Skonto 10 Tage",
    "Záruka 24 měsíců", "Garantie 12 Monate", "warranty 12 months", "Gewährleistung 24 Monate",
    "4 týdny od uhrazení zálohy", "4 weeks after advance payment", "4 Wochen nach Anzahlung", "4 Wochen nach Vorauszahlung",
    "uskladnění zdarma 30 dní", "free storage 30 days", "Lagerung 30 Tage",
    "Avízo dodávky 2 dny předem", "notification 2 days prior", "Avis 2 Tage vor Lieferung", "2 days in advance",
    "dílčí dodávky každé 2 týdny", "Lieferung alle 2 Wochen", "every 2 weeks", "jednou za 2 týdny", "im 2-Wochen-Rhythmus", "2-Wochen-Takt", "2 week cycle", "interval 2 týdny",
    "zahájení výroby do 5 dnů", "production start 1 week", "Produktionsbeginn 1 Woche",
    "vzorky 2 týdny", "Erstmuster 2 Wochen", "samples 2 weeks",
    "dodací lhůta se prodlužuje o 2 týdny", "Lieferzeit verlängert sich um 2 Wochen", "lead time extended by 2 weeks",
  ])("text AI „%s“ → odmítnut = stop (žádná lhůta, nečte se ani zbytek nabídky)", (text) => {
    expect(rejectsLeadText(text), text).toBe(true);
    const x = ai({ from: "objednavka", text });
    expect(leadOfExtracted(x)).toMatchObject({ blocked: true });
    const q = quoteTermsOfDoc(quoteDoc({ deliveryLeadTime: x, deliveryTerms: "Dodací lhůta 4 týdny", note: "dodání 4 týdny" }), "136/026");
    expect(leadOfTerms(q)).toBeNull();
    expect(orderDeadline({ order: order20(), quotes: [q], today: TODAY }).proposal).toBeNull();
  });
  it("„jine“ (běží od něčeho jiného) = stop, nečte se dodací pole ani poznámka; lead_time_days přebije", () => {
    const x = ai({ from: "jine", text: "4 týdny od dodání materiálu" });
    expect(leadOfExtracted(x)).toEqual({ blocked: true, text: "4 týdny od dodání materiálu" });
    const q = quoteTermsOfDoc(quoteDoc({ deliveryLeadTime: x, deliveryTerms: "Dodací lhůta 4 týdny", note: "Dodání 4 týdny" }), "136/026");
    expect(leadOfTerms(q)).toBeNull();
    expect(leadOfTerms({ ...q, leadTimeDays: 14 })).toMatchObject({ days: 14, source: "system" });
  });
  it("text, který se nepovede přečíst (hodnota bez „od“) → propad na dodací podmínky", () => {
    const q = quoteTermsOfDoc(quoteDoc({ deliveryLeadTime: ai({ value: 0, from: null, text: "Lieferzeit 5 Wochen" }), deliveryTerms: "" }), "136/026");
    expect(leadOfTerms(q)).toMatchObject({ days: 35, source: "text", review: true });
  });
  it("záporný filtr nesahá na gramatickou cestu (jen text AI)", () => {
    expect(rejectsLeadText("Dodací lhůta 4 týdny od objednávky")).toBe(false);
    expect(rejectsLeadText("Předpokládaná dodací lhůta 4 týdny")).toBe(false);
    expect(rejectsLeadText("4 týdny od obdržení závazné objednávky")).toBe(false);
  });
});

// ── Pořadí zdrojů ───────────────────────────────────────────
describe("pořadí zdrojů: lead_time_days → AI → dodací podmínky → poznámka / shrnutí / položky", () => {
  const doc = quoteDoc({
    deliveryLeadTime: { value: 5, unit: "tydny", from: "objednavka", text: "5 týdnů od objednávky" },
    deliveryTerms: "Dodací lhůta 3 týdny", note: "dodání 2 týdny",
  });
  it("první zdroj s hodnotou vyhraje", () => {
    const q = quoteTermsOfDoc(doc, "136/026");
    expect(leadOfTerms(q)).toMatchObject({ days: 35, source: "ai" });
    expect(leadOfTerms({ ...q, leadTimeDays: 14 })).toMatchObject({ days: 14, source: "system", review: false });
    expect(leadOfTerms({ ...q, structured: null })).toMatchObject({ days: 21, source: "text", review: true });
    expect(leadOfTerms({ ...q, structured: null, texts: [] })).toMatchObject({ days: 14, source: "text", review: true });
    // shrnutí a popis položky jsou volný text (jen gramatická klauzule)
    const sum = quoteTermsOfDoc(quoteDoc({ deliveryTerms: "", summary: "Nabídka 136/026, dodací lhůta 5 týdnů." }), "136/026");
    expect(leadOfTerms(sum)).toMatchObject({ days: 35 });
    const it5 = quoteTermsOfDoc(quoteDoc({ deliveryTerms: "", items: [{ ...order20().items[0], description: "zkouška 5 dnů" }] }), "136/026");
    expect(leadOfTerms(it5)).toBeNull();
  });
  it("lead_time_days 0 / null → neuvedeno", () => {
    const q = quoteTermsOfQuote({ number: "N", leadTimeDays: 0, deliveryTerms: "Dodací lhůta 3 týdny", note: null });
    expect(leadOfTerms(q)).toMatchObject({ days: 21, source: "text" });
  });
});

// ── Bezpečnost: termín z textu nikdy plnou automatikou ──────
describe("termín z textu nabídky → kontrola člověkem (ne plná automatika)", () => {
  const ai = (x: Partial<ExtractedLeadTime>): ExtractedLeadTime => ({ value: 4, unit: "tydny", from: "objednavka", text: "", ...x });
  it("AI pole: bez textu / text sedí → bez kontroly; text nesedí / nejde přečíst → kontrola", () => {
    const review = (over: Partial<ExtractedBusinessDoc>) => leadOfTerms(quoteTermsOfDoc(quoteDoc(over), "136/026"))?.review;
    expect(review({ deliveryLeadTime: ai({}) })).toBe(false);
    expect(review({ deliveryLeadTime: ai({ text: "4 týdny od objednávky" }), deliveryTerms: "Dodací lhůta: 4 týdny od objednávky" })).toBe(false);
    expect(review({ deliveryLeadTime: ai({}), deliveryTerms: "Dodací lhůta 4 týdny" })).toBe(false);
    expect(review({ deliveryLeadTime: ai({ text: "4 týdny od objednávky" }), deliveryTerms: "EXW Vimperk" })).toBe(false);
    expect(review({ deliveryLeadTime: ai({}), deliveryTerms: "Dodací lhůta 6 týdnů" })).toBe(true);
    expect(review({ deliveryLeadTime: ai({ text: "6 týdnů od objednávky" }) })).toBe(true);
    expect(review({ deliveryLeadTime: ai({}), deliveryTerms: "EXW Vimperk" })).toBe(true);
    expect(review({ deliveryLeadTime: ai({ text: "Výroba 4 týdny po schválení" }) })).toBe(true);
    expect(review({ deliveryLeadTime: ai({}), note: "Dodací lhůta 6 týdnů" })).toBe(true);
    // dodací text existuje a gramatika z něj nic nepřečte (podmíněná lhůta) → kontrola, i když text AI „sedí“
    expect(review({ deliveryLeadTime: ai({ text: "4 týdny od objednávky" }), deliveryTerms: "Dodací lhůta 4 týdny od objednávky, resp. od uhrazení zálohy" })).toBe(true);
    expect(review({ deliveryLeadTime: ai({ text: "Lieferzeit 4 Wochen" }), deliveryTerms: "Lieferzeit 4 Wochen ab Zahlungseingang" })).toBe(true);
    expect(review({ deliveryLeadTime: ai({ text: "4 weeks after PO" }), deliveryTerms: "Delivery 4 weeks after PO or receipt of down payment, whichever is later" })).toBe(true);
    expect(review({ deliveryLeadTime: ai({}), deliveryTerms: "Dodací lhůta 4 týdny, po obdržení zálohy" })).toBe(true);
    // totéž v poznámce / shrnutí (dodací kotva + doba, gramatika nečte stejně)
    expect(review({ deliveryLeadTime: ai({}), note: "Dodací lhůta 4 týdny, po obdržení zálohy" })).toBe(true);
    expect(review({ deliveryLeadTime: ai({ text: "4 týdny od objednávky" }), summary: "Nabídka 136/026 na 120 ks, dodací lhůta 4 týdny od uhrazení zálohy." })).toBe(true);
    expect(review({ deliveryLeadTime: ai({}), note: "Lieferzeit: ab Lager, sonst 4 Wochen" })).toBe(true);
    // poznámka bez dodací lhůty / se stejnou lhůtou → bez kontroly
    expect(review({ deliveryLeadTime: ai({}), note: "Zkouška tvrdosti 5 dnů, balení v ceně" })).toBe(false);
    expect(review({ deliveryLeadTime: ai({}), note: "Dodací lhůta 4 týdny od objednávky" })).toBe(false);
    expect(review({ deliveryLeadTime: ai({}), items: [{ ...order20().items[0], description: "Dodání ve 2 dávkách po 60 ks" }] })).toBe(false);
  });
  it("orderDeadline: návrh z textu nese review + zprávu se zdrojovým textem", () => {
    const d = orderDeadline({ order: order20(), quotes: [quoteTermsOfDoc(quoteDoc({ deliveryTerms: "Dodací lhůta 4 týdny" }), "136/026")], today: TODAY });
    expect(d.proposal).toMatchObject({ date: "2026-11-17", review: true });
    expect(deadlineMessage(d)).toBe(
      "Objednávka nemá reálný termín (chybí) — převzat z nabídky 136/026 (4 týdny od objednání → 17. 11. 2026). Termín odvozen z textu nabídky „Dodací lhůta 4 týdny“ — zkontroluj.",
    );
    const sys = orderDeadline({ order: order20(), quotes: [quoteTermsOfQuote({ number: "N", leadTimeDays: 28, deliveryTerms: null, note: null })], today: TODAY });
    expect(sys.proposal?.review).toBe(false);
    expect(deadlineMessage(sys)).not.toMatch(/zkontroluj/);
  });
  it("groupDeadlineOf: termín z textu = warn (blokuje canAutoApplyBatch); lead_time_days / shodné AI = info", () => {
    const text = groupDeadlineOf(order20(), [quoteTermsOfDoc(quoteDoc({ deliveryTerms: "Dodací lhůta 4 týdny" }), "136/026")], null, "d1");
    expect(text.warnings[0]).toMatchObject({ code: "deadline_from_quote", severity: "warn" });
    expect(text.warnings[0].message).toMatch(/Termín odvozen z textu nabídky „Dodací lhůta 4 týdny“ — zkontroluj/);
    const sys = groupDeadlineOf(order20(), [quoteTermsOfQuote({ number: "N", leadTimeDays: 28, deliveryTerms: null, note: null })], null, "d1");
    expect(sys.warnings[0]).toMatchObject({ severity: "info" });
    const aiOk = groupDeadlineOf(order20(), [quoteTermsOfDoc(quoteDoc({ deliveryLeadTime: ai({ text: "4 týdny od objednávky" }), deliveryTerms: "Dodací lhůta: 4 týdny od objednávky" }), "136/026")], null, "d1");
    expect(aiOk.warnings[0]).toMatchObject({ severity: "info" });
    const aiBad = groupDeadlineOf(order20(), [quoteTermsOfDoc(quoteDoc({ deliveryLeadTime: ai({}), deliveryTerms: "Dodací lhůta 6 týdnů" }), "136/026")], null, "d1");
    expect(aiBad.warnings[0]).toMatchObject({ severity: "warn" });
    expect(aiBad.warnings[0].message).toMatch(/zkontroluj/);
  });
  it("poptávka zákazníka: lhůta z textu také ke kontrole", () => {
    const inq = { number: "RFQ-1", date: "", texts: ["Dodání do 6 týdnů od objednání"], docId: "di" };
    const d = groupDeadlineOf(order20(), [], inq, "d1");
    expect(d.result.proposal).toMatchObject({ from: "inquiry", date: "2026-12-01", review: true });
    expect(d.warnings[0]).toMatchObject({ severity: "warn" });
    expect(d.warnings[0].message).toMatch(/Termín odvozen z textu poptávky/);
  });
  it("jedna fotka: zpráva do needsClarification obsahuje „zkontroluj“", () => {
    const four = quoteTermsOfQuote({ number: "NAB-1", leadTimeDays: null, deliveryTerms: "Dodací lhůta 4 týdny od objednávky", note: null });
    const dl = singleOrderDeadline(order20(), [four], TODAY);
    expect(dl).toMatchObject({ date: "2026-11-17", drop: false });
    expect(dl!.message).toMatch(/Termín odvozen z textu nabídky „Dodací lhůta 4 týdny od objednávky“ — zkontroluj/);
  });

  /** Dávka objednávka + naše nabídka, režim plná automatika. */
  function autoBatch(quote: ExtractedBusinessDoc) {
    const mk = (id: string, type: "objednavka_zakaznik" | "nabidka_my", doc: ExtractedBusinessDoc): ReconcileDoc => ({
      id, type, flags: [], documentNumber: doc.documentNumber, drawingNumbers: [], title: "", filename: `${id}.jpg`, aiType: type,
      extract: { kind: "business", doc }, aiUsed: true, reason: null, confidence: 0.95, customerMatch: null, supplierMatch: null, strongMatch: null,
    });
    const docs = [mk("d1", "objednavka_zakaznik", order20()), mk("d2", "nabidka_my", quote)];
    const group: GroupDraft = { key: "g1", docIds: ["d1", "d2"], targetJobId: null, targetRequired: false, autoReason: null, customerName: "", partyKey: "" };
    const res = reconcileGroup({
      captureId: "c0000000-0000-4000-8000-000000000001", group, docs, margins: true, mode: "full", ourIco: "04304080", fixedJobId: null,
      jobs: [], today: TODAY,
    });
    const sortDocs = docs.map((d) => ({
      id: d.id, type: d.type, pageIds: [`p-${d.id}`], aiType: d.type, confidence: 0.95, reason: "", title: "", documentNumber: d.documentNumber,
      partyName: "", drawingNumbers: [], format: null, flags: [], issuerCheck: "ok" as const, excluded: false,
    }));
    const initial: BatchApplyState = { sort: { docs: sortDocs, excludedPageIds: [] }, groups: [res.state], docs: res.docStates };
    const review = {
      captureId: "c", aiUsed: true, mode: "full", margins: true, drawingsAccess: true, fixedJobId: null,
      options: { customers: [], suppliers: [], jobs: [] }, groups: [res.review], docs: res.docs, warnings: res.warnings, initial,
    } as BatchReviewModel;
    const ready: DocExtractSummary[] = docs.map((d) => ({
      docId: d.id, pagesKey: `p-${d.id}`, type: d.type, status: "ready", error: null, aiUsed: true, title: "", documentNumber: d.documentNumber, confidence: 0.95, clarifications: 0,
    }));
    return { res, review, ready };
  }
  it("dávka v plné automatice: termín z textu nabídky → canAutoApplyBatch = false; datum zůstává navržené", () => {
    const { res, review, ready } = autoBatch(quoteDoc({ deliveryTerms: "Dodací lhůta 4 týdny" }));
    expect(res.state.job.fields.customerRequiredDate).toBe("2026-11-17");
    expect(res.warnings.find((w) => w.code === "deadline_from_quote")?.severity).toBe("warn");
    // jediné varování nad úroveň info je termín z textu
    expect(res.warnings.filter((w) => w.severity !== "info").map((w) => w.code)).toEqual(["deadline_from_quote"]);
    expect(canAutoApplyBatch(review, ready)).toBe(false);
  });
  it("dávka: AI pole shodné s textem → termín bez varování úrovně warn", () => {
    const { res, review, ready } = autoBatch(quoteDoc({ deliveryLeadTime: ai({ text: "4 týdny od objednávky" }), deliveryTerms: "Dodací lhůta: 4 týdny od objednávky" }));
    expect(res.state.job.fields.customerRequiredDate).toBe("2026-11-17");
    expect(res.warnings.find((w) => w.code === "deadline_from_quote")?.severity).toBe("info");
    expect(res.warnings.filter((w) => w.severity !== "info")).toEqual([]);
  });

  /** Objednávka bez termínu k existující zakázce (shoda 95) s naší nabídkou v systému — jinak vše jisté. */
  function autoExisting(quote: Parameters<typeof quoteTermsOfQuote>[0] | QuoteTerms) {
    const terms = "inSystem" in quote ? quote : quoteTermsOfQuote(quote);
    const o: ReconcileDoc = {
      id: "d1", type: "objednavka_zakaznik", flags: [], documentNumber: "8000060875", drawingNumbers: [], title: "", filename: "d1.jpg",
      aiType: "objednavka_zakaznik", extract: { kind: "business", doc: order20() }, aiUsed: true, reason: null, confidence: 0.95,
      customerMatch: null, supplierMatch: null, strongMatch: null,
    };
    const jobId = "11111111-1111-4111-8111-111111111111";
    const job = {
      id: jobId, number: "Z-2026-031", title: "Zakázka", stage: "objednavka", customer: { id: "c1", name: "Strojmetal a.s." }, supplier: null,
      items: [], quotes: [], files: [], events: [], customerOrderNumber: null, customerInquiryNumber: null, customerContact: null,
      customerContactEmail: null, customerContactPhone: null, inquiryDate: null, orderDate: null, customerRequiredDate: null, dueDate: null,
      expectedDeliveryDate: null, supplierPromisedDate: null, value: null, supplierOrderNumber: null, invoiceNumber: null, deliveryNoteNumber: null,
    } as unknown as JobDetail;
    const res = reconcileGroup({
      captureId: "c0000000-0000-4000-8000-000000000001",
      group: { key: "g1", docIds: ["d1"], targetJobId: jobId, targetRequired: false, autoReason: null, customerName: "", partyKey: "" },
      docs: [o], margins: true, mode: "full", ourIco: "04304080", fixedJobId: null, today: TODAY,
      jobs: [{ job, reason: "podle čísla objednávky", score: 95, quoteTerms: [terms] }],
    });
    const sortDoc = {
      id: "d1", type: "objednavka_zakaznik" as const, pageIds: ["p-d1"], aiType: "objednavka_zakaznik" as const, confidence: 0.95, reason: "", title: "",
      documentNumber: "8000060875", partyName: "", drawingNumbers: [], format: null, flags: [], issuerCheck: "ok" as const, excluded: false,
    };
    const review = {
      captureId: "c", aiUsed: true, mode: "full", margins: true, drawingsAccess: true, fixedJobId: null,
      options: { customers: [], suppliers: [], jobs: [] }, groups: [res.review], docs: res.docs, warnings: res.warnings,
      initial: { sort: { docs: [sortDoc], excludedPageIds: [] }, groups: [res.state], docs: res.docStates },
    } as BatchReviewModel;
    const ready: DocExtractSummary[] = [{ docId: "d1", pagesKey: "p-d1", type: "objednavka_zakaznik", status: "ready", error: null, aiUsed: true, title: "", documentNumber: "8000060875", confidence: 0.95, clarifications: 0 }];
    return { res, can: canAutoApplyBatch(review, ready), target: res.review.model.targets.find((t) => t.key === jobId)! };
  }
  it("plná automatika k existující zakázce: lead_time_days → uloží se samo; stejná lhůta jen v textu nabídky → ke kontrole", () => {
    const sys = autoExisting({ number: "NAB-2026-031", leadTimeDays: 28, deliveryTerms: null, note: null });
    expect(sys.target.proposed.customerRequiredDate).toBe("2026-11-17");
    expect(sys.can).toBe(true);
    const text = autoExisting({ number: "NAB-2026-031", leadTimeDays: null, deliveryTerms: "Dodací lhůta 4 týdny od objednávky", note: null });
    expect(text.target.proposed.customerRequiredDate).toBe("2026-11-17");
    expect(text.res.warnings.find((w) => w.code === "deadline_from_quote")).toMatchObject({ severity: "warn" });
    expect(text.can).toBe(false);
  });
  it("plná automatika k existující zakázce: AI pole + dodací text, který gramatika nepřijme (podmíněná lhůta) → ke kontrole", () => {
    const ai4 = (text: string): ExtractedLeadTime => ({ value: 4, unit: "tydny", from: "objednavka", text });
    const cases: [ExtractedLeadTime, string][] = [
      [ai4("4 týdny od objednávky"), "Dodací lhůta 4 týdny od objednávky, resp. od uhrazení zálohy"],
      [ai4("Lieferzeit 4 Wochen"), "Lieferzeit 4 Wochen ab Zahlungseingang"],
      [ai4("4 weeks after PO"), "Delivery 4 weeks after PO or receipt of down payment, whichever is later"],
      [ai4(""), "Dodací lhůta 4 týdny, po obdržení zálohy"],
    ];
    for (const [x, deliveryTerms] of cases) {
      const r = autoExisting(quoteTermsOfDoc(quoteDoc({ deliveryLeadTime: x, deliveryTerms }), "136/026", { inSystem: true, docId: "f1" }));
      expect(r.target.proposed.customerRequiredDate, deliveryTerms).toBe("2026-11-17");
      expect(r.res.warnings.find((w) => w.code === "deadline_from_quote")?.severity, deliveryTerms).toBe("warn");
      expect(r.can, deliveryTerms).toBe(false);
    }
    // kontrola: AI pole a dodací text čtou totéž → uloží se samo
    const ok = autoExisting(quoteTermsOfDoc(quoteDoc({ deliveryLeadTime: ai4("4 týdny od objednávky"), deliveryTerms: "Dodací lhůta: 4 týdny od objednávky" }), "136/026", { inSystem: true, docId: "f1" }));
    expect(ok.target.proposed.customerRequiredDate).toBe("2026-11-17");
    expect(ok.can).toBe(true);
  });
});

describe("4. kolo — jiná doba v sousední klauzuli, různé lhůty v položkách, běžné kotvy a odrážky", () => {
  it("jiná klauzule téhož textu s vlastní dobou → nic (série, kalené díly, položka 2, výroba před expedicí)", () => {
    for (const text of [
      "Dodací lhůta: 2 týdny, série 6 týdnů",
      "Lieferzeit: 3 Wochen, Serie 6 Wochen",
      "Delivery: 2 weeks, series 6 weeks",
      "Dodací lhůta: 2 týdny – prototypy, 6 týdnů – série",
      "Lead time: 2 weeks – prototypes, 6 weeks – production",
      "Dodací lhůta 4 týdny, kalené díly 6 týdnů",
      "Dodací lhůta 4 týdny; položka 2 – 8 týdnů",
      "Výroba 4 týdny, expedice 2 dny",
      "Výroba: 4 týdny od objednávky, expedice: 2 dny",
      "Výroba: 4 týdny\nExpedice: 2 dny",
      "Termín výroby: 4 týdny, expedice do 2 dnů",
      "Fertigung 4 Wochen, Lieferung 2 Tage",
      "Fertigungszeit: 4 Wochen, Lieferung: 2 Tage",
      "Production time 4 weeks, delivery 1 week",
      "Vzorky ihned, dodací lhůta série 6 týdnů",
    ]) {
      const r = through(text);
      for (const [where, got] of Object.entries(r)) expectLead(got, null, `${text} → ${where}`);
    }
  });

  it("jiná obchodní podmínka s dobou lhůtu nezruší (platnost, splatnost, záruka, skonto, uskladnění)", () => {
    for (const [text, days] of [
      ["Platnost nabídky 30 dní, dodací lhůta 4 týdny", 28],
      ["Platba 14 dní; dodací lhůta 6 týdnů", 42],
      ["Dodací lhůta 4 týdny, záruka 24 měsíců", 28],
      ["Dodací lhůta 4 týdny od objednávky, splatnost faktur 30 dní", 28],
      ["Lieferzeit 3 Wochen, Zahlungsziel 30 Tage", 21],
      ["Delivery time 4 weeks, payment 30 days net", 28],
      ["Dodací lhůta 4 týdny, uskladnění zdarma 30 dní", 28],
    ] as const) {
      expectLead(parseLeadTime(text, { mode: "free-text" }), { days }, text);
      expectLead(parseLeadTime(text, { mode: "delivery-field" }), { days }, text);
    }
  });

  it("různé lhůty v položkách / poznámkách téže úrovně → nic; stejné → ta jedna", () => {
    const items = (a: string, b: string) => quoteTermsOfDoc(quoteDoc({
      deliveryTerms: "",
      items: [
        { drawingNumber: "A", revision: "", name: "A", description: a, material: "", quantity: 1, unit: "ks", unitPrice: 0, deliveryDate: "" },
        { drawingNumber: "B", revision: "", name: "B", description: b, material: "", quantity: 1, unit: "ks", unitPrice: 0, deliveryDate: "" },
      ],
    }), "136/026");
    expect(leadOfTerms(items("Dodací lhůta 2 týdny", "Dodací lhůta 6 týdnů"))).toBeNull();
    expect(leadOfTerms(items("Dodací lhůta 4 týdny", "Dodací lhůta 4 týdny"))).toMatchObject({ days: 28, source: "text", review: true });
    // dodací podmínky mají přednost před položkami (jiná úroveň)
    const both = quoteTermsOfDoc(quoteDoc({
      deliveryTerms: "Dodací lhůta 5 týdnů",
      items: [{ drawingNumber: "A", revision: "", name: "A", description: "Dodací lhůta 2 týdny", material: "", quantity: 1, unit: "ks", unitPrice: 0, deliveryDate: "" }],
    }), "136/026");
    expect(leadOfTerms(both)).toMatchObject({ days: 35 });
  });

  it("běžné kotvy a odrážky se najdou", () => {
    for (const [text, days] of [
      ["Dodací termín: 4 týdny od objednávky", 28],
      ["Dodací termín: do 14 dnů od objednávky", 14],
      ["Termín dodávky: 6 týdnů od objednávky", 42],
      ["Dodávka do 4 týdnů", 28],
      ["Dodávka: do 4 týdnů od objednávky", 28],
      ["Delivery lead time: 4 weeks", 28],
      ["- Dodací lhůta: 4 týdny", 28],
      ["• Dodací lhůta: 4 týdny", 28],
      ["1) Dodací lhůta: 4 týdny", 28],
      ["Lieferzeit: 4 Wochen nach Bestelleingang", 28],
    ] as const) {
      const r = through(text);
      for (const [where, got] of Object.entries(r)) expectLead(got, { days }, `${text} → ${where}`);
    }
    // frekvence dodávek dál nic
    expect(parseLeadTime("Dodávky 1× za 2 týdny", { mode: "free-text" })).toBeNull();
    expect(parseLeadTime("Dodávky každé 2 týdny", { mode: "free-text" })).toBeNull();
  });
});
