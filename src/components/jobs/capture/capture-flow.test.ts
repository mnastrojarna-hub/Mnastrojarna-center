import { describe, it, expect } from "vitest";
import {
  INITIAL_FLOW, allTargets, batchProblemAt, batchSaveProblem, canRead, captureReducer, chosenTargets, confirmedGroups, currentSummaries,
  currentTarget, docExtractStatus, extractingCount, missingExtracts, openBlocks, readyRefs, reviewProblem, savedDocIds,
  type PageDraft,
} from "./capture-flow";
import { setDocType, splitPage } from "./batch-sort";
import { JOB_ID, SORT_DOCS, batchResult, batchReview, sortModel } from "./__fixtures__/batch";
import type { BatchApplyState, BusinessDocState, DocExtractSummary } from "@/lib/jobs/capture-batch-types";
import { buildNewTarget, buildExistingTarget, initialReviewState, type ReviewModel, type ReviewTarget } from "@/lib/jobs/capture-review";
import { emptyParty } from "@/lib/jobs/extracted-normalize";

function page(id: string, status: PageDraft["status"] = "uploading"): PageDraft {
  return { id, name: `${id}.jpg`, size: 10, mimeType: "image/jpeg", previewUrl: null, status, error: null, ref: null };
}

const JOB = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function existing(key = JOB): ReviewTarget {
  return buildExistingTarget({
    job: {
      id: key, number: "Z-2026-101", stage: "poptavka", title: "Upínky", customer: { id: "c1", name: "Strojmetal a.s.", customerNumber: null, ico: null },
      customerOrderNumber: null, customerInquiryNumber: null, customerContact: null, customerContactEmail: null, customerContactPhone: null,
      inquiryDate: null, orderDate: null, customerRequiredDate: null, dueDate: null, expectedDeliveryDate: null, supplierPromisedDate: null,
      value: null, items: [], supplier: null, supplierOrderNumber: null, invoiceNumber: null, deliveryNoteNumber: null,
    },
    plan: null, reason: "podle IČO", score: 65, margins: true,
  });
}

function model(targets: ReviewTarget[]): ReviewModel {
  const initial = initialReviewState({
    docKind: "objednavka", issuer: "zakaznik", target: targets[0], customerMatch: null, supplierMatch: null,
    docCustomer: emptyParty(), docSupplier: emptyParty(),
  });
  return {
    captureId: "x", aiUsed: false, reason: null, docKind: "objednavka", issuer: "zakaznik", chipExact: true, documentNumber: "",
    confidence: null, summary: "", needsClarification: [], docCustomer: emptyParty(), docSupplier: emptyParty(),
    customerMatch: null, supplierMatch: null, fixedJobId: null, targets, margins: true, mode: "approval", previews: [],
    options: { customers: [], suppliers: [], jobs: [] }, initial,
  };
}

