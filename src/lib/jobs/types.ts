// View-modely Knihy zakázek (UI ↔ datová vrstva). Plní se výhradně z DB (tabulka orders a spol.).
import type { DrawingSpecView } from "@/lib/jobs/drawing-spec";
import type {
  ActorKind, ChangeVia, DocIssuerKey, InquiryStatus, JobStage, JobFileKind, JobFileOrigin, JobSource, PriorityLevel,
  PurchaseOrderStatus, QuoteState, QuoteStatus,
} from "@/lib/supabase/database.types";
import type { DeadlineState } from "@/lib/jobs/operations";
import type { StageGroupKey } from "@/lib/jobs/stages";
import type { ChangeStamp, FlowFacts, JobStamps, QuoteFacts } from "@/lib/jobs/flow-status";

export interface PersonRef {
  id: string;
  name: string;
}

export interface JobCustomerRef {
  id: string;
  name: string;
  customerNumber: string | null;
  ico: string | null;
}

/** Jeden řádek Knihy zakázek. */
export interface JobListItem {
  id: string;
  /** Naše pořadové číslo zakázky (Z-2026-001). */
  number: string;
  title: string;
  stage: JobStage;
  priority: PriorityLevel;
  customer: JobCustomerRef | null;
  customerOrderNumber: string | null;
  customerInquiryNumber: string | null;
  drawingNumbers: string[];
  itemCount: number;
  totalQuantity: number;
  /** Prodejní hodnota bez DPH. */
  value: number | null;
  /** Nákupní náklady — null, pokud uživatel nemá právo vidět marže. */
  purchaseCost: number | null;
  currency: string;
  inquiryDate: string | null;
  orderDate: string | null;
  /** Požadovaný termín zákazníkem. */
  customerRequiredDate: string | null;
  /** Potvrzený termín dodání zákazníkovi (sloupec due_date). */
  dueDate: string | null;
  /** Předpokládaný termín dodání. */
  expectedDeliveryDate: string | null;
  /** Slíbený termín od dodavatele. */
  supplierPromisedDate: string | null;
  /** Maximální tolerovaný termín. */
  maxToleratedDate: string | null;
  receivedAt: string | null;
  deliveredAt: string | null;
  /** Obchodník (odpovědná osoba). */
  owner: PersonRef | null;
  /** Kdo zakázku zpracovává. */
  assignee: PersonRef | null;
  /** Kdo zakázku zadal. */
  createdBy: PersonRef | null;
  supplier: { id: string; name: string } | null;
  quoteCount: number;
  fileCount: number;
  aiFilled: boolean;
  source: JobSource;
  createdAt: string;
  updatedAt: string;
  stageChangedAt: string | null;
  // ── Výroba a konec toku (orders.production_*, udržuje DB trigger) ──
  /** Druh aktuální výrobní operace, „hotovo" = vše hotové, null = bez postupu. */
  productionStep?: string | null;
  /** Kde se zakázka právě nachází („TepKal s.r.o.", „U nás"). */
  productionLocation?: string | null;
  productionDone?: number;
  /** Počet operací bez přeskočených. */
  productionTotal?: number;
  /** Některá operace hlásí problém. */
  productionProblem?: boolean;
  // ── Předání do výroby: souhrn aktuálního kroku (orders.production_*, udržuje DB) ──
  /** „Krok n/m": pořadí aktuálního kroku mezi nepřeskočenými. */
  productionStepNo?: number | null;
  /** Pořadí mezi kroky stejného druhu („Výroba 2"). */
  productionStepKindNo?: number | null;
  productionStepTitle?: string | null;
  /** Termín aktuálního kroku (RRRR-MM-DD). */
  productionDue?: string | null;
  /** Aktuální krok končí konečným termínem (zákazník). */
  productionDueFinal?: boolean | null;
  productionDueState?: DeadlineState | null;
  /** Stav objednávky dodavateli u aktuálního kroku. */
  productionPoStatus?: PurchaseOrderStatus | null;
  /** Nejzazší termín otevřených kroků. */
  productionEnd?: string | null;
  /** Termín kroku s konečným termínem. */
  productionFinalEnd?: string | null;
  /** Domluvy se zákazníkem (co není v objednávce). */
  customerNote?: string | null;
  /** Datum vrácení potvrzeného dodacího listu. */
  deliveryNoteConfirmedAt?: string | null;
  invoiceNumber?: string | null;
  /** Splatnost naší faktury (RRRR-MM-DD). */
  invoiceDueDate?: string | null;
  /** Zaplaceno (RRRR-MM-DD). */
  paidAt?: string | null;
  // ── Podrobné stavy toku a „kdo · kdy" (sloupce orders, udržuje DB) ──
  /** Fakta pro deriveFlow / primaryChip / nextAction (chybí jen u ručně složených fixtur). */
  flow?: FlowFacts;
  /** Nabídky zakázky jako fakta (aktivní nabídka, stav nabídky). */
  flowQuotes?: QuoteFacts[];
  /** Kdo naposledy změnil hlavní stav a dílčí stavy (stage / inquiry / order / lost / proposal). */
  stamps?: JobStamps;
}

