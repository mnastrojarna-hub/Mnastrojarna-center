import "server-only";
import { after } from "next/server";
import { routeDeadline } from "@/lib/ai/ai-call";
import { createAdminClient, hasServiceKey } from "@/lib/supabase/server";
import { cronActor, type ActorContext } from "@/lib/supabase/actor-headers";
import { appOrigin, kick, runClaimed, runnableIds, KICK_CONCURRENCY, type AnonDb, type AnonRunResult, type AnonTable } from "./service";

/**
 * Zpracování fronty anonymizace PŘÍMO v požadavku (bez HTTP volání sama sebe) — JEN z rout
 * (/api/drawings/anonymize/**, /api/cron/**, /api/jobs/capture/**, /api/emails/sync): renderer (pdf.js,
 * canvas, sharp) se načítá ze service.ts dynamicky a nativní moduly jsou v tracingu jen u těchto rout.
 * Server action ho nikdy neimportuje (test importního grafu + ESLint).
 *
 * Proč: dřív se zpracování spouštělo jen fetchem na vlastní /run (kick). Na Vercelu ten fetch často
 * skončí 401 (chráněná adresa nasazení) / 404 / nedostupný localhost a soubor zůstal navždy „pending"
 * (nekonečný spinner). Teď soubor zpracuje hned ta funkce, která ho přijala (after()), kick jen přidá souběh.
 */

/** Rezerva před termínem funkce: nový soubor se začne, jen když zbývá aspoň tolik času. */
export const MIN_TIME_LEFT_MS = 45_000;
/**
 * Opakování / navázání v témže běhu (majitel 5. 11.: „aby to fungovalo na první pokus"): pauza před n-tým
 * rychlým opakováním (přetížená AI / výpadek potřebují chvíli) a kolik času musí zbývat na celý další pokus
 * (stránka s detekcí AI i kontrolou kopie) — jinak soubor zůstane pending bez odkladu pro další běh.
 */
export const IN_RUN_BACKOFF_MS: readonly number[] = [2_000, 8_000];
export const CONTINUE_MIN_LEFT_MS = 100_000;
/** Nejvýš tolik navazujících dávek stran jednoho souboru v jednom běhu (200 stran / 10 na dávku). */
const MAX_CONTINUES_PER_RUN = 30;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface ProcessOptions {
  table?: AnonTable;
  /** Jen tyto soubory (jinak celá fronta / zakázky). */
  ids?: string[] | null;
  /** Jen soubory těchto zakázek (job_files). */
  jobIds?: string[] | null;
  /** Autor běhu (výchozí plánovač „drawing-anon" — automatika: AI za nahrávajícího, denní limit). */
  actor?: ActorContext;
  manual?: boolean;
  /** Absolutní termín (ms); výchozí start požadavku + 270 s. */
  deadline?: number;
  /** Max. souborů v tomto běhu (výchozí 20). */
  maxFiles?: number;
  /** I staré výkresy (backfill, priorita ≥ 9) — jen plánovač / řetěz běhů, ne nahrání ani šťouchnutí. */
  includeBackfill?: boolean;
  /** Rozvětvit zbytek fronty na souběžné běhy (kick, best effort). Výchozí true. */
  fanOut?: boolean;
  origin?: string | null;
  db?: AnonDb;
  /** Jen testy: fetch pro kick. */
  fetchImpl?: typeof fetch;
  /** Jen testy: pauzy před rychlým opakováním v témže běhu. */
  retryBackoffMs?: readonly number[];
}

export interface ProcessOutcome {
  results: AnonRunResult[];
  /** Zbývá ve frontě (podle filtru) po tomto běhu. */
  remaining: number;
  kicked: number;
  kickFailed: number;
  stoppedBy: "empty" | "deadline" | "max";
  /** Opakování / navázání téhož souboru v tomto běhu (přechodná chyba, únik názvu, další dávka stran). */
  retried: number;
  /** Id běhu (diagnostika anon_debug). */
  runId: string;
}

/**
 * Zpracuje frontu (podle filtru) postupně po jednom souboru až do termínu: claim (atomický, „for update
 * skip locked" — souběžné běhy si soubory nikdy nevezmou dvakrát) → anonymizace → další. Přerušené běhy
 * (processing s prošlým zámkem) se převezmou; po 3 pokusech claim soubor označí jako selhaný.
 *
 * Soubor, který v tomto běhu skončil pending BEZ odkladu (navazující dávka stran, přechodná chyba v rychlých
 * pokusech, zbylý název firmy s AI → retryNow), vezme TENTÝŽ běh znovu, dokud má čas (krátká pauza, nejvýš
 * IN_RUN_BACKOFF_MS.length opakování; dávky stran bez pauzy). Majitel 5. 11.: dřív se takový soubor ve stejném
 * běhu nezkoušel a čekal na další šťouchnutí z prohlížeče nebo klik — proto „na třikrát". Soubor s odloženým
 * pokusem (zámek v budoucnu) se nechá dalšímu běhu. Co zbude při termínu, se rozvětví (kick, best effort).
 */
