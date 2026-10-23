import { describe, it, expect } from "vitest";
import { leadOfExtracted, parseLeadTime, type LeadTime } from "./lead-time";
import { leadOfTerms, orderDeadline, parseLeadTimeInContext, quoteTermsOfDoc, quoteTermsOfQuote } from "./order-deadline";
import { emptyExtracted, emptyParty, normalizeExtracted } from "./extracted-normalize";
import type { ExtractedBusinessDoc } from "./capture-types";

/**
 * Lhůta z textu nabídky — KLADNÝ seznam (3. kolo): špatný termín je horší než žádný.
 * Dodací pole (deliveryLeadTime.text, deliveryTerms, quotes.delivery_terms) dovolí holou dobu („4 týdny"),
 * ale ne klauzule o něčem jiném. Volný text (poznámka, popis položky, shrnutí) jen u výslovného dodacího slova.
 */

type Want = { days: number; unit?: LeadTime["unit"]; from?: LeadTime["from"]; months?: number } | null;

const TODAY = "2026-10-23";
const STROJ = { ...emptyParty(), name: "STROJMETAL, a. s.", ico: "45274649" };
const order20 = (): ExtractedBusinessDoc => ({
  ...emptyExtracted(), docKind: "objednavka", issuer: "zakaznik", documentNumber: "8000060875", documentDate: "2026-10-20", customer: STROJ,
  items: [{ drawingNumber: "F00N603W84", revision: "", name: "Díl", description: "", material: "", quantity: 120, unit: "ks", unitPrice: 0, deliveryDate: "" }],
});
const quoteDoc = (over: Partial<ExtractedBusinessDoc>): ExtractedBusinessDoc => ({
  ...emptyExtracted(), docKind: "nabidka", issuer: "my", documentNumber: "136/026", ourQuoteNumber: "136/026", documentDate: "2026-10-10", customer: STROJ, ...over,
});

