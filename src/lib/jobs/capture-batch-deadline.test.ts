import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  groupBatch, groupDocOf, reconcileGroup, refersToDrawingQty,
  type GroupDraft, type GroupJobCandidate, type ReconcileDoc,
} from "./capture-batch-reconcile";
import { emptyDrawing, normalizeDrawing } from "./capture-batch";
import type { BatchDocType, DrawingExtract } from "./capture-batch-types";
import type { ExtractedBusinessDoc, ExtractedItem, ExtractedParty } from "./capture-types";
import { emptyExtracted, emptyParty, normalizeExtracted } from "./extracted-normalize";
import { orderDeadline, quoteTermsOfDoc, quoteTermsOfQuote } from "./order-deadline";
import type { JobDetail } from "./types";

/**
 * Pravidla dávky 2 (majitel): objednávka bez reálného termínu → termín z nabídky (lhůta od data objednání);
 * počty kusů u výkresů objednávka > nabídka > poptávka > výkres (výjimka „dle výkresu"); názvy výkresů
 * = název z objednávky; jedno nahrání = jedna zakázka (produkční případ 8000060875/GPO84339 + nabídka 136/026).
 */

const TODAY = "2026-10-23";
const OUR = "04304080";
const STROJ: ExtractedParty = { ...emptyParty(), name: "STROJMETAL, a. s.", ico: "45274649" };
const FIX = path.join(__dirname, "__fixtures__", "capture", "batch");

const item = (drawingNumber: string, over: Partial<ExtractedItem> = {}): ExtractedItem => ({
  drawingNumber, revision: "", name: `Díl ${drawingNumber}`, description: "", material: "", quantity: 10, unit: "ks", unitPrice: 0, deliveryDate: "", ...over,
});
const bdoc = (over: Partial<ExtractedBusinessDoc>): ExtractedBusinessDoc => ({ ...emptyExtracted(), confidence: 0.92, ...over });
const order = (over: Partial<ExtractedBusinessDoc> = {}) => bdoc({
  docKind: "objednavka", issuer: "zakaznik", documentNumber: "PO-1", customerOrderNumber: "PO-1", documentDate: "2026-10-21", customer: STROJ,
  items: [item("4711-02", { quantity: 50 })], ...over,
});
const quote = (over: Partial<ExtractedBusinessDoc> = {}) => bdoc({
  docKind: "nabidka", issuer: "my", documentNumber: "NAB-6", ourQuoteNumber: "NAB-6", documentDate: "2026-10-10", customer: STROJ,
  items: [item("4711-02", { quantity: 40 })], deliveryTerms: "Dodací lhůta 4 týdny od objednání", ...over,
});
const inquiry = (over: Partial<ExtractedBusinessDoc> = {}) => bdoc({
  docKind: "poptavka", issuer: "zakaznik", documentNumber: "RFQ-1", customerInquiryNumber: "RFQ-1", customer: STROJ, items: [item("4711-02")], ...over,
});
const drawing = (over: Partial<DrawingExtract> = {}): DrawingExtract => ({ ...emptyDrawing(), customerName: "Konstrukce Novák", ...over });

