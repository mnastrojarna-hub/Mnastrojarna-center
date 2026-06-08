// Typy databáze CNC Sales OS (ručně dle supabase/migrations/*).
// Při změně schématu aktualizuj zde i v migracích.

export type UserRole = "super_admin" | "obchodnik" | "zamestnanec";
export type EmailCategory =
  | "poptavka" | "objednavka" | "nabidka_dodavatele" | "potvrzeni_objednavky"
  | "faktura" | "upominka" | "reklamace" | "technicka_dokumentace" | "spam" | "ostatni";
export type PriorityLevel = "nizka" | "stredni" | "vysoka";
export type QuoteStatus = "navrh_ai" | "ke_schvaleni" | "odeslano" | "prijato" | "zamitnuto";
export type OrderStatus = "prijato" | "naceneni" | "objednano" | "ve_vyrobe" | "expedovano" | "dokonceno" | "zruseno";
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
}

export interface QuoteItem {
  id: string;
  quote_id: string;
  drawing_id: string | null;
  description: string | null;
  quantity: number;
  unit_price: number | null;
  position: number;
}

export interface Order {
  id: string;
  number: string | null;
  customer_id: string | null;
  quote_id: string | null;
  status: OrderStatus;
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
}

export interface OrderItem {
  id: string;
  order_id: string;
  drawing_id: string | null;
  description: string | null;
  quantity: number;
  unit_price: number | null;
  position: number;
}

export interface Mailbox {
  id: string;
  provider: MailboxProvider;
  email: string;
  display_name: string | null;
  config: Record<string, unknown>;
  active: boolean;
  last_sync_at: string | null;
  created_at: string;
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
    };
    Views: Record<string, never>;
    Functions: {
      next_doc_number: { Args: { p_prefix: string }; Returns: string };
    };
    Enums: {
      user_role: UserRole;
      email_category: EmailCategory;
      order_status: OrderStatus;
      quote_status: QuoteStatus;
    };
  };
}