/** Dodací pole: [text, očekávaná lhůta | null]. */
const FIELD: [string, Want][] = [
  // ── MAJÍ se najít ──
  ["4 týdny", { days: 28, from: null }],
  ["Dodací lhůta: 4 týdny od objednávky", { days: 28, from: "objednavka" }],
  ["dodací lhůta 6–8 týdnů od potvrzení objednávky", { days: 56, from: "potvrzeni" }],
  ["Termín dodání: 5 týdnů od objednávky", { days: 35, from: "objednavka" }],
  ["dodání do 20 pracovních dnů od obdržení objednávky", { days: 20, unit: "pracovni", from: "objednavka" }],
  ["Expedice do 10 pracovních dnů", { days: 10, unit: "pracovni" }],
  ["Výroba 3 týdny po schválení výkresů", { days: 21, from: "podklady" }],
  ["cca 6 týdnů", { days: 42 }],
  ["Platnost nabídky 30 dní, dodací lhůta 4 týdny", { days: 28 }],
  ["Platba 14 dní netto; termín dodání 5 týdnů od objednávky", { days: 35, from: "objednavka" }],
  ["Splatnost faktury 30 dní. Dodání 3 týdny.", { days: 21 }],
  ["Záruka 24 měsíců, dodací lhůta 8 týdnů", { days: 56 }],
  ["24 měsíců záruka, dodání 6 týdnů", { days: 42 }],
  ["Nabídka je závazná 30 dní, výroba do 4 týdnů", { days: 28 }],
  ["8 týdnů od dodání výkresů", { days: 56, from: "podklady" }],
  ["Dodací lhůta – 4 týdny", { days: 28 }],
  ["Garantovaná dodací lhůta 4 týdny", { days: 28 }],
  ["Platba převodem 14 dní, dodání 4 týdny", { days: 28 }],
  ["Platba 14 dní, 4 týdny od objednání", { days: 28, from: "objednavka" }],
  ["Termín dodání: 3 měsíce", { days: 90, months: 3 }],
  ["Lieferzeit: 4 Wochen", { days: 28 }],
  ["Lieferzeit ca. 6–8 Wochen nach Auftragseingang", { days: 56, from: "objednavka" }],
  ["Liefertermin: 5 Wochen nach Bestellung", { days: 35, from: "objednavka" }],
  ["Lieferung innerhalb 10 Arbeitstagen", { days: 10, unit: "pracovni" }],
  ["Angebot gültig 30 Tage, Lieferzeit 3 Wochen", { days: 21 }],
  ["Zahlung 30 Tage netto, Lieferung in 4 Wochen", { days: 28 }],
  ["2 % Skonto 10 Tage, 30 Tage netto, Lieferzeit 5 Wochen", { days: 35 }],
  ["6 Wochen nach Auftragsbestätigung", { days: 42, from: "potvrzeni" }],
  ["Lieferzeit 3 Monate", { days: 90, months: 3 }],
  ["Lieferzeit 4 Wochen und 24 Monate Gewährleistung", { days: 28 }],
  ["Delivery time: 4-6 weeks ARO", { days: 42, from: "objednavka" }],
  ["Lead time 8 weeks after PO", { days: 56, from: "objednavka" }],
  ["Payment 30 days net, delivery 3 weeks", { days: 21 }],
  ["Quotation valid 30 days. Lead time: 6 weeks", { days: 42 }],
  ["Warranty 12 months, delivery within 15 working days", { days: 15, unit: "pracovni" }],
  ["ex stock", { days: 3, unit: "pracovni" }],
  ["skladem, splatnost 14 dní", { days: 3, unit: "pracovni" }],
  // ── NESMÍ se najít ──
  ["Platnost nabídky 30 dní", null],
  ["Nabídka platí 30 dní od data vystavení", null],
  ["Nabídka je závazná 60 dní", null],
  ["Nabídka je vázána 30 dní", null],
  ["Splatnost 14 dní od data vystavení faktury", null],
  ["Úhrada do 14 dnů od dodání", null],
  ["Platba převodem, 14 dní", null],
  ["24 měsíců záruka", null],
  ["Záruka 24 měsíců od předání", null],
  ["Reklamační lhůta 30 dní", null],
  ["Vady reklamujte do 8 dnů od převzetí", null],
  ["Záloha 30 % do 5 dnů od objednávky", null],
  ["Záloha 30 % při objednávce, doplatek 14 dní", null],
  ["Fakturace do 7 dnů po expedici", null],
  ["Vzorky do 2 týdnů", null],
  ["Termín vzorků 5 dnů", null],
  ["Podklady dodá zákazník do 5 pracovních dnů", null],
  ["dodání 10 týdnů od zaplacení zálohy", null],
  ["do 14 dnů od dodání", null],
  ["Reklamace do 14 dnů, platnost 30 dní", null],
  ["30 dní je platnost nabídky", null],
  ["2 % Skonto 10 Tage", null],
  ["2 % Skonto bei Zahlung innerhalb 10 Tagen, 30 Tage netto", null],
  ["Bindungsfrist 6 Wochen", null],
  ["Angebot freibleibend, Gültigkeit 4 Wochen", null],
  ["Zahlbar innerhalb 30 Tagen nach Rechnungsdatum", null],
  ["fällig 30 Tage nach Lieferung", null],
  ["30 Tage nach Lieferung", null],
  ["Anzahlung 30 %, Rest 14 Tage nach Lieferung", null],
  ["Gewährleistung 12 Monate", null],
  ["Mängelrüge innerhalb 8 Tagen", null],
  ["Erstmuster in 3 Wochen", null],
  ["Offer valid for 30 days", null],
  ["Payment due 30 days after invoice", null],
  ["Invoice payable within 14 days", null],
  ["Warranty: 12 months from delivery", null],
  ["Samples within 2 weeks", null],
  ["Deposit 30 % within 7 days of order", null],
  ["dle dohody", null],
  ["Termín dodání dle dohody, kalení 2 dny", null],
  ["nach Absprache", null],
  ["to be agreed", null],
  ["EXW Vimperk", null],
  ["Výroba dle 3D modelu", null],
];

