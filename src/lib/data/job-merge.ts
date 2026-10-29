import "server-only";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAccess } from "@/lib/auth/session";
import { isUuid } from "@/lib/jobs/mapping";
import { resolveMergeTarget } from "@/lib/jobs/job-merge-store";
import { mergeOutcomeWarnings, mergeSummary, type MergeConflict, type MergeCounts } from "@/lib/jobs/job-merge-types";

/** Sloučení zakázek (#24) — data pro přesměrování ze zdroje a banner na cílové zakázce. */

async function db() {
  if (!isSupabaseConfigured()) return null;
  try {
    const access = await getAccess();
    if (!access.user || !access.user.active || !access.can("orders")) return null;
    return await createOperatorClient();
  } catch {
    return null;
  }
}

/** Zakázka je sloučená do jiné → kam přesměrovat (konečný cíl řetězu). */
export async function getMergeRedirect(jobId: string): Promise<{ id: string; number: string } | null> {
  if (!isUuid(jobId)) return null;
  const c = await db();
  if (!c) return null;
  try {
    return await resolveMergeTarget(c, jobId);
  } catch {
    return null;
  }
}

/** Sloučená zakázka otevřená jen pro historii (?historie=1): kam a kdy se sloučila. */
export interface MergedSourceInfo {
  targetId: string;
  targetNumber: string;
  at: string | null;
  byName: string | null;
}

export async function getMergedSourceInfo(jobId: string, target: { id: string; number: string }): Promise<MergedSourceInfo> {
  const base: MergedSourceInfo = { targetId: target.id, targetNumber: target.number, at: null, byName: null };
  const c = await db();
  if (!c || !isUuid(jobId)) return base;
  try {
    const { data } = await c.from("orders").select("merged_at, by:profiles!merged_by(full_name, email)").eq("id", jobId).maybeSingle();
    const row = data as { merged_at: string | null; by: { full_name: string | null; email: string | null } | { full_name: string | null; email: string | null }[] | null } | null;
    const by = Array.isArray(row?.by) ? row?.by[0] : row?.by;
    return { ...base, at: row?.merged_at ?? null, byName: by ? (by.full_name?.trim() || by.email) : null };
  } catch {
    return base;
  }
}

export interface MergeBanner {
  sourceNumber: string;
  sourceId: string | null;
  byName: string | null;
  at: string;
  summary: string;
  redirected: boolean;
  /** Upozornění k výsledku (nabídka nepřijatá, revize zůstaly u zdroje, nabídka jen jako PDF…). */
  warnings: MergeConflict[];
}

function warningsOf(v: unknown): MergeConflict[] {
  if (!Array.isArray(v)) return [];
  return mergeOutcomeWarnings(v.filter((w): w is Record<string, unknown> => !!w && typeof w === "object").map((w) => ({
    code: String(w.code ?? ""), level: (["block", "force", "warn", "info"].includes(String(w.level)) ? w.level : "info") as MergeConflict["level"],
    message: String(w.message ?? ""),
  })));
}

/**
 * Banner „Zakázka Z-… byla sloučena do této zakázky" — jen pro zdroj, který opravdu byl sloučen
 * do tohoto cíle (číslo z adresy samo nic nezobrazí).
 */
export async function getMergeBanner(targetId: string, sourceNumber: string | null | undefined, redirected: boolean): Promise<MergeBanner | null> {
  const num = (sourceNumber ?? "").trim().slice(0, 40);
  if (!isUuid(targetId) || !num) return null;
  const c = await db();
  if (!c) return null;
  try {
    const { data } = await c.from("job_merges").select("source_id, source_number, created_at, result, by:profiles!created_by(full_name, email)")
      .eq("source_number", num).order("created_at", { ascending: false }).limit(5);
    const rows = (data ?? []) as { source_id: string | null; source_number: string; created_at: string; result: Record<string, unknown> | null;
      by: { full_name: string | null; email: string | null } | { full_name: string | null; email: string | null }[] | null }[];
    // cíl může být i dál v řetězu (A→B, B→C: banner A na C)
    for (const r of rows) {
      const direct = r.result?.targetId === targetId;
      const chained = !direct && r.source_id ? (await resolveMergeTarget(c, r.source_id))?.id === targetId : false;
      if (!direct && !chained) continue;
      const by = Array.isArray(r.by) ? r.by[0] : r.by;
      return {
        sourceNumber: r.source_number, sourceId: r.source_id, byName: by ? (by.full_name?.trim() || by.email) : null, at: r.created_at,
        summary: mergeSummary((r.result?.moved ?? null) as Partial<MergeCounts> | null), redirected,
        warnings: warningsOf(r.result?.warnings),
      };
    }
    return null;
  } catch {
    return null;
  }
}
