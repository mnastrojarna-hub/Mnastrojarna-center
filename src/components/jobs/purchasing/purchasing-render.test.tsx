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
  importCapturedSupplierQuote: vi.fn(), setPurchaseReceived: vi.fn(), notifySuppliers: vi.fn(),
}));
vi.mock("@/app/actions/production-handoff", () => ({
  prepareProductionHandoff: vi.fn(), submitProductionHandoff: vi.fn(), ensureHandoffDocuments: vi.fn(), sendStepPurchaseOrder: vi.fn(),
  reissueStepPurchaseOrder: vi.fn(), recordPhoneQuote: vi.fn(),
}));
// otevřené dialogy (Radix portál se na serveru nevykreslí) → obsah rovnou
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open?: boolean; children: React.ReactNode }) => (open ? <div data-dialog>{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogClose: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogPortal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogOverlay: () => null,
}));
vi.mock("@/app/actions/jobs", () => ({ updateJob: vi.fn(), setJobStage: vi.fn() }));
vi.mock("@/lib/jobs/upload-client", () => ({ uploadJobFiles: vi.fn(), uploadJobFile: vi.fn() }));

import { JobDetailProvider } from "@/components/jobs/detail/detail-context";
import { PurchasingTab } from "./purchasing-tab";
import { PurchaseOrdersBoard } from "./purchase-orders-board";
import { SupplierQuotesSection } from "./supplier-quotes";
import { SupplierNoticeDialog } from "./supplier-notice-dialog";
import { SupplierQuoteDialog } from "./supplier-quote-dialog";
import { supplierQuoteFormFrom, supplierQuoteFormToInput } from "./purchasing-model";
import { maskPurchaseOrderListItem } from "@/lib/auth/price-visibility";
import type { JobDetail, JobFormOptions } from "@/lib/jobs/types";
import type {
  JobCommissionView, JobPurchasing, PurchaseOrderListItem, PurchaseOrderView, SupplierQuoteView,
} from "@/lib/jobs/purchasing-types";

