import { describe, it, expect } from "vitest";
import type { CaptureDocKind, DocIssuer } from "./capture-types";
import type { JobItem } from "./types";
import { docKindToStage, docFieldValues, planJobUpdate, planNewJob } from "./apply-extraction";
import { emptyParty, normalizeExtracted } from "./extracted-normalize";
import {
  CAPTURE_CHIPS, buildExistingTarget, buildNewTarget, canAutoApply, captureEventMessage, capturePagePath,
  captureSessionPath, changeChip, chipByKey, chipFor, defaultCustomerChoice, documentNumberFor, hiddenFieldCount,
  initialReviewState, isAiValue, isCapturePagePath, isFieldLocked, resultHeadline, reviewChanges, reviewItemsToInputs,
  reviewMergePatches, reviewToFinalDoc, reviewToJobInput, sanitizeReviewState, switchTarget, visibleFieldGroups,
  type ReviewModel, type ReviewState, type ReviewTarget, type TargetJob,
} from "./capture-review";
import objednavkaFixture from "./__fixtures__/capture/objednavka-strojmetal.json";
import dodaciListFixture from "./__fixtures__/capture/dodaci-list-dodavatel.json";
import poptavkaFixture from "./__fixtures__/capture/poptavka-novy-zakaznik.json";

const PO = normalizeExtracted(objednavkaFixture);
const SUPPLIER_DL = normalizeExtracted(dodaciListFixture);
const RFQ = normalizeExtracted(poptavkaFixture);

const USER = "11111111-2222-4333-8444-555555555555";
const JOB_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ITEM_ID = "99999999-8888-4777-8666-555555555555";
const CUSTOMER_ID = "cccccccc-1111-4222-8333-444444444444";

function item(over: Partial<JobItem> & { id: string }): JobItem {
  return {
    position: 0, drawingNumber: null, revision: null, name: null, description: null, material: null,
    quantity: 0, unit: "ks", unitPrice: null, purchaseUnitPrice: null, note: null, ...over,
  };
}

function job(over: Partial<TargetJob> = {}): TargetJob {
  return {
    id: JOB_ID, number: "Z-2026-103", stage: "nabidka", title: "Upínky pro Strojmetal",
    customer: { id: "c-strojmetal", name: "Strojmetal a.s.", customerNumber: "ZAK-0001", ico: "45274649" },
    customerOrderNumber: null, customerInquiryNumber: null,
    customerContact: null, customerContactEmail: null, customerContactPhone: null,
    inquiryDate: "2026-09-01", orderDate: null, customerRequiredDate: null, dueDate: null,
    expectedDeliveryDate: null, supplierPromisedDate: null, value: null, items: [],
    supplier: null, supplierOrderNumber: null, invoiceNumber: null, deliveryNoteNumber: null,
    currency: "CZK", purchaseCost: null, maxToleratedDate: null, deliveryMethod: null,
    ...over,
  };
}

const noMatch = null;

describe("cesty dočasných souborů", () => {
  it("stránka patří jen svému uživateli", () => {
    const p = capturePagePath(USER, "0f8fad5b-d9cb-469f-a165-70867728950e", "Fotka účtenky.JPG");
    expect(p).toBe(`capture/${USER}/0f8fad5b-d9cb-469f-a165-70867728950e-Fotka-uctenky.JPG`);
    expect(isCapturePagePath(USER, p)).toBe(true);
    expect(isCapturePagePath("22222222-2222-4333-8444-555555555555", p)).toBe(false);
    expect(isCapturePagePath(USER, `capture/${USER}/../x`)).toBe(false);
    expect(isCapturePagePath(USER, captureSessionPath(USER, "0f8fad5b-d9cb-469f-a165-70867728950e"))).toBe(false);
    expect(isCapturePagePath(USER, `zakazky/${JOB_ID}/0f8fad5b-d9cb-469f-a165-70867728950e-a.pdf`)).toBe(false);
  });
});

