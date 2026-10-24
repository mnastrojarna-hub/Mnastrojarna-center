import "server-only";
import type { AnonDb } from "./queue";
import type { AnonStatus, AnonSummary } from "./types";

/**
 * Čtení pro UI (odznaky v Poptávkách, sekce „Ke kontrole anonymizace", Dashboard). Viditelnost
 * zakázek řeší volající (předá jen id zakázek, které uživatel smí vidět).
 */

export interface JobAnonBadge {
  jobId: string;
  total: number;
  done: number;
  review: number;
  failed: number;
  pending: number;
  unsupported: number;
  skipped: number;
  /** Odeslání čekající na anonymizaci (waiting / blocked). */
  sendWaiting: number;
}

/** Souhrn po zakázkách pro odznak „Výkresy 3/3 ✓ · 1 ke kontrole · Čeká… · DWG nelze · Odeslání čeká". */
export async function getAnonSummary(db: AnonDb, jobIds: string[]): Promise<Record<string, JobAnonBadge>> {
  const out: Record<string, JobAnonBadge> = {};
  const ids = [...new Set(jobIds)].slice(0, 500);
  if (!ids.length) return out;
  for (const id of ids) out[id] = { jobId: id, total: 0, done: 0, review: 0, failed: 0, pending: 0, unsupported: 0, skipped: 0, sendWaiting: 0 };
  const { data } = await db.from("job_files").select("job_id, anon_status").in("job_id", ids).eq("archived", false).not("anon_status", "is", null);
  for (const r of (data ?? []) as { job_id: string; anon_status: AnonStatus }[]) {
    const b = out[r.job_id];
    if (!b) continue;
    b.total++;
    if (r.anon_status === "done") b.done++;
    else if (r.anon_status === "review") b.review++;
    else if (r.anon_status === "failed") b.failed++;
    else if (r.anon_status === "pending" || r.anon_status === "processing") b.pending++;
    else if (r.anon_status === "unsupported") b.unsupported++;
    else if (r.anon_status === "skipped") b.skipped++;
  }
  const { data: q } = await db.from("anon_send_queue").select("job_id").in("job_id", ids).in("status", ["waiting", "blocked"]);
  for (const r of (q ?? []) as { job_id: string }[]) if (out[r.job_id]) out[r.job_id].sendWaiting++;
  return out;
}

export interface AnonReviewItem {
  id: string;
  jobId: string;
  filename: string;
  anonFilename: string | null;
  status: AnonStatus;
  reason: string | null;
  summary: AnonSummary | null;
  at: string | null;
}

/** Výkresy ke kontrole / se selháním napříč zakázkami (volitelně jen v daných zakázkách). */
export async function listAnonReview(db: AnonDb, opts: { limit?: number; jobIds?: string[] | null } = {}): Promise<AnonReviewItem[]> {
  let q = db.from("job_files").select("id, job_id, filename, anon_filename, anon_status, anon_reason, anon_summary, anon_at")
    .in("anon_status", ["review", "failed"]).eq("archived", false).order("anon_at", { ascending: false }).limit(Math.min(200, opts.limit ?? 50));
  if (opts.jobIds) {
    if (!opts.jobIds.length) return [];
    q = q.in("job_id", opts.jobIds.slice(0, 500));
  }
  const { data } = await q;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id), jobId: String(r.job_id), filename: String(r.filename ?? ""), anonFilename: (r.anon_filename as string | null) ?? null,
    status: r.anon_status as AnonStatus, reason: (r.anon_reason as string | null) ?? null, summary: (r.anon_summary as AnonSummary | null) ?? null,
    at: (r.anon_at as string | null) ?? null,
  }));
}

/** Počet „ke kontrole" (Dashboard). */
export async function countAnonReview(db: AnonDb, jobIds?: string[] | null): Promise<number> {
  let q = db.from("job_files").select("id", { count: "exact", head: true }).in("anon_status", ["review", "failed"]).eq("archived", false);
  if (jobIds) {
    if (!jobIds.length) return 0;
    q = q.in("job_id", jobIds.slice(0, 500));
  }
  const { count } = await q;
  return count ?? 0;
}
