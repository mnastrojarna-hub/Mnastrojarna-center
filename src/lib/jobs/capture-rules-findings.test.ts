import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  canAutoApplyBatch, groupBatch, groupDocOf, reconcileGroup,
  type GroupDraft, type GroupJobCandidate, type ReconcileDoc,
} from "./capture-batch-reconcile";
import { batchResultHeadline, batchSummaryLine, normalizeDrawing } from "./capture-batch";
import type { BatchApplyState, BatchDocType, BatchReviewModel, DocExtractSummary, DrawingExtract } from "./capture-batch-types";
import type { ExtractedBusinessDoc, ExtractedItem, ExtractedParty } from "./capture-types";
import { emptyExtracted, emptyParty, normalizeExtracted } from "./extracted-normalize";
import { parseLeadTime } from "./lead-time";
import { leadOfTerms, orderDeadline, parseLeadTimeInContext, quoteTermsOfDoc, quoteTermsOfQuote } from "./order-deadline";
import { isIcoChecksumValid, isWeakIcoClash } from "./capture-batch-reconcile";
import { singleExistingTarget, singleNewTarget, singleOrderDeadline } from "./capture-single-deadline";
import type { JobDetail } from "./types";

/**
 * Ověřené nálezy k pravidlům dávky 2 (nezávislý ověřovatel): lhůta z textu, který lhůtou není; lhůta nabídky
 * v systému × poznámka; odkaz čísly × jiné IČO; plná automatika rozdělené dávky; počet skutečných zakázek;
 * nabídka jen s datem v minulosti; nereálný termín objednávky bez nabídky.
 */

