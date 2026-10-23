// Typy databáze CNC Sales OS (ručně dle supabase/migrations/*).
// Při změně schématu aktualizuj zde i v migracích.

export type UserRole = "super_admin" | "obchodnik" | "zamestnanec";
export type EmailCategory =
  | "poptavka" | "objednavka" | "nabidka_dodavatele" | "potvrzeni_objednavky"
  | "faktura" | "upominka" | "reklamace" | "technicka_dokumentace" | "spam" | "ostatni";
export type PriorityLevel = "nizka" | "stredni" | "vysoka";
export type QuoteStatus = "navrh_ai" | "ke_schvaleni" | "odeslano" | "prijato" | "zamitnuto";
/** Stav zakázky v Knize zakázek (migrace 0019 — nahrazuje původní order_status). */
export type JobStage =
  | "poptavka" | "naceneni" | "nabidka" | "objednavka" | "potvrzeno" | "ve_vyrobe"
  | "dodano_k_nam" | "na_sklade" | "montaz" | "dodano_zakaznikovi" | "fakturovano" | "dokonceno"
  | "pozastaveno" | "reklamace" | "nerealizovano" | "zruseno";
/** @deprecated Zakázka používá JobStage — alias kvůli starším importům. */
export type OrderStatus = JobStage;
export type JobFileKind =
  | "poptavka" | "naceneni" | "nabidka" | "objednavka" | "potvrzeni" | "vykres" | "model_3d"
  | "dodaci_list" | "faktura" | "foto" | "korespondence" | "ostatni"
  /** Naše objednávka vydaná dodavateli (migrace 0020). */
  | "objednavka_vydana";
export type PurchaseOrderStatus = "navrh" | "vystavena" | "odeslana" | "potvrzena" | "dodana" | "zrusena";
export type CommissionStatus = "predbezna" | "k_vyplate" | "vyplaceno";
export type JobSource = "manual" | "foto" | "email" | "import" | "ai";
export type AutomationMode = "full" | "approval";
export type ApprovalType = "email_reply" | "quote" | "supplier_request" | "categorization" | "order_match" | "reminder";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "edited" | "auto_executed";
export type MailboxProvider = "outlook" | "imap" | "gmail";

export interface Profile {
  id: string;
  full_name: string;
  email: string | null;
  role: UserRole;
  commission_rate: number;
  active: boolean;
  // migrace 0019
  ai_access: boolean;
  phone: string | null;
  position: string | null;
  last_seen_at: string | null;
  /** Počáteční heslo od admina → při prvním přihlášení vynutit změnu (migrace 0021). */
  password_change_required: boolean;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: string;
  name: string;
  ico: string | null;
  dic: string | null;
  country: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  note: string | null;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
  // Kniha zakázek (migrace 0019)
  customer_number: string | null;
  supplier_number_at_customer: string | null;
  street: string | null;
  city: string | null;
  zip: string | null;
  contact_person: string | null;
  website: string | null;
  payment_terms_days: number | null;
  delivery_address: string | null;
  // Cenový profil (migrace 0018 — Nacenění v2)
  margin_percent?: number | null;
  price_level?: "nizka" | "standard" | "premium" | null;
  business_priority?: "nizka" | "stredni" | "vysoka" | "strategicky" | null;
  payment_morale?: "vyborna" | "dobra" | "prumerna" | "spatna" | null;
  risk_level?: "nizke" | "stredni" | "vysoke" | null;
  annual_revenue_czk?: number | null;
  repeat_customer?: boolean;
}

export interface CustomerContact {
  id: string;
  customer_id: string;
  name: string;
  position: string | null;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
  created_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  country: string;
  email: string | null;
  phone: string | null;
  technologies: string[];
  materials: string[];
  certifications: string[];
  lead_days: number | null;
  rating: number | null;
  note: string | null;
  // migrace 0019
  ico: string | null;
  dic: string | null;
  contact_person: string | null;
  website: string | null;
  address: string | null;
  created_at: string;
  updated_at: string;
}

export interface Drawing {
  id: string;
  drawing_number: string;
  revision: string;
  customer_id: string | null;
  material: string | null;
  dimensions: string | null;
  tolerances: string | null;
  quantity: number | null;
  file_type: string | null;
  storage_path: string | null;
  ai_metadata: Record<string, unknown>;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
  // migrace capture_batch: výkres z dokumentů zakázky
  storage_bucket: string;
  job_file_id: string | null;
  title: string | null;
  job_id: string | null;
  // Materiál, hmotnost a úpravy z výkresu (migrace 20261023130000) — viz DrawingMaterialColumns
  material_group: string | null;
  material_designation: string | null;
  weight_kg: number | null;
  blank_weight_kg: number | null;
  blank_dims: string | null;
  blank_shape: string | null;
  heat_treatment: string | null;
  surface_treatment: string | null;
  hardness: string | null;
  drawing_notes: string | null;
  weight_source: WeightSource | null;
  material_condition: string | null;
}