describe("chipy druhu dokladu", () => {
  const kinds: CaptureDocKind[] = ["poptavka", "nabidka", "objednavka", "potvrzeni", "dodaci_list", "faktura", "vykres", "ostatni"];
  const issuers: DocIssuer[] = ["zakaznik", "my", "dodavatel", "neznamy"];

  it("každá kombinace z AI má chip stejného druhu", () => {
    for (const k of kinds) {
      for (const i of issuers) {
        const { chip } = chipFor(k, i);
        expect(chip.docKind).toBe(k);
      }
    }
  });

  it("přesná shoda × odhad vystavitele", () => {
    expect(chipFor("objednavka", "zakaznik")).toMatchObject({ chip: { key: "objednavka_zakaznik" }, exact: true });
    expect(chipFor("objednavka", "neznamy")).toMatchObject({ chip: { key: "objednavka_zakaznik" }, exact: true });
    expect(chipFor("nabidka", "neznamy")).toMatchObject({ chip: { key: "nabidka_dodavatel" }, exact: false });
    expect(chipFor("faktura", "zakaznik")).toMatchObject({ chip: { key: "faktura_my" }, exact: false });
    expect(chipFor("vykres", "zakaznik")).toMatchObject({ chip: { key: "vykres" }, exact: true });
  });

  it("nabídka dodavatele = nacenění, naše objednávka = objednávka dodavateli", () => {
    expect(chipByKey("nabidka_dodavatel").fileKind).toBe("naceneni");
    expect(chipByKey("objednavka_my").fileKind).toBe("objednavka_vydana");
    expect(chipByKey("objednavka_zakaznik").fileKind).toBe("objednavka");
    expect(CAPTURE_CHIPS.map((c) => c.key)).toHaveLength(new Set(CAPTURE_CHIPS.map((c) => c.key)).size);
  });

  it("obchodní chipy posouvají stav jako plán", () => {
    expect(docKindToStage(chipByKey("objednavka_zakaznik").docKind, "zakaznik")).toBe("objednavka");
    expect(docKindToStage(chipByKey("dodaci_list_dodavatel").docKind, "dodavatel")).toBe("dodano_k_nam");
  });
});

describe("cíl: nová zakázka", () => {
  it("objednávka zákazníka → navržená pole, položky a stav", () => {
    const t = buildNewTarget({ plan: planNewJob(PO), margins: true, docKind: PO.docKind, issuer: PO.issuer });
    expect(t.key).toBe("new");
    expect(t.proposed.customerOrderNumber).toBe("4795-2026");
    expect(t.proposed.orderDate).toBe("2026-10-21");
    expect(t.proposed.customerRequiredDate).toBe("2026-11-27");
    expect(t.proposed.value).toBe("107000");
    expect(t.proposed.title).toContain("VK-2291");
    expect(t.stageTo).toBe("objednavka");
    expect(t.newItems).toHaveLength(2);
    expect(t.newItems[0]).toMatchObject({ drawingNumber: "VK-2291", quantity: "50", unitPrice: "1180", aiFilled: true });
  });

  it("bez práva na marže se nákupní ceny do formuláře nedostanou", () => {
    const doc = normalizeExtracted({ ...dodaciListFixture, totalWithoutVat: 5000, items: [{ drawingNumber: "PR-1", quantity: 2, unitPrice: 2500 }] });
    const t = buildNewTarget({ plan: planNewJob(doc), margins: false, docKind: doc.docKind, issuer: doc.issuer });
    expect(t.proposed.purchaseCost).toBeUndefined();
    expect(t.newItems[0].purchaseUnitPrice).toBe("");
    const t2 = buildNewTarget({ plan: planNewJob(doc), margins: true, docKind: doc.docKind, issuer: doc.issuer });
    expect(t2.proposed.purchaseCost).toBe("5000");
    expect(t2.newItems[0].purchaseUnitPrice).toBe("2500");
  });

  it("ruční vyplnění (bez AI) = prázdný návrh", () => {
    const t = buildNewTarget({ plan: null, margins: true, docKind: "dodaci_list", issuer: "dodavatel" });
    expect(t.proposed).toEqual({});
    expect(t.stageTo).toBe("dodano_k_nam");
  });
});

