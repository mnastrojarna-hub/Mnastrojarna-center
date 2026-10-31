import "server-only";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAccess } from "@/lib/auth/session";
import { loadJobRfq, loadWeights, type JobRfqData } from "@/lib/rfq/store";
import type { RfqWeights } from "@/lib/rfq/model";

/**
 * Poptávky dodavatelům na kartě zakázky — jen s právem „rfq" (obchodník, super admin, zaměstnanec se „Smí poptávat
 * dodavatele"). Čte servisním klíčem → právo se ověří tady. Bez práva / bez migrace = null (sekce se nezobrazí).
 */
export async function getJobRfq(jobId: string): Promise<JobRfqData | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const access = await getAccess();
    if (!access.user || !access.user.active || !access.can("rfq")) return null;
    const db = await createOperatorClient();
    return await loadJobRfq(db, jobId);
  } catch (err) {
    console.error(`[data:rfq] ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Váhy doporučení (Nastavení, super admin). */
export async function getRfqWeights(): Promise<RfqWeights> {
  return loadWeights();
}
