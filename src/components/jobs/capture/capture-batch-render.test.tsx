import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { renderToString as renderSsr } from "react-dom/server";

// Vykreslení dávkového focení bez Next.js (akce a Supabase klient nahrazené)
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/orders",
}));
vi.mock("@/app/actions/capture", () => ({ createCaptureUpload: vi.fn(), discardCapture: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));

import { CaptureSort } from "./capture-sort";
import { CaptureBatchReview } from "./capture-batch-review";
import { CaptureBatchDone } from "./capture-batch-done";
import { CaptureGroupHeader } from "./capture-group-header";
import { CaptureDrawingForm } from "./capture-drawing-form";
import { CaptureModelForm } from "./capture-model-form";
import { CaptureDocForm } from "./capture-doc-form";
import { CaptureReading, batchReadingTitle } from "./capture-reading";
import { CapturePick, pickCountLabel, pickTileKind } from "./capture-pick";
import { batchSaveProblem } from "./capture-flow";
import { batchResult, batchReview, sortModel } from "./__fixtures__/batch";
import type { BatchDocReview, BusinessDocState, DrawingReviewState, ModelReviewState } from "@/lib/jobs/capture-batch-types";

const noop = () => {};
function renderToString(node: React.ReactElement): string {
  return renderSsr(node).replace(/<!-- -->/g, "");
}

describe("Roztřídění — karty", () => {
  it("karta = doklad s druhem, stranou a stavem vytěžení; pruh a chip v barvách", () => {
    const batch = sortModel();
    const html = renderToString(
      <CaptureSort
        batch={batch}
        sort={batch.sort}
        local={new Map()}
        statusOf={(d) => (d.id === "d1" ? "ready" : d.id === "d4" ? "error" : "reading")}
        errorOf={(id) => (id === "d4" ? "AI neodpověděla" : null)}
        onChange={noop}
        onRetry={noop}
        waiting={false}
        waitingCount={0}
        onCancelWait={noop}
      />,
    );
    expect(html).toContain('data-testid="capture-sort"');
    expect(html.match(/data-testid="capture-sort-doc"/g)).toHaveLength(6);
    expect(html).toMatch(/data-doc-id="d1"[^>]*data-type="objednavka_zakaznik"[^>]*data-status="ready"[^>]*data-group="zakaznik"/);
    expect(html).toMatch(/data-doc-id="d4"[^>]*data-type="nabidka_dodavatel"[^>]*data-status="error"[^>]*data-group="dodavatel"/);
    expect(html).toMatch(/data-doc-id="d5"[^>]*data-group="my"/);
    // pruh strany + štítek „OD …"
    expect(html).toContain("bg-sky-500");
    expect(html).toContain("bg-lime-500");
    expect(html).toContain("bg-rose-500");
    expect(html).toContain("Od zákazníka");
    expect(html).toContain("Od dodavatele");
    // chip druhu v barvě druhu souboru (objednávka = oranžová, nabídka dodavatele = nacenění)
    expect(html).toContain("bg-orange-100");
    expect(html).toContain("bg-amber-100");
    // ovládání
    expect(html).toMatch(/aria-label="[^"]+ — změnit druh dokladu"/);
    expect(html).toMatch(/aria-label="[^"]+ \(prohodit vystavitele\)"/);
    expect(html).toContain('aria-label="Akce dokladu"');
    expect(html).toContain("Je to naše nabídka");
    // nízká jistota s důvodem jen u výkresu (74 %)
    expect(html).toContain("74 %");
    expect(html).toContain("hlavička nečitelná");
    expect(html).toContain("AI neodpověděla");
    expect(html).toContain("Zkusit znovu");
    // upozornění s akcí z roztřídění
    expect(html).toContain("Vyřadit duplicitu");
    expect(html).toContain("Každá fotka zvlášť");
    expect(html).toContain("Sloučit vše do jednoho");
  });

  it("vyřazený doklad zešedne a nabídne Vrátit; čekání zamkne úpravy", () => {
    const batch = sortModel();
    const sort = { ...batch.sort, docs: batch.sort.docs.map((d) => (d.id === "d2" ? { ...d, excluded: true } : d)), excludedPageIds: [] };
    const html = renderToString(
      <CaptureSort batch={batch} sort={sort} local={new Map()} statusOf={() => "ready"} errorOf={() => null}
        onChange={noop} onRetry={noop} waiting waitingCount={2} onCancelWait={noop} />,
    );
    expect(html).toMatch(/data-doc-id="d2"[^>]*data-status="excluded"/);
    expect(html).toContain('aria-label="Vrátit doklad"');
    expect(html).toContain("Čekám na dočtení (2)");
    expect(html).toContain("Upravit");
  });

  it("bez AI: nápověda k ručnímu roztřídění", () => {
    const batch = sortModel({ aiUsed: false, reason: "AI čtení není zapnuté", warnings: [] });
    const html = renderToString(
      <CaptureSort batch={batch} sort={batch.sort} local={new Map()} statusOf={() => "none"} errorOf={() => null}
        onChange={noop} onRetry={noop} waiting={false} waitingCount={0} onCancelWait={noop} />,
    );
    expect(html).toContain("u každého dokladu vyber druh");
    expect(html).toContain("AI čtení není zapnuté");
  });
});

describe("Kontrola dávky", () => {
  it("2 skupiny (radiogroup Zakázka per skupina), sekce dokladů, blokující upozornění brání uložení", () => {
    const review = batchReview();
    const html = renderToString(
      <CaptureBatchReview
        review={review}
        state={review.initial}
        batch={sortModel()}
        local={new Map()}
        locked={new Set()}
        picking={null}
        onChange={noop}
        onPickJob={noop}
        onAssign={noop}
        onAction={noop}
        onChangeType={noop}
      />,
    );
    expect(html.match(/data-testid="capture-group"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Zakázka 1"');
    expect(html).toContain('aria-label="Zakázka 2"');
    expect(html.match(/role="radiogroup" aria-label="Zakázka"/g)).toHaveLength(2);
    expect(html).toContain('data-group-key="g1"');
    expect(html).toMatch(/data-group-key="g2" data-target=""/);
    // sekce dokladů s názvem typu
    expect(html).toContain('aria-label="Objednávka zákazníka"');
    expect(html).toContain('aria-label="Výkres"');
    expect(html).toContain('aria-label="3D model"');
    // blokující upozornění skupiny bez cíle
    expect(html).toContain("Vyber zakázku pro NAB-552");
    expect(html).toContain("Položka má rev. C, výkres rev. B");
    expect(batchSaveProblem(review, review.initial)).toMatch(/Vyber zakázku/);
  });

  it("hlavička skupiny: údaje zakázky se značkou zdroje z jiného dokladu", () => {
    const review = batchReview();
    const g = review.groups[0];
    const html = renderToString(
      <CaptureGroupHeader
        index={1}
        group={g}
        state={review.initial.groups[0]}
        apply={review.initial}
        docs={review.initial.sort.docs.filter((d) => g.docIds.includes(d.id))}
        options={review.options}
        margins
        aiUsed={false}
        fixedJobId={null}
        warnings={[]}
        locked={false}
        picking={false}
        onChange={noop}
        onPickJob={noop}
        onAction={noop}
      />,
    );
    expect(html).toContain("Údaje zakázky");
    expect(html).toContain("Strojmetal");
    expect(html).toContain('aria-label="Vybrat jinou zakázku"');
    // embedded formulář — bez druhu dokladu a bez sekce stavu
    expect(html).not.toContain("Co je to za doklad?");
    expect(html).not.toContain("Uložit fotku jako");
    expect(html).toContain('id="cap-g1-field-title"');
  });

  it("výkres: archiv jen s právem drawings; model: formát jako štítek", () => {
    const review = batchReview();
    const dr = review.docs.find((d) => d.kind === "drawing") as Extract<BatchDocReview, { kind: "drawing" }>;
    const st = (review.initial.docs.d2 as { state: DrawingReviewState }).state;
    const withAccess = renderToString(<CaptureDrawingForm doc={dr} state={st} onChange={noop} itemOptions={[]} drawingsAccess idPrefix="t" />);
    expect(withAccess).toContain("Zapsat do archivu výkresů");
    expect(withAccess).toContain("1.2379");
    expect(withAccess).toContain("Založit novou položku");
    // firma z razítka = kdo kreslil, jen informace (ne zákazník)
    expect(withAccess).toMatch(/Kreslil \(z razítka\): Strojmetal a\.s\. — jen informace/);
    const noAccess = renderToString(<CaptureDrawingForm doc={dr} state={st} onChange={noop} itemOptions={[]} drawingsAccess={false} idPrefix="t" />);
    expect(noAccess).not.toContain("Zapsat do archivu výkresů");

    const md = review.docs.find((d) => d.kind === "model") as Extract<BatchDocReview, { kind: "model" }>;
    const ms = (review.initial.docs.d3 as { state: ModelReviewState }).state;
    const model = renderToString(<CaptureModelForm doc={md} state={ms} onChange={noop} itemOptions={[]} idPrefix="m" />);
    expect(model).toContain("STEP");
    expect(model).toContain("4711-02");
  });

  it("nabídka dodavatele: řádky s cenou jen s maržemi, bez nich jen čeká na Nákup", () => {
    const review = batchReview();
    const d4 = review.docs.find((d) => d.docId === "d4") as Extract<BatchDocReview, { kind: "business" }>;
    const st = (review.initial.docs.d4 as { state: BusinessDocState }).state;
    const props = { doc: d4, state: st, onChange: noop, options: review.options, idPrefix: "q", groupItems: [], onToggleRow: noop, onChangeType: noop };
    const withMargins = renderToString(<CaptureDocForm {...props} margins />);
    expect(withMargins).toContain("Nákup / MJ");
    expect(withMargins).toContain("412");
    expect(withMargins).toContain("Vybrat jako vítěznou nabídku");
    const without = renderToString(<CaptureDocForm {...props} margins={false} />);
    expect(without).not.toContain("412");
    expect(without).not.toContain("Nákup / MJ");
    expect(without).toContain("počká v Nákupu");
    // DL náš: potvrzení zákazníkem
    const d5 = review.docs.find((d) => d.docId === "d5") as Extract<BatchDocReview, { kind: "business" }>;
    const dl = renderToString(<CaptureDocForm {...props} doc={d5} state={(review.initial.docs.d5 as { state: BusinessDocState }).state} margins />);
    expect(dl).toContain("Potvrzený zákazníkem");
  });
});

describe("Hotovo dávky", () => {
  it("řádky dokladů s odkazy a částečné uložení", () => {
    const html = renderToString(
      <CaptureBatchDone result={batchResult({ status: "partial" })} onJobPage={() => false} busy={false}
        onEditRetry={noop} onRetry={noop} onFileOnly={noop} onAnother={noop} onClose={noop} onLink={noop} />,
    );
    expect(html).toContain('data-testid="capture-result-headline"');
    expect(html.match(/data-testid="capture-batch-result-doc"/g)).toHaveLength(2);
    expect(html).toMatch(/data-type="objednavka_zakaznik" data-ok="true"/);
    expect(html).toMatch(/data-type="nabidka_dodavatel" data-ok="false"/);
    expect(html).toContain("Zakázka Z-2026-031");
    expect(html).toContain("Upravit a zkusit znovu");
    expect(html).toContain("Zkusit znovu");
    expect(html).toContain("Uložit jen jako soubor");
    expect(html).toContain("Dodavatele se nepodařilo založit.");
  });

  it("vše uloženo: Otevřít zakázku a Vyfotit další doklad", () => {
    const ok = batchResult({ status: "done", pending: [], docs: [batchResult().docs[0]] });
    const html = renderToString(
      <CaptureBatchDone result={ok} onJobPage={() => false} busy={false}
        onEditRetry={noop} onRetry={noop} onFileOnly={noop} onAnother={noop} onClose={noop} onLink={noop} />,
    );
    expect(html).toContain("Otevřít zakázku");
    expect(html).toContain("Vyfotit další doklad");
    expect(html).not.toContain("Upravit a zkusit znovu");
  });
});

describe("Výběr a čtení dávky", () => {
  it("dlaždice CAD / ZIP a počítadlo", () => {
    expect(pickTileKind("4711-02.STEP", "")).toBe("cad3d");
    expect(pickTileKind("plech.dxf", "")).toBe("cad2d");
    expect(pickTileKind("sada.zip", "application/zip")).toBe("zip");
    expect(pickTileKind("scan.pdf", "application/pdf")).toBe("pdf");
    expect(pickTileKind("a.jpg", "image/jpeg")).toBe("image");
    expect(pickTileKind("rozpis.xlsx", "")).toBe("other");
    expect(pickCountLabel([{ name: "a.jpg", mimeType: "image/jpeg" }])).toBe("1 stránka dokladu");
    expect(pickCountLabel([{ name: "a.jpg", mimeType: "image/jpeg" }, { name: "b.jpg", mimeType: "image/jpeg" }])).toBe("2 stránky dokladu");
    expect(pickCountLabel([{ name: "a.jpg", mimeType: "image/jpeg" }, { name: "x.step", mimeType: "" }])).toBe("1 stránka dokladu · 1 soubor CAD");
    expect(batchReadingTitle(7, 2)).toBe("Třídím 7 stránek a 2 soubory…");
    expect(batchReadingTitle(0, 1)).toBe("Třídím 1 soubor…");
  });

  it("výběr: CAD dlaždice, nápověda „Klidně vše najednou“, banner rozpracovaného focení", () => {
    const html = renderToString(
      <CapturePick
        pages={[
          { id: "a", name: "a.jpg", size: 2000, mimeType: "image/jpeg", previewUrl: "blob:a", status: "ready", error: null, ref: null },
          { id: "b", name: "4711-02_rev_B.step", size: 2000, mimeType: "application/octet-stream", previewUrl: null, status: "ready", error: null, ref: null },
        ]}
        onAddFiles={noop}
        onRemove={noop}
        onMove={noop}
        aiHint
        notice="Už je v dávce: a.jpg"
        resume={{ pages: 7 }}
        onResume={noop}
        onDiscardResume={noop}
      />,
    );
    expect(html).toContain("Klidně vše najednou — AI roztřídí");
    expect(html).toContain("STEP");
    expect(html).toContain("1 stránka dokladu · 1 soubor CAD");
    expect(html).toContain('data-testid="capture-resume"');
    expect(html).toContain("Máš rozpracované focení (7 stránek)");
    expect(html).toContain("Už je v dávce");
    expect(html).toContain("Vyfotit další (stránku nebo doklad)");
  });

  it("čtení dávky ukazuje „Třídím…“", () => {
    const html = renderToString(<CaptureReading previewUrl={null} isPdf={false} ai onCancel={noop} batch={{ mode: "batch", pages: 3, files: 1, thumbs: ["", ""] }} />);
    expect(html).toContain("Třídím 3 stránky a 1 soubor…");
  });
});
