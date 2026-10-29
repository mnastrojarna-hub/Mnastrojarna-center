// Sloučení zakázek (#24) — čisté typy a pomůcky (sdílí UI, server i testy).
// Logiku (co se přesouvá, co vyhrává, konflikty) počítá DB: merge_jobs_plan / merge_jobs
// (supabase/migrations/20261023161000_sloucit_zakazky.sql). Tady jen tvar dat a texty.
import type { JobStage } from "@/lib/supabase/database.types";

export type MergeConflictLevel = "block" | "force" | "warn" | "info";

export type MergeConflictCode =
  | "NOT_FOUND" | "SAME_JOB" | "FORBIDDEN" | "MERGED" | "ALREADY_MERGED" | "CLOSED" | "COMMISSION_PAID"
  | "CUSTOMER_DIFFERENT" | "CUSTOMER_NAME" | "ORDER_DIFFERENT" | "PO_SUPPLIER_CONFLICT" | "PRODUCTION_BOTH"
  | "PAYMENTS_BOTH" | "REVISIONS_KEPT" | "STAGE_ADVANCE" | "QUOTE_NOT_ACCEPTED" | "SPECIAL_STAGE" | "PO_DUPLICATE"
  | "QUOTE_WONT_ACCEPT" | "QUOTE_PDF_ONLY";

export interface MergeConflict {
  code: MergeConflictCode | string;
  level: MergeConflictLevel;
  message: string;
  purchaseOrders?: string[];
}

/** fill = doplní zdroj (cíl prázdný), keep = vyhrává cíl, append = poznámky se připojí, union = štítky,
 *  admin_only = obchodníka zakázky doplní jen super admin. */
export type MergeFieldRule = "fill" | "keep" | "append" | "union" | "admin_only";

export interface MergeField {
  field: string;
  label: string;
  kind: string;
  rule: MergeFieldRule;
  target: string | null;
  source: string | null;
  result: string | null;
}

export interface MergeJobRef {
  id: string;
  number: string;
  title: string;
  stage: JobStage;
  customerId: string | null;
  customer: string | null;
  customerOrderNumber: string | null;
  value: number | null;
  createdAt: string;
}

/** Počty po druzích (co se přesune ze zdroje do cíle). */
export interface MergeCounts {
  items: number;
  itemsMerged: number;
  files: number;
  filesArchived?: number;
  filesDuplicate: number;
  drawings: number;
  quotes: number;
  emails: number;
  purchaseOrders: number;
  supplierQuotes: number;
  operations: number;
  payments: number;
  revisions: number;
  handoffs: number;
  events: number;
  approvals: number;
  anonQueue: number;
  training: number;
  invoices: number;
  deliveryNotes: number;
  documents: number;
  captureSessions: number;
}

export interface MergePreview {
  ok: boolean;
  needsForce: boolean;
  canForce: boolean;
  target: MergeJobRef;
  source: MergeJobRef;
  stage: { from: JobStage; to: JobStage; source: JobStage };
  acceptQuote: { id: string; number: string | null } | null;
  /** Naše nabídka je u zdroje jen jako PDF (bez záznamu nabídky). */
  quotePdf?: { label: string } | null;
  counts: MergeCounts;
  fields: MergeField[];
  conflicts: MergeConflict[];
}

export interface MergeResult {
  mergeId: string;
  targetId: string;
  targetNumber: string;
  sourceId: string;
  sourceNumber: string;
  replayed?: boolean;
  stage: { from: JobStage; to: JobStage; source: JobStage };
  acceptedQuote: { id: string; number: string | null } | null;
  moved: Partial<MergeCounts>;
  warnings: MergeConflict[];
  forced: boolean;
  reason: string | null;
  byName: string | null;
}

/** Proč je zakázka mezi návrhy: stejné focení (dávka), stejný výkres, stejný zákazník (i jiný záznam
 *  se stejným IČO), nedávná, nalezená hledáním. */
export type MergeCandidateReason = "capture" | "drawing" | "customer" | "recent" | "search";