describe("cíl: existující zakázka", () => {
  it("vyplněné údaje zakázky se zamknou a nenavrhují, jiné hodnoty z dokladu = upozornění", () => {
    const j = job({ customerRequiredDate: "2026-12-15", customerOrderNumber: "4795-2026", items: [item({ id: ITEM_ID, drawingNumber: "VK-2291", quantity: 50 })] });
    const t = buildExistingTarget({ job: j, plan: planJobUpdate(j, PO), docValues: docFieldValues(PO), reason: "podle čísla", score: 95, margins: true });
    expect(t.existing.customerRequiredDate).toBe("2026-12-15");
    expect(isFieldLocked(t, "customerRequiredDate")).toBe(true);
    expect(t.proposed.customerRequiredDate).toBeUndefined();
    expect(t.conflicts.customerRequiredDate).toBe("2026-11-27");
    // stejné číslo objednávky = žádný konflikt
    expect(t.conflicts.customerOrderNumber).toBeUndefined();
    expect(t.proposed.orderDate).toBe("2026-10-21");
    expect(t.stageTo).toBe("objednavka");
    // VK-2291 už zakázka má → doplnění ceny, VK-2292 je nová položka
    expect(t.merges).toEqual([expect.objectContaining({ itemId: ITEM_ID, patch: expect.objectContaining({ unitPrice: "1180", material: "1.2379" }), apply: true })]);
    expect(t.newItems.map((i) => i.drawingNumber)).toEqual(["VK-2292"]);
    expect(t.existingItems).toBe(1);
  });

  it("stav se nevrací zpět", () => {
    const j = job({ stage: "ve_vyrobe" });
    const t = buildExistingTarget({ job: j, plan: planJobUpdate(j, PO), reason: null, score: null, margins: true });
    expect(t.stageTo).toBeNull();
  });
});

function model(over: Partial<ReviewModel> = {}): ReviewModel {
  const target = buildNewTarget({ plan: planNewJob(PO), margins: true, docKind: PO.docKind, issuer: PO.issuer });
  const initial = initialReviewState({
    docKind: PO.docKind, issuer: PO.issuer, target, customerMatch: { id: CUSTOMER_ID, name: "Strojmetal a.s.", reason: "podle IČO 45274649", score: 100 },
    supplierMatch: null, docCustomer: PO.customer, docSupplier: PO.supplier, docNote: PO.note,
  });
  return {
    captureId: "x", aiUsed: true, reason: null, docKind: PO.docKind, issuer: PO.issuer, chipExact: true,
    documentNumber: PO.documentNumber, confidence: 0.93, summary: PO.summary, needsClarification: [],
    docCustomer: PO.customer, docSupplier: PO.supplier, customerMatch: null, supplierMatch: null,
    fixedJobId: null, targets: [target], margins: true, mode: "full", previews: [],
    options: { customers: [], suppliers: [], jobs: [] }, initial, ...over,
  };
}

