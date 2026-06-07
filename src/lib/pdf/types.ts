export interface PartyInfo {
  name: string;
  street?: string;
  city?: string;
  zip?: string;
  ico?: string;
  dic?: string;
  country?: string;
}

export interface DocItem {
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  vatRate: number; // %
}

export interface InvoiceData {
  number: string;
  variableSymbol: string;
  issueDate: string; // YYYY-MM-DD
  taxableDate: string; // DUZP
  dueDate: string;
  paymentMethod: string;
  currency: string;
  supplier: PartyInfo;
  customer: PartyInfo;
  bank?: { accountNumber?: string; iban?: string; swift?: string; bankName?: string };
  items: DocItem[];
  note?: string;
}

export interface QuoteData {
  number: string;
  issueDate: string;
  validUntil?: string;
  currency: string;
  supplier: PartyInfo;
  customer: PartyInfo;
  items: DocItem[];
  note?: string;
}

export interface DeliveryNoteData {
  number: string;
  issueDate: string;
  orderNumber?: string;
  supplier: PartyInfo;
  customer: PartyInfo;
  deliveryAddress?: string;
  items: { description: string; quantity: number; unit: string }[];
  note?: string;
}

export function czk(value: number, currency = "CZK"): string {
  return new Intl.NumberFormat("cs-CZ", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

export function czDate(value: string): string {
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("cs-CZ").format(d);
}

export interface VatBreakdownRow {
  rate: number;
  base: number;
  vat: number;
}

export function computeTotals(items: DocItem[]) {
  const byRate = new Map<number, { base: number; vat: number }>();
  for (const it of items) {
    const base = it.quantity * it.unitPrice;
    const vat = (base * it.vatRate) / 100;
    const cur = byRate.get(it.vatRate) ?? { base: 0, vat: 0 };
    cur.base += base;
    cur.vat += vat;
    byRate.set(it.vatRate, cur);
  }
  const breakdown: VatBreakdownRow[] = [...byRate.entries()]
    .map(([rate, v]) => ({ rate, base: v.base, vat: v.vat }))
    .sort((a, b) => a.rate - b.rate);
  const subtotal = breakdown.reduce((s, r) => s + r.base, 0);
  const vatTotal = breakdown.reduce((s, r) => s + r.vat, 0);
  return { breakdown, subtotal, vatTotal, total: subtotal + vatTotal };
}