export async function processQueue(opts: ProcessOptions = {}): Promise<ProcessOutcome> {
  const table = opts.table ?? "job_files";
  const actor = opts.actor ?? cronActor("drawing-anon");
  const deadline = opts.deadline ?? routeDeadline();
  const maxFiles = Math.max(1, Math.min(opts.maxFiles ?? 20, 100));
  const db = opts.db ?? (createAdminClient({ actor }) as AnonDb);
  const runId = crypto.randomUUID().slice(0, 8);
  const backoff = opts.retryBackoffMs ?? IN_RUN_BACKOFF_MS;
  const out: ProcessOutcome = { results: [], remaining: 0, kicked: 0, kickFailed: 0, stoppedBy: "empty", retried: 0, runId };
  const tried: string[] = [];
  /** Rychlá opakování / navázání po souborech v tomto běhu. */
  const retries = new Map<string, number>();
  const continues = new Map<string, number>();
  const filter: { ids: string[] | null; jobIds: string[] | null; includeBackfill: boolean } = { ids: opts.ids ?? null, jobIds: table === "job_files" ? opts.jobIds ?? null : null, includeBackfill: Boolean(opts.includeBackfill) };
  let fannedOut = opts.fanOut === false;
  for (;;) {
    if (out.results.length >= maxFiles) { out.stoppedBy = "max"; break; }
    if (Date.now() > deadline - MIN_TIME_LEFT_MS) { out.stoppedBy = "deadline"; break; }
    const next = await runnableIds(db, table, { ...filter, exclude: tried, limit: fannedOut ? 1 : KICK_CONCURRENCY });
    if (!next.length) { out.stoppedBy = "empty"; break; }
    if (!fannedOut) {
      fannedOut = true;
      // souběh: zbytek rozvětvit na samostatné běhy (když adresa / tajemství nefungují, nevadí — zpracuje se tady)
      if (next.length > 1) {
        const manualBy = opts.manual && actor.kind === "user" ? actor.id : null;
        const k = await kick({ origin: opts.origin ?? appOrigin(null), table, ids: next.slice(1), fetchImpl: opts.fetchImpl, manualBy }).catch(() => ({ kicked: 0, failed: 0 }));
        out.kicked += k.kicked;
        out.kickFailed += k.failed ?? 0;
      }
    }
    const id = next[0];
    tried.push(id);
    let res: AnonRunResult[] = [];
    try {
      res = await runClaimed(db, table, [id], { actor, deadline, manual: Boolean(opts.manual), runId }, 1);
    } catch (err) {
      console.error(`[anonymize] Běh fronty ${table}/${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
    out.results.push(...res);
    // rozbalený archiv / e-mail: nové soubory zakázky se zpracují ve stejném běhu (jinak by čekaly na plánovač)
    const spawned = res.flatMap((r) => r.spawned ?? []);
    if (spawned.length && filter.ids) filter.ids = [...new Set([...filter.ids, ...spawned])];
    // hned znovu v témže běhu: další dávka stran (bez pauzy), přechodná chyba / únik názvu (krátká pauza)
    const r = res[0];
    if (r && r.status === "pending" && r.retryNow) {
      const map = r.continued ? continues : retries;
      const n = (map.get(id) ?? 0) + 1;
      const cap = r.continued ? MAX_CONTINUES_PER_RUN : backoff.length;
      const wait = r.continued ? 0 : backoff[Math.min(n, backoff.length) - 1] ?? 0;
      if (n <= cap && Date.now() + wait < deadline - CONTINUE_MIN_LEFT_MS) {
        map.set(id, n);
        if (wait > 0) await sleep(wait);
        tried.splice(tried.indexOf(id), 1);
        out.retried++;
        if (out.results.length >= maxFiles) continue;
      }
    }
  }
  const left = await runnableIds(db, table, { ...filter, limit: 50 });
  out.remaining = left.length;
  // co zbylo k okamžitému zpracování (termín, limit souborů, opakování bez času), rozvětvit — další funkce
  // pokračuje hned; když adresa nefunguje, vezme to další šťouchnutí z prohlížeče nebo plánovač
  if (left.length && opts.fanOut !== false) {
    const manualBy = opts.manual && actor.kind === "user" ? actor.id : null;
    const k = await kick({ origin: opts.origin ?? appOrigin(null), table, ids: left.slice(0, KICK_CONCURRENCY), fetchImpl: opts.fetchImpl, manualBy }).catch(() => ({ kicked: 0, failed: 0 }));
    out.kicked += k.kicked;
    out.kickFailed += k.failed ?? 0;
  }
  return out;
}

/**
 * Spustí processQueue po odpovědi (next/server after() — na Vercelu waitUntil, v rámci maxDuration
 * routy). Mimo požadavek Next.js (testy, skripty) hned. Chyby jen do logu.
 */
export function processInBackground(opts: ProcessOptions & { label?: string; onDone?: (o: ProcessOutcome | null) => void | Promise<void> }): void {
  const task = async () => {
    let o: ProcessOutcome | null = null;
    try {
      if (!hasServiceKey()) return;
      o = await processQueue(opts);
      if (o.results.length || o.remaining) {
        console.info(`[anonymize] ${opts.label ?? "běh"} ${o.runId}: zpracováno ${o.results.length} (${o.results.map((r) => `${r.status}${r.attempt ? `#${r.attempt}` : ""}`).join(", ") || "—"})${o.retried ? `, opakováno v běhu ${o.retried}×` : ""}, ve frontě ${o.remaining}${o.kickFailed ? `, rozvětvení selhalo ${o.kickFailed}×` : ""}`);
      }
    } catch (err) {
      console.error(`[anonymize] ${opts.label ?? "běh"} selhal: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      // vždy (i po chybě) — šťouchnutí uvolní slot omezovače
      await Promise.resolve(opts.onDone?.(o)).catch(() => undefined);
    }
  };
  try {
    after(task);
  } catch {
    void task();
  }
}

/** Id nových souborů z výsledku uložení dávky / focení (job_files). */
export function fileIdsOf(input: { fileId?: string | null; docs?: { fileIds?: string[] | null }[] | null } | null | undefined): string[] {
  if (!input) return [];
  const ids = new Set<string>();
  if (input.fileId) ids.add(input.fileId);
  for (const d of input.docs ?? []) for (const id of d.fileIds ?? []) if (id) ids.add(id);
  return [...ids];
}
