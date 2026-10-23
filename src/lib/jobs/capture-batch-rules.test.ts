import { describe, it, expect } from "vitest";
import {
  drawingDocMatch, drawingJobMatch, groupBatch, groupDocOf, isWholeOrder, reconcileGroup, sanitizeBatchApplyState,
  type DrawingMatchJob, type GroupDraft, type GroupJobCandidate, type ReconcileDoc,
} from "./capture-batch-reconcile";
import { bundleKeyOf, drawingTitle, emptyDrawing, normalizeClassification, normalizeDrawing } from "./capture-batch";
import type { BatchApplyState, BatchDocType, BatchFile, BatchPage, DrawingExtract } from "./capture-batch-types";
import type { ExtractedBusinessDoc, ExtractedItem, ExtractedParty } from "./capture-types";
import { emptyExtracted, emptyParty } from "./extracted-normalize";
import { nameSimilarity } from "./matching";

/**
 * Pravidla dávky (majitel): balík (ZIP) = jeden zákazník; firma z razítka výkresu se ignoruje, výkres se
 * páruje čísly (i druhým číslem na listu) — i s existující zakázkou; počty kusů: vždy platí objednávka
 * (výjimky: chybějící počet, objednávka na celek).
 */

const OUR = "04304080";
const STROJ: ExtractedParty = { ...emptyParty(), name: "STROJMETAL, a. s.", ico: "45274649" };
const STROJ_ODDLY: ExtractedParty = { ...emptyParty(), name: "Strojmetal Kladno, závod Slaný" };
const KOVO: ExtractedParty = { ...emptyParty(), name: "Kovo Plus s.r.o.", ico: "27654321" };
const ZIP = "zip:podklady.zip";
const JOB_A = "11111111-1111-4111-8111-111111111111";
const JOB_B = "22222222-2222-4222-8222-222222222222";

const item = (drawingNumber: string, over: Partial<ExtractedItem> = {}): ExtractedItem => ({
  drawingNumber, revision: "", name: `Díl ${drawingNumber}`, description: "", material: "", quantity: 10, unit: "ks", unitPrice: 0, deliveryDate: "", ...over,
});
const bdoc = (over: Partial<ExtractedBusinessDoc>): ExtractedBusinessDoc => ({ ...emptyExtracted(), confidence: 0.92, ...over });
const order = (over: Partial<ExtractedBusinessDoc> = {}) => bdoc({
  docKind: "objednavka", issuer: "zakaznik", documentNumber: "PO-4471", customerOrderNumber: "PO-4471", customer: STROJ,
  items: [item("4711-02", { quantity: 50 }), item("4711-03", { quantity: 20 })], totalWithoutVat: 1000, ...over,
});
const quote = (over: Partial<ExtractedBusinessDoc> = {}) => bdoc({
  docKind: "nabidka", issuer: "my", documentNumber: "NAB-6", ourQuoteNumber: "NAB-6", customer: STROJ,
  items: [item("4711-02", { quantity: 40 }), item("4711-03", { quantity: 20 })], ...over,
});
const drawing = (over: Partial<DrawingExtract> = {}): DrawingExtract => ({ ...emptyDrawing(), customerName: "Konstrukce Novák s.r.o.", ...over });

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

function group(docs: ReconcileDoc[], over: Partial<GroupDraft> = {}): GroupDraft {
  return { key: "g1", docIds: docs.map((d) => d.id), targetJobId: null, targetRequired: false, autoReason: null, customerName: "", partyKey: "", ...over };
}

function reconcile(docs: ReconcileDoc[], over: { jobs?: GroupJobCandidate[]; group?: Partial<GroupDraft> } = {}) {
  return reconcileGroup({
    captureId: "c0000000-0000-4000-8000-000000000001", group: group(docs, over.group), docs, margins: true,
    mode: "approval", ourIco: OUR, fixedJobId: null, jobs: over.jobs ?? [],
  });
}

const mjob = (id: string, number: string, over: Partial<DrawingMatchJob> = {}): DrawingMatchJob => ({
  id, number, stage: "objednavka", drawingNumbers: [], quoteNumbers: [], customerOrderNumber: null, ...over,
});

