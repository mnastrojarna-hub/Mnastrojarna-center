import "server-only";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAccess } from "@/lib/auth/session";
import {
  auditEntryFromRow, pragueDayEnd, pragueDayStart, type AuditEntry, type AuditRow,
} from "@/app/(app)/settings/audit/audit-model";

/**
 * Audit log (Nastavení → Audit, jen super admin): kdo, kdy, jakým způsobem a co. Čte servisním
 * klíčem → sama ověří, že je přihlášený aktivní super admin. Smazané řádky zapisuje DB trigger
 * s celým obsahem řádku; jméno autora přežije smazání účtu (actor_name / diff.byName).
 */

export const AUDIT_PAGE_SIZE = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AuditFilter {
  actorId?: string | null;
  /** „system" = bez účtu (plánovač, přímý zápis), „ai" = AI. */
  actorKind?: "system" | "ai" | null;
  entity?: string | null;
  from?: string | null;
  to?: string | null;
  page?: number;
}

export interface AuditList {
  entries: AuditEntry[];
  hasMore: boolean;
  page: number;
  actors: { id: string; name: string }[];
  entities: string[];
  error?: string;
}

const EMPTY: AuditList = { entries: [], hasMore: false, page: 0, actors: [], entities: [] };

async function adminSession() {
  if (!isSupabaseConfigured()) return null;
  try {
    const access = await getAccess();
    if (!access.user?.active || access.user.role !== "super_admin" || !access.can("settings")) return null;
    return { db: await createOperatorClient() };
  } catch {
    return null;
  }
}

export async function listAudit(filter: AuditFilter = {}): Promise<AuditList> {
  const s = await adminSession();
  if (!s) return EMPTY;
  const page = Math.max(0, Math.min(200, Math.floor(filter.page ?? 0)));
  try {
    let q = s.db.from("audit_log")
      .select("id, created_at, action, entity, entity_id, diff, actor_id, actor_kind, actor_name, via, actor:profiles!actor_id(id, full_name, email)")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(page * AUDIT_PAGE_SIZE, page * AUDIT_PAGE_SIZE + AUDIT_PAGE_SIZE);
    if (filter.actorId && UUID_RE.test(filter.actorId)) q = q.eq("actor_id", filter.actorId);
    else if (filter.actorKind === "ai") q = q.eq("actor_kind", "ai");
    else if (filter.actorKind === "system") q = q.is("actor_id", null).neq("actor_kind", "ai");
    if (filter.entity && /^[a-z_]{1,60}$/.test(filter.entity)) q = q.eq("entity", filter.entity);
    const from = filter.from ? pragueDayStart(filter.from) : null;
    const to = filter.to ? pragueDayEnd(filter.to) : null;
    if (from) q = q.gte("created_at", from);
    if (to) q = q.lt("created_at", to);

    const [rows, people, ents] = await Promise.all([
      q,
      s.db.from("profiles").select("id, full_name, email").order("full_name"),
      s.db.from("audit_log").select("entity").order("created_at", { ascending: false }).limit(5000),
    ]);
    if (rows.error) return { ...EMPTY, page, error: rows.error.message };
    const data = (rows.data ?? []) as unknown as AuditRow[];
    const entities = [...new Set(((ents.data ?? []) as { entity: string }[]).map((r) => r.entity))].sort();
    if (filter.entity && !entities.includes(filter.entity)) entities.push(filter.entity);
    return {
      entries: data.slice(0, AUDIT_PAGE_SIZE).map(auditEntryFromRow),
      hasMore: data.length > AUDIT_PAGE_SIZE,
      page,
      actors: ((people.data ?? []) as { id: string; full_name: string | null; email: string | null }[])
        .map((p) => ({ id: p.id, name: (p.full_name ?? "").trim() || (p.email ?? "").trim() || "Bez jména" })),
      entities,
    };
  } catch (err) {
    return { ...EMPTY, page, error: err instanceof Error ? err.message : "Audit se nepodařilo načíst." };
  }
}
