import "server-only";
import { COMPANY, DEFAULT_VAT_RATE } from "@/lib/company";
import { refreshCompanyFromSettings } from "@/lib/company-server";
import type { JobDetail, JobQuote, JobItem, JobQuoteItem } from "@/lib/jobs/types";
import { supplierParty } from "./components";
import { spdVariableSymbol } from "./qr";
import {
  addDaysIso, leadTimeLabel, todayIso,
  type ConfirmationData, type DeliveryItem, type DeliveryNoteData, type DocItem, type DocRefs,
  type InvoiceData, type PartyInfo, type QuoteData,
} from "./types";

/**
 * Doklady (PDF) ze zakázky — skládá data pro renderQuotePdf / renderConfirmationPdf /
 * renderDeliveryNotePdf / renderInvoicePdf z JobDetail. Před sestavením načte firemní údaje
 * z Nastavení (supplierParty čte COMPANY). Oprávnění hlídá volající.
 */

/** Druh dokladu = klíč druhu souboru zakázky (job_files.kind). */
export type JobDocKind = "nabidka" | "potvrzeni" | "dodaci_list" | "faktura";

const FILE_PREFIX: Record<JobDocKind, string> = {
  nabidka: "Nabidka",
  potvrzeni: "Potvrzeni_objednavky",
  dodaci_list: "Dodaci_list",
  faktura: "Faktura",
};

