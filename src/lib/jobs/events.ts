import "server-only";
import type { createOperatorClient } from "@/lib/supabase/server";
import type { JobEventType } from "@/lib/jobs/types";
import type { ActorKind, ChangeVia } from "@/lib/supabase/actor-headers";

/** Klient DB pro datovou vrstvu zakázek (servisní klíč nebo session). */
export type JobsDb = Awaited<ReturnType<typeof createOperatorClient>>;

/** Čeho se událost týká (filtr historie podle fáze). */
export type JobEventEntity =
  | "job" | "inquiry" | "order" | "quote" | "purchase_order" | "operation" | "payment"
  | "file" | "delivery" | "supplier_quote" | "proposal";

/**
 * Zápis do historie zakázky (job_events). Best-effort: selhání historie nikdy neshodí samotnou
 * akci. Stavové události (status, inquiry_status, order_status, revize…) zapisuje DB sama —
 * nový kód nemá psát `type: "stage"` (starší zápisy DB sloučí se svou událostí). Druh autora,
 * způsob a agenta doplní DB z hlaviček klienta, pokud je akce nepředá.
 */
export async function logJobEvent(
  db: JobsDb,
  input: {
    jobId: string;
    type: JobEventType | "status";
    message: string;
    data?: Record<string, unknown>;
    actorId: string | null;
    /** "ai" u automatik jednajících za uživatele. */
    actorKind?: ActorKind;
    via?: ChangeVia;
    agent?: string;
    entity?: JobEventEntity;
    entityId?: string;
  },
): Promise<void> {
  try {
    if (!db || !input.jobId) return;
    const message = (input.message ?? "").trim().slice(0, 2000) || "—";
    const row: Record<string, unknown> = {
      job_id: input.jobId,
      type: input.type,
      message,
      data: input.data ?? {},
      actor_id: input.actorId ?? null,
    };
    if (input.actorKind) row.actor_kind = input.actorKind;
    if (input.via) row.via = input.via;
    if (input.agent) row.agent = input.agent;
    if (input.entity) row.entity = input.entity;
    if (input.entityId) row.entity_id = input.entityId;
    const { error } = await db.from("job_events").insert(row as never);
    if (error) console.error(`[jobs:event] Zápis historie selhal: ${error.message}`);
  } catch (err) {
    console.error(`[jobs:event] Zápis historie selhal: ${err instanceof Error ? err.message : String(err)}`);
  }
}
