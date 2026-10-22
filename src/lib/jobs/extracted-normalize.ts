import type {
  CaptureDocKind, DocIssuer, ExtractedBusinessDoc, ExtractedItem, ExtractedParty,
} from "@/lib/jobs/capture-types";

/**
 * Úklid výstupu AI čtení dokladu (čistá logika, testovatelná). Cokoli přijde
 * (JSON z Claude, fixture, ruční vstup), vrátí se jako úplný ExtractedBusinessDoc:
 * chybějící → "", 0, []; ořezané texty; IČO jen číslice; DIČ velkými písmeny
 * bez mezer; data RRRR-MM-DD; množství a ceny jako nezáporná čísla.
 *
 * Navíc doplní odvozená čísla z čísla dokladu (objednávka zákazníka → číslo
 * objednávky zákazníka, naše nabídka → naše číslo nabídky…), ať párování
 * i plnění zakázky nemusí řešit, do kterého pole AI číslo dala.
 */

const DOC_KINDS: CaptureDocKind[] = [
  "poptavka", "nabidka", "objednavka", "potvrzeni", "dodaci_list", "faktura", "vykres", "ostatni",
];
const ISSUERS: DocIssuer[] = ["zakaznik", "my", "dodavatel", "neznamy"];

/** Časté varianty, které AI / člověk napíše jinak než enum. */
const DOC_KIND_ALIASES: Record<string, CaptureDocKind> = {
  poptavka_zakaznika: "poptavka", rfq: "poptavka", inquiry: "poptavka", anfrage: "poptavka",
  cenova_nabidka: "nabidka", quote: "nabidka", quotation: "nabidka", angebot: "nabidka",
  objednavka_zakaznika: "objednavka", order: "objednavka", purchase_order: "objednavka", po: "objednavka", bestellung: "objednavka",
  potvrzeni_objednavky: "potvrzeni", order_confirmation: "potvrzeni", auftragsbestatigung: "potvrzeni",
  dodaci: "dodaci_list", delivery_note: "dodaci_list", lieferschein: "dodaci_list", dl: "dodaci_list",
  invoice: "faktura", rechnung: "faktura", danovy_doklad: "faktura",
  drawing: "vykres", zeichnung: "vykres", jiny: "ostatni", other: "ostatni",
};
const ISSUER_ALIASES: Record<string, DocIssuer> = {
  customer: "zakaznik", odberatel: "zakaznik",
  we: "my", us: "my", nase_firma: "my", mnastrojarna: "my",
  supplier: "dodavatel", kooperant: "dodavatel", vendor: "dodavatel",
  unknown: "neznamy", nevim: "neznamy",
};

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function snake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** Hodnota pole — snese i snake_case varianty klíčů (document_number). */
function pick(o: Obj, key: string): unknown {
  if (key in o) return o[key];
  const s = snake(key);
  return s in o ? o[s] : undefined;
}

/** Bez diakritiky, malými písmeny. */
function fold(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]+/g, "").toLowerCase();
}

/** Jednořádkový text: ořez + sloučení mezer. */
export function cleanText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v !== "string") return "";
  return v.replace(/[\s  ]+/g, " ").trim();
}

/** Víceřádkový text (poznámka, shrnutí): zachová řádky, ořeže okraje. */
function cleanMultiline(v: unknown): string {
  if (typeof v !== "string") return cleanText(v);
  return v
    .split(/\r?\n/)
    .map((l) => l.replace(/[\t   ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeIco(v: unknown): string {
  return cleanText(v).replace(/\D+/g, "");
}

export function normalizeDic(v: unknown): string {
  return cleanText(v).replace(/[\s.\-/]+/g, "").toUpperCase();
}

function normalizeEmail(v: unknown): string {
  return cleanText(v).replace(/^mailto:/i, "").replace(/\s+/g, "").toLowerCase();
}

function validYmd(y: number, m: number, d: number): string {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return "";
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return "";
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > days) return "";
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Datum → RRRR-MM-DD, nebo "" když nejde přečíst.
 * Bere: 2026-03-12, 2026/03/12, 2026-03-12T10:00:00Z, 12.3.2026, 12. 3. 2026, 12/03/2026, 12.3.26.
 */
export function normalizeDate(v: unknown): string {
  const s = cleanText(v);
  if (!s) return "";
  let m = s.match(/^(\d{4})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})(?:[T\s].*)?$/);
  if (m) return validYmd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{2}|\d{4})$/);
  if (m) {
    let y = +m[3];
    if (m[3].length === 2) y += 2000;
    return validYmd(y, +m[2], +m[1]);
  }
  return "";
}

