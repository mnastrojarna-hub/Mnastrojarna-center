import "server-only";
import { createAdminClient, createClient, hasServiceKey, isSupabaseConfigured } from "@/lib/supabase/server";

/**
 * Audit log — historie změn a akcí (bezpečnostní požadavek).
 * Best-effort: selhání logu nikdy neshodí samotnou akci.
 */
export async function logAudit(input: {
  action: string; // např. 'email_sent', 'approval_rejected', 'settings_updated'
  entity: string; // modul / tabulka, např. 'approval_queue', 'mailboxes'
  entityId?: string;
  diff?: Record<string, unknown>;
}): Promise<void> {
  if (!isSupabaseConfigured() || !hasServiceKey()) return;
  try {
    let actorId: string | null = null;
    try {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      actorId = user?.id ?? null;
    } catch {
      // bez session (automatika) — actor zůstane null
    }
    const db = createAdminClient();
    await db.from("audit_log").insert({
      actor_id: actorId,
      action: input.action,
      entity: input.entity,
      entity_id: input.entityId ?? null,
      diff: input.diff ?? null,
    });
  } catch {
    // log nesmí rozbít akci
  }
}
