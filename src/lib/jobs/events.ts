import "server-only";
import type { createOperatorClient } from "@/lib/supabase/server";
import type { JobEventType } from "@/lib/jobs/types";

/** Klient DB pro datovou vrstvu zakázek (servisní klíč nebo session). */
export type JobsDb = Awaited<ReturnType<typeof createOperatorClient>>;

/**
 * Zápis do historie zakázky (job_events). Best-effort: selhání historie
 * nikdy neshodí samotnou akci.
 */
export async function logJobEvent(
  db: JobsDb,
  input: {
    jobId: string;
    type: JobEventType;
    message: string;
    data?: Record<string, unknown>;
    actorId?: string | null;
  },
): Promise<void> {
  try {
    if (!db || !input.jobId) return;
    const message = (input.message ?? "").trim().slice(0, 2000) || "—";
    const { error } = await db.from("job_events").insert({
      job_id: input.jobId,
      type: input.type,
      message,
      data: input.data ?? {},
      actor_id: input.actorId ?? null,
    } as never);
    if (error) console.error(`[jobs:event] Zápis historie selhal: ${error.message}`);
  } catch (err) {
    console.error(`[jobs:event] Zápis historie selhal: ${err instanceof Error ? err.message : String(err)}`);
  }
}
