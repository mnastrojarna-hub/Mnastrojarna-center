import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";

// Smoke test záložky Nákup & marže bez Next.js: router a serverové akce jsou nahrazené
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/orders/j1",
}));
vi.mock("@/app/actions/purchasing", () => ({
  createSupplierQuote: vi.fn(), updateSupplierQuote: vi.fn(), deleteSupplierQuote: vi.fn(), selectWinningSupplierQuote: vi.fn(),
  unselectSupplierQuote: vi.fn(), draftPurchaseOrder: vi.fn(), issuePurchaseOrder: vi.fn(), updatePurchaseOrder: vi.fn(),
  regeneratePurchaseOrderPdf: vi.fn(), draftPurchaseOrderEmail: vi.fn(), sendPurchaseOrder: vi.fn(), assignJobOwner: vi.fn(),
  importCapturedSupplierQuote: vi.fn(),
}));
vi.mock("@/app/actions/jobs", () => ({ updateJob: vi.fn(), setJobStage: vi.fn() }));
vi.mock("@/lib/jobs/upload-client", () => ({ uploadJobFiles: vi.fn(), uploadJobFile: vi.fn() }));

import { JobDetailProvider } from "@/components/jobs/detail/detail-context";
import { PurchasingTab } from "./purchasing-tab";
import { PurchaseOrdersBoard } from "./purchase-orders-board";
import { SupplierQuotesSection } from "./supplier-quotes";
import type { JobDetail, JobFormOptions } from "@/lib/jobs/types";
import type {
  JobCommissionView, JobPurchasing, PurchaseOrderListItem, PurchaseOrderView, SupplierQuoteView,
} from "@/lib/jobs/purchasing-types";

const person = (id: string, name: string) => ({ id, name });

function job(over: Partial<JobDetail> = {}): JobDetail {
  return {
    id: "j1", number: "Z-2026-105", title: "Vodicí lišty", stage: "potvrzeno", priority: "stredni",
    customer: { id: "c1", name: "StrojMetal s.r.o.", customerNumber: null, ico: null },
    customerOrderNumber: null, customerInquiryNumber: null, drawingNumbers: ["VL-12"], itemCount: 1, totalQuantity: 12,
    value: 48_000, purchaseCost: null, currency: "CZK", inquiryDate: null, orderDate: "2026-10-01", customerRequiredDate: null,
    dueDate: "2026-11-02", expectedDeliveryDate: null, supplierPromisedDate: null, maxToleratedDate: null, receivedAt: null,
    deliveredAt: null, owner: person("u1", "Petr Obchodník"), assignee: null, createdBy: null, supplier: null, quoteCount: 0,
    fileCount: 0, aiFilled: false, source: "manual", createdAt: "2026-10-01T08:00:00Z", updatedAt: "2026-10-20T08:00:00Z",
    stageChangedAt: null, note: null, tags: [], technology: null, manufacturingLocation: null, specificRequirements: null,
    deliveryMethod: null, supplierOrderNumber: null, invoiceNumber: null, deliveryNoteNumber: null, customerContact: null,
    customerContactEmail: null, customerContactPhone: null, pricedBy: null, approvedBy: null, approvedAt: null, confirmedAt: null,
    productionStartedAt: null, shippedAt: null, invoicedAt: null, emailId: null, aiConfidence: null, acceptedQuoteId: null,
    margin: null, customerDetail: null,
    items: [{ id: "i1", position: 0, drawingNumber: "VL-12", revision: null, name: "Vodicí lišta", description: null, material: "1.2379", quantity: 12, unit: "ks", unitPrice: 4000, purchaseUnitPrice: null, note: null }],
    quotes: [], files: [], events: [],
    ...over,
  };
}

const options: JobFormOptions = {
  users: [{ id: "u1", name: "Petr Obchodník", role: "obchodnik" }, { id: "u2", name: "Vít Volný", role: "obchodnik" }],
  customers: [],
  suppliers: [{ id: "s1", name: "Kalírna Brno" }, { id: "s2", name: "Frézy Hrubý" }],
};

