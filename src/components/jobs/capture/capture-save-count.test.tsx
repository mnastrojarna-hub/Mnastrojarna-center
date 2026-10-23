import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { renderToString as renderSsr } from "react-dom/server";

// Kontrola dávky: kolik zakázek se uloží, „Sloučit do jedné zakázky", zdroj počtu / názvu u výkresu
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/orders",
}));
vi.mock("@/app/actions/capture", () => ({ createCaptureUpload: vi.fn(), discardCapture: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));

import { CaptureBatchReview } from "./capture-batch-review";
import { CaptureDrawingForm } from "./capture-drawing-form";
import { jobsGenitive, mergeAllPlan, saveCountInfo, warningResolved } from "./capture-flow";
import { batchReview, sortModel } from "./__fixtures__/batch";
import type { BatchDocReview, BatchReviewModel, DrawingReviewState } from "@/lib/jobs/capture-batch-types";

const noop = () => {};
const html = (review: BatchReviewModel, locked = new Set<string>()) => renderSsr(
  <CaptureBatchReview
    review={review} state={review.initial} batch={sortModel()} local={new Map()} locked={locked} picking={null}
    onChange={noop} onPickJob={noop} onAssign={noop} onAction={noop} onChangeType={noop} onMergeAll={noop}
  />,
).replace(/<!-- -->/g, "");

/** Jen první skupina (všechny doklady do g1). */
function oneGroup(): BatchReviewModel {
  const r = batchReview();
  const g1 = r.initial.groups[0];
  return {
    ...r,
    groups: [{ ...r.groups[0], docIds: [...r.groups[0].docIds, "d4"] }],
    initial: { ...r.initial, groups: [{ ...g1, docIds: [...g1.docIds, "d4"] }] },
  };
}

describe("kolik zakázek se uloží", () => {
  it("2 skupiny → „Pozor: uloží se do 2 zakázek — proč“ + Sloučit do jedné zakázky", () => {
    const review = batchReview();
    expect(saveCountInfo(review, review.initial)).toEqual({ count: 2, reasons: ["Zakázka 2: jen doklad dodavatele bez shody"] });
    const out = html(review);
    expect(out).toMatch(/data-testid="capture-save-count" data-count="2"/);
    expect(out).toContain("Pozor: uloží se do 2 zakázek");
    expect(out).toContain("proč: Zakázka 2: jen doklad dodavatele bez shody");
    expect(out).toContain('data-testid="capture-merge-all"');
    expect(out).toContain("Sloučit do jedné zakázky");
    // po částečném uložení už sloučit nejde
    expect(html(review, new Set(["d4"]))).not.toContain('data-testid="capture-merge-all"');
  });

  it("2 skupiny se STEJNOU cílovou zakázkou → „Uloží se do 1 zakázky“ (žádné „Pozor: 2 zakázky“)", () => {
    const r = batchReview();
    const target = r.initial.groups[0].job.targetKey;
    expect(target).not.toBe("new");
    const review: BatchReviewModel = { ...r, initial: { ...r.initial, groups: r.initial.groups.map((g) => ({ ...g, job: { ...g.job, targetKey: target } })) } };
    expect(saveCountInfo(review, review.initial)).toEqual({ count: 1, reasons: [] });
    const out = html(review);
    expect(out).toMatch(/data-testid="capture-save-count" data-count="1"/);
    expect(out).not.toContain("Pozor: uloží se do 2 zakázek");
    // dvě „nové“ = dvě zakázky
    const two: BatchReviewModel = { ...r, initial: { ...r.initial, groups: r.initial.groups.map((g) => ({ ...g, job: { ...g.job, targetKey: "new" } })) } };
    expect(saveCountInfo(two, two.initial).count).toBe(2);
  });

  it("1 skupina → „Uloží se do 1 zakázky“, bez sloučení", () => {
    const review = oneGroup();
    const out = html(review);
    expect(out).toMatch(/data-testid="capture-save-count" data-count="1"/);
    expect(out).toContain("Uloží se do 1 zakázky");
    expect(out).not.toContain("Sloučit do jedné zakázky");
    expect(mergeAllPlan(review, review.initial)).toBeNull();
  });

  it("sloučení: vše do první skupiny, odlišné IČO hlásí k potvrzení", () => {
    const review = batchReview();
    const plan = mergeAllPlan(review, review.initial)!;
    expect(plan).toEqual({ target: "g1", assign: { d4: "g1" }, icos: [review.groups[0].model.docCustomer.ico.replace(/\D/g, "")].filter(Boolean) });
    const withIco: BatchReviewModel = {
      ...review,
      groups: review.groups.map((g, i) => (i === 1 ? { ...g, model: { ...g.model, docCustomer: { ...g.model.docCustomer, ico: "27654321" } } } : g)),
    };
    expect(mergeAllPlan(withIco, withIco.initial)!.icos).toHaveLength(2);
    expect(jobsGenitive(1)).toBe("1 zakázky");
    expect(jobsGenitive(3)).toBe("3 zakázek");
  });

  it("jinak psaný zákazník se vyřeší potvrzením skupiny", () => {
    const review = batchReview();
    const w = { id: "w", code: "customer_written_differently" as const, severity: "warn" as const, docIds: ["d5"], groupKey: "g1", message: "", actions: [] };
    expect(warningResolved(w, review.initial)).toBe(false);
    expect(warningResolved(w, { ...review.initial, groups: review.initial.groups.map((g) => ({ ...g, customerConfirmed: true })) })).toBe(true);
  });
});

describe("výkres: zdroj počtu kusů a názvu", () => {
  it("„z objednávky PO-…“ pod polem, dokud ho člověk nezmění", () => {
    const review = batchReview();
    const dr = review.docs.find((d) => d.kind === "drawing") as Extract<BatchDocReview, { kind: "drawing" }>;
    const st: DrawingReviewState = { ...(review.initial.docs.d2 as { state: DrawingReviewState }).state, quantity: "50", title: "Upínka" };
    const doc = { ...dr, initial: st, sources: { quantity: "z objednávky PO-4471", title: "název z objednávky PO-4471" } };
    const out = renderSsr(<CaptureDrawingForm doc={doc} state={st} onChange={noop} itemOptions={[]} drawingsAccess idPrefix="t" />);
    expect(out).toContain("Počet kusů");
    expect(out).toContain('data-testid="capture-drawing-quantity-source"');
    expect(out).toContain("z objednávky PO-4471");
    expect(out).toContain("název z objednávky PO-4471");
    const changed = renderSsr(<CaptureDrawingForm doc={doc} state={{ ...st, quantity: "60" }} onChange={noop} itemOptions={[]} drawingsAccess idPrefix="t" />);
    expect(changed).not.toContain('data-testid="capture-drawing-quantity-source"');
  });
});
