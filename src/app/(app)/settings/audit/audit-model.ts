// Audit (Nastavení → Audit): čisté popisky a mapování řádků audit_log (testy audit-model.test.ts).
import type { ChangeStamp } from "@/lib/jobs/flow-status";
import type { ActorKind, ChangeVia } from "@/lib/supabase/database.types";

export interface AuditRow {
  id: number | string;
  created_at: string;
  action: string;
  entity: string;
  entity_id: string | null;
  diff: Record<string, unknown> | null;
  actor_id: string | null;
  actor_kind: string | null;
  actor_name: string | null;
  via: string | null;
  actor?: { id: string; full_name: string | null; email: string | null } | { id: string; full_name: string | null; email: string | null }[] | null;
}

export interface AuditEntry {
  id: string;
  at: string;
  action: string;
  actionLabel: string;
  entity: string;
  entityLabel: string;
  entityId: string | null;
  /** Krátký popis („Zakázka Z-2026-871 — Upínací desky"). */
  summary: string | null;
  /** Odkaz na detail (zakázka, zákazník, dodavatel), je-li. */
  href: string | null;
  stamp: ChangeStamp;
  diff: Record<string, unknown> | null;
  destructive: boolean;
}

export const ENTITY_LABELS: Record<string, string> = {
  orders: "Zakázky",
  quotes: "Nabídky",
  job_files: "Dokumenty zakázek",
  job_operations: "Výrobní operace",
  job_payments: "Úhrady",
  purchase_orders: "Objednávky dodavatelům",
  supplier_quotes: "Nabídky dodavatelů",
  customers: "Zákazníci",
  customer_contacts: "Kontakty zákazníků",
  suppliers: "Dodavatelé",
  commission_rules: "Provizní smlouvy",
  commission_statements: "Výplaty provizí",
  mailboxes: "E-mailové schránky",
  emails: "Pošta",
  profiles: "Uživatelé",
  approval_queue: "Fronta ke schválení",
  automation_global: "Režim automatiky",
  automation_settings: "Režim automatiky (moduly)",
  ai_agent_rules: "Pravidla AI",
  ai_corrections: "Korekce AI",
  integration_settings: "Nastavení",
  drawings: "Archiv výkresů",
  documents: "Doklady",
};

const ACTION_LABELS: Record<string, string> = {
  job_created: "Založena zakázka",
  job_created_from_email: "Zakázka z e-mailu",
  job_deleted: "Smazána zakázka",
  job_owner_assigned: "Přidělen obchodník",
  job_file_deleted: "Smazán dokument",
  job_operation_deleted: "Smazána operace",
  document_issued: "Vystaven doklad",
  document_sent: "Odeslán doklad",
  quote_deleted: "Smazána nabídka",
  supplier_quote_deleted: "Smazána nabídka dodavatele",
  purchase_order_issued: "Vystavena objednávka dodavateli",
  purchase_order_sent: "Odeslána objednávka dodavateli",
  purchase_order_updated: "Upravena objednávka dodavateli",
  customer_created: "Založen zákazník",
  customer_updated: "Upraven zákazník",
  supplier_created: "Založen dodavatel",
  supplier_updated: "Upraven dodavatel",
  mailbox_added: "Přidána schránka",
  mailbox_updated: "Upravena schránka",
  mailbox_deleted: "Smazána schránka",
  mailbox_owner_set: "Vlastník schránky",
  email_sent: "Odeslán e-mail",
  email_category_set: "Kategorie e-mailu",
  emails_imported: "Import e-mailů",
  approval_approved: "Schváleno ve frontě",
  approval_rejected: "Zamítnuto ve frontě",
  approval_edited: "Upraven návrh ve frontě",
  automation_mode_changed: "Změněn režim automatiky",
  agent_rules_updated: "Upravena pravidla AI",
  ai_correction_deleted: "Smazána korekce AI",
  ai_access_updated: "Přístup k AI",
  settings_updated: "Změněno nastavení",
  drawing_uploaded: "Nahrán výkres",
  commission_rule_deleted: "Smazána provizní smlouva",
  commission_statement_paid: "Provize vyplacena",
  commission_statement_unpaid: "Výplata provize zrušena",
  user_created: "Založen uživatel",
  user_updated: "Upraven uživatel",
  user_deleted: "Smazán uživatel",
  user_password_set: "Nastaveno heslo",
  user_reset_code_sent: "Odeslán kód pro obnovu hesla",
  profile_updated: "Upraven profil",
  profile_changed: "Změna role / aktivity / sazby / schvalování nabídek",
  password_changed: "Změna hesla",
  password_reset: "Obnova hesla",
  password_reset_requested: "Žádost o obnovu hesla",
};

const VIAS = ["rucne", "ai", "foto", "email", "automaticky", "import", "cron", "rest", "db"];

export function entityLabel(entity: string): string {
  return ENTITY_LABELS[entity] ?? entity.replace(/_/g, " ");
}

