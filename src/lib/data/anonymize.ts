import "server-only";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getAccess } from "@/lib/auth/session";
import type { FlowScope } from "@/lib/auth/flow-scope";
import { chunks, countAnonReview, getAnonSummary, listAnonReview, type AnonReviewItem, type JobAnonBadge } from "@/lib/anonymize/queries";
import { anonRunnerHealth, BACKFILL_PRIORITY, type AnonDb } from "@/lib/anonymize/queue";

/**
 * Data anonymizace výkresů pro stránky (Poptávky, Dashboard, Archiv výkresů) — jen čtení, podle
 * viditelnosti zakázek: rozsah „moje" obchodního toku (FlowScope), bez rozsahu všechny zakázky
 * (Kniha je vidí každý s funkcí „orders"). Nikdy nevrací texty smazaných oblastí.
 */

export type { AnonReviewItem, JobAnonBadge };

export interface AnonReviewRow extends AnonReviewItem {
  jobNumber: string | null;
  jobTitle: string | null;
}

async function db(): Promise<AnonDb | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const access = await getAccess();
    if (!access.user || !access.user.active || !access.can("orders")) return null;
    return (await createOperatorClient()) as unknown as AnonDb;
  } catch (err) {
    console.error(`[data:anonymize] ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Rozsah → id zakázek (null = všechny, [] = žádné). */
export function scopeJobIds(scope: FlowScope | null | undefined): string[] | null {
  if (scope === undefined) return null;
  if (!scope || scope.error || (!scope.all && !scope.userId)) return [];
  return scope.all ? null : [...scope.jobIds];
}

/** Odznaky „Výkresy 3/3 ✓ · 1 ke kontrole · Čeká…" pro řádky zakázek. */
export async function getJobAnonBadges(jobIds: string[]): Promise<Record<string, JobAnonBadge>> {
  const c = await db();
  if (!c || !jobIds.length) return {};
  try {
    return await getAnonSummary(c, jobIds);
  } catch (err) {
    console.error(`[data:anonymize:badges] ${err instanceof Error ? err.message : String(err)}`);
    return {};
  }
}

/** Výkresy se selhanou anonymizací (sekce „Anonymizace výkresů"; „ke kontrole" už nevzniká) s číslem zakázky. */
export async function getAnonReviewList(opts: { scope?: FlowScope | null; limit?: number } = {}): Promise<AnonReviewRow[]> {
  const c = await db();
  if (!c) return [];
  const jobIds = scopeJobIds(opts.scope);
  try {
    const items = await listAnonReview(c, { limit: opts.limit ?? 30, jobIds });
    if (!items.length) return [];
    const ids = [...new Set(items.map((i) => i.jobId))];
    const { data } = await c.from("orders").select("id, number, title").in("id", ids);
    const jobs = new Map(((data ?? []) as { id: string; number: string | null; title: string | null }[]).map((j) => [j.id, j]));
    return items.map((i) => ({ ...i, jobNumber: jobs.get(i.jobId)?.number ?? null, jobTitle: jobs.get(i.jobId)?.title ?? null }));
  } catch (err) {
    console.error(`[data:anonymize:review] ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/** Počet výkresů ke kontrole (Dashboard). */
export async function getAnonReviewCount(scope?: FlowScope | null): Promise<number> {
  const c = await db();
  if (!c) return 0;
  try {
    return await countAnonReview(c, scopeJobIds(scope));
  } catch {
    return 0;
  }
}

/**
 * Výkresy, které čekají na anonymizaci (hromadná akce „Anonymizovat vše, co čeká"). Jen pending —
 * selhané mají v seznamu vlastní tlačítko; staré výkresy (backfill, priorita 9) sem nepatří (Nastavení,
 * jen super admin a v rámci denního limitu).
 */
export async function getAnonPending(scope?: FlowScope | null): Promise<{ count: number; fileIds: string[] }> {
  const c = await db();
  if (!c) return { count: 0, fileIds: [] };
  const jobIds = scopeJobIds(scope);
  if (jobIds && !jobIds.length) return { count: 0, fileIds: [] };
  const base = () => c.from("job_files").select("id", { count: "exact" }).eq("archived", false).eq("anon_status", "pending")
    .lt("anon_priority", BACKFILL_PRIORITY).order("anon_priority", { ascending: true }).limit(200);
  try {
    let count = 0;
    const ids: string[] = [];
    for (const part of jobIds ? chunks([...new Set(jobIds)]) : [null]) {
      const { data, count: n, error } = await (part ? base().in("job_id", part) : base());
      if (error) console.error(`[data:anonymize:pending] ${error.message}`);
      count += n ?? (data ?? []).length;
      for (const r of (data ?? []) as { id: string }[]) if (ids.length < 200) ids.push(r.id);
    }
    return { count, fileIds: ids };
  } catch (err) {
    console.error(`[data:anonymize:pending] ${err instanceof Error ? err.message : String(err)}`);
    return { count: 0, fileIds: [] };
  }
}

export interface AnonSettingsPanelData {
  settings: import("@/lib/anonymize/settings").AnonSettings;
  mode: "full" | "approval";
  runnerWarning: string | null;
  /** Všechno v pořádku: krátký popis, jak zpracování běží. */
  runnerOk: string | null;
  /** AI pro fotky a skeny (vision): null = funguje, jinak proč ne („AI klíč chybí — …"). */
  aiWarning: string | null;
  /** AI funguje: odkud je klíč (stejný zdroj jako čtení dokladů a pošta). */
  aiOk: string | null;
  spentTodayUsd: number;
  /** Staré výkresy čekající na zpracování v rámci denního limitu (backfill, priorita 9). */
  legacyCount: number;
  /** Hotové / ke kontrole s jinou verzí pravidel (přepočet po změně nastavení). */
  changedCount: number;
  reviewCount: number;
}

export const AI_KEY_MISSING = "Bez AI klíče se na skenech název firmy nehledá — PDF z CADu a DXF se anonymizují i tak (podle pravidel). Doplň Claude API klíč v Nastavení → Integrace (stejný klíč čte doklady i poštu).";
export const AI_SWITCHED_OFF = "AI je vypnutá hlavním vypínačem — bez AI se na skenech název firmy nehledá (PDF z CADu a DXF se anonymizují i tak).";

/**
 * Stav AI pro anonymizaci fotek a skenů — stejný zdroj klíče jako zbytek aplikace (getAiConfig:
 * integration_settings.anthropic_api_key, jinak env ANTHROPIC_API_KEY) a stejný hlavní vypínač.
 */
export async function anonAiStatus(): Promise<{ warning: string | null; ok: string | null }> {
  try {
    const { isFakeAnon } = await import("@/lib/anonymize/detect-ai");
    if (isFakeAnon()) return { warning: null, ok: "AI pro fotky a skeny: testovací režim (AI_FAKE_ANON)." };
    const { getAiConfig, getSetting } = await import("@/lib/settings");
    const ai = await getAiConfig();
    if (!ai.apiKey) return { warning: AI_KEY_MISSING, ok: null };
    const on = await getSetting("ai_enabled");
    if (on !== undefined && on !== "" && !["1", "true", "ano", "yes", "on"].includes(on.trim().toLowerCase())) return { warning: AI_SWITCHED_OFF, ok: null };
    return { warning: null, ok: "AI pro fotky a skeny je zapnutá — stejný Claude klíč jako čtení dokladů a pošta." };
  } catch {
    return { warning: null, ok: null };
  }
}

/** Data karty Nastavení → Anonymizace výkresů. */
export async function getAnonSettingsPanel(): Promise<AnonSettingsPanelData | null> {
  const c = await db();
  if (!c) return null;
  try {
    const { settingsFromRow, configHash } = await import("@/lib/anonymize/settings");
    const { spentToday } = await import("@/lib/anonymize/budget");
    const [{ data: row }, { data: mode }, { data: glob }] = await Promise.all([
      c.from("drawing_anon_settings").select("*").eq("id", 1).maybeSingle(),
      c.from("automation_settings").select("mode, enabled").eq("module", "drawing_anonymize").maybeSingle(),
      c.from("automation_global").select("mode").maybeSingle(),
    ]);
    const settings = settingsFromRow(row as Record<string, unknown> | null);
    const hash = await configHash(settings);
    const m = mode as { mode: "full" | "approval"; enabled: boolean } | null;
    const [legacy, changed, review, spent, health, ai] = await Promise.all([
      c.from("job_files").select("id", { count: "exact", head: true }).eq("anon_status", "pending").gte("anon_priority", 9).eq("archived", false),
      c.from("job_files").select("id", { count: "exact", head: true }).in("anon_status", ["done", "review"]).neq("anon_config_hash", hash).eq("archived", false),
      countAnonReview(c, null),
      spentToday(c),
      anonRunnerHealth(c),
      anonAiStatus(),
    ]);
    return {
      settings,
      mode: m && m.enabled === false ? "approval" : m?.mode ?? ((glob as { mode: "full" | "approval" } | null)?.mode ?? "approval"),
      runnerWarning: health.warning,
      runnerOk: health.ok,
      aiWarning: ai.warning,
      aiOk: ai.ok,
      spentTodayUsd: spent,
      legacyCount: legacy.count ?? 0,
      changedCount: changed.count ?? 0,
      reviewCount: review,
    };
  } catch (err) {
    console.error(`[data:anonymize:settings] ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export interface DrawingAnonView {
  status: string;
  reviewed: boolean;
  reason: string | null;
  /** Odkud stahovat anonymizovanou kopii: dokument zakázky, nebo přímé nahrání do archivu. */
  table: "job_files" | "drawings";
  fileId: string;
}

/** Stav anonymizace výkresů archivu (podle dokumentu zakázky, jinak sloupce anon_* archivu). */
export async function getDrawingAnonStatuses(items: { id: string; jobFileId: string | null }[]): Promise<Record<string, DrawingAnonView>> {
  const c = await db();
  if (!c || !items.length) return {};
  const out: Record<string, DrawingAnonView> = {};
  try {
    const fileIds = [...new Set(items.map((i) => i.jobFileId).filter((x): x is string => Boolean(x)))].slice(0, 2000);
    const direct = [...new Set(items.filter((i) => !i.jobFileId).map((i) => i.id))].slice(0, 2000);
    type R = { id: string; anon_status: string | null; anon_reviewed_at: string | null; anon_reason: string | null };
    // po dávkách ≤ 200 id (dlouhé .in() přeteče hlavičky PostgRESTu — HTTP 431)
    const read = async (table: "job_files" | "drawings", ids: string[]): Promise<R[]> => {
      const out: R[] = [];
      for (const part of chunks(ids)) {
        const { data, error } = await c.from(table).select("id, anon_status, anon_reviewed_at, anon_reason").in("id", part);
        if (error) console.error(`[data:anonymize:drawings] ${error.message}`);
        out.push(...((data ?? []) as R[]));
      }
      return out;
    };
    const [files, drs] = await Promise.all([read("job_files", fileIds), read("drawings", direct)]);
    const byFile = new Map(files.map((r) => [r.id, r]));
    const byDrawing = new Map(drs.map((r) => [r.id, r]));
    for (const i of items) {
      const r = i.jobFileId ? byFile.get(i.jobFileId) : byDrawing.get(i.id);
      if (!r?.anon_status) continue;
      out[i.id] = { status: r.anon_status, reviewed: Boolean(r.anon_reviewed_at), reason: r.anon_reason, table: i.jobFileId ? "job_files" : "drawings", fileId: i.jobFileId ?? i.id };
    }
  } catch (err) {
    console.error(`[data:anonymize:drawings] ${err instanceof Error ? err.message : String(err)}`);
  }
  return out;
}
