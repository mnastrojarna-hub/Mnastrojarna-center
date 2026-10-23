// View-modely nákupní strany zakázky (nabídky dodavatelů, objednávky vydané, provize).
// Čisté typy — sdílí UI, datová vrstva i akce. Nákupní ceny vidí jen role s právem „margins".
import type { CommissionStatus, JobStage, PurchaseOrderStatus } from "@/lib/supabase/database.types";
import type { PersonRef } from "@/lib/jobs/types";
import type { ChangeStamp } from "@/lib/jobs/flow-status";

export type SupplierQuoteSource = "manual" | "foto" | "email" | "ai";

/** Položka nabídky dodavatele i objednávky vydané (stejné sloupce v DB). */
export interface PurchaseItem {
  id: string | null;
  position: number;
  drawingNumber: string | null;
  name: string | null;
  material: string | null;
  quantity: number;
  unit: string;
  /** Nákupní cena / MJ bez DPH; null = cena neuvedena. */
  unitPrice: number | null;
  note: string | null;
  /** Objednávka dodavateli: převzaté množství (0 = nic). */
  receivedQuantity?: number;
  /** Uzavřeno s menším množstvím (zmetky, dodavatel víc nedodá). */
  receiptClosed?: boolean;
  receiptClosedReason?: string | null;
  /** Vazba na položku zakázky (order_items.id). */
  orderItemId?: string | null;
}

/** Dodavatel z adresáře (pro objednávku, PDF a e-mail). */
export interface PurchaseSupplierRef {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  ico: string | null;
  dic: string | null;
  /** Adresa jedním řetězcem („Ulice 1, 530 02 Pardubice"). */
  address: string | null;
  contactPerson: string | null;
  country: string | null;
}

/** Nabídka dodavatele k zakázce. */
export interface SupplierQuoteView {
  id: string;
  jobId: string;
  /** Dodavatel z adresáře; null = jen volný název (supplierName). */
  supplier: PurchaseSupplierRef | null;
  /** Zobrazované jméno dodavatele (z adresáře, jinak volný text). */
  supplierName: string;
  number: string | null;
  quoteDate: string | null;
  validUntil: string | null;
  leadTimeDays: number | null;
  /** Termín dodání dle nabídky. */
  deliveryDate: string | null;
  currency: string;
  /** Celkem bez DPH. */
  total: number | null;
  /** Vítězná nabídka (max. jedna na zakázku). */
  selected: boolean;
  note: string | null;
  /** Sken / PDF nabídky v Dokumentech zakázky. */
  fileId: string | null;
  source: SupplierQuoteSource;
  createdBy: PersonRef | null;
  createdAt: string;
  updatedAt: string;
  items: PurchaseItem[];
  /** Kdo nabídku vybral jako vítěznou (selected_by/at plní DB trigger). */
  selectedStamp?: ChangeStamp | null;
}

/** Objednávka vydaná dodavateli (OV-2026-004). */
export interface PurchaseOrderView {
  id: string;
  jobId: string;
  number: string;
  status: PurchaseOrderStatus;
  supplier: PurchaseSupplierRef | null;
  /** Nabídka dodavatele, ze které objednávka vznikla. */
  supplierQuote: { id: string; number: string | null; quoteDate: string | null } | null;
  orderDate: string;
  /** Požadovaný termín dodání od dodavatele. */
  requiredDate: string | null;
  /** Termín potvrzený dodavatelem. */
  confirmedDate: string | null;
  currency: string;
  /** Celkem bez DPH. */
  total: number;
  deliveryTerms: string | null;
  paymentTerms: string | null;
  deliveryAddress: string | null;
  note: string | null;
  /** Číslo potvrzení / zakázky u dodavatele. */
  supplierReference: string | null;
  /** PDF objednávky v Dokumentech zakázky (aktuální verze). */
  fileId: string | null;
  sentAt: string | null;
  createdBy: PersonRef | null;
  createdAt: string;
  updatedAt: string;
  items: PurchaseItem[];
  /** Důvod zrušení (zadává se při zrušení). */
  cancelReason?: string | null;
  /** Kdo co s objednávkou udělal — ze sloupců DB (plní triggery atomicky se změnou). */
  stamps?: PurchaseOrderStamps;
  /** Převzetí po položkách: kolik položek je převzatých (nebo uzavřených) z kolika. */
  receipt?: { done: number; total: number; partial: boolean };
}

