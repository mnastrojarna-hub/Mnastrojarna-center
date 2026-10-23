// Předání do výroby — čisté typy (sdílí UI, server i testy). Spec: production-handoff-design.md §F.1.
// Krok výroby = řádek job_operations; „Výroba N" se čísluje až při zobrazení.
import type { DeadlineState, OperationKind, OperationStatus } from "@/lib/jobs/operations";
import type { AutomationMode, JobStage, PurchaseOrderStatus } from "@/lib/supabase/database.types";

export type { DeadlineState } from "@/lib/jobs/operations";

export type HandoffKind = "predani" | "doplneni" | "dalsi_krok" | "ukonceni" | "plan" | "zaznam" | "zpet";
export const HANDOFF_KINDS: HandoffKind[] = ["predani", "doplneni", "dalsi_krok", "ukonceni", "plan", "zaznam", "zpet"];

/** Odkud je číslo termínu (job_operations.deadline_source). */
export type DeadlineSource = "nabidka_dodavatele" | "lhuta_dodavatele" | "potvrzeni_dodavatele" | "termin_zakaznika"
  | "posledni_dodavatel" | "odhad" | "rucne" | "ai" | "import";
/** Odkud je „kdo to dělá" (job_operations.who_source). */
export type WhoSource = "objednavka" | "nejlevnejsi_nabidka" | "nabidka" | "posledni_vykres" | "posledni_operace"
  | "technologie" | "rucne" | "ai" | "import";
/** Objednávka kroku: vystavit novou / použít existující / bez objednávky (objednáno jinak) / vystavit až při předání. */
export type StepPoMode = "vystavit" | "existujici" | "neobjednavat" | "pri_predani";

export type StepWho =
  | { type: "u_nas" }
  | { type: "supplier"; id: string; name?: string }
  | { type: "free"; name: string }
  | { type: "none" };

export type HandoffErrorCode = "HANDOFF_REQUIRED" | "STEP_HANDOFF_REQUIRED" | "FINISH_REQUIRED" | "PRODUCTION_RECORD_REQUIRED"
  | "UNDO_REQUIRED" | "NO_CUSTOMER_ORDER" | "STEP_NOT_READY" | "STAGE_CHANGED" | "STEP_CHANGED" | "VALIDATION" | "FORBIDDEN";
export const HANDOFF_ERROR_CODES: HandoffErrorCode[] = [
  "HANDOFF_REQUIRED", "STEP_HANDOFF_REQUIRED", "FINISH_REQUIRED", "PRODUCTION_RECORD_REQUIRED", "UNDO_REQUIRED",
  "NO_CUSTOMER_ORDER", "STEP_NOT_READY", "STAGE_CHANGED", "STEP_CHANGED", "VALIDATION", "FORBIDDEN",
];

/** Kdo krok dělá z pohledu zakázky (s kým je termín dohodnutý). */
export type PerformerRole = "dodavatel" | "částečný dodavatel" | "u nás";

// ── Validace ────────────────────────────────────────────────
export type HandoffIssueCode =
  | "who_missing" | "deadline_missing" | "deadline_invalid" | "deadline_past" | "deadline_order" | "start_after_end"
  | "interim_after_final" | "final_not_last" | "final_mismatch" | "final_missing" | "final_unconfirmed" | "last_after_final"
  | "final_past" | "no_buffer" | "non_working_day" | "po_reason_missing" | "po_duplicate" | "start_multiple"
  | "item_scope_empty" | "items_unassigned" | "quantity_mismatch" | "too_many" | "no_customer_order";

export interface HandoffIssue {
  code: HandoffIssueCode;
  level: "error" | "warning" | "info";
  /** Číslo kroku v dialogu (1 = první). */
  step?: number;
  message: string;
  /** Varování, které potřebuje zaškrtnout „Vím o tom — termín se zákazníkem domluvím." */
  acceptLate?: boolean;
}

// ── Vstup předání (klient → server) ─────────────────────────
export interface HandoffStepInput {
  /** Existující krok (čeká; u predani/doplneni i běžící aktuální — jen kdo/termín). */
  operationId?: string | null;
  kind: OperationKind;
  /** Jen vlastní název; „Výroba N" se nikdy neposílá. */
  title?: string | null;
  /** „none" jen u kroků, které teď nezačínají, nekončí ani se neobjednávají. */
  who: StepWho;
  plannedStart?: string | null;
  /** RRRR-MM-DD; povinné (u zaznam = datum dokončení). */
  plannedEnd: string | null;
  endsAtCustomerDate: boolean;
  /** „Termín mám dohodnutý s {Firma}". */
  deadlineAgreed: boolean;
  deadlineSource?: DeadlineSource;
  whoSource?: WhoSource;
  supplierQuoteId?: string | null;
  /** null = všechny díly. */
  orderItemIds?: string[] | null;
  /** Nejvýš jeden; žádný, když už krok běží. */
  start?: boolean;
  /** Jen zaznam. */
  done?: boolean;
  po: {
    mode: StepPoMode | null;
    existingId?: string | null;
    noneReason?: string | null;
    orderNow?: boolean;
    sharedWithNext?: boolean;
    includeUncovered?: boolean;
    /** orderItemId → množství (upravené v dialogu). */
    quantities?: Record<string, number>;
    deliverTo?: "nam" | "dalsi_krok";
  };
  note?: string | null;
}

