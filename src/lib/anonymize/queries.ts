import "server-only";
import type { AnonDb } from "./queue";
import type { AnonStatus, AnonSummary } from "./types";

/**
 * Čtení pro UI (odznaky v Poptávkách, sekce „Ke kontrole anonymizace", Dashboard). Viditelnost
 * zakázek řeší volající (předá jen id zakázek, které uživatel smí vidět).
 *
 * Seznamy id jdou do `.in()` po dávkách ≤ 200 (URL PostgRESTu nad ~300 uuid přeteče hlavičky — HTTP 431),
 * chyby se logují (ne tiché prázdno).
 */

export const ID_CHUNK = 200;

export function chunks<T>(list: readonly T[], size = ID_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function logErr(where: string, error: { message: string } | null | undefined) {
  if (error) console.error(`[anonymize:${where}] ${error.message}`);
}

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
  /** Čeká na denní limit AI (pending s důvodem). */
  waitingBudget?: number;
  /** Staré výkresy (backfill) — čekají na ruční / hromadné spuštění. */
  waitingLegacy?: number;
}

/** Souhrn po zakázkách pro odznak „Výkresy 3/3 ✓ · 1 ke kontrole · Čeká… · DWG nelze · Odeslání čeká". */
export async function getAnonSummary(db: AnonDb, jobIds: string[]): Promise<Record<string, JobAnonBadge>> {
  const out: Record<string, JobAnonBadge> = {};
  const ids = [...new Set(jobIds)].slice(0, 2000);
  if (!ids.length) return out;
  for (const id of ids) out[id] = { jobId: id, total: 0, done: 0, review: 0, failed: 0, pending: 0, unsupported: 0, skipped: 0, sendWaiting: 0, waitingBudget: 0, waitingLegacy: 0 };
  for (const part of chunks(ids)) {
    const { data, error } = await db.from("job_files").select("job_id, anon_status, anon_reason, anon_priority").in("job_id", part).eq("archived", false).not("anon_status", "is", null);
    logErr("summary", error);
    for (const r of (data ?? []) as { job_id: string; anon_status: AnonStatus; anon_reason: string | null; anon_priority: number | null }[]) {
      const b = out[r.job_id];
      if (!b) continue;
      b.total++;
      if (r.anon_status === "done") b.done++;
      else if (r.anon_status === "review") b.review++;
      else if (r.anon_status === "failed") b.failed++;
      else if (r.anon_status === "pending" || r.anon_status === "processing") {
        b.pending++;
        if (r.anon_status === "pending" && /limit/i.test(r.anon_reason ?? "")) b.waitingBudget = (b.waitingBudget ?? 0) + 1;
        // starý výkres (backfill, priorita ≥ 9) — sám se nespouští, nesmí svítit jako „běží"
        else if (r.anon_status === "pending" && (r.anon_priority ?? 0) >= 9) b.waitingLegacy = (b.waitingLegacy ?? 0) + 1;
      } else if (r.anon_status === "unsupported") b.unsupported++;
      else if (r.anon_status === "skipped") b.skipped++;
    }
    const { data: q, error: qErr } = await db.from("anon_send_queue").select("job_id").in("job_id", part).in("status", ["waiting", "blocked"]);
    logErr("summary:queue", qErr);
    for (const r of (q ?? []) as { job_id: string }[]) if (out[r.job_id]) out[r.job_id].sendWaiting++;
  }
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
  /** Výřez strany miniatury kolem smazaných oblastí (miniatura „Po" = razítko), normalizovaně; null = celá strana. */
  crop: { x: number; y: number; w: number; h: number } | null;
  /** Strana originálu pro miniaturu (první zahrnutá — dopis na straně 1 se do „Po" nedostane). */
  page: number;
}

const REVIEW_SELECT = "id, job_id, filename, anon_filename, anon_status, anon_reason, anon_summary, anon_at, anon_regions, anon_pages";

