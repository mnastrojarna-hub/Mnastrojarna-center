// View-modely pro UI (české popisky). Plní se výhradně reálnými daty ze Supabase.
import type { ApprovalType } from "@/lib/supabase/database.types";

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
  "reminder",
];

export interface OrderItem {
  id: string;
  number: string;
  customer: string;
  title: string;
  status: "Přijato" | "Nacenění" | "Objednáno" | "Ve výrobě" | "Expedováno" | "Dokončeno";
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

export const orderStatusOrder: OrderItem["status"][] = [
  "Přijato",
  "Nacenění",
  "Objednáno",
  "Ve výrobě",
  "Expedováno",
  "Dokončeno",
];

export interface QuoteItem {
  id: string;
  number: string;
  customer: string;
  drawing: string;
  qty: number;
  status: "Návrh AI" | "Ke schválení" | "Odesláno" | "Přijato" | "Zamítnuto";
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
  quotes: number;
  orders: number;
  approvals: number;
}
