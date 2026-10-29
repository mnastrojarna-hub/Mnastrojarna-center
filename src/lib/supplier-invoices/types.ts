// Kontrakt faktur dodavatelů (sdílí server i klient — bez server-only).
import type { ExtractedParty } from "@/lib/jobs/capture-types";
import type {
  OverheadCategory, SupplierInvoicePaymentStatus, SupplierInvoiceSource, SupplierInvoiceStatus, SupplierInvoiceTarget,
} from "@/lib/supplier-invoices/db-types";

export type {
  OverheadCategory, SupplierInvoicePaymentStatus, SupplierInvoiceSource, SupplierInvoiceStatus, SupplierInvoiceTarget,
};

// ── AI vytěžení ─────────────────────────────────────────────
/** Dodavatel z hlavičky faktury (vystavitel). */
export interface InvoiceSupplierParty extends ExtractedParty {
  /** Číslo účtu („123456789/0100") nebo IBAN. */
  bankAccount: string;
}

export interface SupplierInvoiceExtractItem {
  /** Text řádku přesně jak je na faktuře („Výroba dle obj. OV-2026-014"). */
  text: string;
  /** Kód / číslo výkresu / artiklu na řádku. */
  code: string;
  quantity: number;
  unit: string;
  /** Cena za MJ bez DPH (0 = neuvedeno). */
  unitPrice: number;
  /** Celkem řádek bez DPH (sleva záporně). */
  amount: number;
  /** Sazba DPH v % (21, 12, 0); -1 = neuvedeno. */
  vatRate: number;
  /** Čísla dokladů zmíněná v řádku (naše objednávka OV-…, zakázka Z-…, objednávka zákazníka, DL, výkres). */
  refs: string[];
}

export interface SupplierInvoiceRefs {
  /** Naše objednávky dodavateli (OV-2026-014). */
  purchaseOrderNumbers: string[];
  /** Naše zakázky (Z-2026-014). */
  jobNumbers: string[];
  /** Objednávky našeho zákazníka (PO-4471). */
  customerOrderNumbers: string[];
  /** Dodací listy dodavatele. */
  deliveryNoteNumbers: string[];
  /** Čísla výkresů / dílů. */
  drawingNumbers: string[];
}

export interface SupplierInvoiceExtract {
  supplier: InvoiceSupplierParty;
  number: string;
  variableSymbol: string;
  /** RRRR-MM-DD | "" */
  issueDate: string;
  taxableDate: string;
  dueDate: string;
  currency: string;
  totalNet: number;
  totalVat: number;
  totalGross: number;
  items: SupplierInvoiceExtractItem[];
  references: SupplierInvoiceRefs;
  isCreditNote: boolean;
  isProforma: boolean;
  /** Kurz ČNB / dle faktury v Kč za 1 jednotku měny, je-li na faktuře (0 = neuvedeno). */
  exchangeRate: number;
  confidence: number;
  summary: string;
  needsClarification: string[];
}

// ── Pohledy (data → UI) ─────────────────────────────────────
export interface SupplierInvoicePerms {
  /** Nahrát fakturu (všichni). */
  upload: boolean;
  /** Vidět faktury (seznam, detail, soubory, rozdělení). */
  view: boolean;
  /** Vidět částky (bez nich jen texty a zakázky). */
  amounts: boolean;
  /** Měnit položky, rozdělení, dodavatele, potvrzovat. */
  edit: boolean;
  /** Zaplaceno / nezaplaceno (vždy jen super admin). */
  paid: boolean;
}

export interface JobRefView {
  id: string;
  number: string;
  title: string;
  customerName: string | null;
}

export interface SupplierInvoiceListItem {
  id: string;
  number: string | null;
  supplierId: string | null;
  supplierName: string | null;
  issueDate: string | null;
  dueDate: string | null;
  currency: string;
  /** null = bez práva na částky. */
  totalNet: number | null;
  totalGross: number | null;
  status: SupplierInvoiceStatus;
  /** null = bez práva na zaplaceno. */
  paymentStatus: SupplierInvoicePaymentStatus | null;
  paidAt: string | null;
  /** Uhrazeno u částečné úhrady (null bez práva na zaplaceno). */
  paidAmount: number | null;
  /** Po splatnosti a nezaplaceno (null bez práva na zaplaceno). */
  overdue: boolean | null;
  /** Nerozdělená částka (null bez práva na částky). */
  unallocated: number | null;
  /** Zálohová faktura (do nákladů se nepočítá). */
  isProforma: boolean;
  /** Cizí měna bez kurzu (náklad zakázky nejde spočítat). */
  missingRate: boolean;
  /** Čeká na potvrzení návrhů AI. */
  pendingAi: number;
  jobs: { id: string; number: string }[];
  hasOverhead: boolean;
  duplicateOfId: string | null;
  source: SupplierInvoiceSource;
  uploadedByName: string | null;
  createdAt: string;
  fileCount: number;
}