describe("balík (ZIP) = jeden zákazník", () => {
  it("objednávka + naše nabídka s jinak psaným zákazníkem + výkres projekční firmy → 1 skupina bez dotazu", () => {
    expect(nameSimilarity(STROJ.name, STROJ_ODDLY.name)).toBeLessThan(0.8);
    const po = rd("objednavka_zakaznik", { doc: order(), bundleKey: ZIP });
    const nab = rd("nabidka_my", { doc: quote({ customer: STROJ_ODDLY }), bundleKey: ZIP });
    const vk = rd("vykres", { dr: drawing({ drawingNumber: "KN-77", drawingNumbers: ["KN-77"] }), bundleKey: ZIP });
    // bez balíku: pořád 1 skupina (jedno nahrání = jedna zakázka), jen upozornění na jinak psaného zákazníka
    const loose = groupBatch({ docs: [{ ...po, bundleKey: null }, { ...nab, bundleKey: null }], ourIco: OUR });
    expect(loose.groups).toHaveLength(1);
    expect(loose.warnings.some((w) => w.code === "customer_written_differently" && w.severity !== "block")).toBe(true);
    expect(loose.warnings.some((w) => w.severity === "block")).toBe(false);

    const r = groupBatch({ docs: [po, nab, vk], ourIco: OUR });
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].docIds.sort()).toEqual([po.id, nab.id, vk.id].sort());
    expect(r.groups[0].customerConfirmed).toBe(true);
    expect(r.warnings.some((w) => w.code === "customer_conflict")).toBe(false);

    // uložení projde i serverovou kontrolou konfliktu zákazníka
    const rec = reconcile([po, nab, vk], { group: r.groups[0] });
    expect(rec.state.customerConfirmed).toBe(true);
    const pages: BatchPage[] = [po, nab, vk].map((d, i) => ({ id: `p${i + 1}`, fileId: `f${i + 1}`, page: 1, source: "image", label: d.id, aiLabel: "", duplicateOf: null }));
    const state: BatchApplyState = {
      sort: {
        docs: [po, nab, vk].map((d, i) => ({
          id: d.id, type: d.type, pageIds: [`p${i + 1}`], aiType: d.type, confidence: 0.9, reason: "", title: "", documentNumber: d.documentNumber,
          partyName: "", drawingNumbers: [], format: null, flags: [], issuerCheck: "unknown", excluded: false,
        })),
        excludedPageIds: [],
      },
      groups: [rec.state],
      docs: rec.docStates,
    };
    const parties = { [po.id]: { name: STROJ.name, ico: STROJ.ico }, [nab.id]: { name: STROJ_ODDLY.name, ico: "" }, [vk.id]: null };
    const ok = sanitizeBatchApplyState(state, { pages, margins: true, ourIco: OUR, customerParties: parties });
    expect(ok.ok, ok.ok ? "" : ok.error).toBe(true);
    // výkres projekční firmy nikdy nedělá zákazníka zakázky
    expect(rec.review.model.docCustomer.name).toBe(STROJ.name);
  });

  it("dvě objednávky v jednom ZIPu = výchozí JEDNA zakázka + rozdělení jedním ťuknutím (výkres jde s druhou objednávkou)", () => {
    const a = rd("objednavka_zakaznik", { doc: order(), bundleKey: ZIP });
    const b = rd("objednavka_zakaznik", { doc: order({ documentNumber: "PO-4480", customerOrderNumber: "PO-4480", customer: STROJ_ODDLY, items: [item("5500-01")] }), bundleKey: ZIP });
    const vk = rd("vykres", { dr: drawing({ drawingNumber: "5500-01" }), bundleKey: ZIP });
    const r = groupBatch({ docs: [a, b, vk], ourIco: OUR });
    expect(r.groups).toHaveLength(1);
    expect(r.warnings.some((w) => w.code === "customer_conflict" || w.code === "customer_written_differently")).toBe(false);
    const w = r.warnings.find((x) => x.code === "multiple_orders")!;
    expect(w.actions[0]).toMatchObject({ kind: "split_group", docIds: [b.id, vk.id] });
    const key = `new:${b.id}`;
    const split = groupBatch({ docs: [a, b, vk], ourIco: OUR, assign: { [b.id]: key, [vk.id]: key } });
    expect(split.groups).toHaveLength(2);
    expect(split.groups[1].docIds).toEqual([b.id, vk.id]); // výkres podle čísla k druhé objednávce
  });

  it("výkres z balíku bez shody čísla → k první skupině BALÍKU, ne ke globálně první skupině", () => {
    const other = rd("objednavka_zakaznik", { doc: order({ documentNumber: "PO-9", customerOrderNumber: "PO-9", customer: KOVO, items: [item("9000-01")] }) });
    const po = rd("objednavka_zakaznik", { doc: order(), bundleKey: ZIP });
    const vk = rd("vykres", { dr: drawing({ drawingNumber: "NIC-1" }), bundleKey: ZIP });
    const foto = rd("foto", { bundleKey: ZIP });
    const r = groupBatch({ docs: [other, po, vk, foto], ourIco: OUR });
    const zipGroup = r.groups.find((g) => g.docIds.includes(po.id))!;
    expect(zipGroup.docIds).toEqual(expect.arrayContaining([vk.id, foto.id]));
    expect(r.groups.find((g) => g.docIds.includes(other.id))!.docIds).toEqual([other.id]);
  });

  it("silná shoda dokladu z balíku s jinou existující zakázkou má přednost (varování zůstává)", () => {
    const po = rd("objednavka_zakaznik", {
      doc: order(), bundleKey: ZIP, strongMatch: { jobId: JOB_A, jobNumber: "Z-2026-031", reason: "podle čísla objednávky zákazníka PO-4471", score: 92 },
    });
    const fv = rd("faktura_my", {
      doc: bdoc({ docKind: "faktura", issuer: "my", documentNumber: "FV-1", customer: STROJ }), bundleKey: ZIP,
      strongMatch: { jobId: JOB_B, jobNumber: "Z-2026-029", reason: "podle čísla faktury FV-1", score: 90 },
    });
    const r = groupBatch({ docs: [po, fv], ourIco: OUR });
    expect(r.groups).toHaveLength(2);
    expect(r.groups[0]).toMatchObject({ targetJobId: JOB_A, docIds: [po.id] });
    expect(r.groups[1]).toMatchObject({ targetJobId: JOB_B, docIds: [fv.id] });
    expect(r.warnings.find((w) => w.code === "target_conflict")?.message).toMatch(/Z-2026-029/);
  });

  it("bundleKeyOf: společný ZIP / balík, smíšený doklad bez balíku", () => {
    const f = (fromZip: string | null, bundle?: string): Pick<BatchFile, "fromZip"> & { bundle?: string } => ({ fromZip, ...(bundle ? { bundle } : {}) });
    expect(bundleKeyOf([f("a.zip"), f("a.zip")])).toBe("zip:a.zip");
    expect(bundleKeyOf([f("a.zip"), f(null)])).toBeNull();
    expect(bundleKeyOf([f(null, "mail:42")])).toBe("mail:42");
    expect(bundleKeyOf([])).toBeNull();
  });
});