const supplierRef = (id: string, name: string) => ({ id, name, email: null, phone: null, ico: null, dic: null, address: null, contactPerson: null, country: null });

function quote(over: Partial<SupplierQuoteView>): SupplierQuoteView {
  return {
    id: "q1", jobId: "j1", supplier: supplierRef("s1", "Kalírna Brno"), supplierName: "Kalírna Brno", number: "NAB-77",
    quoteDate: "2026-10-02", validUntil: "2099-12-31", leadTimeDays: 14, deliveryDate: "2026-10-25", currency: "CZK", total: 30_000,
    selected: false, note: null, fileId: null, source: "manual", createdBy: person("u0", "Admin"), createdAt: "2026-10-02T08:00:00Z",
    updatedAt: "2026-10-02T08:00:00Z",
    items: [{ id: "x1", position: 0, drawingNumber: "VL-12", name: "Vodicí lišta", material: "1.2379", quantity: 12, unit: "ks", unitPrice: 2500, note: null }],
    ...over,
  };
}

function order(over: Partial<PurchaseOrderView> = {}): PurchaseOrderView {
  return {
    id: "po1", jobId: "j1", number: "OV-2026-004", status: "odeslana", supplier: supplierRef("s1", "Kalírna Brno"),
    supplierQuote: { id: "q1", number: "NAB-77", quoteDate: "2026-10-02" }, orderDate: "2026-10-05", requiredDate: "2099-10-25",
    confirmedDate: null, currency: "CZK", total: 30_000, deliveryTerms: null, paymentTerms: null, deliveryAddress: null, note: null,
    supplierReference: null, fileId: "f9", sentAt: "2026-10-05T10:00:00Z", createdBy: person("u2", "Vít Volný"),
    createdAt: "2026-10-05T09:00:00Z", updatedAt: "2026-10-05T10:00:00Z",
    items: [{ id: "y1", position: 0, drawingNumber: "VL-12", name: "Vodicí lišta", material: null, quantity: 12, unit: "ks", unitPrice: 2500, note: null }],
    ...over,
  };
}

const commission = (over: Partial<JobCommissionView> = {}): JobCommissionView => ({
  ownerId: "u1", ownerName: "Petr Obchodník", revenue: 48_000, cost: 30_000, profit: 18_000, margin: 0.375, rate: 0.1,
  base: "margin", commission: 1_800, status: "predbezna", costKnown: true, period: "2026-10-01", updatedAt: null, ...over,
});

function data(over: Partial<JobPurchasing> = {}): JobPurchasing {
  return {
    supplierQuotes: [], purchaseOrders: [], commission: null, owner: person("u1", "Petr Obchodník"),
    totals: { revenue: 48_000, purchaseOrdersTotal: 0, plannedCost: null, cost: null, costSource: null, profit: null, margin: null },
    pendingCaptured: [],
    ...over,
  };
}

const PERMS = { canDelete: true, margins: true, aiCapture: false };

function render(j: JobDetail, d: JobPurchasing): string {
  return renderToString(
    <JobDetailProvider jobId={j.id} perms={PERMS} options={options}>
      <PurchasingTab job={j} data={d} />
    </JobDetailProvider>,
  ).replace(/<!-- -->/g, "").replace(/[  ]/g, " ");
}

