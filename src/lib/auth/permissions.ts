import type { UserRole } from "@/lib/supabase/database.types";

/**
 * Oprávnění — čistá logika bez DB (sdílí server i klient).
 *
 * Pravidla dle zadání majitele (#25 „Role a viditelnost"):
 *  1. Obchodní tok (Poptávky, Nabídky, Potvrzení, Objednávky dodavatelům, Dokumenty) vidí každý
 *     jen „svůj" (zakázky, kde je obchodník / zpracovává / založil, a doklady z jeho schránky);
 *     super admin vše (flow_all). „Moje" je filtr datových dotazů, ne hranice oprávnění.
 *  2. Kniha zakázek, detail zakázky, zákazníci a dodavatelé → všichni aktivní uživatelé;
 *     nákupní ceny, marže a nákupní doklady jen obchodník a super admin (margins); 9. 11. i zaměstnanec
 *     s „Vidí nákupní ceny a marže" (canSeeMargins).
 *  Fronta ke schválení (approval_queue) → super admin; 9. 11. i kolega se „Smí řešit frontu ke schválení".
 *  3. Pošta → každý své schránky, super admin všechny.
 *  4. Vyfotit doklad → AI čtení pro všechny (výchozí zapnuto, super admin může vypnout);
 *     ručně jen bez API klíče nebo po vypnutí.
 *  5. Nacenění → zatím jen super admin (pricing); ostatní připraví nabídku ručně.
 *  6. Nabídku uživatele se „Nabídky musí schválit super admin" schvaluje před odesláním super admin,
 *     nebo kolega se „Smí schvalovat nabídky ostatních" (31. 10., quote_approval; vlastní nabídku nikdo
 *     neschvaluje sám — per nabídka rozhoduje mayManageQuoteApproval); po schválení ji odešle obchodník
 *     nebo její autor.
 *  AI asistent, ladění AI, znalostní DB, archiv výkresů, AI nacenění, nastavení a správa
 *  uživatelů → jen super admin.
 */

export type Feature =
  | "orders"          // Kniha zakázek
  | "workflow"        // Poptávky, Nacenění, Nabídky, Potvrzení (detaily toku)
  | "documents"       // Dokumenty (PDF faktury, nabídky, DL)
  | "customers"
  | "suppliers"
  | "mail"            // vlastní pošta
  | "mail_all"        // pošta všech schránek
  | "dashboard"       // AI přehled + fronta schvalování (super admin)
  | "approval_queue"  // fronta ke schválení — vyřídit položku (super admin; 9. 11. ostatní s příznakem)
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
  | "delete"          // mazání zakázek a dokladů
  | "pricing"         // Nacenění (zatím jen super admin)
  | "quote_approval"  // schvalování nabídek
  | "flow_all"        // obchodní tok všech (bez toho jen „moje")
  | "supplier_invoices_upload" // nahrát fakturu dodavatele (všichni)
  | "supplier_invoices"        // faktury dodavatelů — seznam, detail, rozdělení (super admin; přepínač → všichni)
  | "supplier_invoices_paid"   // zaplaceno / nezaplaceno faktury dodavatele (vždy jen super admin)
  | "issued_invoices"          // Faktury vydané — kniha našich faktur, součty, hromadný export pro účetní (10. 11.: jen super admin)
  | "rfq"                      // poptávky dodavatelům — kolo, ceny dodavatelů v porovnání (obchodník, admin; zaměstnanec s příznakem)
  | "stage_any";               // ruční změna stavu zakázky na kterýkoli stav, dopředu i dozadu (super admin; ostatní s příznakem)
// „margins": obchodník a super admin; 9. 11. i zaměstnanec s příznakem „Vidí nákupní ceny a marže"

export const ALL_FEATURES: Feature[] = [
  "orders", "workflow", "documents", "customers", "suppliers", "mail", "mail_all", "dashboard",
  "ai_assistant", "ai_tuning", "knowledge", "drawings", "ai_pricing", "ai_capture",
  "commissions", "commissions_all", "margins", "users", "settings", "delete",
  "pricing", "quote_approval", "flow_all", "supplier_invoices_upload", "supplier_invoices", "supplier_invoices_paid", "rfq",
  "stage_any", "approval_queue", "issued_invoices",
];

