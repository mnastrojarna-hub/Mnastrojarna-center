import { describe, it, expect } from "vitest";
import {
  JOURNAL_CONFLICT, applyGroupFills, canAutoApplyBatch, groupBatch, groupDocOf, journalConflictOf, mergeGroupDoc, primaryDocId, reconcileGroup,
  sameDocParty,
  sanitizeBatchApplyState, swapParties, type GroupDraft, type GroupJobCandidate, type ReconcileDoc,
} from "./capture-batch-reconcile";
import type { BatchApplyState, BatchDocType, BatchPage, BatchReviewModel, DocApplyState, DocExtractSummary } from "./capture-batch-types";
import type { ExtractedBusinessDoc, ExtractedItem, ExtractedParty } from "./capture-types";
import { emptyExtracted, emptyParty } from "./extracted-normalize";
import type { JobDetail } from "./types";
import { BATCH_TYPES, blankDraft } from "./capture-batch";

const OUR = "04304080";
const STROJ: ExtractedParty = { ...emptyParty(), name: "STROJMETAL, a. s.", ico: "45274649", contactPerson: "Ing. Dvořák" };
// platné IČO (mod 11): IČO se špatným součtem je chyba čtení → u stejného výkresu jen dotaz, ne jiný zákazník
const KOVO: ExtractedParty = { ...emptyParty(), name: "Kovo Plus s.r.o.", ico: "27654320" };
const HRUBY: ExtractedParty = { ...emptyParty(), name: "Kovoobrábění Hrubý s.r.o.", ico: "25874411" };

const item = (drawingNumber: string, over: Partial<ExtractedItem> = {}): ExtractedItem => ({
  drawingNumber, revision: "", name: `Díl ${drawingNumber}`, description: "", material: "", quantity: 10, unit: "ks", unitPrice: 0, deliveryDate: "", ...over,
});

function bdoc(over: Partial<ExtractedBusinessDoc>): ExtractedBusinessDoc {
  return { ...emptyExtracted(), confidence: 0.92, ...over };
}

let seq = 0;
function rd(type: BatchDocType, over: Partial<ReconcileDoc> & { doc?: ExtractedBusinessDoc } = {}): ReconcileDoc {
  const { doc, ...rest } = over;
  const id = rest.id ?? `d${++seq}`;
  return {
    id, type, flags: [], documentNumber: doc?.documentNumber ?? "", drawingNumbers: [], title: "", filename: `${id}.jpg`,
    aiType: type, extract: doc ? { kind: "business", doc } : null, aiUsed: Boolean(doc), reason: null, confidence: doc?.confidence ?? null,
    customerMatch: null, supplierMatch: null, strongMatch: null, ...rest,
  };
}

const order = (over: Partial<ExtractedBusinessDoc> = {}) => bdoc({
  docKind: "objednavka", issuer: "zakaznik", documentNumber: "PO-4471", customerOrderNumber: "PO-4471", customer: STROJ,
  items: [item("4711-02", { revision: "C" }), item("4711-03")], totalWithoutVat: 1000, ...over,
});

function job(over: Partial<JobDetail> = {}): JobDetail {
  return {
    id: "11111111-1111-4111-8111-111111111111", number: "Z-2026-031", title: "Zakázka", stage: "objednavka",
    customer: { id: "c1", name: "Strojmetal a.s." }, supplier: null, items: [], quotes: [], files: [], events: [],
    customerOrderNumber: null, customerInquiryNumber: null, customerContact: null, customerContactEmail: null, customerContactPhone: null,
    inquiryDate: null, orderDate: null, customerRequiredDate: null, dueDate: null, expectedDeliveryDate: null, supplierPromisedDate: null,
    value: null, supplierOrderNumber: null, invoiceNumber: null, deliveryNoteNumber: null,
    ...over,
  } as unknown as JobDetail;
}

function group(docs: ReconcileDoc[], over: Partial<GroupDraft> = {}): GroupDraft {
  return { key: "g1", docIds: docs.map((d) => d.id), targetJobId: null, targetRequired: false, autoReason: null, customerName: "", partyKey: "", ...over };
}

function reconcile(docs: ReconcileDoc[], over: { jobs?: GroupJobCandidate[]; margins?: boolean; group?: Partial<GroupDraft>; jobsWithWinner?: string[] } = {}) {
  return reconcileGroup({
    captureId: "c0000000-0000-4000-8000-000000000001", group: group(docs, over.group), docs, margins: over.margins ?? true,
    mode: "approval", ourIco: OUR, fixedJobId: null, jobs: over.jobs ?? [], jobsWithWinner: over.jobsWithWinner,
  });
}