const TODAY = "2026-10-23";
const OUR = "04304080";
const STROJ: ExtractedParty = { ...emptyParty(), name: "STROJMETAL, a. s.", ico: "45274649" };
const FIX = path.join(__dirname, "__fixtures__", "capture", "batch");
const JOB_A = "11111111-1111-4111-8111-111111111111";
const JOB_B = "22222222-2222-4222-8222-222222222222";

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
function reconcile(docs: ReconcileDoc[], over: { jobs?: GroupJobCandidate[]; group?: Partial<GroupDraft> } = {}) {
  return reconcileGroup({
    captureId: "c0000000-0000-4000-8000-000000000001", group: group(docs, over.group), docs, margins: true,
    mode: "approval", ourIco: OUR, fixedJobId: null, jobs: over.jobs ?? [], today: TODAY,
  });
}
function job(over: Partial<JobDetail> = {}): JobDetail {
  return {
    id: JOB_A, number: "Z-2026-031", title: "Zakázka", stage: "objednavka",
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
/** Produkční případ: objednávka 8000060875/GPO84339 + výkres F00N603W84 + STEP EM72231CJ0000 + fotka + nabídka 136/026. */
function realCase() {
  const po = fxDoc("objednavka_zakaznik", "objednavka_zakaznik-g11");
  const vk = fxDrawing("vykres-g11");
  const model = rd("model_3d", { documentNumber: "EM72231CJ0000", extract: { kind: "model", model: { format: "STEP", drawingNumber: "EM72231CJ0000", revision: "", title: "" } } });
  const foto = rd("foto", { filename: "IMG_2041.jpg" });
  const nab = fxDoc("nabidka_my", "nabidka_my-g11");
  return { po, vk, model, foto, nab };
}
const bizOf = (d: ReconcileDoc) => (d.extract as { kind: "business"; doc: ExtractedBusinessDoc }).doc;

// ── 1) lhůta z textu, který lhůtou není ─────────────────────
describe("nález 1: 2D/3D, platnost nabídky a platební podmínky nejsou dodací lhůta", () => {
  it.each([
    "Výroba dle 3D modelu",
    "dle 2D výkresu a 3D modelu",
    "3D model STEP",
    "2D CAD data",
    "Nabídka platí 30 dní",
    "Ceny platí 30 dní od data nabídky",
    "Platné 30 dní",
    "Platební podmínky: 14 dní",
    "Angebot gilt 30 Tage",
    "Preise gelten 30 Tage",
    "Zahlungsbedingungen: 30 Tage netto",
    "Payment 30 days net",
    "Offer valid 30 days",
  ])("„%s“ → žádná lhůta", (text) => {
    expect(parseLeadTime(text)).toBeNull();
  });
  it("skutečná lhůta za 2D/3D / za platností se najde; „30d“ / „4w“ gramatika nezná (žádná lhůta)", () => {
    expect(parseLeadTime("Výroba dle 3D modelu, dodání 4 týdny")).toMatchObject({ days: 28 });
    expect(parseLeadTime("Nabídka platí 30 dní. Dodací lhůta 6 týdnů")).toMatchObject({ days: 42 });
    expect(parseLeadTime("Platební podmínky: 14 dní, dodání 10 pracovních dnů")).toMatchObject({ days: 10, unit: "pracovni" });
    expect(parseLeadTime("30d")).toBeNull();
    expect(parseLeadTime("4w ARO")).toBeNull();
  });
  it("nabídka „EXW Vimperk“ + poznámka „Výroba dle 3D modelu“ → žádný termín objednávka + 3 dny", () => {
    const q = quoteTermsOfDoc(quote({ deliveryTerms: "EXW Vimperk", note: "Výroba dle 3D modelu", summary: "" }), "NAB-6");
    const d = orderDeadline({ order: order(), quotes: [q], today: TODAY });
    expect(d.proposal).toBeNull();
  });
});

// ── 2) lhůta nabídky v systému × poznámka ────────────────────
describe("nález 2: quotes.lead_time_days má přednost, poznámka jen s kontextovým slovem", () => {
  it("lead_time_days 28 + poznámka s jiným číslem → 28 dní", () => {
    const sys = quoteTermsOfQuote({ number: "NAB-2026-031", leadTimeDays: 28, deliveryTerms: "EXW", note: "Výroba 2 dny po schválení, materiál dodá zákazník do 5 dnů" });
    expect(leadOfTerms(sys)).toMatchObject({ days: 28 });
    expect(orderDeadline({ order: order(), quotes: [sys], today: TODAY }).proposal?.date).toBe("2026-11-18");
  });
  it("lead_time_days 28 + poznámka „Platnost nabídky 30 dní“ → 28 dní", () => {
    const sys = quoteTermsOfQuote({ number: "NAB-2026-032", leadTimeDays: 28, deliveryTerms: null, note: "Platnost nabídky 30 dní; ceny platí 30 dní" });
    expect(leadOfTerms(sys)?.days).toBe(28);
  });
  it("poznámka / popis položky / shrnutí bez kontextového slova se nečte; s ním ano", () => {
    const noCtx = quoteTermsOfDoc(quote({ deliveryTerms: "", note: "Kalení 2 dny, broušení 5 dnů", summary: "" }), "NAB-6");
    expect(leadOfTerms(noCtx)).toBeNull();
    const item5 = quoteTermsOfDoc(quote({ deliveryTerms: "", items: [item("4711-02", { description: "zkouška 5 dnů" })], summary: "" }), "NAB-6");
    expect(leadOfTerms(item5)).toBeNull();
    const ctx = quoteTermsOfDoc(quote({ deliveryTerms: "EXW Vimperk", note: "Výroba dle 3D modelu", summary: "Nabídka, dodání 4 týdny." }), "NAB-6");
    expect(leadOfTerms(ctx)).toMatchObject({ days: 28 });
    const lz = quoteTermsOfDoc(quote({ deliveryTerms: "", note: "Lieferzeit 5 Wochen nach Auftragseingang", summary: "" }), "NAB-6");
    expect(leadOfTerms(lz)).toMatchObject({ days: 35, from: "objednavka" });
  });
  it("dodací podmínky se čtou bez kontextového slova („4 týdny od objednání“)", () => {
    expect(leadOfTerms(quoteTermsOfDoc(quote({ deliveryTerms: "4 týdny od objednání" }), "NAB-6"))).toMatchObject({ days: 28 });
  });
});

// ── 3) odkaz čísly × jiné IČO ────────────────────────────────
describe("nález 3: doklad odkazující číslem na skupinu s jiným IČO → do skupiny + dotaz", () => {
  it("objednávka „dle nabídky 136/026“ + nabídka 136/026 se špatně přečteným IČO → 1 skupina + „Ano, jedna zakázka / Rozdělit“", () => {
    const c = realCase();
    bizOf(c.nab).customer = { ...bizOf(c.nab).customer, ico: "45274694" };
    bizOf(c.po).ourQuoteNumber = "136/026";
    const r = groupBatch({ docs: [c.po, c.vk, c.model, c.foto, c.nab], ourIco: OUR });
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].docIds).toEqual(expect.arrayContaining([c.po.id, c.vk.id, c.model.id, c.foto.id, c.nab.id]));
    const w = r.warnings.find((x) => x.code === "customer_conflict")!;
    expect(w).toMatchObject({ severity: "block", docIds: [c.nab.id], groupKey: r.groups[0].key });
    expect(w.actions.map((a) => a.label)).toEqual(["Ano, jedna zakázka", "Rozdělit na samostatné zakázky"]);
    // potvrzení „Ano, jedna zakázka“ → bez blokace, pořád 1 skupina
    const ok = groupBatch({ docs: [c.po, c.vk, c.model, c.foto, c.nab], ourIco: OUR, customerConfirmed: [r.groups[0].key] });
    expect(ok.groups).toHaveLength(1);
    expect(ok.warnings.some((x) => x.code === "customer_conflict")).toBe(false);
    // „Rozdělit“ → 2 skupiny
    const split = w.actions[1];
    const key = `new:${split.docIds![0]}`;
    const two = groupBatch({ docs: [c.po, c.vk, c.model, c.foto, c.nab], ourIco: OUR, assign: Object.fromEntries(split.docIds!.map((id) => [id, key])) });
    expect(two.groups).toHaveLength(2);
  });
  it("bez odkazu čísly se různé IČO dál dělí (pravidlo zůstává)", () => {
    const a = rd("objednavka_zakaznik", { doc: order() });
    // platné IČO (mod 11) — IČO se špatným součtem je chyba čtení → jen dotaz (2. kolo, nález 3)
    const b = rd("objednavka_zakaznik", { doc: order({ documentNumber: "K-1", customerOrderNumber: "K-1", customer: { ...emptyParty(), name: "Kovo Plus s.r.o.", ico: "27654320" } }) });
    expect(groupBatch({ docs: [a, b], ourIco: OUR }).groups).toHaveLength(2);
  });
});