export interface Quote {
  id: string;
  number: string | null;
  customer_id: string | null;
  status: QuoteStatus;
  currency: string;
  total: number | null;
  valid_until: string | null;
  note: string | null;
  ai_generated: boolean;
  ai_confidence: number | null;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
  // Životní cyklus (migrace 0011)
  inquiry_received_at?: string | null;
  confirmed_at?: string | null;
  sent_at?: string | null;
  feedback?: string | null;
  rejected_reason?: string | null;
  // Více nabídek na zakázku (migrace 0019)
  job_id: string | null;
  revision: number;
  title: string | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  lead_time_days: number | null;
  delivery_terms: string | null;
  payment_terms: string | null;
  archived: boolean;
  storage_path: string | null;
  // Podrobné stavy toku + atribuce (migrace 20261023100000)
  /** Odvozený stav (jen pro čtení — plní trigger). */
  state: QuoteState;
  state_changed_at: string | null;
  state_changed_by: string | null;
  state_changed_via: ChangeVia | null;
  /** Nutné schválit před odesláním (jen pro čtení — trigger). */
  approval_required: boolean;
  approval_requested_at: string | null;
  approval_requested_by: string | null;
  sent_by: string | null;
  sent_via: ChangeVia | null;
  accepted_at: string | null;
  accepted_by: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
  lost_reason: LostReason | null;
  competitor_price: number | null;
  feedback_at: string | null;
  superseded_by: string | null;
  updated_by: string | null;
  // Role a viditelnost (migrace 20261023155000)
  /** Připravil ne-admin — odeslat až po schválení super adminem (jen pro čtení — trigger). */
  admin_approval_required: boolean;
  /** Otisk obsahu při schválení (píše jen server). */
  approved_snapshot_sha: string | null;
  /** Super admin vrátil nabídku autorovi k přepracování. */
  approval_returned_at: string | null;
  approval_returned_by: string | null;
  approval_return_note: string | null;
}

export interface QuoteItem {
  id: string;
  quote_id: string;
  drawing_id: string | null;
  description: string | null;
  quantity: number;
  unit_price: number | null;
  position: number;
  // migrace 0019
  drawing_number: string | null;
  name: string | null;
  material: string | null;
  unit: string;
  vat_rate: number;
  purchase_unit_price: number | null;
  note: string | null;
}

/** Zakázka (řádek Knihy zakázek). Tabulka se jmenuje orders kvůli historii. */
export interface Order {
  id: string;
  number: string | null;
  customer_id: string | null;
  quote_id: string | null;
  status: JobStage;
  title: string | null;
  value: number | null;
  margin: number | null;
  currency: string;
  due_date: string | null;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
  // Výroba (migrace 0011)
  confirmed_at?: string | null;
  technology?: string | null;
  manufacturing_location?: string | null;
  supplier_id?: string | null;
  specific_requirements?: string | null;
  production_started_at?: string | null;
  produced_at?: string | null;
  shipped_at?: string | null;
  delivered_at?: string | null;
  delivery_method?: string | null;
  // Kniha zakázek (migrace 0019)
  customer_order_number: string | null;
  customer_inquiry_number: string | null;
  customer_contact: string | null;
  customer_contact_email: string | null;
  customer_contact_phone: string | null;
  inquiry_date: string | null;
  order_date: string | null;
  customer_required_date: string | null;
  expected_delivery_date: string | null;
  supplier_promised_date: string | null;
  max_tolerated_date: string | null;
  received_at: string | null;
  invoiced_at: string | null;
  stage_changed_at: string;
  created_by: string | null;
  assignee_id: string | null;
  priced_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  purchase_cost: number | null;
  supplier_order_number: string | null;
  invoice_number: string | null;
  delivery_note_number: string | null;
  priority: PriorityLevel;
  note: string | null;
  tags: string[];
  source: JobSource;
  email_id: string | null;
  ai_filled: boolean;
  ai_confidence: number | null;
  // Inkaso (migrace 0021) — rozhoduje o měsíci pásmové provize
  paid_at: string | null;
  paid_amount: number | null;
  // Výroba a konec toku (migrace 0022)
  production_step: string | null;
  production_location: string | null;
  production_done: number;
  production_total: number;
  production_problem: boolean;
  customer_note: string | null;
  delivery_note_confirmed_at: string | null;
  invoice_date: string | null;
  invoice_due_date: string | null;
  /** Idempotence dávkového focení ("<captureId>:<groupKey>"). */
  capture_key: string | null;
  // Podrobné stavy toku + atribuce (migrace 20261023100000)
  /** null = bez poptávky (rovnou objednávka). */
  inquiry_status: InquiryStatus | null;
  inquiry_status_changed_at: string | null;
  inquiry_status_changed_by: string | null;
  inquiry_status_changed_via: ChangeVia | null;
  waiting_since: string | null;
  waiting_note: string | null;
  /** null = objednávka zatím není. */
  order_status: OrderDocStatus | null;
  order_status_changed_at: string | null;
  order_status_changed_by: string | null;
  order_status_changed_via: ChangeVia | null;
  order_mismatch: OrderMismatch | null;
  /** Poslední revize objednávky přijatá od zákazníka (0 = žádná). */
  order_revision: number;
  /** Revize, kterou jsme přijali (potvrdili). */
  order_confirmed_revision: number | null;
  order_changed_at: string | null;
  order_changed_by: string | null;
  confirmed_by: string | null;
  confirmation_issued_at: string | null;
  confirmation_issued_by: string | null;
  confirmation_issued_revision: number | null;
  confirmation_sent_at: string | null;
  confirmation_sent_by: string | null;
  confirmation_sent_via: ChangeVia | null;
  confirmation_sent_revision: number | null;
  lost_reason: LostReason | null;
  lost_note: string | null;
  lost_at: string | null;
  lost_by: string | null;
  flow_proposal: FlowProposal | null;
  flow_proposal_at: string | null;
  flow_proposal_by: string | null;
  stage_changed_by: string | null;
  stage_changed_via: ChangeVia | null;
  stage_change_cause: FlowCause | null;
  stage_change_note: string | null;
  updated_by: string | null;
  delivery_note_confirmed_by: string | null;
  invoiced_by: string | null;
  invoice_sent_at: string | null;
  invoice_sent_by: string | null;
  paid_by: string | null;
  /** Σ evidovaných úhrad (bez DPH). */
  paid_so_far: number;
  items_count: number;
  items_priced: number;
  /** Položky dodané nebo uzavřené s menším množstvím. */
  items_delivered: number;
  items_partial: number;
  last_delivery_at: string | null;
  partial_delivery_note: string | null;
  partial_delivery_at: string | null;
  partial_delivery_by: string | null;
  // Předání do výroby — souhrn aktuálního kroku pro Knihu (migrace 20261023150000, udržuje DB)
  /** Pořadí aktuálního kroku mezi nepřeskočenými („Krok n/m"). */
  production_step_no?: number | null;
  /** Pořadí aktuálního kroku mezi kroky stejného druhu („Výroba 2"). */
  production_step_kind_no?: number | null;
  production_step_title?: string | null;
  /** Termín aktuálního kroku. */
  production_due?: string | null;
  /** Aktuální krok končí konečným termínem (zákazník). */
  production_due_final?: boolean | null;
  production_due_state?: DeadlineStateDb | null;
  /** Stav objednávky dodavateli u aktuálního kroku. */
  production_po_status?: PurchaseOrderStatus | null;
  /** Nejzazší termín otevřených kroků. */
  production_end?: string | null;
  /** Termín kroku s konečným termínem. */
  production_final_end?: string | null;
  production_finished_at?: string | null;
  production_finished_by?: string | null;
}