describe("groupBatch", () => {
  it("2 objednávky různých zákazníků → 2 skupiny", () => {
    const a = rd("objednavka_zakaznik", { doc: order() });
    const b = rd("objednavka_zakaznik", { doc: order({ documentNumber: "PO-9", customerOrderNumber: "PO-9", customer: KOVO }) });
    const r = groupBatch({ docs: [a, b], ourIco: OUR });
    expect(r.groups.map((g) => g.docIds)).toEqual([[a.id], [b.id]]);
    expect(r.groups[1].autoReason).toMatch(/jiný zákazník/);
  });

  it("2 objednávky téhož zákazníka s jiným číslem → 1 skupina + „Rozdělit na samostatné zakázky“ jedním ťuknutím", () => {
    const a = rd("objednavka_zakaznik", { doc: order() });
    const b = rd("objednavka_zakaznik", { doc: order({ documentNumber: "PO-4480", customerOrderNumber: "PO-4480" }) });
    const r = groupBatch({ docs: [a, b], ourIco: OUR });
    expect(r.groups).toHaveLength(1);
    const w = r.warnings.find((x) => x.code === "multiple_orders")!;
    expect(w).toMatchObject({ severity: "warn", docIds: [b.id] });
    expect(w.message).toMatch(/Další objednávka PO-4480 s jiným číslem než PO-4471/);
    expect(w.actions[0]).toMatchObject({ kind: "split_group", label: "Rozdělit na samostatné zakázky", docIds: [b.id] });
    // rozdělení = přiřazení „new"
    const split = groupBatch({ docs: [a, b], ourIco: OUR, assign: { [b.id]: "new" } });
    expect(split.groups.map((g) => g.docIds)).toEqual([[a.id], [b.id]]);
    expect(split.warnings.some((x) => x.code === "multiple_orders")).toBe(false);
  });

  it("objednávka + náš DL + naše faktura stejného zákazníka → 1 skupina", () => {
    const docs = [
      rd("objednavka_zakaznik", { doc: order() }),
      rd("dodaci_list_my", { doc: bdoc({ docKind: "dodaci_list", issuer: "my", documentNumber: "DL-1", customer: STROJ, items: [item("4711-02")] }) }),
      rd("faktura_my", { doc: bdoc({ docKind: "faktura", issuer: "my", documentNumber: "FV-118", customer: STROJ }) }),
    ];
    const r = groupBatch({ docs, ourIco: OUR });
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].docIds).toHaveLength(3);
  });

  it("podobný název bez IČO → stejná skupina, jen info (bez blokujícího dotazu); rozdělit jde jedním ťuknutím", () => {
    const a = rd("objednavka_zakaznik", { doc: order({ customer: { ...emptyParty(), name: "Strojmetal Kladno a.s." } }) });
    const b = rd("faktura_my", { doc: bdoc({ docKind: "faktura", issuer: "my", documentNumber: "FV-1", customer: { ...emptyParty(), name: "Strojmetal Praha s.r.o." } }) });
    const r = groupBatch({ docs: [a, b], ourIco: OUR });
    expect(r.groups).toHaveLength(1);
    expect(r.warnings.some((x) => x.severity === "block")).toBe(false);
    const w = r.warnings.find((x) => x.code === "customer_written_differently");
    expect(w?.severity).toBe("info");
    expect(w?.actions.map((x) => x.label)).toEqual(["Rozdělit na samostatné zakázky"]);
    // úplně jiný název bez IČO → pořád 1 skupina, upozornění (ne blok) s potvrzením
    const c = rd("faktura_my", { doc: bdoc({ docKind: "faktura", issuer: "my", documentNumber: "FV-2", customer: { ...emptyParty(), name: "Obráběcí centrum Beta" } }) });
    const r2 = groupBatch({ docs: [a, c], ourIco: OUR });
    expect(r2.groups).toHaveLength(1);
    expect(r2.warnings.find((x) => x.code === "customer_written_differently")).toMatchObject({ severity: "warn" });
    expect(r2.warnings.find((x) => x.code === "customer_written_differently")!.actions.map((x) => x.label)).toEqual(["Je to stejný zákazník", "Rozdělit na samostatné zakázky"]);
    expect(groupBatch({ docs: [a, c], ourIco: OUR, customerConfirmed: ["g1"] }).warnings.find((x) => x.code === "customer_written_differently")?.severity).toBe("info");
    // „Rozdělit" = přiřazení do nové skupiny
    const split = groupBatch({ docs: [a, b], ourIco: OUR, assign: { [b.id]: "new" } });
    expect(split.groups).toHaveLength(2);
    expect(split.warnings.some((x) => x.code === "customer_written_differently")).toBe(false);
  });

  it("odlišné IČO na obou dokladech → samostatné skupiny; ruční sloučení chce potvrzení", () => {
    const a = rd("objednavka_zakaznik", { doc: order() });
    const b = rd("faktura_my", { doc: bdoc({ docKind: "faktura", issuer: "my", documentNumber: "FV-1", customer: KOVO }) });
    const r = groupBatch({ docs: [a, b], ourIco: OUR });
    expect(r.groups).toHaveLength(2);
    expect(r.groups[1].autoReason).toMatch(/jiný zákazník — IČO 27654320/);
    const merged = groupBatch({ docs: [a, b], ourIco: OUR, assign: { [b.id]: "g1" } });
    expect(merged.groups).toHaveLength(1);
    expect(merged.warnings.find((x) => x.code === "customer_conflict")).toMatchObject({ severity: "block" });
    const ok = groupBatch({ docs: [a, b], ourIco: OUR, assign: { [b.id]: "g1" }, customerConfirmed: ["g1"] });
    expect(ok.warnings.some((x) => x.code === "customer_conflict")).toBe(false);
    // potvrzení přežije přepočet (stav skupiny → serverová kontrola uložení projde)
    expect(ok.groups[0].customerConfirmed).toBe(true);
    const rec = reconcile([a, b], { group: ok.groups[0] });
    expect(rec.state.customerConfirmed).toBe(true);
    const pages: BatchPage[] = [a, b].map((d, i) => ({ id: `p${i + 1}`, fileId: `f${i + 1}`, page: 1, source: "image", label: d.id, aiLabel: "", duplicateOf: null }));
    const state: BatchApplyState = {
      sort: {
        docs: [a, b].map((d, i) => ({
          id: d.id, type: d.type, pageIds: [`p${i + 1}`], aiType: d.type, confidence: 0.9, reason: "", title: "", documentNumber: d.documentNumber,
          partyName: "", drawingNumbers: [], format: null, flags: [], issuerCheck: "unknown", excluded: false,
        })),
        excludedPageIds: [],
      },
      groups: [rec.state],
      docs: rec.docStates,
    };
    const parties = { [a.id]: { name: STROJ.name, ico: STROJ.ico }, [b.id]: { name: KOVO.name, ico: KOVO.ico } };
    expect(sanitizeBatchApplyState(state, { pages, margins: true, ourIco: OUR, customerParties: parties }).ok).toBe(true);
    const unconfirmed = sanitizeBatchApplyState({ ...state, groups: [{ ...rec.state, customerConfirmed: false }] }, { pages, margins: true, ourIco: OUR, customerParties: parties });
    expect(unconfirmed.ok).toBe(false);
  });

  it("rozdělení víc dokladů najednou („new:<doklad>“) = jedna nová skupina", () => {
    const a = rd("objednavka_zakaznik", { doc: order() });
    const b = rd("objednavka_zakaznik", { doc: order({ documentNumber: "PO-9", customerOrderNumber: "PO-9", items: [item("9000-01")] }) });
    const v = rd("vykres", { documentNumber: "9000-01" });
    const r = groupBatch({ docs: [a, b, v], ourIco: OUR });
    expect(r.groups).toHaveLength(1);
    const act = r.warnings.find((x) => x.code === "multiple_orders")!.actions[0];
    expect(act.docIds).toEqual([b.id, v.id]);
    const key = `new:${b.id}`;
    const split = groupBatch({ docs: [a, b, v], ourIco: OUR, assign: { [b.id]: key, [v.id]: key } });
    expect(split.groups.map((g) => g.docIds)).toEqual([[a.id], [b.id, v.id]]);
    expect(split.groups[1].autoReason).toMatch(/rozděleno ručně/);
  });

  it("další objednávka se silnou shodou na existující zakázku → odejde k ní (primární je nová)", () => {
    const a = rd("objednavka_zakaznik", { doc: order() });
    const b = rd("objednavka_zakaznik", {
      doc: order({ documentNumber: "PO-9", customerOrderNumber: "PO-9" }),
      strongMatch: { jobId: "22222222-2222-4222-8222-222222222222", jobNumber: "Z-2026-029", reason: "podle čísla objednávky PO-9", score: 92 },
    });
    const r = groupBatch({ docs: [a, b], ourIco: OUR });
    expect(r.groups).toHaveLength(2);
    expect(r.groups[0]).toMatchObject({ targetJobId: null, docIds: [a.id] });
    expect(r.groups[1]).toMatchObject({ targetJobId: "22222222-2222-4222-8222-222222222222", docIds: [b.id] });
    expect(r.warnings.some((x) => x.code === "multiple_orders")).toBe(false);
  });

  it("silná shoda DL dodavatele s jinou zakázkou → vlastní skupina s cílem a akcí zpět", () => {
    const o = rd("objednavka_zakaznik", { doc: order() });
    const dl = rd("dodaci_list_dodavatel", {
      doc: bdoc({ docKind: "dodaci_list", issuer: "dodavatel", documentNumber: "DL-55", supplier: HRUBY, customerOrderNumber: "OV-2026-014" }),
      strongMatch: { jobId: "22222222-2222-4222-8222-222222222222", jobNumber: "Z-2026-029", reason: "podle naší objednávky OV-2026-014", score: 92 },
    });
    const r = groupBatch({ docs: [o, dl], ourIco: OUR });
    expect(r.groups).toHaveLength(2);
    expect(r.groups[1]).toMatchObject({ targetJobId: "22222222-2222-4222-8222-222222222222", autoReason: "podle naší objednávky OV-2026-014" });
    const w = r.warnings.find((x) => x.code === "target_conflict");
    expect(w?.actions[0]).toMatchObject({ kind: "move_to_group", groupKey: "g1" });
    // „Ne, k …" = přiřazení zpět
    expect(groupBatch({ docs: [o, dl], ourIco: OUR, assign: { [dl.id]: "g1" } }).groups).toHaveLength(1);
  });

  it("jen dodavatelské doklady bez shody → skupina bez cíle (vybrat zakázku)", () => {
    const dl = rd("dodaci_list_dodavatel", { doc: bdoc({ docKind: "dodaci_list", issuer: "dodavatel", supplier: HRUBY }) });
    const r = groupBatch({ docs: [dl], ourIco: OUR });
    expect(r.groups[0]).toMatchObject({ targetRequired: true, targetJobId: null });
    const fixed = groupBatch({ docs: [dl], ourIco: OUR, fixedJobId: "33333333-3333-4333-8333-333333333333" });
    expect(fixed.groups[0]).toMatchObject({ targetJobId: "33333333-3333-4333-8333-333333333333", targetRequired: false });
  });

  it("výkresy ke skupině s jejich číslem, nabídka dodavatele k průniku výkresů", () => {
    const a = rd("objednavka_zakaznik", { doc: order() });
    const b = rd("objednavka_zakaznik", { doc: order({ documentNumber: "PO-9", customerOrderNumber: "PO-9", customer: KOVO, items: [item("5500-01")] }) });
    const v = rd("vykres", { documentNumber: "5500-01" });
    const q = rd("nabidka_dodavatel", { doc: bdoc({ docKind: "nabidka", issuer: "dodavatel", supplier: HRUBY, items: [item("5500-01", { unitPrice: 100 })] }) });
    const r = groupBatch({ docs: [a, b, v, q], ourIco: OUR });
    expect(r.groups.find((g) => g.docIds.includes(v.id))?.docIds).toContain(b.id);
    expect(r.groups.find((g) => g.docIds.includes(q.id))?.docIds).toContain(b.id);
  });

  it("nejednoznačný dodavatelský doklad → první skupina + upozornění", () => {
    const a = rd("objednavka_zakaznik", { doc: order() });
    const b = rd("objednavka_zakaznik", { doc: order({ documentNumber: "PO-9", customerOrderNumber: "PO-9", customer: KOVO, items: [] }) });
    const f = rd("faktura_dodavatel", { doc: bdoc({ docKind: "faktura", issuer: "dodavatel", supplier: HRUBY }) });
    const r = groupBatch({ docs: [a, b, f], ourIco: OUR });
    expect(r.groups[0].docIds).toContain(f.id);
    expect(r.warnings.find((w) => w.code === "group_uncertain")?.actions[0]).toMatchObject({ kind: "move_to_group", groupKey: "g2" });
  });
});