// ── 4) plná automatika rozdělené dávky ──────────────────────
describe("nález 4: víc cílových zakázek → žádná plná automatika; „patří k jiné zakázce“ = warn", () => {
  it("výkres se silnou shodou jinam (score 90) mimo balík → upozornění úrovně warn", () => {
    const c = realCase();
    c.model.strongMatch = { jobId: JOB_B, jobNumber: "Z-2026-010", reason: "podle čísla výkresu EM72231CJ0000", score: 90 };
    const r = groupBatch({ docs: [c.po, c.vk, c.model, c.foto, c.nab], ourIco: OUR });
    const w = r.warnings.find((x) => x.code === "target_conflict")!;
    expect(w).toBeTruthy();
    expect(w.severity).toBe("warn");
  });

  function groupState(id: string, jobId: string, key: string) {
    const o = rd("objednavka_zakaznik", { id, doc: order({ documentNumber: `PO-${id}`, customerOrderNumber: `PO-${id}`, requiredDeliveryDate: "2026-12-04" }) });
    const j = job({ id: jobId, number: `Z-${key}` });
    const res = reconcileGroup({
      captureId: "c0000000-0000-4000-8000-000000000001", group: group([o], { key, targetJobId: jobId }), docs: [o], margins: true,
      mode: "approval", ourIco: OUR, fixedJobId: null, jobs: [{ job: j, reason: "podle čísla objednávky", score: 95 }], today: TODAY,
    });
    return { res, sortDoc: { id, type: "objednavka_zakaznik" as const, pageIds: [`p-${id}`], aiType: "objednavka_zakaznik" as const, confidence: 0.95, reason: "", title: "", documentNumber: `PO-${id}`, partyName: "", drawingNumbers: [], format: null, flags: [], issuerCheck: "ok" as const, excluded: false } };
  }
  function twoGroups(jobA: string, jobB: string): { review: BatchReviewModel; ready: DocExtractSummary[] } {
    const a = groupState("d1", jobA, "g1");
    const b = groupState("d2", jobB, "g2");
    const initial: BatchApplyState = {
      sort: { docs: [a.sortDoc, b.sortDoc], excludedPageIds: [] },
      groups: [a.res.state, b.res.state],
      docs: { ...a.res.docStates, ...b.res.docStates },
    };
    const review: BatchReviewModel = {
      captureId: "c", aiUsed: true, mode: "full", margins: true, drawingsAccess: true, fixedJobId: null,
      options: { customers: [], suppliers: [], jobs: [] }, groups: [a.res.review, b.res.review], docs: [...a.res.docs, ...b.res.docs], warnings: [], initial,
    } as BatchReviewModel;
    const ready = ["d1", "d2"].map((id) => ({ docId: id, pagesKey: `p-${id}`, type: "objednavka_zakaznik" as const, status: "ready" as const, error: null, aiUsed: true, title: "", documentNumber: `PO-${id}`, confidence: 0.95, clarifications: 0 }));
    return { review, ready };
  }
  it("2 skupiny do 2 různých zakázek → vždy kontrola člověkem", () => {
    const { review, ready } = twoGroups(JOB_A, JOB_B);
    expect(review.initial.groups.map((g) => g.job.targetKey)).toEqual([JOB_A, JOB_B]);
    expect(canAutoApplyBatch(review, ready)).toBe(false);
  });
  it("jedna skupina (1 cílová zakázka) → automatika zůstává", () => {
    const a = groupState("d1", JOB_A, "g1");
    const review = {
      captureId: "c", aiUsed: true, mode: "full", margins: true, drawingsAccess: true, fixedJobId: null,
      options: { customers: [], suppliers: [], jobs: [] }, groups: [a.res.review], docs: a.res.docs, warnings: [],
      initial: { sort: { docs: [a.sortDoc], excludedPageIds: [] }, groups: [a.res.state], docs: a.res.docStates },
    } as BatchReviewModel;
    const ready = [{ docId: "d1", pagesKey: "p-d1", type: "objednavka_zakaznik" as const, status: "ready" as const, error: null, aiUsed: true, title: "", documentNumber: "PO-d1", confidence: 0.95, clarifications: 0 }];
    expect(canAutoApplyBatch(review, ready)).toBe(true);
  });
});

// ── 5) počítají se skutečné zakázky, ne skupiny ─────────────
describe("nález 5: počet zakázek = různé cíle skupin; výsledek = různá jobId", () => {
  const baseJob = {
    chip: "objednavka_zakaznik", docKind: "objednavka", issuer: "zakaznik", fileKind: "objednavka", targetKey: JOB_A,
    customer: { mode: "existing", id: "c1" }, supplier: { mode: "none" }, fields: {}, items: [], merges: [], stage: "keep", docNote: "",
  };
  const state = (keys: string[]) => ({
    sort: { docs: keys.map((_, i) => ({ id: `d${i + 1}`, type: "objednavka_zakaznik", pageIds: [`p${i + 1}`], excluded: false })), excludedPageIds: [] },
    groups: keys.map((k, i) => ({ key: `g${i + 1}`, docIds: [`d${i + 1}`], job: { ...baseJob, targetKey: k }, customerConfirmed: false, jobDraftTitle: "" })),
    docs: {},
  }) as unknown as BatchApplyState;
  const review = { margins: true, groups: [{ key: "g1", model: { targets: [] } }, { key: "g2", model: { targets: [] } }] } as unknown as BatchReviewModel;
  it("2 skupiny se stejnou cílovou zakázkou → „1 zakázka“", () => {
    expect(batchSummaryLine(review, state([JOB_A, JOB_A]))).toMatch(/^1 zakázka · 2 doklady/);
    expect(batchSummaryLine(review, state([JOB_A, JOB_B]))).toMatch(/^2 zakázky · 2 doklady/);
    // nová zakázka = každá skupina zvlášť
    expect(batchSummaryLine(review, state(["new", "new"]))).toMatch(/^2 zakázky/);
  });
  it("výsledek: 2 skupiny uložené do stejné zakázky → „k zakázce Z-1“, ne „ke 2 zakázkám“", () => {
    const docs = [1, 2, 3].map((i) => ({ docId: `d${i}`, groupKey: "g1", type: "foto" as const, label: "", ok: true, jobId: JOB_A, jobNumber: "Z-1", fileIds: [], fileKind: "foto" as const, title: "", summary: "", links: [] }));
    expect(batchResultHeadline({
      groups: [{ key: "g1", ok: true, jobId: JOB_A, jobNumber: "Z-1", created: true }, { key: "g2", ok: true, jobId: JOB_A, jobNumber: "Z-1", created: false }], docs,
    })).toBe("Založena zakázka Z-1 · uloženy 3 doklady");
  });
});

