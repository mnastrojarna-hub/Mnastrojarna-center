"use server";

import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { checkFeature } from "@/lib/auth/session";
import { STAGES, STAGE_ORDER, isJobStage } from "@/lib/jobs/stages";
import type { JobStage } from "@/lib/supabase/database.types";

/**
 * @deprecated Kompatibilní vrstva pro starou knihu zakázek — nový kód používá
 * akce v app/actions/jobs.ts (setJobStage, createJob).
 * Přijímá klíč stavu (job_stage) i český popisek.
 */
function toStage(value: string): JobStage | null {
  if (isJobStage(value)) return value;
  return STAGE_ORDER.find((s) => STAGES[s].label === value) ?? null;
}

export async function updateOrderStatus(
  id: string,
  statusLabel: string,
): Promise<{ ok: boolean; error?: string }> {
  const status = toStage(statusLabel);
  if (!status) return { ok: false, error: "Neznámý stav." };
  if (!isSupabaseConfigured()) return { ok: false, error: "Supabase není nakonfigurováno." };
  const access = await checkFeature("orders");
  if ("error" in access) return { ok: false, error: access.error };

  try {
    const db = await createOperatorClient();
    // Časová razítka stavů doplňuje trigger trg_orders_stage v DB.
    const { error } = await db.from("orders").update({ status } as never).eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/orders");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba" };
  }
}