describe("primární doklad a sloučení", () => {
  it("pořadí primárního dokladu", () => {
    expect(primaryDocId([{ id: "a", type: "faktura_my" }, { id: "b", type: "objednavka_zakaznik" }])).toBe("b");
    expect(primaryDocId([{ id: "a", type: "nabidka_dodavatel" }, { id: "b", type: "dodaci_list_dodavatel" }])).toBe("b");
    expect(primaryDocId([{ id: "a", type: "vykres" }])).toBeNull();
  });

  it("objednávka + DL + faktura se stejnými položkami → položky jen z objednávky, ostatní jen doplní", () => {
    const o = rd("objednavka_zakaznik", { doc: order({ items: [item("4711-02"), item("4711-03")] }) });
    const dl = rd("dodaci_list_my", { doc: bdoc({ docKind: "dodaci_list", issuer: "my", documentNumber: "DL-1", customer: STROJ, items: [item("4711-02", { material: "1.2379" }), item("4711-03")] }) });
    const fv = rd("faktura_my", { doc: bdoc({ docKind: "faktura", issuer: "my", documentNumber: "FV-118", customer: STROJ, items: [item("4711-02"), item("4711-03", { revision: "A" })] }) });
    const res = reconcile([o, dl, fv]);
    expect(res.state.job.items).toHaveLength(2);
    expect(res.state.job.items.map((i) => i.material)[0]).toBe("1.2379");
    expect(res.review.itemSources["ai-0"]?.[0].label).toMatch(/materiál z dodacího listu DL-1/);
    expect(res.review.itemSources["ai-1"]?.[0].label).toMatch(/revize z faktury FV-118/);
    const dlReview = res.docs.find((d) => d.docId === dl.id);
    expect(dlReview && dlReview.kind === "business" ? dlReview.unmatchedRows : null).toEqual([]);
    expect(res.state.job.stage).toBe("fakturovano");
  });

  it("DL dodavatele bez čísla + objednávka zákazníka → žádné doplnění přes strany", () => {
    const o = rd("objednavka_zakaznik", { doc: order({ customerOrderNumber: "" , documentNumber: "" }) });
    const dl = rd("dodaci_list_dodavatel", { doc: bdoc({ docKind: "dodaci_list", issuer: "dodavatel", supplier: HRUBY, customerOrderNumber: "OV-2026-014" }) });
    const res = reconcile([o, dl]);
    expect(res.state.job.fields.customerOrderNumber ?? "").toBe("");
    expect(res.state.job.fields.supplierOrderNumber).toBe("OV-2026-014");
    expect(res.review.fieldSources.supplierOrderNumber?.label).toBe("z dodacího listu");
  });

  it("nákupní náklady nikdy z nabídky dodavatele; z faktury dodavatele ano (jen s maržemi)", () => {
    const o = rd("objednavka_zakaznik", { doc: order() });
    const q = rd("nabidka_dodavatel", { doc: bdoc({ docKind: "nabidka", issuer: "dodavatel", supplier: HRUBY, totalWithoutVat: 500 }) });
    expect(reconcile([o, q]).state.job.fields.purchaseCost ?? "").toBe("");
    const f = rd("faktura_dodavatel", { doc: bdoc({ docKind: "faktura", issuer: "dodavatel", supplier: HRUBY, totalWithoutVat: 600 }) });
    expect(reconcile([o, q, f]).state.job.fields.purchaseCost).toBe("600");
    expect(reconcile([o, q, f], { margins: false }).state.job.fields.purchaseCost ?? "").toBe("");
  });

  it("výchozí výběr vítězné nabídky: jediná nabídka, zakázka bez vítěze, s maržemi", () => {
    const o = rd("objednavka_zakaznik", { doc: order() });
    const q = rd("nabidka_dodavatel", { doc: bdoc({ docKind: "nabidka", issuer: "dodavatel", supplier: HRUBY, items: [item("4711-02", { unitPrice: 100 })] }) });
    const st = (r: ReturnType<typeof reconcile>) => r.docStates[q.id];
    const a = st(reconcile([o, q]));
    expect(a.kind === "business" && a.state.selectWinner).toBe(true);
    expect(a.kind === "business" && a.state.quoteLines[0].unitPrice).toBe("100");
    const j = job();
    const b = st(reconcile([o, q], { jobs: [{ job: j, reason: "podle čísla", score: 95 }], jobsWithWinner: [j.id] }));
    expect(b.kind === "business" && b.state.selectWinner).toBe(false);
    const noMargins = reconcile([o, q], { margins: false });
    const c = noMargins.docStates[q.id];
    expect(c.kind === "business" && c.state.selectWinner).toBe(false);
    expect(c.kind === "business" && c.state.quoteLines).toEqual([]);
    expect(noMargins.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["price_hidden", "purchasing_pending"]));
    expect(JSON.stringify(noMargins.warnings)).not.toMatch(/100/);
  });

  it("výkres ↔ položka: vazba, doplnění revize, konflikt revize, nepřiřazený výkres", () => {
    const o = rd("objednavka_zakaznik", { doc: order({ items: [item("4711-02", { revision: "C" }), item("4711-03")] }) });
    const v = rd("vykres", { extract: { kind: "drawing", drawing: { ...drawing("4711-02", "B"), material: "1.2379" } } });
    const v2 = rd("vykres", { extract: { kind: "drawing", drawing: drawing("4711-03", "A") } });
    const v3 = rd("vykres", { extract: { kind: "drawing", drawing: drawing("9999-01", "") } });
    const res = reconcile([o, v, v2, v3]);
    const s1 = res.docStates[v.id];
    expect(s1.kind === "drawing" && s1.state.link).toEqual({ mode: "docItem", itemKey: "ai-0" });
    expect(res.warnings.find((w) => w.code === "revision_conflict")?.message).toBe("rev. C × výkres rev. B (4711-02)");
    expect(res.state.job.items[1].revision).toBe("A");
    expect(res.state.job.items[0].material).toBe("1.2379");
    const s3 = res.docStates[v3.id];
    expect(s3.kind === "drawing" && s3.state.link).toEqual({ mode: "none" });
    expect(res.warnings.some((w) => w.code === "unlinked_drawing" && w.docIds[0] === v3.id)).toBe(true);
    // skupina bez obchodního dokladu s položkami → výkres založí položku: VIDITELNÝ řádek v Položkách
    // (číslo, revize, název z výkresu, počet prázdný = „doplň počet"), výkres na něj míří vazbou docItem
    const vd = rd("vykres", { extract: { kind: "drawing", drawing: drawing("7000-01", "A") } });
    const alone = reconcile([vd], { group: { targetRequired: true } });
    const sa = Object.values(alone.docStates)[0];
    expect(sa.kind === "drawing" && sa.state.link).toEqual({ mode: "docItem", itemKey: `draw-${vd.id}` });
    expect(alone.state.job.items).toEqual([expect.objectContaining({ key: `draw-${vd.id}`, drawingNumber: "7000-01", revision: "A", quantity: "", unit: "ks" })]);
    expect(alone.review.itemSources[`draw-${vd.id}`]?.[0]?.label).toBe("z výkresu 7000-01");
    expect(alone.review.itemOptions[""].map((o2) => o2.link.mode)).toEqual(["docItem", "add", "none"]);
    expect(alone.warnings.some((w) => w.code === "drawing_quantity_missing")).toBe(true);
    expect(alone.state.job.targetKey).toBe("");
    expect(alone.warnings.find((w) => w.code === "target_required")?.severity).toBe("block");
  });

  it("existující zakázka: vazba na položku zakázky a jen prázdná pole", () => {
    const j = job({ items: [{ id: "44444444-4444-4444-8444-444444444444", position: 0, drawingNumber: "4711-02", revision: "C", name: "Deska", description: null, material: null, quantity: 20, unit: "ks", unitPrice: null, purchaseUnitPrice: null, note: null }], customerOrderNumber: "PO-4471" });
    const o = rd("objednavka_zakaznik", { doc: order() });
    const v = rd("vykres", { extract: { kind: "drawing", drawing: drawing("4711-02", "C") } });
    const res = reconcile([o, v], { jobs: [{ job: j, reason: "podle čísla objednávky zákazníka PO-4471", score: 92 }], group: { targetJobId: j.id } });
    expect(res.state.job.targetKey).toBe(j.id);
    expect(res.state.job.fields.customerOrderNumber).toBeUndefined();
    const st = res.docStates[v.id];
    expect(st.kind === "drawing" && st.state.link).toEqual({ mode: "item", itemId: "44444444-4444-4444-8444-444444444444" });
    expect(res.review.itemOptions[j.id].map((o2) => o2.link.mode)).toEqual(["item", "docItem", "add", "none"]);
  });

  it("číslo naší nabídky do objednávky + konflikt čísel", () => {
    const o = rd("objednavka_zakaznik", { doc: order({ ourQuoteNumber: "" }) });
    const n = rd("nabidka_my", { doc: bdoc({ docKind: "nabidka", issuer: "my", documentNumber: "NAB-2026-031", customer: STROJ }) });
    const gd = groupDocOf([o, n], OUR);
    expect(gd.doc.ourQuoteNumber).toBe("NAB-2026-031");
    const o2 = rd("objednavka_zakaznik", { doc: order({ ourQuoteNumber: "NAB-2026-032" }) });
    const m = mergeGroupDoc(
      { id: o2.id, type: o2.type, documentNumber: "PO-4471", doc: (o2.extract as { doc: ExtractedBusinessDoc }).doc },
      [{ id: n.id, type: n.type, documentNumber: "NAB-2026-031", doc: (n.extract as { doc: ExtractedBusinessDoc }).doc }],
    );
    expect(m.warnings[0]?.message).toBe("Objednávka odkazuje na NAB-2026-032, v dávce je NAB-2026-031.");
  });

  it("zákazník: prázdné údaje doplní ostatní zákaznické doklady", () => {
    const o = rd("objednavka_zakaznik", { doc: order({ customer: { ...emptyParty(), name: "STROJMETAL, a. s." } }) });
    const f = rd("faktura_my", { doc: bdoc({ docKind: "faktura", issuer: "my", documentNumber: "FV-1", customer: { ...STROJ, email: "a@strojmetal.cz" } }) });
    const gd = groupDocOf([o, f], OUR);
    expect(gd.doc.customer.ico).toBe("45274649");
    expect(gd.customerSources.ico?.label).toBe("z faktury FV-1");
  });

  it("nespárované řádky neprimárních zákaznických dokladů → „Nová položka?\"", () => {
    const o = rd("objednavka_zakaznik", { doc: order({ items: [item("4711-02")] }) });
    const f = rd("faktura_my", { doc: bdoc({ docKind: "faktura", issuer: "my", documentNumber: "FV-1", customer: STROJ, items: [item("4711-02"), item("8888-01")] }) });
    const res = reconcile([o, f]);
    const fr = res.docs.find((d) => d.docId === f.id);
    expect(fr?.kind === "business" ? fr.unmatchedRows.map((r) => [r.key, r.drawingNumber]) : null).toEqual([[`x-${f.id}-1`, "8888-01"]]);
    expect(res.state.job.items).toHaveLength(1);
  });

  it("proforma, dobropis a dílčí dodávka jen upozorní", () => {
    const o = rd("objednavka_zakaznik", { doc: order() });
    const p = rd("faktura_my", { flags: ["proforma"], doc: bdoc({ docKind: "faktura", issuer: "my", customer: STROJ }) });
    const dl = rd("dodaci_list_dodavatel", { flags: ["partial"], doc: bdoc({ docKind: "dodaci_list", issuer: "dodavatel", supplier: HRUBY }) });
    const res = reconcile([o, p, dl]);
    expect(res.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["proforma", "partial_delivery"]));
    expect(res.state.job.stage).toBe("objednavka");
    const st = res.docStates[dl.id];
    expect(st.kind === "business" && st.state.advancePurchaseOrder).toBe(false);
  });

  it("náš DL s podpisem → výchozí „potvrzený zákazníkem\"", () => {
    const dl = rd("dodaci_list_my", { flags: ["signed"], doc: bdoc({ docKind: "dodaci_list", issuer: "my", documentNumber: "DL-1", customer: STROJ }) });
    const st = reconcile([dl]).docStates[dl.id];
    expect(st.kind === "business" && st.state.confirmDelivered).toBe(true);
  });
});

