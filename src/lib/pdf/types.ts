// Datový model dokladů (PDF) + čisté formátovací a výpočetní funkce (bez DB, testovatelné).

export interface PartyInfo {
  name: string;
  street?: string;
  city?: string;
  zip?: string;
  ico?: string;
  dic?: string;
  country?: string;
  /** Kontakty — u dodavatele (nás) z COMPANY, u odběratele volitelně. */
  email?: string;
  phone?: string;
  web?: string;
  /** Zápis v obchodním rejstříku. */
  registration?: string;
}

export interface DocItem {
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  vatRate: number; // %
  drawingNumber?: string;
  revision?: string;
  material?: string;
  /** Doplňující text pod popisem (drobně, šedě). */
  note?: string;
  /** Cena zatím nestanovena — v tabulce „—" místo 0 Kč. */
  unpriced?: boolean;
}

/** Položka dodacího listu — bez cen. */
export interface DeliveryItem {
  description: string;
  quantity: number;
  unit: string;
  drawingNumber?: string;
  revision?: string;
  material?: string;
  note?: string;
}

/** Společné nepovinné reference všech dokladů (zakázka, zákazník, lidé). */
export interface DocRefs {
  /** Naše číslo zakázky (Z-2026-014). */
  jobNumber?: string;
  /** Číslo objednávky zákazníka a její datum. */
  customerOrderNumber?: string;
  customerOrderDate?: string;
  /** Číslo poptávky zákazníka. */
  customerInquiryNumber?: string;
  /** Naše číslo zákazníka. */
  customerNumber?: string;
  /** Naše číslo dodavatele v systému zákazníka. */
  supplierNumberAtCustomer?: string;
  /** Naše kontaktní osoba (vyřizuje). */
  contactPerson?: string;
  contactEmail?: string;
  contactPhone?: string;
  /** Kontaktní osoba na straně zákazníka. */
  customerContact?: string;
  customerContactEmail?: string;
  /** Dodací adresa (víceřádková přes „\n" nebo čárky). */
  deliveryAddress?: string;
  /** Vypracoval / vystavil. */
  preparedBy?: string;
  /** Schválil. */
  approvedBy?: string;
}

export interface InvoiceData extends DocRefs {
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
  constantSymbol?: string;
  deliveryNoteNumber?: string;
}

export interface QuoteData extends DocRefs {
  number: string;
  issueDate: string;
  validUntil?: string;
  currency: string;
  supplier: PartyInfo;
  customer: PartyInfo;
  items: DocItem[];
  note?: string;
  /** Předmět nabídky (např. „Frézované díly VK-2291"). */
  subject?: string;
  /** Úvodní text; undefined = výchozí poděkování, "" = bez úvodu. */
  intro?: string;
  /** Verze nabídky (zobrazí se od 2). */
  revision?: number;
  /** Termín dodání (datum) nebo slovně dodací lhůta. */
  deliveryDate?: string;
  leadTimeText?: string;
  paymentTerms?: string;
  deliveryTerms?: string;
  /** Závěrečná věta; undefined = výchozí. */
  closing?: string;
}

export interface ConfirmationData extends DocRefs {
  number: string;
  issueDate: string;
  currency: string;
  supplier: PartyInfo;
  customer: PartyInfo;
  items: DocItem[];
  /** Potvrzený termín dodání (velký odznak). */
  confirmedDeliveryDate?: string;
  /** Dle naší nabídky č. */
  quoteNumber?: string;
  intro?: string;
  leadTimeText?: string;
  paymentTerms?: string;
  deliveryTerms?: string;
  note?: string;
}

export interface DeliveryNoteData extends DocRefs {
  number: string;
  issueDate: string;
  /** Starší pole „K objednávce" (volné číslo). */
  orderNumber?: string;
  supplier: PartyInfo;
  customer: PartyInfo;
  items: DeliveryItem[];
  note?: string;
  /** Počet balení / koleter. */
  packages?: number;
  /** Celková hmotnost v kg. */
  weightKg?: number;
  /** Způsob dopravy. */
  transport?: string;
}

