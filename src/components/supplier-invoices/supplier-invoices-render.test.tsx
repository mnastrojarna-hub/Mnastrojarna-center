import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { renderToString as renderSsr } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/supplier-invoices",
}));
vi.mock("@/app/actions/supplier-invoices", () => ({
  saveSupplierInvoiceAllocations: vi.fn(), confirmSupplierInvoiceAi: vi.fn(), setSupplierInvoicePayment: vi.fn(), updateSupplierInvoiceHeader: vi.fn(),
  saveSupplierInvoiceItems: vi.fn(), supplierFromInvoiceHeader: vi.fn(), markSupplierInvoiceNotDuplicate: vi.fn(), setSupplierInvoiceRejected: vi.fn(),
  deleteSupplierInvoice: vi.fn(), searchJobsForSupplierInvoice: vi.fn(async () => ({ ok: true, jobs: [] })), orderItemsForSupplierInvoice: vi.fn(),
  jobSupplierInvoices: vi.fn(), setSupplierInvoiceVisibility: vi.fn(), fillSupplierInvoiceRate: vi.fn(), setSupplierInvoiceFinalPo: vi.fn(),
}));
vi.mock("@/app/actions/capture", () => ({ createCaptureUpload: vi.fn(), discardCapture: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));

import { InvoiceList } from "./invoice-list";
import { InvoiceDetailView } from "./invoice-detail";
import { InvoiceUploader } from "./invoice-uploader";
import { CaptureSupplierInvoices } from "@/components/jobs/capture/capture-supplier-invoices";
import type { SupplierInvoiceDetail, SupplierInvoiceListItem, SupplierInvoicePerms } from "@/lib/supplier-invoices/types";
import type { BatchReviewModel, BatchSortModel } from "@/lib/jobs/capture-batch-types";

const html = (n: React.ReactElement) => renderSsr(n).replace(/<!-- -->/g, "");
const ADMIN: SupplierInvoicePerms = { upload: true, view: true, amounts: true, edit: true, paid: true };
// režim „všichni vidí": obchodník vidí i částky, ale neupravuje (edit jen super admin)
const SALES_ALL: SupplierInvoicePerms = { upload: true, view: true, amounts: true, edit: false, paid: false };
const WORKER_ALL: SupplierInvoicePerms = { upload: true, view: true, amounts: false, edit: false, paid: false };

const item: SupplierInvoiceListItem = {
  id: "inv1", number: "FA-2026-0815", supplierId: "s1", supplierName: "Kovoobrábění Hrubý s.r.o.", issueDate: "2026-10-15", dueDate: "2026-10-20",
  currency: "CZK", totalNet: 31_000, totalGross: 37_510, status: "ke_kontrole", paymentStatus: "nezaplaceno", paidAt: null, paidAmount: null, overdue: true,
  unallocated: 1_000, isProforma: false, missingRate: false, pendingAi: 2, jobs: [{ id: "j1", number: "Z-2026-101" }], hasOverhead: true, duplicateOfId: null, source: "photo",
  uploadedByName: "Dílna", createdAt: "2026-10-29T10:00:00Z", fileCount: 1,
};
const TOTALS = { count: 1, net: 31_000, gross: 37_510, unpaid: 37_510, overdue: 37_510, unallocated: 1_000, foreign: [] };

function detail(perms: SupplierInvoicePerms): SupplierInvoiceDetail {
  return {
    id: "inv1", number: "FA-2026-0815", variableSymbol: "20260815", issueDate: "2026-10-15", taxableDate: "2026-10-15", dueDate: "2026-11-14",
    currency: "CZK", exchangeRate: null, totalNet: 31_000, totalVat: 6_510, totalGross: 37_510, status: "ke_kontrole",
    paymentStatus: perms.paid ? "nezaplaceno" : null, paidAt: null, paidAmount: null, paidByName: null, overdue: perms.paid ? false : null,
    source: "photo", isCreditNote: false, isProforma: false, missingRate: false,
    supplier: { id: "s1", name: "Kovoobrábění Hrubý s.r.o.", ico: "25874411", dic: null },
    supplierHeader: { name: "Kovoobrábění Hrubý s.r.o.", ico: "25874411", dic: "", address: "", bankAccount: "123/0100", email: "", phone: "" },
    supplierMatch: null, duplicateOf: null, aiUsed: true, aiConfidence: 0.9, aiError: null, aiProcessedAt: "2026-10-29T10:00:00Z", aiSummary: "x",
    needsClarification: [], note: null, uploadedByName: "Dílna", createdAt: "2026-10-29T10:00:00Z", processedByName: null, processedAt: null,
    files: [{ id: "f1", filename: "faktura.jpg", mimeType: "image/jpeg", size: 100, href: "/api/supplier-invoices/files/f1" }],
    items: [
      { id: "i1", position: 0, text: "Výroba dle obj. OV-2026-014", code: null, quantity: 1, unit: "kpl", unitPrice: 30_000, amount: 30_000, vatRate: 21 },
      { id: "i2", position: 1, text: "Doprava", code: null, quantity: null, unit: null, unitPrice: null, amount: 1_000, vatRate: 21 },
    ],
    allocations: [
      { id: "a1", itemId: "i1", target: "job", job: { id: "j1", number: "Z-2026-101", title: "Příruby", customerName: "Strojmetal" }, category: null,
        amount: 10_000, purchaseOrderId: "po1", purchaseOrderNumber: "OV-2026-014", purchaseOrderItemId: null, orderItemId: null, orderItemLabel: null,
        note: null, aiSuggested: true, aiReason: "podle naší objednávky OV-2026-014 v řádku", confirmed: false, confirmedAt: null, confirmedByName: null },
      { id: "a2", itemId: "i1", target: "job", job: { id: "j2", number: "Z-2026-102", title: "", customerName: null }, category: null,
        amount: 20_000, purchaseOrderId: null, purchaseOrderNumber: null, purchaseOrderItemId: null, orderItemId: null, orderItemLabel: null,
        note: null, aiSuggested: false, aiReason: null, confirmed: true, confirmedAt: "2026-10-29T10:00:00Z", confirmedByName: "Admin" },
    ],
    supplierPurchaseOrders: [{ id: "po1", number: "OV-2026-014", job: { id: "j1", number: "Z-2026-101", title: "", customerName: null }, total: 30_000, status: "potvrzena" }],
    purchaseOrderInvoicing: [{ id: "po1", number: "OV-2026-014", jobNumber: "Z-2026-101", total: 30_000, invoiced: 10_000, complete: false, final: false }],
    perms,
  };
}

describe("Faktury dodavatelů — vykreslení", () => {
  it("seznam: filtry, součty, karta s po splatnosti, nepřiřazeno a zakázkou", () => {
    const h = html(<InvoiceList items={[item]} totals={TOTALS}
      suppliers={[{ id: "s1", name: "Kovoobrábění Hrubý s.r.o." }]} perms={ADMIN}
      filter={{ view: "vse", supplierId: "", jobId: "", from: "", to: "", q: "", period: "" }} visibility="super_admin" today="2026-10-29" />);
    for (const t of ["Ke kontrole", "Nepřiřazené", "Nezaplacené", "Po splatnosti", "Celkem bez DPH", "Nezaplaceno", "FA-2026-0815", "Z-2026-101", "po splatnosti", "nepřiřazeno", "AI návrh čeká", "Kdo vidí faktury dodavatelů"]) {
      expect(h).toContain(t);
    }
    expect(h).toContain('data-testid="invoice-card"');
  });

  it("seznam bez práva na zaplaceno: žádné filtry ani štítky platby", () => {
    const h = html(<InvoiceList items={[{ ...item, paymentStatus: null, overdue: null }]} totals={{ count: 1, net: 1, gross: 1, unpaid: null, overdue: null, unallocated: 0, foreign: [] }}
      suppliers={[]} perms={SALES_ALL} filter={{ view: "vse", supplierId: "", jobId: "", from: "", to: "", q: "", period: "" }} today="2026-10-29" />);
    expect(h).not.toContain("Nezaplacené");
    expect(h).not.toContain('data-testid="invoice-paid"');
    expect(h).not.toContain("Kdo vidí faktury dodavatelů");
  });

  it("detail: náhled vedle položek, řádky rozdělení, zbytek, návrh AI, úhrada jen super admin", () => {
    const h = html(<InvoiceDetailView initial={detail(ADMIN)} today="2026-10-29" />);
    expect(h).toContain('data-testid="invoice-preview"');
    expect(h.match(/data-testid="invoice-item"/g)).toHaveLength(2);
    expect(h.match(/data-testid="allocation-row"/g)).toHaveLength(2);
    expect(h).toContain("návrh AI — podle naší objednávky OV-2026-014 v řádku");
    expect(h).toContain("rozděleno celé");
    expect(h).toContain("zbývá rozdělit");
    expect(h).toContain('data-testid="invoice-paid-card"');
    expect(h).toContain("Potvrdit vše, co navrhla AI");
    expect(h).toContain("nerozděleno");
  });

  it("detail v režimu „všichni“ bez práva na zaplaceno: bez karty úhrady a BEZ úprav (jen super admin)", () => {
    const h = html(<InvoiceDetailView initial={detail(SALES_ALL)} today="2026-10-29" />);
    expect(h).not.toContain('data-testid="invoice-paid-card"');
    expect(h).not.toContain("Nezaplaceno");
    for (const t of ["Upravit položky", "Zamítnout", "Přečíst znovu (AI)", "Potvrdit vše, co navrhla AI", 'data-testid="item-split"', 'data-testid="item-overhead"', "</svg> Upravit</button>"]) {
      expect(h).not.toContain(t);
    }
    expect(h).toContain('data-testid="invoice-preview"');
  });

  it("detail zaměstnance v režimu „všichni“: bez částek i bez souboru faktury", () => {
    const d = detail(WORKER_ALL);
    const h = html(<InvoiceDetailView initial={{ ...d, files: [], totalNet: null, totalGross: null, totalVat: null }} today="2026-10-29" />);
    expect(h).not.toContain('data-testid="invoice-preview"');
    expect(h).toContain("vidí jen ti, kdo vidí nákupní ceny");
    expect(h).not.toContain("/api/supplier-invoices/files/");
  });

  it("detail: chybí kurz → banner, zálohová → štítek a poznámka, dílčí objednávka s „Faktura konečná“", () => {
    const d = { ...detail(ADMIN), currency: "EUR", missingRate: true, isProforma: false };
    const h = html(<InvoiceDetailView initial={d} today="2026-10-29" />);
    expect(h).toContain('data-testid="invoice-missing-rate"');
    expect(h).toContain("Chybí kurz EUR — doplň.");
    expect(h).toContain("Načíst kurz ČNB");
    expect(h).toContain('data-testid="invoice-po-final"');
    expect(h).toContain("dílčí — do nákladu zatím jde objednávka");
    const p = html(<InvoiceDetailView initial={{ ...detail(ADMIN), isProforma: true }} today="2026-10-29" />);
    expect(p).toContain('data-testid="invoice-proforma"');
    expect(p).toContain("Zálohová faktura — do nákladů zakázek se nepočítá");
  });

  it("detail: AI čte → bez úprav; čtení po 3 min nedokončené → „Přečíst znovu (AI)“", () => {
    const fresh = { ...detail(ADMIN), status: "nahrano" as const, aiProcessedAt: null, createdAt: new Date().toISOString() };
    const h = html(<InvoiceDetailView initial={fresh} today="2026-10-29" />);
    expect(h).toContain("AI fakturu čte");
    expect(h).not.toContain('data-testid="item-split"');
    const old = { ...fresh, createdAt: new Date(Date.now() - 10 * 60_000).toISOString() };
    const s = html(<InvoiceDetailView initial={old} today="2026-10-29" />);
    expect(s).not.toContain("AI fakturu čte");
    expect(s).toContain('data-testid="invoice-read-stale"');
    expect(s).toContain("Přečíst znovu (AI)");
  });

  it("seznam: faktury bez kurzu zvlášť (ne jako Kč), zálohová a částečná úhrada", () => {
    const h = html(<InvoiceList
      items={[{ ...item, currency: "EUR", totalNet: 240, totalGross: 290.4, missingRate: true }, { ...item, id: "inv2", isProforma: true, paymentStatus: "castecne", paidAmount: 10_000 }]}
      totals={{ ...TOTALS, foreign: [{ currency: "EUR", count: 1, net: 240, gross: 290.4 }] }}
      suppliers={[]} perms={ADMIN} filter={{ view: "vse", supplierId: "", jobId: "", from: "", to: "", q: "", period: "" }} today="2026-10-29" />);
    expect(h).toContain('data-testid="invoice-totals-foreign"');
    expect(h).toContain("Bez kurzu (mimo součty v Kč)");
    expect(h).toContain('data-testid="invoice-card-norate"');
    expect(h).toContain("zálohová");
    expect(h).toContain("uhrazeno");
    expect(h).toContain('data-testid="invoice-filters-toggle"');
  });

  it("nahrání: Vyfotit / Nahrát soubor", () => {
    const h = html(<InvoiceUploader />);
    expect(h).toContain("Vyfotit fakturu");
    expect(h).toContain("Nahrát soubor");
    expect(h).toContain('capture="environment"');
  });

  it("kontrola dávky: pruh „Faktura dodavatele → Faktury dodavatelů“ bez údajů pro ne-super-admina", () => {
    const review = { supplierInvoices: [{ docId: "d2", pageIds: [], aiUsed: true }] } as unknown as BatchReviewModel;
    const batch = { pages: [], files: [], previews: [] } as unknown as BatchSortModel;
    const h = html(<CaptureSupplierInvoices review={review} batch={batch} local={new Map()} />);
    expect(h).toContain("Faktury dodavatelů");
    expect(h).toContain("zpracuje ji super admin");
    expect(h).not.toContain("bez DPH");
    const h2 = html(<CaptureSupplierInvoices review={{ supplierInvoices: [{ docId: "d2", pageIds: [], aiUsed: true, details: { supplierName: "Kovo", documentNumber: "FA-1", totalNet: 30_000, currency: "CZK", items: 2 } }] } as unknown as BatchReviewModel} batch={batch} local={new Map()} />);
    expect(h2).toContain("Kovo");
    expect(h2).toContain("bez DPH");
  });
});
