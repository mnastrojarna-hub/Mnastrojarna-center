import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { renderToString as renderSsr } from "react-dom/server";

// Majitel 9. 11. (HOFMEISTER): kontrola e-mailu se 2 výkresy — rozhodnutí přímo u upozornění, vazby po změně
// cíle, „Uložit zbývající" po částečném uložení. Fixtures = skutečná odpověď kontroly z integračního testu
// (src/lib/email/mail-capture-hofmeister.integration.test.ts, testovací AI).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/orders",
}));
vi.mock("@/app/actions/capture", () => ({ createCaptureUpload: vi.fn(), discardCapture: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));

import { CaptureBatchReview } from "./capture-batch-review";
import { CaptureDrawingForm } from "./capture-drawing-form";
import {
  batchProblemAt, batchSaveProblem, duplicateInTarget, invalidLinkDoc, mergeBatchState, openBlocks, relinkGroupDocs, warningResolved, withAck,
} from "./capture-flow";
import { batchReview, sortModel } from "./__fixtures__/batch";
import basic from "./__fixtures__/hofmeister-review.json";
import misread from "./__fixtures__/hofmeister-misread-review.json";
import type { BatchApplyState, BatchReviewModel, BatchSortModel, BatchWarning, DuplicateRef } from "@/lib/jobs/capture-batch-types";
import { buildExistingTarget, switchTarget } from "@/lib/jobs/capture-review";

const noop = () => {};
const render = (node: React.ReactElement) => renderSsr(node).replace(/<!-- -->/g, "");
const clone = <T,>(x: T): T => structuredClone(x);
const B = () => clone(basic) as unknown as { review: BatchReviewModel; batch: BatchSortModel };
const M = () => clone(misread) as unknown as { review: BatchReviewModel; batch: BatchSortModel };
const Y832 = "A290-7904-Y832";
const Y823 = "A290-7904-Y823";
const OLD_JOB = "0b0b0b0b-1111-4222-8333-444444444444";
const OLD_ITEM = "0c0c0c0c-1111-4222-8333-444444444444";

function drawing(st: BatchApplyState, id: string) {
  const d = st.docs[id];
  if (d.kind !== "drawing") throw new Error("výkres");
  return d.state;
}
function docByNumber(r: BatchReviewModel, num: string): string {
  return r.docs.find((d) => d.kind === "drawing" && drawing(r.initial, d.docId).drawingNumber === num)!.docId;
}
/** Starší zakázka s Y832 jako další cíl skupiny (jako v kontrole, když je výkres u jiné zakázky). */
function withOldJob(r: BatchReviewModel, dupDocId: string): BatchReviewModel {
  const t = buildExistingTarget({
    job: {
      id: OLD_JOB, number: "Z-2026-031", stage: "objednavka", title: "klamp", customer: { id: "c1", name: "HOFMEISTER s.r.o.", customerNumber: null, ico: null },
      customerOrderNumber: null, customerInquiryNumber: null, customerContact: null, customerContactEmail: null, customerContactPhone: null,
      inquiryDate: null, orderDate: null, customerRequiredDate: null, dueDate: null, expectedDeliveryDate: null, supplierPromisedDate: null,
      value: null, items: [], supplier: null, supplierOrderNumber: null, invoiceNumber: null, deliveryNoteNumber: null,
    },
    plan: null, reason: "stejný zákazník a výkres A290-7904-Y832", score: 65, margins: true,
  });
  const g = r.groups[0];
  g.model.targets = [t, ...g.model.targets];
  g.itemOptions[OLD_JOB] = [{ link: { mode: "item", itemId: OLD_ITEM }, label: `${Y832} klamp`, drawingNumber: Y832, revision: "" }];
  const dup: DuplicateRef = { jobId: OLD_JOB, jobNumber: "Z-2026-031", fileId: "f1", what: `Výkres ${Y832}`, date: "1. 3. 2026" };
  r.docs = r.docs.map((d) => (d.docId === dupDocId && d.kind === "drawing" ? { ...d, duplicateOf: dup } : d));
  r.warnings.push({
    id: `also_in_job:${dupDocId}`, code: "also_in_job", severity: "info", docIds: [dupDocId], groupKey: g.key, actions: [],
    message: `Výkres ${Y832} je už i u zakázky Z-2026-031 — uloží se i sem; tam najdeš historii a poslední cenu.`,
    links: [{ label: "Otevřít Z-2026-031", href: `/orders/${OLD_JOB}` }],
  });
  return r;
}
function switchTo(r: BatchReviewModel, st: BatchApplyState, key: string): BatchApplyState {
  const g = st.groups[0];
  const ts = r.groups[0].model.targets;
  const from = ts.find((t) => t.key === g.job.targetKey)!;
  const to = ts.find((t) => t.key === key)!;
  return { ...st, groups: [{ ...g, job: switchTarget(g.job, from, to, g.job.customer, g.job.supplier) }] };
}

describe("Rozhodnutí u upozornění (logika)", () => {
  it("materiál: „Platí POM“ = potvrzeno (ack), „Platí materiál z výkresu“ = materiál položky z výkresu; nic neblokuje", () => {
    const { review: r } = B();
    expect(openBlocks(r, r.initial)).toEqual([]);
    expect(batchSaveProblem(r, r.initial)).toBeNull();
    const d832 = docByNumber(r, Y832);
    const mat = r.warnings.find((w) => w.code === "material_conflict" && w.docIds.includes(d832))!;
    expect(mat.actions.map((a) => [a.kind, a.label])).toEqual([
      ["ack", "Platí POM (z textu e-mailu)"], ["use_drawing_material", "Platí materiál z výkresu (PET100 (POLYPENCO))"],
    ]);
    expect(warningResolved(mat, r.initial, r)).toBe(false);
    expect(warningResolved(mat, withAck(r.initial, mat.id), r)).toBe(true);
    const g = r.initial.groups[0];
    const fromDrawing: BatchApplyState = { ...r.initial, groups: [{ ...g, job: { ...g.job, items: g.job.items.map((i) => (i.key === "ai-0" ? { ...i, material: "PET100 (POLYPENCO)" } : i)) } }] };
    expect(warningResolved(mat, fromDrawing, r)).toBe(true);
  });

  it("počet 8 → 4 v Položkách: „Platí poptávka: 8 ks“ se schová, vazba výkresu zůstane (žádné „není k položce“)", () => {
    const { review: r } = B();
    const d832 = docByNumber(r, Y832);
    const q = r.warnings.find((w) => w.code === "quantity_conflict" && w.docIds.includes(d832))!;
    expect(warningResolved(q, r.initial, r)).toBe(false);
    const g = r.initial.groups[0];
    const st: BatchApplyState = { ...r.initial, groups: [{ ...g, job: { ...g.job, items: g.job.items.map((i) => (i.key === "ai-0" ? { ...i, quantity: "4" } : i)) } }] };
    expect(warningResolved(q, st, r)).toBe(true);
    expect(drawing(st, d832).link).toEqual({ mode: "docItem", itemKey: "ai-0" });
    expect(invalidLinkDoc(r, st)).toBeNull();
    expect(batchSaveProblem(r, st)).toBeNull();
  });

  it("přepnutí cíle na starší zakázku a zpět: vazby podle čísla výkresu („ai-0“ jiného cíle se nepoužije), „Neukládat znovu“ jen u zakázky, kde výkres je", () => {
    const r = withOldJob(B().review, docByNumber(B().review, Y832));
    const d832 = docByNumber(r, Y832);
    const d823 = docByNumber(r, Y823);
    const also = r.warnings.find((w) => w.code === "also_in_job")!;
    expect(duplicateInTarget(r, r.initial, d832)).toBeNull();
    expect(warningResolved(also, r.initial, r)).toBe(false); // informace zůstává vidět
    let st = relinkGroupDocs(r, switchTo(r, r.initial, OLD_JOB), r.initial.groups[0].key);
    expect(drawing(st, d832).link).toEqual({ mode: "item", itemId: OLD_ITEM });
    expect(drawing(st, d832).onDuplicate).toBe("skip");
    expect(duplicateInTarget(r, st, d832)?.jobId).toBe(OLD_JOB);
    st = relinkGroupDocs(r, switchTo(r, st, "new"), r.initial.groups[0].key);
    expect(drawing(st, d832).link).toEqual({ mode: "docItem", itemKey: "ai-0" });
    expect(drawing(st, d823).link).toEqual({ mode: "docItem", itemKey: "ai-1" });
    expect(drawing(st, d832).onDuplicate).toBeNull();
    expect(batchSaveProblem(r, st)).toBeNull();
  });

  it("bez přepojení (starý stav): vazba na položku jiné zakázky = problém s místem opravy, ne tiché selhání při uložení", () => {
    const r = withOldJob(B().review, docByNumber(B().review, Y832));
    const d832 = docByNumber(r, Y832);
    const st: BatchApplyState = { ...r.initial, docs: { ...r.initial.docs, [d832]: { kind: "drawing", state: { ...drawing(r.initial, d832), link: { mode: "item", itemId: OLD_ITEM } } } } };
    expect(invalidLinkDoc(r, st)?.docId).toBe(d832);
    expect(batchProblemAt(r, st)).toMatchObject({ docId: d832, message: expect.stringMatching(/vybraná položka patří k jiné zakázce/) });
    // uložený výkres se nehlídá
    expect(invalidLinkDoc(r, st, new Set([d832]))).toBeNull();
  });

  it("nová odpověď serveru se změněným cílem (mergeBatchState): rozhodnutí (ack) zůstanou, vazby se přepojí", () => {
    const r = withOldJob(B().review, docByNumber(B().review, Y832));
    const d832 = docByNumber(r, Y832);
    const prev = withAck(relinkGroupDocs(r, switchTo(r, r.initial, OLD_JOB), r.initial.groups[0].key), "material_conflict:x");
    const merged = mergeBatchState(r, prev, r);
    expect(merged.ack).toEqual(["material_conflict:x"]);
    expect(merged.groups[0].job.targetKey).toBe("new");
    expect(drawing(merged, d832).link).toEqual({ mode: "docItem", itemKey: "ai-0" });
  });

  it("OCR přečetla oba výkresy jako Y832: volba „… je A290-7904-Y823 (4 ks)“ nebo „Jsou to listy téhož výkresu“; duplicita v dávce „Ponechat oba“", () => {
    const { review: r } = M();
    const w = r.warnings.find((x) => x.code === "drawing_item_shared")!;
    expect(w.severity).toBe("warn");
    const link = w.actions.find((a) => a.kind === "link_item")!;
    expect(link).toMatchObject({ itemKey: "ai-1", value: Y823, label: `„${Y823}.pdf“ je ${Y823} (4 ks)` });
    const dup = r.warnings.find((x) => x.code === "duplicate_doc")!;
    expect(dup.actions[0]).toMatchObject({ kind: "ack", label: "Ponechat oba" });
    expect(batchSaveProblem(r, r.initial)).toBeNull();
    const d = drawing(r.initial, link.docId!);
    const st: BatchApplyState = { ...r.initial, docs: { ...r.initial.docs, [link.docId!]: { kind: "drawing", state: { ...d, link: { mode: "docItem", itemKey: "ai-1" }, drawingNumber: Y823 } } } };
    expect(warningResolved(w, st, r)).toBe(true);
    expect(warningResolved(dup, st, r)).toBe(true);
    expect(warningResolved(w, withAck(r.initial, w.id), r)).toBe(true);
  });
});

/** Upozornění vykreslená v kontrole: kód, závažnost, počet tlačítek akcí. */
function renderedWarnings(html: string): { code: string; severity: string; actions: number; text: string }[] {
  const out: { code: string; severity: string; actions: number; text: string }[] = [];
  const re = /<li data-testid="capture-warning" data-code="([^"]+)" data-severity="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    out.push({ code: m[1], severity: m[2], actions: (m[3].match(/data-testid="capture-warning-action"/g) ?? []).length, text: m[3].replace(/<[^>]+>/g, " ") });
  }
  return out;
}

