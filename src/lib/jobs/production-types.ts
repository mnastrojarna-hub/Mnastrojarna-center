// View-modely výroby zakázky (podrobný postup, kde se díl nachází) a konce toku
// (potvrzený dodací list → faktura → splatnost → zaplaceno). Čisté typy — sdílí UI,
// datová vrstva i akce.
import type { DeadlineState, OperationKind, OperationStatus } from "@/lib/jobs/operations";
import type { JobStage, PurchaseOrderStatus } from "@/lib/supabase/database.types";
import type { DeadlineSource, StepPoMode, WhoSource } from "@/lib/jobs/production-handoff-types";
import type { PersonRef } from "@/lib/jobs/types";

/** Jedna výrobní operace zakázky (soustružení u firmy XY, kalení, broušení u nás…). */
export interface JobOperation {
  id: string;
  jobId: string;
  /** Pořadí v postupu (0, 1, 2…). */
  position: number;
  kind: OperationKind;
  /** Vlastní název (např. „Soustružení — 2. upnutí"); null = jen druh. */
  title: string | null;
  /** Zobrazovaný název: vlastní název, jinak popisek druhu. */
  label: string;
  /** Dodavatel z adresáře (kooperace). */
  supplier: { id: string; name: string } | null;
  /** Firma, která ještě není v adresáři (volný text). */
  supplierName: string | null;
  /** Děláme sami. */
  inHouse: boolean;
  /** Kde se to dělá: „U nás" / dodavatel / volný název / „—". */
  location: string;
  status: OperationStatus;
  plannedStart: string | null;
  /** Termín operace (RRRR-MM-DD). */
  plannedEnd: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  note: string | null;
  /** Naše objednávka vydaná dodavateli na tuto operaci. */
  purchaseOrderId: string | null;
  purchaseOrderNumber: string | null;
  createdBy: PersonRef | null;
  createdAt: string;
  updatedAt: string;
  /** Termín operace prošel a není hotovo / přeskočeno. */
  overdue: boolean;
  /** Kdo a kdy operaci naposledy přepnul (job_operations.status_changed_*, plní DB). */
  changedBy?: PersonRef | null;
  changedAt?: string | null;
  /** „automaticky" = navázalo samo (spustil changedBy). */
  changedVia?: string | null;
  // ── Předání do výroby (migrace 20261023150000; volitelné kvůli starším fixturám) ──
  /** Díly zakázky v kroku (order_items.id); null = všechny. */
  orderItemIds?: string[] | null;
  /** Krok končí konečným termínem (zákazník) — jen poslední krok. */
  endsAtCustomerDate?: boolean;
  /** Jak jistý je termín (odhad / dohodnuto / požadováno / potvrzeno / změna čeká / plán dílny). */
  deadlineState?: DeadlineState | null;
  deadlineSource?: DeadlineSource | null;
  /** Kdo a kdy naposledy změnil termín (plní DB). */
  deadlineChangedBy?: PersonRef | null;
  deadlineChangedAt?: string | null;
  deadlineChangedVia?: string | null;
  whoSource?: WhoSource | null;
  /** Kdo a kdy naposledy změnil, kdo krok dělá (plní DB). */
  whoChangedBy?: PersonRef | null;
  whoChangedAt?: string | null;
  whoChangedVia?: string | null;
  supplierQuoteId?: string | null;
  poMode?: StepPoMode | null;
  /** „Objednáno jinak: {důvod}". */
  poNoneReason?: string | null;
  handoffId?: string | null;
  /** Objednávka kroku (stav, odeslání, potvrzený termín, PDF) — null bez objednávky nebo bez práva na nákup. */
  purchaseOrder?: {
    id: string; number: string | null; status: PurchaseOrderStatus | null;
    sentAt: string | null; confirmedDate: string | null; fileId: string | null;
  } | null;
}

/** Souhrn výroby zakázky (řádek knihy, hlavička detailu) — z orders.production_*. */
export interface JobProductionSummary {
  /** Druh aktuální operace, „hotovo" = vše hotové, null = bez postupu. */
  step: OperationKind | "hotovo" | null;
  /** Kde se zakázka právě nachází („TepKal s.r.o.", „U nás"). */
  location: string | null;
  done: number;
  /** Počet operací bez přeskočených. */
  total: number;
  /** Některá operace hlásí problém. */
  problem: boolean;
  /** „Tepelné zpracování · TepKal s.r.o." / „Výroba hotová" / null. */
  label: string | null;
  /** Hotovo v % (0–100). */
  percent: number;
}

/** Vstup formuláře operace (přidání i úprava). */
export interface JobOperationInput {
  kind: OperationKind;
  title?: string | null;
  /** Dodavatel z adresáře; null = žádný. */
  supplierId?: string | null;
  /** Firma mimo adresář (volný text). */
  supplierName?: string | null;
  /** Děláme sami (přebije dodavatele). */
  inHouse?: boolean;
  status?: OperationStatus;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  note?: string | null;
  purchaseOrderId?: string | null;
  /** Krok končí konečným termínem (zákazník). */
  endsAtCustomerDate?: boolean;
  /** „Termín mám dohodnutý s {Firma}" (stav termínu určí server). */
  deadlineAgreed?: boolean;
  /** Díly v kroku; null = všechny. */
  orderItemIds?: string[] | null;
}

/** Konec toku zakázky: domluvy, potvrzený DL, faktura, splatnost, úhrada. */
export interface JobClosingInfo {
  jobId: string;
  stage: JobStage;
  /** Domluvy se zákazníkem, které nejsou v objednávce. */
  customerNote: string | null;
  /** Datum vrácení potvrzeného dodacího listu. */
  deliveryNoteConfirmedAt: string | null;
  deliveryNoteNumber: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  invoiceDueDate: string | null;
  /** Splatnost zákazníka ve dnech (null = výchozích 14). */
  paymentTermsDays: number | null;
  paidAt: string | null;
  /** Inkasováno bez DPH — null bez práva na marže (nebo = hodnota zakázky). */
  paidAmount: number | null;
  /** Faktura po splatnosti a nezaplacena. */
  overdueInvoice: boolean;
  /** Dní do splatnosti (záporné = po splatnosti); null = bez splatnosti nebo zaplaceno. */
  daysToDue: number | null;
}

/** Počty aktivních zakázek podle aktuální operace a místa (filtry knihy). */
export interface ProductionFilterCounts {
  steps: { key: string; label: string; count: number }[];
  locations: { name: string; count: number }[];
}
