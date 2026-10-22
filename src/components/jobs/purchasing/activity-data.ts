import "server-only";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { isUuid, personRef, type PersonEmbed } from "@/lib/jobs/mapping";
import type { ActivityEvent } from "./purchasing-model";

/**
 * Události historie zakázek k objednávkám dodavatelům — kdo objednávku vystavil,
 * odeslal, potvrdil, zrušil. Čte servisním klíčem: volat jen ze stránky, která
 * už prošla requireFeature("margins").
 */
export async function fetchPurchaseOrderEvents(poIds: string[]): Promise<ActivityEvent[]> {
  const ids = [...new Set(poIds.filter((id) => isUuid(id)))];
  if (!ids.length || !isSupabaseConfigured()) return [];
  try {
    const db = await createOperatorClient();
    const out: ActivityEvent[] = [];
    for (let i = 0; i < ids.length; i += 150) {
      const { data, error } = await db
        .from("job_events")
        .select("type, data, created_at, actor:profiles!actor_id(id, full_name, email)")
        .in("data->>purchaseOrderId", ids.slice(i, i + 150))
        .order("created_at", { ascending: true })
        .limit(5000);
      if (error) {
        console.error(`[purchasing:activity] Supabase chyba: ${error.message}`);
        break;
      }
      type Row = { type: string; data: Record<string, unknown> | null; created_at: string; actor?: PersonEmbed | PersonEmbed[] | null };
      for (const r of (data ?? []) as unknown as Row[]) {
        const actor = personRef(r.actor);
        out.push({ type: r.type, data: r.data ?? {}, actor: actor ? { name: actor.name } : null, createdAt: r.created_at });
      }
    }
    return out;
  } catch (err) {
    console.error(`[purchasing:activity] ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}
