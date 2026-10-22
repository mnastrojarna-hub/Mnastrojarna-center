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
  | "dodaci_list" | "faktura" | "foto" | "korespondence" | "ostatni";
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

/** Připojení schránky — servery příchozí (IMAP) a odchozí (SMTP) pošty, příp. Graph. */
export interface MailboxConfig {
  imap_host?: string;
  imap_port?: number;
  imap_user?: string;
  imap_password?: string;
  smtp_host?: string;
  smtp_port?: number;
  smtp_user?: string;
  smtp_password?: string;
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
  margin: number;
  rate: number;
  commission: number;
  created_at: string;
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
    };
    Views: Record<string, never>;
    Functions: {
      next_doc_number: { Args: { p_prefix: string }; Returns: string };
      next_job_number: { Args: Record<string, never>; Returns: string };
      next_customer_number: { Args: Record<string, never>; Returns: string };
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
