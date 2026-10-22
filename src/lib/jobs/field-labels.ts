import { STAGES, isJobStage } from "@/lib/jobs/stages";
import { formatCZK } from "@/lib/utils";

/**
 * České popisky sloupců zakázky (tabulka orders) a formát hodnot pro historii
 * změn, AI korekce a formuláře. Čistá logika bez DB.
 */

export const JOB_FIELD_LABELS: Record<string, string> = {
  number: "Číslo zakázky",
  title: "Název zakázky",
  status: "Stav",
  priority: "Priorita",
  customer_id: "Zákazník",
  customer_order_number: "Číslo objednávky zákazníka",
  customer_inquiry_number: "Číslo poptávky zákazníka",
  customer_contact: "Kontaktní osoba zákazníka",
  customer_contact_email: "E-mail kontaktní osoby",
  customer_contact_phone: "Telefon kontaktní osoby",
  inquiry_date: "Datum poptávky",
  order_date: "Datum objednávky",
  customer_required_date: "Požadovaný termín zákazníkem",
  due_date: "Potvrzený termín zákazníkovi",
  expected_delivery_date: "Předpokládaný termín dodání",
  supplier_promised_date: "Slíbený termín od dodavatele",
  max_tolerated_date: "Maximální tolerovaný termín",
  owner_id: "Obchodník",
  assignee_id: "Zpracovává",
  priced_by: "Nacenil",
  approved_by: "Schválil",
  created_by: "Zadal",
  supplier_id: "Dodavatel",
  supplier_order_number: "Číslo objednávky u dodavatele",
  value: "Hodnota zakázky (bez DPH)",
  purchase_cost: "Nákupní náklady",
  currency: "Měna",
  technology: "Technologie",
  manufacturing_location: "Místo výroby",
  specific_requirements: "Specifické požadavky",
  delivery_method: "Způsob dodání",
  note: "Interní poznámka",
  tags: "Štítky",
  invoice_number: "Číslo faktury",
  delivery_note_number: "Číslo dodacího listu",
  quote_id: "Přijatá nabídka",
  confirmed_at: "Potvrzeno",
  production_started_at: "Zahájení výroby",
  received_at: "Dodáno k nám",
  shipped_at: "Expedováno",
  delivered_at: "Dodáno zákazníkovi",
  invoiced_at: "Vyfakturováno",
  approved_at: "Schváleno",
  stage_changed_at: "Změna stavu",
  source: "Zdroj",
  email_id: "E-mail",
  ai_filled: "Vyplněno AI",
  ai_confidence: "Jistota AI",
  created_at: "Založeno",
  updated_at: "Upraveno",
};

/** Sloupce typu date (RRRR-MM-DD). */
export const JOB_DATE_COLUMNS: readonly string[] = [
  "inquiry_date", "order_date", "customer_required_date", "due_date",
  "expected_delivery_date", "supplier_promised_date", "max_tolerated_date",
];

/** Sloupce typu timestamptz. */
export const JOB_TIMESTAMP_COLUMNS: readonly string[] = [
  "confirmed_at", "production_started_at", "received_at", "shipped_at", "delivered_at",
  "invoiced_at", "approved_at", "stage_changed_at", "created_at", "updated_at",
];

/** Peněžní sloupce. */
export const JOB_MONEY_COLUMNS: readonly string[] = ["value", "purchase_cost"];

/** Odkazy na osoby (profiles). */
export const JOB_PERSON_COLUMNS: readonly string[] = ["owner_id", "assignee_id", "priced_by", "approved_by", "created_by"];

/** Citlivé sloupce — hodnoty smí vidět jen uživatel s právem „margins". */
export const SENSITIVE_JOB_COLUMNS: readonly string[] = ["purchase_cost", "margin"];

export const PRIORITY_LABELS: Record<string, string> = {
  nizka: "Nízká",
  stredni: "Střední",
  vysoka: "Vysoká",
};

export const SOURCE_LABELS: Record<string, string> = {
  manual: "Ručně",
  foto: "Z fotky",
  email: "Z e-mailu",
  import: "Import",
  ai: "AI",
};

export function fieldLabel(column: string): string {
  return JOB_FIELD_LABELS[column] ?? column;
}

/** „2026-03-12" → „12. 3. 2026" (bez vlivu časového pásma). */
export function formatIsoDate(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return null;
  return `${Number(m[3])}. ${Number(m[2])}. ${m[1]}`;
}

/** Časové razítko → „12. 3. 2026 14:05" v pražském čase. */
export function formatTimestamp(value: string | Date): string | null {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Prague",
    year: "numeric", month: "numeric", day: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${Number(get("day"))}. ${Number(get("month"))}. ${get("year")} ${get("hour")}:${get("minute")}`;
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 3 }).format(n);
}

/** Lidsky čitelná hodnota sloupce zakázky (historie změn, korekce AI). */
export function formatFieldValue(column: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string" && value.trim() === "") return "—";

  if (typeof value === "boolean") return value ? "ano" : "ne";

  if (Array.isArray(value)) {
    const parts = value.map((v) => (v === null || v === undefined ? "" : String(v).trim())).filter(Boolean);
    return parts.length ? parts.join(", ") : "—";
  }

  if (column === "status" && isJobStage(value)) return STAGES[value].label;
  if (column === "priority" && typeof value === "string") return PRIORITY_LABELS[value] ?? value;
  if (column === "source" && typeof value === "string") return SOURCE_LABELS[value] ?? value;

  if (JOB_DATE_COLUMNS.includes(column) && typeof value === "string") {
    return formatIsoDate(value) ?? value;
  }
  if (JOB_TIMESTAMP_COLUMNS.includes(column) && (typeof value === "string" || value instanceof Date)) {
    return formatTimestamp(value) ?? String(value);
  }

  const num = typeof value === "number" ? value : typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : null;
  if (JOB_MONEY_COLUMNS.includes(column) && num !== null && Number.isFinite(num)) return formatCZK(num);
  if (column === "ai_confidence" && num !== null && Number.isFinite(num)) return `${Math.round(num * 100)} %`;
  if (typeof value === "number") return Number.isFinite(value) ? formatNumber(value) : "—";

  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "—";
    }
  }
  return String(value);
}
