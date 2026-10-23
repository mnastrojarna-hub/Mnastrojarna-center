// Kontrakt dávkového focení („v jednom kole vyfotím objednávku, výkres, DL, fakturu… → AI roztřídí").
// Sdílí server i klient (bez server-only). Hodnoty a čisté funkce: capture-batch.ts, capture-batch-reconcile.ts.
import type { JobFileKind, JobStage } from "@/lib/supabase/database.types";
import type { CaptureDocKind, DocIssuer, ExtractedBusinessDoc, ExtractedParty } from "@/lib/jobs/capture-types";
import type {
  CaptureChipKey, CaptureFileRef, PartyChoice, PartyMatchView, ReviewItem, ReviewModel, ReviewOptions,
  ReviewState, ReviewFieldKey,
} from "@/lib/jobs/capture-review";

/** Druh dokladu v dávce = chip jednoho dokladu + 3D model a fotka (ty pozná jen deterministika / člověk). */
export type BatchDocType = CaptureChipKey | "model_3d" | "foto";
/** Strana dokladu: zákaznická (zakázka), dodavatelská (nákup), bez strany (výkres, model, fotka, jiné). */
export type BatchSide = "customer" | "supplier" | "none";
/** Formulář kontroly dokladu. */
export type BatchForm = "business" | "drawing" | "model" | "file";
export type CadFormat =
  | "STEP" | "IGES" | "STL" | "3MF" | "Parasolid" | "SolidWorks" | "CATIA" | "NX/Creo" | "Inventor"
  | "Solid Edge" | "JT" | "ACIS" | "Rhino" | "Fusion" | "DXF" | "DWG";
export type BatchPageSource = "image" | "pdf_page" | "file";
export type DocFlag = "signed" | "accepted" | "proforma" | "credit_note" | "partial" | "paid" | "complaint";
/** Proč AI neběžela / selhala (česká hláška: AI_FAILURE_MESSAGE v ai-call.ts). */
export type AiFailure =
  | "spend_limit" | "rate_limit" | "overloaded" | "timeout" | "refusal" | "max_tokens" | "invalid_request" | "auth" | "other";
export interface AiUsage { input: number; output: number; cacheRead: number; cacheWrite: number }

export interface BatchTypeMeta {
  key: BatchDocType;
  /** „Nabídka dodavatele" */
  label: string;
  /** null = model_3d / foto */
  docKind: CaptureDocKind | null;
  issuer: DocIssuer | null;
  side: BatchSide;
  /** Barva pruhu (GROUP_TONE) + štítek „OD …". */
  group: "zakaznik" | "my" | "dodavatel" | "ostatni";
  /** Barva / ikona chipu = FILE_KINDS[fileKind]. */
  fileKind: JobFileKind;
  form: BatchForm;
  /** Protějšek s druhým vystavitelem (naše nabídka ↔ nabídka dodavatele). */
  swap: BatchDocType | null;
  /** „→ Je to nabídka dodavatele" */
  swapLabel: string | null;
}
// Hodnoty v capture-batch.ts: BATCH_TYPES: Record<BatchDocType, BatchTypeMeta>, BATCH_TYPE_ORDER: BatchDocType[]

export interface BatchFile extends CaptureFileRef {
  /** "f1"… */
  id: string;
  /** Obrázek 1, PDF N, ostatní 1 (strana typu file). */
  pageCount: number;
  sniffedMime: string | null;
  format: CadFormat | null;
  /** Název ZIPu, ze kterého soubor pochází. */
  fromZip: string | null;
  /**
   * Balík, ze kterého soubor pochází: ZIP „zip:<cesta ZIPu v úložišti>" (capture-files), později e-mail
   * s přílohami „mail:<id>"; bez něj = název ZIPu (fromZip, starší relace). Doklady jednoho balíku
   * = jeden zákazník (bundleKeyOf v capture-batch.ts).
   */
  bundle?: string | null;
  splittable: boolean;
  aiReadable: boolean;
  /** „PDF je zaheslované — vyplň ručně" */
  aiSkipReason: string | null;
  /** Spočítané serverem z obsahu. */
  sha256: string;
}