let seq = 0;
function rd(type: BatchDocType, over: Partial<ReconcileDoc> & { doc?: ExtractedBusinessDoc; dr?: DrawingExtract } = {}): ReconcileDoc {
  const { doc, dr, ...rest } = over;
  const id = rest.id ?? `d${++seq}`;
  return {
    id, type, flags: [], documentNumber: doc?.documentNumber ?? dr?.drawingNumber ?? "", drawingNumbers: [], title: "", filename: `${id}.jpg`,
    aiType: type, extract: doc ? { kind: "business", doc } : dr ? { kind: "drawing", drawing: dr } : null, aiUsed: Boolean(doc || dr),
    reason: null, confidence: null, customerMatch: null, supplierMatch: null, strongMatch: null, ...rest,
  };
}
const group = (docs: ReconcileDoc[], over: Partial<GroupDraft> = {}): GroupDraft => ({
  key: "g1", docIds: docs.map((d) => d.id), targetJobId: null, targetRequired: false, autoReason: null, customerName: "", partyKey: "", ...over,
});
function reconcile(docs: ReconcileDoc[], over: { jobs?: GroupJobCandidate[]; group?: Partial<GroupDraft>; fixedJobId?: string | null } = {}) {
  return reconcileGroup({
    captureId: "c0000000-0000-4000-8000-000000000001", group: group(docs, over.group), docs, margins: true,
    mode: "approval", ourIco: OUR, fixedJobId: over.fixedJobId ?? null, jobs: over.jobs ?? [], today: TODAY,
  });
}
function job(over: Partial<JobDetail> = {}): JobDetail {
  return {
    id: "11111111-1111-4111-8111-111111111111", number: "Z-2026-031", title: "Zakázka", stage: "nabidka",
    customer: { id: "c1", name: "Strojmetal a.s." }, supplier: null, items: [], quotes: [], files: [], events: [],
    customerOrderNumber: null, customerInquiryNumber: null, customerContact: null, customerContactEmail: null, customerContactPhone: null,
    inquiryDate: null, orderDate: null, customerRequiredDate: null, dueDate: null, expectedDeliveryDate: null, supplierPromisedDate: null,
    value: null, supplierOrderNumber: null, invoiceNumber: null, deliveryNoteNumber: null,
    ...over,
  } as unknown as JobDetail;
}
const fixture = (name: string): unknown => JSON.parse(readFileSync(path.join(FIX, `${name}.json`), "utf8"));
const fxDoc = (type: BatchDocType, name: string, over: Partial<ReconcileDoc> = {}) => rd(type, { doc: normalizeExtracted(fixture(name)), ...over });
const fxDrawing = (name: string, over: Partial<ReconcileDoc> = {}) => rd("vykres", { dr: normalizeDrawing(fixture(name)), ...over });

describe("orderDeadline (čistá logika)", () => {
  const q = quoteTermsOfDoc(quote(), "NAB-6", { docId: "dq" });
  it("bez termínu → z nabídky 4 týdny od data objednávky", () => {
    const d = orderDeadline({ order: order(), quotes: [q], today: TODAY });
    expect(d).toMatchObject({ realistic: false, reason: "missing" });
    expect(d.proposal).toMatchObject({ date: "2026-11-18", from: "quote", docId: "dq", label: "z nabídky NAB-6 (4 týdny od objednání → 18. 11. 2026)" });
  });
  it("termín = datum objednávky / v minulosti / před objednávkou → nereálný", () => {
    expect(orderDeadline({ order: order({ requiredDeliveryDate: "2026-10-21" }), quotes: [q], today: TODAY }).reason).toBe("same_as_order");
    expect(orderDeadline({ order: order({ requiredDeliveryDate: "2026-10-22" }), quotes: [q], today: TODAY }).reason).toBe("past");
    expect(orderDeadline({ order: order({ requiredDeliveryDate: "2026-10-01" }), quotes: [q], today: TODAY }).reason).toBe("before_order");
  });
  it("reálný termín se nepřepisuje — jen info o rozdílu proti nabídce", () => {
    const d = orderDeadline({ order: order({ requiredDeliveryDate: "2026-12-04" }), quotes: [q], today: TODAY });
    expect(d).toMatchObject({ realistic: true, current: "2026-12-04", proposal: null });
    expect(d.differs).toMatch(/Termín objednávky 4\. 12\. 2026 se liší od nabídky NAB-6 .* platí objednávka/);
  });
  it("hlavička bez termínu, položky s reálným termínem → nejbližší termín položky", () => {
    const d = orderDeadline({ order: order({ items: [item("A", { deliveryDate: "2026-12-11" }), item("B", { deliveryDate: "2026-12-04" })] }), quotes: [q], today: TODAY });
    expect(d).toMatchObject({ realistic: true, current: "2026-12-04", fromItems: true });
  });
  it("absolutní reálný termín nabídky má přednost před lhůtou; objednávka bez data → od dneška", () => {
    const abs = quoteTermsOfDoc(quote({ promisedDeliveryDate: "2026-12-01" }), "NAB-6");
    expect(orderDeadline({ order: order(), quotes: [abs], today: TODAY }).proposal?.date).toBe("2026-12-01");
    const d = orderDeadline({ order: order({ documentDate: "" }), quotes: [q], today: TODAY });
    expect(d.proposal?.date).toBe("2026-11-20");
    expect(d.proposal?.label).toMatch(/od dneška/);
  });
  it("pracovní dny přes svátek 28. 10. a 17. 11.; nabídka v systému (lead_time_days)", () => {
    const pd = quoteTermsOfDoc(quote({ deliveryTerms: "15 pracovních dnů od objednávky" }), "NAB-7");
    // st 21. 10. + 15 prac. dnů: 22, 23, 26, 27, (28. 10. svátek) 29, 30, 2, 3, 4, 5, 6, 9, 10, 11, 12 → 12. 11.
    expect(orderDeadline({ order: order(), quotes: [pd], today: TODAY }).proposal?.date).toBe("2026-11-12");
    const sys = quoteTermsOfQuote({ number: "NAB-2026-031", leadTimeDays: 30, deliveryTerms: null, note: null });
    const d = orderDeadline({ order: order(), quotes: [sys], today: TODAY });
    expect(d.proposal).toMatchObject({ date: "2026-11-20", label: "z nabídky NAB-2026-031 v systému (30 dnů od objednání → 20. 11. 2026)" });
  });
  it("„dle dohody“ / bez nabídky → poptávka (požadovaný termín), jinak nic", () => {
    const agreed = quoteTermsOfDoc(quote({ deliveryTerms: "dle dohody", summary: "" }), "NAB-8");
    const inq = { number: "RFQ-1", date: "2026-12-15", texts: [], docId: "di" };
    expect(orderDeadline({ order: order(), quotes: [agreed], inquiry: inq, today: TODAY }).proposal).toMatchObject({ date: "2026-12-15", from: "inquiry" });
    expect(orderDeadline({ order: order(), quotes: [agreed], today: TODAY }).proposal).toBeNull();
  });
});