// ── 6) nabídka jen s konkrétním datem v minulosti ───────────
describe("nález 6: termín nabídky uplynul / je před objednávkou → upozornění", () => {
  it("objednávka bez termínu + nabídka jen s datem 15. 10. 2026 (před objednávkou) → info „doplň termín“", () => {
    const docs = [rd("objednavka_zakaznik", { doc: order() }), rd("nabidka_my", { doc: quote({ deliveryTerms: "", summary: "", promisedDeliveryDate: "2026-10-15" }) })];
    const r = reconcile(docs);
    const w = r.warnings.filter((x) => x.code === "deadline_from_quote");
    expect(w).toHaveLength(1);
    expect(w[0].severity).toBe("info");
    expect(w[0].message).toMatch(/Termín nabídky NAB-6 \(15\. 10\. 2026\) je před datem objednávky — doplň termín/);
    expect(r.state.job.fields.customerRequiredDate ?? "").toBe("");
  });
  it("nabídka s datem po objednávce, ale už uplynulým → „uplynul“", () => {
    const docs = [rd("objednavka_zakaznik", { doc: order({ documentDate: "2026-10-01" }) }), rd("nabidka_my", { doc: quote({ deliveryTerms: "", summary: "", promisedDeliveryDate: "2026-10-20" }) })];
    const w = reconcile(docs).warnings.filter((x) => x.code === "deadline_from_quote");
    expect(w.map((x) => x.message).join(" ")).toMatch(/Termín nabídky NAB-6 \(20\. 10\. 2026\) už uplynul — doplň termín/);
  });
});

// ── 7) nereálný termín bez nabídky se neuloží ──────────────
describe("nález 7: termín = datum objednávky / před ní, bez nabídky → pole prázdné + varování", () => {
  it("termín = datum objednávky, bez nabídky → prázdné pole, warn „doplň termín“", () => {
    const docs = [rd("objednavka_zakaznik", { doc: order({ requiredDeliveryDate: "2026-10-21" }) })];
    const g = groupDocOf(docs, OUR, { today: TODAY });
    expect(g.doc.requiredDeliveryDate).toBe("");
    const r = reconcile(docs);
    expect(r.state.job.fields.customerRequiredDate ?? "").toBe("");
    const w = r.warnings.find((x) => x.code === "deadline_from_quote")!;
    expect(w.severity).toBe("warn");
    expect(w.message).toMatch(/stejný jako datum objednávky.*doplň termín/);
  });
  it("termín před datem objednávky → prázdné; k existující zakázce se termín nepíše", () => {
    const docs = [rd("objednavka_zakaznik", { doc: order({ requiredDeliveryDate: "2026-10-01" }) })];
    const r = reconcile(docs, { jobs: [{ job: job(), reason: "x", score: 92 }], group: { targetJobId: JOB_A } });
    const t = r.review.model.targets.find((x) => x.key === JOB_A)!;
    expect(t.proposed.customerRequiredDate ?? "").toBe("");
    expect(r.warnings.find((x) => x.code === "deadline_from_quote")?.severity).toBe("warn");
  });
  it("reálný termín objednávky se nemění (pravidlo zůstává)", () => {
    const docs = [rd("objednavka_zakaznik", { doc: order({ requiredDeliveryDate: "2026-12-04" }) })];
    expect(reconcile(docs).state.job.fields.customerRequiredDate).toBe("2026-12-04");
  });
});

// ════════════════════════════════════════════════════════════
// Opakované ověření (2. kolo)
// ════════════════════════════════════════════════════════════
/** Objednávka 20. 10. 2026 bez termínu (produkční případ) × nabídka 136/026 s dodacími podmínkami. */
const order20 = () => order({ documentDate: "2026-10-20", requiredDeliveryDate: "" });
const deadlineWith = (deliveryTerms: string, note = "") =>
  orderDeadline({ order: order20(), quotes: [quoteTermsOfDoc(quote({ documentNumber: "136/026", ourQuoteNumber: "136/026", deliveryTerms, note, summary: "" }), "136/026")], today: TODAY });