describe("výchozí stav formuláře", () => {
  it("zákazník: zakázka > shoda > nový z dokladu > žádný", () => {
    const newT = buildNewTarget({ plan: null, margins: true, docKind: "poptavka", issuer: "zakaznik" });
    const exT = buildExistingTarget({ job: job(), plan: null, reason: null, score: null, margins: true });
    expect(defaultCustomerChoice(exT, { id: "c9", name: "Jiný", reason: "x", score: 90 }, RFQ.customer))
      .toMatchObject({ mode: "existing", id: "c-strojmetal", reason: "zákazník zakázky" });
    expect(defaultCustomerChoice(newT, { id: "c9", name: "Jiný", reason: "podle IČO", score: 100 }, RFQ.customer))
      .toMatchObject({ mode: "existing", id: "c9" });
    expect(defaultCustomerChoice(newT, noMatch, RFQ.customer)).toMatchObject({ mode: "new", party: { name: "Hydraulika Morava s.r.o." } });
    expect(defaultCustomerChoice(newT, noMatch, emptyParty())).toEqual({ mode: "none" });
  });

  it("návrh AI se předvyplní a je označený ✨", () => {
    const m = model();
    expect(m.initial.chip).toBe("objednavka_zakaznik");
    expect(m.initial.fileKind).toBe("objednavka");
    expect(m.initial.stage).toBe("objednavka");
    expect(m.initial.docNote).toContain("atest");
    expect(isAiValue(m.targets[0], m.initial, "customerOrderNumber", true)).toBe(true);
    const edited = { ...m.initial, fields: { ...m.initial.fields, customerOrderNumber: "4795-2026-X" } };
    expect(isAiValue(m.targets[0], edited, "customerOrderNumber", true)).toBe(false);
    expect(isAiValue(m.targets[0], m.initial, "customerOrderNumber", false)).toBe(false);
  });

  it("viditelná pole: typická pro druh + vyplněná; zbytek pod „Další údaje\"", () => {
    const m = model();
    const groups = visibleFieldGroups({ chip: "objednavka_zakaznik", target: m.targets[0], fields: m.initial.fields, margins: false });
    const keys = groups.flatMap((g) => g.keys);
    expect(keys).toContain("customerOrderNumber");
    expect(keys).toContain("customerContact");
    expect(keys).not.toContain("purchaseCost");
    expect(keys).not.toContain("invoiceNumber");
    expect(hiddenFieldCount({ chip: "objednavka_zakaznik", target: m.targets[0], fields: m.initial.fields, margins: false })).toBeGreaterThan(0);
    const all = visibleFieldGroups({ chip: "objednavka_zakaznik", target: m.targets[0], fields: m.initial.fields, margins: true, showAll: true }).flatMap((g) => g.keys);
    expect(all).toContain("purchaseCost");
    expect(all).toContain("invoiceNumber");
  });
});

describe("změna druhu dokladu a cíle", () => {
  const exT = (stage: TargetJob["stage"]) => buildExistingTarget({ job: job({ stage }), plan: null, reason: null, score: null, margins: true });

  it("chip přepočítá stav a druh souboru", () => {
    const m = model();
    const s = changeChip(m.initial, "dodaci_list_dodavatel", exT("ve_vyrobe"));
    expect(s).toMatchObject({ chip: "dodaci_list_dodavatel", docKind: "dodaci_list", issuer: "dodavatel", fileKind: "dodaci_list", stage: "dodano_k_nam" });
    expect(changeChip(m.initial, "poptavka_zakaznik", exT("ve_vyrobe")).stage).toBe("keep");
    expect(changeChip(m.initial, "nabidka_dodavatel", { mode: "new", stage: null })).toMatchObject({ stage: "naceneni", fileKind: "naceneni" });
    expect(changeChip(m.initial, "vykres", { mode: "new", stage: null }).stage).toBe("poptavka");
    // výkres si nechá vystavitele
    expect(changeChip({ ...m.initial, issuer: "zakaznik" }, "vykres", exT("objednavka")).issuer).toBe("zakaznik");
  });

  it("přepnutí zakázky drží ruční úpravy, ale ne přes zamčená pole", () => {
    const m = model();
    const from = m.targets[0];
    const j = job({ customerOrderNumber: "4795-2026" });
    const to = buildExistingTarget({ job: j, plan: planJobUpdate(j, PO), reason: "x", score: 95, margins: true });
    const edited: ReviewState = { ...m.initial, fields: { ...m.initial.fields, customerRequiredDate: "2026-12-01", customerOrderNumber: "PO-XYZ" } };
    const s = switchTarget(edited, from, to, { mode: "none" }, { mode: "none" });
    expect(s.targetKey).toBe(JOB_ID);
    expect(s.fields.customerRequiredDate).toBe("2026-12-01");
    expect(s.fields.customerOrderNumber).toBeUndefined(); // zakázka ho už má
    expect(s.customer).toMatchObject({ mode: "existing", id: "c-strojmetal", reason: "zákazník zakázky" });
    expect(s.items.map((i) => i.drawingNumber)).toEqual(to.newItems.map((i) => i.drawingNumber));
    expect(s.stage).toBe("objednavka");
    // zpět na novou → zákazník z dokladu, ne zákazník zakázky
    const back = switchTarget(s, to, from, { mode: "new", party: PO.customer }, { mode: "none" });
    expect(back.customer).toMatchObject({ mode: "new" });
    expect(back.stage).toBe("objednavka");
  });

  it("upravené položky se při přepnutí neztratí", () => {
    const m = model();
    const from = m.targets[0];
    const to = buildExistingTarget({ job: job(), plan: planJobUpdate(job(), PO), reason: "x", score: 95, margins: true });
    const edited: ReviewState = { ...m.initial, items: [{ ...m.initial.items[0], quantity: "60" }] };
    expect(switchTarget(edited, from, to, { mode: "none" }, { mode: "none" }).items).toEqual(edited.items);
  });
});