/** Volný text (poznámka, popis položky, shrnutí). */
const FREE: [string, Want][] = [
  ["Kalení 2 dny, dodání 4 týdny", { days: 28 }],
  ["Dodací lhůta 6 týdnů", { days: 42 }],
  ["Termín dodání 5 týdnů od objednávky", { days: 35, from: "objednavka" }],
  ["dodání do 3 týdnů", { days: 21 }],
  ["dodání za 4 týdny", { days: 28 }],
  ["Expedice do 10 pracovních dnů", { days: 10, unit: "pracovni" }],
  ["Výroba do 15 pracovních dnů", { days: 15, unit: "pracovni" }],
  ["6 týdnů od objednání", { days: 42, from: "objednavka" }],
  ["Lieferzeit ca. 4 Wochen", { days: 28 }],
  ["Lieferung innerhalb 3 Wochen", { days: 21 }],
  ["5 Wochen nach Auftragseingang", { days: 35, from: "objednavka" }],
  ["delivery 4 weeks", { days: 28 }],
  ["lead time 6 weeks", { days: 42 }],
  ["4 weeks ARO", { days: 28, from: "objednavka" }],
  ["Platnost nabídky 30 dní, dodací lhůta 4 týdny", { days: 28 }],
  ["Platba 14 dní netto; termín dodání 5 týdnů od objednávky", { days: 35, from: "objednavka" }],
  ["Lieferung ab Lager", { days: 3, unit: "pracovni" }],
  // nic
  ["úhrada do 14 dnů od dodání", null],
  ["lhůta 30 dní pro reklamace", null],
  ["termín vzorků 5 dnů", null],
  ["Termín 4 týdny", null],
  ["Lhůta 4 týdny", null],
  ["Frist 4 Wochen", null],
  ["Kalení 2 dny", null],
  ["zkouška 5 dnů", null],
  ["4 týdny", null],
  ["Platnost 30 dní", null],
  ["do 14 dnů od dodání", null],
  ["30 Tage nach Lieferung", null],
  ["Zahlung 14 Tage nach Lieferung", null],
  ["materiál dodá zákazník do 5 dnů", null],
  ["Dodání vzorků do 2 týdnů", null],
  ["Záloha 30 % do 5 dnů od objednávky", null],
  ["skladem", null],
];

function check(r: LeadTime | null, want: Want, label: string) {
  if (want === null) {
    expect(r, label).toBeNull();
    return;
  }
  expect(r, label).not.toBeNull();
  expect(r!.days, label).toBe(want.days);
  if (want.unit) expect(r!.unit, label).toBe(want.unit);
  if (want.from !== undefined) expect(r!.from, label).toBe(want.from);
  if (want.months) expect(r!.months, label).toBe(want.months);
}

describe("lhůta — kladný seznam: dodací pole", () => {
  it(`tabulka má ≥ 60 formulací (${FIELD.length + FREE.length})`, () => {
    expect(FIELD.length + FREE.length).toBeGreaterThanOrEqual(60);
  });
  it.each(FIELD)("parseLeadTime(„%s“)", (text, want) => {
    check(parseLeadTime(text, { mode: "delivery-field" }), want, text);
    // výchozí režim = dodací pole
    check(parseLeadTime(text), want, text);
  });
  it.each(FIELD)("orderDeadline s dodacími podmínkami „%s“", (text, want) => {
    const d = orderDeadline({ order: order20(), quotes: [quoteTermsOfDoc(quoteDoc({ deliveryTerms: text }), "136/026")], today: TODAY });
    if (want === null) expect(d.proposal, text).toBeNull();
    else expect(d.proposal?.lead?.days, text).toBe(want.days);
    // stejný text v nabídce v systému (quotes.delivery_terms)
    const sys = orderDeadline({ order: order20(), quotes: [quoteTermsOfQuote({ number: "136/026", leadTimeDays: null, deliveryTerms: text, note: null })], today: TODAY });
    expect(sys.proposal?.lead?.days ?? null, text).toBe(want?.days ?? null);
  });
});

describe("lhůta — kladný seznam: volný text (poznámka / popis / shrnutí)", () => {
  it.each(FREE)("parseLeadTime(„%s“, free-text)", (text, want) => {
    check(parseLeadTime(text, { mode: "free-text" }), want, text);
    check(parseLeadTimeInContext(text), want, text);
  });
  it.each(FREE)("orderDeadline s poznámkou nabídky „%s“", (text, want) => {
    const d = orderDeadline({ order: order20(), quotes: [quoteTermsOfDoc(quoteDoc({ deliveryTerms: "", note: text }), "136/026")], today: TODAY });
    expect(d.proposal?.lead?.days ?? null, text).toBe(want?.days ?? null);
    const sys = orderDeadline({ order: order20(), quotes: [quoteTermsOfQuote({ number: "136/026", leadTimeDays: null, deliveryTerms: "EXW Vimperk", note: text })], today: TODAY });
    expect(sys.proposal?.lead?.days ?? null, text).toBe(want?.days ?? null);
  });
});

