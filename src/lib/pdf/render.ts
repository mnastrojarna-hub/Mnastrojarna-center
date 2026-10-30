import "server-only";
import { createElement, type ReactElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { COMPANY, DEFAULT_VAT_RATE } from "@/lib/company";
import { ensureFonts } from "./theme";
import { supplierParty } from "./components";
import { InvoiceDocument } from "./invoice";
import { QuoteDocument } from "./quote";
import { DeliveryNoteDocument } from "./delivery-note";
import { ConfirmationDocument } from "./confirmation";
import { addDaysIso, todayIso, type InvoiceData, type QuoteData, type DeliveryNoteData, type ConfirmationData, type DocItem, type PartyInfo } from "./types";

type DocEl = ReactElement<DocumentProps>;

// ensureFonts() se MUSÍ awaitovat — opravuje sdílenou mezipaměť glyfů písma (mizející písmena).
export async function renderInvoicePdf(data: InvoiceData): Promise<Buffer> {
  await ensureFonts();
  return renderToBuffer(createElement(InvoiceDocument, { data }) as unknown as DocEl);
}
export async function renderQuotePdf(data: QuoteData): Promise<Buffer> {
  await ensureFonts();
  return renderToBuffer(createElement(QuoteDocument, { data }) as unknown as DocEl);
}
export async function renderDeliveryNotePdf(data: DeliveryNoteData): Promise<Buffer> {
  await ensureFonts();
  return renderToBuffer(createElement(DeliveryNoteDocument, { data }) as unknown as DocEl);
}
export async function renderConfirmationPdf(data: ConfirmationData): Promise<Buffer> {
  await ensureFonts();
  return renderToBuffer(createElement(ConfirmationDocument, { data }) as unknown as DocEl);
}

// ── Ukázková data pro náhled (/api/pdf/[type]) ──────────────

const DEMO_CUSTOMER: PartyInfo = {
  name: "Strojmetal Čelákovice a.s.",
  street: "Průmyslová 124",
  zip: "250 88",
  city: "Čelákovice",
  country: "CZ",
  ico: "45274649",
  dic: "CZ45274649",
};

const DEMO_REFS = {
  jobNumber: "Z-2026-014",
  customerOrderNumber: "PO-4471/26",
  customerOrderDate: "2026-10-20",
  customerInquiryNumber: "RFQ-2026-0912",
  customerNumber: "ZAK-0042",
  supplierNumberAtCustomer: "D-10577",
  contactPerson: "Jan Dvořák",
  contactEmail: "obchod@mnastrojarna.cz",
  customerContact: "Ing. Petra Svobodová",
  customerContactEmail: "svobodova@strojmetal.cz",
  deliveryAddress: "Strojmetal Čelákovice a.s.\nHala B — příjem materiálu\nPrůmyslová 124\n250 88 Čelákovice",
};

const DEMO_ITEMS: DocItem[] = [
  {
    drawingNumber: "VK-2291",
    revision: "C",
    description: "Upínací deska — frézovaný díl, kaleno na 58–60 HRC",
    material: "1.2379 (X153CrMoV12)",
    quantity: 50,
    unit: "ks",
    unitPrice: 1180,
    vatRate: DEFAULT_VAT_RATE,
  },
  {
    drawingNumber: "VK-2292",
    revision: "A",
    description: "Vodicí lišta 420 mm, broušeno",
    material: "1.0503 (C45)",
    note: "Tolerance rovinnosti 0,02 mm",
    quantity: 24,
    unit: "ks",
    unitPrice: 865.5,
    vatRate: DEFAULT_VAT_RATE,
  },
  {
    drawingNumber: "VK-1187",
    revision: "B",
    description: "Pouzdro ložiska Ø 62 H7, soustružené",
    material: "EN AW-7075",
    quantity: 120,
    unit: "ks",
    unitPrice: 214,
    vatRate: DEFAULT_VAT_RATE,
  },
  {
    description: "Měřicí protokol 3D (CMM) k první dodávce",
    quantity: 1,
    unit: "ks",
    unitPrice: 1500,
    vatRate: DEFAULT_VAT_RATE,
  },
];

// Bankovní spojení — POUZE skutečné údaje z Nastavení → Firemní údaje (žádné vymyšlené)
function bank() {
  return {
    accountNumber: COMPANY.bank.accountNumber,
    iban: COMPANY.bank.iban,
    swift: COMPANY.bank.swift,
    bankName: COMPANY.bank.bankName,
  };
}

export function sampleInvoice(): InvoiceData {
  const today = todayIso();
  return {
    ...DEMO_REFS,
    number: "FV-2026-0158",
    variableSymbol: "20260158",
    issueDate: today,
    taxableDate: today,
    dueDate: addDaysIso(today, 14),
    paymentMethod: "Bankovní převod",
    currency: "CZK",
    supplier: supplierParty(),
    customer: DEMO_CUSTOMER,
    bank: bank(),
    deliveryNoteNumber: "DL-2026-0211",
    preparedBy: "Jan Dvořák",
    items: DEMO_ITEMS,
  };
}

export function sampleQuote(): QuoteData {
  const today = todayIso();
  return {
    ...DEMO_REFS,
    number: "NAB-2026-119",
    issueDate: today,
    validUntil: addDaysIso(today, 30),
    currency: "CZK",
    supplier: supplierParty(),
    customer: DEMO_CUSTOMER,
    subject: "Výroba frézovaných a soustružených dílů dle výkresů VK-2291, VK-2292, VK-1187",
    leadTimeText: "3 týdny od potvrzení objednávky",
    paymentTerms: "Splatnost faktury 30 dní",
    deliveryTerms: "DAP Čelákovice, doprava v ceně",
    preparedBy: "Jan Dvořák",
    approvedBy: "Ing. Martin Novotný",
    items: DEMO_ITEMS,
    note: "Ceny platí pro uvedená množství. Tepelné zpracování a měřicí protokol jsou zahrnuty v ceně položek.",
  };
}

export function sampleConfirmation(): ConfirmationData {
  const today = todayIso();
  return {
    ...DEMO_REFS,
    number: "POT-2026-014",
    issueDate: today,
    currency: "CZK",
    supplier: supplierParty(),
    customer: DEMO_CUSTOMER,
    quoteNumber: "NAB-2026-119",
    confirmedDeliveryDate: addDaysIso(today, 22),
    paymentTerms: "Splatnost faktury 30 dní",
    deliveryTerms: "DAP Čelákovice, doprava v ceně",
    preparedBy: "Jan Dvořák",
    approvedBy: "Ing. Martin Novotný",
    items: DEMO_ITEMS,
  };
}

export function sampleDeliveryNote(): DeliveryNoteData {
  return {
    ...DEMO_REFS,
    number: "DL-2026-0211",
    issueDate: todayIso(),
    supplier: supplierParty(),
    customer: DEMO_CUSTOMER,
    transport: "Vlastní doprava",
    packages: 3,
    weightKg: 86.4,
    preparedBy: "Jan Dvořák",
    items: DEMO_ITEMS.map(({ description, quantity, unit, drawingNumber, revision, material, note }) => ({
      description, quantity, unit, drawingNumber, revision, material, note,
    })),
    note: "Díly baleny v KLT přepravkách, proloženo VCI papírem.",
  };
}