/** Výrobní operace zakázky (migrace 0022). */
export interface JobOperationRow {
  id: string;
  job_id: string;
  position: number;
  kind: string;
  title: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  in_house: boolean;
  status: "ceka" | "probiha" | "hotovo" | "problem" | "preskoceno";
  planned_start: string | null;
  planned_end: string | null;
  started_at: string | null;
  finished_at: string | null;
  note: string | null;
  purchase_order_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Podrobné stavy toku + atribuce (migrace 20261023100000)
  // (volitelné: řádky z fixture testů výroby je nemají)
  status_changed_at?: string | null;
  status_changed_by?: string | null;
  status_changed_via?: ChangeVia | null;
  updated_by?: string | null;
  // Předání do výroby (migrace 20261023150000)
  order_item_ids?: string[] | null;
  ends_at_customer_date?: boolean;
  deadline_state?: DeadlineStateDb | null;
  deadline_source?: string | null;
  deadline_changed_at?: string | null;
  deadline_changed_by?: string | null;
  deadline_changed_via?: string | null;
  who_source?: string | null;
  who_changed_at?: string | null;
  who_changed_by?: string | null;
  who_changed_via?: string | null;
  supplier_quote_id?: string | null;
  po_mode?: "vystavit" | "existujici" | "neobjednavat" | "pri_predani" | null;
  po_none_reason?: string | null;
  handoff_id?: string | null;
}

/** Stav termínu kroku výroby (job_operations.deadline_state). */
export type DeadlineStateDb = "odhad" | "dohodnuto" | "pozadovano" | "potvrzeno" | "zmena_ceka" | "plan";