describe("odeslání formuláře", () => {
  it("pole → JobInput (čísla, zamčená a citlivá pole)", () => {
    const t = buildExistingTarget({ job: job({ customerOrderNumber: "A" }), plan: null, reason: null, score: null, margins: true });
    const input = reviewToJobInput({ fields: { value: "12 500,50", customerOrderNumber: "B", purchaseCost: "100", currency: "eur", title: " " } }, t, false);
    // měna zakázky (CZK) je vyplněná → zamčená
    expect(input).toEqual({ value: 12500.5 });
    const newT = buildNewTarget({ plan: null, margins: true, docKind: "objednavka", issuer: "zakaznik" });
    expect(reviewToJobInput({ fields: { currency: "eur" } }, newT, true)).toEqual({ currency: "EUR" });
    expect(reviewToJobInput({ fields: { purchaseCost: "100" } }, t, true)).toEqual({ purchaseCost: 100 });
  });

  it("položky: prázdné řádky pryč, nákupní cena jen s maržemi", () => {
    const m = model();
    const items = [...m.initial.items, { ...m.initial.items[0], key: "x", drawingNumber: "", name: "", description: "" }];
    items[0] = { ...items[0], purchaseUnitPrice: "800" };
    expect(reviewItemsToInputs(items, false)).toHaveLength(2);
    expect(reviewItemsToInputs(items, false)[0]).not.toHaveProperty("purchaseUnitPrice");
    expect(reviewItemsToInputs(items, true)[0]).toMatchObject({ drawingNumber: "VK-2291", quantity: 50, unitPrice: 1180, purchaseUnitPrice: 800 });
  });

  it("doplnění existujících položek jen odsouhlasená", () => {
    const patches = reviewMergePatches([
      { itemId: ITEM_ID, label: "VK", drawingNumber: "VK", patch: { unitPrice: "1 180", purchaseUnitPrice: "900", material: "1.2379" }, apply: true },
      { itemId: JOB_ID, label: "X", drawingNumber: "", patch: { quantity: "5" }, apply: false },
    ], false);
    expect(patches).toEqual([{ id: ITEM_ID, patch: { unitPrice: 1180, material: "1.2379" } }]);
  });

  it("číslo dokladu z formuláře", () => {
    expect(documentNumberFor({ chip: "objednavka_zakaznik", fields: { customerOrderNumber: "PO-1" } }, "X")).toBe("PO-1");
    expect(documentNumberFor({ chip: "nabidka_dodavatel", fields: {} }, "NAB-77")).toBe("NAB-77");
  });
});