function reviewHtml(r: BatchReviewModel, batch: BatchSortModel, state: BatchApplyState = r.initial, extra: Partial<React.ComponentProps<typeof CaptureBatchReview>> = {}) {
  return render(
    <CaptureBatchReview
      review={r} state={state} batch={batch} local={new Map()} locked={new Set()} picking={null}
      onChange={noop} onPickJob={noop} onAssign={noop} onAction={noop} onChangeType={noop}
      {...extra}
    />,
  );
}

describe("Kontrola HOFMEISTER — vykreslení", () => {
  it("každé blokující / ⚠ upozornění má na místě tlačítko (target_required má výběr zakázky); informace bez ⚠ a bez tlačítka", () => {
    const cases: [BatchReviewModel, BatchSortModel][] = [[B().review, B().batch], [M().review, M().batch], [batchReview(), sortModel()]];
    let checked = 0;
    for (const [r, batch] of cases) {
      const html = reviewHtml(r, batch);
      const ws = renderedWarnings(html);
      for (const w of ws) {
        if (w.severity === "info") continue;
        checked++;
        if (w.code === "target_required") expect(html).toContain('role="radiogroup" aria-label="Zakázka"');
        else expect(w.actions, `${w.code}: ${w.text}`).toBeGreaterThan(0);
      }
      // všechna nevyřešená blokující upozornění serveru jsou vidět
      for (const b of r.warnings.filter((x) => x.severity === "block" && !warningResolved(x, r.initial, r))) {
        expect(ws.some((w) => w.code === b.code), b.message).toBe(true);
      }
    }
    expect(checked).toBeGreaterThanOrEqual(4);
  });

  it("dva výkresy, obě položky; materiál rozhodne tlačítko u výkresu; poznámky AI s „Potvrdit“; počet zakázek 1", () => {
    const { review: r, batch } = B();
    const html = reviewHtml(r, batch);
    expect(html.match(/data-type="vykres"/g)?.length).toBe(2);
    expect(html).toContain(`→ položka ${Y832}`);
    expect(html).toContain(`→ položka ${Y823}`);
    expect(html).toContain("Platí POM (z textu e-mailu)");
    expect(html).toContain("Platí materiál z výkresu (PET100 (POLYPENCO))");
    expect(html).toContain("Materiál na výkresu: S400 (japonská norma JIS) — potvrdit.");
    expect(html.match(/data-testid="capture-note-confirm"/g)?.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain("Potvrdit vše");
    expect(html).toContain('data-testid="capture-save-count" data-count="1"');
    // „Platí poptávka: 8 ks" je informace (bez ⚠, bez tlačítka)
    const q = renderedWarnings(html).find((w) => w.code === "quantity_conflict");
    expect(q).toMatchObject({ severity: "info", actions: 0 });
  });

  it("po potvrzení poznámek a materiálu: karty výkresů bez ⚠ (Zkontrolováno), upozornění zmizí", () => {
    const { review: r, batch } = B();
    const ids = r.docs.flatMap((d) => (d.kind === "drawing" ? [`checked:${d.docId}`] : []));
    const st = withAck(r.initial, ...ids, ...r.warnings.filter((w) => w.code === "material_conflict").map((w) => w.id));
    const html = reviewHtml(r, batch, st);
    expect(renderedWarnings(html).filter((w) => w.severity !== "info")).toEqual([]);
    expect(html).not.toContain("Další ⚠");
  });

  it("výkres u jiné zakázky: informace s odkazem „Otevřít Z-2026-031“, žádná volba „Neukládat znovu“; u cílové zakázky volba je", () => {
    const { review: r0 } = B();
    const r = withOldJob(r0, docByNumber(r0, Y832));
    const d832 = docByNumber(r, Y832);
    const doc = r.docs.find((d) => d.docId === d832)!;
    if (doc.kind !== "drawing") throw new Error("výkres");
    const props = { doc, state: drawing(r.initial, d832), onChange: noop, itemOptions: r.groups[0].itemOptions.new, drawingsAccess: true, idPrefix: "x" };
    const elsewhere = render(<CaptureDrawingForm {...props} duplicateInTarget={false} />);
    expect(elsewhere).toContain('data-testid="capture-drawing-elsewhere"');
    expect(elsewhere).toContain("Otevřít Z-2026-031");
    expect(elsewhere).toContain(`/orders/${OLD_JOB}`);
    expect(elsewhere).not.toContain("Neukládat znovu");
    const inTarget = render(<CaptureDrawingForm {...props} duplicateInTarget />);
    expect(inTarget).toContain("Neukládat znovu");
    expect(inTarget).toContain("Uložit jako novou verzi");
  });

  it("po částečném uložení: neuložený výkres má důvod a nápravu u sebe, uložený je zamčený", () => {
    const { review: r, batch } = B();
    const d832 = docByNumber(r, Y832);
    const d823 = docByNumber(r, Y823);
    const html = reviewHtml(r, batch, r.initial, { locked: new Set([d823]), failed: { [d832]: "Vybraná položka nepatří k zakázce — vyber ji znovu." } });
    expect(html).toContain('data-testid="capture-doc-failed"');
    expect(html).toContain("Neuložilo se: Vybraná položka nepatří k zakázce");
    expect(html).toContain("Uložit bez vazby na položku");
    expect(html).toContain("neuložilo se — oprav");
    expect(html).toContain("uloženo");
  });

  it("OCR přečetla podobné číslo: u výkresu „… je A290-7904-Y823 (4 ks)“ a „Jsou to listy téhož výkresu“", () => {
    const { review: r, batch } = M();
    const html = reviewHtml(r, batch);
    expect(html).toContain(`„${Y823}.pdf“ je ${Y823} (4 ks)`);
    expect(html).toContain("Jsou to listy téhož výkresu");
    expect(html).toContain("Ponechat oba");
  });
});

describe("Typy upozornění", () => {
  it("upozornění ⚠ bez vlastní akce dostane „Beru na vědomí“ (ack)", () => {
    const { review: r, batch } = B();
    const w: BatchWarning = { id: "revision_conflict:x", code: "revision_conflict", severity: "warn", docIds: [docByNumber(r, Y832)], groupKey: r.groups[0].key, message: "rev. A × výkres rev. B", actions: [] };
    r.warnings.push(w);
    const html = reviewHtml(r, batch);
    const row = renderedWarnings(html).find((x) => x.code === "revision_conflict")!;
    expect(row.actions).toBe(1);
    expect(row.text).toContain("Beru na vědomí");
    expect(warningResolved(w, withAck(r.initial, w.id), r)).toBe(true);
  });
});