// ── 3. kolo — nálezy 1–3 (reprodukce) ───────────────────────
describe("3. kolo — nález 1: záruka / Skonto ZA číslem, synonyma úhrada, závaznost, Bindungsfrist, záloha, fakturace, fällig, due", () => {
  it.each([
    "24 měsíců záruka", "2 % Skonto 10 Tage", "Úhrada 14 dní", "Nabídka je závazná 30 dní", "Bindungsfrist 30 Tage",
    "Záloha 50 % do 7 dnů", "Fakturace 14 dní po dodání", "fällig 30 Tage", "Due 30 days", "Payment due within 30 days",
  ])("„%s“ → nic", (text) => {
    expect(parseLeadTime(text)).toBeNull();
    expect(parseLeadTime(text, { mode: "free-text" })).toBeNull();
  });
});

describe("3. kolo — nález 2: skutečná lhůta za platbou / platností se slovem „termín“ / „lhůta“ se neztratí", () => {
  it("„Platnost nabídky 30 dní, dodací lhůta 4 týdny“ → 4 týdny", () => {
    expect(parseLeadTime("Platnost nabídky 30 dní, dodací lhůta 4 týdny")).toMatchObject({ days: 28 });
  });
  it("„Platba 14 dní netto; termín dodání 5 týdnů od objednávky“ → 5 týdnů od objednávky", () => {
    expect(parseLeadTime("Platba 14 dní netto; termín dodání 5 týdnů od objednávky")).toMatchObject({ days: 35, from: "objednavka" });
    expect(parseLeadTime("Platba 14 dní netto, termín dodání 5 týdnů od objednávky")).toMatchObject({ days: 35, from: "objednavka" });
    expect(parseLeadTime("Platební lhůta 14 dní, dodací lhůta 5 týdnů")).toMatchObject({ days: 35 });
  });
});

describe("3. kolo — nález 3: poznámka nabídky nedá lhůtu z úhrady / reklamace / vzorků", () => {
  it.each(["úhrada do 14 dnů od dodání", "lhůta 30 dní pro reklamace", "termín vzorků 5 dnů"])("poznámka „%s“ → žádný termín", (note) => {
    expect(parseLeadTimeInContext(note)).toBeNull();
    const q = quoteTermsOfDoc(quoteDoc({ deliveryTerms: "", note, summary: "" }), "136/026");
    expect(leadOfTerms(q)).toBeNull();
    expect(orderDeadline({ order: order20(), quotes: [q], today: TODAY }).proposal).toBeNull();
  });
});