/** Předání do výroby (idempotence RPC production_apply, vrácení předání; migrace 20261023150000). */
export interface ProductionHandoffRow {
  id: string;
  job_id: string;
  token: string;
  kind: "predani" | "doplneni" | "dalsi_krok" | "ukonceni" | "plan" | "zaznam" | "zpet";
  stage_from: JobStage | null;
  stage_to: JobStage | null;
  result: Json | null;
  note: string | null;
  undone_at: string | null;
  undone_by: string | null;
  undone_handoff_id: string | null;
  created_by: string | null;
  created_via: string | null;
  created_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  drawing_id: string | null;
  description: string | null;
  quantity: number;
  unit_price: number | null;
  position: number;
  // migrace 0019
  drawing_number: string | null;
  revision: string | null;
  name: string | null;
  material: string | null;
  unit: string;
  purchase_unit_price: number | null;
  note: string | null;
  created_at: string;
  /** Idempotence dávkového focení. */
  capture_key: string | null;
  // Podrobné stavy toku + atribuce (migrace 20261023100000)
  delivered_quantity: number;
  delivered_changed_at: string | null;
  delivered_changed_by: string | null;
  /** Uzavřeno s menším množstvím (zmetky, zákazník přijal méně). */
  delivery_closed: boolean;
  delivery_closed_reason: string | null;
  delivery_closed_at: string | null;
  delivery_closed_by: string | null;
  created_by: string | null;
  updated_by: string | null;
  // Materiál, hmotnost a úpravy z výkresu (migrace 20261023130000) — viz DrawingMaterialColumns
  material_group: string | null;
  material_designation: string | null;
  weight_kg: number | null;
  blank_weight_kg: number | null;
  blank_dims: string | null;
  blank_shape: string | null;
  heat_treatment: string | null;
  surface_treatment: string | null;
  hardness: string | null;
  drawing_notes: string | null;
  weight_source: WeightSource | null;
  material_condition: string | null;
}

/** Dokument zakázky (výkres, model, nabídka, objednávka, DL, faktura…) s verzemi. */
export interface JobFileRow {
  id: string;
  job_id: string;
  kind: JobFileKind;
  title: string | null;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  storage_path: string;
  version: number;
  archived: boolean;
  replaced_by: string | null;
  quote_id: string | null;
  drawing_id: string | null;
  ai_extracted: Record<string, unknown> | null;
  ai_confidence: number | null;
  note: string | null;
  uploaded_by: string | null;
  created_at: string;
  // migrace capture_batch
  order_item_id: string | null;
  capture_id: string | null;
  content_sha256: string | null;
  // Podrobné stavy toku + atribuce (migrace 20261023100000)
  origin: JobFileOrigin | null;
  issuer: DocIssuerKey | null;
  /** Revize objednávky, kterou náš doklad pokrývá. */
  order_revision: number | null;
  archived_at: string | null;
  archived_by: string | null;
  updated_by: string | null;
}

/** Záznam historie zakázky. */
export interface JobEventRow {
  id: string;
  job_id: string;
  type: string;
  message: string;
  data: Record<string, unknown>;
  actor_id: string | null;
  created_at: string;
  // Podrobné stavy toku + atribuce (migrace 20261023100000)
  actor_kind: ActorKind;
  /** Jméno autora v době zápisu (přežije smazání účtu). */
  actor_name: string | null;
  via: ChangeVia | null;
  agent: string | null;
  entity: string;
  entity_id: string | null;
  request_id: string | null;
}

export interface AiTrainingExample {
  id: string;
  kind: string;
  job_id: string | null;
  job_file_id: string | null;
  doc_kind: string | null;
  source: "ai" | "manual" | "corrected";
  extracted: Record<string, unknown> | null;
  final: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
}

export interface PasswordResetCode {
  id: string;
  user_id: string;
  email: string;
  code_hash: string;
  expires_at: string;
  attempts: number;
  used_at: string | null;
  created_at: string;
}

/**
 * Připojení schránky — příchozí server (`imap_*` platí i pro POP3 při `incoming_protocol: "pop3"`),
 * odchozí SMTP, příp. Graph. Viz src/lib/email/mail-config.ts.
 */
export interface MailboxConfig {
  /** Předvolba poskytovatele: hosting90 | gmail | m365 | other. */
  preset?: "hosting90" | "gmail" | "m365" | "other";
  /** Protokol příchozí pošty (výchozí IMAP). */
  incoming_protocol?: "imap" | "pop3";
  imap_host?: string;
  imap_port?: number;
  imap_user?: string;
  imap_password?: string;
  /** Šifrování příchozího spojení (výchozí podle portu: 993/995 TLS, 143/110 STARTTLS). */
  imap_tls?: "tls" | "starttls";
  /** Šifrovat, ale neověřovat jméno v certifikátu — jen po výslovném souhlasu. */
  imap_skip_name_check?: boolean;
  smtp_host?: string;
  smtp_port?: number;
  smtp_user?: string;
  smtp_password?: string;
  smtp_tls?: "tls" | "starttls";
  smtp_skip_name_check?: boolean;
  ms_graph_client_id?: string;
  ms_graph_client_secret?: string;
  ms_graph_tenant_id?: string;
}

export interface Mailbox {
  id: string;
  provider: MailboxProvider;
  email: string;
  display_name: string | null;
  config: MailboxConfig & Record<string, unknown>;
  active: boolean;
  last_sync_at: string | null;
  created_at: string;
  /** Vlastník schránky — jen on (a super admin) vidí její poštu (migrace 0019). */
  owner_id: string | null;
  /** Stav stahování a posledního testu (tabulka mailbox_status) — jen pro UI. */
  status?: MailboxStatus | null;
  /** Která hesla jsou uložená (samotná hesla se do prohlížeče nikdy neposílají). */
  secrets_set?: { imap_password: boolean; smtp_password: boolean; ms_graph_client_secret: boolean };
  updated_by?: string | null;
}

