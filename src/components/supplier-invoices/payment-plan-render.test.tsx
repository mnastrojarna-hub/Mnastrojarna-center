import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { renderToString as renderSsr } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/supplier-invoices/plan",
}));
vi.mock("@/app/actions/payment-plan", () => ({
  addPaymentPlanEntry: vi.fn(), deletePaymentPlanEntry: vi.fn(), searchInvoicesForPaymentPlan: vi.fn(), setPaymentPlanPaid: vi.fn(), updatePaymentPlanEntry: vi.fn(),
}));
vi.mock("@/app/actions/supplier-invoices", () => ({ setSupplierInvoicePayment: vi.fn() }));
vi.mock("@/app/actions/supplier-invoice-record", () => ({ recordEmailAttachmentInvoiceAction: vi.fn() }));
vi.mock("@/app/actions/capture", () => ({ createCaptureUpload: vi.fn(), discardCapture: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));

import { PaymentPlan } from "./payment-plan";
import { InvoiceRecorder } from "./invoice-recorder";
import { SupplierInvoiceTabs } from "./invoice-tabs";
import type { PaymentPlanData } from "@/lib/supplier-invoices/payment-plan";

const html = (n: React.ReactElement) => renderSsr(n).replace(/<!-- -->/g, "");

const DATA: PaymentPlanData = {
  today: "2026-10-31",
  entries: [
    { id: "p1", payee: "Franta Vomáčka", amount: 12_500, currency: "CZK", dueOn: "2026-11-02", note: "záloha", invoice: null, paidAt: null, paidByName: null, createdByName: "Admin", createdAt: "2026-10-31T08:00:00Z" },
    { id: "p2", payee: "Kalírna", amount: 3_000, currency: "CZK", dueOn: "2026-10-29", note: null, invoice: { id: "i1", number: "FA-9", supplierName: "Kalírna", paymentStatus: "nezaplaceno" }, paidAt: null, paidByName: null, createdByName: null, createdAt: "2026-10-28T08:00:00Z" },
    { id: "p3", payee: "Zaplacený", amount: 100, currency: "CZK", dueOn: "2026-10-30", note: null, invoice: null, paidAt: "2026-10-30", paidByName: "Admin", createdByName: null, createdAt: "2026-10-28T08:00:00Z" },
  ],
  upcomingInvoices: [{ id: "i2", number: "FA-77", supplierName: "Hrubý", dueDate: "2026-11-05", amount: 38_115, currency: "CZK", overdue: false, inPlan: false }],
  payees: ["Franta Vomáčka", "Hrubý"],
};

describe("Platební plán — vykreslení", () => {
  it("dny (po termínu, pozítří), součty bez zaplacených, nápověda faktur sbalená a mimo součty", () => {
    const out = html(<PaymentPlan data={DATA} />);
    expect(out).toContain("Po termínu");
    expect(out).toContain("pondělí 2. 11.");
    expect(out).toMatch(/data-testid="plan-total"[^>]*>15\s500\sKč</);
    expect(out).toContain("Franta Vomáčka");
    expect(out).toContain("faktura FA-9");
    expect(out).toContain("mělo být 29. 10. 2026");
    expect(out).toContain("Nezaplacené faktury se splatností do 14 dní (1) — zobrazit");
    expect(out).toContain("Zaplacené za posledních 30 dní (1)");
    expect(out).not.toMatch(/<details[^>]*open/);
  });
  it("prázdný plán", () => {
    expect(html(<PaymentPlan data={{ ...DATA, entries: [], upcomingInvoices: [] }} />)).toContain("V plánu nic není");
  });
  it("záložky", () => {
    expect(html(<SupplierInvoiceTabs active="plan" />)).toMatch(/aria-current="page"[^>]*href="\/supplier-invoices\/plan"/);
  });
});

describe("Zanést fakturu — vykreslení", () => {
  it("bez e-mailu: Vyfotit / Nahrát soubor, jeden soubor (bez multiple)", () => {
    const out = html(<InvoiceRecorder canOpen={false} />);
    expect(out).toContain("Vyfotit fakturu");
    expect(out).toContain("Nahrát soubor");
    expect(out).not.toContain("multiple");
    expect(out).toContain('accept="application/pdf');
  });
  it("z Pošty: příloha předvybraná, ostatní přílohy nenabízí", () => {
    const out = html(<InvoiceRecorder canOpen={false} email={{
      emailId: "e1", subject: "Faktura 2026-7001", from: "Kalírna <info@k.cz>", preselectedId: "a2",
      attachments: [
        { id: "a1", filename: "logo.png", mimeType: "image/png", size: 2000, usable: false },
        { id: "a2", filename: "faktura.pdf", mimeType: "application/pdf", size: 120_000, usable: true },
      ],
    }} />);
    expect(out).toContain("faktura.pdf");
    expect(out).not.toContain("logo.png");
    expect(out).toMatch(/<input type="radio"[^>]*checked=""/);
    expect(out).toContain("Zanést fakturu");
  });
});