export interface JobItem {
  id: string;
  position: number;
  drawingNumber: string | null;
  revision: string | null;
  name: string | null;
  description: string | null;
  material: string | null;
  quantity: number;
  unit: string;
  /** Prodejní cena / MJ bez DPH. */
  unitPrice: number | null;
  /** Nákupní cena / MJ — null bez práva na marže. */
  purchaseUnitPrice: number | null;
  note: string | null;
  /** Dodáno zákazníkovi (po položkách, udržuje akce dodání). */
  deliveredQuantity?: number;
  /** Uzavřeno s menším množstvím (zmetky, zákazník přijal méně). */
  deliveryClosed?: boolean;
  deliveryClosedReason?: string | null;
  /** Materiál, hmotnost, TZ / PÚ z výkresu (štítky v Položkách); null = výkres nic neuvádí. */
  spec?: DrawingSpecView | null;
  /** Technologie (záložka Technologie): postup technologa, kompletní dodávka, poznámka pro dodavatele. */
  tech?: JobItemTech;
}

/** Technologie položky (migrace 20261029140000). */
export interface JobItemTech {
  /** Technologický postup (volný text technologa); nepovinný při kompletní dodávce. */
  procedure: string | null;
  /** „Bez technologie — kompletně zadáno {firma}". */
  complete: boolean;
  completeBy: string | null;
  /** Poznámka pro dodavatele — tiskne se do objednávky u položky a do e-mailu. */
  supplierNote: string | null;
}

export interface JobQuoteItem {
  id: string;
  position: number;
  drawingNumber: string | null;
  name: string | null;
  description: string | null;
  material: string | null;
  quantity: number;
  unit: string;
  unitPrice: number | null;
  vatRate: number;
  purchaseUnitPrice: number | null;
  note: string | null;
}