// ── Formátování (cs-CZ) ─────────────────────────────────────

export function czk(value: number, currency = "CZK"): string {
  return new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency: currency || "CZK",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Množství: 50 / 2,5 / 1 250. */
export function czNumber(value: number): string {
  return new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 3 }).format(value);
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

/** „2026-10-22" i ISO timestamp → „22. 10. 2026" (bez posunu časovou zónou). */
export function czDate(value: string): string {
  const m = ISO_DATE.exec(value ?? "");
  if (m) return `${Number(m[3])}. ${Number(m[2])}. ${m[1]}`;
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("cs-CZ", { timeZone: "Europe/Prague" }).format(d);
}

/** Den v týdnu („pátek") k ISO datu, jinak "". */
export function czWeekday(value: string): string {
  const m = ISO_DATE.exec(value ?? "");
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return new Intl.DateTimeFormat("cs-CZ", { weekday: "long", timeZone: "UTC" }).format(d);
}

/** Dnešní datum v Praze jako YYYY-MM-DD. */
export function todayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Prague" }).format(now);
}

/** ISO datum + n dní (kalendářních). */
export function addDaysIso(iso: string, days: number): string {
  const m = ISO_DATE.exec(iso);
  const base = m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : Date.now();
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}

/** Česká plurálová forma: plural(3, "den", "dny", "dní"). */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n);
  if (a === 1) return one;
  if (a >= 2 && a <= 4) return few;
  return many;
}

/** Dodací lhůta slovně: 21 → „3 týdny", 10 → „10 dní". */
export function leadTimeLabel(days: number): string {
  if (days > 0 && days % 7 === 0) {
    const w = days / 7;
    return `${w} ${plural(w, "týden", "týdny", "týdnů")}`;
  }
  return `${days} ${plural(days, "den", "dny", "dní")}`;
}

/** Je text jen zástupný („doplnit…")? Takové údaje na doklady nepatří. */
export function isPlaceholder(value?: string | null): boolean {
  if (!value || !value.trim()) return true;
  return /doplnit|doplň|TODO|xxx/i.test(value);
}

const CZECH = ["cz", "cze", "česko", "česká republika", "czech republic", "czechia"];
const COUNTRY_NAMES: Record<string, string> = {
  sk: "Slovensko", de: "Německo", at: "Rakousko", pl: "Polsko", hu: "Maďarsko",
  it: "Itálie", fr: "Francie", nl: "Nizozemsko", ch: "Švýcarsko", gb: "Velká Británie",
};

export function isCzechCountry(country?: string | null): boolean {
  return !country || CZECH.includes(country.trim().toLowerCase());
}

/** Kód země → český název (CZ → „Česká republika"). */
export function countryName(country?: string | null): string | undefined {
  if (!country) return undefined;
  const k = country.trim().toLowerCase();
  if (CZECH.includes(k)) return "Česká republika";
  return COUNTRY_NAMES[k] ?? country.trim();
}

// ── Součty a DPH ────────────────────────────────────────────

export interface VatBreakdownRow {
  rate: number;
  base: number;
  vat: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function lineTotal(it: Pick<DocItem, "quantity" | "unitPrice">): number {
  return round2(it.quantity * it.unitPrice);
}

/** Rekapitulace DPH: základ po sazbách, daň zaokrouhlená na haléře za každou sazbu. */
export function computeTotals(items: DocItem[]) {
  const byRate = new Map<number, number>();
  for (const it of items) {
    byRate.set(it.vatRate, (byRate.get(it.vatRate) ?? 0) + lineTotal(it));
  }
  const breakdown: VatBreakdownRow[] = [...byRate.entries()]
    .map(([rate, base]) => ({ rate, base: round2(base), vat: round2((base * rate) / 100) }))
    .sort((a, b) => b.rate - a.rate);
  const subtotal = round2(breakdown.reduce((s, r) => s + r.base, 0));
  const vatTotal = round2(breakdown.reduce((s, r) => s + r.vat, 0));
  return { breakdown, subtotal, vatTotal, total: round2(subtotal + vatTotal) };
}
