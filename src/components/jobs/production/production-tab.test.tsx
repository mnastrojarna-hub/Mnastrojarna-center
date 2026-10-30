import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";

// Smoke test záložky „Výroba" bez Next.js: router, akce, nahrávání a oprávnění jsou nahrazené
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/orders/j1",
}));
vi.mock("@/app/actions/jobs", () => ({ updateJob: vi.fn() }));
vi.mock("@/app/actions/production", () => ({
  addJobOperations: vi.fn(), applyOperationTemplate: vi.fn(), updateJobOperation: vi.fn(), setJobOperationStatus: vi.fn(),
  advanceJobOperation: vi.fn(), moveJobOperation: vi.fn(), reorderJobOperations: vi.fn(), deleteJobOperation: vi.fn(),
  setCustomerNote: vi.fn(), confirmDeliveryNote: vi.fn(), unconfirmDeliveryNote: vi.fn(), setInvoiceInfo: vi.fn(),
  markJobPaid: vi.fn(), unmarkJobPaid: vi.fn(),
}));
vi.mock("@/lib/jobs/upload-client", () => ({ uploadJobFiles: vi.fn(), uploadJobFile: vi.fn() }));
vi.mock("@/components/access-provider", () => ({
  useAccess: () => ({ features: ["orders"], role: null, userId: "u1", can: () => false }),
}));

import { JobDetailProvider } from "@/components/jobs/detail/detail-context";
import { ProductionTab, type JobProductionData } from "./production-tab";
import { ProductionHeaderBadges } from "./production-chip";
import type { JobDetail, JobFormOptions, JobListItem } from "@/lib/jobs/types";
import type { JobClosingInfo, JobOperation } from "@/lib/jobs/production-types";
import { summarizeOperations } from "@/lib/jobs/production";

const SUP = "3f2b8c1e-1d2a-4c3b-9a8e-7f6d5c4b3a21";

function job(over: Partial<JobDetail> = {}): JobDetail {
  return {
    id: "j1", number: "Z-2026-106", title: "Razník 1.2379", stage: "ve_vyrobe", priority: "stredni",
    customer: { id: "c1", name: "StrojMetal s.r.o.", customerNumber: null, ico: null },
    customerOrderNumber: null, customerInquiryNumber: null, drawingNumbers: [], itemCount: 0, totalQuantity: 0,
    value: 48000, purchaseCost: null, currency: "CZK", inquiryDate: null, orderDate: null, customerRequiredDate: null,
    dueDate: null, expectedDeliveryDate: null, supplierPromisedDate: null, maxToleratedDate: null, receivedAt: null,
    deliveredAt: null, owner: null, assignee: null, createdBy: null, supplier: null, quoteCount: 0, fileCount: 0,
    aiFilled: false, source: "manual", createdAt: "2026-09-01T08:00:00Z", updatedAt: "2026-09-01T08:00:00Z",
    stageChangedAt: null, note: null, tags: [], technology: null, manufacturingLocation: null, specificRequirements: null,
    deliveryMethod: null, supplierOrderNumber: null, invoiceNumber: null, deliveryNoteNumber: null, customerContact: null,
    customerContactEmail: null, customerContactPhone: null, pricedBy: null, approvedBy: null, approvedAt: null,
    confirmedAt: null, productionStartedAt: null, shippedAt: null, invoicedAt: null, emailId: null, aiConfidence: null,
    acceptedQuoteId: null, margin: null, customerDetail: null, items: [], quotes: [], files: [], events: [],
    ...over,
  };
}

function op(over: Partial<JobOperation>): JobOperation {
  return {
    id: "o", jobId: "j1", position: 0, kind: "soustruzeni", title: null, label: "Soustružení", supplier: null,
    supplierName: null, inHouse: true, location: "U nás", status: "ceka", plannedStart: null, plannedEnd: null,
    startedAt: null, finishedAt: null, note: null, purchaseOrderId: null, purchaseOrderNumber: null, createdBy: null,
    createdAt: "2026-10-01T08:00:00Z", updatedAt: "2026-10-01T08:00:00Z", overdue: false, ...over,
  };
}

function closing(over: Partial<JobClosingInfo> = {}): JobClosingInfo {
  return {
    jobId: "j1", stage: "ve_vyrobe", customerNote: null, deliveryNoteConfirmedAt: null, deliveryNoteNumber: null,
    invoiceNumber: null, invoiceDate: null, invoiceDueDate: null, paymentTermsDays: 30, paidAt: null, paidAmount: null,
    overdueInvoice: false, daysToDue: null, ...over,
  };
}