function firstIncluded(pages: unknown): number {
  const inc = (pages && typeof pages === "object" ? (pages as { included?: unknown }).included : null);
  const n = Array.isArray(inc) ? inc.find((v) => Number.isInteger(v) && (v as number) >= 1) : null;
  return typeof n === "number" ? n : 1;
}

/** Obal oblastí první strany s rezervou (bez textů — jen souřadnice). */
export function cropOf(regions: unknown, page = 1, pad = 0.04): AnonReviewItem["crop"] {
  const rs = (Array.isArray(regions) ? regions : []).filter((r): r is { page: number; x: number; y: number; w: number; h: number; manual?: string } =>
    Boolean(r) && typeof r === "object" && (r as { page?: unknown }).page === page && (r as { manual?: unknown }).manual !== "removed"
    && [r.x, r.y, r.w, r.h].every((v: unknown) => typeof v === "number" && Number.isFinite(v)));
  if (!rs.length) return null;
  // přednostně razítko (firma, jména); plot stamp u okraje by výřez roztáhl přes celou stranu
  const tb = rs.filter((r) => (r as { zone?: string }).zone === "title_block");
  if (tb.length) rs.splice(0, rs.length, ...tb);
  const x0 = Math.max(0, Math.min(...rs.map((r) => r.x)) - pad), y0 = Math.max(0, Math.min(...rs.map((r) => r.y)) - pad);
  const x1 = Math.min(1, Math.max(...rs.map((r) => r.x + r.w)) + pad), y1 = Math.min(1, Math.max(...rs.map((r) => r.y + r.h)) + pad);
  if (x1 - x0 <= 0.01 || y1 - y0 <= 0.01) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function toItem(r: Record<string, unknown>): AnonReviewItem {
  const page = firstIncluded(r.anon_pages);
  return {
    id: String(r.id), jobId: String(r.job_id), filename: String(r.filename ?? ""), anonFilename: (r.anon_filename as string | null) ?? null,
    status: r.anon_status as AnonStatus, reason: (r.anon_reason as string | null) ?? null, summary: (r.anon_summary as AnonSummary | null) ?? null,
    at: (r.anon_at as string | null) ?? null, crop: cropOf(r.anon_regions, page), page,
  };
}

/** Výkresy ke kontrole / se selháním napříč zakázkami (volitelně jen v daných zakázkách). */
export async function listAnonReview(db: AnonDb, opts: { limit?: number; jobIds?: string[] | null } = {}): Promise<AnonReviewItem[]> {
  const limit = Math.min(200, opts.limit ?? 50);
  const base = () => db.from("job_files").select(REVIEW_SELECT).in("anon_status", ["review", "failed"]).eq("archived", false)
    .order("anon_at", { ascending: false }).limit(limit);
  if (!opts.jobIds) {
    const { data, error } = await base();
    logErr("review", error);
    return ((data ?? []) as Record<string, unknown>[]).map(toItem);
  }
  if (!opts.jobIds.length) return [];
  const all: AnonReviewItem[] = [];
  for (const part of chunks([...new Set(opts.jobIds)])) {
    const { data, error } = await base().in("job_id", part);
    logErr("review", error);
    all.push(...((data ?? []) as Record<string, unknown>[]).map(toItem));
  }
  return all.sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? ""))).slice(0, limit);
}

/** Počet „ke kontrole" (Dashboard). */
export async function countAnonReview(db: AnonDb, jobIds?: string[] | null): Promise<number> {
  const base = () => db.from("job_files").select("id", { count: "exact", head: true }).in("anon_status", ["review", "failed"]).eq("archived", false);
  if (!jobIds) {
    const { count, error } = await base();
    logErr("count", error);
    return count ?? 0;
  }
  if (!jobIds.length) return 0;
  let sum = 0;
  for (const part of chunks([...new Set(jobIds)])) {
    const { count, error } = await base().in("job_id", part);
    logErr("count", error);
    sum += count ?? 0;
  }
  return sum;
}
