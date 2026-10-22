import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";

// Smoke test karty zakázky bez Next.js: router, akce a nahrávání jsou nahrazené
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/orders/j1",
}));
vi.mock("@/app/actions/jobs", () => ({
  updateJob: vi.fn(), setJobStage: vi.fn(), deleteJob: vi.fn(), saveJobItems: vi.fn(), addJobComment: vi.fn(),
  createJobQuote: vi.fn(), updateJobQuote: vi.fn(), approveJobQuote: vi.fn(), markJobQuoteSent: vi.fn(),
  acceptJobQuote: vi.fn(), rejectJobQuote: vi.fn(), newJobQuoteRevision: vi.fn(), setJobQuoteArchived: vi.fn(),
  deleteJobQuote: vi.fn(),
}));
vi.mock("@/app/actions/job-files", () => ({
  setJobFileArchived: vi.fn(), updateJobFile: vi.fn(), deleteJobFile: vi.fn(), createJobFileUpload: vi.fn(), registerJobFile: vi.fn(),
}));
vi.mock("@/app/actions/job-documents", () => ({
  generateJobDocument: vi.fn(), sendJobDocument: vi.fn(), draftJobDocumentEmail: vi.fn(),
}));
vi.mock("@/lib/jobs/upload-client", () => ({ uploadJobFiles: vi.fn(), uploadJobFile: vi.fn() }));
vi.mock("@/components/jobs/capture/capture-button", () => ({
  CaptureButton: ({ label }: { label?: string }) => <button type="button">{label ?? "Vyfotit doklad"}</button>,
}));

import { JobDetailView } from "./job-detail-view";
import type { JobDetail, JobFormOptions } from "@/lib/jobs/types";

const person = (id: string, name: string) => ({ id, name });