describe("2. kolo — nález 1: platba, záruka, delší věta o platnosti, číslo před klíčovým slovem, malé 2d/3d", () => {
  it.each([
    // platba (i za čárkou, i bez „podmínky")
    "Platební podmínky: převodem, 14 dní",
    "Platba převodem 14 dní",
    "Platba: 14 dní",
    "Zahlung 30 Tage",
    "Skonto 2 % při platbě do 10 dnů",
    // záruka
    "Záruční doba 24 měsíců",
    "Garantie 12 Monate",
    "guarantee 12 months",
    // delší věta o platnosti
    "Platnost této cenové nabídky je 30 dní",
    "Bindefrist 30 Tage",
    // klíčové slovo ZA číslem
    "30 Tage netto",
    "14 dní splatnost",
    "30 days net",
    "Angebot freibleibend, 30 Tage gültig",
    // malé 2d / 3d
    "výroba dle 3d",
    "Výroba dle 3d",
    "podle 2d",
    // „… lhůta" s jiným významem
    "Platební lhůta 14 dní",
    "Reklamační lhůta 30 dní",
    "Záruční lhůta 24 měsíců",
    // za dodací podmínkou následuje jiná podmínka
    "EXW Vimperk, záruční doba 24 měsíců",
    "Lieferung EXW, Garantie 12 Monate",
    "Dodání EXW Vimperk, platba převodem 14 dní",
  ])("„%s“ → žádná lhůta", (text) => {
    expect(parseLeadTime(text)).toBeNull();
  });
  it("varianty ze zadání dál vrací null", () => {
    for (const t of ["platnost nabídky 30 dní", "Gültigkeit 4 Wochen", "Zahlungsziel 30 Tage", "splatnost 14 dní", "3D model", "dle 2D", "valid 30 days"]) {
      expect(parseLeadTime(t), t).toBeNull();
    }
  });
  it("skutečné lhůty se dál najdou (i vedle platby / záruky)", () => {
    expect(parseLeadTime("delivery 4 weeks ARO")).toMatchObject({ days: 28, from: "objednavka" });
    expect(parseLeadTime("dodání do 5 týdnů")).toMatchObject({ days: 35 });
    expect(parseLeadTime("expedice 10 pracovních dnů")).toMatchObject({ days: 10, unit: "pracovni" });
    expect(parseLeadTime("Platba převodem 14 dní, dodání 4 týdny")).toMatchObject({ days: 28 });
    expect(parseLeadTime("Záruka 24 měsíců. Dodání 3 týdny")).toMatchObject({ days: 21 });
    // uzavřená gramatika: „garantovaná" není povolený úvod kotvy; holá doba jen jako CELÉ dodací pole
    expect(parseLeadTime("Garantovaná dodací lhůta 4 týdny")).toBeNull();
    expect(parseLeadTime("Platba 14 dní, 4 týdny od objednání")).toBeNull();
    expect(parseLeadTime("Payment 30 days net, lead time 2 weeks")).toMatchObject({ days: 14 });
    expect(parseLeadTime("Platnost nabídky 30 dní, dodací lhůta 4 týdny")).toMatchObject({ days: 28 });
  });
  it("dopad přes orderDeadline: záruka / platnost / 3d nedají termín", () => {
    expect(deadlineWith("EXW Vimperk, záruční doba 24 měsíců").proposal).toBeNull();
    expect(deadlineWith("Lieferung EXW, Garantie 12 Monate").proposal).toBeNull();
    expect(deadlineWith("Platnost této cenové nabídky je 30 dní").proposal).toBeNull();
    expect(deadlineWith("Výroba dle 3d").proposal).toBeNull();
    // skutečná lhůta platí dál: 4 týdny od objednání 20. 10. → 17. 11. 2026
    expect(deadlineWith("Dodací lhůta: 4 týdny od objednávky, záruční doba 24 měsíců").proposal?.date).toBe("2026-11-17");
  });
});

describe("2. kolo — nález 2: poznámka jen v klauzuli se slovem o dodání (hranice i čárka), slovo před „lhůta“ se vidí", () => {
  it.each([
    "Dodání EXW Vimperk, platba převodem 14 dní",
    "Termín dodání dle dohody, kalení 2 dny",
    "Lieferzeit nach Absprache, Härten 2 Tage",
    "Platební lhůta 14 dní",
    "Reklamační lhůta 30 dní",
    "Záruční lhůta 24 měsíců",
    "Dodací podmínky: EXW, platba převodem 14 dní",
  ])("poznámka „%s“ → žádná lhůta", (text) => {
    expect(parseLeadTimeInContext(text)).toBeNull();
  });
  it("lhůta v klauzuli s dodací kotvou se dál najde (jen celá gramatická klauzule)", () => {
    // jiná klauzule s vlastní dobou (kalení, výroba, expedice…) = lhůta nejednoznačná → nic (uzavřené pravidlo, 4. kolo)
    expect(parseLeadTimeInContext("Kalení 2 dny, dodání 4 týdny")).toBeNull();
    // kotva uprostřed klauzule / doba před kotvou = mimo gramatiku
    expect(parseLeadTimeInContext("Kalení 2 dny a dodání 4 týdny")).toBeNull();
    expect(parseLeadTimeInContext("4 týdny dodání")).toBeNull();
    expect(parseLeadTimeInContext("Výroba dle 3D modelu, dodání 4 týdny")).toMatchObject({ days: 28 });
    expect(parseLeadTimeInContext("Lieferzeit 5 Wochen nach Auftragseingang")).toMatchObject({ days: 35, from: "objednavka" });
    expect(parseLeadTimeInContext("Platba 14 dní; dodací lhůta 6 týdnů")).toMatchObject({ days: 42 });
  });
  it("nabídka v systému: EXW + poznámka s platbou → žádný termín; lead_time_days 28 dál přebije vše", () => {
    const sys = quoteTermsOfQuote({ number: "NAB-1", leadTimeDays: null, deliveryTerms: "EXW Vimperk", note: "Dodací podmínky: EXW, platba převodem 14 dní" });
    expect(leadOfTerms(sys)).toBeNull();
    expect(orderDeadline({ order: order20(), quotes: [sys], today: TODAY }).proposal).toBeNull();
    const days = quoteTermsOfQuote({ number: "NAB-1", leadTimeDays: 28, deliveryTerms: "EXW Vimperk", note: "Dodací podmínky: EXW, platba převodem 14 dní" });
    expect(orderDeadline({ order: order20(), quotes: [days], today: TODAY }).proposal?.date).toBe("2026-11-17");
  });
  it("nabídka v dávce s poznámkou „Termín dodání dle dohody, kalení 2 dny“ → žádný termín", () => {
    expect(deadlineWith("", "Termín dodání dle dohody, kalení 2 dny").proposal).toBeNull();
  });
});