// ── (a) strukturované pole deliveryLeadTime z AI ───────────
describe("deliveryLeadTime — strukturovaná dodací lhůta z AI", () => {
  it("normalizace: jednotky, od čeho, prázdné = null", () => {
    const d = normalizeExtracted({ docKind: "nabidka", issuer: "my", deliveryLeadTime: { value: "4", unit: "týdny", from: "objednávka", text: " 4 týdny od objednávky " } });
    expect(d.deliveryLeadTime).toEqual({ value: 4, unit: "tydny", from: "objednavka", text: "4 týdny od objednávky" });
    expect(normalizeExtracted({ deliveryLeadTime: { value: 0, unit: "", from: "", text: "" } }).deliveryLeadTime).toBeNull();
    expect(normalizeExtracted({}).deliveryLeadTime).toBeNull();
    expect(normalizeExtracted({ deliveryLeadTime: { value: 30, unit: "pracovní dny", from: "", text: "" } }).deliveryLeadTime)
      .toEqual({ value: 30, unit: "pracovni_dny", from: null, text: "" });
    expect(normalizeExtracted({ deliveryLeadTime: { value: 2, unit: "months", from: "jine", text: "2 měsíce" } }).deliveryLeadTime)
      .toMatchObject({ value: 2, unit: "mesice", from: "jine" });
    expect(emptyExtracted().deliveryLeadTime).toBeNull();
  });
  it("převod na lhůtu: dny / pracovní dny / týdny / měsíce; rozpětí z textu; „jine“ a jiná podmínka = nic", () => {
    expect(leadOfExtracted({ value: 4, unit: "tydny", from: "objednavka", text: "4 týdny od objednávky" })).toMatchObject({ days: 28, unit: "kalendarni", from: "objednavka" });
    expect(leadOfExtracted({ value: 20, unit: "pracovni_dny", from: "potvrzeni", text: "" })).toMatchObject({ days: 20, unit: "pracovni", from: "potvrzeni" });
    expect(leadOfExtracted({ value: 3, unit: "mesice", from: null, text: "" })).toMatchObject({ days: 90, months: 3 });
    expect(leadOfExtracted({ value: 8, unit: "tydny", from: null, text: "6–8 týdnů" })).toMatchObject({ days: 56, range: [42, 56] });
    // „jine" = blok (nečte se ani zbytek nabídky)
    expect(leadOfExtracted({ value: 4, unit: "tydny", from: "jine", text: "4 týdny od dodání materiálu" })).toEqual({ blocked: true, text: "4 týdny od dodání materiálu" });
    expect(leadOfExtracted({ value: 30, unit: "dny", from: null, text: "Platnost nabídky 30 dní" })).toBeNull();
    expect(leadOfExtracted({ value: 0, unit: "dny", from: null, text: "Lieferzeit 5 Wochen" })).toMatchObject({ days: 35 });
    expect(leadOfExtracted(null)).toBeNull();
  });
  it("priorita: quotes.lead_time_days > deliveryLeadTime > dodací podmínky > poznámka", () => {
    const doc = quoteDoc({
      deliveryLeadTime: { value: 5, unit: "tydny", from: "objednavka", text: "5 týdnů od objednávky" },
      deliveryTerms: "Dodací lhůta 3 týdny", note: "dodání 2 týdny",
    });
    const q = quoteTermsOfDoc(doc, "136/026");
    expect(leadOfTerms(q)).toMatchObject({ days: 35, from: "objednavka" });
    expect(leadOfTerms({ ...q, leadTimeDays: 14 })).toMatchObject({ days: 14 });
    expect(leadOfTerms({ ...q, structured: null })).toMatchObject({ days: 21 });
    // objednávka 20. 10. + 5 týdnů → 24. 11. 2026
    expect(orderDeadline({ order: order20(), quotes: [q], today: TODAY }).proposal?.date).toBe("2026-11-24");
  });
  it("reálný termín objednávky se nepřepisuje ani strukturovanou lhůtou", () => {
    const q = quoteTermsOfDoc(quoteDoc({ deliveryLeadTime: { value: 5, unit: "tydny", from: "objednavka", text: "" } }), "136/026");
    const d = orderDeadline({ order: { ...order20(), requiredDeliveryDate: "2026-12-04" }, quotes: [q], today: TODAY });
    expect(d).toMatchObject({ realistic: true, current: "2026-12-04", proposal: null });
  });
});

// ── 4. kolo — nálezy 1–6 (reprodukce) ───────────────────────
/** Text → očekávané dny (null = nic) v obou režimech i přes orderDeadline (doklad, quotes.delivery_terms, poznámka). */
function everywhere(text: string, days: number | null, opts: { free?: boolean } = {}) {
  expect(parseLeadTime(text, { mode: "delivery-field" })?.days ?? null, `pole: ${text}`).toBe(days);
  const doc = orderDeadline({ order: order20(), quotes: [quoteTermsOfDoc(quoteDoc({ deliveryTerms: text }), "136/026")], today: TODAY });
  expect(doc.proposal?.lead?.days ?? null, `deliveryTerms: ${text}`).toBe(days);
  const sys = orderDeadline({ order: order20(), quotes: [quoteTermsOfQuote({ number: "136/026", leadTimeDays: null, deliveryTerms: text, note: null })], today: TODAY });
  expect(sys.proposal?.lead?.days ?? null, `quotes.delivery_terms: ${text}`).toBe(days);
  if (opts.free !== false) {
    expect(parseLeadTime(text, { mode: "free-text" })?.days ?? null, `volný text: ${text}`).toBe(days);
    const note = orderDeadline({ order: order20(), quotes: [quoteTermsOfDoc(quoteDoc({ deliveryTerms: "", note: text }), "136/026")], today: TODAY });
    expect(note.proposal?.lead?.days ?? null, `poznámka: ${text}`).toBe(days);
  }
}