export interface SupplierInvoiceTotals {
  count: number;
  /** Součty v Kč (CZK + cizí měny s kurzem). */
  net: number | null;
  gross: number | null;
  unpaid: number | null;
  overdue: number | null;
  unallocated: number | null;
  /** Faktury v cizí měně BEZ kurzu — sečtené zvlášť v jejich měně (nikdy 1:1 jako Kč). */
  foreign: { currency: string; count: number; net: number; gross: number }[] | null;
}

export interface SupplierInvoiceFileView {
  id: string;
  filename: string;
  mimeType: string | null;
  size: number | null;
  /** /api/supplier-invoices/files/<id> (kontrola práv při každém čtení). */
  href: string;
}

export interface SupplierInvoiceItemView {
  id: string;
  position: number;
  text: string;
  code: string | null;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  /** null = bez práva na částky. */
  amount: number | null;
  vatRate: number | null;
}

export interface SupplierInvoiceAllocationView {
  id: string;
  itemId: string | null;
  target: SupplierInvoiceTarget;
  job: JobRefView | null;
  category: OverheadCategory | null;
  /** null = bez práva na částky. */
  amount: number | null;
  purchaseOrderId: string | null;
  purchaseOrderNumber: string | null;
  purchaseOrderItemId: string | null;
  orderItemId: string | null;
  orderItemLabel: string | null;
  note: string | null;
  aiSuggested: boolean;
  aiReason: string | null;
  confirmed: boolean;
  confirmedAt: string | null;
  confirmedByName: string | null;
}

export interface SupplierRefView {
  id: string;
  name: string;
  ico: string | null;
  dic: string | null;
}

export interface SupplierInvoiceDetail {
  id: string;
  number: string | null;
  variableSymbol: string | null;
  issueDate: string | null;
  taxableDate: string | null;
  dueDate: string | null;
  currency: string;
  exchangeRate: number | null;
  totalNet: number | null;
  totalVat: number | null;
  totalGross: number | null;
  status: SupplierInvoiceStatus;
  paymentStatus: SupplierInvoicePaymentStatus | null;
  paidAt: string | null;
  paidAmount: number | null;
  paidByName: string | null;
  overdue: boolean | null;
  source: SupplierInvoiceSource;
  isCreditNote: boolean;
  /** Zálohová (proforma) faktura — do nákladů se nepočítá. */
  isProforma: boolean;
  /** Cizí měna bez kurzu — „Chybí kurz — doplň". */
  missingRate: boolean;
  supplier: SupplierRefView | null;
  /** Hlavička dodavatele z faktury (návrh nového / doplnění). */
  supplierHeader: {
    name: string; ico: string; dic: string; address: string; bankAccount: string; email: string; phone: string;
  };
  /** Návrh shody s adresářem (podle IČO / DIČ / názvu), když supplier ještě není přiřazený. */
  supplierMatch: (SupplierRefView & { reason: string }) | null;
  duplicateOf: { id: string; number: string | null; createdAt: string } | null;
  aiUsed: boolean;
  aiConfidence: number | null;
  aiError: string | null;
  aiProcessedAt: string | null;
  aiSummary: string | null;
  needsClarification: string[];
  note: string | null;
  uploadedByName: string | null;
  createdAt: string;
  processedByName: string | null;
  processedAt: string | null;
  files: SupplierInvoiceFileView[];
  items: SupplierInvoiceItemView[];
  allocations: SupplierInvoiceAllocationView[];
  /** Otevřené objednávky dodavatele (pro výběr vazby). */
  supplierPurchaseOrders: { id: string; number: string | null; job: JobRefView | null; total: number | null; status: string }[];
  /**
   * Objednávky, na které je faktura rozdělená: kolik je na ně vyfakturováno (všemi fakturami, potvrzeno, Kč),
   * jestli jsou vyfakturované celé a jestli je tahle faktura konečná (null = bez práva na částky).
   */
  purchaseOrderInvoicing: PurchaseOrderInvoicingView[];
  perms: SupplierInvoicePerms;
}

