"use server";

import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";

/**
 * Vyřízení položky fronty ke schválení. Best-effort: u demo dat (bez Supabase)
 * jen vrátí ok, UI položku odstraní lokálně.
 */
export async function resolveApproval(
  id: string,
  action: "approved" | "rejected" | "edited",
): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured()) return { ok: true };
  try {
    const supabase = await createOperatorClient();
    const { error } = await supabase
      .from("approval_queue")
      .update({ status: action, resolved_at: new Date().toISOString() } as never)
      .eq("id", id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Chyba" };
  }
}
