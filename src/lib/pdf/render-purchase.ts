import "server-only";
import { createElement, type ReactElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { DEFAULT_VAT_RATE } from "@/lib/company";
import { ensureFonts } from "./theme";
import { supplierParty } from "./components";
import { PurchaseOrderDocument } from "./purchase-order";
import { addDaysIso, todayIso } from "./types";
import type { PurchaseOrderData } from "./purchase-types";

type DocEl = ReactElement<DocumentProps>;

/** PDF objednávky vydané dodavateli. */
export async function renderPurchaseOrderPdf(data: PurchaseOrderData): Promise<Buffer> {
  await ensureFonts(); // await: oprava sdílené mezipaměti glyfů (mizející písmena), viz theme.tsx
  return renderToBuffer(createElement(PurchaseOrderDocument, { data }) as unknown as DocEl);
}

/** Ukázková objednávka pro náhled šablony. */
export function samplePurchaseOrder(): PurchaseOrderData {
  const today = todayIso();
  const us = supplierParty();
  return {
    number: "OV-2026-004",
    issueDate: today,
    currency: "CZK",
    buyer: us,
    supplier: {
      name: "Kovoobrábění Hrubý s.r.o.",
      street: "Průmyslová 1458",
      zip: "538 21",
      city: "Slatiňany",
      country: "CZ",
      ico: "25874411",
      dic: "CZ25874411",
      email: "objednavky@hruby-cnc.cz",
      phone: "+420 469 123 456",
    },
    supplierContact: "Ing. Tomáš Hrubý",
    jobNumber: "Z-2026-014",
    supplierQuoteNumber: "NAB-26-0412",
    supplierQuoteDate: addDaysIso(today, -3),
    requiredDate: addDaysIso(today, 18),
    deliveryAddress: [us.name, us.street, [us.zip, us.city].filter(Boolean).join(" ")].filter(Boolean).join("\n"),
    deliveryTerms: "DAP Mnástrojárna",
    paymentTerms: "Splatnost 30 dní",
    contactPerson: "Jan Dvořák",
    contactEmail: "obchod@mnastrojarna.cz",
    contactPhone: "+420 777 123 456",
    note: "Objednávka k naší zakázce Z-2026-014. Výroba dle výkresů: VK-2291, VK-2292, VK-1187.",
    items: [
      {
        drawingNumber: "VK-2291",
        revision: "C",
        description: "Upínací deska — frézovaný díl, kaleno na 58–60 HRC",
        material: "1.2379 (X153CrMoV12)",
        quantity: 50,
        unit: "ks",
        unitPrice: 760,
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
        unitPrice: 545,
        vatRate: DEFAULT_VAT_RATE,
      },
      {
        drawingNumber: "VK-1187",
        revision: "B",
        description: "Pouzdro ložiska Ø 62 H7, soustružené",
        material: "EN AW-7075",
        quantity: 120,
        unit: "ks",
        unitPrice: 138.5,
        vatRate: DEFAULT_VAT_RATE,
      },
    ],
  };
}