/** Stav schránky (migrace 20261023120000_schranky_diagnostika) — mimo `mailboxes`, aby stahování nepřepisovalo autora nastavení. */
export interface MailboxStatus {
  mailbox_id: string;
  last_sync_attempt_at: string | null;
  last_sync_ok_at: string | null;
  last_sync_error: string | null;
  /** Druh poslední chyby stažení (classifyMailError: auth, timeout, tls_…); null = OK. */
  last_sync_error_kind?: string | null;
  /** Otisk přihlašovacích údajů při odmítnutém hesle (credentialFingerprint) — automatika se do změny nepřihlašuje. */
  last_sync_auth_fp?: string | null;
  last_sync_fetched: number | null;
  last_sync_new: number | null;
  /** Kolik nových zpráv na serveru ještě čeká (časový limit / limit dávky). */
  last_sync_remaining: number | null;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  last_test_error: string | null;
  /** Kroky posledního testu (bez hesel). */
  last_test: Record<string, unknown> | null;
  last_test_by: string | null;
  /** Stav inkrementálního stahování (IMAP UIDVALIDITY/UID, POP3 UIDL). */
  sync_state: Record<string, unknown>;
  sync_lock_until: string | null;
  updated_at: string;
}

export interface Email {
  id: string;
  mailbox_id: string | null;
  message_id: string | null;
  thread_id: string | null;
  from_name: string | null;
  from_email: string | null;
  to_email: string | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  snippet: string | null;
  category: EmailCategory | null;
  priority: PriorityLevel | null;
  importance: number | null;
  ai_confidence: number | null;
  ai_summary: string | null;
  customer_id: string | null;
  supplier_id: string | null;
  owner_id: string | null;
  quote_id: string | null;
  order_id: string | null;
  is_read: boolean;
  is_spam: boolean;
  has_draft: boolean;
  received_at: string;
  created_at: string;
  // migrace 0019
  direction: "in" | "out";
  cc_email: string | null;
}

export interface AutomationSetting {
  module: string;
  mode: AutomationMode;
  enabled: boolean;
  updated_by: string | null;
  updated_at: string;
}