/** Razítka objednávky dodavateli (null = krok zatím nenastal). */
export interface PurchaseOrderStamps {
  created: ChangeStamp | null;
  status: ChangeStamp | null;
  sent: ChangeStamp | null;
  confirmed: ChangeStamp | null;
  delivered: ChangeStamp | null;
  cancelled: ChangeStamp | null;
  /** Poslední zápis převzatého množství (nejnovější položka). */
  received: ChangeStamp | null;
}

/** Převzetí od dodavatele — jedna položka objednávky. */
export interface PurchaseReceiptInput {
  itemId: string;
  /** Celkem převzato (ne přírůstek). */
  received: number;
  /** Uzavřít s menším množstvím (víc nepřijde). */
  close?: boolean;
  closeReason?: string;
}

/** Řádek přehledu „Objednávky dodavatelům" (s položkami — převzetí jde i z přehledu). */
export interface PurchaseOrderListItem extends PurchaseOrderView {
  job: { id: string; number: string; title: string; stage: JobStage } | null;
  customer: { id: string; name: string } | null;
  itemCount: number;
  drawingNumbers: string[];
  /** #25: bez práva na nákupní ceny — ceny, volný text, PDF a akce skryté (maskPurchaseOrderListItem). */
  pricesHidden?: boolean;
}

/** Provize zakázky — čte se z commission_entries (počítá DB trigger). */
export interface JobCommissionView {
  ownerId: string;
  ownerName: string;
  /** Obrat = objednávka zákazníka bez DPH. */
  revenue: number;
  /** Náklad = Σ objednávek vydaných, bez nich odhad nákupu. */
  cost: number;
  profit: number;
  /** Podíl zisku na obratu (0.25 = 25 %). */
  margin: number;
  /** Sazba provize (0.1 = 10 %). U pásmové provize podíl přidělené provize na zisku. */
  rate: number;
  /**
   * Základ provize: margin = ze zisku, revenue = z obratu,
   * margin_tiered = pásmově ze zisku dle měsíčního inkasa (smlouva obchodního zástupce).
   */
  base: "margin" | "revenue" | "margin_tiered";
  /** Provize zakázky; u pásmové jen po inkasu (podíl na měsíčním vyúčtování). */
  commission: number;
  status: CommissionStatus;
  /** false = nákupní cena neznámá → provize ze zisku zatím 0. */
  costKnown: boolean;
  /** Měsíc, do kterého provize patří (RRRR-MM-01) — u pásmové měsíc inkasa. */
  period: string;
  updatedAt: string | null;
  /** Zakázka je inkasovaná (zaplacená zákazníkem). */
  collected?: boolean;
  /** Pásmová provize: odhad pro neinkasovanou zakázku dle aktuálního pásma (finální až po inkasu). */
  estimatedCommission?: number | null;
  /** Objednávky dodavatelům s položkou bez ceny — provize čeká na nákupní cenu (commission_entries.cost_pending_po). */
  pendingPurchaseOrders?: string[];
}

/** Odkud se bere náklad zakázky; „neuplna" = objednávka dodavateli má položku bez ceny (náklad neznámý). */
export type PurchaseCostSource = "objednavky" | "odhad" | "neuplna" | null;

export interface JobPurchasingTotals {
  /** Objednávka zákazníka bez DPH (orders.value). */
  revenue: number | null;
  /** Σ objednávek vydaných (bez zrušených). */
  purchaseOrdersTotal: number;
  /** Plánovaný nákup (orders.purchase_cost — vítězná nabídka / odhad). */
  plannedCost: number | null;
  /** Náklad pro výpočet zisku (objednávky, bez nich odhad). */
  cost: number | null;
  costSource: PurchaseCostSource;
  profit: number | null;
  /** Podíl zisku na obratu. */
  margin: number | null;
  /** Jen u „neuplna": dosavadní součet objednávek (bez položek bez ceny). */
  incompleteCost?: number;
  /** Jen u „neuplna": počet položek bez ceny. */
  unpricedItems?: number;
  /** Jen u „neuplna": čísla objednávek s položkou bez ceny. */
  unpricedPurchaseOrders?: string[];
}