function fixture(over: Partial<JobDetail> = {}): JobDetail {
  return {
    id: "j1", number: "Z-2026-105", title: "Vodicí lišty 1.2379 — 12 ks", stage: "ve_vyrobe", priority: "vysoka",
    customer: { id: "c1", name: "StrojMetal s.r.o.", customerNumber: "Z-0042", ico: "12345678" },
    customerOrderNumber: "PO-4500123", customerInquiryNumber: "RFQ-77", drawingNumbers: ["VL-12"], itemCount: 1,
    totalQuantity: 12, value: 48000, purchaseCost: 30000, currency: "CZK",
    inquiryDate: "2026-09-01", orderDate: "2026-09-10", customerRequiredDate: "2026-10-30", dueDate: "2026-11-02",
    expectedDeliveryDate: "2026-11-05", supplierPromisedDate: "2026-11-04", maxToleratedDate: "2026-11-10",
    receivedAt: null, deliveredAt: null,
    owner: person("u1", "Petra Obchodní"), assignee: person("u2", "Karel Dílna"), createdBy: person("u1", "Petra Obchodní"),
    supplier: { id: "s1", name: "Kalírna Brno" }, quoteCount: 2, fileCount: 2, aiFilled: true, source: "foto",
    createdAt: "2026-09-01T08:00:00Z", updatedAt: "2026-10-20T08:00:00Z", stageChangedAt: "2026-10-01T08:00:00Z",
    note: "Pozor na kalení.", tags: ["expres"], technology: "frézování", manufacturingLocation: "u dodavatele",
    specificRequirements: null, deliveryMethod: "naše doprava", supplierOrderNumber: "OBJ-2026-9", invoiceNumber: null,
    deliveryNoteNumber: null, customerContact: "Jan Dvořák", customerContactEmail: "dvorak@strojmetal.cz",
    customerContactPhone: "+420 777 111 222", pricedBy: person("u1", "Petra Obchodní"), approvedBy: person("u0", "Admin"),
    approvedAt: "2026-09-05T08:00:00Z", confirmedAt: "2026-09-11T08:00:00Z", productionStartedAt: "2026-10-01T08:00:00Z",
    shippedAt: null, invoicedAt: null, emailId: null, aiConfidence: 0.91, acceptedQuoteId: "q2", margin: 0.375,
    customerDetail: {
      id: "c1", name: "StrojMetal s.r.o.", customerNumber: "Z-0042", supplierNumberAtCustomer: null, ico: "12345678",
      dic: "CZ12345678", street: "Průmyslová 1", city: "Brno", zip: "60200", country: "CZ", email: "info@strojmetal.cz",
      phone: null, contactPerson: "Jan Dvořák", deliveryAddress: null, paymentTermsDays: 30,
    },
    items: [{
      id: "i1", position: 0, drawingNumber: "VL-12", revision: "B", name: "Vodicí lišta", description: "kaleno 58 HRC",
      material: "1.2379", quantity: 12, unit: "ks", unitPrice: 4000, purchaseUnitPrice: 2500, note: null,
    }],
    quotes: [
      {
        id: "q2", number: "NAB-2026-007-2", revision: 2, title: null, status: "prijato", total: 48000, currency: "CZK",
        validUntil: "2026-10-05", leadTimeDays: 30, deliveryTerms: null, paymentTerms: null, note: null,
        createdBy: person("u1", "Petra Obchodní"), approvedBy: person("u0", "Admin"), approvedAt: "2026-09-05T08:00:00Z",
        sentAt: "2026-09-05T09:00:00Z", createdAt: "2026-09-05T07:00:00Z", archived: false, aiGenerated: false, accepted: true,
        items: [{ id: "qi1", position: 0, drawingNumber: "VL-12", name: "Vodicí lišta", description: null, material: "1.2379", quantity: 12, unit: "ks", unitPrice: 4000, vatRate: 21, purchaseUnitPrice: null, note: null }],
      },
      {
        id: "q1", number: "NAB-2026-007", revision: 1, title: null, status: "ke_schvaleni", total: 52000, currency: "CZK",
        validUntil: null, leadTimeDays: null, deliveryTerms: null, paymentTerms: null, note: null,
        createdBy: person("u1", "Petra Obchodní"), approvedBy: null, approvedAt: null, sentAt: null,
        createdAt: "2026-09-03T07:00:00Z", archived: true, aiGenerated: true, accepted: false, items: [],
      },
    ],
    files: [
      {
        id: "f2", kind: "objednavka", title: null, filename: "objednavka.jpg", mimeType: "image/jpeg", sizeBytes: 300000,
        version: 2, archived: false, replacedBy: null, quoteId: null, uploadedBy: person("u1", "Petra Obchodní"),
        createdAt: "2026-09-10T08:00:00Z", aiConfidence: 0.9, note: null, hasAiData: true,
      },
      {
        id: "f1", kind: "objednavka", title: null, filename: "objednavka.jpg", mimeType: "image/jpeg", sizeBytes: 900000,
        version: 1, archived: true, replacedBy: "f2", quoteId: null, uploadedBy: null,
        createdAt: "2026-09-09T08:00:00Z", aiConfidence: null, note: null, hasAiData: false,
      },
    ],
    events: [
      { id: "e3", type: "comment", message: "Dodavatel hlásí zpoždění.", data: {}, actor: person("u2", "Karel Dílna"), createdAt: "2026-10-20T08:00:00Z" },
      { id: "e2", type: "stage", message: "Stav: Potvrzeno → Ve výrobě", data: { from: "potvrzeno", to: "ve_vyrobe" }, actor: person("u1", "Petra Obchodní"), createdAt: "2026-10-01T08:00:00Z" },
      {
        id: "e1", type: "field", message: "Upraveno 2 polí", actor: person("u1", "Petra Obchodní"), createdAt: "2026-09-12T08:00:00Z",
        data: { changes: [
          { field: "due_date", label: "Potvrzený termín zákazníkovi", fromText: "—", toText: "2. 11. 2026" },
          { field: "purchase_cost", label: "Nákupní náklady", sensitive: true },
        ] },
      },
    ],
    ...over,
  };
}

const options: JobFormOptions = {
  users: [{ id: "u1", name: "Petra Obchodní", role: "obchodnik" }, { id: "u2", name: "Karel Dílna", role: "zamestnanec" }],
  customers: [{ id: "c1", name: "StrojMetal s.r.o.", customerNumber: "Z-0042", ico: "12345678" }],
  suppliers: [{ id: "s1", name: "Kalírna Brno" }],
};

const ADMIN = { canDelete: true, margins: true, aiCapture: true };
const WORKER = { canDelete: false, margins: false, aiCapture: false };

function render(job: JobDetail, perms = ADMIN, tab?: string): string {
  return renderToString(<JobDetailView job={job} options={options} perms={perms} initialTab={tab} />).replace(/<!-- -->/g, "");
}