function drawing(drawingNumber: string, revision: string) {
  return {
    drawingNumber, revision, title: "", material: "", dimensions: "", weightKg: 0, generalTolerance: "", tightestTolerance: "",
    surface: "", heatTreatment: "", surfaceTreatment: "", quantity: 0, customerName: "", drawingDate: "", sheet: "", scale: "",
    notes: "", summary: "", confidence: 0.9, needsClarification: [],
  };
}

describe("swapParties", () => {
  it("protistrana do slotu nového druhu, naše IČO nikdy", () => {
    const d = bdoc({ docKind: "nabidka", issuer: "dodavatel", supplier: HRUBY, customer: { ...emptyParty(), name: "Mnástrojárna", ico: OUR } });
    const s = swapParties(d, OUR);
    expect(s.docKind).toBe("nabidka");
    expect(s.issuer).toBe("my");
    expect(s.customer.name).toBe(HRUBY.name);
    expect(s.supplier.name).toBe("");
    const back = swapParties(bdoc({ docKind: "nabidka", issuer: "my", customer: STROJ, supplier: { ...emptyParty(), ico: OUR, name: "My" } }), OUR);
    expect(back.issuer).toBe("dodavatel");
    expect(back.supplier.ico).toBe(STROJ.ico);
    expect(back.customer.ico).toBe("");
  });
});

