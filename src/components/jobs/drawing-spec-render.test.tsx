import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToString as renderSsr } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/orders",
}));

import { CaptureDrawingForm } from "./capture/capture-drawing-form";
import { DrawingSpecChips } from "./drawing-spec-chips";
import { ItemsEditor } from "./detail/items-editor";
import { itemToDraft } from "./detail/detail-helpers";
import { normalizeDrawing } from "@/lib/jobs/capture-batch";
import { initialSpecState, mergeSpecPatch, specColumns, specViewFromRow } from "@/lib/jobs/drawing-spec";
import type { BatchDocReview, DrawingExtract, DrawingReviewState } from "@/lib/jobs/capture-batch-types";

const noop = () => {};
const render = (node: React.ReactElement) => renderSsr(node).replace(/<!-- -->/g, "");
const FIX = path.join(__dirname, "../../lib/jobs/__fixtures__/capture/batch");
const fixture = (name: string) => normalizeDrawing(JSON.parse(readFileSync(path.join(FIX, `${name}.json`), "utf8")));

type DrawingReview = Extract<BatchDocReview, { kind: "drawing" }>;
function review(drawing: DrawingExtract, aiUsed = true, withSpec = true): { doc: DrawingReview; state: DrawingReviewState } {
  const state: DrawingReviewState = {
    drawingNumber: drawing.drawingNumber, revision: drawing.revision, title: drawing.title, material: drawing.material,
    dimensions: drawing.dimensions, generalTolerance: drawing.generalTolerance, tightestTolerance: drawing.tightestTolerance,
    quantity: "", link: { mode: "add" }, archive: true, note: "", onDuplicate: null,
    ...(withSpec ? { spec: initialSpecState(drawing, { aiUsed }) } : {}),
  };
  return {
    doc: { kind: "drawing", docId: "d1", groupKey: "g1", aiUsed, reason: aiUsed ? null : "AI neběžela", drawing, duplicateOf: null, archiveConflict: null, initial: state },
    state,
  };
}
const form = (r: ReturnType<typeof review>) =>
  render(<CaptureDrawingForm doc={r.doc} state={r.state} onChange={noop} itemOptions={[]} drawingsAccess idPrefix="t" />);

describe("kontrola výkresu — materiál, hmotnost a úpravy", () => {
  it("kalený, nitridovaný a černěný razník: skupina, odhad polotovaru, kroky s hodnotami", () => {
    const html = form(review(fixture("vykres-g18a")));
    expect(html).toContain('data-testid="capture-drawing-spec"');
    expect(html).toContain("Materiál, hmotnost a úpravy");
    expect(html).toMatch(/<option value="nastrojova_ocel" selected="">Nástrojová ocel<\/option>/);
    expect(html).toContain("≈ odhad");
    expect(html).toMatch(/data-testid="spec-blank-weight"[^>]*value="\d+,\d+"/);
    expect(html).toContain('data-testid="spec-weight-source"');
    expect(html).toMatch(/data-testid="spec-heat" data-status="uvedeno"/);
    expect(html).toContain('data-testid="spec-heat-step-0"');
    expect(html).toContain('data-testid="spec-heat-step-1"');
    expect(html).toContain('value="58±2"');
    expect(html).toMatch(/<option value="nitridace" selected="">Nitridace<\/option>/);
    expect(html).toContain('value="0,1"');
    expect(html).toMatch(/<option value="cerneni" selected="">Černění<\/option>/);
    expect(html).toContain("Přidat krok");
    expect(html).toContain("Nekótované hrany sražené 0,3 × 45°");
    expect(html).not.toContain("Bez tepelného zpracování");
  });

  it("výkres bez úprav: výslovně „Bez tepelného zpracování“ / „Bez povrchové úpravy“, hmotnost z výkresu", () => {
    const html = form(review(fixture("vykres-g18b")));
    expect(html).toContain("Bez tepelného zpracování");
    expect(html).toContain("Bez povrchové úpravy");
    expect(html).toMatch(/data-testid="spec-heat" data-status="bez"/);
    expect(html).toMatch(/data-testid="spec-weight"[^>]*value="2,6"/);
    expect(html).toContain("z výkresu");
    expect(html).not.toContain("Nezjištěno — doplň</p>");
  });

  it("bez AI: „Nezjištěno — doplň“ (nikdy prázdné pole bez významu)", () => {
    const empty = normalizeDrawing({ drawingNumber: "X-1" });
    const html = form(review(empty, false));
    expect(html.match(/Nezjištěno — doplň<\/p>/g)).toHaveLength(2);
    expect(html).toMatch(/<option value="" selected="">Nezjištěno — doplň<\/option>/);
  });

  it("kalení bez tvrdosti: „Tvrdost neuvedena — doplň“ u hodnoty (oranžově)", () => {
    const d = normalizeDrawing({ drawingNumber: "X-2", material: "C45", heatSteps: [{ kind: "kaleni", value: "", unit: "", depthMm: "", note: "" }], surfaceStatus: "bez" });
    const html = form(review(d));
    expect(html).toContain('data-testid="spec-heat-missing-hardness"');
    expect(html).toContain("Tvrdost neuvedena — doplň");
    expect(html).toMatch(/class="[^"]*border-amber-400[^"]*"[^>]*aria-invalid="true"/);
    expect(form(review(fixture("vykres-g18a")))).not.toContain("spec-heat-missing-hardness");
  });

  it("starší stav bez sekce materiálu → návrh z vytěžení", () => {
    const html = form(review(fixture("vykres-g18a"), true, false));
    expect(html).toContain('value="58±2"');
  });
});