export interface BatchPage {
  /** "p1"… (globální pořadí S1…) */
  id: string;
  fileId: string;
  /** 1-based v souboru */
  page: number;
  source: BatchPageSource;
  /** „dokumenty.pdf · str. 2/4" */
  label: string;
  /** Z pageLabels („str. 2/4 · tabulka položek"), bez cen; "" = není. */
  aiLabel: string;
  /** pageId, kterou stránka opakuje (přefocení). */
  duplicateOf: string | null;
}

export interface BatchDocDraft {
  /** "d1"… (server) | "u-xxxxxxxx" (klient) */
  id: string;
  type: BatchDocType;
  /** Neprázdné, pořadí = pořadí v dokladu. */
  pageIds: string[];
  aiType: BatchDocType | null;
  confidence: number | null;
  reason: string;
  title: string;
  documentNumber: string;
  partyName: string;
  drawingNumbers: string[];
  format: CadFormat | null;
  flags: DocFlag[];
  issuerCheck: "ok" | "mismatch" | "unknown";
  excluded: boolean;
}
export interface BatchSort { docs: BatchDocDraft[]; excludedPageIds: string[] }

export interface BatchPreview {
  fileId: string; path: string; filename: string; mimeType: string; size: number;
  /** Podepsaná URL originálu (1 h). */
  url: string | null;
  /** Podepsaná URL náhledu 1280 px (obrázky). */
  sortUrl: string | null;
  pageCount: number;
  format: CadFormat | null;
}

export type DocExtractStatus = "reading" | "ready" | "manual" | "error";
export interface DocExtractSummary {
  docId: string; pagesKey: string; type: BatchDocType;
  status: DocExtractStatus; error: string | null; aiUsed: boolean;
  title: string; documentNumber: string; confidence: number | null; clarifications: number;
}

export interface BatchSortModel {
  captureId: string;
  aiUsed: boolean;
  reason: string | null;
  aiFailure: AiFailure | null;
  mode: "approval" | "full";
  margins: boolean;
  /** Právo „drawings" (přepínač archivu). */
  drawingsAccess: boolean;
  fixedJobId: string | null;
  fixedJobNumber: string | null;
  files: BatchFile[];
  pages: BatchPage[];
  previews: BatchPreview[];
  /** Návrh (AI nebo výchozí odhad). */
  sort: BatchSort;
  /** Z roztřídění (duplicate_doc, issuer_mismatch, ai_failed, pages_truncated, complaint…). */
  warnings: BatchWarning[];
  /** Už hotová vytěžení (D4 souběh), jinak []. */
  extracts: DocExtractSummary[];
  /** 1 doklad → rovnou Kontrola. */
  skipSort: boolean;
}

// ── vytěžení ──
export interface DrawingExtract {
  drawingNumber: string; revision: string; title: string; material: string; dimensions: string;
  weightKg: number; generalTolerance: string; tightestTolerance: string; surface: string;
  heatTreatment: string; surfaceTreatment: string; quantity: number;
  /**
   * Firma z razítka = kdo výkres kreslil (projekce / konstrukce), NE zákazník — jen informace,
   * nikdy k párování ani jako zákazník zakázky / archivu (zákazník se bere ze zakázky).
   */
  customerName: string;
  drawingDate: string; sheet: string; scale: string; notes: string; summary: string;
  confidence: number; needsClarification: string[];
  /** Všechna čísla výkresu / dílu na listu (1. = drawingNumber); starší vytěžení je nemají. */
  drawingNumbers?: string[];
  /** Číslo objednávky zákazníka / naší nabídky, je-li výslovně na listu. */
  customerOrderNumber?: string;
  ourQuoteNumber?: string;
}
export interface ModelMeta { format: CadFormat | null; drawingNumber: string; revision: string; title: string }
export type BatchDocExtract =
  | { kind: "business"; doc: ExtractedBusinessDoc }
  | { kind: "drawing"; drawing: DrawingExtract }
  | { kind: "model"; model: ModelMeta }
  | { kind: "none" };

// ── kontrola ──
export type ItemLinkChoice =
  /** existující položka cílové zakázky */
  | { mode: "item"; itemId: string }
  /** nová položka skupiny (group.job.items[].key) */
  | { mode: "docItem"; itemKey: string }
  /** založit položku z výkresu / modelu */
  | { mode: "add" }
  | { mode: "none" };
export interface ItemOption { link: ItemLinkChoice; label: string; drawingNumber: string; revision: string }