describe("4. kolo — nález 1: lhůta od zálohy / platby / materiálu / dokončení výroby = nic (kladný seznam „od čeho“)", () => {
  it.each([
    "Dodací lhůta 4 týdny od uhrazení zálohy", "Dodací lhůta 4 týdny od uhrazení zálohové faktury", "Dodací lhůta 4 týdny po připsání platby",
    "Dodací lhůta 4 týdny od připsání zálohy", "Dodací lhůta 4 týdny od složení zálohy", "Dodací lhůta 4 týdny od úhrady zálohy",
    "Dodací lhůta 4 týdny od zaplacení zálohy", "Lieferzeit 4 Wochen nach Erhalt der Vorauszahlung", "Lieferzeit 4 Wochen nach Eingang Ihrer Anzahlung",
    "Delivery 4 weeks after receipt of down payment", "Delivery 4 weeks after receipt of advance payment", "Dodací lhůta 3 týdny od obdržení materiálu",
    "Dodací lhůta 3 týdny od přijetí materiálu", "Lieferzeit 4 Wochen nach Materialeingang", "Delivery 4 weeks after receipt of material",
    "Expedice do 2 pracovních dnů po dokončení výroby", "Versand 2 Tage nach Fertigstellung", "4 týdny od objednávky a uhrazení zálohy",
    "Dodací lhůta 4 týdny (od zaplacení zálohy)", "Lieferzeit 4 Wochen nach technischer Klärung",
  ])("„%s“ → nic", (text) => everywhere(text, null));
  it.each([
    ["4 týdny od obdržení vaší objednávky", 28, "objednavka"], ["4 weeks from receipt of your order", 28, "objednavka"],
    ["Lieferzeit 4 Wochen nach Eingang Ihrer Bestellung", 28, "objednavka"], ["Dodací lhůta 3 týdny od dodání výkresů", 21, "podklady"],
    ["Lieferzeit 6 Wochen nach Freigabe der Zeichnungen", 42, "podklady"], ["Dodání 5 týdnů od potvrzení objednávky", 35, "potvrzeni"],
  ] as const)("„%s“ → %i dní (%s)", (text, days, from) => {
    everywhere(text, days);
    expect(parseLeadTime(text)?.from).toBe(from);
  });
  it("AI from „jine“ zablokuje i dodací podmínky, poznámku a shrnutí téže nabídky (→ doplň termín)", () => {
    const x = { value: 4, unit: "tydny" as const, from: "jine" as const, text: "4 týdny od připsání zálohy" };
    expect(leadOfExtracted(x)).toMatchObject({ blocked: true });
    const q = quoteTermsOfDoc(quoteDoc({ deliveryLeadTime: x, deliveryTerms: "Dodací lhůta 4 týdny od připsání zálohy" }), "136/026");
    expect(leadOfTerms(q)).toBeNull();
    expect(orderDeadline({ order: order20(), quotes: [q], today: TODAY }).proposal).toBeNull();
    const mat = quoteTermsOfDoc(quoteDoc({
      deliveryLeadTime: { value: 3, unit: "tydny", from: "jine", text: "3 týdny od dodání materiálu" },
      deliveryTerms: "Dodání 3 týdny", note: "dodání 3 týdny", summary: "Nabídka, dodání 3 týdny.",
    }), "136/026");
    expect(orderDeadline({ order: order20(), quotes: [mat], today: TODAY }).proposal).toBeNull();
    // quotes.lead_time_days má přednost i před blokem
    expect(leadOfTerms({ ...q, leadTimeDays: 14 })).toMatchObject({ days: 14 });
    // AI bez „od čeho“, ale text běží od zálohy → také blok
    expect(leadOfExtracted({ value: 4, unit: "tydny", from: null, text: "4 týdny od připsání zálohy" })).toMatchObject({ blocked: true });
  });
});