describe("štítky z výkresu", () => {
  const row = (name: string) => mergeSpecPatch({}, specColumns(initialSpecState(fixture(name), { aiUsed: true }), fixture(name).material), {}).patch;

  it("DrawingSpecChips: skupina, polotovar, TZ, PÚ; bez TZ / bez PÚ tlumeně", () => {
    const a = render(<DrawingSpecChips spec={specViewFromRow(row("vykres-g18a"))} />);
    expect(a).toContain("Nástr. ocel");
    expect(a).toMatch(/≈ \d+,\d+ kg\/ks polotovar/);
    expect(a).toContain("Kaleno 58±2 HRC");
    expect(a).toContain("Nitridace 700 HV");
    expect(a).toContain("Černění");
    const b = render(<DrawingSpecChips spec={specViewFromRow(row("vykres-g18b"))} />);
    expect(b).toContain("bez TZ");
    expect(b).toContain("bez PÚ");
    expect(b).toMatch(/data-chip="heat-none" data-tone="none" class="[^"]*border-dashed/);
    expect(b).toContain("2,6 kg");
    const u = render(<DrawingSpecChips spec={specViewFromRow({ heat_status: "nezjisteno" })} />);
    expect(u).toMatch(/data-tone="unknown" class="[^"]*amber/);
    expect(u).toContain("TZ nezjištěno");
    expect(render(<DrawingSpecChips spec={null} />)).toBe("");
    expect(render(<DrawingSpecChips spec={specViewFromRow(row("vykres-g18a"))} compact />)).not.toContain("Kaleno");
  });

  it("Položky zakázky: štítky pod názvem (počítač i mobil)", () => {
    const it0 = { id: "i1", drawingNumber: "E2E-VK-1801", revision: "", name: "Razník", description: "", material: "1.2379", quantity: 8, unit: "ks", unitPrice: null, purchaseUnitPrice: null, note: null };
    const html = render(
      <ItemsEditor drafts={[itemToDraft(it0)]} onChange={noop} specs={{ i1: specViewFromRow(row("vykres-g18a")) }} columns={{ revision: true }} />,
    );
    expect(html).toContain('data-testid="item-spec-0"');
    expect(html).toContain('data-testid="item-spec-m-0"');
    expect(html.match(/Kaleno 58±2 HRC/g)).toHaveLength(2);
    const none = render(<ItemsEditor drafts={[itemToDraft(it0)]} onChange={noop} />);
    expect(none).not.toContain("item-spec-");
  });
});