describe("dávka: termín zakázky z nabídky", () => {
  it("objednávka bez termínu + nabídka 4 týdny → požadovaný i potvrzený termín se zdrojem + info", () => {
    const po = rd("objednavka_zakaznik", { doc: order() });
    const nab = rd("nabidka_my", { doc: quote() });
    const r = reconcile([po, nab]);
    const t = r.review.model.targets.find((x) => x.key === "new")!;
    expect(t.proposed.customerRequiredDate).toBe("2026-11-18");
    expect(t.proposed.dueDate).toBe("2026-11-18");
    expect(r.state.job.fields.customerRequiredDate).toBe("2026-11-18");
    expect(r.review.fieldSources.customerRequiredDate).toEqual({ docId: nab.id, label: "z nabídky NAB-6 (4 týdny od objednání → 18. 11. 2026)" });
    expect(r.review.fieldSources.dueDate?.label).toMatch(/z nabídky NAB-6/);
    const w = r.warnings.find((x) => x.code === "deadline_from_quote")!;
    expect(w).toMatchObject({ severity: "info", groupKey: "g1" });
    expect(w.message).toBe("Objednávka nemá reálný termín (chybí) — převzat z nabídky NAB-6 (4 týdny od objednání → 18. 11. 2026).");
  });
  it("termín = datum objednávky / v minulosti → z nabídky", () => {
    for (const due of ["2026-10-21", "2026-10-22"]) {
      const r = reconcile([rd("objednavka_zakaznik", { doc: order({ requiredDeliveryDate: due }) }), rd("nabidka_my", { doc: quote() })]);
      expect(r.state.job.fields.customerRequiredDate).toBe("2026-11-18");
    }
  });
  it("objednávka s reálným termínem → beze změny (dueDate nenavrhuje), jen info o rozdílu", () => {
    const r = reconcile([rd("objednavka_zakaznik", { doc: order({ requiredDeliveryDate: "2026-12-04" }) }), rd("nabidka_my", { doc: quote() })]);
    expect(r.state.job.fields.customerRequiredDate).toBe("2026-12-04");
    expect(r.state.job.fields.dueDate ?? "").toBe("");
    expect(r.warnings.find((x) => x.code === "deadline_from_quote")?.message).toMatch(/platí objednávka/);
  });
  it("bez naší nabídky → požadovaný termín z poptávky (potvrzený ne)", () => {
    const r = reconcile([rd("objednavka_zakaznik", { doc: order() }), rd("poptavka_zakaznik", { doc: inquiry({ requiredDeliveryDate: "2026-12-15" }) })]);
    expect(r.state.job.fields.customerRequiredDate).toBe("2026-12-15");
    expect(r.state.job.fields.dueDate ?? "").toBe("");
    expect(r.review.fieldSources.customerRequiredDate?.label).toBe("z poptávky RFQ-1 (požadovaný termín 15. 12. 2026)");
  });
  it("existující zakázka s nabídkou v systému (bez nabídky v dávce) → termín z nabídky v systému", () => {
    const po = rd("objednavka_zakaznik", { doc: order() });
    const j = job();
    const r = reconcile([po], {
      group: { targetJobId: j.id },
      jobs: [{ job: j, reason: "podle čísla nabídky", score: 95, quoteTerms: [quoteTermsOfQuote({ number: "NAB-2026-031", leadTimeDays: null, deliveryTerms: "4 týdny od objednávky", note: null })] }],
    });
    const t = r.review.model.targets.find((x) => x.key === j.id)!;
    expect(t.proposed.customerRequiredDate).toBe("2026-11-18");
    expect(t.proposed.dueDate).toBe("2026-11-18");
    expect(r.review.fieldSources.customerRequiredDate?.label).toBe("z nabídky NAB-2026-031 v systému (4 týdny od objednání → 18. 11. 2026)");
    expect(r.warnings.find((x) => x.code === "deadline_from_quote")?.message).toMatch(/převzat z nabídky NAB-2026-031 v systému/);
    // zakázka s vlastním termínem → nepřepisuje se
    const j2 = job({ customerRequiredDate: "2026-12-20", dueDate: "2026-12-20" } as Partial<JobDetail>);
    const r2 = reconcile([po], { group: { targetJobId: j2.id }, jobs: [{ job: j2, reason: null, score: 95, quoteTerms: [quoteTermsOfQuote({ number: "N", leadTimeDays: 28, deliveryTerms: null, note: null })] }] });
    const t2 = r2.review.model.targets.find((x) => x.key === j2.id)!;
    expect(t2.proposed.customerRequiredDate).toBeUndefined();
    expect(t2.proposed.dueDate).toBeUndefined();
  });
  it("fixture: objednávka bez termínu + nabídka „do 4 týdnů od objednání\"", () => {
    const r = reconcile([fxDoc("objednavka_zakaznik", "objednavka_zakaznik-g12"), fxDoc("nabidka_my", "nabidka_my-g12")]);
    expect(r.state.job.fields.customerRequiredDate).toBe("2026-11-18");
    expect(r.state.job.fields.dueDate).toBe("2026-11-18");
  });
});