function data(ops: JobOperation[], c: JobClosingInfo | null = closing()): JobProductionData {
  return { operations: ops, summary: summarizeOperations(ops), closing: c };
}

const options: JobFormOptions = { users: [], customers: [], suppliers: [{ id: SUP, name: "TepKal s.r.o." }] };
const ADMIN = { canDelete: true, margins: true, aiCapture: true };
const WORKER = { canDelete: false, margins: false, aiCapture: false };

function render(j: JobDetail, d: JobProductionData | null, perms = ADMIN): string {
  return renderToString(
    <JobDetailProvider jobId={j.id} perms={perms} options={options}>
      <ProductionTab job={j} data={d} />
    </JobDetailProvider>,
  ).replace(/<!-- -->/g, "");
}

const OPS: JobOperation[] = [
  op({ id: "a", position: 0, status: "hotovo", finishedAt: "2026-10-10T08:00:00Z", startedAt: "2026-10-08T08:00:00Z" }),
  op({
    id: "b", position: 1, kind: "tepelne_zpracovani", label: "Tepelné zpracování", status: "probiha", inHouse: false,
    supplier: { id: SUP, name: "TepKal s.r.o." }, location: "TepKal s.r.o.", plannedEnd: "2020-01-01", overdue: true,
    startedAt: "2026-10-12T08:00:00Z", note: "22. 10. 2026 08:00 · Petr: odvezeno ve čtvrtek",
  }),
  op({ id: "c", position: 2, kind: "brouseni", label: "Broušení", status: "ceka" }),
  op({ id: "d", position: 3, kind: "povrchova_uprava", label: "Černění", title: "Černění", status: "ceka", inHouse: false, supplierName: "Galvanika Zlín", location: "Galvanika Zlín" }),
];