describe("výkres: firma z razítka se ignoruje, páruje se čísly", () => {
  it("roztřídění: u výkresu prázdné partyName, firma ani v názvu", () => {
    const pages: BatchPage[] = [{ id: "p1", fileId: "f1", page: 1, source: "image", label: "v.jpg", aiLabel: "", duplicateOf: null }];
    const files = [{ id: "f1", filename: "v.jpg", pageCount: 1, splittable: true } as BatchFile];
    const raw = {
      documents: [{
        pages: [1], type: "vykres", title: "Výkres 4711-02 · Konstrukce Novák s.r.o.", documentNumber: "4711-02",
        partyName: "Konstrukce Novák s.r.o.", issuerName: "Konstrukce Novák s.r.o.", issuerIco: "", recipientIco: "",
        drawingNumbers: ["4711-02", "SM-88-1"], flags: [], confidence: 0.9, reason: "", continuesPrevious: false,
      }],
      fileLinks: [], ignoredPages: [], duplicatePages: [], pageLabels: [], notes: [],
    };
    const n = normalizeClassification(raw, pages, files, { ourIco: OUR, customerIcos: [], supplierIcos: [], sentPageIds: ["p1"], margins: true });
    const d = n.sort.docs[0];
    expect(d.partyName).toBe("");
    expect(d.title).toBe("Výkres 4711-02");
    expect(d.drawingNumbers).toEqual(["4711-02", "SM-88-1"]);
    expect(drawingTitle("Konstrukce Novák s.r.o.", ["Konstrukce Novák s.r.o."], ["A-1", "B-2"])).toBe("Výkres A-1 / B-2");
  });

  it("normalizeDrawing: všechna čísla (hlavní první, bez duplicit), čísla objednávky / nabídky z listu", () => {
    const d = normalizeDrawing({ drawingNumber: "KN-77", drawingNumbers: [" SM 4711-03 ", "KN-77", "", 5], customerOrderNumber: "PO 4471", ourQuoteNumber: "NAB-6" });
    expect(d.drawingNumbers).toEqual(["KN-77", "SM 4711-03"]);
    expect(d.ourQuoteNumber).toBe("NAB-6");
    expect(d.customerOrderNumber).toBe("PO4471");
    expect(normalizeDrawing({ drawingNumbers: ["X-1", "Y-2"] }).drawingNumber).toBe("X-1");
  });

  it("výkres se 2 čísly → vazba na položku podle DRUHÉHO čísla", () => {
    const po = rd("objednavka_zakaznik", { doc: order() });
    const vk = rd("vykres", { dr: drawing({ drawingNumber: "KN-77", drawingNumbers: ["KN-77", "4711-03"], revision: "A" }) });
    const g = groupBatch({ docs: [po, vk], ourIco: OUR });
    expect(g.groups).toHaveLength(1);
    const rec = reconcile([po, vk]);
    const st = rec.docStates[vk.id];
    expect(st.kind === "drawing" && st.state.link).toEqual({ mode: "docItem", itemKey: "ai-1" });
    expect(st.kind === "drawing" && st.state.drawingNumber).toBe("KN-77");
    expect(rec.warnings.some((w) => w.code === "unlinked_drawing")).toBe(false);
  });

  it("výkres bez obchodního dokladu → silná shoda s existující otevřenou zakázkou podle čísla výkresu", () => {
    const jobs = [
      mjob(JOB_A, "Z-2026-031", { drawingNumbers: ["4711-03"] }),
      mjob(JOB_B, "Z-2025-002", { drawingNumbers: ["4711-03"], stage: "dokonceno" }),
    ];
    const dr = drawing({ drawingNumber: "KN-77", drawingNumbers: ["KN-77", "4711-03"] });
    const m = drawingDocMatch({ type: "vykres", documentNumber: "KN-77", drawingNumbers: [], extract: { kind: "drawing", drawing: dr } }, jobs);
    expect(m.strong).toMatchObject({ jobId: JOB_A, jobNumber: "Z-2026-031", reason: "podle čísla výkresu 4711-03" });
    const vk = rd("vykres", { dr, strongMatch: m.strong });
    const r = groupBatch({ docs: [vk], ourIco: OUR });
    expect(r.groups).toEqual([expect.objectContaining({ targetJobId: JOB_A, targetRequired: false, autoReason: "podle čísla výkresu 4711-03" })]);
  });

  it("víc otevřených zakázek se stejným číslem → jen návrh + varování; žádná → cíl vybere člověk", () => {
    const jobs = [mjob(JOB_A, "Z-1", { drawingNumbers: ["4711-03"] }), mjob(JOB_B, "Z-2", { drawingNumbers: ["4711-03"] })];
    const m = drawingJobMatch(["4711-03"], {}, jobs);
    expect(m.strong).toBeNull();
    expect(m.hints.map((h) => h.jobNumber)).toEqual(["Z-1", "Z-2"]);
    const vk = rd("vykres", { dr: drawing({ drawingNumber: "4711-03" }), jobHints: m.hints });
    const r = groupBatch({ docs: [vk], ourIco: OUR });
    expect(r.groups[0].targetRequired).toBe(true);
    expect(r.warnings.find((w) => w.code === "group_uncertain")?.message).toMatch(/Z-1, Z-2/);
    expect(drawingJobMatch(["9999-99"], {}, jobs)).toEqual({ strong: null, hints: [] });
  });

  it("číslo naší nabídky / objednávky zákazníka na listu → silná shoda", () => {
    const jobs = [mjob(JOB_A, "Z-1", { quoteNumbers: ["NAB-6"] }), mjob(JOB_B, "Z-2", { customerOrderNumber: "PO-4471" })];
    expect(drawingJobMatch([], { ourQuoteNumber: "NAB-6" }, jobs).strong).toMatchObject({ jobId: JOB_A, reason: "podle čísla nabídky NAB-6" });
    expect(drawingJobMatch([], { customerOrderNumber: "PO-4471" }, jobs).strong).toMatchObject({ jobId: JOB_B, reason: "podle čísla objednávky PO-4471" });
  });

  it("výkres v dávce s objednávkou: číslo v dávce má přednost před existující zakázkou (opakovaná objednávka)", () => {
    const po = rd("objednavka_zakaznik", { doc: order() });
    const vk = rd("vykres", { dr: drawing({ drawingNumber: "4711-02" }), strongMatch: { jobId: JOB_A, jobNumber: "Z-1", reason: "podle čísla výkresu 4711-02", score: 90 } });
    const r = groupBatch({ docs: [po, vk], ourIco: OUR });
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].targetJobId).toBeNull();
  });
});