describe("tok dialogu", () => {
  it("stránky: nahrání, chyba, pořadí, odebrání", () => {
    let s = captureReducer(INITIAL_FLOW, { type: "add", pages: [page("a"), page("b"), page("c")] });
    expect(canRead(s.pages)).toBe(false);
    s = captureReducer(s, { type: "uploaded", id: "a", ref: { path: "p/a", filename: "a.jpg", mimeType: "image/jpeg", size: 10 } });
    s = captureReducer(s, { type: "uploadFailed", id: "b", error: "chyba" });
    expect(canRead(s.pages)).toBe(false); // c se ještě nahrává
    s = captureReducer(s, { type: "remove", id: "c" });
    expect(canRead(s.pages)).toBe(true);
    expect(readyRefs(s.pages).map((r) => r.path)).toEqual(["p/a"]);
    s = captureReducer(s, { type: "move", id: "b", delta: -1 });
    expect(s.pages.map((p) => p.id)).toEqual(["b", "a"]);
    expect(captureReducer(s, { type: "move", id: "b", delta: -1 })).toBe(s);
  });

  it("čtení → kontrola / rovnou hotovo (plná automatika) → uložení", () => {
    const m = model([buildNewTarget({ plan: null, margins: true, docKind: "objednavka", issuer: "zakaznik" })]);
    let s = captureReducer(INITIAL_FLOW, { type: "read" });
    expect(s.step).toBe("reading");
    s = captureReducer(s, { type: "failed", error: "x", step: "pick" });
    expect(s).toMatchObject({ step: "pick", error: "x" });
    s = captureReducer(s, { type: "analyzed", model: m });
    expect(s).toMatchObject({ step: "review", review: m.initial, error: null });
    s = captureReducer(s, { type: "failed", error: "Doplň název", step: "review" });
    s = captureReducer(s, { type: "edit", review: { ...m.initial, fields: { title: "x" } } });
    expect(s.error).toBeNull();
    s = captureReducer(s, { type: "save" });
    expect(s.step).toBe("saving");
    s = captureReducer(s, { type: "saved", result: { ok: true, created: true, aiUsed: false, filled: [] } });
    expect(s.step).toBe("done");
    const auto = captureReducer(INITIAL_FLOW, { type: "analyzed", model: m, applied: { ok: true, created: false, aiUsed: true, filled: [] } });
    expect(auto.step).toBe("done");
    expect(captureReducer(auto, { type: "reset" })).toBe(INITIAL_FLOW);
  });

  it("ručně vybraná zakázka se přidá k cílům, nová zakázka zůstane poslední", () => {
    const newT = buildNewTarget({ plan: null, margins: true, docKind: "objednavka", issuer: "zakaznik" });
    const m = model([existing(), newT]);
    let s = captureReducer(INITIAL_FLOW, { type: "analyzed", model: m });
    const other = existing("bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee");
    s = captureReducer(s, { type: "addTarget", target: other, review: { ...s.review!, targetKey: other.key } });
    expect(allTargets(s).map((t) => t.key)).toEqual([JOB, other.key, "new"]);
    expect(currentTarget(s)?.key).toBe(other.key);
  });

  it("co chybí k uložení", () => {
    const newT = buildNewTarget({ plan: null, margins: true, docKind: "objednavka", issuer: "zakaznik" });
    const m = model([newT]);
    expect(reviewProblem(m.initial, newT, false)).toMatch(/aspoň název/);
    expect(reviewProblem({ ...m.initial, fields: { title: "Upínky" } }, newT, false)).toBeNull();
    expect(reviewProblem({ ...m.initial, customer: { mode: "existing", id: "", name: "", reason: null } }, newT, false)).toMatch(/Vyber zákazníka/);
    expect(reviewProblem({ ...m.initial, customer: { mode: "new", party: emptyParty() } }, newT, false)).toMatch(/název nového zákazníka/);
    const ex = existing();
    // zákazník zakázky je zamčený → prázdná volba nevadí
    expect(reviewProblem({ ...m.initial, customer: { mode: "existing", id: "", name: "", reason: null } }, ex, false)).toBeNull();
    expect(reviewProblem({ ...m.initial, fields: { title: "x" }, supplier: { mode: "new", party: emptyParty() } }, newT, true)).toMatch(/dodavatele/);
  });
});