export interface PurchaseOrderInvoicingView {
  id: string;
  number: string | null;
  jobNumber: string | null;
  total: number | null;
  /** Σ potvrzených řádků všech faktur na objednávku v Kč (null = bez práva / chybí kurz). */
  invoiced: number | null;
  /** Objednávka je vyfakturovaná celá (konečná faktura, ≥ 99,5 % nebo všechny položky). */
  complete: boolean;
  /** Tahle faktura je u objednávky označená jako konečná. */
  final: boolean;
}

/** Řádek bloku „Faktury dodavatelů" v Nákupu zakázky. */
export interface JobInvoiceAllocationView {
  id: string;
  invoiceId: string;
  invoiceNumber: string | null;
  supplierName: string | null;
  itemText: string | null;
  amount: number;
  /** null = cizí měna bez kurzu (nepočítá se, náklad je neznámý). */
  amountCzk: number | null;
  currency: string;
  purchaseOrderNumber: string | null;
  orderItemLabel: string | null;
  confirmed: boolean;
  aiSuggested: boolean;
  issueDate: string | null;
}

export interface JobInvoiceCosts {
  allocations: JobInvoiceAllocationView[];
  /** Σ potvrzených v Kč. */
  confirmedTotal: number;
  /** Σ nepotvrzených návrhů v Kč. */
  pendingTotal: number;
  /** Objednávky dodavatelům s fakturou: částka objednávky, fakturováno, celá / dílčí, co jde do nákladu. */
  invoicedPurchaseOrders: { id: string; number: string | null; poTotal: number; invoiced: number; complete: boolean; counted: number }[];
  /** Některá faktura je v cizí měně bez kurzu (náklad zakázky neznámý). */
  missingRate: boolean;
}

// ── Vstup rozdělení (klient → server) ───────────────────────
export interface AllocationInput {
  /** Existující řádek (jinak nový). */
  id?: string | null;
  itemId: string | null;
  target: SupplierInvoiceTarget;
  jobId: string | null;
  category: OverheadCategory | null;
  amount: number;
  purchaseOrderId?: string | null;
  purchaseOrderItemId?: string | null;
  orderItemId?: string | null;
  note?: string | null;
  aiSuggested?: boolean;
  aiReason?: string | null;
  confirmed: boolean;
}

export const OVERHEAD_CATEGORIES: { key: OverheadCategory; label: string }[] = [
  { key: "doprava", label: "Doprava" },
  { key: "naradi", label: "Nářadí" },
  { key: "energie", label: "Energie" },
  { key: "material", label: "Režijní materiál" },
  { key: "sluzby", label: "Služby" },
  { key: "ostatni", label: "Ostatní režie" },
];

export function overheadLabel(c: OverheadCategory | null | undefined): string {
  return OVERHEAD_CATEGORIES.find((x) => x.key === c)?.label ?? "Režie";
}

export const INVOICE_STATUS_META: Record<SupplierInvoiceStatus, { label: string; tone: string }> = {
  nahrano: { label: "Nahráno", tone: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300" },
  ke_kontrole: { label: "Ke kontrole", tone: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300" },
  zpracovano: { label: "Zpracováno", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" },
  zamitnuto: { label: "Zamítnuto", tone: "bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300" },
};

export const PAYMENT_STATUS_META: Record<SupplierInvoicePaymentStatus, { label: string; tone: string }> = {
  nezaplaceno: { label: "Nezaplaceno", tone: "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300" },
  castecne: { label: "Částečně", tone: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300" },
  zaplaceno: { label: "Zaplaceno", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" },
};

export const SOURCE_LABEL: Record<SupplierInvoiceSource, string> = {
  photo: "foto", scan: "sken", upload: "nahráno", email: "e-mail",
};

/** Text pro každého, kdo fakturu nahrál bez práva ji vidět. */
export const THANKS_TEXT = "Děkujeme, nahráno — fakturu zpracuje super admin.";
