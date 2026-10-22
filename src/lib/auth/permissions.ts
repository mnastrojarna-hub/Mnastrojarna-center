import type { UserRole } from "@/lib/supabase/database.types";

/**
 * Oprávnění — čistá logika bez DB (sdílí server i klient).
 *
 * Pravidla dle zadání:
 *  - Kniha zakázek, obchodní tok (poptávky, nacenění, nabídky, potvrzení, dokumenty),
 *    zákazníci a dodavatelé → všichni aktivní uživatelé.
 *  - Pošta → každý svou schránku, super admin všechny.
 *  - AI asistent, ladění AI, znalostní DB, archiv výkresů, AI nacenění,
 *    nastavení a správa uživatelů → jen super admin.
 *  - AI čtení dokladů z fotky → super admin; ostatní jen když jim to super admin
 *    povolí (per uživatel, nebo pro všechny) — jinak vyplňují ručně a AI se učí.
 *  - Marže a nákupní ceny → super admin a obchodník.
 */

export type Feature =
  | "orders"          // Kniha zakázek
  | "workflow"        // Poptávky, Nacenění, Nabídky, Potvrzení (detaily toku)
  | "documents"       // Dokumenty (PDF faktury, nabídky, DL)
  | "customers"
  | "suppliers"
  | "mail"            // vlastní pošta
  | "mail_all"        // pošta všech schránek
  | "dashboard"       // AI přehled + fronta schvalování
  | "ai_assistant"
  | "ai_tuning"       // Ladění & korekce AI
  | "knowledge"       // Znalostní DB
  | "drawings"        // Archiv výkresů
  | "ai_pricing"      // AI nacenění
  | "ai_capture"      // AI čtení dokladů z fotky
  | "commissions"     // vlastní provize
  | "commissions_all" // provize všech
  | "margins"         // nákupní ceny a marže
  | "users"           // správa uživatelů
  | "settings"        // systémové nastavení
  | "delete";         // mazání zakázek a dokladů

export const ALL_FEATURES: Feature[] = [
  "orders", "workflow", "documents", "customers", "suppliers", "mail", "mail_all", "dashboard",
  "ai_assistant", "ai_tuning", "knowledge", "drawings", "ai_pricing", "ai_capture",
  "commissions", "commissions_all", "margins", "users", "settings", "delete",
];

export interface AccessSubject {
  role: UserRole;
  /** Super admin povolil tomuto uživateli AI (profiles.ai_access). */
  aiAccess: boolean;
  active: boolean;
}

export interface AccessContext {
  /** Hlavní vypínač AI (Nastavení → AI přístup). */
  aiEnabled: boolean;
  /** AI čtení dokladů povoleno všem uživatelům. */
  aiCaptureForAll: boolean;
  /** Je nastaven Claude API klíč. */
  aiConfigured: boolean;
}

export const DEFAULT_ACCESS_CONTEXT: AccessContext = {
  aiEnabled: true,
  aiCaptureForAll: false,
  aiConfigured: false,
};

const EVERYONE: Feature[] = ["orders", "workflow", "documents", "customers", "suppliers", "mail"];
const SALES_EXTRA: Feature[] = ["commissions", "margins"];
const ADMIN_ONLY: Feature[] = [
  "mail_all", "dashboard", "ai_assistant", "ai_tuning", "knowledge", "drawings",
  "commissions_all", "users", "settings", "delete",
];
/** Funkce, které reálně volají AI — vyžadují hlavní vypínač i klíč. */
const AI_RUNTIME: Feature[] = ["ai_assistant", "ai_pricing", "ai_capture"];

export function can(subject: AccessSubject | null | undefined, feature: Feature, ctx: AccessContext): boolean {
  if (!subject || !subject.active) return false;

  if (AI_RUNTIME.includes(feature) && (!ctx.aiEnabled || !ctx.aiConfigured)) return false;

  if (subject.role === "super_admin") return true;

  if (EVERYONE.includes(feature)) return true;
  if (ADMIN_ONLY.includes(feature)) return false;

  if (feature === "ai_capture") return subject.aiAccess || ctx.aiCaptureForAll;
  if (feature === "ai_pricing") return false; // nacenění dělá zatím člověk

  if (subject.role === "obchodnik" && SALES_EXTRA.includes(feature)) return true;
  return false;
}

/** Seznam povolených funkcí (pro navigaci a klienta). */
export function allowedFeatures(subject: AccessSubject | null | undefined, ctx: AccessContext): Feature[] {
  return ALL_FEATURES.filter((f) => can(subject, f, ctx));
}

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: "Super admin",
  obchodnik: "Obchodník",
  zamestnanec: "Zaměstnanec",
};

/** Krátké vysvětlení role pro správu uživatelů. */
export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  super_admin: "Vidí a nastavuje vše, včetně AI, pošty všech a uživatelů.",
  obchodnik: "Kniha zakázek, zákazníci, dodavatelé, vlastní pošta, marže a vlastní provize.",
  zamestnanec: "Kniha zakázek, zákazníci, dodavatelé a vlastní pošta. Bez marží a provizí.",
};

/** Lidský popis, proč funkce není dostupná (pro stránku „bez přístupu"). */
export const FEATURE_LABELS: Record<Feature, string> = {
  orders: "Kniha zakázek",
  workflow: "Obchodní tok",
  documents: "Dokumenty",
  customers: "Zákazníci",
  suppliers: "Dodavatelé",
  mail: "Pošta",
  mail_all: "Pošta všech schránek",
  dashboard: "AI přehled",
  ai_assistant: "AI asistent",
  ai_tuning: "Ladění AI",
  knowledge: "Znalostní databáze",
  drawings: "Archiv výkresů",
  ai_pricing: "AI nacenění",
  ai_capture: "AI čtení dokladů",
  commissions: "Provize",
  commissions_all: "Provize všech",
  margins: "Marže a nákupní ceny",
  users: "Uživatelé",
  settings: "Nastavení",
  delete: "Mazání",
};