describe("4. kolo — nález 2: zahájení výroby / vzorky / Erstmuster / expres nevyhrají nad dodací lhůtou", () => {
  it.each([
    ["Production start 1 week after PO, delivery 6 weeks", 42], ["Zahájení výroby do 5 dnů od objednávky, dodání 6 týdnů", 42],
    ["Produktionsbeginn 1 Woche nach Bestellung, Lieferzeit 5 Wochen", 35], ["Erstmuster: Lieferung 2 Wochen, Serie: Lieferung 6 Wochen", 42],
    ["Vzorky: dodání 2 týdny, série: dodání 6 týdnů", 42], ["Prototyp: výroba 1 týden", null],
    ["Expresní příplatek 20 % za dodání do 2 týdnů, standardní dodací lhůta 6 týdnů", 42], ["Výroba 2 týdny, dodání 5 týdnů", 35],
    ["Výroba do 2 týdnů od objednávky, dodací lhůta 6 týdnů", 42], ["Samples: delivery 2 weeks, series: delivery 6 weeks", 42],
    ["Dodání do 2 týdnů za příplatek, standardní dodací lhůta 6 týdnů", 42], ["Eillieferung 1 Woche, Lieferzeit 4 Wochen", 28],
    // expedice běží po výrobě — nevyhraje; výslovné dodání kratší než výroba = nejistota
    ["Výroba 3 týdny, expedice 2 dny", 21], ["Výroba 6 týdnů, dodání 2 týdny", null], ["Fertigung 5 Wochen, Versand 2 Tage", 35],
  ] as const)("volný text „%s“ → %s", (text, days) => {
    expect(parseLeadTime(text, { mode: "free-text" })?.days ?? null, text).toBe(days);
    const d = orderDeadline({ order: order20(), quotes: [quoteTermsOfDoc(quoteDoc({ deliveryTerms: "", note: text }), "136/026")], today: TODAY });
    expect(d.proposal?.lead?.days ?? null, text).toBe(days);
    expect(parseLeadTime(text, { mode: "delivery-field" })?.days ?? null, text).toBe(days);
  });
  it("dodací pole: „Expres do 2 týdnů za příplatek, dodací lhůta 6 týdnů“ → 6 týdnů", () => {
    everywhere("Expres do 2 týdnů za příplatek, dodací lhůta 6 týdnů", 42, { free: false });
  });
});

describe("4. kolo — nález 3: frekvence dílčích dodávek není dodací lhůta", () => {
  it.each([
    "DAP Praha, dílčí dodávky každé 2 týdny", "Lieferung alle 2 Wochen", "Teillieferungen alle 4 Wochen", "FCA, deliveries every 2 weeks",
    "Dodávky po 500 ks každé 2 týdny", "Dodávky 1x za 2 týdny", "Lieferung 2 Wochen wöchentlich", "Abrufe jede 2 Wochen",
  ])("„%s“ → nic", (text) => everywhere(text, null));
  it("„Dodací lhůta 6 týdnů, dílčí dodávky každé 2 týdny“ → 6 týdnů", () => everywhere("Dodací lhůta 6 týdnů, dílčí dodávky každé 2 týdny", 42));
});

describe("4. kolo — nález 4: „od obdržení závazné / platné objednávky“, „valid PO“ se najde", () => {
  it.each([
    ["Dodací lhůta: 4–6 týdnů od obdržení závazné objednávky", 42], ["Dodací lhůta 4 týdny od obdržení závazné objednávky", 28],
    ["Termín dodání: 6 týdnů od přijetí závazné objednávky", 42], ["Dodání: 4 týdny od závazné objednávky", 28],
    ["Dodací lhůta 4 týdny od obdržení platné objednávky", 28], ["Delivery: 4 weeks after receipt of valid PO", 28],
    ["Lieferzeit 4 Wochen nach Eingang der verbindlichen Bestellung", 28], ["Lead time 6 weeks after receipt of firm order", 42],
  ] as const)("„%s“ → %i dní od objednávky", (text, days) => {
    everywhere(text, days);
    expect(parseLeadTime(text)?.from).toBe("objednavka");
  });
  it("strukturované pole AI s textem „4–6 týdnů od obdržení závazné objednávky“ → 6 týdnů", () => {
    const x = { value: 6, unit: "tydny" as const, from: "objednavka" as const, text: "4–6 týdnů od obdržení závazné objednávky" };
    expect(leadOfExtracted(x)).toMatchObject({ days: 42, range: [28, 42], from: "objednavka" });
    const q = quoteTermsOfDoc(quoteDoc({ deliveryLeadTime: x }), "136/026");
    expect(orderDeadline({ order: order20(), quotes: [q], today: TODAY }).proposal?.date).toBe("2026-12-01");
  });
  it("závaznost / platnost nabídky dál nic", () => {
    for (const t of ["Nabídka je závazná 30 dní", "Platnost nabídky 30 dní", "Offer valid for 30 days", "Nabídka platná 30 dní od objednávky"]) everywhere(t, null);
  });
});