/** Pořadí důvodů (silnější první) — skupina návrhu = první důvod. */
export const MERGE_REASON_ORDER: MergeCandidateReason[] = ["capture", "drawing", "customer", "recent", "search"];

/** Kandidát v hledání „Sloučit s…". */
export interface MergeCandidate {
  id: string;
  number: string;
  title: string;
  stage: JobStage;
  customer: string | null;
  customerOrderNumber: string | null;
  drawingNumbers: string[];
  createdAt: string;
  /** Hlavní důvod (skupina v seznamu). */
  reason?: MergeCandidateReason;
  /** Všechny důvody (čipy u kandidáta). */
  reasons?: MergeCandidateReason[];
}

/** Silné důvody (focení, výkres, zákazník) — čím víc, tím pravděpodobnější duplicita. */
export function mergeCandidateScore(c: Pick<MergeCandidate, "reasons">): number {
  return (c.reasons ?? []).filter((r) => r === "capture" || r === "drawing" || r === "customer").length;
}

/** Návrhy: nejpravděpodobnější duplicita první (víc silných důvodů), pak novější. */
export function rankMergeCandidates<T extends Pick<MergeCandidate, "reasons" | "createdAt">>(list: T[]): T[] {
  return [...list].sort((a, b) => mergeCandidateScore(b) - mergeCandidateScore(a) || String(b.createdAt).localeCompare(String(a.createdAt)));
}

/** ILIKE vzor pro číslo výkresu bez ohledu na mezery / tečky / pomlčky („F00N 603.W84" i „F00N603W84").
 *  Jen písmena a číslice (bezpečné do PostgREST .or()); kratší než 4 znaky = null. */
export function drawingLikePattern(v: string | null | undefined): string | null {
  const chars = drawingKey(v).replace(/[^A-Z0-9]/g, "");
  if (chars.length < 4) return null;
  return `%${chars.split("").join("%")}%`;
}

export type MergeErrorCode = "FORBIDDEN" | "VALIDATION" | "NOT_FOUND" | "SAME_JOB" | "MERGED" | "ALREADY_MERGED" | "CLOSED"
  | "COMMISSION_PAID" | "NEEDS_FORCE";

/** Druhy v náhledu: pořadí a české tvary (1 / 2–4 / 5+). */
export const MERGE_COUNT_LABELS: { key: keyof MergeCounts; forms: [string, string, string] }[] = [
  { key: "items", forms: ["položka", "položky", "položek"] },
  { key: "itemsMerged", forms: ["položka se stejným výkresem (spojí se)", "položky se stejným výkresem (spojí se)", "položek se stejným výkresem (spojí se)"] },
  { key: "files", forms: ["dokument", "dokumenty", "dokumentů"] },
  { key: "drawings", forms: ["výkres v archivu", "výkresy v archivu", "výkresů v archivu"] },
  { key: "quotes", forms: ["nabídka", "nabídky", "nabídek"] },
  { key: "emails", forms: ["e-mail", "e-maily", "e-mailů"] },
  { key: "purchaseOrders", forms: ["objednávka dodavateli", "objednávky dodavatelům", "objednávek dodavatelům"] },
  { key: "supplierQuotes", forms: ["nabídka dodavatele", "nabídky dodavatelů", "nabídek dodavatelů"] },
  { key: "operations", forms: ["krok výroby", "kroky výroby", "kroků výroby"] },
  { key: "payments", forms: ["úhrada", "úhrady", "úhrad"] },
  { key: "revisions", forms: ["revize objednávky", "revize objednávky", "revizí objednávky"] },
  { key: "handoffs", forms: ["předání do výroby", "předání do výroby", "předání do výroby"] },
  { key: "invoices", forms: ["faktura", "faktury", "faktur"] },
  { key: "deliveryNotes", forms: ["dodací list", "dodací listy", "dodacích listů"] },
  { key: "documents", forms: ["doklad v Dokumentech", "doklady v Dokumentech", "dokladů v Dokumentech"] },
  { key: "approvals", forms: ["položka fronty schválení", "položky fronty schválení", "položek fronty schválení"] },
  { key: "anonQueue", forms: ["odeslání anonymizace", "odeslání anonymizace", "odeslání anonymizace"] },
  { key: "training", forms: ["příklad pro AI", "příklady pro AI", "příkladů pro AI"] },
  { key: "captureSessions", forms: ["rozpracované focení", "rozpracovaná focení", "rozpracovaných focení"] },
  { key: "events", forms: ["záznam historie", "záznamy historie", "záznamů historie"] },
];