describe("počty kusů a názvy u výkresů", () => {
  it("refersToDrawingQty: odkaz na výkres v počtu / jednotce / popisu", () => {
    const q = (o: Partial<ExtractedItem>) => refersToDrawingQty({ quantity: 0, unit: "", name: "", description: "", ...o });
    expect(q({ unit: "dle výkr." })).toBe(true);
    expect(q({ description: "ks dle výkresu" })).toBe(true);
    expect(q({ description: "počet viz výkres" })).toBe(true);
    expect(q({ description: "Menge lt. Zeichnung" })).toBe(true);
    expect(q({ description: "qty as per drawing" })).toBe(true);
    expect(q({ description: "dle počtu kusů na výkrese" })).toBe(true);
    expect(q({ description: "dle výkresu" })).toBe(true);
    expect(q({ quantity: 50, description: "Výroba dle výkresu" })).toBe(false); // konkrétní počet platí
    expect(q({ quantity: 1, description: "1 ks dle výkresu" })).toBe(true);
    expect(q({ description: "frézovat, odjehlit" })).toBe(false);
  });

  it("fixture: objednávka + nabídka + 3 výkresy s různými počty → objednávka > nabídka > výkres (položky i výkresy)", () => {
    const po = fxDoc("objednavka_zakaznik", "objednavka_zakaznik-g13");
    const nab = fxDoc("nabidka_my", "nabidka_my-g13");
    const a = fxDrawing("vykres-g13a");
    const b = fxDrawing("vykres-g13b");
    const c = fxDrawing("vykres-g13c");
    const r = reconcile([po, nab, a, b, c]);
    expect(r.state.job.items.map((i) => `${i.drawingNumber}:${i.quantity}`)).toEqual(["8800-01:10", "8800-02:6", "8800-03:4"]);
    const st = (id: string) => (r.docStates[id] as { kind: "drawing"; state: { quantity: string; title: string } }).state;
    expect([st(a.id).quantity, st(b.id).quantity, st(c.id).quantity]).toEqual(["10", "6", "4"]);
    const src = (id: string) => (r.docs.find((d) => d.docId === id) as { sources?: { quantity?: string; title?: string } }).sources;
    expect(src(a.id)?.quantity).toBe("z objednávky PO-E2E-13");
    expect(src(b.id)?.quantity).toBe("z nabídky NAB-E2E-13");
    expect(src(c.id)?.quantity).toBe("z výkresu 8800-03");
    // název výkresu = název z objednávky (titulek z razítka jen info)
    expect(st(a.id).title).toBe("Hřídel");
    expect(src(a.id)?.title).toBe('název z objednávky PO-E2E-13 (na výkresu „Hřídel hnací")');
    expect(st(c.id).title).toBe("Víko");
    // rozdíly = info „Platí objednávka"
    const w = r.warnings.filter((x) => x.code === "quantity_conflict");
    expect(w.some((x) => /^Platí objednávka: 10 ks \(nabídka 8 ks, výkres 12 ks\) — 8800-01$/.test(x.message) && x.severity === "info")).toBe(true);
    expect(r.warnings.some((x) => x.code === "drawing_quantity_missing")).toBe(false);
  });

  it("fixture: objednávka „ks dle výkresu“ → počet z výkresu (položka i výkres)", () => {
    const po = fxDoc("objednavka_zakaznik", "objednavka_zakaznik-g14");
    const v = fxDrawing("vykres-g14");
    const r = reconcile([po, v]);
    expect(r.state.job.items.map((i) => `${i.drawingNumber}:${i.quantity}`)).toEqual(["9900-01:35"]);
    const d = r.docs.find((x) => x.docId === v.id) as { sources?: { quantity?: string } };
    expect(d.sources?.quantity).toBe("z výkresu 9900-01 (objednávka: „dle výkresu\")");
    expect((r.docStates[v.id] as { state: { quantity: string; title: string } }).state).toMatchObject({ quantity: "35", title: "Držák" });
  });

  it("výkres bez položky: nabídka podle čísla, jinak z výkresu, jinak prázdný + „doplň počet“", () => {
    const rfq = rd("poptavka_zakaznik", { doc: inquiry({ items: [] }) });
    const nab = rd("nabidka_my", { doc: quote({ items: [item("X-1", { quantity: 9, name: "Kolík" })] }) });
    const v1 = rd("vykres", { dr: drawing({ drawingNumber: "X-1", title: "Pin" }) });
    const v2 = rd("vykres", { dr: drawing({ drawingNumber: "X-2", quantity: 3 }) });
    const v3 = rd("vykres", { dr: drawing({ drawingNumber: "X-3" }) });
    const gd = groupDocOf([rfq, nab, v1, v2, v3], OUR, { today: TODAY });
    expect(gd.drawingInfo[v2.id]).toMatchObject({ quantity: 3, quantitySource: "z výkresu" });
    expect(gd.drawingInfo[v3.id]).toMatchObject({ quantity: 0 });
    const r = reconcile([rfq, nab, v1, v2, v3]);
    expect(r.warnings.filter((w) => w.code === "drawing_quantity_missing").map((w) => w.docIds[0])).toEqual([v3.id]);
  });

  it("výkres k existující zakázce: počet a název z položky zakázky (už z objednávky)", () => {
    const j = job({ stage: "objednavka", items: [{ id: "a0000000-0000-4000-8000-000000000001", position: 0, drawingNumber: "SM-1", revision: null, name: "Příruba", description: null, material: null, quantity: 8, unit: "ks", unitPrice: null, purchaseUnitPrice: null, note: null }] } as Partial<JobDetail>);
    const v = rd("vykres", { dr: drawing({ drawingNumber: "SM-1", title: "Flange", quantity: 10 }) });
    const r = reconcile([v], { group: { targetJobId: j.id }, jobs: [{ job: j, reason: "doklad nahráváš u této zakázky", score: null }], fixedJobId: j.id });
    const st = (r.docStates[v.id] as { state: { quantity: string; title: string; link: { mode: string } } }).state;
    expect(st).toMatchObject({ quantity: "8", title: "Příruba", link: { mode: "item" } });
    expect((r.docs[0] as { sources?: { quantity?: string; title?: string } }).sources).toEqual({
      quantity: "z položky zakázky Z-2026-031", title: "název z položky zakázky Z-2026-031 (na výkresu „Flange\")",
    });
    expect(r.warnings.find((w) => w.code === "quantity_conflict")?.message).toMatch(/Platí zakázka: 8 ks \(výkres 10 ks\)/);
  });
});