export interface FieldSource { docId: string; /** „z faktury FV-118" */ label: string }
export interface DuplicateRef {
  jobId: string; jobNumber: string; fileId: string | null; what: string; date: string;
  /** Shoda jen podle čísla (strana dokladu nejde ověřit) — jen upozornit, výchozí volba žádná. */
  weak?: boolean;
}

export interface SupplierQuoteLineState {
  key: string; drawingNumber: string; name: string; material: string;
  /** unitPrice "" bez margins */
  quantity: string; unit: string; unitPrice: string;
}
export interface BusinessDocState {
  /** form "business" */
  type: BatchDocType;
  documentNumber: string;
  /** RRRR-MM-DD | "" */
  documentDate: string;
  docNote: string;
  /** Jen přiložit soubor, žádné účinky. */
  fileOnly: boolean;
  /** Dodavatelská strana, jinak { mode: "none" }. */
  supplier: PartyChoice;
  /** dodaci_list_my */
  confirmDelivered: boolean;
  /** faktura_my */
  invoiceDueDate: string;
  /** faktura_my → Dokončeno */
  paidComplete: boolean;
  /** nabidka_dodavatel (bez margins []) */
  quoteLines: SupplierQuoteLineState[];
  /** nabidka_dodavatel */
  selectWinner: boolean;
  /** potvrzeni_dodavatel, dodaci_list_dodavatel */
  advancePurchaseOrder: boolean;
  /** Jen když duplicateOf. */
  onDuplicate: "skip" | "version" | null;
}
export interface DrawingReviewState {
  drawingNumber: string; revision: string; title: string; material: string; dimensions: string;
  generalTolerance: string; tightestTolerance: string; quantity: string;
  link: ItemLinkChoice; archive: boolean; note: string; onDuplicate: "skip" | "version" | null;
}
export interface ModelReviewState {
  format: CadFormat | null; drawingNumber: string; revision: string; title: string;
  link: ItemLinkChoice; note: string; onDuplicate: "skip" | "version" | null;
}
export interface FileReviewState { fileKind: JobFileKind; title: string; note: string }

export type BatchDocReview =
  | { kind: "business"; docId: string; groupKey: string; type: BatchDocType; primary: boolean;
      aiUsed: boolean; reason: string | null; confidence: number | null; summary: string;
      needsClarification: string[]; flags: DocFlag[];
      docCustomer: ExtractedParty; docSupplier: ExtractedParty; supplierMatch: PartyMatchView | null;
      /** „Nová položka?" (jen neprimární zákaznické) */
      unmatchedRows: ReviewItem[];
      duplicateOf: DuplicateRef | null; initial: BusinessDocState }
  | { kind: "drawing"; docId: string; groupKey: string; aiUsed: boolean; reason: string | null;
      drawing: DrawingExtract; duplicateOf: DuplicateRef | null; archiveConflict: string | null;
      /** Odkud je počet kusů / název výkresu („z objednávky PO-…", „název z objednávky PO-…"). */
      sources?: { quantity?: string; title?: string };
      initial: DrawingReviewState }
  | { kind: "model"; docId: string; groupKey: string; meta: ModelMeta; duplicateOf: DuplicateRef | null;
      initial: ModelReviewState }
  | { kind: "file"; docId: string; groupKey: string; initial: FileReviewState };

export interface BatchGroupReview {
  /** "g1"… */
  key: string;
  docIds: string[];
  primaryDocId: string | null;
  /** „Strojmetal · PO-4471" */
  label: string;
  /** Proč samostatná skupina. */
  autoReason: string | null;
  /** Dnešní ReviewModel bez sdílených částí; FE doplní { options: review.options, previews: [] }. */
  model: Omit<ReviewModel, "options" | "previews">;
  visibleFields: ReviewFieldKey[];
  fieldSources: Partial<Record<ReviewFieldKey, FieldSource>>;
  /** itemKey → zdroje doplnění */
  itemSources: Record<string, FieldSource[]>;
  /** targetKey → volby vazby výkresu / modelu na položku */
  itemOptions: Record<string, ItemOption[]>;
}