describe("2. kolo — nález 3: řetězec odkazů a chybná číslice v IČO → 1 skupina + dotaz", () => {
  const inquiry = (ico: string) => rd("poptavka_zakaznik", {
    doc: bdoc({
      docKind: "poptavka", issuer: "zakaznik", documentNumber: "RFQ-77", customerInquiryNumber: "RFQ-77", documentDate: "2026-10-05",
      customer: { ...STROJ, ico }, items: [item("F00N603W84", { quantity: 120 })],
    }),
  });
  const conflict = (r: ReturnType<typeof groupBatch>) => r.warnings.find((w) => w.code === "customer_conflict");
  it("kontrolní součet IČO (mod 11) a blízké IČO", () => {
    expect(isIcoChecksumValid("45274649")).toBe(true);
    expect(isIcoChecksumValid("04304080")).toBe(true);
    expect(isIcoChecksumValid("45274648")).toBe(false);
    expect(isWeakIcoClash("45274649", "45274648")).toBe(true); // jiná číslice + špatný součet
    expect(isWeakIcoClash("45274649", "45274694")).toBe(true); // přehozené sousední číslice
    expect(isWeakIcoClash("45274649", "27082440")).toBe(false); // dvě platná, úplně jiná IČO
  });
  it("objednávka s chybnou číslicí v IČO → poptávka RFQ-77 → nabídka 136/026 (řetězec) = 1 skupina + blokující dotaz", () => {
    const c = realCase();
    bizOf(c.po).customer = { ...bizOf(c.po).customer, ico: "45274648" };
    bizOf(c.po).ourQuoteNumber = "136/026";
    bizOf(c.nab).customer = { ...STROJ };
    bizOf(c.nab).customerInquiryNumber = "RFQ-77";
    const inq = inquiry("45274649");
    const r = groupBatch({ docs: [c.po, inq, c.nab, c.vk, c.model, c.foto], ourIco: OUR });
    expect(r.groups).toHaveLength(1);
    expect(conflict(r)).toMatchObject({ severity: "block", groupKey: r.groups[0].key });
    expect(conflict(r)!.actions.map((a) => a.label)).toEqual(["Ano, jedna zakázka", "Rozdělit na samostatné zakázky"]);
  });
  it("zrcadlově: chybné IČO na poptávce = 1 skupina + blokující dotaz", () => {
    const c = realCase();
    bizOf(c.po).ourQuoteNumber = "136/026";
    bizOf(c.nab).customer = { ...STROJ };
    bizOf(c.nab).customerInquiryNumber = "RFQ-77";
    const inq = inquiry("45274648");
    const r = groupBatch({ docs: [c.po, inq, c.nab, c.vk], ourIco: OUR });
    expect(r.groups).toHaveLength(1);
    expect(conflict(r)).toMatchObject({ severity: "block", docIds: [inq.id] });
  });
  it("řetězec odkazů čísly s dvěma platnými, různými IČO → sloučit (union-find) + dotaz; „Rozdělit“ dál funguje", () => {
    const c = realCase();
    bizOf(c.po).customer = { ...bizOf(c.po).customer, name: "Kovo Plus s.r.o.", ico: "27082440" };
    bizOf(c.po).ourQuoteNumber = "136/026";
    bizOf(c.nab).customer = { ...STROJ };
    bizOf(c.nab).customerInquiryNumber = "RFQ-77";
    const inq = inquiry("45274649");
    const docs = [c.po, inq, c.nab];
    const r = groupBatch({ docs, ourIco: OUR });
    expect(r.groups).toHaveLength(1);
    const w = conflict(r)!;
    expect(w).toMatchObject({ severity: "block" });
    expect([...w.docIds].sort()).toEqual([inq.id, c.nab.id].sort());
    const ok = groupBatch({ docs, ourIco: OUR, customerConfirmed: [r.groups[0].key] });
    expect(ok.groups).toHaveLength(1);
    expect(conflict(ok)).toBeUndefined();
    const split = w.actions[1];
    const key = `new:${split.docIds![0]}`;
    const two = groupBatch({ docs, ourIco: OUR, assign: Object.fromEntries(split.docIds!.map((id) => [id, key])) });
    expect(two.groups).toHaveLength(2);
  });
  it("produkční objednávka bez čísla nabídky + nabídka 136/026 s IČO 45274648 (špatný součet), stejný výkres → 1 skupina + dotaz", () => {
    const c = realCase();
    expect(bizOf(c.po).ourQuoteNumber).toBe("");
    bizOf(c.nab).customer = { ...STROJ, ico: "45274648" };
    const r = groupBatch({ docs: [c.po, c.vk, c.model, c.foto, c.nab], ourIco: OUR });
    expect(r.groups).toHaveLength(1);
    expect(conflict(r)).toMatchObject({ severity: "block", docIds: [c.nab.id] });
  });
  it("pravidla zůstávají: dvě platná různá IČO bez odkazu = 2 skupiny; chybné IČO i bez stejného výkresu = 1 skupina + dotaz (3. kolo)", () => {
    const a = rd("objednavka_zakaznik", { doc: order() });
    const b = rd("objednavka_zakaznik", { doc: order({ documentNumber: "K-1", customerOrderNumber: "K-1", customer: { ...emptyParty(), name: "Kovo Plus s.r.o.", ico: "27082440" } }) });
    expect(groupBatch({ docs: [a, b], ourIco: OUR }).groups).toHaveLength(2);
    const x = rd("objednavka_zakaznik", { doc: order() });
    const y = rd("objednavka_zakaznik", { doc: order({ documentNumber: "K-2", customerOrderNumber: "K-2", customer: { ...STROJ, ico: "45274648" }, items: [item("9999-01")] }) });
    const weak = groupBatch({ docs: [x, y], ourIco: OUR });
    expect(weak.groups).toHaveLength(1);
    expect(conflict(weak)).toMatchObject({ severity: "block", docIds: [y.id] });
    // dvě objednávky stejného zákazníka = 1 skupina + „Rozdělit“
    const p = rd("objednavka_zakaznik", { doc: order() });
    const q = rd("objednavka_zakaznik", { doc: order({ documentNumber: "PO-2", customerOrderNumber: "PO-2", items: [item("9999-01")] }) });
    const one = groupBatch({ docs: [p, q], ourIco: OUR });
    expect(one.groups).toHaveLength(1);
    expect(one.warnings.some((w) => w.code === "multiple_orders")).toBe(true);
  });
});