describe("applyGroupFills", () => {
  it("doplní jen prázdná pole", () => {
    const o = rd("objednavka_zakaznik", { doc: order() });
    const dl = rd("dodaci_list_dodavatel", { doc: bdoc({ docKind: "dodaci_list", issuer: "dodavatel", supplier: HRUBY, customerOrderNumber: "OV-1" }) });
    const res = reconcile([o, dl]);
    const job0 = { ...res.state.job, fields: { ...res.state.job.fields, supplierOrderNumber: "" } };
    expect(applyGroupFills(job0, res.review).fields.supplierOrderNumber).toBe("OV-1");
    const job1 = { ...res.state.job, fields: { ...res.state.job.fields, supplierOrderNumber: "RUČNĚ" } };
    expect(applyGroupFills(job1, res.review).fields.supplierOrderNumber).toBe("RUČNĚ");
  });
});

// ── kontrola stavu z prohlížeče ─────────────────────────────
const PAGES: BatchPage[] = ["p1", "p2", "p3"].map((id, i) => ({ id, fileId: `f${i + 1}`, page: 1, source: "image", label: id, aiLabel: "", duplicateOf: null }));

function baseState(): BatchApplyState {
  const o = rd("objednavka_zakaznik", { id: "d1", doc: order() });
  const q = rd("nabidka_dodavatel", { id: "d2", doc: bdoc({ docKind: "nabidka", issuer: "dodavatel", supplier: HRUBY, items: [item("4711-02", { unitPrice: 100 })] }) });
  const res = reconcile([o, q]);
  return {
    sort: {
      docs: [
        { id: "d1", type: "objednavka_zakaznik", pageIds: ["p1"], aiType: "objednavka_zakaznik", confidence: 0.9, reason: "", title: "", documentNumber: "PO-4471", partyName: "", drawingNumbers: [], format: null, flags: [], issuerCheck: "ok", excluded: false },
        { id: "d2", type: "nabidka_dodavatel", pageIds: ["p2"], aiType: "nabidka_dodavatel", confidence: 0.9, reason: "", title: "", documentNumber: "", partyName: "", drawingNumbers: [], format: null, flags: [], issuerCheck: "ok", excluded: false },
        { id: "d3", type: "foto", pageIds: ["p3"], aiType: "foto", confidence: 0.9, reason: "", title: "", documentNumber: "", partyName: "", drawingNumbers: [], format: null, flags: [], issuerCheck: "unknown", excluded: true },
      ],
      excludedPageIds: [],
    },
    groups: [{ ...res.state, job: { ...res.state.job, targetKey: "new" } }],
    docs: res.docStates,
  };
}