describe("Karta zakázky — render", () => {
  it("hlavička, osa, termíny a přehled", () => {
    const html = render(fixture());
    expect(html).toContain("Z-2026-105");
    expect(html).toContain("Vodicí lišty 1.2379 — 12 ks");
    expect(html).toContain("StrojMetal s.r.o.");
    expect(html).toContain("zák. č. Z-0042");
    expect(html).toContain("Přidat doklad (foto)");
    expect(html).toContain("Nahrát soubory");
    expect(html).toContain("Doklady");
    expect(html).toContain("Vyplnila AI");
    expect(html).toContain("Z fotky dokladu");
    expect(html).toContain("Průběh zakázky");
    expect(html).toContain('aria-current="step"');
    expect(html).toContain("Termíny");
    expect(html).toContain("Dodavatel slíbil 4. 11. 2026"); // varování: dodavatel později než termín
    expect(html).toContain("Zákazník &amp; kontakt");
    expect(html).toContain("dvorak@strojmetal.cz");
    expect(html).toContain("Nákupní náklady");
    expect(html).toContain("37,5 %");
    expect(html).toContain("expres");
    expect(html).toContain("Další akce"); // menu se smazáním
  });

  it("zaměstnanec bez marží a bez mazání", () => {
    const html = render(fixture({ purchaseCost: null, margin: null }), WORKER);
    expect(html).not.toContain("Nákupní náklady");
    expect(html).not.toContain("Marže");
    expect(html).not.toContain("Další akce");
  });

  it("speciální stav = stuha nad osou", () => {
    const html = render(fixture({ stage: "pozastaveno" }));
    expect(html).toContain("Zakázka stojí");
    expect(html).not.toContain('aria-current="step"');
  });

  it("záložka Položky", () => {
    const html = render(fixture(), ADMIN, "polozky");
    expect(html).toContain("VL-12");
    expect(html).toContain("Nákup / MJ");
    expect(html).toContain("Přidat položku");
  });

  it("záložka Nabídky: přijatá nahoře, starší verze schované", () => {
    const html = render(fixture(), ADMIN, "nabidky");
    expect(html).toContain("NAB-2026-007-2");
    expect(html).toContain("Přijatá — platí pro zakázku");
    expect(html).toContain("Starší verze (1)");
    expect(html).toContain("PDF náhled");
    expect(html).toContain("/api/pdf/job/j1?type=nabidka&amp;quoteId=q2");
  });

  it("záložka Nabídky: prázdný stav vysvětlí, co dělat", () => {
    const html = render(fixture({ quotes: [] }), ADMIN, "nabidky");
    expect(html).toContain("Zatím žádná nabídka");
    expect(html).toContain("Vytvořit nabídku z 1 položky");
  });

  it("záložka Dokumenty: skupiny, verze, archiv", () => {
    const html = render(fixture(), ADMIN, "dokumenty");
    expect(html).toContain("Objednávka");
    expect(html).toContain("v2");
    expect(html).toContain("/api/jobs/files/f2");
    expect(html).toContain("Zobrazit archiv (1)");
    expect(html).toContain("Přetáhni sem soubory");
  });

  it("záložka Historie: komentář, změna stavu, změny polí", () => {
    const html = render(fixture(), WORKER, "historie");
    expect(html).toContain("Dodavatel hlásí zpoždění.");
    expect(html).toContain("Ve výrobě");
    expect(html).toContain("Potvrzený termín zákazníkovi:");
    expect(html).toContain("2. 11. 2026");
    expect(html).toContain("upraveno");
    expect(html).toContain("Přidat komentář");
  });

  it("prázdná zakázka bez zákazníka a položek", () => {
    const html = render(fixture({
      customer: null, customerDetail: null, items: [], quotes: [], files: [], events: [], value: null, aiFilled: false,
      source: "manual", stage: "poptavka", dueDate: null, customerRequiredDate: null, expectedDeliveryDate: null,
      supplierPromisedDate: null, maxToleratedDate: null,
    }));
    expect(html).toContain("Bez zákazníka");
    expect(html).toContain("nenaceněno");
    expect(html).toContain("Zatím bez termínu");
    expect(html).not.toContain("Vyplnila AI");
  });
});