/** Nabídka zakázky — zakázka jich může mít víc (verze, varianty). */
export interface JobQuote {
  id: string;
  number: string;
  revision: number;
  title: string | null;
  status: QuoteStatus;
  /** Celkem bez DPH. */
  total: number | null;
  currency: string;
  validUntil: string | null;
  leadTimeDays: number | null;
  deliveryTerms: string | null;
  paymentTerms: string | null;
  note: string | null;
  /** Kdo nabídku zadal. */
  createdBy: PersonRef | null;
  /** Kdo nabídku schválil. */
  approvedBy: PersonRef | null;
  approvedAt: string | null;
  sentAt: string | null;
  createdAt: string;
  /** Nahrazena novější verzí. */
  archived: boolean;
  aiGenerated: boolean;
  /** Zákazník tuto nabídku přijal (orders.quote_id). */
  accepted: boolean;
  items: JobQuoteItem[];
  /** Podrobný stav (quotes.state, odvozuje DB). */
  state?: QuoteState;
  approvalRequired?: boolean;
  approvalRequestedAt?: string | null;
  /** Připomínky zákazníka (stav „Připomínky“). */
  feedback?: string | null;
  /** Důvod zamítnutí (text) a kód důvodu. */
  rejectedReason?: string | null;
  lostReason?: string | null;
  /** Kdo a jak nabídku odeslal / kdo naposledy změnil stav. */
  sentBy?: PersonRef | null;
  sentVia?: ChangeVia | null;
  stateStamp?: ChangeStamp | null;
  /** #25: připravil (nebo před odesláním změnil) ne-admin → odeslat až po schválení super adminem. */
  adminApprovalRequired?: boolean;
  approvalRequestedBy?: string | null;
  /** Obchodník nabídky (quotes.owner_id). */
  ownerId?: string | null;
  /** #25: super admin vrátil nabídku autorovi k přepracování (kdy, proč, kdo). */
  returnedAt?: string | null;
  returnNote?: string | null;
  returnedBy?: PersonRef | null;
  /** Optimistický zámek schválení ze seznamu. */
  updatedAt?: string | null;
}

export interface JobFile {
  id: string;
  kind: JobFileKind;
  title: string | null;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  version: number;
  archived: boolean;
  replacedBy: string | null;
  quoteId: string | null;
  uploadedBy: PersonRef | null;
  createdAt: string;
  aiConfidence: number | null;
  note: string | null;
  /** AI z dokladu něco přečetla (ai_extracted není prázdné). */
  hasAiData: boolean;
  /** Kdo doklad vystavil (my / zákazník / dodavatel). */
  issuer?: DocIssuerKey | null;
  /** Odkud dokument je (vystavený, nahraný, foto, e-mail, import). */
  origin?: JobFileOrigin | null;
  /**
   * #25: obsah zamčený pro tohoto uživatele (řádek je vidět, náhled / stažení / odeslání ne):
   * price = nákupní doklad bez práva na marže; unapproved / stale = PDF naší nabídky čekající
   * na schválení / vystavené před posledním schválením.
   */
  locked?: FileLock;
  /** Anonymizace výkresu pro dodavatele (null = netýká se — náš doklad, jiný typ souboru). */
  anon?: JobFileAnon | null;
}

export type JobFileAnonStatus = "pending" | "processing" | "done" | "review" | "failed" | "unsupported" | "skipped";

/** Stav anonymizace dokumentu pro UI (odznak, menu) — bez textů smazaných oblastí. */
export interface JobFileAnon {
  status: JobFileAnonStatus;
  /** Anonymní název kopie („D-1234_B.pdf"). */
  filename: string | null;
  at: string | null;
  /** Kdo anonymizaci provedl (profil) — u AI ten, kdo soubor nahrál. */
  by: string | null;
  actorKind: "user" | "ai" | "system" | null;
  reason: string | null;
  /** Člověk výsledek zkontroloval / schválil. */
  reviewed: boolean;
  reviewedAt: string | null;
  /** Počty smazaných oblastí po kategoriích (company, person, path…). */
  counts: Record<string, number>;
  total: number;
  warnings: { code: string; message: string }[];
  /** Vyřazené stránky (dopis, faktura ve smíšeném PDF). */
  excludedPages: number[];
  method: string | null;
  /** Starý výkres z doby před anonymizací (backfill) — čeká na „Zpracovat staré výkresy", nic neběží. */
  backfill?: boolean;
  /** Zámek běhu (processing) — po termínu je běh přerušený a převezme ho další běh. */
  lockUntil?: string | null;
}

export type FileLock = "price" | "unapproved" | "stale" | null;

export type JobEventType =
  | "created" | "stage" | "status" | "field" | "file" | "quote" | "comment" | "ai" | "email";

