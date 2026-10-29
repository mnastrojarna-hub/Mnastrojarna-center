"use server";

import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { userActor } from "@/lib/supabase/actor-headers";
import { checkFeature } from "@/lib/auth/session";
import { isUuid } from "@/lib/jobs/mapping";
import {
  mergeJobsCore, previewJobMergeCore, searchMergeCandidatesCore,
} from "@/lib/jobs/job-merge-store";
import type { MergeCandidate, MergeErrorCode, MergePreview, MergeResult } from "@/lib/jobs/job-merge-types";

/**
 * „Sloučit s jinou zakázkou…" (#24) — hledání, náhled, sloučení. Kdo smí: super admin vždy,
 * obchodník jen své zakázky (ověří DB podle autora v hlavičkách), zaměstnanec ne.
 */

const ROLES = new Set(["super_admin", "obchodnik"]);
const FLOW_PATHS = ["/orders", "/inquiries", "/pricing", "/quotes", "/confirmations", "/documents", "/purchasing", "/commissions", "/"];

async function begin() {
  if (!isSupabaseConfigured()) return { error: "Supabase není nakonfigurováno." } as const;
  const access = await checkFeature("orders");
  if ("error" in access) return { error: access.error } as const;
  if (!ROLES.has(access.user.role)) return { error: "Zakázky slučuje obchodník nebo super admin." } as const;
  const db = await createOperatorClient({ actor: userActor(access.user) });
  return { db, user: access.user } as const;
}

export async function searchMergeCandidates(jobId: string, query?: string): Promise<{ ok: true; candidates: MergeCandidate[] } | { ok: false; error: string }> {
  const c = await begin();
  if ("error" in c) return { ok: false, error: c.error ?? "K této akci nemáš oprávnění." };
  if (!isUuid(jobId)) return { ok: false, error: "Zakázka nenalezena." };
  try {
    return { ok: true, candidates: await searchMergeCandidatesCore(c.db, jobId, query ?? "") };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Hledání se nepovedlo." };
  }
}

export async function previewJobMerge(targetId: string, sourceId: string): Promise<{ ok: true; preview: MergePreview } | { ok: false; error: string }> {
  const c = await begin();
  if ("error" in c) return { ok: false, error: c.error ?? "K této akci nemáš oprávnění." };
  try {
    return await previewJobMergeCore(c.db, targetId, sourceId);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Náhled se nepovedl." };
  }
}

export async function mergeJobs(input: { targetId: string; sourceId: string; token: string; force?: boolean; reason?: string | null }):
  Promise<{ ok: true; result: MergeResult } | { ok: false; error: string; code?: MergeErrorCode }> {
  const c = await begin();
  if ("error" in c) return { ok: false, error: c.error ?? "K této akci nemáš oprávnění.", code: "FORBIDDEN" };
  if (!input || typeof input !== "object") return { ok: false, error: "Chybí údaje.", code: "VALIDATION" };
  try {
    const res = await mergeJobsCore(c.db, {
      targetId: input.targetId, sourceId: input.sourceId, token: input.token,
      // přebití konfliktů jen super admin (DB to ověří znovu)
      force: c.user.role === "super_admin" && input.force === true, reason: input.reason ?? null,
    });
    if (!res.ok) return res;
    // audit (job_merged) i historii obou zakázek zapisuje DB v téže transakci
    for (const p of FLOW_PATHS) revalidatePath(p);
    revalidatePath("/customers", "layout");
    revalidatePath(`/orders/${res.result.targetId}`);
    revalidatePath(`/orders/${res.result.sourceId}`);
    return res;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Sloučení se nepovedlo.", code: "VALIDATION" };
  }
}