describe("sanitizeBatchApplyState", () => {
  const ctx = { pages: PAGES, margins: true, ourIco: OUR };
  it("projde platný stav", () => {
    const r = sanitizeBatchApplyState(baseState(), ctx);
    expect(r.ok).toBe(true);
  });
  it("položky z dodavatelského dokladu odmítne", () => {
    const s = baseState();
    s.groups[0].job.items.push({ ...s.groups[0].job.items[0], key: "x-d2-0" });
    expect(sanitizeBatchApplyState(s, ctx)).toEqual({ ok: false, error: "Položky zakázky mohou přidat jen doklady zákazníka — dodavatelské doklady položky nepřidávají." });
  });
  it("bez práva na marže zahodí nákupní ceny a řádky nabídky", () => {
    const s = baseState();
    s.groups[0].job.fields.purchaseCost = "500";
    s.groups[0].job.items[0].purchaseUnitPrice = "12";
    const r = sanitizeBatchApplyState(s, { ...ctx, margins: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.groups[0].job.fields.purchaseCost).toBeUndefined();
    expect(r.state.groups[0].job.items[0].purchaseUnitPrice).toBe("");
    const q = r.state.docs.d2;
    expect(q.kind === "business" && q.state.quoteLines).toEqual([]);
    expect(q.kind === "business" && q.state.selectWinner).toBe(false);
  });
  it("nevybraný cíl, doklad mimo skupinu, špatný formulář, konflikt zákazníka", () => {
    const a = baseState();
    a.groups[0].job.targetKey = "";
    expect(sanitizeBatchApplyState(a, ctx)).toMatchObject({ ok: false, error: "Vyber zakázku pro Objednávka zákazníka PO-4471." });
    const b = baseState();
    b.groups[0].docIds = ["d1"];
    expect(sanitizeBatchApplyState(b, ctx)).toMatchObject({ ok: false, error: "Některý doklad není přiřazený k žádné zakázce." });
    const c = baseState();
    c.docs.d1 = { kind: "file", state: { fileKind: "ostatni", title: "", note: "" } };
    expect(sanitizeBatchApplyState(c, ctx).ok).toBe(false);
    const d = baseState();
    expect(sanitizeBatchApplyState(d, { ...ctx, customerParties: { d1: STROJ, d2: null } }).ok).toBe(true);
    const e = baseState();
    e.sort.docs[1] = { ...e.sort.docs[1], type: "faktura_my" };
    e.docs.d2 = { kind: "business", state: { ...(e.docs.d2 as Extract<DocApplyState, { kind: "business" }>).state, type: "faktura_my" } };
    expect(sanitizeBatchApplyState(e, { ...ctx, customerParties: { d1: STROJ, d2: KOVO } })).toMatchObject({ ok: false, error: "Rozhodni, zda jde o stejného zákazníka." });
    e.groups[0].customerConfirmed = true;
    expect(sanitizeBatchApplyState(e, { ...ctx, customerParties: { d1: STROJ, d2: KOVO } }).ok).toBe(true);
  });
  it("roztřídění musí sedět na stránky relace", () => {
    const s = baseState();
    s.sort.docs[0].pageIds = ["p1", "p9"];
    expect(sanitizeBatchApplyState(s, ctx)).toMatchObject({ ok: false, error: "Stránka nepatří k této dávce." });
  });
});

describe("canAutoApplyBatch", () => {
  function review(state: BatchApplyState, over: Partial<BatchReviewModel> = {}): BatchReviewModel {
    const o = rd("objednavka_zakaznik", { id: "d1", doc: order() });
    const j = job();
    const res = reconcile([o], { jobs: [{ job: j, reason: "podle čísla objednávky zákazníka", score: 92 }], group: { targetJobId: j.id } });
    return {
      captureId: "c", aiUsed: true, mode: "full", margins: true, drawingsAccess: true, fixedJobId: null,
      options: { customers: [], suppliers: [], jobs: [] }, groups: [res.review], docs: res.docs, warnings: [], initial: state, ...over,
    };
  }
  function autoState(): BatchApplyState {
    const o = rd("objednavka_zakaznik", { id: "d1", doc: order() });
    const j = job();
    const res = reconcile([o], { jobs: [{ job: j, reason: "x", score: 92 }], group: { targetJobId: j.id } });
    return {
      sort: { docs: [{ id: "d1", type: "objednavka_zakaznik", pageIds: ["p1"], aiType: "objednavka_zakaznik", confidence: 0.9, reason: "", title: "", documentNumber: "PO-4471", partyName: "", drawingNumbers: [], format: null, flags: [], issuerCheck: "ok", excluded: false }], excludedPageIds: [] },
      groups: [res.state],
      docs: res.docStates,
    };
  }
  const ready: DocExtractSummary[] = [{ docId: "d1", pagesKey: "p1", type: "objednavka_zakaznik", status: "ready", error: null, aiUsed: true, title: "", documentNumber: "PO-4471", confidence: 0.93, clarifications: 0 }];
  it("jistá objednávka ke spárované zakázce → automaticky", () => {
    const st = autoState();
    expect(canAutoApplyBatch(review(st), ready)).toBe(true);
  });
  it("citlivé účinky, nízká jistota, změna druhu, upozornění → ne", () => {
    const st = autoState();
    expect(canAutoApplyBatch(review(st, { mode: "approval" }), ready)).toBe(false);
    expect(canAutoApplyBatch(review(st), [{ ...ready[0], confidence: 0.7 }])).toBe(false);
    expect(canAutoApplyBatch(review(st), [{ ...ready[0], status: "reading" }])).toBe(false);
    const changed = autoState();
    changed.sort.docs[0].aiType = "poptavka_zakaznik";
    expect(canAutoApplyBatch(review(changed), ready)).toBe(false);
    expect(canAutoApplyBatch(review(st, { warnings: [{ id: "x", code: "number_conflict", severity: "warn", docIds: [], groupKey: null, message: "", actions: [] }] }), ready)).toBe(false);
    const inv = autoState();
    inv.sort.docs[0].type = "faktura_my";
    inv.sort.docs[0].aiType = "faktura_my";
    inv.docs.d1 = { kind: "business", state: { ...(inv.docs.d1 as Extract<DocApplyState, { kind: "business" }>).state, type: "faktura_my" } };
    expect(canAutoApplyBatch(review(inv), [{ ...ready[0], type: "faktura_my" }])).toBe(false);
    const newCustomer = autoState();
    newCustomer.groups[0].job.customer = { mode: "new", party: KOVO };
    expect(canAutoApplyBatch(review(newCustomer), ready)).toBe(false);
  });
});

describe("deník ukládání po částečném uložení", () => {
  const prev = {
    groups: [{ key: "g1", docIds: ["d1", "d2"] }, { key: "g2", docIds: ["d3"] }],
    docs: [
      { id: "d1", type: "objednavka_zakaznik" as BatchDocType, pageIds: ["p1", "p2"] },
      { id: "d2", type: "vykres" as BatchDocType, pageIds: ["p3"] },
      { id: "d3", type: "objednavka_zakaznik" as BatchDocType, pageIds: ["p4"] },
    ],
  };
  const draft = (id: string, type: BatchDocType, pageIds: string[], excluded = false) => ({ id, type, pageIds, excluded });
  const state = (groups: { key: string; docIds: string[] }[], docs: ReturnType<typeof draft>[]) =>
    ({ groups, sort: { docs, excludedPageIds: [] } }) as unknown as Pick<BatchApplyState, "groups" | "sort">;
  const steps = new Map([["group:g1", { status: "done" }], ["doc:d1", { status: "done" }], ["group:g2", { status: "failed" }]]);
  const same = [draft("d1", "objednavka_zakaznik", ["p1", "p2"]), draft("d2", "vykres", ["p3"]), draft("d3", "objednavka_zakaznik", ["p4"])];

  it("stejné skupiny a doklady = v pořádku (opakování zbytku)", () => {
    expect(journalConflictOf(prev, steps, new Set(), state(prev.groups, same))).toBeNull();
    expect(journalConflictOf(null, steps, new Set(), state(prev.groups, same))).toBeNull();
  });

  it("uložená skupina s jinými doklady (přepočítané klíče) → odmítnout", () => {
    // d2 přesunutý jinam: g1 už má zakázku zákazníka A
    expect(journalConflictOf(prev, steps, new Set(), state([{ key: "g1", docIds: ["d1", "d3"] }, { key: "g2", docIds: ["d2"] }], same))).toBe(JOURNAL_CONFLICT);
    // jen jiné pořadí dokladů ve skupině je v pořádku
    expect(journalConflictOf(prev, steps, new Set(), state([{ key: "g1", docIds: ["d2", "d1"] }, { key: "g2", docIds: ["d3"] }], same))).toBeNull();
  });

  it("stránka přesunutá do uloženého dokladu / jiný druh / vyřazení → odmítnout", () => {
    const moved = [draft("d1", "objednavka_zakaznik", ["p1", "p2", "p3"]), draft("d3", "objednavka_zakaznik", ["p4"])];
    expect(journalConflictOf(prev, steps, new Set(), state([{ key: "g1", docIds: ["d1"] }, { key: "g2", docIds: ["d3"] }], moved))).toBe(JOURNAL_CONFLICT);
    const retyped = same.map((d) => (d.id === "d2" ? { ...d, type: "foto" as BatchDocType } : d));
    expect(journalConflictOf(prev, steps, new Set(), state(prev.groups, retyped))).toBe(JOURNAL_CONFLICT);
    const excluded = same.map((d) => (d.id === "d1" ? { ...d, excluded: true } : d));
    expect(journalConflictOf(prev, steps, new Set(), state(prev.groups, excluded))).toBe(JOURNAL_CONFLICT);
  });

  it("neuložená skupina se změnit smí — kromě skupiny, jejíž pokus už zakázku založil", () => {
    const g2changed = state([{ key: "g1", docIds: ["d1", "d2"] }, { key: "g2", docIds: ["d3"] }], [...same.slice(0, 2), draft("d3", "poptavka_zakaznik", ["p4"])]);
    expect(journalConflictOf(prev, steps, new Set(), g2changed)).toBeNull();
    expect(journalConflictOf(prev, steps, new Set(["g2"]), g2changed)).toBe(JOURNAL_CONFLICT);
  });
});

describe("duplicita obchodního dokladu — stejný doklad, ne jen stejné číslo", () => {
  const order = BATCH_TYPES.objednavka_zakaznik;
  const ourInvoice = BATCH_TYPES.faktura_my;
  it("druh a vystavitel musí sedět (naše × dodavatelova faktura sdílí druh souboru)", () => {
    expect(sameDocParty({ docKind: "faktura", issuer: "dodavatel", supplier: { ico: "1" } }, ourInvoice, STROJ)).toBe("no");
  });
  it("strana podle IČO, jinak podle názvu; bez údajů = jen upozornit", () => {
    expect(sameDocParty({ docKind: "objednavka", issuer: "zakaznik", customer: { ico: "45 27 46 49" } }, order, STROJ)).toBe("yes");
    expect(sameDocParty({ docKind: "objednavka", issuer: "zakaznik", customer: { ico: KOVO.ico } }, order, STROJ)).toBe("no");
    expect(sameDocParty({ customer: { name: "Strojmetal a.s." } }, order, { ico: "", name: "STROJMETAL, a. s." })).toBe("yes");
    expect(sameDocParty({ customer: { name: "Kovo Plus s.r.o." } }, order, { ico: "", name: "STROJMETAL, a. s." })).toBe("no");
    expect(sameDocParty({ customer: { name: "STROJMETAL, a. s." } }, order, { ico: "", name: "STROJMETAL, a. s." })).toBe("yes");
    expect(sameDocParty({ documentNumber: "1001" }, order, STROJ)).toBe("unknown");
    expect(sameDocParty(null, order, null)).toBe("unknown");
  });
});

// ── Text e-mailu jako doklad dávky (majitel 6. 11.) ──────────
describe("text e-mailu jako doklad bez souboru", () => {
  const STEEL: ExtractedParty = { ...emptyParty(), name: "STEELING, s.r.o.", ico: "08542311", dic: "CZ08542311", city: "Prostějov", zip: "796 01", email: "jan.cejka@steeling.cz", phone: "+420 777 248 197", contactPerson: "Jan Čejka" };
  const mailDoc = (over: Partial<ExtractedBusinessDoc> = {}) => bdoc({ docKind: "poptavka", issuer: "zakaznik", customer: STEEL, requiredDeliveryDate: "2026-12-15", summary: "Poptávka – stud bolt M42", items: [item("SDF000637.4", { quantity: 20, name: "" })], ...over });
  const mail = (over: Partial<ExtractedBusinessDoc> = {}) => rd("poptavka_zakaznik", { id: "mail", doc: mailDoc(over), source: "mail", aiUsed: false, bundleKey: "mail:1" });
  const stud = () => rd("vykres", { extract: { kind: "drawing", drawing: { ...drawing("SDF000637.4", "A"), title: "Stud bolt M42" } }, aiUsed: true });

  it("e-mail + výkres bez objednávky: text je primární — zákazník z podpisu (nový), kontakt, položka z textu s počtem, výkres na ni míří, název z výkresu", () => {
    const v = stud();
    const res = reconcile([mail(), v]);
    expect(res.review.docIds).toEqual([v.id]);                 // text e-mailu nemá kartu
    expect(res.state.docIds).toEqual([v.id]);
    expect(res.review.primaryDocId).toBeNull();
    expect(res.docs.map((d) => d.docId)).toEqual([v.id]);
    const job = res.state.job;
    expect(job.targetKey).toBe("new");
    expect(job.stage).toBe("poptavka");
    expect(job.customer).toEqual({ mode: "new", party: STEEL });
    expect(job.fields).toMatchObject({ customerContact: "Jan Čejka", customerContactEmail: "jan.cejka@steeling.cz", customerContactPhone: "+420 777 248 197", customerRequiredDate: "2026-12-15" });
    expect(res.review.fieldSources.customerContact?.label).toBe("z podpisu e-mailu");
    expect(res.review.fieldSources.customerRequiredDate?.label).toBe("z textu e-mailu");
    expect(job.items.map((i) => [i.key, i.drawingNumber, i.quantity, i.name, i.revision])).toEqual([["ai-0", "SDF000637.4", "20", "Stud bolt M42", "A"]]);
    const st = res.docStates[v.id];
    expect(st.kind === "drawing" && st.state.link).toEqual({ mode: "docItem", itemKey: "ai-0" });
    expect(st.kind === "drawing" && st.state.quantity).toBe("20");
    const dr = res.docs[0];
    expect(dr.kind === "drawing" && dr.sources?.quantity).toBe("z textu e-mailu");
    expect(res.state.job.fields.title).toBe("Stud bolt M42 SDF000637.4");
    expect(res.state.jobDraftTitle).toBe("Stud bolt M42 SDF000637.4");
    expect(res.warnings.some((w) => w.code === "drawing_quantity_missing" || w.code === "unlinked_drawing")).toBe(false);
    expect(res.warnings.every((w) => !w.docIds.includes("mail"))).toBe(true);
  });

  it("e-mail bez počtu v textu: výkres založí viditelný řádek s prázdným počtem (doplň počet), zákazník odesílatele podle CRM", () => {
    const v = stud();
    const m = rd("poptavka_zakaznik", { id: "mail", doc: mailDoc({ items: [] }), source: "mail", customerMatch: { id: "c1", name: "Steeling s.r.o.", reason: "odesílatel e-mailu", score: 95 } });
    const res = reconcile([m, v]);
    expect(res.state.job.customer).toEqual({ mode: "existing", id: "c1", name: "Steeling s.r.o.", reason: "odesílatel e-mailu" });
    expect(res.state.job.items.map((i) => [i.key, i.drawingNumber, i.quantity])).toEqual([[`draw-${v.id}`, "SDF000637.4", ""]]);
    const st = res.docStates[v.id];
    expect(st.kind === "drawing" && st.state.link).toEqual({ mode: "docItem", itemKey: `draw-${v.id}` });
    expect(res.warnings.some((w) => w.code === "drawing_quantity_missing")).toBe(true);
  });

  it("e-mail + přiložená objednávka: objednávka je primární (položky, počty), text e-mailu jen doplní kontakt a nehlásí druhou objednávku", () => {
    const o = rd("objednavka_zakaznik", { doc: order({ customer: { ...STROJ, contactPerson: "", phone: "" } }), bundleKey: "mail:1" });
    const m = rd("objednavka_zakaznik", { id: "mail", doc: mailDoc({ docKind: "objednavka", customer: { ...emptyParty(), name: "Strojmetal", contactPerson: "Petra Nová", email: "petra@strojmetal.cz", phone: "777 123 456" }, items: [item("4711-02", { quantity: 99 })] }), source: "mail", bundleKey: "mail:1" });
    const grouped = groupBatch({ docs: [m, o], ourIco: OUR });
    expect(grouped.groups).toHaveLength(1);
    expect(grouped.warnings.some((w) => w.code === "multiple_orders")).toBe(false);
    const res = reconcile([o, m], { group: grouped.groups[0] });
    expect(res.review.primaryDocId).toBe(o.id);
    expect(res.state.job.items.map((i) => [i.drawingNumber, i.quantity])).toEqual([["4711-02", "10"], ["4711-03", "10"]]);
    expect(res.state.job.fields).toMatchObject({ customerOrderNumber: "PO-4471", customerContact: "Petra Nová", customerContactPhone: "777 123 456" });
    expect(res.review.fieldSources.customerContact?.label).toBe("z textu e-mailu");
    expect(res.state.docIds).toEqual([o.id]);
  });

  it("uložení: řádek z výkresu (draw-<id>) a položky z textu e-mailu (ai-*) projdou kontrolou stavu", () => {
    const pages: BatchPage[] = [{ id: "p1", fileId: "f1", page: 1, source: "pdf_page", label: "v.pdf", aiLabel: "", duplicateOf: null }];
    const sort = { docs: [blankDraft("d1", "vykres", ["p1"])], excludedPageIds: [] };
    const job = { chip: "poptavka_zakaznik", targetKey: "new", customer: { mode: "none" }, supplier: { mode: "none" }, fields: {}, items: [{ key: "draw-d1", drawingNumber: "7000-01", revision: "", name: "", material: "", quantity: "5", unit: "ks", unitPrice: "", purchaseUnitPrice: "", description: "", note: "", aiFilled: true }, { key: "ai-0", drawingNumber: "7000-02", revision: "", name: "", material: "", quantity: "3", unit: "ks", unitPrice: "", purchaseUnitPrice: "", description: "", note: "", aiFilled: true }], merges: [], stage: "poptavka", docNote: "" };
    const docs = { d1: { kind: "drawing", state: { drawingNumber: "7000-01", revision: "", title: "", material: "", dimensions: "", generalTolerance: "", tightestTolerance: "", quantity: "", link: { mode: "docItem", itemKey: "draw-d1" }, archive: true, note: "", onDuplicate: null } } };
    const raw = { sort, groups: [{ key: "g1", docIds: ["d1"], job, customerConfirmed: false, jobDraftTitle: "" }], docs };
    const ok = sanitizeBatchApplyState(raw, { pages, margins: true, ourIco: OUR, mailItems: true });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.state.groups[0].job.items.map((i) => i.key)).toEqual(["draw-d1", "ai-0"]);
      const d = ok.state.docs.d1;
      expect(d.kind === "drawing" && d.state.link).toEqual({ mode: "docItem", itemKey: "draw-d1" });
    }
    // bez textu e-mailu položky ai-* skupina bez dokladu zákazníka přidat nesmí; draw- ano
    const bad = sanitizeBatchApplyState(raw, { pages, margins: true, ourIco: OUR });
    expect(bad.ok).toBe(false);
    const onlyDraw = sanitizeBatchApplyState({ ...raw, groups: [{ ...raw.groups[0], job: { ...job, items: [job.items[0]] } }] }, { pages, margins: true, ourIco: OUR });
    expect(onlyDraw.ok).toBe(true);
  });
});
