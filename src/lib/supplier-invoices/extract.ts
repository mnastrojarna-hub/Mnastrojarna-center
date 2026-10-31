// Normalizace vytěžení faktury dodavatele (výstup AI / fixture / převod z obchodního dokladu).
import type { ExtractedBusinessDoc } from "@/lib/jobs/capture-types";
import type {
  InvoiceDocumentType, InvoiceSupplierParty, SupplierInvoiceExtract, SupplierInvoiceExtractItem, SupplierInvoiceRefs, VatBreakdownRow,
} from "@/lib/supplier-invoices/types";
import { round2 } from "@/lib/supplier-invoices/money";

type Raw = Record<string, unknown>;

export const INVOICE_DOCUMENT_TYPES: readonly InvoiceDocumentType[] = [
  "faktura", "zalohova_faktura", "dobropis", "dodaci_list", "nabidka", "objednavka", "potvrzeni_objednavky", "upominka", "jiny",
];

/** Druh dokladu z AI; neznámý / chybějící = faktura (starší vytěžení, fixture). */
export function normalizeDocumentType(v: unknown): InvoiceDocumentType {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return (INVOICE_DOCUMENT_TYPES as readonly string[]).includes(s) ? (s as InvoiceDocumentType) : "faktura";
}

function vatRows(v: unknown): VatBreakdownRow[] {
  const out: VatBreakdownRow[] = [];
  for (const r of Array.isArray(v) ? v.slice(0, 10) : []) {
    const o = r && typeof r === "object" && !Array.isArray(r) ? (r as Raw) : {};
    const rate = num(o.rate);
    const base = num(o.base);
    const vat = num(o.vat);
    if (rate < 0 || rate > 100 || !within(base, MAX_INVOICE_AMOUNT) || !within(vat, MAX_INVOICE_AMOUNT) || (!base && !vat)) continue;
    out.push({ rate, base: round2(base), vat: round2(vat) });
  }
  return out;
}

const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const str = (v: unknown, max = 300): string => (typeof v === "string" ? v.replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, max) : typeof v === "number" ? String(v) : "");
const num = (v: unknown): number => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[\s ]+/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};
const strList = (v: unknown, max = 30): string[] =>
  (Array.isArray(v) ? v : []).map((x) => str(x, 80)).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).slice(0, max);

/** RRRR-MM-DD, jinak "" (přijme i 29. 10. 2026 / 29.10.2026). */
export function isoDate(v: unknown): string {
  const s = str(v, 40);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return validIso(s);
  const m = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/.exec(s);
  if (m) return validIso(`${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`);
  return "";
}

function validIso(s: string): string {
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? "" : s;
}

export function normalizeCurrency(v: unknown): string {
  const s = str(v, 10).toUpperCase().replace("KČ", "CZK").replace("€", "EUR");
  return /^[A-Z]{3}$/.test(s) ? s : "CZK";
}

function party(v: unknown): InvoiceSupplierParty {
  const o = obj(v);
  return {
    name: str(o.name), ico: str(o.ico, 20).replace(/\D+/g, ""), dic: str(o.dic, 20).replace(/\s+/g, "").toUpperCase(),
    street: str(o.street), city: str(o.city), zip: str(o.zip, 20), country: str(o.country, 2).toUpperCase() || "CZ",
    email: str(o.email, 200).toLowerCase(), phone: str(o.phone, 60), contactPerson: str(o.contactPerson, 200),
    bankAccount: str(o.bankAccount, 60) || str(o.iban, 60),
  };
}

/** Meze sloupců v DB (numeric(14,2) / (14,4) / (14,3)) s rezervou — větší číslo je chyba čtení. */
export const MAX_INVOICE_AMOUNT = 1e10;
export const MAX_UNIT_PRICE = 1e9;
export const MAX_QUANTITY = 1e8;

const within = (n: number, max: number) => Number.isFinite(n) && Math.abs(n) < max;

/** Řádek faktury; „bad" = nesmyslné číslo (řádek se vynechá a člověk to dostane k ověření). */
function item(v: unknown): SupplierInvoiceExtractItem | null | "bad" {
  const o = obj(v);
  const text = str(o.text, 500) || str(o.name, 500);
  let quantity = num(o.quantity);
  let unitPrice = num(o.unitPrice);
  let amount = num(o.amount);
  if (!within(quantity, MAX_QUANTITY)) quantity = 0;
  if (!within(unitPrice, MAX_UNIT_PRICE)) unitPrice = 0;
  if (!amount && quantity && unitPrice) amount = quantity * unitPrice;
  if (!within(amount, MAX_INVOICE_AMOUNT)) return "bad";
  if (!text && !amount) return null;
  const vat = o.vatRate === undefined || o.vatRate === null || o.vatRate === "" ? -1 : num(o.vatRate);
  return {
    text, code: str(o.code, 80) || str(o.drawingNumber, 80), quantity, unit: str(o.unit, 20), unitPrice,
    amount: round2(amount), vatRate: vat < 0 || vat > 100 ? -1 : vat, refs: strList(o.refs, 10),
  };
}

function refs(v: unknown): SupplierInvoiceRefs {
  const o = obj(v);
  return {
    purchaseOrderNumbers: strList(o.purchaseOrderNumbers), jobNumbers: strList(o.jobNumbers),
    customerOrderNumbers: strList(o.customerOrderNumbers), deliveryNoteNumbers: strList(o.deliveryNoteNumbers),
    drawingNumbers: strList(o.drawingNumbers, 60),
  };
}

export function emptySupplierInvoiceExtract(): SupplierInvoiceExtract {
  return normalizeSupplierInvoice({});
}