export function czPlural(n: number, forms: [string, string, string]): string {
  const f = n === 1 ? forms[0] : n >= 2 && n <= 4 ? forms[1] : forms[2];
  return `${n} ${f}`;
}

/** Řádky „co se přesune" (jen nenulové). */
export function mergeCountLines(counts: Partial<MergeCounts> | null | undefined): { key: keyof MergeCounts; text: string; n: number }[] {
  if (!counts) return [];
  const out: { key: keyof MergeCounts; text: string; n: number }[] = [];
  for (const { key, forms } of MERGE_COUNT_LABELS) {
    const n = Number(counts[key] ?? 0);
    if (n > 0) out.push({ key, n, text: czPlural(n, forms) });
  }
  return out;
}

/** Krátké shrnutí („1 nabídka, 2 dokumenty a 3 další") pro toast a banner. */
export function mergeSummary(counts: Partial<MergeCounts> | null | undefined, max = 3): string {
  // položka se stejným výkresem se nepřesunula, ale spojila s položkou cíle → „1 položka spojena"
  const lines = mergeCountLines(counts).filter((l) => l.key !== "events")
    .map((l) => l.key === "itemsMerged" ? { ...l, text: czPlural(l.n, ["položka spojena", "položky spojeny", "položek spojeno"]) } : l);
  if (!lines.length) return "nic dalšího k přesunu";
  const head = lines.slice(0, max).map((l) => l.text);
  const rest = lines.length - head.length;
  return rest > 0 ? `${head.join(", ")} a ${czPlural(rest, ["další", "další", "dalších"])}` : head.join(", ");
}

/** Upozornění k výsledku sloučení, která má uživatel vidět i po něm (ne informace „prohoď směr"). */
export function mergeOutcomeWarnings(warnings: MergeConflict[] | null | undefined): MergeConflict[] {
  return (warnings ?? []).filter((w) => w.level === "warn");
}

export const MERGE_RULE_LABELS: Record<MergeFieldRule, string> = {
  fill: "doplní se",
  keep: "zůstane",
  append: "připojí se",
  union: "sjednotí se",
  admin_only: "doplní jen super admin",
};

export function mergeBlockers(p: Pick<MergePreview, "conflicts">): MergeConflict[] {
  return p.conflicts.filter((c) => c.level === "block");
}
export function mergeForceConflicts(p: Pick<MergePreview, "conflicts">): MergeConflict[] {
  return p.conflicts.filter((c) => c.level === "force");
}
export function mergeNotices(p: Pick<MergePreview, "conflicts">): MergeConflict[] {
  return p.conflicts.filter((c) => c.level === "warn" || c.level === "info");
}

/** Lze potvrdit? (bez blokace; konflikty „force" jen super admin s důvodem). */
export function canConfirmMerge(p: MergePreview, force: { enabled: boolean; reason: string }): boolean {
  if (!p.ok) return false;
  if (!p.needsForce) return true;
  return p.canForce && force.enabled && force.reason.trim().length >= 3;
}

/** Normalizace dotazu hledání (číslo zakázky / zákazník / výkres) — bez znaků, které rozbijí PostgREST .or(). */
export function cleanMergeQuery(q: unknown): string {
  if (typeof q !== "string") return "";
  return q.replace(/[,()*%\\"'`]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

/** Číslo výkresu pro porovnání (= SQL drawing_norm). */
export function drawingKey(v: string | null | undefined): string {
  return (v ?? "").replace(/[\s.\-/]/g, "").toUpperCase();
}