describe("počty kusů: platí objednávka", () => {
  it("rozdílný počet v nabídce a výkresu → objednávka vyhrává + 1 info upozornění", () => {
    const po = rd("objednavka_zakaznik", { doc: order() });
    const nab = rd("nabidka_my", { doc: quote() });
    const vk = rd("vykres", { dr: drawing({ drawingNumber: "4711-02", quantity: 60 }) });
    const gd = groupDocOf([po, nab, vk], OUR);
    expect(gd.doc.items.map((i) => i.quantity)).toEqual([50, 20]);
    const w = gd.warnings.filter((x) => x.code === "quantity_conflict");
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ severity: "info", message: "Platí objednávka: 50 ks (nabídka 40 ks, výkres 60 ks) — 4711-02" });
    // reconcileGroup už nepřidá druhé (staré) upozornění k výkresu
    expect(reconcile([po, nab, vk]).warnings.filter((x) => x.code === "quantity_conflict")).toHaveLength(1);
  });

  it("chybějící počet v objednávce → z naší nabídky, jinak z poptávky, jinak z výkresu (se zdrojem)", () => {
    const po = rd("objednavka_zakaznik", { doc: order({ items: [item("4711-02", { quantity: 0 }), item("4711-03", { quantity: 0 }), item("4711-04", { quantity: 0 }), item("4711-05", { quantity: 0 })] }) });
    const vk = rd("vykres", { dr: drawing({ drawingNumber: "KN-1", drawingNumbers: ["KN-1", "4711-02"], quantity: 25 }) });
    const vk5 = rd("vykres", { dr: drawing({ drawingNumber: "4711-05", quantity: 12 }) });
    const nab = rd("nabidka_my", { doc: quote({ items: [item("4711-02", { quantity: 40 }), item("4711-03", { quantity: 30 })] }) });
    const rfq = rd("poptavka_zakaznik", { doc: bdoc({ docKind: "poptavka", issuer: "zakaznik", documentNumber: "RFQ-1", customer: STROJ, items: [item("4711-04", { quantity: 7 })] }) });
    const gd = groupDocOf([po, vk, vk5, nab, rfq], OUR);
    expect(gd.doc.items.map((i) => i.quantity)).toEqual([40, 30, 7, 12]);
    expect(gd.itemSources["ai-0"].map((x) => x.label)).toContain("množství z nabídky NAB-6");
    expect(gd.itemSources["ai-1"].map((x) => x.label)).toContain("množství z nabídky NAB-6");
    expect(gd.itemSources["ai-2"].map((x) => x.label)).toContain("množství z poptávky RFQ-1");
    expect(gd.itemSources["ai-3"].map((x) => x.label)).toContain("množství z výkresu 4711-05");
    // výkresy dostanou počet z položky (vč. zdroje)
    expect(gd.drawingInfo[vk.id]).toMatchObject({ quantity: 40, quantitySource: "z nabídky NAB-6" });
    expect(gd.drawingInfo[vk5.id]).toMatchObject({ quantity: 12, quantitySource: "z výkresu 4711-05" });
    expect(gd.warnings.some((w) => w.code === "quantity_conflict")).toBe(false);
  });

  it("položky objednávky bez čísel výkresu: párování názvem, jinak beze změny (žádné párování podle pořadí)", () => {
    const po = rd("objednavka_zakaznik", { doc: order({ items: [item("", { name: "Upínací deska", quantity: 0 }), item("", { name: "Distanční kroužek", quantity: 3 })] }) });
    const nab = rd("nabidka_my", { doc: quote({ items: [item("4711-02", { name: "Upínací deska", quantity: 40 }), item("4711-03", { name: "Vodicí lišta", quantity: 9 })] }) });
    const gd = groupDocOf([po, nab], OUR);
    expect(gd.doc.items.map((i) => [i.name, i.quantity])).toEqual([["Upínací deska", 40], ["Distanční kroužek", 3]]);
  });

  it("bez objednávky: primární doklad jako dnes, prázdné počty z výkresu", () => {
    const rfq = rd("poptavka_zakaznik", { doc: bdoc({ docKind: "poptavka", issuer: "zakaznik", documentNumber: "RFQ-1", customer: STROJ, items: [item("4711-02", { quantity: 0 })] }) });
    const vk = rd("vykres", { dr: drawing({ drawingNumber: "4711-02", quantity: 12 }) });
    expect(groupDocOf([rfq, vk], OUR).doc.items[0].quantity).toBe(12);
  });
});