const person = (id: string, name: string) => ({ id, name });
const stamp = (name: string | null, at: string) => ({
  by: name ? person(`u-${name}`, name) : null, byName: name, at, via: null, kind: name ? ("user" as const) : ("system" as const),
});
const NO_STAMPS = { created: null, status: null, sent: null, confirmed: null, delivered: null, cancelled: null, received: null };

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
  it("#25 cizí provize skrytá; obchodník zakázky jen pro čtení (mění super admin)", () => {
    const html = renderToString(
      <JobDetailProvider jobId="j1" perms={{ ...PERMS, canDelete: false, ownerEditable: false }} options={options}>
        <PurchasingTab job={job()} data={data({ commission: null, commissionHidden: true })} />
      </JobDetailProvider>,
    ).replace(/<!-- -->/g, "");
    expect(html).toContain("Provize vidí jen obchodník zakázky a super admin.");
    expect(html).not.toContain("Provize zatím nevznikla");
    expect(html).toContain('data-field="owner-readonly"');
    expect(html).toContain("Obchodníka zakázky mění jen super admin.");
    expect(html).not.toContain("Přidělit obchodníka…");
  });

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

  it("nabídky s vítězem: zelený odznak, srovnání, nejlevnější, kdo vybral (ze sloupce selected_by)", () => {
    const html = render(job(), data({
      supplierQuotes: [
        quote({ id: "q1", selected: true, selectedStamp: stamp("Vít Volný", "2026-10-03T08:00:00Z") }),
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
    expect(html).toContain("Vítězná · Vít Volný");
    expect(html).toContain("Zapsána · Admin");
    expect(html).not.toMatch(/Zadal|Vybral/);
    expect(html).toContain("Vítěz");
    expect(html).toContain("18 000 Kč");
    expect(html).toContain("marže 37,5 %");
    expect(html).toContain("odhad (plánovaný nákup)");
    expect(html).toContain("Předběžná provize");
    expect(html).toContain("1 800 Kč");
    expect(html).not.toContain("Doplň nákupní cenu");
  });

  it("objednávky dodavatelům: stav, akce dle stavu, kdo vystavil, odeslal a zrušil (ze sloupců)", () => {
    const html = render(job(), data({
      purchaseOrders: [
        order({ stamps: { ...NO_STAMPS, created: stamp("Vít Volný", "2026-10-05T09:00:00Z"), sent: stamp("Petr Obchodník", "2026-10-05T10:00:00Z") } }),
        order({
          id: "po2", number: "OV-2026-003", status: "zrusena", sentAt: null, cancelReason: "Objednáno jinde",
          stamps: { ...NO_STAMPS, created: stamp(null, "2026-10-04T09:00:00Z"), cancelled: stamp("Petr Obchodník", "2026-10-06T09:00:00Z") },
        }),
      ],
      totals: { revenue: 48_000, purchaseOrdersTotal: 30_000, plannedCost: null, cost: 30_000, costSource: "objednavky", profit: 18_000, margin: 0.375 },
      commission: commission({ status: "k_vyplate" }),
    }));
    expect(html).toContain("OV-2026-004");
    expect(html).toContain("Odeslána");
    expect(html).toContain("Zrušena");
    expect(html).toContain("Dodavatel potvrdil");
    expect(html).toContain("/api/jobs/files/f9");
    expect(html).toContain("Vystavena · V. Volný");
    expect(html).toContain("Odeslána · P. Obchodník");
    expect(html).toContain("Zrušena — Objednáno jinde · P. Obchodník");
    expect(html.replace(/<[^>]+>/g, "")).toContain("Vystavena · Systém ·"); // jméno a čas jsou zvlášť (zkracuje se jméno)
    expect(html).not.toMatch(/Vystavil|Odeslal|Zrušil/);
    expect(html).toContain("Vystavit další objednávku");
    expect(html).toContain("objednávky dodavatelům");
    expect(html).toContain("Provize k výplatě");
  });

  it("předání do výroby: objednávka ukazuje krok výroby; storno u dodavatelů; „Na co je nabídka“ (✦ AI)", () => {
    const html = renderToString(
      <JobDetailProvider jobId="j1" perms={PERMS} options={options}>
        <PurchasingTab job={job()} data={data({ purchaseOrders: [order({})] })} stepOf={{ po1: "Krok 2: Tepelné zpracování" }} />
      </JobDetailProvider>,
    );
    expect(html).toContain("Krok 2: Tepelné zpracování");
    expect(html).toContain('data-testid="po-step"');

    const notice = renderToString(
      <SupplierNoticeDialog open onOpenChange={() => {}} jobId="j1" kind="cancel"
        purchaseOrders={[
          { id: "a", number: "OV-2026-004", status: "odeslana", supplierName: "Kalírna Brno" },
          { id: "b", number: "OV-2026-005", status: "vystavena", supplierName: "Frézy Hrubý" },
          { id: "c", number: "OV-2026-006", status: "dodana", supplierName: "Frézy Hrubý" },
        ]} />,
    ).replace(/<!-- -->/g, "");
    expect(notice).toContain("Stornovat u dodavatelů");
    expect(notice).toContain("2 otevřené objednávky u dodavatelů");
    expect(notice).toContain("Dodavatel dostane e-mail: „Storno objednávky OV-2026-004");
    expect(notice).toContain("Dodavateli ještě neodešla — jen se zruší.");
    expect(notice).not.toContain("OV-2026-006");
    expect(notice).toContain("Odeslat dodavatelům");

    const dlg = renderToString(
      <JobDetailProvider jobId="j1" perms={PERMS} options={options}>
        <SupplierQuoteDialog open onOpenChange={() => {}} job={job()} quote={quote({ source: "foto", operationKinds: ["tepelne_zpracovani"] })} />
      </JobDetailProvider>,
    ).replace(/<!-- -->/g, "");
    expect(dlg).toContain("Na co je nabídka");
    expect(dlg).toContain("✦ Předvyplnila AI");
    expect(dlg).toMatch(/aria-pressed="true"[^>]*>(<svg[\s\S]*?<\/svg>)?\s*Tepelné zpracování/);
    expect(supplierQuoteFormToInput(supplierQuoteFormFrom(quote({ operationKinds: ["vyroba"] }))).operationKinds).toEqual(["vyroba"]);
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

describe("Objednávky dodavatelům — převzetí a stavy navíc", () => {
  it("potvrzená s položkami → Převzít zboží; částečně převzatá → Převzít zbytek + chip 1/2 položek; po termínu +N", () => {
    const items = [
      { id: "y1", position: 0, drawingNumber: "VL-12", name: "Vodicí lišta", material: null, quantity: 12, unit: "ks", unitPrice: 2500, note: null, receivedQuantity: 12 },
      { id: "y2", position: 1, drawingNumber: "VL-13", name: "Lišta krátká", material: null, quantity: 4, unit: "ks", unitPrice: 900, note: null, receivedQuantity: 0 },
    ];
    const html = render(job(), data({
      purchaseOrders: [
        order({ status: "potvrzena" }),
        order({
          id: "po3", number: "OV-2026-007", status: "potvrzena", requiredDate: "2020-01-01", items,
          receipt: { done: 1, total: 2, partial: true },
          stamps: { ...NO_STAMPS, received: stamp("Pavel Dílna", "2026-10-07T09:00:00Z") },
        }),
      ],
    }));
    expect(html).toContain("Převzít zboží");
    expect(html).toContain("Převzít zbytek");
    expect(html).toContain("Částečně dodaná");
    expect(html).toContain("1/2 položek");
    expect(html).toContain("Po termínu");
    expect(html).toContain("Převzato 1/2 položek · P. Dílna");
    expect(html).toContain("12/12 ks");
    expect(html).toContain("0/4 ks");
    // barvy celé (Tailwind JIT): lime částečně, rose po termínu
    expect(html).toContain("ring-lime-300");
    expect(html).toContain("ring-rose-400");
    // autor viditelný jako text na všech šířkách (žádné hidden sm:inline)
    expect(html).toContain("text-[11px]");
  });

  it("dodaná objednávka nemá primární krok ani chip částečně", () => {
    const html = render(job(), data({
      purchaseOrders: [order({ status: "dodana", receipt: { done: 1, total: 1, partial: false }, stamps: { ...NO_STAMPS, delivered: stamp("Petr Obchodník", "2026-10-08T09:00:00Z") } })],
    }));
    expect(html).toContain("Dodána k nám · P. Obchodník");
    expect(html).not.toContain("Převzít zboží");
    expect(html).not.toContain("Částečně dodaná");
  });
});

describe("Objednávky dodavatelům — přehled", () => {
  const item = (over: Partial<PurchaseOrderListItem> = {}): PurchaseOrderListItem => {
    const rest = order({ stamps: { ...NO_STAMPS, created: stamp("Vít Volný", "2026-10-05T09:00:00Z") } });
    return {
      ...rest, job: { id: "j1", number: "Z-2026-105", title: "Vodicí lišty", stage: "ve_vyrobe" }, customer: { id: "c1", name: "StrojMetal s.r.o." },
      itemCount: 1, drawingNumbers: ["VL-12"], ...over,
    };
  };
  it("dlaždice stavů, řádky, odkaz na zakázku, prázdný stav", () => {
    const html = renderToString(
      <PurchaseOrdersBoard
        items={[item(), item({ id: "po2", number: "OV-2026-005", status: "vystavena", sentAt: null, requiredDate: "2020-01-01" })]}
        today="2026-10-22"
      />,
    ).replace(/<!-- -->/g, "").replace(/[  ]/g, " ");
    expect(html).toContain("Objednávky dodavatelům");
    expect(html).toContain("K odeslání");
    expect(html).toContain("Po termínu");
    expect(html).toContain("OV-2026-005");
    expect(html).toContain("Po termínu");
    expect(html).toContain("/orders/j1?tab=nakup");
    expect(html).toContain("StrojMetal s.r.o.");
    expect(html).toContain("Poslat e-mailem");
    expect(html).toContain("Vystavena · V. Volný");
    expect(html).toContain("60 000 Kč");

    const empty = renderToString(<PurchaseOrdersBoard items={[]} today="2026-10-22" />).replace(/<!-- -->/g, "");
    expect(empty).toContain("Zatím žádná objednávka dodavateli");
  });

  it("#25 bez práva na ceny (zaměstnanec): „—“ místo částek, bez PDF / odeslání / převzetí, odkaz do Výroby, poznámka", () => {
    const masked = [item(), item({ id: "po2", number: "OV-2026-005", status: "potvrzena" })].map(maskPurchaseOrderListItem);
    const html = renderToString(<PurchaseOrdersBoard items={masked} today="2026-10-22" canSeePrices={false} />)
      .replace(/<!-- -->/g, "").replace(/[  ]/g, " ");
    expect(html).toContain("Ceny objednávek vidí obchodník a super admin.");
    expect(html).toContain("OV-2026-005");
    expect(html).not.toMatch(/\d\s?Kč/); // žádná částka (ani 0 Kč z maskovaných dat)
    expect(html).not.toContain("Poslat e-mailem");
    expect(html).not.toContain("Převzít zboží");
    expect(html).not.toContain("/api/pdf/purchase-order");
    expect(html).not.toContain("tab=nakup");
    expect(html).toContain("/orders/j1?tab=vyroba");
    expect(html).toContain("Vystavena · V. Volný");
    // místo částky tichý zámek „cena skrytá“ (ne osamělá tučná pomlčka)
    expect(html.match(/data-price-hidden/g)?.length).toBe(2);
    expect(html).toContain("cena skrytá");
    // bez výslovného údaje stačí maskovaná data
    const auto = renderToString(<PurchaseOrdersBoard items={masked} today="2026-10-22" />);
    expect(auto).toContain("Ceny objednávek vidí obchodník a super admin.");
  });
});