export interface HandoffInput {
  /** uuid z přípravy plánu (idempotence). */
  token: string;
  kind: HandoffKind;
  expectedStage: JobStage;
  /** production_route_version(job) z plánu. */
  expectedRouteVersion: string;
  /** Může být prázdné: obnovení, ukonceni, zpet. */
  steps: HandoffStepInput[];
  complete?: { operationId: string; receipts?: { itemId: string; received: number }[]; continueWithoutRest?: boolean } | null;
  finish?: { target: JobStage; skipReason?: string | null; cancelSentPurchaseOrderIds?: string[] } | null;
  finalDate?: { date: string; confirmed: boolean } | null;
  /** Jen margins. */
  updateCustomerDate?: boolean;
  acceptLate?: boolean;
  /** Skupiny objednávek k odeslání hned po potvrzení (margins). */
  sendNow?: string[];
  /** zpet */
  undoHandoffId?: string | null;
  /** ≤ 500; poznámka ke změně stavu. */
  note?: string | null;
}

// ── Návrhy (kdo, termín, postup) ────────────────────────────
export type SuggestionBadge = "nejlevnejsi" | "nejrychlejsi" | "vybrana" | "vyprsela" | "jina_mena" | "cast" | "za_kg";

export interface WhoSuggestion {
  source: WhoSource;
  who: StepWho;
  supplierQuoteId: string | null;
  quoteNumber: string | null;
  purchaseOrder: { id: string; number: string; status: PurchaseOrderStatus } | null;
  /** null bez práva na marže nebo bez porovnatelné ceny. */
  price: number | null;
  currency: string | null;
  priceBasis: "celkem" | "prepocet_mnozstvi" | "cast_polozek" | null;
  /** O kolik dražší než nejlevnější (null bez práva na marže). */
  diffToBest: number | null;
  leadTimeDays: number | null;
  deliveryDate: string | null;
  coverage: { matched: number; total: number; uncovered: string[] } | null;
  expired: boolean;
  quantityMismatch: boolean;
  badges: SuggestionBadge[];
  /** Česky, proč tento návrh („Nejlevnější nabídka", „Naposledy dělal výkres…"). */
  reason: string;
}

export interface StepPlan extends HandoffStepInput {
  key: string;
  status: OperationStatus | null;
  /** Běžící krok: stav a druh zamčené. */
  locked: "none" | "status_kind" | "all";
  label: string;
  performerRole: PerformerRole | null;
  suggestions: { primary: WhoSuggestion | null; alternatives: WhoSuggestion[] };
  deadlineCaption: string | null;
  deadlineState: DeadlineState | null;
  poPreview: {
    supplierName: string | null; itemCount: number; unpriced: number; total: number | null; currency: string;
    items: { orderItemId: string | null; label: string; quantity: number; unit: string }[];
    existing?: { id: string; number: string; status: PurchaseOrderStatus } | null; blockers: string[];
  } | null;
}

export interface HandoffPlan {
  token: string; routeVersion: string; jobId: string; jobNumber: string; customerName: string | null;
  kind: HandoffKind; stage: JobStage; target: JobStage | null;
  permissions: { canSeePrices: boolean; canConfirmCustomerDate: boolean; canReceive: boolean; canSend: boolean; canCancelSent: boolean };
  finalDate: { date: string | null; source: "due_date" | "customer_required_date" | null; maxTolerated: string | null };
  doneSteps: { id: string; label: string; location: string; finishedAt: string | null }[];
  current: {
    id: string; label: string; location: string; status: OperationStatus;
    purchaseOrder: {
      id: string; number: string; status: PurchaseOrderStatus;
      items: { id: string; label: string; quantity: number; received: number; unit: string }[];
    } | null;
  } | null;
  steps: StepPlan[];
  routes: { key: string; label: string; total: number | null; complete: boolean; selected: boolean }[];
  routeSource: "planovane" | "nabidky" | "vykres" | "vychozi";
  openPurchaseOrders: { id: string; number: string; supplierName: string; status: PurchaseOrderStatus }[];
  automation: { mode: AutomationMode; sendDefault: boolean; senderEmail: string | null; reason: string | null };
  pendingCapturedQuotes: number;
  issues: HandoffIssue[];
}