describe("objednávka na celek", () => {
  const whole = (over: Partial<ExtractedItem> = {}) => order({
    documentNumber: "PO-7", customerOrderNumber: "PO-7", ourQuoteNumber: "NAB-6", totalWithoutVat: 50_000,
    items: [item("", { name: "Výroba dle nabídky NAB-6", quantity: 1, unit: "kpl", unitPrice: 50_000, deliveryDate: "2026-12-01", ...over })],
  });

  it("1 řádek „dle nabídky“ + naše nabídka s položkami → položky a počty z nabídky, hodnota = cena objednávky", () => {
    const po = rd("objednavka_zakaznik", { doc: whole() });
    const nab = rd("nabidka_my", { doc: quote({ items: [item("6600-01", { quantity: 10, unitPrice: 3000 }), item("6600-02", { quantity: 5, unitPrice: 2000 })] }) });
    const gd = groupDocOf([po, nab], OUR);
    expect(gd.doc.items.map((i) => [i.drawingNumber, i.quantity, i.deliveryDate])).toEqual([["6600-01", 10, "2026-12-01"], ["6600-02", 5, "2026-12-01"]]);
    expect(gd.doc.totalWithoutVat).toBe(50_000);
    expect(gd.warnings.find((w) => w.code === "whole_order")?.message).toMatch(/^Objednávka je na celek — položky a počty převzaty z nabídky NAB-6/);
    const rec = reconcile([po, nab]);
    expect(rec.state.job.items.map((i) => [i.drawingNumber, i.quantity])).toEqual([["6600-01", "10"], ["6600-02", "5"]]);
    expect(rec.state.job.fields.value).toBe("50000");
  });

  it("bez nabídky → položky z výkresů (číslo, název, materiál, počet)", () => {
    const po = rd("objednavka_zakaznik", { doc: whole({ name: "Kompletní dodávka dílů" }) });
    const v1 = rd("vykres", { dr: drawing({ drawingNumber: "7700-01", title: "Čep", material: "C45", quantity: 4 }) });
    const v2 = rd("vykres", { dr: drawing({ drawingNumber: "7700-02", title: "Kolík", material: "11SMn30", quantity: 8 }) });
    const gd = groupDocOf([po, v1, v2], OUR);
    expect(gd.doc.items.map((i) => [i.drawingNumber, i.name, i.material, i.quantity])).toEqual([["7700-01", "Čep", "C45", 4], ["7700-02", "Kolík", "11SMn30", 8]]);
    const rec = reconcile([po, v1, v2]);
    const st = rec.docStates[v2.id];
    expect(st.kind === "drawing" && st.state.link).toEqual({ mode: "docItem", itemKey: "ai-1" });
  });

  it("není celek: řádek s názvem shodným s položkou nabídky, nebo víc řádků", () => {
    expect(isWholeOrder([item("", { name: "Upínací deska", quantity: 1 })], [item("4711-02", { name: "Upínací deska" })])).toBe(false);
    expect(isWholeOrder([item("A-1"), item("A-2")], [item("B-1")])).toBe(false);
    expect(isWholeOrder([item("", { name: "Výroba dle Vaší nabídky č. NAB-6", quantity: 1 })], [item("B-1")])).toBe(true);
    expect(isWholeOrder([], [item("B-1")])).toBe(true);
    const po = rd("objednavka_zakaznik", { doc: order({ items: [item("", { name: "Upínací deska", quantity: 5 })] }) });
    const nab = rd("nabidka_my", { doc: quote({ items: [item("4711-02", { name: "Upínací deska", quantity: 40 })] }) });
    const gd = groupDocOf([po, nab], OUR);
    expect(gd.doc.items.map((i) => i.quantity)).toEqual([5]);
    expect(gd.warnings.some((w) => w.code === "whole_order")).toBe(false);
  });
});

