import "server-only";
import { COMPANY, DEFAULT_VAT_RATE } from "@/lib/company";
import { refreshCompanyFromSettings } from "@/lib/company-server";
import type { JobDetail, JobItem } from "@/lib/jobs/types";
import type { PurchaseItem, PurchaseOrderView, PurchaseSupplierRef } from "@/lib/jobs/purchasing-types";
import { CONFIRM_WITHIN_WORKING_DAYS, ourDeliveryAddressOf, splitAddress } from "@/lib/jobs/purchasing";
import { supplierParty } from "./components";
import { isCzechCountry, type DocItem, type PartyInfo } from "./types";
import type { PurchaseOrderData } from "./purchase-types";

/**
 * PDF objednávky vydané dodavateli ze zakázky + objednávky (OV-…). Před
 * sestavením načte firemní údaje z Nastavení. Oprávnění („margins") hlídá volající.
 * Do dokladu nejde nic o koncovém zákazníkovi (jméno, jeho objednávka, prodejní ceny).
 */

function u(value?: string | null): string | undefined {
  const s = value?.trim();
  return s ? s : undefined;
}

/** Dodavatel z adresáře → strana dokladu (adresa z jednoho pole rozdělená na řádky). */
export function purchaseSupplierParty(s: PurchaseSupplierRef | null | undefined, fallbackName?: string | null): PartyInfo {
  if (!s) return { name: u(fallbackName) ?? "Dodavatel neuveden" };
  const a = splitAddress(s.address);
  return {
    name: s.name,
    street: u([a.street, ...a.extra].filter(Boolean).join(", ")),
    zip: u(a.zip),
    city: u(a.city),
    country: u(s.country),
    ico: u(s.ico),
    dic: u(s.dic),
    email: u(s.email),
    phone: u(s.phone),
  };
}

/** Sazba DPH na objednávce: tuzemský dodavatel 21 %, zahraniční bez české DPH. */
export function purchaseVatRate(supplier: PurchaseSupplierRef | null | undefined): number {
  return isCzechCountry(supplier?.country) ? DEFAULT_VAT_RATE : 0;
}

/** Položka objednávky → řádek dokladu; revizi výkresu doplní z položek zakázky. */
export function purchaseItemToDoc(it: PurchaseItem, jobItems: Pick<JobItem, "drawingNumber" | "revision" | "material">[], vatRate: number): DocItem {
  const match = it.drawingNumber ? jobItems.find((j) => j.drawingNumber === it.drawingNumber) : undefined;
  return {
    description: u(it.name) ?? (it.drawingNumber ? `Díl dle výkresu ${it.drawingNumber}` : "Položka"),
    drawingNumber: u(it.drawingNumber),
    revision: u(match?.revision),
    material: u(it.material) ?? u(match?.material),
    note: u(it.note),
    quantity: it.quantity,
    unit: u(it.unit) ?? "ks",
    unitPrice: it.unitPrice ?? 0,
    vatRate,
    unpriced: it.unitPrice === null || it.unitPrice === undefined,
  };
}

export async function buildPurchaseOrderDoc(
  job: Pick<JobDetail, "number" | "items" | "owner">,
  po: PurchaseOrderView,
  supplier: PurchaseSupplierRef | null = po.supplier,
  opts: {
    preparedBy?: string | null; contactEmail?: string | null; contactPhone?: string | null;
    /** Úvod / pokyn k provedení podle druhu kroku (tepelné zpracování, povrch…); undefined = výchozí. */
    intro?: string; workInstruction?: string;
    /** Změna objednávky (revize ≥ 2) a její datum. */
    revision?: number | null; revisionDate?: string | null;
  } = {},
): Promise<PurchaseOrderData> {
  await refreshCompanyFromSettings();
  const vatRate = purchaseVatRate(supplier);
  const preparedBy = u(opts.preparedBy) ?? u(po.createdBy?.name) ?? u(job.owner?.name);
  const extra: Partial<PurchaseOrderData> = {};
  if (opts.intro !== undefined) extra.intro = opts.intro;
  if (opts.workInstruction !== undefined) extra.workInstruction = opts.workInstruction;
  if (opts.revision && opts.revision > 1) {
    extra.revision = opts.revision;
    if (u(opts.revisionDate)) extra.revisionDate = u(opts.revisionDate);
  }
  return {
    number: po.number,
    issueDate: po.orderDate,
    currency: po.currency || "CZK",
    buyer: supplierParty(),
    supplier: purchaseSupplierParty(supplier),
    supplierContact: u(supplier?.contactPerson),
    items: po.items.map((it) => purchaseItemToDoc(it, job.items, vatRate)),
    requiredDate: u(po.requiredDate),
    confirmedDate: u(po.confirmedDate),
    jobNumber: u(job.number),
    supplierQuoteNumber: u(po.supplierQuote?.number),
    supplierQuoteDate: u(po.supplierQuote?.quoteDate),
    supplierReference: u(po.supplierReference),
    deliveryAddress: u(po.deliveryAddress) ?? ourDeliveryAddressOf(COMPANY),
    deliveryTerms: u(po.deliveryTerms),
    paymentTerms: u(po.paymentTerms),
    note: u(po.note),
    contactPerson: preparedBy,
    contactEmail: u(opts.contactEmail) ?? u(COMPANY.email),
    contactPhone: u(opts.contactPhone) ?? u(COMPANY.phone),
    confirmWithinDays: CONFIRM_WITHIN_WORKING_DAYS,
    totalsHint: vatRate === 0 ? "Plnění bez české DPH" : undefined,
    ...extra,
  };
}