describe("učení: rozdíly návrh AI × formulář", () => {
  it("beze změn = žádné korekce (i jiný zápis stejné částky)", () => {
    const m = model();
    const proposal = { chip: m.initial.chip, customer: m.initial.customer, supplier: m.initial.supplier, fields: m.initial.fields, items: m.initial.items };
    const submitted = { ...m.initial, fields: { ...m.initial.fields, value: "107 000" } };
    expect(reviewChanges(proposal, submitted, { margins: true })).toEqual([]);
  });

  it("opravené pole, druh, zákazník a položky", () => {
    const m = model();
    const proposal = { chip: m.initial.chip, customer: m.initial.customer, supplier: m.initial.supplier, fields: m.initial.fields, items: m.initial.items };
    const submitted: ReviewState = {
      ...m.initial,
      chip: "potvrzeni_my",
      customer: { mode: "existing", id: "c2", name: "Beneš CNC s.r.o.", reason: null },
      fields: { ...m.initial.fields, customerRequiredDate: "2026-11-30", customerInquiryNumber: "RFQ-1" },
      items: m.initial.items.slice(0, 1),
    };
    const changes = reviewChanges(proposal, submitted, { margins: true });
    expect(changes.map((c) => c.key)).toEqual(["docKind", "customer", "customerInquiryNumber", "customerRequiredDate", "items"]);
    expect(changes.find((c) => c.key === "customerRequiredDate")).toMatchObject({ label: "Požadovaný termín zákazníkem", aiValue: "2026-11-27", value: "2026-11-30" });
    expect(changes.find((c) => c.key === "customerInquiryNumber")?.aiValue).toBe("");
    expect(reviewChanges(proposal, submitted, { margins: true, customerLocked: true, locked: ["customerRequiredDate"] }).map((c) => c.key))
      .toEqual(["docKind", "customerInquiryNumber", "items"]);
  });

  it("finální doklad ve tvaru výstupu AI", () => {
    const m = model();
    const state: ReviewState = { ...m.initial, fields: { ...m.initial.fields, customerOrderNumber: "4795-2026/A", orderDate: "2026-10-20" } };
    const final = reviewToFinalDoc(PO, state, { customerName: "Strojmetal a.s.", margins: true });
    expect(final).toMatchObject({ docKind: "objednavka", customerOrderNumber: "4795-2026/A", documentDate: "2026-10-20", documentNumber: "4795-2026/A", summary: "" });
    expect(final.customer.name).toBe("Strojmetal a.s.");
    expect(final.items).toHaveLength(2);

    const dl = initialReviewState({
      docKind: SUPPLIER_DL.docKind, issuer: SUPPLIER_DL.issuer,
      target: buildNewTarget({ plan: planNewJob(SUPPLIER_DL), margins: true, docKind: SUPPLIER_DL.docKind, issuer: SUPPLIER_DL.issuer }),
      customerMatch: null, supplierMatch: null, docCustomer: SUPPLIER_DL.customer, docSupplier: SUPPLIER_DL.supplier,
    });
    const finalDl = reviewToFinalDoc(SUPPLIER_DL, { ...dl, fields: { ...dl.fields, supplierOrderNumber: "OBJ-2026-046" } }, { margins: true });
    expect(finalDl.customerOrderNumber).toBe("OBJ-2026-046");
    expect(finalDl.supplier.name).toBe("Kovoobrábění Hrubý s.r.o.");
  });
});

describe("historie a výsledek", () => {
  it("jedna věta o tom, co AI udělala", () => {
    expect(captureEventMessage({
      chip: "objednavka_zakaznik", aiUsed: true, documentNumber: "PO-4500021877",
      filled: ["Číslo objednávky zákazníka", "Požadovaný termín zákazníkem"], itemsAdded: 2, itemsMerged: 0, pages: 1,
    })).toBe("AI přečetla objednávku zákazníka PO-4500021877 a doplnila: číslo objednávky zákazníka, požadovaný termín zákazníkem, 2 položky");
    expect(captureEventMessage({ chip: "dodaci_list_dodavatel", aiUsed: false, documentNumber: "", filled: [], itemsAdded: 0, itemsMerged: 1, pages: 3 }))
      .toBe("Doklad zapsán ručně: dodací list — od dodavatele (3 stránky) — vyplněno: údaje u 1 existující položky");
  });

  it("nadpis výsledku", () => {
    expect(resultHeadline({ jobNumber: "Z-2026-014", created: false, docLabel: "Objednávka zákazníka", stageTo: "objednavka" }))
      .toBe("Uloženo do zakázky Z-2026-014 · Objednávka zákazníka · stav Objednávka");
    expect(resultHeadline({ jobNumber: "Z-2026-120", created: true, docLabel: "Poptávka zákazníka", stageFrom: undefined, stageTo: undefined }))
      .toBe("Založena zakázka Z-2026-120 · Poptávka zákazníka");
  });
});