export interface JobEvent {
  id: string;
  type: JobEventType;
  message: string;
  data: Record<string, unknown>;
  actor: PersonRef | null;
  createdAt: string;
  /** Druh autora (člověk / AI / systém) — z DB; chybí u starých záznamů. */
  actorKind?: ActorKind | null;
  /** Jméno uložené v době zápisu (přežije smazání účtu). */
  actorName?: string | null;
  via?: ChangeVia | null;
  agent?: string | null;
  /** Fáze / objekt události (job, inquiry, order, quote, delivery, payment, proposal…). */
  entity?: string | null;
}

/** Údaje zákazníka pro doklady (PDF) a detail zakázky. */
export interface JobCustomerDetail {
  id: string;
  name: string;
  customerNumber: string | null;
  supplierNumberAtCustomer: string | null;
  ico: string | null;
  dic: string | null;
  street: string | null;
  city: string | null;
  zip: string | null;
  country: string;
  email: string | null;
  phone: string | null;
  contactPerson: string | null;
  deliveryAddress: string | null;
  paymentTermsDays: number | null;
}

/** Kompletní karta zakázky. */
export interface JobDetail extends JobListItem {
  note: string | null;
  tags: string[];
  technology: string | null;
  manufacturingLocation: string | null;
  specificRequirements: string | null;
  deliveryMethod: string | null;
  supplierOrderNumber: string | null;
  invoiceNumber: string | null;
  deliveryNoteNumber: string | null;
  customerContact: string | null;
  customerContactEmail: string | null;
  customerContactPhone: string | null;
  pricedBy: PersonRef | null;
  approvedBy: PersonRef | null;
  approvedAt: string | null;
  confirmedAt: string | null;
  productionStartedAt: string | null;
  shippedAt: string | null;
  invoicedAt: string | null;
  emailId: string | null;
  aiConfidence: number | null;
  /** Přijatá nabídka (orders.quote_id). */
  acceptedQuoteId: string | null;
  /** Marže jako podíl (0.25 = 25 %) — null bez práva na marže nebo bez dat. */
  margin: number | null;
  customerDetail: JobCustomerDetail | null;
  items: JobItem[];
  quotes: JobQuote[];
  files: JobFile[];
  events: JobEvent[];
  /**
   * Kolik z položky (id) pokrývají vystavené dodací listy — dodané zboží bez DL dostane „DL na dodané
   * zboží". null = nejde poznat (starší DL bez vazby na položky); chybí = nenačteno.
   */
  deliveryDocumented?: Record<string, number> | null;
  /** Vystavené dodací listy (číslo z delivery_notes, id PDF v Dokumentech) — nejnovější první; chybí = nenačteno. */
  deliveryNotes?: { id: string | null; number: string; createdAt: string }[];
}

/** „krok" = krok výroby po termínu nebo ohrožený konečný termín (zákazník). */
export type JobDeadlineFilter = "overdue" | "week" | "month" | "no_date" | "krok";
/**
 * Platba faktury (podrobný stav paymentKey): čeká na úhradu / částečně zaplaceno / po splatnosti /
 * zaplaceno; „nezaplaceno" = vše kromě zaplaceno (vč. po splatnosti).
 */
export type JobPaymentFilter = "ceka_na_uhradu" | "castecne_zaplaceno" | "po_splatnosti" | "nezaplaceno" | "zaplaceno";
export type JobSort = "number" | "created" | "deadline" | "customer" | "value" | "stage" | "updated";

