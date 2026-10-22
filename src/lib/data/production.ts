import "server-only";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAccess } from "@/lib/auth/session";
import type { JobsDb } from "@/lib/jobs/events";
import { fetchPaged, isUuid, todayIso } from "@/lib/jobs/mapping";
import {
  CLOSING_SELECT, OPERATION_SELECT, computeClosingInfo, countProductionFilters, rowToJobOperation,
  sortOperations, summaryFromJob, type ClosingDbRow, type JobOperationDbRow,
} from "@/lib/jobs/production";
import type {
  JobClosingInfo, JobOperation, JobProductionSummary, ProductionFilterCounts,
} from "@/lib/jobs/production-types";

/**
 * Datová vrstva výroby zakázky (postup operací, kde se díl nachází) a konce toku
 * (dodací list, faktura, splatnost, úhrada). Čte servisním klíčem → každá veřejná
 * funkce sama ověří přihlášení a právo „orders". fetch* berou hotového klienta
 * a práva nehlídají.
 */

const MAX_ROWS = 5000;

function warn(scope: string, error: { message: string } | null | undefined) {
  if (error) console.error(`[data:production:${scope}] Supabase chyba: ${error.message}`);
}

async function session() {
  if (!isSupabaseConfigured()) return null;
  try {
    const access = await getAccess();
    if (!access.user || !access.user.active || !access.can("orders")) return null;
    const db = await createOperatorClient();
    return { db, margins: access.can("margins") };
  } catch (err) {
    console.error(`[data:production] ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ── S hotovým klientem (bez kontroly práv) ──────────────────
export async function fetchJobOperations(db: JobsDb, jobId: string): Promise<JobOperation[]> {
  if (!isUuid(jobId)) return [];
  const { data, error } = await db
    .from("job_operations")
    .select(OPERATION_SELECT)
    .eq("job_id", jobId)
    .order("position")
    .order("created_at");
  warn("operations", error);
  const today = todayIso();
  return sortOperations(((data ?? []) as unknown as JobOperationDbRow[]).map((r) => rowToJobOperation(r, today)));
}

export async function fetchJobClosingInfo(db: JobsDb, jobId: string, margins: boolean): Promise<JobClosingInfo | null> {
  if (!isUuid(jobId)) return null;
  const { data, error } = await db.from("orders").select(CLOSING_SELECT).eq("id", jobId).maybeSingle();
  warn("closing", error);
  return data ? computeClosingInfo(data as unknown as ClosingDbRow, { margins }) : null;
}

// ── Veřejné (s kontrolou práv) ──────────────────────────────
/** Výrobní operace zakázky v pořadí. */
export async function getJobOperations(jobId: string): Promise<JobOperation[]> {
  const s = await session();
  if (!s || !isUuid(jobId)) return [];
  try {
    return await fetchJobOperations(s.db, jobId);
  } catch (err) {
    console.error(`[data:production:operations] ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/** Domluvy se zákazníkem, potvrzený DL, faktura, splatnost a úhrada. */
export async function getJobClosingInfo(jobId: string): Promise<JobClosingInfo | null> {
  const s = await session();
  if (!s || !isUuid(jobId)) return null;
  try {
    return await fetchJobClosingInfo(s.db, jobId, s.margins);
  } catch (err) {
    console.error(`[data:production:closing] ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Vše pro záložku „Výroba" v detailu zakázky jedním voláním. */
export async function getJobProduction(jobId: string): Promise<{
  operations: JobOperation[];
  summary: JobProductionSummary;
  closing: JobClosingInfo | null;
} | null> {
  const s = await session();
  if (!s || !isUuid(jobId)) return null;
  try {
    const [operations, closing, job] = await Promise.all([
      fetchJobOperations(s.db, jobId),
      fetchJobClosingInfo(s.db, jobId, s.margins),
      s.db
        .from("orders")
        .select("id, production_step, production_location, production_done, production_total, production_problem")
        .eq("id", jobId)
        .maybeSingle(),
    ]);
    warn("summary", job.error);
    if (!job.data) return null;
    return { operations, summary: summaryFromJob(job.data as Parameters<typeof summaryFromJob>[0]), closing };
  } catch (err) {
    console.error(`[data:production:job] ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Filtry knihy: kolik aktivních zakázek je právě v které operaci a kde
 * (zakázky bez postupu se nepočítají).
 */
export async function listOperationLocations(): Promise<ProductionFilterCounts> {
  const empty: ProductionFilterCounts = { steps: [], locations: [] };
  const s = await session();
  if (!s) return empty;
  try {
    const { data, error } = await fetchPaged<{ status: string; production_step: string | null; production_location: string | null }>(
      (from, to) => s.db
        .from("orders")
        .select("id, status, production_step, production_location")
        .not("production_step", "is", null)
        .not("status", "in", "(dokonceno,nerealizovano,zruseno)")
        .order("id")
        .range(from, to),
      MAX_ROWS,
    );
    warn("locations", error);
    return countProductionFilters(data);
  } catch (err) {
    console.error(`[data:production:locations] ${err instanceof Error ? err.message : String(err)}`);
    return empty;
  }
}
