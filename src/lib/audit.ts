import "server-only";
import { createAdminClient, hasServiceKey, isSupabaseConfigured } from "@/lib/supabase/server";
import { resolveRequestActor } from "@/lib/supabase/actor";
import type { ActorContext } from "@/lib/supabase/actor-headers";

/**
 * Audit log — historie změn a akcí (bezpečnostní požadavek).
 * Autor: explicitní `actor` (např. password_changed → userActor(user)), jinak přihlášený
 * uživatel požadavku. Jméno se uloží i jako text (diff.byName), aby přežilo smazání účtu.
 * Best-effort: selhání logu nikdy neshodí samotnou akci.
 */
export async function logAudit(input: {
  action: string; // např. 'email_sent', 'approval_rejected', 'settings_updated'
  entity: string; // modul / tabulka, např. 'approval_queue', 'mailboxes'
  entityId?: string;
  diff?: Record<string, unknown>;
  /** Explicitní autor; bez něj přihlášený uživatel (null = vědomě „Systém"). */
  actor?: ActorContext | null;
}): Promise<void> {
  if (!isSupabaseConfigured() || !hasServiceKey()) return;
  try {
    const actor = input.actor !== undefined ? input.actor : await resolveRequestActor();
    const db = createAdminClient({ actor });
    let byName: string | null = null;
    if (actor?.id) {
      const { data: p } = await db.from("profiles").select("full_name, email").eq("id", actor.id).maybeSingle();
      const prof = p as { full_name: string | null; email: string | null } | null;
      byName = (prof?.full_name ?? "").trim() || (prof?.email ?? "").trim() || null;
    }
    const diff = input.diff ?? null;
    await db.from("audit_log").insert({
      actor_id: actor?.id ?? null,
      action: input.action,
      entity: input.entity,
      entity_id: input.entityId ?? null,
      diff: byName && !(diff && "byName" in diff) ? { ...(diff ?? {}), byName } : diff,
    });
  } catch {
    // log nesmí rozbít akci
  }
}
