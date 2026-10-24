// View-modely pro UI (české popisky). Plní se výhradně reálnými daty ze Supabase.
import type { DrawingSpecView } from "@/lib/jobs/drawing-spec";
import type { ApprovalType } from "@/lib/supabase/database.types";
import { MAIN_FLOW, STAGES } from "@/lib/jobs/stages";

export type EmailCategory =
  | "Poptávka"
  | "Objednávka"
  | "Nabídka dodavatele"
  | "Potvrzení objednávky"
  | "Faktura"
  | "Upomínka"
  | "Reklamace"
  | "Technická dokumentace"
  | "Spam"
  | "Ostatní";

export interface EmailItem {
  id: string;
  from: string;
  fromEmail: string;
  subject: string;
  preview: string;
  category: EmailCategory;
  priority: "Vysoká" | "Střední" | "Nízká";
  customer?: string;
  receivedAt: string;
  aiConfidence: number;
  aiSummary?: string;
  unread: boolean;
  hasDraft: boolean;
  // Pošta per uživatel (volitelné — starší volající je nepotřebují)
  mailboxId?: string;
  mailboxEmail?: string;
  direction?: "in" | "out";
  toEmail?: string;
  /** Propojená zakázka (emails.order_id). */
  jobId?: string;
  jobNumber?: string;
}

export interface ApprovalItem {
  id: string;
  /** Surový typ z DB — řídí chování (co approve skutečně provede). */
  rawType: ApprovalType;
  type: string; // český popisek
  title: string;
  summary: string;
  target: string;
  /** Připravený obsah (např. text e-mailu) — lze před odesláním upravit. */
  body: string;
  createdAt: string;
  aiConfidence: number;
}

/** Typy, jejichž schválení něco ODEŠLE ven (zákazníkovi / dodavateli). */
export const OUTBOUND_APPROVAL_TYPES: ApprovalType[] = [
  "email_reply",
  "quote",
  "supplier_request",
  // objednávka dodavateli: resolveApproval ji vyřídí vlastní větví (dřív než obecné odeslání)
  "purchase_order",
  "reminder",
];

export interface OrderItem {
  id: string;
  number: string;
  customer: string;
  title: string;
  /** Český popisek stavu (viz lib/jobs/stages). */
  status: string;
  value: number;
  dueDate: string;
  owner: string;
  // Výrobní pole (kniha zakázek)
  drawing?: string;
  material?: string;
  quantity?: number;
  technology?: string;
  location?: string;
  requirements?: string;
  customerEmail?: string;
}

/** @deprecated Starý výrobní tok — Kniha zakázek používá lib/jobs/stages (MAIN_FLOW). */
export const orderStatusOrder: string[] = MAIN_FLOW.map((s) => STAGES[s].label);

export interface QuoteItem {
  id: string;
  number: string;
  customer: string;
  drawing: string;
  qty: number;
  /** Popisek stavu nabídky (QUOTE_STATES přes quoteStatusLabel, např. „Odeslaná"). */
  status: string;
  value?: number;
  createdAt: string;
}

export interface CustomerItem {
  id: string;
  name: string;
  ico: string;
  country: string;
  contact: string;
  email: string;
  orders: number;
  revenue: number;
  owner: string;
}

export interface SupplierItem {
  id: string;
  name: string;
  country: string;
  technologies: string[];
  materials: string[];
  leadDays: number;
  rating: number;
}

export interface DrawingItem {
  id: string;
  number: string;
  revision: string;
  customer: string;
  material: string;
  dimensions: string;
  qty: number;
  fileType: "PDF" | "STEP" | "DXF" | "IMG";
  uploadedAt: string;
  /** Výkres z focení dokladů: zakázka a dokument zakázky (soubor je v job-files). */
  jobId: string | null;
  jobNumber: string | null;
  jobFileId: string | null;
  /** Název dílu (z razítka / objednávky). */
  title?: string | null;
  /** Materiál, hmotnost, TZ / PÚ, poznámky z výkresu (štítky); null = nic neuvedeno. */
  spec?: DrawingSpecView | null;
}

export interface CommissionRow {
  id: string;
  owner: string;
  revenue: number;
  margin: number;
  rate: number;
  commission: number;
}

/** Počty pro odznaky v navigaci. */
export interface BadgeCounts {
  inbox: number;
  inquiries: number;
  pricing: number;
  quotes: number;
  confirmations: number;
  orders: number;
  approvals: number;
}

/** Záznam odeslané pošty (log odchozích akcí). */
export interface SentItem {
  id: string;
  type: string; // český popisek
  rawType: ApprovalType;
  title: string;
  target: string;
  body: string;
  sentAt: string;
  auto: boolean; // true = odeslala plná automatika, false = schváleno člověkem
  // Pošta per uživatel (volitelné)
  toEmail?: string;
  jobId?: string;
  jobNumber?: string;
  mailboxEmail?: string;
  senderName?: string;
  /** mail = záznam odeslané pošty (emails), approval = starší log fronty schvalování. */
  source?: "mail" | "approval";
  /** Druh zprávy pro barevný odznak. */
  kind?: "email" | "quote" | "reminder" | "supplier";
}