/**
 * Číslo z čehokoli rozumného: 50, "50 ks", "1 250,5", "1.250,50 Kč", "1,250.50".
 * Nečíselné → 0.
 */
export function parseNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v !== "string") return 0;
  let s = v.replace(/[\s  ']+/g, "");
  const m = s.match(/-?[\d.,]*\d/);
  if (!m) return 0;
  s = m[0];
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // oba oddělovače: poslední je desetinný
    const dec = lastComma > lastDot ? "," : ".";
    const thou = dec === "," ? "." : ",";
    s = s.split(thou).join("").replace(dec, ".");
  } else if (lastComma >= 0) {
    // jen čárky: jedna = desetinná (česky), víc = tisíce
    s = (s.match(/,/g)!.length > 1) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (lastDot >= 0 && (s.match(/\./g)!.length > 1)) {
    s = s.replace(/\./g, ""); // 1.250.000
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function nonNegative(v: unknown): number {
  const n = parseNumber(v);
  return n > 0 ? Math.round(n * 10000) / 10000 : 0;
}

function normalizeConfidence(v: unknown): number {
  let n = parseNumber(v);
  if (typeof v === "string" && v.includes("%")) n = n / 100;
  else if (n > 1 && n <= 100) n = n / 100; // AI občas vrátí procenta
  if (!(n > 0)) return 0;
  return Math.min(1, Math.round(n * 1000) / 1000);
}

function normalizeCurrency(v: unknown): string {
  const s = cleanText(v).toUpperCase();
  if (!s) return "";
  if (/^(KČ|KC|,-|CZK)$/.test(s)) return "CZK";
  if (s === "€" || s === "EURO") return "EUR";
  if (s === "$") return "USD";
  return s;
}

function normalizeEnum<T extends string>(v: unknown, values: T[], aliases: Record<string, T>, fallback: T): T {
  const s = fold(cleanText(v)).replace(/[\s-]+/g, "_");
  if ((values as string[]).includes(s)) return s as T;
  return aliases[s] ?? fallback;
}

export function emptyParty(): ExtractedParty {
  return {
    name: "", ico: "", dic: "", street: "", city: "", zip: "", country: "",
    email: "", phone: "", contactPerson: "",
  };
}

export function emptyExtracted(): ExtractedBusinessDoc {
  return {
    docKind: "ostatni", issuer: "neznamy", documentNumber: "", documentDate: "",
    customer: emptyParty(), supplier: emptyParty(),
    customerOrderNumber: "", customerInquiryNumber: "", ourQuoteNumber: "", ourJobNumber: "",
    ourOrderConfirmationNumber: "", supplierNumberAtCustomer: "",
    requiredDeliveryDate: "", promisedDeliveryDate: "",
    items: [], totalWithoutVat: 0, currency: "", paymentTerms: "", deliveryTerms: "",
    note: "", summary: "", confidence: 0, needsClarification: [],
  };
}

export function normalizeParty(raw: unknown): ExtractedParty {
  const o = isObj(raw) ? raw : {};
  return {
    name: cleanText(pick(o, "name")),
    ico: normalizeIco(pick(o, "ico")),
    dic: normalizeDic(pick(o, "dic")),
    street: cleanText(pick(o, "street")),
    city: cleanText(pick(o, "city")),
    zip: cleanText(pick(o, "zip")),
    country: cleanText(pick(o, "country")),
    email: normalizeEmail(pick(o, "email")),
    phone: cleanText(pick(o, "phone")),
    contactPerson: cleanText(pick(o, "contactPerson")),
  };
}

export function normalizeItem(raw: unknown): ExtractedItem | null {
  if (!isObj(raw)) return null;
  const item: ExtractedItem = {
    drawingNumber: cleanText(pick(raw, "drawingNumber")),
    revision: cleanText(pick(raw, "revision")),
    name: cleanText(pick(raw, "name")),
    description: cleanMultiline(pick(raw, "description")),
    material: cleanText(pick(raw, "material")),
    quantity: nonNegative(pick(raw, "quantity")),
    unit: cleanText(pick(raw, "unit")),
    unitPrice: nonNegative(pick(raw, "unitPrice")),
    deliveryDate: normalizeDate(pick(raw, "deliveryDate")),
  };
  if (!item.drawingNumber && !item.name && !item.description) return null;
  return item;
}

function normalizeStringList(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
  return arr.map((x) => cleanText(x)).filter(Boolean);
}

/**
 * Hlavní vstup: cokoli → úplný ExtractedBusinessDoc.
 * Přijme i JSON řetězec (např. text odpovědi AI).
 */
export function normalizeExtracted(raw: unknown): ExtractedBusinessDoc {
  let input: unknown = raw;
  if (typeof input === "string") {
    try { input = JSON.parse(input); } catch { input = {}; }
  }
  const o: Obj = isObj(input) ? input : {};
  const items = Array.isArray(pick(o, "items")) ? (pick(o, "items") as unknown[]) : [];

  const doc: ExtractedBusinessDoc = {
    ...emptyExtracted(),
    docKind: normalizeEnum(pick(o, "docKind"), DOC_KINDS, DOC_KIND_ALIASES, "ostatni"),
    issuer: normalizeEnum(pick(o, "issuer"), ISSUERS, ISSUER_ALIASES, "neznamy"),
    documentNumber: cleanText(pick(o, "documentNumber")),
    documentDate: normalizeDate(pick(o, "documentDate")),
    customer: normalizeParty(pick(o, "customer")),
    supplier: normalizeParty(pick(o, "supplier")),
    customerOrderNumber: cleanText(pick(o, "customerOrderNumber")),
    customerInquiryNumber: cleanText(pick(o, "customerInquiryNumber")),
    ourQuoteNumber: cleanText(pick(o, "ourQuoteNumber")),
    ourJobNumber: cleanText(pick(o, "ourJobNumber")),
    ourOrderConfirmationNumber: cleanText(pick(o, "ourOrderConfirmationNumber")),
    supplierNumberAtCustomer: cleanText(pick(o, "supplierNumberAtCustomer")),
    requiredDeliveryDate: normalizeDate(pick(o, "requiredDeliveryDate")),
    promisedDeliveryDate: normalizeDate(pick(o, "promisedDeliveryDate")),
    items: items.map(normalizeItem).filter((i): i is ExtractedItem => i !== null),
    totalWithoutVat: nonNegative(pick(o, "totalWithoutVat")),
    currency: normalizeCurrency(pick(o, "currency")),
    paymentTerms: cleanText(pick(o, "paymentTerms")),
    deliveryTerms: cleanText(pick(o, "deliveryTerms")),
    note: cleanMultiline(pick(o, "note")),
    summary: cleanMultiline(pick(o, "summary")),
    confidence: normalizeConfidence(pick(o, "confidence")),
    needsClarification: normalizeStringList(pick(o, "needsClarification")),
  };

  // Odvozená čísla z čísla dokladu (jen tam, kde je význam jednoznačný)
  const fromCustomer = doc.issuer === "zakaznik" || doc.issuer === "neznamy";
  if (doc.documentNumber) {
    if (doc.docKind === "objednavka" && fromCustomer && !doc.customerOrderNumber) {
      doc.customerOrderNumber = doc.documentNumber;
    }
    if (doc.docKind === "poptavka" && fromCustomer && !doc.customerInquiryNumber) {
      doc.customerInquiryNumber = doc.documentNumber;
    }
    if (doc.docKind === "nabidka" && doc.issuer === "my" && !doc.ourQuoteNumber) {
      doc.ourQuoteNumber = doc.documentNumber;
    }
    if (doc.docKind === "potvrzeni" && doc.issuer === "my" && !doc.ourOrderConfirmationNumber) {
      doc.ourOrderConfirmationNumber = doc.documentNumber;
    }
  }
  return doc;
}