/** Česky čitelná akce; „<tabulka>_deleted" z DB triggeru = „Smazáno: <entita>". */
export function actionLabel(action: string, entity?: string): string {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  const del = /^([a-z_]+)_deleted$/.exec(action);
  if (del) return `Smazáno: ${entityLabel(entity ?? del[1]).toLowerCase()}`;
  const s = action.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Krátký popis záznamu z diff (číslo / název smazaného řádku, změna z → na…). */
export function auditSummary(action: string, diff: Record<string, unknown> | null): string | null {
  if (!diff) return null;
  const row = (diff.row && typeof diff.row === "object" ? diff.row : null) as Record<string, unknown> | null;
  if (row) {
    const parts = [str(row.number), str(row.name) ?? str(row.title) ?? str(row.filename) ?? str(row.full_name) ?? str(row.email)].filter(Boolean);
    return parts.length ? parts.join(" — ") : null;
  }
  if ("from" in diff || "to" in diff) {
    const what = str(diff.module) ?? str(diff.key) ?? null;
    return `${what ? `${what}: ` : ""}${fmt(diff.from)} → ${fmt(diff.to)}`;
  }
  const name = str(diff.name) ?? str(diff.title) ?? str(diff.number) ?? str(diff.email) ?? str(diff.agent);
  if (name) return name;
  if (Array.isArray(diff.keys)) return (diff.keys as unknown[]).map(String).slice(0, 6).join(", ");
  return null;
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (v === "full") return "plná automatika";
  if (v === "approval") return "se schválením";
  return typeof v === "string" ? v : JSON.stringify(v);
}

/** Odkaz na detail objektu záznamu (jen kde existuje stránka: zakázka, zákazník). */
export function auditHref(entity: string, entityId: string | null, diff: Record<string, unknown> | null, deleted: boolean): string | null {
  const uuid = /^[0-9a-f-]{36}$/i;
  const jobId = str(diff?.jobId) ?? str(diff?.job_id);
  if (!deleted && entity === "orders" && entityId && uuid.test(entityId)) return `/orders/${entityId}`;
  if (jobId && uuid.test(jobId) && entity !== "orders") return `/orders/${jobId}`;
  if (!deleted && entity === "customers" && entityId && uuid.test(entityId)) return `/customers/${entityId}`;
  return null;
}

/** Řádek audit_log → položka seznamu s autorem (nikdy prázdné jméno — actorName). */
export function auditEntryFromRow(r: AuditRow): AuditEntry {
  const p = Array.isArray(r.actor) ? r.actor[0] ?? null : r.actor ?? null;
  const name = p ? (p.full_name ?? "").trim() || (p.email ?? "").trim() || null : null;
  const kind: ActorKind = r.actor_kind === "ai" || r.actor_kind === "user" || r.actor_kind === "system"
    ? r.actor_kind : r.actor_id ? "user" : "system";
  const via = r.via && VIAS.includes(r.via) ? (r.via as ChangeVia) : null;
  const diff = r.diff && typeof r.diff === "object" && !Array.isArray(r.diff) ? r.diff : null;
  const storedName = r.actor_name ?? str(diff?.byName);
  const deleted = /_deleted$/.test(r.action);
  return {
    id: String(r.id),
    at: r.created_at,
    action: r.action,
    actionLabel: actionLabel(r.action, r.entity),
    entity: r.entity,
    entityLabel: entityLabel(r.entity),
    entityId: r.entity_id,
    summary: auditSummary(r.action, diff),
    href: auditHref(r.entity, r.entity_id, diff, deleted),
    stamp: { by: p && name ? { id: p.id, name } : null, byName: storedName, at: r.created_at, via, kind },
    diff,
    destructive: deleted || /deleted$|_rejected$/.test(r.action),
  };
}

/** Začátek pražského dne (YYYY-MM-DD) jako ISO instant — filtr období. */
export function pragueDayStart(day: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const [y, m, d] = day.split("-").map(Number);
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit" });
  for (const offset of [2, 1]) {
    const t = Date.UTC(y, m - 1, d) - offset * 3_600_000;
    if (fmt.format(new Date(t)) === day && fmt.format(new Date(t - 1)) !== day) return new Date(t).toISOString();
  }
  return new Date(Date.UTC(y, m - 1, d)).toISOString();
}

/** Konec pražského dne = začátek následujícího. */
export function pragueDayEnd(day: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const [y, m, d] = day.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return pragueDayStart(next);
}

/** Rychlé období: dnes / 7 dní / 30 dní → od (YYYY-MM-DD, Praha). */
export function periodFrom(period: string, today: string): string | null {
  const days = period === "dnes" ? 0 : period === "7d" ? 6 : period === "30d" ? 29 : null;
  if (days === null) return null;
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

/** Řádky diffu k zobrazení (bez interních / dlouhých klíčů), hodnoty zkrácené. */
export function diffLines(diff: Record<string, unknown> | null, max = 30): { key: string; value: string }[] {
  if (!diff) return [];
  const src = diff.row && typeof diff.row === "object" ? (diff.row as Record<string, unknown>) : diff;
  const out: { key: string; value: string }[] = [];
  for (const [key, v] of Object.entries(src)) {
    if (key === "byName" || v === null || v === undefined || v === "") continue;
    const value = typeof v === "string" ? v : JSON.stringify(v);
    out.push({ key, value: value.length > 160 ? `${value.slice(0, 157)}…` : value });
    if (out.length >= max) break;
  }
  return out;
}
