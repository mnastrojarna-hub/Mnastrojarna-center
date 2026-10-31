"use server";

import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { userActor } from "@/lib/supabase/actor-headers";
import { checkFeature } from "@/lib/auth/session";
import { logAudit } from "@/lib/audit";
import { isUuid, translateDbError } from "@/lib/jobs/mapping";
import type { JobsDb } from "@/lib/jobs/events";
import { mergeDuplicateItemsCore } from "@/lib/jobs/item-duplicates-store";

/**
 * Položky → „Vypadá to na duplicitní položky (2) — Sloučit" (majitel 30. 10., Z-2026-022). Jedno ťuknutí,
 * nikdy samo: server dvojice znovu ověří, ponechá položku s výkresem / revizí / materiálem / vazbami,
 * přesune odkazy a duplicitu smaže (historie zakázky s autorem).
 */
export async function mergeDuplicateItems(
  jobId: string,
  pairs: { keepId: string; dropId: string }[],
): Promise<{ ok: true; merged: number } | { ok: false; error: string }> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase není nakonfigurováno." };
  const access = await checkFeature("orders");
  if ("error" in access) return { ok: false, error: access.error };
  if (!isUuid(jobId)) return { ok: false, error: "Zakázka nenalezena." };
  const clean = (Array.isArray(pairs) ? pairs : []).slice(0, 100)
    .filter((p) => p && isUuid(p.keepId) && isUuid(p.dropId) && p.keepId !== p.dropId)
    .map((p) => ({ keepId: p.keepId.toLowerCase(), dropId: p.dropId.toLowerCase() }));
  if (!clean.length) return { ok: false, error: "Není co sloučit." };
  try {
    const db = (await createOperatorClient({ actor: userActor(access.user) })) as unknown as JobsDb;
    const res = await mergeDuplicateItemsCore(db, jobId, clean, access.user.id);
    if (!res.ok) return { ok: false, error: translateDbError(res.error) };
    await logAudit({ action: "job_items_merged", entity: "orders", entityId: jobId, diff: { merged: res.merged, value: res.value } });
    revalidatePath(`/orders/${jobId}`);
    revalidatePath("/orders");
    return { ok: true, merged: res.merged.length };
  } catch (err) {
    return { ok: false, error: translateDbError(err instanceof Error ? err.message : String(err)) };
  }
}