/** Úplný a uklizený objekt z čehokoli (výstup AI, fixture, uložené ai_extracted). */
export function normalizeSupplierInvoice(raw: unknown): SupplierInvoiceExtract {
  const o = obj(raw);
  const notes: string[] = [];
  const parsed = (Array.isArray(o.items) ? o.items : []).map(item);
  const bad = parsed.filter((x) => x === "bad").length;
  if (bad) notes.push(`${bad === 1 ? "Jeden řádek faktury má" : `${bad} řádky faktury mají`} nesmyslnou částku — doplň ${bad === 1 ? "ho" : "je"} ručně.`);
  const items = parsed.filter((x): x is SupplierInvoiceExtractItem => Boolean(x) && x !== "bad").slice(0, 200);
  const total = (v: unknown, label: string): number => {
    const n = num(v);
    if (within(n, MAX_INVOICE_AMOUNT)) return round2(n);
    notes.push(`${label} faktury se nedá přečíst — doplň ho ručně.`);
    return 0;
  };
  let totalNet = total(o.totalNet, "Součet bez DPH");
  const totalVat = total(o.totalVat, "Součet DPH");
  let totalGross = total(o.totalGross, "Součet s DPH");
  if (!totalNet && items.length) totalNet = round2(items.reduce((s, i) => s + i.amount, 0));
  if (!totalGross && totalNet) totalGross = round2(totalNet + totalVat);
  if (!totalNet && totalGross) totalNet = round2(totalGross - totalVat);
  if (!within(totalNet, MAX_INVOICE_AMOUNT)) totalNet = 0;
  const confidence = Math.min(1, Math.max(0, num(o.confidence)));
  const rate = num(o.exchangeRate);
  return {
    supplier: party(o.supplier),
    documentType: normalizeDocumentType(o.documentType),
    number: str(o.number, 60),
    variableSymbol: str(o.variableSymbol, 20).replace(/\D+/g, ""),
    issueDate: isoDate(o.issueDate),
    taxableDate: isoDate(o.taxableDate),
    dueDate: isoDate(o.dueDate),
    currency: normalizeCurrency(o.currency),
    totalNet, totalVat, totalGross,
    vatBreakdown: vatRows(o.vatBreakdown),
    items,
    references: refs(o.references),
    isCreditNote: o.isCreditNote === true || totalNet < 0,
    isProforma: o.isProforma === true,
    // kurz jen rozumný (Kč za 1 jednotku); jinak se doplní z ČNB
    exchangeRate: rate > 0 && rate < 100_000 ? Math.round(rate * 1e6) / 1e6 : 0,
    confidence: notes.length ? Math.min(confidence, 0.5) : confidence,
    summary: str(o.summary, 500),
    needsClarification: [...notes, ...strList(o.needsClarification, 10)].slice(0, 12),
  };
}

/** Převod obchodního dokladu (vytěžení dávky / ruční formulář) na fakturu — když čtečka faktur neběžela. */
export function invoiceFromBusinessDoc(doc: ExtractedBusinessDoc): SupplierInvoiceExtract {
  return normalizeSupplierInvoice({
    supplier: { ...doc.supplier, bankAccount: "" },
    number: doc.documentNumber,
    issueDate: doc.documentDate,
    currency: doc.currency,
    totalNet: doc.totalWithoutVat,
    items: doc.items.map((i) => ({
      text: [i.name, i.description].filter(Boolean).join(" — ") || i.drawingNumber,
      code: i.drawingNumber, quantity: i.quantity, unit: i.unit, unitPrice: i.unitPrice, amount: i.quantity * i.unitPrice,
      refs: [],
    })),
    references: {
      purchaseOrderNumbers: doc.customerOrderNumber ? [doc.customerOrderNumber] : [],
      jobNumbers: doc.ourJobNumber ? [doc.ourJobNumber] : [],
      drawingNumbers: doc.items.map((i) => i.drawingNumber).filter(Boolean),
    },
    confidence: doc.confidence,
    summary: doc.summary,
    needsClarification: doc.needsClarification,
  });
}

/** Obchodní doklad z faktury (kontrola dávky a párování dodavatele počítají s ExtractedBusinessDoc). */
export function businessDocFromInvoice(inv: SupplierInvoiceExtract, base: ExtractedBusinessDoc): ExtractedBusinessDoc {
  const { bankAccount: _bank, ...supplier } = inv.supplier;
  void _bank;
  return {
    ...base,
    docKind: "faktura",
    issuer: "dodavatel",
    documentNumber: inv.number,
    documentDate: inv.issueDate,
    supplier,
    customerOrderNumber: inv.references.purchaseOrderNumbers[0] ?? "",
    ourJobNumber: inv.references.jobNumbers[0] ?? "",
    items: inv.items.map((i) => ({
      drawingNumber: i.code, revision: "", name: i.text.slice(0, 300), description: "", material: "",
      quantity: i.quantity, unit: i.unit, unitPrice: i.unitPrice || (i.quantity ? round2(i.amount / i.quantity) : i.amount), deliveryDate: "",
    })),
    totalWithoutVat: inv.totalNet,
    currency: inv.currency,
    summary: inv.summary,
    confidence: inv.confidence,
    needsClarification: inv.needsClarification,
  };
}

/** Adresa dodavatele jedním řádkem. */
export function partyAddress(p: Pick<InvoiceSupplierParty, "street" | "city" | "zip" | "country">): string {
  const city = [p.zip, p.city].filter(Boolean).join(" ");
  return [p.street, city, p.country && p.country !== "CZ" ? p.country : ""].filter(Boolean).join(", ");
}