describe("2. kolo — nález 7 u jedné fotky objednávky (analyzeSingle): termín = datum objednávky se neuloží", () => {
  const po = (over: Partial<ExtractedBusinessDoc> = {}) => ({ ...normalizeExtracted(fixture("objednavka_zakaznik-g11")), requiredDeliveryDate: "2026-10-20", ...over });
  it("bez nabídky: nová zakázka bez termínu + varování (vyřadí plnou automatiku)", () => {
    const doc = po();
    const dl = singleOrderDeadline(doc, [], TODAY);
    expect(dl).toMatchObject({ drop: true, date: "" });
    expect(dl!.message).toMatch(/stejný jako datum objednávky.*termín se neuloží, doplň termín zakázky/);
    const t = singleNewTarget({ aiUsed: true, doc }, true, TODAY);
    expect(t.proposed.orderDate).toBe("2026-10-20");
    expect(t.proposed.customerRequiredDate ?? "").toBe("");
    // doklad v relaci zůstává beze změny (uložení přepočítá stejně)
    expect(doc.requiredDeliveryDate).toBe("2026-10-20");
  });
  it("termín před datem objednávky → také prázdné", () => {
    const t = singleNewTarget({ aiUsed: true, doc: po({ requiredDeliveryDate: "2026-10-01" }) }, true, TODAY);
    expect(t.proposed.customerRequiredDate ?? "").toBe("");
    expect(singleOrderDeadline(po({ requiredDeliveryDate: "2026-10-01" }), [], TODAY)?.message).toMatch(/před datem objednávky/);
  });
  it("existující zakázka s nabídkou „EXW“ (bez lhůty) → termín se nenavrhne", () => {
    const exw = quoteTermsOfQuote({ number: "NAB-1", leadTimeDays: null, deliveryTerms: "EXW", note: null });
    const t = singleExistingTarget(job(), { aiUsed: true, doc: po() }, true, "podle čísla", 92, [exw], TODAY);
    expect(t.proposed.customerRequiredDate ?? "").toBe("");
    expect(t.conflicts.customerRequiredDate ?? "").toBe("");
    expect(singleOrderDeadline(po(), [exw], TODAY)?.drop).toBe(true);
  });
  it("existující zakázka s nabídkou 4 týdny → termín z nabídky (17. 11. 2026); reálný termín objednávky platí", () => {
    const four = quoteTermsOfQuote({ number: "NAB-1", leadTimeDays: null, deliveryTerms: "Dodací lhůta 4 týdny od objednávky", note: null });
    const t = singleExistingTarget(job(), { aiUsed: true, doc: po() }, true, "podle čísla", 92, [four], TODAY);
    expect(t.proposed.customerRequiredDate).toBe("2026-11-17");
    expect(singleOrderDeadline(po(), [four], TODAY)).toMatchObject({ drop: false, date: "2026-11-17" });
    const real = singleNewTarget({ aiUsed: true, doc: po({ requiredDeliveryDate: "2026-12-04" }) }, true, TODAY);
    expect(real.proposed.customerRequiredDate).toBe("2026-12-04");
    expect(singleOrderDeadline(po({ requiredDeliveryDate: "2026-12-04" }), [], TODAY)).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════
// 3. kolo
// ════════════════════════════════════════════════════════════
describe("3. kolo — nález 4: IČO jiné délky / bez úvodních nul / jen špatný součet / podobný název → nikdy silný důkaz", () => {
  const conflict = (r: ReturnType<typeof groupBatch>) => r.warnings.find((w) => w.code === "customer_conflict");
  const two = (ico: string, name = STROJ.name) => {
    const a = rd("objednavka_zakaznik", { doc: order() });
    const b = rd("objednavka_zakaznik", { doc: order({ documentNumber: "K-9", customerOrderNumber: "K-9", customer: { ...emptyParty(), name, ico }, items: [item("9999-01")] }) });
    return { a, b, r: groupBatch({ docs: [a, b], ourIco: OUR }) };
  };
  it("IČO bez úvodní nuly = stejné IČO (04304080 ~ 4304080 je naše; 08291578 ~ 8291578)", () => {
    expect(isIcoChecksumValid("4304080")).toBe(true);
    const a = rd("objednavka_zakaznik", { doc: order({ customer: { ...STROJ, ico: "08291578" } }) });
    const b = rd("nabidka_my", { doc: quote({ customer: { ...STROJ, ico: "8291578" } }) });
    const r = groupBatch({ docs: [a, b], ourIco: OUR });
    expect(r.groups).toHaveLength(1);
    expect(conflict(r)).toBeUndefined();
  });
  it("IČO s chybějící číslicí (7 číslic, jiné) / přebývající číslicí (9 číslic) → 1 skupina + blokující dotaz", () => {
    expect(isIcoChecksumValid("452746491")).toBe(false);
    expect(isIcoChecksumValid("4527464")).toBe(false);
    for (const ico of ["4527464", "452746491", "452764649"]) {
      const { b, r } = two(ico, "Úplně jiný název s.r.o.");
      expect(r.groups, ico).toHaveLength(1);
      expect(conflict(r), ico).toMatchObject({ severity: "block", docIds: [b.id] });
      expect(conflict(r)!.actions.map((x) => x.label)).toEqual(["Ano, jedna zakázka", "Rozdělit na samostatné zakázky"]);
    }
  });
  it("jen špatný kontrolní součet bez společného výkresu → 1 skupina + dotaz", () => {
    const { b, r } = two("12345678", "Kovo Plus s.r.o.");
    expect(isIcoChecksumValid("12345678")).toBe(false);
    expect(r.groups).toHaveLength(1);
    expect(conflict(r)).toMatchObject({ severity: "block", docIds: [b.id] });
  });
  it("dvě platná IČO s jednou odlišnou číslicí / přehozením / stejným názvem → 1 skupina + dotaz", () => {
    // 45274649 × 45274657 (obě platná, liší se o 2 číslice, ale stejný název) → slabý rozdíl
    expect(isIcoChecksumValid("45274657")).toBe(true);
    const same = two("45274657");
    expect(same.r.groups).toHaveLength(1);
    expect(conflict(same.r)).toMatchObject({ severity: "block" });
    expect(isWeakIcoClash("45274649", "4527464")).toBe(true);
    expect(isWeakIcoClash("45274649", "452746491")).toBe(true);
  });
  it("rozdělení dál funguje: „Rozdělit“ → 2 skupiny; dvě platná různá IČO a jiný název bez odkazu → 2 skupiny bez dotazu", () => {
    const { r, a, b } = two("4527464", "Jiný s.r.o.");
    const split = conflict(r)!.actions[1];
    const key = `new:${split.docIds![0]}`;
    expect(groupBatch({ docs: [a, b], ourIco: OUR, assign: Object.fromEntries(split.docIds!.map((id) => [id, key])) }).groups).toHaveLength(2);
    const strong = two("27082440", "Kovo Plus s.r.o.");
    expect(strong.r.groups).toHaveLength(2);
    expect(conflict(strong.r)).toBeUndefined();
  });
});

describe("3. kolo — nález 5: jedna fotka objednávky — termín v hlavičce = datum objednávky, reálný termín jen u položky", () => {
  const po = (over: Partial<ExtractedBusinessDoc> = {}) => {
    const d = normalizeExtracted(fixture("objednavka_zakaznik-g11"));
    return { ...d, requiredDeliveryDate: "2026-10-20", items: d.items.map((i) => ({ ...i, deliveryDate: "2026-12-04" })), ...over };
  };
  it("nová zakázka: termín 4. 12. 2026 z položky (stejně jako dávka)", () => {
    const doc = po();
    expect(doc.documentDate).toBe("2026-10-20");
    const t = singleNewTarget({ aiUsed: true, doc }, true, TODAY);
    expect(t.proposed.customerRequiredDate).toBe("2026-12-04");
    const dl = singleOrderDeadline(doc, [], TODAY);
    expect(dl).toMatchObject({ drop: false, docDate: "2026-12-04" });
    // stejné jako dávka
    const g = groupDocOf([rd("objednavka_zakaznik", { doc })], OUR, { today: TODAY });
    expect(g.doc.requiredDeliveryDate).toBe("2026-12-04");
  });
  it("existující zakázka: termín z položky, ne datum objednávky; nabídka s lhůtou ho nepřepíše (reálný termín objednávky)", () => {
    const four = quoteTermsOfQuote({ number: "NAB-1", leadTimeDays: null, deliveryTerms: "Dodací lhůta 4 týdny od objednávky", note: null });
    const t = singleExistingTarget(job(), { aiUsed: true, doc: po() }, true, "podle čísla", 92, [four], TODAY);
    expect(t.proposed.customerRequiredDate).toBe("2026-12-04");
    expect(t.proposed.dueDate ?? "").toBe("");
  });
  it("termín v minulosti bez nabídky → informace do needsClarification (jako v dávce), termín zůstane", () => {
    const doc = po({ documentDate: "2026-09-01", requiredDeliveryDate: "2026-10-01", items: po().items.map((i) => ({ ...i, deliveryDate: "" })) });
    const dl = singleOrderDeadline(doc, [], TODAY);
    expect(dl).toMatchObject({ drop: false, date: "" });
    expect(dl!.message).toMatch(/už uplynul.*doplň termín zakázky/);
    const batch = groupDocOf([rd("objednavka_zakaznik", { doc })], OUR, { today: TODAY });
    expect(batch.deadline?.warnings[0]?.message).toBe(dl!.message);
  });
});