export interface JobFilters {
  group?: StageGroupKey;
  /** Má přednost před group, pokud je neprázdné. */
  stages?: JobStage[];
  /** Fulltext: číslo zakázky, název, zákazník, č. objednávky/poptávky zákazníka, číslo výkresu. */
  q?: string;
  ownerId?: string;
  assigneeId?: string;
  customerId?: string;
  supplierId?: string;
  deadline?: JobDeadlineFilter;
  /** Aktuální výrobní operace (druh nebo „hotovo"). */
  step?: string;
  /** Kde se zakázka právě nachází (název firmy / „U nás"). */
  location?: string;
  payment?: JobPaymentFilter;
  /** Dílčí stav poptávky (orders.inquiry_status). */
  inquiry?: InquiryStatus[];
  /** Objednávka: stav dokladu (dorucena…) nebo plnění (ve_vyrobe, castecne_dodana, dokoncena). */
  order?: string[];
  /** Dodání zákazníkovi (k_expedici, castecne, dodano, dl_potvrzen). */
  delivery?: string[];
  /**
   * Zboží u zákazníka (isDeliveredToCustomer): true = jen dodané celé (Kniha → Dokončené),
   * false = jen bez DL na vše (Kniha → Objednávky v běhu). Bez hodnoty = bez ohledu na dodání.
   */
  deliveredToCustomer?: boolean;
  /** Kdo naposledy změnil hlavní stav nebo dílčí stav (uuid). */
  changedBy?: string;
  sort?: JobSort;
  dir?: "asc" | "desc";
  limit?: number;
}

/** Vstup pro založení / úpravu zakázky. Prázdný řetězec = vymazat hodnotu. */
export interface JobInput {
  title?: string;
  stage?: JobStage;
  priority?: PriorityLevel;
  customerId?: string | null;
  /** Při zakládání: když chybí customerId, dohledá se / založí zákazník tohoto jména. */
  customerName?: string;
  customerOrderNumber?: string;
  customerInquiryNumber?: string;
  customerContact?: string;
  customerContactEmail?: string;
  customerContactPhone?: string;
  inquiryDate?: string;
  orderDate?: string;
  customerRequiredDate?: string;
  dueDate?: string;
  expectedDeliveryDate?: string;
  supplierPromisedDate?: string;
  maxToleratedDate?: string;
  ownerId?: string | null;
  assigneeId?: string | null;
  pricedById?: string | null;
  supplierId?: string | null;
  supplierOrderNumber?: string;
  value?: number | null;
  purchaseCost?: number | null;
  currency?: string;
  technology?: string;
  manufacturingLocation?: string;
  specificRequirements?: string;
  deliveryMethod?: string;
  note?: string;
  tags?: string[];
  invoiceNumber?: string;
  deliveryNoteNumber?: string;
}

export interface JobItemInput {
  id?: string;
  drawingNumber?: string;
  revision?: string;
  name?: string;
  description?: string;
  material?: string;
  quantity: number;
  unit?: string;
  unitPrice?: number | null;
  purchaseUnitPrice?: number | null;
  note?: string;
}

export interface JobQuoteItemInput {
  drawingNumber?: string;
  name?: string;
  description?: string;
  material?: string;
  quantity: number;
  unit?: string;
  unitPrice?: number | null;
  vatRate?: number;
  purchaseUnitPrice?: number | null;
  note?: string;
}

export interface JobQuoteInput {
  title?: string;
  status?: QuoteStatus;
  validUntil?: string;
  leadTimeDays?: number | null;
  deliveryTerms?: string;
  paymentTerms?: string;
  note?: string;
  currency?: string;
  items: JobQuoteItemInput[];
}

/** Výběrové seznamy pro formuláře zakázky. */
export interface JobFormOptions {
  users: (PersonRef & { role: string })[];
  /** ownerId = obchodník zákazníka (nová zakázka ho dostane, když obchodníka nevybírá super admin). */
  customers: { id: string; name: string; customerNumber: string | null; ico: string | null; ownerId?: string | null }[];
  suppliers: { id: string; name: string }[];
}

/** Jednotný výsledek akcí (styl kódu: { ok, error? } + data). */
export type ActionResult<T extends object = object> = { ok: boolean; error?: string } & Partial<T>;