describe("Nákup & marže — render", () => {
  it("bez nabídek a objednávek: nápověda, prázdné stavy, Vystavit objednávku", () => {
    const html = render(job(), data());
    expect(html).toContain("Obrat");
    expect(html).toContain("48 000 Kč");
    expect(html).toContain("Doplň nákupní cenu nebo vystav objednávku dodavateli");
    expect(html).toContain("Zatím žádná nabídka dodavatele");
    expect(html).toContain("Vystavit objednávku");
    expect(html).toContain("Zatím žádná objednávka dodavateli");
    expect(html).toContain("Provize zatím nevznikla");
    expect(html).toContain("Petr Obchodník");
  });

  it("nabídky s vítězem: zelený odznak, srovnání, nejlevnější, kdo vybral", () => {
    const j = job({
      events: [{ id: "e1", type: "quote", message: "Vybrána vítězná", data: { supplierQuoteId: "q1", action: "selected" }, actor: person("u0", "Admin"), createdAt: "2026-10-03T08:00:00Z" }],
    });
    const html = render(j, data({
      supplierQuotes: [
        quote({ id: "q1", selected: true }),
        quote({ id: "q2", supplier: supplierRef("s2", "Frézy Hrubý"), supplierName: "Frézy Hrubý", number: "H-9", total: 27_500, deliveryDate: "2026-11-05" }),
      ],
      totals: { revenue: 48_000, purchaseOrdersTotal: 0, plannedCost: 30_000, cost: 30_000, costSource: "odhad", profit: 18_000, margin: 0.375 },
      commission: commission(),
    }));
    expect(html).toContain("Vítězná");
    expect(html).toContain("Srovnání nabídek");
    expect(html).toContain("nejlevnější");
    expect(html).toContain("+2 500 Kč");
    expect(html).toContain("Vybrat jako vítěznou");
    expect(html).toContain("Zrušit výběr");
    expect(html).toContain("Vybráno jako vítězná —");
    expect(html).toContain("Zadal");
    expect(html).toContain("Vítěz");
    expect(html).toContain("18 000 Kč");
    expect(html).toContain("marže 37,5 %");
    expect(html).toContain("odhad (plánovaný nákup)");
    expect(html).toContain("Předběžná provize");
    expect(html).toContain("1 800 Kč");
    expect(html).not.toContain("Doplň nákupní cenu");
  });

  it("objednávky dodavatelům: stav, akce dle stavu, kdo vystavil a odeslal", () => {
    const j = job({
      events: [
        { id: "e1", type: "field", message: "Vystavena", data: { purchaseOrderId: "po1", number: "OV-2026-004", itemCount: 1 }, actor: person("u2", "Vít Volný"), createdAt: "2026-10-05T09:00:00Z" },
        { id: "e2", type: "email", message: "Odesláno", data: { purchaseOrderId: "po1" }, actor: person("u1", "Petr Obchodník"), createdAt: "2026-10-05T10:00:00Z" },
      ],
    });
    const html = render(j, data({
      purchaseOrders: [order(), order({ id: "po2", number: "OV-2026-003", status: "zrusena", sentAt: null })],
      totals: { revenue: 48_000, purchaseOrdersTotal: 30_000, plannedCost: null, cost: 30_000, costSource: "objednavky", profit: 18_000, margin: 0.375 },
      commission: commission({ status: "k_vyplate" }),
    }));
    expect(html).toContain("OV-2026-004");
    expect(html).toContain("Odeslána");
    expect(html).toContain("Zrušena");
    expect(html).toContain("Dodavatel potvrdil");
    expect(html).toContain("/api/jobs/files/f9");
    expect(html).toContain("Vystavil");
    expect(html).toContain("Vít Volný");
    expect(html).toContain("Odeslal dodavateli");
    expect(html).toContain("Vystavit další objednávku");
    expect(html).toContain("objednávky dodavatelům");
    expect(html).toContain("Provize k výplatě");
  });

  it("pásmová provize z inkasa: předběžný odhad", () => {
    const html = render(job(), data({
      totals: { revenue: 48_000, purchaseOrdersTotal: 30_000, plannedCost: null, cost: 30_000, costSource: "objednavky", profit: 18_000, margin: 0.375 },
      commission: commission({ base: "margin_tiered", rate: 0, commission: 0, estimatedCommission: 1_800, collected: false }),
    }));
    expect(html).toContain("Pásmová provize z inkasa · předběžná");
    expect(html).toContain("odhad 1 800 Kč");
  });

  it("ztráta: červený zisk", () => {
    const html = render(job({ value: 20_000 }), data({
      totals: { revenue: 20_000, purchaseOrdersTotal: 30_000, plannedCost: null, cost: 30_000, costSource: "objednavky", profit: -10_000, margin: -0.5 },
    }));
    expect(html).toContain("-10 000 Kč");
    expect(html).toContain("bg-red-600");
  });
});