describe("pravidla — hraniční případy (ověření)", () => {
  const jobA = {
    id: JOB_A, number: "Z-1", stage: "nabidka_odeslana", title: "x", customer: { id: "c0000000-0000-4000-8000-0000000000aa", name: STROJ.name },
    customerOrderNumber: null, customerInquiryNumber: null, customerContact: null, customerContactEmail: null, customerContactPhone: null,
    inquiryDate: null, orderDate: null, customerRequiredDate: null, dueDate: null, expectedDeliveryDate: null, supplierPromisedDate: null,
    value: 800, supplier: null, supplierOrderNumber: null, invoiceNumber: null, deliveryNoteNumber: null,
    items: [
      { id: "i1", position: 0, drawingNumber: "4711-02", revision: null, name: "Díl", description: null, material: null, quantity: 40, unit: "ks", unitPrice: 10, purchaseUnitPrice: null, note: null },
      { id: "i2", position: 1, drawingNumber: "4711-03", revision: null, name: "Díl", description: null, material: null, quantity: 20, unit: "ks", unitPrice: 10, purchaseUnitPrice: null, note: null },
    ],
  } as unknown as GroupJobCandidate["job"];
  const strongA = { jobId: JOB_A, jobNumber: "Z-1", reason: "podle čísla nabídky NAB-6", score: 95 };

  it("1 řádek s konkrétním počtem (50 ks) není celek — platí objednávka, z nabídky jen číslo výkresu", () => {
    for (const name of ["Výroba hřídele dle přiloženého výkresu", "Hřídel – dodávka dle výkresu", "Zakázková výroba hřídele"]) {
      const po = rd("objednavka_zakaznik", { doc: order({ items: [item("", { name, quantity: 50, unitPrice: 200 })], totalWithoutVat: 10_000 }) });
      const nab = rd("nabidka_my", { doc: quote({ items: [item("VR-902-H", { name: "Hřídel", quantity: 40, unitPrice: 210 })] }) });
      const gd = groupDocOf([po, nab], OUR);
      expect(gd.doc.items.map((i) => [i.drawingNumber, i.quantity, i.unitPrice])).toEqual([["VR-902-H", 50, 200]]);
      expect(gd.warnings.some((w) => w.code === "whole_order")).toBe(false);
      expect(gd.warnings.find((w) => w.code === "quantity_conflict")?.message).toBe("Platí objednávka: 50 ks (nabídka 40 ks) — VR-902-H");
    }
    // 1 ks bez slova „celek" / odkazu na nabídku + výkres se 4 ks → 1 ks, výkres navázaný
    const po = rd("objednavka_zakaznik", { doc: order({ items: [item("", { name: "Příruba DN50", quantity: 1, unitPrice: 5000 })], totalWithoutVat: 5000 }) });
    const vk = rd("vykres", { dr: drawing({ drawingNumber: "FL-50", title: "Flansch DN50", quantity: 4 }) });
    const gd = groupDocOf([po, vk], OUR);
    expect(gd.doc.items.map((i) => [i.drawingNumber, i.quantity])).toEqual([["FL-50", 1]]);
    const st = reconcile([po, vk]).docStates[vk.id];
    expect(st.kind === "drawing" && st.state.link).toEqual({ mode: "docItem", itemKey: "ai-0" });
    expect(isWholeOrder([item("", { name: "Výroba hřídele", quantity: 50 })], [item("B-1"), item("B-2")])).toBe(false);
    expect(isWholeOrder([item("", { name: "Výroba hřídele", quantity: 0 })], [item("B-1")])).toBe(true);
    expect(isWholeOrder([item("", { name: "Díly", quantity: 3, unit: "kpl" })], [item("B-1")])).toBe(true);
  });

  it("samostatná objednávka jiného zákazníka se nesloučí se ZIPem (poptávka ZIPu bez čitelného zákazníka)", () => {
    const kovo = rd("objednavka_zakaznik", { doc: order({ documentNumber: "PO-9", customerOrderNumber: "PO-9", customer: { ...KOVO, ico: "27654398" }, items: [item("9000-01")] }) });
    const rfq = rd("poptavka_zakaznik", { doc: bdoc({ docKind: "poptavka", issuer: "zakaznik", documentNumber: "RFQ-1", customer: emptyParty(), items: [item("4711-02")] }), bundleKey: ZIP });
    const nab = rd("nabidka_my", { doc: quote(), bundleKey: ZIP });
    // naše nabídka, u které AI přečetla jako zákazníka naše IČO
    const nab2 = rd("nabidka_my", { doc: quote({ documentNumber: "NAB-7", ourQuoteNumber: "NAB-7", customer: { ...emptyParty(), name: "Mnástrojárna s.r.o.", ico: OUR } }), bundleKey: ZIP });
    const r = groupBatch({ docs: [kovo, rfq, nab, nab2], ourIco: OUR });
    const kg = r.groups.find((g) => g.docIds.includes(kovo.id))!;
    expect(kg.docIds).toEqual([kovo.id]);
    expect(kg.customerConfirmed).toBeUndefined();
    const zg = r.groups.find((g) => g.docIds.includes(nab.id))!;
    expect(zg.docIds.sort()).toEqual([rfq.id, nab.id, nab2.id].sort());
    expect(zg.customerConfirmed).toBe(true);
    // doklad zvenku ve skupině s balíkem → zákazník se nepotvrzuje automaticky
    const same = rd("objednavka_zakaznik", { doc: order({ documentNumber: "PO-1", customerOrderNumber: "PO-1" }) });
    const r2 = groupBatch({ docs: [same, rd("nabidka_my", { doc: quote(), bundleKey: ZIP })], ourIco: OUR });
    expect(r2.groups).toHaveLength(1);
    expect(r2.groups[0].customerConfirmed).toBeUndefined();
  });

  it("objednávka k existující zakázce bez objednávky: počet z objednávky přepíše položku (override)", () => {
    const po = rd("objednavka_zakaznik", { doc: order({ ourQuoteNumber: "NAB-6" }), strongMatch: strongA });
    const vk = rd("vykres", { dr: drawing({ drawingNumber: "4711-02", quantity: 60 }) });
    const rec = reconcile([po, vk], { group: { targetJobId: JOB_A }, jobs: [{ job: jobA, reason: strongA.reason, score: 95 }] });
    expect(rec.state.job.targetKey).toBe(JOB_A);
    expect(rec.state.job.merges).toEqual([
      { itemId: "i1", label: "4711-02 Díl", drawingNumber: "4711-02", patch: { quantity: "50" }, apply: true, override: ["quantity"] },
    ]);
    expect(rec.warnings.map((w) => w.message)).toContain("Platí objednávka: 50 ks (zakázka 40 ks) — 4711-02");
    // zakázka už objednávku má (revize) → položky se nemění, jen upozornění
    const withOrder = { ...jobA, customerOrderNumber: "PO-4471" } as GroupJobCandidate["job"];
    const rec2 = reconcile([po], { group: { targetJobId: JOB_A }, jobs: [{ job: withOrder, reason: strongA.reason, score: 95 }] });
    expect(rec2.state.job.merges.some((m) => m.override)).toBe(false);
    expect(rec2.warnings.map((w) => w.message)).toContain("Zakázka už objednávku má — počet se nemění: zakázka 40 ks, objednávka 50 ks — 4711-02");
  });

  it("objednávka bez čísel výkresu: nabídka je most (číslo podle názvu) → výkresy navázané, počty z objednávky", () => {
    const po = rd("objednavka_zakaznik", { doc: order({ items: [item("", { name: "Upínací deska", quantity: 50 }), item("", { name: "Vodicí lišta", quantity: 8 })] }) });
    const nab = rd("nabidka_my", { doc: quote({ items: [item("4711-02", { name: "Upínací deska", quantity: 40 }), item("4711-03", { name: "Vodicí lišta", quantity: 9 })] }) });
    const v1 = rd("vykres", { dr: drawing({ drawingNumber: "4711-02", title: "Upínací deska", quantity: 60 }) });
    const v2 = rd("vykres", { dr: drawing({ drawingNumber: "4711-03", title: "Vodicí lišta" }) });
    const gd = groupDocOf([po, nab, v1, v2], OUR);
    expect(gd.doc.items.map((i) => [i.drawingNumber, i.quantity])).toEqual([["4711-02", 50], ["4711-03", 8]]);
    expect(gd.itemSources["ai-0"]).toContainEqual({ docId: nab.id, label: "číslo výkresu z nabídky NAB-6" });
    const rec = reconcile([po, nab, v1, v2]);
    const links = [v1, v2].map((v) => { const s = rec.docStates[v.id]; return s.kind === "drawing" ? s.state.link : null; });
    expect(links).toEqual([{ mode: "docItem", itemKey: "ai-0" }, { mode: "docItem", itemKey: "ai-1" }]);
    expect(rec.warnings.some((w) => w.code === "unlinked_drawing")).toBe(false);
    // bez nabídky: výkres se stejným názvem doplní číslo i chybějící počet
    const po2 = rd("objednavka_zakaznik", { doc: order({ items: [item("", { name: "Upínací deska", quantity: 0 }), item("", { name: "Vodicí lišta", quantity: 8 })] }) });
    expect(groupDocOf([po2, v1], OUR).doc.items.map((i) => [i.drawingNumber, i.quantity])).toEqual([["4711-02", 60], ["", 8]]);
  });

  it("ZIP se 2 objednávkami: 1 skupina; „Rozdělit“ vezme s druhou objednávkou i její nabídku a výkres", () => {
    const a = rd("objednavka_zakaznik", { doc: order({ ourQuoteNumber: "NAB-5" }), bundleKey: ZIP });
    const b = rd("objednavka_zakaznik", { doc: order({ documentNumber: "PO-4480", customerOrderNumber: "PO-4480", ourQuoteNumber: "NAB-6", totalWithoutVat: 9000, items: [item("", { name: "Výroba dle nabídky NAB-6", quantity: 1, unit: "kpl" })] }), bundleKey: ZIP });
    const nab = rd("nabidka_my", { doc: quote({ items: [item("6600-01", { quantity: 3 }), item("6600-02", { quantity: 4 })] }), bundleKey: ZIP });
    const v1 = rd("vykres", { dr: drawing({ drawingNumber: "6600-01" }), bundleKey: ZIP });
    const r = groupBatch({ docs: [a, b, nab, v1], ourIco: OUR });
    expect(r.groups).toHaveLength(1);
    const act = r.warnings.find((w) => w.code === "multiple_orders")!.actions[0];
    expect([...act.docIds!].sort()).toEqual([b.id, nab.id, v1.id].sort());
    const key = `new:${b.id}`;
    const split = groupBatch({ docs: [a, b, nab, v1], ourIco: OUR, assign: Object.fromEntries(act.docIds!.map((id) => [id, key])) });
    const gb = split.groups.find((g) => g.docIds.includes(b.id))!;
    expect(gb.docIds.sort()).toEqual([b.id, nab.id, v1.id].sort());
    expect(split.groups.find((g) => g.docIds.includes(a.id))!.docIds).toEqual([a.id]);
    // mimo balík totéž: 1 skupina, nabídka bez zákazníka odejde při rozdělení s objednávkou, která na ni odkazuje
    const a2 = { ...a, bundleKey: null };
    const b2 = { ...b, bundleKey: null };
    const nab2 = rd("nabidka_my", { doc: quote({ customer: emptyParty() }) });
    const r2 = groupBatch({ docs: [a2, b2, nab2], ourIco: OUR });
    expect(r2.groups).toHaveLength(1);
    expect(r2.warnings.find((w) => w.code === "multiple_orders")!.actions[0].docIds).toEqual([b2.id, nab2.id]);
  });

  it("výkres ze ZIPu se silnou shodou na jinou zakázku → k ní, s upozorněním k potvrzení", () => {
    const v1 = rd("vykres", { dr: drawing({ drawingNumber: "4711-02" }), bundleKey: ZIP, strongMatch: { jobId: JOB_A, jobNumber: "Z-1", reason: "podle čísla výkresu 4711-02", score: 90 } });
    const v2 = rd("vykres", { dr: drawing({ drawingNumber: "5500-01" }), bundleKey: ZIP, strongMatch: { jobId: JOB_B, jobNumber: "Z-2", reason: "podle čísla výkresu 5500-01", score: 90 } });
    const r = groupBatch({ docs: [v1, v2], ourIco: OUR });
    expect(r.groups.map((g) => [g.targetJobId, g.docIds])).toEqual([[JOB_A, [v1.id]], [JOB_B, [v2.id]]]);
    const w = r.warnings.find((x) => x.code === "target_conflict")!;
    expect(w).toMatchObject({ severity: "warn", docIds: [v2.id] });
    expect(w.actions?.[0]).toMatchObject({ kind: "move_to_group", label: "Ne, k Z-1", docId: v2.id });
    // výkres ze ZIPu, jehož číslo je v objednávce balíku, zůstává u ní i se silnou shodou jinam
    const po = rd("objednavka_zakaznik", { doc: order(), bundleKey: ZIP });
    const v3 = rd("vykres", { dr: drawing({ drawingNumber: "4711-03" }), bundleKey: ZIP, strongMatch: { jobId: JOB_B, jobNumber: "Z-2", reason: "podle čísla výkresu 4711-03", score: 90 } });
    const r2 = groupBatch({ docs: [po, v3], ourIco: OUR });
    expect(r2.groups).toHaveLength(1);
  });

  it("výkres s číslem u 2 zakázek se nepřilepí ke skupině jiného zákazníka → vlastní skupina s výběrem", () => {
    const jobs = [mjob(JOB_A, "Z-1", { drawingNumbers: ["4711-03"] }), mjob(JOB_B, "Z-2", { drawingNumbers: ["4711-03"] })];
    const m = drawingJobMatch(["4711-03"], {}, jobs);
    const kovo = rd("objednavka_zakaznik", { doc: order({ documentNumber: "PO-9", customerOrderNumber: "PO-9", customer: KOVO, items: [item("9000-01")] }) });
    const vk = rd("vykres", { dr: drawing({ drawingNumber: "4711-03" }), jobHints: m.hints });
    const r = groupBatch({ docs: [kovo, vk], ourIco: OUR });
    const g = r.groups.find((x) => x.docIds.includes(vk.id))!;
    expect(g.docIds).toEqual([vk.id]);
    expect(g.targetRequired).toBe(true);
    expect(r.warnings.find((w) => w.code === "group_uncertain")?.message).toMatch(/Z-1, Z-2/);
  });

  it("drawingTitle maže firmu jen jako celé slovo", () => {
    expect(drawingTitle("Kovový držák", ["KOVO"], ["A-1"])).toBe("Kovový držák");
    expect(drawingTitle("Držák · Kovo s.r.o.", ["Kovo s.r.o."], ["A-1"])).toBe("Držák");
    expect(drawingTitle("KOVO – Držák", ["KOVO"], ["A-1"])).toBe("Držák");
  });

  it("bundleKeyOf: klíč ZIPu z úložiště má přednost před názvem (dva stejně pojmenované ZIPy = dva balíky)", () => {
    expect(bundleKeyOf([{ fromZip: "vykresy.zip", bundle: "zip:u/1/a.zip" }, { fromZip: "vykresy.zip", bundle: "zip:u/1/b.zip" }])).toBeNull();
    expect(bundleKeyOf([{ fromZip: "vykresy.zip", bundle: "zip:u/1/a.zip" }])).toBe("zip:u/1/a.zip");
  });
});