describe("jedno nahrání = jedna zakázka — produkční případ 8000060875/GPO84339 + nabídka 136/026", () => {
  const build = () => {
    const po = fxDoc("objednavka_zakaznik", "objednavka_zakaznik-g11");
    const vk = fxDrawing("vykres-g11");
    const model = rd("model_3d", { documentNumber: "EM72231CJ0000", extract: { kind: "model", model: { format: "STEP", drawingNumber: "EM72231CJ0000", revision: "", title: "" } } });
    const foto = rd("foto", { filename: "IMG_2041.jpg" });
    const nab = fxDoc("nabidka_my", "nabidka_my-g11");
    return { po, vk, model, foto, nab, docs: [po, vk, model, foto, nab] };
  };

  it("dřív: zákazník na nabídce psán jinak → 2 zakázky; nyní 1 skupina bez blokujícího dotazu", () => {
    const { docs, nab } = build();
    const r = groupBatch({ docs, ourIco: OUR });
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].docIds).toHaveLength(5);
    expect(r.warnings.some((w) => w.severity === "block")).toBe(false);
    const w = r.warnings.find((x) => x.code === "customer_written_differently");
    expect(w?.docIds).toEqual([nab.id]);
  });

  it("kontrola: stav objednávka, číslo naší nabídky k zakázce, termín z nabídky, počet a název u výkresu", () => {
    const { docs, vk } = build();
    const g = groupBatch({ docs, ourIco: OUR }).groups[0];
    const r = reconcile(docs, { group: g });
    expect(r.state.job.targetKey).toBe("new");
    expect(r.state.job.stage).toBe("objednavka");
    expect(r.review.primaryDocId).toBe(docs[0].id);
    // číslo naší nabídky doplněné do dokladu skupiny (párování dalších dokladů „dle nabídky 136/026")
    expect(groupDocOf(docs, OUR, { today: TODAY }).doc.ourQuoteNumber).toBe("136/026");
    expect(r.state.job.fields.customerOrderNumber).toBe("8000060875/GPO84339");
    expect(r.state.job.fields.customerRequiredDate).toBe("2026-11-17");
    const st = (r.docStates[vk.id] as { state: { quantity: string; title: string; link: { mode: string } } }).state;
    expect(st).toMatchObject({ quantity: "120", title: "Těleso ventilu", link: { mode: "docItem" } });
    // naše nabídka je doklad téže zakázky (přiloží se), ne samostatná zakázka
    expect(r.docs.find((d) => d.kind === "business" && d.type === "nabidka_my")?.groupKey).toBe("g1");
  });
});