describe("Nabídky z focení čekající na Nákup", () => {
  const pending = [{ fileId: "f7", title: "Nabídka dodavatele NAB-552", supplierName: "Kovoobrábění Hrubý", createdAt: "2026-10-22T08:00:00Z" }];
  const section = (quotes: SupplierQuoteView[]) => renderToString(
    <JobDetailProvider jobId="j1" perms={PERMS} options={options}>
      <SupplierQuotesSection quotes={quotes} today="2026-10-22" onAdd={() => {}} onEdit={() => {}} pendingCaptured={pending} />
    </JobDetailProvider>,
  ).replace(/<!-- -->/g, "");

  it("pruh s tlačítkem Zapsat i bez zapsaných nabídek", () => {
    const html = section([]);
    expect(html).toContain("Nabídky z focení čekají na zapsání (1)");
    expect(html).toContain("Kovoobrábění Hrubý");
    expect(html).toContain("Zapsat");
    expect(html).toContain("/api/jobs/files/f7");
    expect(html).toContain("Zatím žádná nabídka dodavatele");
  });

  it("pruh nad zapsanými nabídkami; bez čekajících se neukáže", () => {
    expect(section([quote({ id: "q1" })])).toContain("Nabídky z focení čekají na zapsání");
    const none = renderToString(
      <JobDetailProvider jobId="j1" perms={PERMS} options={options}>
        <SupplierQuotesSection quotes={[quote({ id: "q1" })]} today="2026-10-22" onAdd={() => {}} onEdit={() => {}} />
      </JobDetailProvider>,
    );
    expect(none).not.toContain("Nabídky z focení");
  });
});

describe("Objednávky dodavatelům — přehled", () => {
  const item = (over: Partial<PurchaseOrderListItem> = {}): PurchaseOrderListItem => {
    const { items: _items, ...rest } = order();
    void _items;
    return {
      ...rest, job: { id: "j1", number: "Z-2026-105", title: "Vodicí lišty", stage: "ve_vyrobe" }, customer: { id: "c1", name: "StrojMetal s.r.o." },
      itemCount: 1, drawingNumbers: ["VL-12"], ...over,
    };
  };
  it("dlaždice stavů, řádky, odkaz na zakázku, prázdný stav", () => {
    const html = renderToString(
      <PurchaseOrdersBoard
        items={[item(), item({ id: "po2", number: "OV-2026-005", status: "vystavena", sentAt: null, requiredDate: "2020-01-01" })]}
        events={[{ type: "field", data: { purchaseOrderId: "po1", number: "OV-2026-004" }, actor: { name: "Vít Volný" }, createdAt: "2026-10-05T09:00:00Z" }]}
        today="2026-10-22"
      />,
    ).replace(/<!-- -->/g, "").replace(/[  ]/g, " ");
    expect(html).toContain("Objednávky dodavatelům");
    expect(html).toContain("K odeslání");
    expect(html).toContain("Po termínu");
    expect(html).toContain("OV-2026-005");
    expect(html).toContain("po termínu");
    expect(html).toContain("/orders/j1?tab=nakup");
    expect(html).toContain("StrojMetal s.r.o.");
    expect(html).toContain("Poslat e-mailem");
    expect(html).toContain("Vystavil");
    expect(html).toContain("60 000 Kč");

    const empty = renderToString(<PurchaseOrdersBoard items={[]} events={[]} today="2026-10-22" />).replace(/<!-- -->/g, "");
    expect(empty).toContain("Zatím žádná objednávka dodavateli");
  });
});
