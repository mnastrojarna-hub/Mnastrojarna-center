import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { renderToString as renderSsr } from "react-dom/server";

// Smoke test vykreslení „Vyfotit doklad" bez Next.js (router, oprávnění a akce nahrazené)
const accessState: { features: string[] } = { features: ["orders", "ai_capture", "margins"] };

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/orders",
}));
vi.mock("@/components/access-provider", () => ({
  useAccess: () => ({ features: accessState.features, role: null, userId: "u1", can: (f: string) => accessState.features.includes(f) }),
}));
vi.mock("@/app/actions/capture", () => ({ createCaptureUpload: vi.fn(), discardCapture: vi.fn() }));
vi.mock("@/app/actions/job-files", () => ({ createJobFileUpload: vi.fn(), registerJobFile: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));

import { CaptureButton } from "./capture-button";
import { CapturePick } from "./capture-pick";
import { CaptureReading } from "./capture-reading";
import { CaptureReviewForm } from "./capture-review-form";
import { CapturePages } from "./capture-pages";
import { CaptureDone } from "./capture-done";
import { docFieldValues, planJobUpdate, planNewJob } from "@/lib/jobs/apply-extraction";
import { normalizeExtracted, emptyExtracted } from "@/lib/jobs/extracted-normalize";
import {
  buildExistingTarget, buildNewTarget, initialReviewState, type ReviewModel, type ReviewTarget, type TargetJob,
} from "@/lib/jobs/capture-review";
import objednavkaFixture from "@/lib/jobs/__fixtures__/capture/objednavka-strojmetal.json";
import dodaciListFixture from "@/lib/jobs/__fixtures__/capture/dodaci-list-dodavatel.json";

const PO = normalizeExtracted(objednavkaFixture);
const DL = normalizeExtracted(dodaciListFixture);
const JOB_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function job(over: Partial<TargetJob> = {}): TargetJob {
  return {
    id: JOB_ID, number: "Z-2026-101", stage: "nabidka", title: "Upínky VK-2291",
    customer: { id: "c1", name: "Strojmetal a.s.", customerNumber: "ZAK-0001", ico: "45274649" },
    customerOrderNumber: null, customerInquiryNumber: "RFQ-77",
    customerContact: null, customerContactEmail: null, customerContactPhone: null,
    inquiryDate: "2026-09-01", orderDate: null, customerRequiredDate: "2026-12-15", dueDate: null,
    expectedDeliveryDate: null, supplierPromisedDate: null, value: null,
    items: [{ id: "99999999-8888-4777-8666-555555555555", position: 0, drawingNumber: "VK-2291", revision: "B", name: "Upínka", description: null, material: null, quantity: 50, unit: "ks", unitPrice: null, purchaseUnitPrice: null, note: null }],
    supplier: null, supplierOrderNumber: null, invoiceNumber: null, deliveryNoteNumber: null, currency: "CZK",
    ...over,
  };
}

function poModel(over: Partial<ReviewModel> = {}, targetIndex = 0): ReviewModel {
  const j = job();
  const ex = buildExistingTarget({ job: j, plan: planJobUpdate(j, PO), docValues: docFieldValues(PO), reason: "stejný zákazník a výkres VK-2291", score: 65, margins: true });
  const nw = buildNewTarget({ plan: planNewJob(PO), margins: true, docKind: PO.docKind, issuer: PO.issuer });
  const targets: ReviewTarget[] = [ex, nw];
  const customerMatch = { id: "c1", name: "Strojmetal a.s.", reason: "podle IČO 45274649", score: 100 };
  return {
    captureId: "cap", aiUsed: true, reason: null, docKind: PO.docKind, issuer: PO.issuer, chipExact: true,
    documentNumber: PO.documentNumber, confidence: 0.93, summary: PO.summary, needsClarification: ["Ověř termín KW 48"],
    docCustomer: PO.customer, docSupplier: PO.supplier, customerMatch, supplierMatch: null, fixedJobId: null,
    targets, margins: true, mode: "approval",
    previews: [{ path: "capture/u/x-a.jpg", filename: "a.jpg", mimeType: "image/jpeg", size: 100, url: "https://x/a.jpg" }],
    options: {
      customers: [{ id: "c1", name: "Strojmetal a.s.", customerNumber: "ZAK-0001", ico: "45274649" }],
      suppliers: [{ id: "s1", name: "Kovoobrábění Hrubý s.r.o." }],
      jobs: [{ id: JOB_ID, number: "Z-2026-101", title: "Upínky", customerName: "Strojmetal a.s.", stage: "nabidka" }],
    },
    initial: initialReviewState({
      docKind: PO.docKind, issuer: PO.issuer, target: targets[targetIndex], customerMatch, supplierMatch: null,
      docCustomer: PO.customer, docSupplier: PO.supplier, docNote: PO.note,
    }),
    ...over,
  };
}

const noop = () => {};
/** SSR vkládá mezi textové uzly <!-- --> — pro hledání textu pryč. */
function renderToString(node: React.ReactElement): string {
  return renderSsr(node).replace(/<!-- -->/g, "");
}

describe("Vyfotit doklad — vykreslení", () => {
  it("tlačítko: s popiskem i jen ikona", () => {
    expect(renderToString(<CaptureButton />)).toContain("Vyfotit doklad");
    const icon = renderToString(<CaptureButton jobId={JOB_ID} label="" size="icon-sm" />);
    expect(icon).toContain('aria-label="Vyfotit doklad k zakázce"');
  });

  it("krok 1: prázdný výběr a stránky", () => {
    const empty = renderToString(<CapturePick pages={[]} onAddFiles={noop} onRemove={noop} onMove={noop} aiHint />);
    expect(empty).toContain("Vyfoť doklad");
    expect(empty).toContain("Vybrat soubory");
    expect(empty).toContain('capture="environment"');
    const manual = renderToString(<CapturePick pages={[]} onAddFiles={noop} onRemove={noop} onMove={noop} aiHint={false} />);
    expect(manual).toContain("vyplníš pár údajů");
    const pages = renderToString(
      <CapturePick
        pages={[
          { id: "a", name: "a.jpg", size: 2_400_000, mimeType: "image/jpeg", previewUrl: "blob:a", status: "ready", error: null, ref: null },
          { id: "b", name: "b.pdf", size: 1000, mimeType: "application/pdf", previewUrl: "blob:b", status: "uploading", error: null, ref: null },
          { id: "c", name: "c.jpg", size: 1000, mimeType: "image/jpeg", previewUrl: null, status: "error", error: "Nahrání selhalo", ref: null },
        ]}
        onAddFiles={noop} onRemove={noop} onMove={noop} aiHint
      />,
    );
    expect(pages).toContain("3 stránky");
    expect(pages).toContain("Nahrávám");
    expect(pages).toContain("Nahrání selhalo");
    expect(pages).toContain("Vyfotit další (stránku nebo doklad)");
  });

  it("krok 2: AI čte / ruční příprava", () => {
    expect(renderToString(<CaptureReading previewUrl="blob:a" isPdf={false} ai onCancel={noop} />)).toContain("AI čte doklad");
    expect(renderToString(<CaptureReading previewUrl={null} isPdf ai={false} onCancel={noop} />)).toContain("Připravuji formulář");
  });

  it("krok 3: návrh AI pro existující zakázku (zamčená pole, upozornění, doplnění položek)", () => {
    const m = poModel();
    const html = renderToString(<CaptureReviewForm model={m} review={m.initial} targets={m.targets} onChange={noop} onPickJob={noop} pickingJob={false} />);
    for (const t of [
      "AI přečetla doklad", "Ověř termín KW 48", "Objednávka zákazníka", "Z-2026-101", "stejný zákazník a výkres VK-2291",
      "Založit novou zakázku", "Strojmetal a.s.", "už v zakázce", "4795-2026", "Doplnit k položce", "VK-2292",
      "Nabídka odeslaná", "Uložit fotku jako", "Na dokladu je 27. 11. 2026",
    ]) expect(html, t).toContain(t);
  });

  it("krok 3: nová zakázka s novým zákazníkem a dodavatelský doklad", () => {
    const m = poModel({}, 1);
    const review = { ...m.initial, customer: { mode: "new" as const, party: PO.customer } };
    const html = renderToString(<CaptureReviewForm model={m} review={review} targets={m.targets} onChange={noop} onPickJob={noop} pickingJob={false} />);
    expect(html).toContain("Založí se nový zákazník");
    expect(html).toContain("Kladno");
    expect(html).toContain("VK-2291");

    const dlNew = buildNewTarget({ plan: planNewJob(DL), margins: false, docKind: DL.docKind, issuer: DL.issuer });
    const dlModel: ReviewModel = {
      ...m, docKind: DL.docKind, issuer: DL.issuer, docCustomer: DL.customer, docSupplier: DL.supplier, margins: false,
      supplierMatch: { id: "s1", name: "Kovoobrábění Hrubý s.r.o.", reason: "podle IČO 25874411", score: 100 }, targets: [dlNew],
      initial: initialReviewState({
        docKind: DL.docKind, issuer: DL.issuer, target: dlNew, customerMatch: null,
        supplierMatch: { id: "s1", name: "Kovoobrábění Hrubý s.r.o.", reason: "podle IČO 25874411", score: 100 },
        docCustomer: DL.customer, docSupplier: DL.supplier,
      }),
    };
    const dl = renderToString(<CaptureReviewForm model={dlModel} review={dlModel.initial} targets={dlModel.targets} onChange={noop} onPickJob={noop} pickingJob={false} />);
    expect(dl).toContain("Dodavatel");
    expect(dl).toContain("Kovoobrábění Hrubý s.r.o.");
    expect(dl).toContain("Číslo objednávky u dodavatele");
    expect(dl).not.toContain("Nákup / MJ"); // bez práva na marže
  });

  it("krok 3: ruční vyplnění bez AI", () => {
    const empty = emptyExtracted();
    const t = buildNewTarget({ plan: null, margins: true, docKind: empty.docKind, issuer: empty.issuer });
    const m: ReviewModel = {
      ...poModel(), aiUsed: false, confidence: null, summary: "", needsClarification: [], customerMatch: null,
      reason: "Nemáš povolené AI čtení dokladů — vyplň údaje ručně podle fotky. AI se z tvého vyplnění učí.",
      docCustomer: empty.customer, docSupplier: empty.supplier, docKind: "ostatni", issuer: "neznamy", targets: [t],
      initial: initialReviewState({ docKind: "ostatni", issuer: "neznamy", target: t, customerMatch: null, supplierMatch: null, docCustomer: empty.customer, docSupplier: empty.supplier }),
    };
    const html = renderToString(<CaptureReviewForm model={m} review={m.initial} targets={m.targets} onChange={noop} onPickJob={noop} pickingJob={false} />);
    expect(html).toContain("Nemáš povolené AI");
    expect(html).toContain("Vyber druh dokladu");
    expect(html).toContain("Bez zákazníka");
    expect(html).not.toContain("AI přečetla doklad");
  });

  it("náhled stránek a výsledek", () => {
    const pages = renderToString(<CapturePages pages={[
      { key: "a", url: "blob:a", mimeType: "image/jpeg", name: "a.jpg" },
      { key: "b", url: "blob:b", mimeType: "application/pdf", name: "b.pdf" },
    ]} />);
    expect(pages).toContain("1 / 2");
    expect(pages).toContain("Další stránka");

    const done = renderToString(<CaptureDone
      result={{
        ok: true, created: false, aiUsed: true, jobId: JOB_ID, jobNumber: "Z-2026-101", docLabel: "Objednávka zákazníka",
        stageFrom: "nabidka", stageTo: "objednavka", filled: ["Číslo objednávky zákazníka"], itemsAdded: 1, itemsMerged: 1,
        fileKind: "objednavka", warnings: ["Stránku x.jpg se nepodařilo přiložit."], autoApplied: true,
      }}
      onJobPage={false} onAnother={noop} onClose={noop}
    />);
    expect(done).toContain("Uloženo do zakázky Z-2026-101 · Objednávka zákazníka · stav Objednávka");
    expect(done).toContain("plná automatika");
    expect(done).toContain("Upravit v zakázce");
    expect(done).toContain("Vyfotit další doklad");
    expect(done).toContain("se nepodařilo přiložit");
  });
});