describe("tok dávky", () => {
  it("roztřídění → vytěžení → kontrola; zastaralé vytěžení se zahodí", () => {
    const b = sortModel();
    let s = captureReducer(captureReducer(INITIAL_FLOW, { type: "read" }), { type: "batchAnalyzed", batch: b });
    expect(s).toMatchObject({ step: "sort", waitingForExtracts: false });
    expect(s.sort).toBe(b.sort);
    // obchodní doklady + výkres + model (bez AI by se četl jen model); fotka / jiné ne
    expect(missingExtracts(s).map((x) => x.docId)).toEqual(["d1", "d2", "d3", "d4", "d5", "d6"]);
    expect(extractingCount(s)).toBe(6);

    s = captureReducer(s, { type: "extractQueued", docId: "d1", pagesKey: "p1,p2", docType: "objednavka_zakaznik" });
    s = captureReducer(s, { type: "extractStart", docId: "d1", pagesKey: "p1,p2" });
    expect(docExtractStatus(s, s.sort.docs[0])).toBe("reading");
    // uživatel oddělil stranu 2 → staré čtení d1 (p1,p2) se nezapíše
    const edited = splitPage(s.sort, "p2", "objednavka_zakaznik", "u-1");
    s = captureReducer(s, { type: "sortEdit", sort: edited });
    expect(missingExtracts(s).map((x) => x.docId)).toContain("u-1");
    expect(docExtractStatus(s, s.sort.docs[0])).toBe("queued");
    const summary = (docId: string, pagesKey: string, type: DocExtractSummary["type"] = "objednavka_zakaznik"): DocExtractSummary => ({
      docId, pagesKey, type, status: "ready", error: null, aiUsed: true, title: "", documentNumber: "", confidence: 0.9, clarifications: 0,
    });
    const stale = captureReducer(s, { type: "extractDone", docId: "d1", pagesKey: "p1,p2", summary: summary("d1", "p1,p2") });
    // výsledek pro staré stránky se k aktuálnímu dokladu nepočítá
    expect(docExtractStatus(stale, stale.sort.docs[0])).toBe("queued");
    expect(currentSummaries(stale)).toEqual([]);
    s = captureReducer(s, { type: "extractQueued", docId: "d1", pagesKey: "p1", docType: "objednavka_zakaznik" });
    s = captureReducer(s, { type: "extractDone", docId: "d1", pagesKey: "p1", summary: summary("d1", "p1") });
    expect(docExtractStatus(s, s.sort.docs[0])).toBe("ready");
    expect(currentSummaries(s).map((x) => x.docId)).toEqual(["d1"]);

    // změna strany se stejnými stránkami = znovu číst; změna v rámci strany ne
    const swapped = captureReducer(s, { type: "sortEdit", sort: setDocType(s.sort, "d1", "objednavka_my") });
    expect(missingExtracts(swapped).map((x) => x.docId)).toContain("d1");
    const within = captureReducer(s, { type: "sortEdit", sort: setDocType(s.sort, "d1", "poptavka_zakaznik") });
    expect(missingExtracts(within).map((x) => x.docId)).not.toContain("d1");

    s = captureReducer(s, { type: "waitExtracts", on: true });
    expect(s.waitingForExtracts).toBe(true);
    s = captureReducer(s, { type: "sortEdit", sort: s.sort });
    expect(s.waitingForExtracts).toBe(false);
  });

  it("1 doklad v dávce (skipSort) čeká ve čtení; obnova jde do Roztřídění s hotovými vytěženími", () => {
    const one = sortModel({ skipSort: true, sort: { docs: [SORT_DOCS[3]], excludedPageIds: ["p1", "p2", "p3", "p4", "p6", "p7"] } });
    const s = captureReducer(INITIAL_FLOW, { type: "batchAnalyzed", batch: one });
    expect(s).toMatchObject({ step: "reading", waitingForExtracts: true });
    const done: DocExtractSummary = {
      docId: "d1", pagesKey: "p1,p2", type: "objednavka_zakaznik", status: "ready", error: null, aiUsed: true,
      title: "", documentNumber: "PO-4471", confidence: 0.95, clarifications: 0,
    };
    const r = captureReducer(INITIAL_FLOW, { type: "batchResumed", batch: sortModel(), extracts: [done, { ...done, docId: "d2", pagesKey: "jiné" }] });
    expect(r.step).toBe("sort");
    expect(Object.keys(r.extracts)).toEqual(["d1"]);
  });

  it("kontrola: zachování úprav skupiny i dokladu po nové odpovědi, přepnutí cíle", () => {
    const review = batchReview();
    let s = captureReducer({ ...INITIAL_FLOW, batch: sortModel(), sort: review.initial.sort }, { type: "batchReviewReady", review });
    expect(s.step).toBe("review");
    expect(s.batchState).toBe(review.initial);
    const edited: BatchApplyState = {
      ...s.batchState!,
      groups: s.batchState!.groups.map((g) => (g.key === "g1" ? { ...g, job: { ...g.job, fields: { ...g.job.fields, title: "Upínky — ručně" } } } : g)),
      docs: { ...s.batchState!.docs, d5: { kind: "business", state: { ...(s.batchState!.docs.d5 as { state: BusinessDocState }).state, confirmDelivered: false } } },
    };
    s = captureReducer(s, { type: "batchEdit", state: edited });
    expect(chosenTargets(s.batchState)).toEqual({ g1: JOB_ID });

    // stejná skupina i cíl → úpravy zůstanou
    s = captureReducer(s, { type: "batchReviewReady", review: batchReview() });
    expect(s.batchState!.groups[0].job.fields.title).toBe("Upínky — ručně");
    expect((s.batchState!.docs.d5 as { state: BusinessDocState }).state.confirmDelivered).toBe(false);

    // stejná skupina, nový cíl (uživatel vybral „Nová") → switchTarget zachová ručně psaný název
    const r2 = batchReview();
    r2.initial = { ...r2.initial, groups: r2.initial.groups.map((g) => (g.key === "g1" ? { ...g, job: { ...g.job, targetKey: "new" } } : g)) };
    s = captureReducer(s, { type: "batchReviewReady", review: r2 });
    expect(s.batchState!.groups[0].job.targetKey).toBe("new");
    expect(s.batchState!.groups[0].job.fields.title).toBe("Upínky — ručně");

    // doklad se změněným druhem dostane nový formulář
    const r3 = batchReview();
    r3.initial = { ...r3.initial, sort: setDocType(r3.initial.sort, "d5", "dodaci_list_dodavatel") };
    s = captureReducer(s, { type: "batchReviewReady", review: r3 });
    expect((s.batchState!.docs.d5 as { state: BusinessDocState }).state.confirmDelivered).toBe(true);
  });

  it("co chybí k uložení dávky; blokující upozornění", () => {
    const review = batchReview();
    const st = review.initial;
    expect(batchSaveProblem(review, st)).toMatch(/Vyber zakázku pro Kovoobrábění/);
    expect(openBlocks(review, st).map((w) => w.code)).toEqual(["target_required"]);
    const ok: BatchApplyState = { ...st, groups: st.groups.map((g) => (g.key === "g2" ? { ...g, job: { ...g.job, targetKey: JOB_ID } } : g)) };
    expect(openBlocks(review, ok)).toEqual([]);
    // cíl g2 není mezi kandidáty skupiny → kontrola formuláře se přeskočí, nic nechybí
    expect(batchSaveProblem(review, ok)).toBeNull();
    const conflict = { ...review, warnings: [{ ...review.warnings[0], id: "cc", code: "customer_conflict" as const, groupKey: "g1", message: "Rozhodni, zda jde o stejného zákazníka" }] };
    expect(batchSaveProblem(conflict, ok)).toMatch(/stejného zákazníka/);
    const confirmed: BatchApplyState = { ...ok, groups: ok.groups.map((g) => (g.key === "g1" ? { ...g, customerConfirmed: true } : g)) };
    expect(batchSaveProblem(conflict, confirmed)).toBeNull();
    expect(confirmedGroups(confirmed)).toEqual(["g1"]);
    // dodavatel vybraný jako existující bez id
    const noSupplier: BatchApplyState = {
      ...ok,
      docs: { ...ok.docs, d4: { kind: "business", state: { ...(ok.docs.d4 as { state: BusinessDocState }).state, supplier: { mode: "existing", id: "", name: "", reason: null } } } },
    };
    expect(batchSaveProblem(review, noSupplier)).toMatch(/Vyber dodavatele/);
    // zamčený (už uložený) doklad se nekontroluje
    expect(batchSaveProblem(review, noSupplier, new Set(["d4"]))).toBeNull();
    // kde problém je (skok „Ukázat")
    expect(batchProblemAt(review, st)).toMatchObject({ groupKey: "g2" });
    expect(batchProblemAt(review, noSupplier)).toMatchObject({ docId: "d4" });
    expect(batchProblemAt(review, ok)).toBeNull();
  });

  it("po částečném uložení zpět do roztřídění nejde přes Android Zpět ani akce (hlídá dialog), reducer jen přepne krok", () => {
    const review = batchReview();
    let s = captureReducer(INITIAL_FLOW, { type: "batchReviewReady", review });
    s = captureReducer(s, { type: "batchSaved", result: batchResult({ status: "partial" }) });
    expect(savedDocIds(s.batchResult).size).toBeGreaterThan(0);
  });

  it("uložení dávky → hotovo; částečné uložení → zpět do kontroly s uloženými doklady", () => {
    const review = batchReview();
    let s = captureReducer(INITIAL_FLOW, { type: "batchReviewReady", review });
    s = captureReducer(s, { type: "save" });
    expect(s.step).toBe("saving");
    const res = batchResult({ status: "partial" });
    s = captureReducer(s, { type: "batchSaved", result: res });
    expect(s.step).toBe("done");
    expect([...savedDocIds(s.batchResult)]).toEqual(["d1"]);
    s = captureReducer(s, { type: "editAfterPartial" });
    expect(s.step).toBe("review");
    s = captureReducer(s, { type: "backToSort" });
    expect(s.step).toBe("sort");
    expect(captureReducer(INITIAL_FLOW, { type: "editAfterPartial" })).toBe(INITIAL_FLOW);
  });
});