export type BatchWarningCode =
  | "customer_conflict" | "target_required" | "number_conflict" | "revision_conflict" | "quantity_conflict"
  | "duplicate_doc" | "already_saved" | "target_conflict" | "group_uncertain" | "issuer_mismatch"
  | "sort_uncertain" | "unlinked_drawing" | "unlinked_model" | "supplier_item_unmatched" | "price_hidden"
  | "purchasing_pending" | "not_in_purchasing" | "drawing_archive_conflict" | "split_failed" | "ai_failed"
  | "pages_truncated" | "proforma" | "credit_note" | "partial_delivery" | "complaint" | "whole_order"
  /** Další objednávka / poptávka s jiným číslem ve stejné skupině (1 zakázka, rozdělit 1 ťuknutím). */
  | "multiple_orders"
  /** Zákazník napsán jinak bez IČO — 1 zakázka, jen upozornění. */
  | "customer_written_differently"
  /** Objednávka bez reálného termínu → termín z nabídky / poptávky (nebo rozdíl proti nabídce). */
  | "deadline_from_quote"
  /** Výkres bez spárované položky a bez počtu kusů. */
  | "drawing_quantity_missing";
export type BatchWarningActionKind =
  | "same_customer" | "split_group" | "move_to_group" | "exclude_doc" | "restore_page" | "set_type"
  | "skip_duplicate" | "save_version";
export interface BatchWarningAction {
  kind: BatchWarningActionKind; label: string;
  docId?: string; groupKey?: string; pageId?: string; type?: BatchDocType;
  /** split_group: doklady, které odejdou společně do nové zakázky (přiřazení „new:<první>"). */
  docIds?: string[];
}
export interface BatchWarning {
  /** Stabilní: `${code}:${docIds.join(",")}` */
  id: string;
  code: BatchWarningCode;
  /** block = „Uložit vše" zakázáno do vyřešení */
  severity: "info" | "warn" | "block";
  docIds: string[];
  groupKey: string | null;
  /** Bez nákupních cen. */
  message: string;
  /** První = výchozí. */
  actions: BatchWarningAction[];
}

export interface BatchReviewModel {
  captureId: string;
  aiUsed: boolean;
  mode: "approval" | "full";
  margins: boolean;
  drawingsAccess: boolean;
  fixedJobId: string | null;
  /** Zákazníci + dodavatelé celí, zakázky jen posledních 300 (zbytek přes batch/jobs). */
  options: ReviewOptions;
  groups: BatchGroupReview[];
  /** V pořadí roztřídění (vyřazené chybí). */
  docs: BatchDocReview[];
  warnings: BatchWarning[];
  initial: BatchApplyState;
}

export interface BatchGroupState {
  key: string;
  docIds: string[];
  /** targetKey "new" | jobId | "" (nevybráno), zákazník, pole, položky, merges, stage */
  job: ReviewState;
  customerConfirmed: boolean;
  /** Skupina bez obchodního dokladu + "new". */
  jobDraftTitle: string;
}
export type DocApplyState =
  | { kind: "business"; state: BusinessDocState }
  | { kind: "drawing"; state: DrawingReviewState }
  | { kind: "model"; state: ModelReviewState }
  | { kind: "file"; state: FileReviewState };
export interface BatchApplyState {
  /** Finální roztřídění (i vyřazené, excluded: true). */
  sort: BatchSort;
  groups: BatchGroupState[];
  docs: Record<string, DocApplyState>;
  auto?: boolean;
}

/** „/orders/<id>?tab=nakup|dokumenty|polozky" */
export interface BatchResultLink { label: string; href: string }
export interface BatchGroupResult {
  key: string; ok: boolean; error?: string;
  jobId?: string; jobNumber?: string; created: boolean; matchedBy?: string;
  customerName?: string; customerCreated?: boolean; stageFrom?: JobStage; stageTo?: JobStage;
}
export interface BatchDocResult {
  docId: string; groupKey: string; type: BatchDocType; label: string;
  ok: boolean; skipped?: "duplicate" | "excluded"; error?: string;
  jobId: string | null; jobNumber: string | null;
  fileIds: string[]; fileKind: JobFileKind; title: string; summary: string;
  links: BatchResultLink[];
  supplierQuoteId?: string; purchasingPending?: boolean;
  drawingId?: string; drawingArchived?: boolean; itemId?: string;
}
export interface BatchResult {
  /** true i při částečném úspěchu */
  ok: boolean;
  status: "done" | "partial" | "failed";
  error?: string;
  aiUsed: boolean; autoApplied?: boolean;
  groups: BatchGroupResult[];
  docs: BatchDocResult[];
  /** docId, které se neuložily */
  pending: string[];
  warnings: string[];
}
