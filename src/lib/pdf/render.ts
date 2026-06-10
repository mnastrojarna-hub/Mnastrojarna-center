import "server-only";
import { createElement, type ReactElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { COMPANY, DEFAULT_VAT_RATE } from "@/lib/company";
import { ensureFonts } from "./theme";
import { supplierParty } from "./components";
import { InvoiceDocument } from "./invoice";
import { QuoteDocument } from "./quote";
import { DeliveryNoteDocument } from "./delivery-note";
import type { InvoiceData, QuoteData, DeliveryNoteData } from "./types";

type DocEl = ReactElement<DocumentProps>;

export async function renderInvoicePdf(data: InvoiceData): Promise<Buffer> {
  ensureFonts();
  return renderToBuffer(createElement(InvoiceDocument, { data }) as unknown as DocEl);
}
export async function renderQuotePdf(data: QuoteData): Promise<Buffer> {
  ensureFonts();
  return renderToBuffer(createElement(QuoteDocument, { data }) as unknown as DocEl);
}
export async function renderDeliveryNotePdf(data: DeliveryNoteData): Promise<Buffer> {
  ensureFonts();
  return renderToBuffer(createElement(DeliveryNoteDocument, { data }) as unknown as DocEl);
}

// ── Ukázková data pro náhled ────────────────────────────────
const DEMO_CUSTOMER = {
  name: "Strojmetal a.s.",
  street: "Průmyslová 124",
  zip: "250 88",
  city: "Čelákovice",
  country: "Česká republika",
  ico: "45274649",
  dic: "CZ45274649",
};

// Bankovní spojení — POUZE skutečné údaje z Nastavení → Firemní údaje (žádné vymyšlené)
function bank() {
  return {
    accountNumber: COMPANY.bank.accountNumber,
    iban: COMPANY.bank.iban,
    bankName: COMPANY.bank.bankName,
  };
}

export function sampleInvoice(): InvoiceData {
  const today = new Date().toISOString().slice(0, 10);
  const due = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  return {
    number: "20260001",
    variableSymbol: "20260001",
    issueDate: today,
    taxableDate: today,
    dueDate: due,
    paymentMethod: "Bankovní převod",
    currency: "CZK",
    supplier: supplierParty(),
    customer: DEMO_CUSTOMER,
    bank: bank(),
    items: [
      { description: "Frézované díly dle výkresu VK-2291, materiál 1.2379", quantity: 50, unit: "ks", unitPrice: 1180, vatRate: DEFAULT_VAT_RATE },
      { description: "Tepelné zpracování — kalení", quantity: 50, unit: "ks", unitPrice: 95, vatRate: DEFAULT_VAT_RATE },
      { description: "Měřicí protokol 3D", quantity: 1, unit: "ks", unitPrice: 1500, vatRate: DEFAULT_VAT_RATE },
    ],
    note: "Děkujeme za Vaši objednávku.",
  };
}

export function sampleQuote(): QuoteData {
  const today = new Date().toISOString().slice(0, 10);
  const valid = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  return {
    number: "NAB-2026-119",
    issueDate: today,
    validUntil: valid,
    currency: "CZK",
    supplier: supplierParty(),
    customer: DEMO_CUSTOMER,
    items: [
      { description: "Frézované díly dle výkresu VK-2291, materiál 1.2379", quantity: 50, unit: "ks", unitPrice: 1180, vatRate: DEFAULT_VAT_RATE },
      { description: "Tepelné zpracování — kalení", quantity: 50, unit: "ks", unitPrice: 95, vatRate: DEFAULT_VAT_RATE },
    ],
    note: "Dodací lhůta 3 týdny od potvrzení objednávky.",
  };
}

export function sampleDeliveryNote(): DeliveryNoteData {
  const today = new Date().toISOString().slice(0, 10);
  return {
    number: "DL-20260001",
    issueDate: today,
    orderNumber: "OBJ-4471",
    supplier: supplierParty(),
    customer: DEMO_CUSTOMER,
    deliveryAddress: "Strojmetal a.s., Průmyslová 124, 250 88 Čelákovice",
    items: [
      { description: "Frézované díly dle výkresu VK-2291", quantity: 50, unit: "ks" },
      { description: "Měřicí protokol 3D", quantity: 1, unit: "ks" },
    ],
    note: "Zboží zkontrolujte při převzetí.",
  };
}
