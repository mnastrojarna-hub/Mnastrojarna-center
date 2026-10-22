import { describe, it, expect } from "vitest";
import { INITIAL_FLOW, allTargets, canRead, captureReducer, currentTarget, readyRefs, reviewProblem, type PageDraft } from "./capture-flow";
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