/** Nákupní strana zakázky — jen pro roli s právem „margins". */
export interface JobPurchasing {
  supplierQuotes: SupplierQuoteView[];
  purchaseOrders: PurchaseOrderView[];
  commission: JobCommissionView | null;
  /** #25: provize cizí zakázky — vidí ji jen obchodník zakázky a super admin (commission je pak null). */
  commissionHidden?: boolean;
  /** Obchodník zakázky (komu provize patří). */
  owner: PersonRef | null;
  totals: JobPurchasingTotals;
  /** Nabídky dodavatelů vyfocené bez práva na marže — čekají na zapsání do Nákupu. */
  pendingCaptured: PendingCapturedQuote[];
}

export interface PendingCapturedQuote {
  fileId: string;
  title: string;
  supplierName: string;
  createdAt: string;
}

// ── Vstupy akcí ─────────────────────────────────────────────

export interface PurchaseItemInput {
  drawingNumber?: string;
  name?: string;
  material?: string;
  quantity: number;
  unit?: string;
  unitPrice?: number | null;
  note?: string;
  /** Díl zakázky (order_items.id) — jen u objednávky dodavateli. */
  orderItemId?: string | null;
}

export interface SupplierQuoteInput {
  /** Dodavatel z adresáře; jinak supplierName. */
  supplierId?: string | null;
  supplierName?: string;
  number?: string;
  quoteDate?: string;
  validUntil?: string;
  leadTimeDays?: number | null;
  /** Prázdné + leadTimeDays → dopočítá se (datum nabídky / dnes + lhůta). */
  deliveryDate?: string;
  currency?: string;
  note?: string;
  fileId?: string | null;
  items: PurchaseItemInput[];
  /** Celkem bez DPH; undefined/null = Σ množství × cena. */
  total?: number | null;
  source?: SupplierQuoteSource;
}

/** Objednávka připravená k vystavení (to, co uživatel v dialogu potvrdí). */
export interface PurchaseOrderDraftInput {
  supplierId?: string | null;
  /** Dodavatel mimo adresář — při vystavení se dohledá / založí. */
  supplierName?: string;
  supplierQuoteId?: string | null;
  /** Datum objednávky (výchozí dnes). */
  orderDate?: string;
  requiredDate?: string;
  currency?: string;
  deliveryTerms?: string;
  paymentTerms?: string;
  deliveryAddress?: string;
  note?: string;
  items: PurchaseItemInput[];
}

export type PurchaseItemsSource = "nabidka_dodavatele" | "zakazka" | "souhrn";
export type RequiredDateSource =
  | "nabidka_dodavatele" | "slib_dodavatele" | "predpokladany_termin" | "termin_zakaznika" | null;

/** Návrh objednávky (neuložený) — výstup draftPurchaseOrder, vstup dialogu. */
export interface PurchaseOrderDraft extends PurchaseOrderDraftInput {
  supplierId: string | null;
  supplierQuoteId: string | null;
  orderDate: string;
  requiredDate: string;
  currency: string;
  deliveryTerms: string;
  paymentTerms: string;
  deliveryAddress: string;
  note: string;
  /** Dodavatel pro zobrazení v dialogu. */
  supplier: PurchaseSupplierRef | null;
  /** Číslo nabídky dodavatele, ze které návrh vznikl. */
  supplierQuoteNumber: string | null;
  itemsSource: PurchaseItemsSource;
  requiredDateSource: RequiredDateSource;
  /** Σ množství × cena bez DPH. */
  total: number;
  /** Upozornění pro uživatele (chybí cena, e-mail dodavatele, termín v minulosti…). */
  warnings: string[];
}

/** Úprava objednávky vydané. Prázdný řetězec = vymazat hodnotu. */
export interface PurchaseOrderPatch {
  status?: PurchaseOrderStatus;
  /** Termín potvrzený dodavatelem (při „potvrzena" se propíše do zakázky). */
  confirmedDate?: string;
  supplierReference?: string;
  requiredDate?: string;
  orderDate?: string;
  deliveryTerms?: string;
  paymentTerms?: string;
  deliveryAddress?: string;
  note?: string;
  currency?: string;
  /** Jen dokud objednávka neodešla (návrh / vystavena). */
  items?: PurchaseItemInput[];
  /** Důvod zrušení (status = zrusena). */
  cancelReason?: string;
}

/** E-mail s objednávkou pro dodavatele. */
export interface PurchaseOrderMail {
  to: string;
  cc?: string;
  subject: string;
  body: string;
}