export interface HandoffResult {
  handoffId: string; replayed: boolean; kind: HandoffKind; stage: JobStage;
  operationIds: string[]; startedOperationId: string | null; completedOperationId: string | null;
  purchaseOrders: {
    id: string; number: string; supplierName: string; fileId: string | null; pdf: "ok" | "chyba";
    send: "ceka_na_schvaleni" | "odeslano" | "neodeslano"; sendError?: string; queueId: string | null;
  }[];
  issues: HandoffIssue[];
}

// ── Payload RPC production_apply (server → DB; ceny NIKDY od klienta) ──
/** Položka objednávky v payloadu (sloupce purchase_order_items). */
export interface ApplyPurchaseItem {
  position?: number;
  drawing_number: string | null;
  name: string | null;
  material: string | null;
  quantity: number;
  unit: string;
  unit_price: number | null;
  note: string | null;
  order_item_id: string | null;
}

export interface ApplyPurchaseOrder {
  /** Klíč skupiny kroků (stejný jako ApplyStep.poGroup). */
  group: string;
  supplierId?: string | null;
  /** Nový dodavatel z newSuppliers (firma mimo adresář). */
  supplierKey?: string | null;
  supplierQuoteId?: string | null;
  requiredDate: string | null;
  currency?: string | null;
  deliveryTerms?: string | null;
  paymentTerms?: string | null;
  deliveryAddress?: string | null;
  note?: string | null;
  /** „krok 1: Výroba 1" — do historie. */
  stepsLabel?: string | null;
  items: ApplyPurchaseItem[];
  queue: { title: string; summary: string | null; target: string | null; payload: Record<string, unknown> };
}

export interface ApplyStep {
  /** Pořadí v dialogu (1…) — do chybových hlášek. */
  index: number;
  operationId?: string | null;
  kind: OperationKind;
  title?: string | null;
  inHouse: boolean;
  supplierId?: string | null;
  supplierKey?: string | null;
  supplierName?: string | null;
  plannedStart?: string | null;
  plannedEnd: string | null;
  endsAtCustomerDate: boolean;
  /** Stav termínu určuje server (stavový automat A.4). */
  deadlineState: DeadlineState | null;
  deadlineSource?: DeadlineSource | null;
  whoSource?: WhoSource | null;
  supplierQuoteId?: string | null;
  orderItemIds?: string[] | null;
  poMode: StepPoMode | null;
  poNoneReason?: string | null;
  /** Nová objednávka ze skupiny (purchaseOrders[].group). */
  poGroup?: string | null;
  existingPurchaseOrderId?: string | null;
  /** Nový krok: pozice (insertPositions); null = na konec. */
  position?: number | null;
  start?: boolean;
  done?: boolean;
  note?: string | null;
}

export interface ProductionApplyPayload {
  note?: string | null;
  /** Souhrnná událost do historie (bez cen). */
  summary?: string | null;
  /** Cíl ukonceni / zaznam (rank ≥ 6). */
  stageTo?: JobStage | null;
  finalDate?: { date: string; confirmed: boolean } | null;
  undoHandoffId?: string | null;
  complete?: {
    operationId: string;
    receipts?: { itemId: string; received: number }[];
    continueWithoutRest?: boolean;
    /** „Tepelné zpracování · TepKal · mezitermín 19. 11." — do události dokončení. */
    nextText?: string | null;
  } | null;
  finish?: { skipReason?: string | null; cancelSentPurchaseOrderIds?: string[] } | null;
  newSuppliers?: { key: string; name: string; email?: string | null; ico?: string | null }[];
  shifts?: { id: string; position: number }[];
  /** Odebrat konečný termín všem krokům před zápisem (vložení za konečný krok). */
  resetFinal?: boolean;
  purchaseOrders?: ApplyPurchaseOrder[];
  steps?: ApplyStep[];
}

/** Výsledek RPC production_apply (jsonb). */
export interface ProductionApplyResult {
  handoffId: string;
  kind: HandoffKind;
  stageFrom: JobStage;
  stage: JobStage;
  operationIds: string[];
  startedOperationId: string | null;
  completedOperationId: string | null;
  purchaseOrders: { id: string; number: string; supplierId: string; supplierName: string; group: string; queueId: string | null }[];
  undoneHandoffId?: string;
  replayed: boolean;
}