describe("Záložka Výroba — render", () => {
  it("ve výrobě bez postupu (přesun bez předání): jen žlutý banner „Doplnit kdo a termín…“, ne druhá výzva prázdného stavu", () => {
    const html = render(job(), data([]));
    expect(html).toContain('data-testid="handoff-legacy"');
    expect(html).toContain("Doplnit kdo a termín…");
    expect(html).not.toContain("Jak se zakázka vyrobí?");
    expect(html).not.toContain("Kompletní dodávka");
    expect(html).not.toContain("Nebo poskládej sám");
    // technologie po položkách a dodání zůstávají
    expect(html).toContain("Dodání, faktura a platba");
  });

  it("mobil: celé jméno firmy na kartě kroku, „(částečný dodavatel)“ pod jménem — ne vlastní sloupec", () => {
    const html = render(job(), data(OPS));
    expect(html).toMatch(/<span class="block break-words leading-snug">TepKal s\.r\.o\.<\/span><span class="block text-\[11px\][^"]*">částečný dodavatel<\/span>/);
    expect(html).toMatch(/<span class="block break-words leading-snug">Galvanika Zlín<\/span><span class="block text-\[11px\][^"]*">částečný dodavatel · mimo adresář<\/span>/);
    expect(html).not.toContain("(částečný dodavatel)");
  });

  it("prázdný stav nabídne kompletní dodávku, šablony a dlaždice operací", () => {
    const html = render(job({ stage: "dodano_k_nam" }), data([]));
    expect(html).toContain("Jak se zakázka vyrobí?");
    expect(html).toContain("Kompletní dodávka");
    expect(html).toContain("Soustružený díl — kalený a broušený");
    expect(html).toContain("Nebo poskládej sám");
    expect(html).toContain("Drátové řezání");
    expect(html).toContain("Domluvy se zákazníkem");
    expect(html).toContain("co není v objednávce");
    expect(html).toContain("Dodání, faktura a platba");
    expect(html).toContain("Nahrát potvrzený DL");
    expect(html).toContain("Vyfotit DL");
    expect(html).toContain('capture="environment"');
    expect(html).toContain("Potvrdit bez souboru");
    expect(html).not.toContain("Průběh výroby ·");
  });

  it("Technologie položek: postup technologa / kompletně zadáno / poznámka pro dodavatele", () => {
    const item = (id: string, over: Partial<JobDetail["items"][number]>) => ({
      id, position: 0, drawingNumber: null, revision: null, name: null, description: null, material: null, quantity: 1, unit: "ks",
      unitPrice: null, purchaseUnitPrice: null, note: null, ...over,
    });
    const items = [
      item("i1", { drawingNumber: "PR-7075-20", name: "Příruba", quantity: 200, tech: { procedure: "1. soustružit\n2. kalit", complete: false, completeBy: null, supplierNote: "pozor popsat na čele" } }),
      item("i2", { drawingNumber: "PR-7075-21", name: "Pouzdro", quantity: 100, tech: { procedure: null, complete: true, completeBy: "Frézy Novák", supplierNote: null } }),
      item("i3", { drawingNumber: "PR-7075-22", name: "Kolík" }),
    ];
    const html = render(job({ items }), data(OPS));
    expect(html).toContain("Technologie položek");
    expect(html).toContain("2/3 vyplněno · 1 poznámka pro dodavatele");
    expect(html).toContain("Technologický postup (2 řádky)");
    expect(html).toContain("Bez technologie — kompletně zadáno Frézy Novák");
    expect(html).toContain("Bez postupu — doplní technolog, nebo „kompletně zadáno“");
    expect(html).toContain("pozor popsat na čele");
    expect(html).toContain("Poznámka pro dodavatele");
    expect(html).toContain("Vytiskne se do objednávky u této položky");
  });

  it("postup: kde je zakázka, pruh, metro, tlačítka, zpoždění", () => {
    const html = render(job({ files: [] }), data(OPS));
    expect(html).toContain("Teď");
    expect(html).toContain("Tepelné zpracování");
    expect(html).toContain("TepKal s.r.o.");
    // ve výrobě: hotový krok se posouvá dál dialogem (kam díl jde dál — další krok / firma / ukončení)
    expect(html).toContain("Hotovo — posunout dál…"); // velké tlačítko v souhrnu
    expect(html).toContain("Krok 2/4 · ");
    expect(html).toContain("Hotovo 1 z 4 operací");
    expect(html).toContain("Pak:");
    expect(html).toContain("Broušení (U nás)");
    // záložka „Technologie": postup kroků jako sekce „Průběh výroby"
    expect(html).toContain("Průběh výroby");
    expect(html).toContain("4 operace");
    // čekající kroky se nespouští, dokud běží jiný (najednou běží jen jeden krok)
    expect(html).not.toContain(">Začít<");
    expect(html).toContain("Galvanika Zlín");
    expect(html).toContain("mimo adresář");
    expect(html).toContain("po termínu");
    expect(html).toContain("Po termínu je 1 operace");
    expect(html).toContain("odvezeno ve čtvrtek");
    expect(html).toContain("Přidat další operaci");
    expect(html).toContain('aria-current="step"');
    expect(html).toContain("Další akce: Broušení");
  });

  it("u změn je vidět, který účet je udělal", () => {
    const events = [
      { id: "e2", type: "field" as const, message: "x", createdAt: "2026-10-12T08:00:00Z", actor: { id: "u7", name: "Dominik Šponer" }, data: { production: "status", operationId: "b", from: "ceka", to: "probiha" } },
      { id: "e1", type: "field" as const, message: "x", createdAt: "2026-10-10T08:00:00Z", actor: { id: "u8", name: "Karel Dílna" }, data: { production: "status", operationId: "a", from: "probiha", to: "hotovo" } },
      { id: "e3", type: "file" as const, message: "x", createdAt: "2026-10-20T08:00:00Z", actor: { id: "u9", name: "Eva Expedice" }, data: { production: "delivery_note", date: "2026-10-20" } },
    ];
    const ops = OPS.map((o) => (o.id === "c" ? { ...o, createdBy: { id: "u1", name: "Petra Obchodní" } } : o));
    const html = render(
      job({
        events,
        files: [{ id: "f9", kind: "dodaci_list", title: "Potvrzený dodací list", filename: "dl.jpg", mimeType: "image/jpeg", sizeBytes: 1, version: 1, archived: false, replacedBy: null, quoteId: null, uploadedBy: { id: "u9", name: "Eva Expedice" }, createdAt: "2026-10-20T08:00:00Z", aiConfidence: null, note: null, hasAiData: false }],
      }),
      data(ops, closing({ deliveryNoteConfirmedAt: "2026-10-20" })),
    );
    expect(html).toContain("Hotovo · 10. 10. 10:00 · Karel Dílna");
    expect(html).toContain("Začato · 12. 10. 10:00 · Dominik Šponer");
    expect(html).toContain("začátek: Dominik Šponer");
    expect(html).toContain("Přidal Petra Obchodní");
    expect(html).toContain("DL potvrzen · 20. 10. 10:00 · Eva Expedice");
    expect(html).toContain("Sken nahrál Eva Expedice");
  });

  it("problém je červeně nahoře i s důvodem", () => {
    const bad = OPS.map((o) => (o.id === "b" ? { ...o, status: "problem" as const, note: "22. 10. 2026 08:00 · Petr: prasklina po kalení" } : o));
    const html = render(job(), data(bad));
    expect(html).toContain("Problém: Tepelné zpracování (TepKal s.r.o.)");
    expect(html).toContain("prasklina po kalení");
    expect(html).toContain("Hotovo — posunout dál…");
  });

  it("vše hotové → výroba hotová", () => {
    const done = OPS.map((o) => ({ ...o, status: "hotovo" as const, overdue: false }));
    const html = render(job(), data(done));
    expect(html).toContain("Výroba hotová ✓");
    expect(html).not.toContain(">Začít<");
  });

  it("konec toku: DL potvrzen, faktura po splatnosti", () => {
    const html = render(
      job({ files: [{ id: "f9", kind: "dodaci_list", title: "Potvrzený dodací list", filename: "dl.jpg", mimeType: "image/jpeg", sizeBytes: 1, version: 1, archived: false, replacedBy: null, quoteId: null, uploadedBy: null, createdAt: "2026-10-20T08:00:00Z", aiConfidence: null, note: null, hasAiData: false }] }),
      data(OPS, closing({
        stage: "fakturovano", deliveryNoteConfirmedAt: "2026-10-20", deliveryNoteNumber: "DL-77", invoiceNumber: "FV-2026-042",
        invoiceDate: "2026-09-01", invoiceDueDate: "2026-10-01", overdueInvoice: true, daysToDue: -21, customerNote: "Balit po 10 ks.",
      })),
    );
    expect(html).toContain("Zákazník potvrdil převzetí 20. 10. 2026");
    expect(html).toContain("DL-77");
    expect(html).toContain("/api/jobs/files/f9");
    expect(html).toContain("FV-2026-042");
    expect(html).toContain("21 dní po splatnosti");
    expect(html).toContain("Balit po 10 ks.");
    // A2: platba = jeden dialog „Zadat platbu" (žádný druhý formulář v kartě)
    expect(html).toContain("Zadat platbu"); // platba je na řadě
    expect(html).not.toContain("Označit zaplaceno");
  });

  it("zaplaceno → zakázka dokončena; bez marží bez částky a bez rušení", () => {
    const c = closing({
      stage: "dokonceno", deliveryNoteConfirmedAt: "2026-10-20", invoiceNumber: "FV-1", invoiceDate: "2026-10-21",
      invoiceDueDate: "2026-11-20", paidAt: "2026-11-03", paidAmount: 47000,
    });
    const admin = render(job({ stage: "dokonceno" }), data([], c));
    expect(admin).toContain("Zakázka dokončena ✓");
    expect(admin).toContain("Zaplaceno 3. 11. 2026");
    expect(admin).toMatch(/47\s000\sKč/);
    // A2: hromadné „Zrušit úhradu" (mazalo i zálohy) nahradilo „Odebrat" u jednotlivé úhrady
    expect(admin).not.toContain("Zrušit úhradu");
    const worker = render(job({ stage: "dokonceno" }), data([], { ...c, paidAmount: null }), WORKER);
    expect(worker).toContain("Zakázka dokončena ✓");
    expect(worker).not.toContain("Zrušit úhradu");
    expect(worker).not.toContain("bez DPH");
  });

  it("bez dat výroby nabídne obnovení a domluvy ze zakázky", () => {
    const html = render(job({ customerNote: "Atest 3.1" }), null);
    expect(html).toContain("Výrobu se teď nepodařilo načíst");
    expect(html).toContain("Atest 3.1");
    expect(html).not.toContain("Jak se zakázka vyrobí?");
  });
});

describe("Hlavička — výroba a splatnost", () => {
  const base = job() as JobListItem;
  const html = (j: JobListItem) => renderToString(<ProductionHeaderBadges job={j} />).replace(/<!-- -->/g, "");

  it("aktuální operace, problém, po splatnosti", () => {
    const out = html({
      ...base, productionStep: "tepelne_zpracovani", productionLocation: "TepKal s.r.o.", productionDone: 1, productionTotal: 4,
      productionProblem: true, stage: "fakturovano", invoiceDueDate: "2020-01-01",
    });
    expect(out).toContain("Teď: Tepelné zpracování · TepKal s.r.o.");
    expect(out).toContain("1/4");
    expect(out).toContain("Problém ve výrobě");
    expect(out).toContain("Po splatnosti");
    expect(out).toContain('href="?tab=vyroba"');
  });

  it("hotová výroba a nenaplánovaná objednávka", () => {
    expect(html({ ...base, productionStep: "hotovo", productionDone: 3, productionTotal: 3 })).toContain("Výroba hotová");
    expect(html({ ...base, stage: "objednavka" })).toContain("Předat do výroby…");
    expect(html({ ...base, stage: "poptavka" })).toBe("");
  });
});