/** ASCII bezpečný název souboru: pdfFileName("nabidka", "NAB-2026/031") → "Nabidka_NAB-2026-031.pdf". */
export function pdfFileName(kind: JobDocKind, number: string): string {
  const safe = (number ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return `${FILE_PREFIX[kind]}_${safe || "bez-cisla"}.pdf`;
}

// ── Pomocné převody (čisté) ─────────────────────────────────

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function u(value?: string | null): string | undefined {
  const s = value?.trim();
  return s ? s : undefined;
}

/** Timestamp / datum → YYYY-MM-DD v pražském čase. */
export function dateOnly(value?: string | null): string | undefined {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  return isNaN(d.getTime()) ? undefined : todayIso(d);
}

function defaultVat(): number {
  return COMPANY.vatPayer ? DEFAULT_VAT_RATE : 0;
}

export function paymentTermsText(days?: number | null): string | undefined {
  if (days === null || days === undefined || days < 0) return undefined;
  if (days === 0) return "Splatnost ihned po vystavení faktury";
  return `Splatnost faktury ${days} dní od vystavení`;
}

/** Odběratel z karty zákazníka zakázky. */
export function jobCustomerParty(job: JobDetail): PartyInfo {
  const c = job.customerDetail;
  if (!c) return { name: job.customer?.name ?? "Zákazník neuveden", ico: u(job.customer?.ico) };
  return {
    name: c.name,
    street: u(c.street),
    zip: u(c.zip),
    city: u(c.city),
    country: u(c.country),
    ico: u(c.ico),
    dic: u(c.dic),
    email: u(c.email),
    phone: u(c.phone),
  };
}

/** Společné reference dokladu ze zakázky. */
export function jobRefs(job: JobDetail): DocRefs {
  const c = job.customerDetail;
  return {
    jobNumber: u(job.number),
    customerOrderNumber: u(job.customerOrderNumber),
    customerOrderDate: dateOnly(job.orderDate),
    customerInquiryNumber: u(job.customerInquiryNumber),
    customerNumber: u(c?.customerNumber ?? job.customer?.customerNumber),
    supplierNumberAtCustomer: u(c?.supplierNumberAtCustomer),
    contactPerson: u((job.assignee ?? job.owner)?.name),
    customerContact: u(job.customerContact ?? c?.contactPerson),
    customerContactEmail: u(job.customerContactEmail ?? (job.customerContact ? undefined : c?.email)),
    deliveryAddress: u(c?.deliveryAddress),
  };
}

function itemTexts(name: string | null, description: string | null, drawing: string | null, note: string | null) {
  const main = u(name) ?? u(description) ?? (drawing ? `Díl dle výkresu ${drawing}` : "Položka");
  const extra = [u(name) && u(description) && description !== name ? u(description) : undefined, u(note)]
    .filter(Boolean)
    .join(" · ");
  return { description: main, note: extra || undefined };
}

export function jobItemToDoc(it: JobItem, vatRate = defaultVat()): DocItem {
  return {
    ...itemTexts(it.name, it.description, it.drawingNumber, it.note),
    drawingNumber: u(it.drawingNumber),
    revision: u(it.revision),
    material: u(it.material),
    quantity: it.quantity,
    unit: u(it.unit) ?? "ks",
    unitPrice: it.unitPrice ?? 0,
    vatRate,
    unpriced: it.unitPrice === null || it.unitPrice === undefined,
  };
}

/** Položka nabídky; revizi výkresu doplní z položek zakázky (nabídka ji nenese). */
export function quoteItemToDoc(it: JobQuoteItem, jobItems: JobItem[] = []): DocItem {
  const match = it.drawingNumber ? jobItems.find((j) => j.drawingNumber === it.drawingNumber) : undefined;
  return {
    ...itemTexts(it.name, it.description, it.drawingNumber, it.note),
    drawingNumber: u(it.drawingNumber),
    revision: u(match?.revision),
    material: u(it.material ?? match?.material),
    quantity: it.quantity,
    unit: u(it.unit) ?? "ks",
    unitPrice: it.unitPrice ?? 0,
    vatRate: Number.isFinite(it.vatRate) ? it.vatRate : defaultVat(),
    unpriced: it.unitPrice === null || it.unitPrice === undefined,
  };
}

/** Přijatá nabídka, jinak nejnovější nearchivovaná. */
export function relevantQuote(job: JobDetail): JobQuote | undefined {
  const accepted = job.quotes.find((q) => q.id === job.acceptedQuoteId || q.accepted);
  if (accepted) return accepted;
  return [...job.quotes]
    .filter((q) => !q.archived)
    .sort((a, b) => (b.revision - a.revision) || b.createdAt.localeCompare(a.createdAt))[0];
}

/** Položky s cenami pro potvrzení / fakturu: zakázka → nabídka → souhrnný řádek. */
export function pickPricedItems(job: JobDetail): DocItem[] {
  const jobItems = job.items.map((it) => jobItemToDoc(it));
  if (jobItems.length && jobItems.every((i) => !i.unpriced)) return jobItems;

  const quote = relevantQuote(job);
  const quoteItems = (quote?.items ?? []).map((it) => quoteItemToDoc(it, job.items));
  if (quoteItems.length && quoteItems.every((i) => !i.unpriced)) return quoteItems;

  if (jobItems.length) {
    // Jediná položka bez ceny + známá hodnota zakázky → dopočet ceny za MJ
    if (jobItems.length === 1 && jobItems[0].unpriced && job.value && jobItems[0].quantity > 0) {
      return [{ ...jobItems[0], unitPrice: round2(job.value / jobItems[0].quantity), unpriced: false }];
    }
    return jobItems;
  }
  if (quoteItems.length) return quoteItems;

  const qty = job.totalQuantity > 0 ? job.totalQuantity : 1;
  return [
    {
      description: job.title || `Zakázka ${job.number}`,
      drawingNumber: job.drawingNumbers[0],
      quantity: qty,
      unit: "ks",
      unitPrice: job.value ? round2(job.value / qty) : 0,
      vatRate: defaultVat(),
      unpriced: !job.value,
    },
  ];
}

/** Položky dodacího listu (bez cen). */
export function pickDeliveryItems(job: JobDetail): DeliveryItem[] {
  const strip = ({ description, quantity, unit, drawingNumber, revision, material, note }: DocItem): DeliveryItem => ({
    description, quantity, unit, drawingNumber, revision, material, note,
  });
  if (job.items.length) return job.items.map((it) => strip(jobItemToDoc(it)));
  return pickPricedItems(job).map(strip);
}

/** Počet položek bez ceny — UI má před vystavením faktury / potvrzení varovat. */
export function unpricedCount(items: DocItem[]): number {
  return items.filter((i) => i.unpriced).length;
}

/** Výchozí číslo potvrzení ze zakázky: Z-2026-014 → POT-2026-014. */
export function confirmationNumber(jobNumber: string): string {
  return /^Z-/i.test(jobNumber) ? jobNumber.replace(/^Z-/i, "POT-") : `POT-${jobNumber}`;
}

function quoteLeadTime(q?: JobQuote): string | undefined {
  return q?.leadTimeDays ? `${leadTimeLabel(q.leadTimeDays)} od potvrzení objednávky` : undefined;
}

// ── Builders ────────────────────────────────────────────────

export async function buildQuoteDoc(
  job: JobDetail,
  quote: JobQuote,
  opts?: { intro?: string; preparedBy?: string },
): Promise<QuoteData> {
  await refreshCompanyFromSettings();
  const refs = jobRefs(job);
  const items = quote.items.length
    ? quote.items.map((it) => quoteItemToDoc(it, job.items))
    : job.items.map((it) => jobItemToDoc(it));
  return {
    ...refs,
    // Nabídka předchází objednávce — číslo objednávky na ni nepatří
    customerOrderNumber: undefined,
    customerOrderDate: undefined,
    number: quote.number,
    issueDate: dateOnly(quote.createdAt) ?? todayIso(),
    validUntil: dateOnly(quote.validUntil),
    currency: quote.currency || job.currency || "CZK",
    supplier: supplierParty(),
    customer: jobCustomerParty(job),
    items,
    subject: u(quote.title) ?? u(job.title),
    intro: opts?.intro,
    revision: quote.revision,
    leadTimeText: quoteLeadTime(quote),
    deliveryDate: quote.leadTimeDays ? undefined : dateOnly(job.dueDate ?? job.expectedDeliveryDate),
    paymentTerms: u(quote.paymentTerms) ?? paymentTermsText(job.customerDetail?.paymentTermsDays),
    deliveryTerms: u(quote.deliveryTerms) ?? u(job.deliveryMethod),
    note: u(quote.note),
    preparedBy: u(opts?.preparedBy) ?? u(quote.createdBy?.name) ?? u(job.pricedBy?.name) ?? refs.contactPerson,
    approvedBy: u(quote.approvedBy?.name),
  };
}

export async function buildConfirmationDoc(
  job: JobDetail,
  opts?: { number?: string; issueDate?: string; preparedBy?: string; note?: string },
): Promise<ConfirmationData> {
  await refreshCompanyFromSettings();
  const refs = jobRefs(job);
  const quote = relevantQuote(job);
  return {
    ...refs,
    number: u(opts?.number) ?? confirmationNumber(job.number),
    issueDate: opts?.issueDate ?? todayIso(),
    currency: job.currency || quote?.currency || "CZK",
    supplier: supplierParty(),
    customer: jobCustomerParty(job),
    items: pickPricedItems(job),
    confirmedDeliveryDate: dateOnly(job.dueDate ?? job.customerRequiredDate ?? job.expectedDeliveryDate),
    quoteNumber: u(quote?.number),
    leadTimeText: quoteLeadTime(quote),
    paymentTerms: u(quote?.paymentTerms) ?? paymentTermsText(job.customerDetail?.paymentTermsDays),
    deliveryTerms: u(quote?.deliveryTerms) ?? u(job.deliveryMethod),
    note: u(opts?.note),
    preparedBy: u(opts?.preparedBy) ?? refs.contactPerson,
    approvedBy: u(job.approvedBy?.name),
  };
}

export async function buildDeliveryNoteDoc(
  job: JobDetail,
  opts: { number: string; issueDate?: string; packages?: number; weightKg?: number; preparedBy?: string; note?: string },
): Promise<DeliveryNoteData> {
  await refreshCompanyFromSettings();
  const refs = jobRefs(job);
  return {
    ...refs,
    number: opts.number,
    issueDate: opts.issueDate ?? todayIso(),
    supplier: supplierParty(),
    customer: jobCustomerParty(job),
    items: pickDeliveryItems(job),
    transport: u(job.deliveryMethod),
    packages: opts.packages,
    weightKg: opts.weightKg,
    note: u(opts.note),
    preparedBy: u(opts.preparedBy) ?? refs.contactPerson,
  };
}

export async function buildInvoiceDoc(
  job: JobDetail,
  opts: {
    number: string;
    issueDate?: string;
    taxableDate?: string;
    dueDays?: number;
    preparedBy?: string;
    note?: string;
    constantSymbol?: string;
  },
): Promise<InvoiceData> {
  await refreshCompanyFromSettings();
  const refs = jobRefs(job);
  const issueDate = opts.issueDate ?? todayIso();
  const taxableDate = opts.taxableDate ?? dateOnly(job.deliveredAt ?? job.shippedAt) ?? issueDate;
  const dueDays = opts.dueDays ?? job.customerDetail?.paymentTermsDays ?? 14;
  return {
    ...refs,
    number: opts.number,
    variableSymbol: spdVariableSymbol(opts.number) ?? opts.number,
    issueDate,
    taxableDate,
    dueDate: addDaysIso(issueDate, Math.max(0, dueDays)),
    paymentMethod: "Bankovní převod",
    currency: job.currency || "CZK",
    supplier: supplierParty(),
    customer: jobCustomerParty(job),
    // Bankovní spojení POUZE z Nastavení — nic se nedomýšlí
    bank: {
      accountNumber: u(COMPANY.bank.accountNumber),
      iban: u(COMPANY.bank.iban),
      swift: u(COMPANY.bank.swift),
      bankName: u(COMPANY.bank.bankName),
    },
    items: pickPricedItems(job),
    deliveryNoteNumber: u(job.deliveryNoteNumber),
    constantSymbol: u(opts.constantSymbol),
    note: u(opts.note),
    preparedBy: u(opts.preparedBy) ?? u(job.owner?.name) ?? refs.contactPerson,
  };
}