export interface AccessSubject {
  role: UserRole;
  /** Super admin povolil tomuto uživateli AI (profiles.ai_access). */
  aiAccess: boolean;
  active: boolean;
  /** 31. 10.: super admin povolil „Smí schvalovat nabídky ostatních" (profiles.can_approve_quotes) → quote_approval. */
  canApproveQuotes?: boolean;
  /**
   * 31. 10.: super admin povolil „Smí poptávat dodavatele" (profiles.can_rfq) → rfq i bez marží (zaměstnanec Šponer).
   * Vidí ceny dodavatelů jen v poptávkovém kole (porovnání, výběr) — ne marže, provize ani objednávky dodavatelům.
   */
  canRfq?: boolean;
  /**
   * 9. 11.: „Smí ručně měnit stav zakázky" (profiles.can_change_stage; obchodník smí vždy) → stage_any: korekce stavu
   * na kterýkoli stav dopředu i dozadu, včetně koncových (vyfakturováno, dokončeno, nerealizováno, zrušeno) — zaměstnanec
   * Šponer. Jen stav: marže, ceny ani faktury tím neuvidí.
   */
  canChangeStage?: boolean;
  /**
   * 9. 11.: „Smí řešit frontu ke schválení" (profiles.can_resolve_queue) → approval_queue: stránka Fronta ke schválení,
   * schválit / upravit / zamítnout položku (odchozí e-maily, objednávky dodavatelům, stav zakázky z pošty…). AI návrh
   * nabídky dál jen super admin (src/lib/auth/approval-queue-access.ts). Super admin smí vždy.
   */
  canResolveQueue?: boolean;
  /**
   * 9. 11.: „Vidí nákupní ceny a marže" (profiles.can_see_margins; obchodník a super admin vždy) → margins: nákupní
   * ceny, marže, nákupní doklady, objednávky dodavatelům, faktura a úhrady — zaměstnanec Šponer. Provize ostatních ne.
   */
  canSeeMargins?: boolean;
  /**
   * 2. 11.: „Plný přístup" (profiles.full_access) — vše jako super admin kromě FULL_ACCESS_DENIED
   * („každý bude vidět jen svůj mail, jinak budou moci vše"; správu uživatelů ne).
   */
  fullAccess?: boolean;
}

export interface AccessContext {
  /** Hlavní vypínač AI (Nastavení → AI přístup). */
  aiEnabled: boolean;
  /** AI čtení dokladů povoleno všem uživatelům. */
  aiCaptureForAll: boolean;
  /** Je nastaven Claude API klíč. */
  aiConfigured: boolean;
  /**
   * Faktury dodavatelů vidí všichni (integration_settings.supplier_invoices_visibility = all);
   * výchozí (chybí / false) = jen super admin. Zaplaceno / nezaplaceno vždy jen super admin.
   */
  supplierInvoicesForAll?: boolean;
}

export const DEFAULT_ACCESS_CONTEXT: AccessContext = {
  aiEnabled: true,
  // #25: AI focení pro všechny je výchozí stav (super admin ho může vypnout)
  aiCaptureForAll: true,
  aiConfigured: false,
};

const EVERYONE: Feature[] = ["orders", "workflow", "documents", "customers", "suppliers", "mail", "supplier_invoices_upload"];
const SALES_EXTRA: Feature[] = ["commissions", "margins", "rfq"];
const ADMIN_ONLY: Feature[] = [
  "mail_all", "dashboard", "ai_assistant", "ai_tuning", "knowledge", "drawings",
  "commissions_all", "users", "settings", "delete", "pricing", "quote_approval", "flow_all", "supplier_invoices_paid",
  // 10. 11.: Faktury vydané — faktury všech zakázek (citlivé finance) jen super admin / plný přístup
  "issued_invoices",
];
/** Plný přístup (ne skutečný super admin): pošta jen vlastních schránek, bez správy uživatelů a schránek. */
export const FULL_ACCESS_DENIED: Feature[] = ["users", "mail_all"];
/** Funkce, které reálně volají AI — vyžadují hlavní vypínač i klíč (bez klíče se pracuje ručně). */
const AI_RUNTIME: Feature[] = ["ai_pricing", "ai_capture"];