export interface ApprovalItemRow {
  id: string;
  type: ApprovalType;
  title: string;
  summary: string | null;
  payload: Record<string, unknown>;
  target: string | null;
  status: ApprovalStatus;
  ai_confidence: number | null;
  email_id: string | null;
  quote_id: string | null;
  order_id: string | null;
  owner_id: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface CommissionEntry {
  id: string;
  owner_id: string;
  order_id: string | null;
  period: string;
  revenue: number;
  /** Podíl zisku na obratu (0.25 = 25 %). */
  margin: number;
  rate: number;
  commission: number;
  created_at: string;
  // migrace 0020 — provize ze zisku, přepočet v DB
  cost: number;
  profit: number;
  base: CommissionBase;
  status: CommissionStatus;
  cost_known: boolean;
  updated_at: string;
  // migrace 0021 — pásmová provize z inkasa
  collected: boolean;
  estimated_commission: number | null;
  /** Čísla objednávek dodavatelům s položkou bez ceny — provize čeká na nákupní cenu (migrace 20261023150000). */
  cost_pending_po?: string[] | null;
}

/** margin = ze zisku, revenue = z obratu, margin_tiered = pásmově ze zisku dle měsíčního obratu. */
export type CommissionBase = "margin" | "revenue" | "margin_tiered";

export interface CommissionTier {
  from: number;
  to: number | null;
  rate: number;
}

/** Měsíční vyúčtování provize obchodníka (migrace 0021). */
export interface CommissionStatement {
  id: string;
  owner_id: string;
  period: string;
  rule_name: string | null;
  basis: "ordered" | "collected";
  revenue: number;
  cost: number;
  profit: number;
  commission: number;
  bands: (CommissionTier & { revenue: number; profit: number; commission: number })[];
  jobs_count: number;
  unknown_cost_jobs: number;
  due_date: string | null;
  status: "otevrena" | "k_vyplate" | "vyplaceno";
  paid_at: string | null;
  updated_at: string;
}

export interface CommissionRule {
  id: string;
  owner_id: string;
  rate: number;
  base: CommissionBase;
  valid_from: string;
  note: string | null;
  created_at: string;
  // migrace 0021 — smlouva obchodníka
  name: string | null;
  tiers: CommissionTier[] | null;
  /** ordered = podle objednávek, collected = podle inkasa v měsíci. */
  basis: "ordered" | "collected";
  payout_days: number;
}

/** Nabídka dodavatele k zakázce (migrace 0020). */
export interface SupplierQuoteRow {
  id: string;
  job_id: string;
  supplier_id: string | null;
  supplier_name: string | null;
  number: string | null;
  quote_date: string | null;
  valid_until: string | null;
  lead_time_days: number | null;
  delivery_date: string | null;
  currency: string;
  total: number | null;
  selected: boolean;
  note: string | null;
  file_id: string | null;
  source: "manual" | "foto" | "email" | "ai";
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // migrace capture_batch
  capture_id: string | null;
  capture_doc_id: string | null;
  // Podrobné stavy toku + atribuce (migrace 20261023100000)
  selected_at: string | null;
  selected_by: string | null;
  updated_by: string | null;
  /** Na co je nabídka (druhy kroků výroby; migrace 20261023150000). */
  operation_kinds?: string[] | null;
}

export interface SupplierQuoteItemRow {
  id: string;
  supplier_quote_id: string;
  position: number;
  drawing_number: string | null;
  name: string | null;
  material: string | null;
  quantity: number;
  unit: string;
  unit_price: number | null;
  note: string | null;
}

/** Objednávka vydaná dodavateli (migrace 0020). */
export interface PurchaseOrderRow {
  id: string;
  job_id: string;
  supplier_id: string | null;
  supplier_quote_id: string | null;
  number: string | null;
  status: PurchaseOrderStatus;
  order_date: string;
  required_date: string | null;
  confirmed_date: string | null;
  currency: string;
  total: number;
  delivery_terms: string | null;
  payment_terms: string | null;
  delivery_address: string | null;
  note: string | null;
  supplier_reference: string | null;
  file_id: string | null;
  created_by: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
  // Podrobné stavy toku + atribuce (migrace 20261023100000)
  status_changed_at: string | null;
  status_changed_by: string | null;
  status_changed_via: ChangeVia | null;
  sent_by: string | null;
  /** Kdy zapsáno potvrzení (≠ confirmed_date = termín). */
  confirmed_at: string | null;
  confirmed_by: string | null;
  delivered_at: string | null;
  delivered_by: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  updated_by: string | null;
  // Předání do výroby (migrace 20261023150000)
  /** Verze objednávky (změna po odeslání = +1). */
  revision?: number;
  handoff_id?: string | null;
  /** Ze které schránky objednávka odešla. */
  sent_mailbox_id?: string | null;
}

export interface PurchaseOrderItemRow {
  id: string;
  purchase_order_id: string;
  position: number;
  drawing_number: string | null;
  name: string | null;
  material: string | null;
  quantity: number;
  unit: string;
  unit_price: number | null;
  note: string | null;
  // Podrobné stavy toku + atribuce (migrace 20261023100000)
  received_quantity: number;
  received_changed_at: string | null;
  received_changed_by: string | null;
  receipt_closed: boolean;
  receipt_closed_reason: string | null;
  order_item_id: string | null;
}

export interface KnowledgeDocument {
  id: string;
  source_type: string;
  title: string | null;
  content: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AgentRules {
  agent_key: string;
  label: string;
  instructions: string;
  always_rules: string[];
  never_rules: string[];
  updated_by: string | null;
  updated_at: string;
}

export interface IntegrationSetting {
  key: string;
  value: string | null;
  is_secret: boolean;
  category: string;
  label: string;
  updated_by: string | null;
  updated_at: string;
}

export interface Correction {
  id: string;
  agent_key: string;
  field: string | null;
  context: string | null;
  ai_value: string | null;
  corrected_value: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

// ── Nacenění v2 (migrace 0018) ──────────────────────────────
export interface MaterialRow {
  key: string;
  label: string;
  material_group: string;
  density_kg_dm3: number;
  price_per_kg: number;
  machinability: number;
  special: boolean;
  availability: "bezna" | "omezena" | "specialni";
  aliases: string[];
  updated_at: string;
}

export interface MachineRateRow {
  key: string;
  label: string;
  technology: string;
  size: "maly" | "stredni" | "velky" | "portal";
  rate_per_hour: number;
  updated_at: string;
}

export interface PricingCalculation {
  id: string;
  drawing_number: string | null;
  customer_id: string | null;
  customer_name: string | null;
  material: string | null;
  quantity: number;
  inputs: Record<string, unknown>;
  baseline: Record<string, unknown>;
  estimate: Record<string, unknown>;
  unit_price: number | null;
  total_price: number | null;
  margin_percent: number | null;
  lead_time_days: number | null;
  strategy_level: number | null;
  confidence: number | null;
  corrected: boolean;
  user_unit_price: number | null;
  user_lead_time_days: number | null;
  user_margin_percent: number | null;
  user_note: string | null;
  corrected_at: string | null;
  actual_minutes: number | null;
  actual_cost: number | null;
  quote_id: string | null;
  created_by: string | null;
  created_at: string;
}

/** Relace dávkového focení (jen servisní klíč). */
export interface CaptureSessionRow {
  id: string;
  user_id: string;
  status: "open" | "partial" | "done" | "discarded";
  data: Record<string, unknown>;
  lock_token: string | null;
  lock_until: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface CaptureDocExtractRow {
  capture_id: string;
  doc_id: string;
  pages_key: string;
  doc_type: string;
  status: "reading" | "ready" | "manual" | "error";
  data: Record<string, unknown> | null;
  error: string | null;
  usage: Record<string, unknown> | null;
  started_at: string;
  updated_at: string;
}

export interface CaptureApplyStepRow {
  capture_id: string;
  step: string;
  status: "started" | "done" | "failed";
  result: Record<string, unknown> | null;
  updated_at: string;
}

type Tbl<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export interface Database {
  public: {
    Tables: {
      profiles: Tbl<Profile>;
      customers: Tbl<Customer>;
      customer_contacts: Tbl<CustomerContact>;
      suppliers: Tbl<Supplier>;
      drawings: Tbl<Drawing>;
      quotes: Tbl<Quote>;
      quote_items: Tbl<QuoteItem>;
      orders: Tbl<Order>;
      order_items: Tbl<OrderItem>;
      mailboxes: Tbl<Mailbox>;
      mailbox_status: Tbl<MailboxStatus>;
      emails: Tbl<Email>;
      automation_settings: Tbl<AutomationSetting>;
      approval_queue: Tbl<ApprovalItemRow>;
      commission_entries: Tbl<CommissionEntry>;
      knowledge_documents: Tbl<KnowledgeDocument>;
      ai_agent_rules: Tbl<AgentRules>;
      integration_settings: Tbl<IntegrationSetting>;
      ai_corrections: Tbl<Correction>;
      materials: Tbl<MaterialRow>;
      machine_rates: Tbl<MachineRateRow>;
      pricing_calculations: Tbl<PricingCalculation>;
      job_files: Tbl<JobFileRow>;
      job_events: Tbl<JobEventRow>;
      ai_training_examples: Tbl<AiTrainingExample>;
      password_reset_codes: Tbl<PasswordResetCode>;
      commission_rules: Tbl<CommissionRule>;
      commission_statements: Tbl<CommissionStatement>;
      job_operations: Tbl<JobOperationRow>;
      supplier_quotes: Tbl<SupplierQuoteRow>;
      supplier_quote_items: Tbl<SupplierQuoteItemRow>;
      purchase_orders: Tbl<PurchaseOrderRow>;
      purchase_order_items: Tbl<PurchaseOrderItemRow>;
      capture_sessions: Tbl<CaptureSessionRow>;
      capture_doc_extracts: Tbl<CaptureDocExtractRow>;
      capture_apply_steps: Tbl<CaptureApplyStepRow>;
      job_payments: Tbl<JobPaymentRow>;
      job_order_revisions: Tbl<JobOrderRevisionRow>;
      production_handoffs: Tbl<ProductionHandoffRow>;
    };
    Views: {
      job_flow_v: { Row: JobFlowRow; Relationships: [] };
    };
    Functions: {
      next_doc_number: { Args: { p_prefix: string }; Returns: string };
      next_job_number: { Args: Record<string, never>; Returns: string };
      next_customer_number: { Args: Record<string, never>; Returns: string };
      next_purchase_order_number: { Args: Record<string, never>; Returns: string };
      recompute_job_commission: { Args: { p_job: string }; Returns: undefined };
      capture_try_lock: { Args: { p_capture: string; p_user: string; p_token: string; p_ttl_seconds: number }; Returns: boolean };
      capture_unlock: { Args: { p_capture: string; p_token: string }; Returns: undefined };
      app_whoami: { Args: Record<string, never>; Returns: Record<string, unknown> };
      production_apply: {
        Args: { p_job: string; p_token: string; p_kind: string; p_expected_stage: JobStage; p_expected_route: string; p_payload: Json };
        Returns: Json;
      };
      production_plan_ready: { Args: { p_job: string }; Returns: boolean };
      /** Dopočet starých dat předání do výroby (idempotentní; jen servisní role). */
      production_handoff_backfill: { Args: Record<string, never>; Returns: undefined };
      production_route_version: { Args: { p_job: string }; Returns: string };
      flow_counts: {
        Args: { p_owner?: string | null; p_closed_days?: number; p_mine?: string | null };
        Returns: { flow_phase: string; flow_key: string; n: number }[];
      };
      /** Moje zakázky obchodního toku (migrace 20261023155000; session → vždy auth.uid()). */
      flow_mine_job_ids: { Args: { p_user: string }; Returns: string[] };
      /** Odznaky menu (p_mine null = všichni). */
      flow_badge_counts: {
        Args: { p_mine?: string | null };
        Returns: {
          inquiries: number; pricing: number; quotes_pending: number; quotes_pending_manual: number;
          quotes_ready: number; quotes_returned: number; confirmations: number;
        }[];
      };
      my_mailbox_ids: { Args: Record<string, never>; Returns: string[] };
      job_file_is_price_doc: {
        Args: { p_id: string; p_kind: string; p_issuer: string | null; p_origin: string | null };
        Returns: boolean;
      };
      flow_register_order_change: {
        Args: { p_job: string; p_note?: string | null; p_file?: string | null; p_changes?: Json | null; p_customer_order_number?: string | null };
        Returns: number;
      };
      flow_decide_order_change: { Args: { p_job: string; p_accept: boolean; p_note?: string | null }; Returns: undefined };
      flow_reject_quote: {
        Args: { p_quote: string; p_reason: string; p_note?: string | null; p_competitor_price?: number | null; p_close_job?: boolean };
        Returns: JobStage;
      };
    };
    Enums: {
      user_role: UserRole;
      email_category: EmailCategory;
      job_stage: JobStage;
      job_file_kind: JobFileKind;
      quote_status: QuoteStatus;
    };
  };
}

// ── Podrobné stavy obchodního toku + „kdo to udělal" (migrace 20261023100000) ──
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
export type InquiryStatus = "prijata" | "v_reseni" | "ceka_na_podklady" | "zpracovana" | "odmitnuta" | "stazena";
export type OrderDocStatus = "dorucena" | "rozpor" | "potvrzena" | "aktualizovana" | "stornovana";
export type QuoteState = "rozpracovana" | "ke_schvaleni" | "schvalena" | "odeslana" | "pripominky"
  | "prijata" | "zamitnuta" | "archivovana";
export type LostReason = "nevyrabime" | "kapacita" | "nevyplati_se" | "duplicita" | "cena" | "termin"
  | "jiny_dodavatel" | "projekt_zrusen" | "bez_odezvy" | "zakaznik_stahl" | "jine" | "neuvedeno";
export type ChangeVia = "rucne" | "ai" | "foto" | "email" | "automaticky" | "import" | "cron" | "rest" | "db";
export type ActorKind = "user" | "ai" | "system";
export type FlowCause = "vyroba" | "platba" | "nabidka" | "dodani" | "poptavka" | "objednavka" | "obnoveni"
  | "podklady" | "potvrzeni" | "uzavreni" | "prijeti";
export type OrderRevisionDecision = "ceka" | "prijata" | "odmitnuta";
export type JobFileOrigin = "generated" | "upload" | "capture" | "email" | "import";
export type DocIssuerKey = "my" | "zakaznik" | "dodavatel";

export type OrderMismatchKind = "cena" | "mnozstvi" | "revize_vykresu" | "termin" | "chybi_polozka" | "polozka_navic"
  | "platebni_podminky" | "jine";

/** Rozpor objednávky s nabídkou (orders.order_mismatch). */
export interface OrderMismatch {
  items: { kind: OrderMismatchKind; label: string; quote?: string | null; order?: string | null }[];
  source: "ai" | "rucne";
  detected_at: string;
  fix_requested_at?: string | null;
  resolved?: { decision: "prijato_jak_je" | "opraveno"; at: string; by: string | null } | null;
}

/** Návrh změny dílčího stavu (orders.flow_proposal) — zaměstnanec / AI navrhne, rozhodne člověk s právem. */
export interface FlowProposal {
  phase: "inquiry" | "order" | "quote";
  to: string;
  quoteId?: string;
  reason?: LostReason;
  note?: string;
  kind: "user" | "ai";
  agent?: string;
  label: string;
  confidence?: number;
  by?: string | null;
}

/** Úhrada zakázky (bez DPH; amount null = celá / zbývající částka). */
export interface JobPaymentRow {
  id: string;
  job_id: string;
  paid_on: string;
  amount: number | null;
  /** Úhrada zakázku vyrovnává („Zaplaceno"). */
  settles: boolean;
  note: string | null;
  recorded_by: string | null;
  recorded_name: string | null;
  via: ChangeVia;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Revize objednávky zákazníka (změna potvrzené objednávky). */
export interface JobOrderRevisionRow {
  id: string;
  job_id: string;
  revision: number;
  customer_order_number: string | null;
  file_id: string | null;
  changes: { field: string; label: string; from: unknown; to: unknown }[] | null;
  note: string | null;
  decision: OrderRevisionDecision;
  decided_at: string | null;
  decided_by: string | null;
  decision_note: string | null;
  created_by: string | null;
  created_via: string | null;
  created_at: string;
}

/** Řádek view job_flow_v — odvozené dílčí stavy (zrcadlo v src/lib/jobs/flow-status.ts). */
export interface JobFlowRow {
  id: string;
  number: string | null;
  status: JobStage;
  owner_id: string | null;
  assignee_id: string | null;
  customer_id: string | null;
  stage_changed_at: string;
  stage_rank: number;
  inquiry_key: InquiryStatus | null;
  pricing_key: "ceka" | "ceka_na_dodavatele" | "rozpracovano" | "naceneno" | null;
  quote_id: string | null;
  quote_number: string | null;
  quote_revision: number | null;
  quote_ai: boolean | null;
  quote_approval_required: boolean | null;
  quote_key: QuoteState | "vyprsela" | null;
  order_key: OrderDocStatus | null;
  fulfilment_key: "ve_vyrobe" | "castecne_dodana" | "dokoncena" | null;
  confirmation_key: "k_vystaveni" | "vystaveno" | "odeslano" | "bez_dokladu" | null;
  delivery_key: "k_expedici" | "castecne" | "dodano" | "dl_potvrzen" | null;
  payment_key: "ceka_na_uhradu" | "castecne_zaplaceno" | "po_splatnosti" | "zaplaceno" | null;
  waiting_days: number | null;
  has_proposal: boolean;
  items_count: number;
  items_delivered: number;
  items_partial: number;
  production_done: number;
  production_total: number;
  paid_so_far: number;
}

/** Zdroj hmotnosti dílu (drawings / order_items.weight_source, migrace 20261023130000). */
export type WeightSource = "vykres" | "odhad" | "rucne";