describe("4. kolo — nález 5: hodnota AI v rozporu s vlastním textem pole = nejistota → doplň termín", () => {
  it("{14 dny, „Splatnost 14 dní, dodání 4 týdny“} → žádný návrh", () => {
    const d = normalizeExtracted({ docKind: "nabidka", issuer: "my", deliveryLeadTime: { value: 14, unit: "dny", from: null, text: "Splatnost 14 dní, dodání 4 týdny" } });
    expect(leadOfExtracted(d.deliveryLeadTime)).toMatchObject({ blocked: true });
    const q = quoteTermsOfDoc(quoteDoc({ deliveryLeadTime: d.deliveryLeadTime, deliveryTerms: "Splatnost 14 dní, dodání 4 týdny" }), "136/026");
    expect(orderDeadline({ order: order20(), quotes: [q], today: TODAY }).proposal).toBeNull();
    // shoda hodnoty a textu → platí
    expect(leadOfExtracted({ value: 4, unit: "tydny", from: null, text: "Splatnost 14 dní, dodání 4 týdny" })).toMatchObject({ days: 28 });
  });
});

describe("4. kolo — nález 6: zkratky jednotek na konci textu („Wo.“, „měs.“, „Mon.“)", () => {
  it.each([
    ["Lieferzeit ca. 6-8 Wo.", 56], ["Lieferzeit 4 Wo.", 28], ["Lieferzeit: ca. 4 Wo.", 28], ["Dodací lhůta 3 měs.", 90],
    ["Lieferzeit 3 Mon.", 90], ["Lieferzeit: 4 Wo. nach Auftrag", 28], ["Lieferzeit 6-8 Wo", 56],
  ] as const)("„%s“ → %i dní", (text, days) => everywhere(text, days));
});

describe("4. kolo — kombinace podmínek v jedné větě (dodací pole, quotes.delivery_terms, poznámka)", () => {
  it.each([
    ["Platnost nabídky 30 dní, dodací lhůta 4 týdny od obdržení závazné objednávky", 28],
    ["Splatnost 14 dní od dodání, dodání 5 týdnů od objednávky", 35],
    ["Záloha 30 % do 5 dnů od objednávky, dodací lhůta 6 týdnů od připsání zálohy", null],
    ["Vzorky do 2 týdnů, dodání série 6 týdnů od schválení vzorků", null],
    ["Lieferzeit 4 Wochen nach Auftragseingang, Zahlung 30 Tage netto", 28],
    ["Delivery 6 weeks ARO, payment 30 days net, warranty 12 months", 42],
    ["Reklamace do 14 dnů od dodání, dodací lhůta 3 týdny", 21],
    ["Angebot gültig 4 Wochen, Lieferzeit 6-8 Wo.", 56],
    ["Skonto 2 % bei Zahlung innerhalb 10 Tagen, Lieferzeit ca. 5 Wochen nach Bestellung", 35],
    ["Quotation valid 60 days; lead time 4 weeks after receipt of your order", 28],
    ["Dodací lhůta 4 týdny od objednávky, dílčí dodávky každé 2 týdny, záruka 24 měsíců", 28],
    ["Erstmuster 2 Wochen nach Bestellung, Lieferzeit Serie 6 Wochen nach Freigabe der Erstmuster", null],
  ] as const)("„%s“ → %s", (text, days) => everywhere(text, days));
});