describe("plná automatika", () => {
  it("jen jistá nová zakázka nebo jasná shoda", () => {
    const m = model();
    expect(canAutoApply(m)).toBe(true);
    expect(canAutoApply({ ...m, mode: "approval" })).toBe(false);
    expect(canAutoApply({ ...m, confidence: 0.8 })).toBe(false);
    expect(canAutoApply({ ...m, needsClarification: ["Ověř termín"] })).toBe(false);
    expect(canAutoApply({ ...m, chipExact: false })).toBe(false);
    expect(canAutoApply({ ...m, initial: { ...m.initial, customer: { mode: "none" } } })).toBe(false);
    expect(canAutoApply({ ...m, initial: { ...m.initial, customer: { mode: "existing", id: "c", name: "x", reason: "podobný název firmy (88 %)" } } })).toBe(false);

    const ex = (score: number): ReviewTarget => ({ ...buildExistingTarget({ job: job(), plan: null, reason: "x", score, margins: true }) });
    const withJob = (score: number) => ({ ...m, targets: [ex(score), m.targets[0]], initial: { ...m.initial, targetKey: JOB_ID } });
    expect(canAutoApply(withJob(95))).toBe(true);
    expect(canAutoApply(withJob(88))).toBe(false);
    // nová zakázka, ale existuje podobná → kontrola člověkem
    expect(canAutoApply({ ...m, targets: [ex(50), m.targets[0]] })).toBe(false);
    expect(canAutoApply({ ...withJob(40), fixedJobId: JOB_ID })).toBe(true);
  });
});

describe("kontrola odeslaného formuláře", () => {
  const base = () => JSON.parse(JSON.stringify(model().initial)) as ReviewState;

  it("platný stav projde a uklidí se", () => {
    const raw = { ...base(), items: [...base().items, { key: "e", drawingNumber: "", name: "", description: "" }], fields: { ...base().fields, title: "  Upínky  " } };
    const r = sanitizeReviewState(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.items).toHaveLength(2);
    expect(r.state.fields.title).toBe("Upínky");
    expect(r.state.issuer).toBe("zakaznik");
  });

  it("odmítne nesmysly", () => {
    expect(sanitizeReviewState(null)).toMatchObject({ ok: false });
    expect(sanitizeReviewState({ ...base(), chip: "xx" })).toMatchObject({ ok: false, error: "Vyber, co je to za doklad." });
    expect(sanitizeReviewState({ ...base(), fields: { orderDate: "32.13.2026" } })).toMatchObject({ ok: false });
    expect(sanitizeReviewState({ ...base(), fields: { value: "hodně" } })).toMatchObject({ ok: false });
    expect(sanitizeReviewState({ ...base(), targetKey: "../x" })).toMatchObject({ ok: false });
    expect(sanitizeReviewState({ ...base(), customer: { mode: "existing", id: "1" } })).toMatchObject({ ok: false });
    expect(sanitizeReviewState({ ...base(), customer: { mode: "new", party: { name: " " } } })).toMatchObject({ ok: false });
    expect(sanitizeReviewState({ ...base(), items: [{ name: "x", quantity: "-1" }] })).toMatchObject({ ok: false });
    expect(sanitizeReviewState(base(), { fixedJobId: JOB_ID })).toMatchObject({ ok: false });
  });

  it("nová zakázka nemůže mít „neměnit stav\"", () => {
    const r = sanitizeReviewState({ ...base(), stage: "keep" });
    expect(r.ok && r.state.stage).toBe("objednavka");
  });
});