export function can(subject: AccessSubject | null | undefined, feature: Feature, ctx: AccessContext): boolean {
  if (!subject || !subject.active) return false;

  if (AI_RUNTIME.includes(feature) && (!ctx.aiEnabled || !ctx.aiConfigured)) return false;
  // Asistent: vypnutý hlavním vypínačem zmizí; bez klíče stránka vysvětlí, co doplnit.
  if (feature === "ai_assistant" && !ctx.aiEnabled) return false;

  if (subject.role === "super_admin") return !(subject.fullAccess && FULL_ACCESS_DENIED.includes(feature));

  if (EVERYONE.includes(feature)) return true;
  // 31. 10.: schvalovatel nabídek ostatních (které nabídky smí schválit, řeší mayManageQuoteApproval / DB)
  if (feature === "quote_approval") return subject.canApproveQuotes === true;
  // 31. 10.: poptávky dodavatelům — zaměstnanec jen s příznakem „Smí poptávat dodavatele"
  if (feature === "rfq" && subject.role === "zamestnanec") return subject.canRfq === true;
  // 9. 11.: ruční změna stavu zakázky na kterýkoli stav — jen s příznakem „Smí ručně měnit stav zakázky"
  if (feature === "stage_any") return subject.canChangeStage === true;
  // 9. 11.: fronta ke schválení — jen s příznakem „Smí řešit frontu ke schválení"
  if (feature === "approval_queue") return subject.canResolveQueue === true;
  // 9. 11.: nákupní ceny a marže — zaměstnanec s příznakem „Vidí nákupní ceny a marže" (obchodník vždy, níže)
  if (feature === "margins" && subject.canSeeMargins === true) return true;
  if (ADMIN_ONLY.includes(feature)) return false;
  // faktury dodavatelů: jeden přepínač (Nastavení faktur) — zatím jen super admin
  if (feature === "supplier_invoices") return ctx.supplierInvoicesForAll === true;

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
  super_admin: "Vidí a nastavuje vše — obchodní tok všech, Nacenění, schvalování nabídek, AI, poštu všech schránek a uživatele.",
  obchodnik: "Kniha zakázek, zákazníci a dodavatelé — vše. Obchodní tok a pošta — jen své. Marže, nákupní ceny a vlastní provize. Nabídku odešle po schválení super adminem nebo schvalovatelem (schvalování lze uživateli vypnout).",
  zamestnanec: "Kniha zakázek, zákazníci a dodavatelé — vše, bez nákupních cen a marží. Obchodní tok a pošta — jen své. Svou nabídku po schválení super adminem nebo schvalovatelem odešle sám (schvalování lze uživateli vypnout). Poptávky dodavatelům (a jejich ceny v porovnání) jen se „Smí poptávat dodavatele“. Speciální stavy zakázky (pozastaveno, reklamace, nerealizováno, zrušeno) smí; vyfakturovat a dokončit jen se „Smí ručně měnit stav zakázky“. Nákupní ceny a marže jen s „Vidí nákupní ceny a marže“, frontu ke schválení jen se „Smí řešit frontu ke schválení“.",
};

/** Popis plného přístupu (profiles.full_access, 2. 11.) pro Můj účet. */
export const FULL_ACCESS_DESCRIPTION =
  "Plný přístup — vidíš a smíš vše jako super admin (obchodní tok všech, nacenění, marže, provize všech, schvalování, AI, nastavení), kromě pošty ostatních schránek (vidíš jen svou) a správy uživatelů.";

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
  pricing: "Nacenění",
  quote_approval: "Schvalování nabídek",
  flow_all: "Obchodní tok všech",
  supplier_invoices_upload: "Nahrát fakturu dodavatele",
  supplier_invoices: "Faktury dodavatelů",
  supplier_invoices_paid: "Zaplaceno u faktur dodavatelů",
  rfq: "Poptávky dodavatelům",
  stage_any: "Ruční změna stavu zakázky",
  approval_queue: "Fronta ke schválení",
  issued_invoices: "Faktury vydané",
};

/** Doplňující vysvětlení u odepřené funkce (AccessBanner) — co dělat místo toho. */
export const FEATURE_HINTS: Partial<Record<Feature, string>> = {
  pricing: "Nacenění zatím dělá jen super admin. Nabídku připravíš ručně v kartě zakázky → záložka Nabídky; před odesláním ji schválí super admin nebo schvalovatel nabídek (pokud ti schvalování nevypnul).",
  rfq: "Poptávky dodavatelům posílá obchodník, super admin, nebo kolega se „Smí poptávat dodavatele“ (Správa uživatelů).",
  approval_queue: "Frontu ke schválení vyřizuje super admin, nebo kolega se „Smí řešit frontu ke schválení“ (Správa uživatelů).",
  issued_invoices: "Faktury vydané (všechny naše faktury, součty a export pro účetní) zatím vidí jen super admin. Fakturu své zakázky najdeš v její kartě → Dokumenty.",
  supplier_invoices: "Faktury dodavatelů zatím zpracovává super admin. Fakturu nahraješ přes „Nahrát fakturu“ nebo vyfocením dokladu.",
};
