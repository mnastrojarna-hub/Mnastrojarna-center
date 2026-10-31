import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logJobEvent, type JobsDb } from "@/lib/jobs/events";
import { SYSTEM_ACTOR, type ActorContext } from "@/lib/supabase/actor-headers";
import { isAnonCandidate, isUnsupportedExt, unsupportedHowTo } from "./candidate";
import { settingsFromRow, type AnonSettings } from "./settings";
import type { AnonPages, AnonRegion, AnonStatus } from "./types";

/**
 * Fronta anonymizace BEZ rendereru (smí ji importovat server action): subjekty, zařazení, claim,
 * rozvětvení běhů (kick), schválení / přeskočení, historie a navázání fronty odeslání.
 * Zpracování (vykreslování) je v service.ts — jen v routách.
 */

export type AnonDb = SupabaseClient;
export type AnonTable = "job_files" | "drawings" | "drawing_anon_adhoc";
export const ANON_TABLES: readonly AnonTable[] = ["job_files", "drawings", "drawing_anon_adhoc"];

export const ANON_COLS = "anon_status, anon_priority, anon_source_path, anon_path, anon_filename, anon_mime, anon_size, anon_sha256, anon_method, anon_pages, anon_regions, anon_summary, anon_confidence, anon_reason, anon_config_hash, anon_terms_hash, anon_ai_cache, anon_at, anon_by, anon_actor_kind, anon_via, anon_reviewed_at, anon_reviewed_by, anon_attempts, anon_lock_until, anon_usage";
export const SUBJECT_SELECT: Record<AnonTable, string> = {
  job_files: `id, job_id, kind, filename, mime_type, size_bytes, storage_path, origin, issuer, uploaded_by, content_sha256, ai_extracted, drawing_id, created_at, archived, ${ANON_COLS}`,
  drawings: `id, job_id, job_file_id, drawing_number, revision, material, title, storage_bucket, storage_path, file_type, uploaded_by, created_at, ${ANON_COLS}`,
  drawing_anon_adhoc: `id, user_id, storage_path, content_sha256, filename, mime_type, size_bytes, created_at, expires_at, ${ANON_COLS}`,
};

export type SubjectRow = Record<string, unknown> & {
  id: string;
  anon_status: AnonStatus | null;
  anon_attempts: number;
  anon_regions: AnonRegion[] | null;
  anon_pages: AnonPages | null;
  anon_path: string | null;
  anon_source_path: string | null;
  anon_at: string | null;
  anon_via: string | null;
  anon_priority: number;
};

export interface Subject {
  table: AnonTable;
  id: string;
  row: SubjectRow;
  bucket: "job-files" | "documents";
  storagePath: string | null;
  sourcePath: string | null;
  hasMaster: boolean;
  filename: string;
  mime: string | null;
  kind: string | null;
  origin: string | null;
  issuer: string | null;
  jobId: string | null;
  uploadedBy: string | null;
  extracted: Record<string, unknown> | null;
  /** Prefix výstupu v úložišti (verifyShareBytes kontroluje stejný prefix). */
  outPrefix: string;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

export function subjectOf(table: AnonTable, row: SubjectRow): Subject {
  if (table === "job_files") {
    const jobId = String(row.job_id ?? "").toLowerCase();
    return {
      table, id: row.id, row, bucket: "job-files", storagePath: str(row.storage_path), sourcePath: str(row.anon_source_path) ?? str(row.storage_path),
      hasMaster: Boolean(row.anon_source_path), filename: String(row.filename ?? "soubor"), mime: str(row.mime_type), kind: str(row.kind),
      origin: str(row.origin), issuer: str(row.issuer), jobId, uploadedBy: str(row.uploaded_by), extracted: (row.ai_extracted as Record<string, unknown>) ?? null,
      outPrefix: `zakazky/${jobId}/anon/`,
    };
  }
  if (table === "drawings") {
    const path = str(row.storage_path);
    return {
      table, id: row.id, row, bucket: (str(row.storage_bucket) as "documents") ?? "documents", storagePath: path, sourcePath: str(row.anon_source_path) ?? path,
      hasMaster: Boolean(row.anon_source_path), filename: path ? path.slice(path.lastIndexOf("/") + 1) : "vykres.pdf", mime: null, kind: "vykres",
      origin: "upload", issuer: null, jobId: str(row.job_id), uploadedBy: str(row.uploaded_by),
      extracted: { drawingNumber: row.drawing_number, revision: row.revision, material: row.material, title: row.title },
      outPrefix: "vykresy/anon/",
    };
  }
  const uid = String(row.user_id ?? "");
  return {
    table, id: row.id, row, bucket: "job-files", storagePath: str(row.storage_path), sourcePath: str(row.anon_source_path) ?? str(row.storage_path),
    // samostatný nástroj nahrává nezmenšený originál (File z výběru / fotoaparátu) → je to master
    hasMaster: true, filename: String(row.filename ?? "vykres"), mime: str(row.mime_type), kind: "vykres",
    origin: "upload", issuer: null, jobId: null, uploadedBy: uid || null, extracted: null, outPrefix: `capture/${uid}/anon/out/`,
  };
}

// ── Fronta ────────────────────────────────────────────────────

const CLAIM_FN: Record<AnonTable, string> = { job_files: "claim_drawing_anon", drawings: "claim_drawing_anon_drawings", drawing_anon_adhoc: "claim_drawing_anon_adhoc" };

export async function claim(db: AnonDb, table: AnonTable, limit: number, ids?: string[] | null): Promise<SubjectRow[]> {
  // soubory, kterým claim teď ukončí třetí prošlý zámek (failed „opakovaně překročen čas") → událost v historii
  let expiring: SubjectRow[] = [];
  try {
    let q = db.from(table).select(SUBJECT_SELECT[table]).eq("anon_status", "processing").lt("anon_lock_until", new Date().toISOString()).gte("anon_attempts", 3).limit(20);
    if (ids?.length) q = q.in("id", ids);
    const { data } = await q;
    expiring = (data ?? []) as unknown as SubjectRow[];
  } catch {
    // jen pro historii
  }
  const { data, error } = await db.rpc(CLAIM_FN[table], { p_limit: limit, p_ids: ids?.length ? ids : null });
  if (error) throw new Error(`Fronta anonymizace: ${error.message}`);
  for (const r of expiring) {
    const { data: now } = await db.from(table).select("anon_status").eq("id", r.id).maybeSingle();
    if ((now as { anon_status: string } | null)?.anon_status !== "failed") continue;
    const s = subjectOf(table, r);
    await event(db, s, SYSTEM_ACTOR, `Anonymizace výkresu ${label(s)} selhala — opakovaně překročen čas zpracování (velký nebo složitý soubor; zkus ho rozdělit).`, { anonStatus: "failed", timeout: true }).catch(() => undefined);
    await afterSettled(db, s);
  }
  return (data ?? []) as SubjectRow[];
}

export interface EnqueueResult {
  queued: number;
  statuses: Record<string, AnonStatus | null>;
  skipped: { id: string; reason: string }[];
  /** Staré výkresy (backfill, priorita ≥ 9), které zůstaly v pořadí backfillu (bez ručního spuštění). */
  backfill?: string[];
}

/** Priorita backfillu starých výkresů (migrace / „Zpracovat staré výkresy"). */
export const BACKFILL_PRIORITY = 9;

/** Nákupní doklady (#25) mezi soubory — DB pravidlo job_file_price_ids; chyba DB = všechny (fail closed). */
export async function priceDocIds(db: AnonDb, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { data, error } = await db.rpc("job_file_price_ids", { p_ids: ids });
  if (error) return new Set(ids.map((x) => x.toLowerCase()));
  return new Set(((data ?? []) as string[]).map((x) => String(x).toLowerCase()));
}

export async function enqueue(db: AnonDb, input: {
  table?: AnonTable; fileIds?: string[]; jobIds?: string[]; force?: boolean; priority?: number; via?: string;
  /** Smí volající soubor zařadit (stejná kontrola jako otevření dokumentu)? Platí i pro soubory ze zakázek (jobIds). */
  allow?: (id: string) => Promise<boolean>;
  /**
   * Čekající staré výkresy (backfill) nechat v pořadí backfillu — priorita a „via" se nemění a soubor
   * se nevrací jako ručně zařazený (běží v rámci denního limitu). Pro volající, kteří nejsou super admin.
   */
  keepBackfill?: boolean;
}): Promise<EnqueueResult> {
  const table = input.table ?? "job_files";
  const out: EnqueueResult = { queued: 0, statuses: {}, skipped: [], backfill: [] };
  let rows: SubjectRow[] = [];
  if (input.fileIds?.length) {
    const { data } = await db.from(table).select(SUBJECT_SELECT[table]).in("id", input.fileIds.slice(0, 200));
    rows = (data ?? []) as unknown as SubjectRow[];
  }
  if (table === "job_files" && input.jobIds?.length) {
    const { data } = await db.from("job_files").select(SUBJECT_SELECT.job_files).in("job_id", input.jobIds.slice(0, 100)).eq("archived", false);
    rows.push(...((data ?? []) as unknown as SubjectRow[]));
  }
  const seen = new Set<string>();
  const price = table === "job_files" ? await priceDocIds(db, [...new Set(rows.map((r) => r.id))]) : new Set<string>();
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const s = subjectOf(table, r);
    if (input.allow && !(await input.allow(r.id))) {
      out.skipped.push({ id: r.id, reason: "Soubor nemáš oprávnění otevřít." });
      continue;
    }
    // jen výkresy (archiv výkresů: 2D formát — 3D model ne)
    if (table !== "drawing_anon_adhoc" && !isAnonCandidate(s.kind, s.filename, s.mime, s.origin, s.issuer)) {
      out.skipped.push({ id: r.id, reason: "Není výkres zákazníka (objednávka, doklad, 3D model…) — neanonymizuje se." });
      out.statuses[r.id] = r.anon_status;
      continue;
    }
    if (price.has(r.id.toLowerCase())) {
      out.skipped.push({ id: r.id, reason: "Nákupní doklad — neanonymizuje se." });
      out.statuses[r.id] = r.anon_status;
      continue;
    }
    const st = r.anon_status;
    const may = input.force || st === null || st === "failed" || st === "pending" || (st === "processing" && isLockExpired(r));
    if (!may) { out.statuses[r.id] = st; continue; }
    const unsupported = isUnsupportedExt(s.filename);
    const backfill = Boolean(input.keepBackfill) && st === "pending" && (r.anon_priority ?? 0) >= BACKFILL_PRIORITY && !unsupported;
    if (backfill) {
      out.statuses[r.id] = "pending";
      out.backfill!.push(r.id);
      continue;
    }
    const { error } = await db.from(table).update({
      anon_status: unsupported ? "unsupported" : "pending", anon_priority: input.priority ?? 0, anon_attempts: 0, anon_lock_until: null,
      anon_reason: unsupported ? unsupportedHowTo(s.filename) : null,
      anon_via: input.via ?? "rucne",
    }).eq("id", r.id);
    if (error) { out.skipped.push({ id: r.id, reason: error.message }); continue; }
    out.statuses[r.id] = unsupported ? "unsupported" : "pending";
    if (!unsupported) out.queued++;
  }
  return out;
}

/**
 * „Zpracovat staré výkresy": čekající backfill (priorita ≥ 9) → priorita 5 (běží automatikou v rámci
 * denního limitu, via backfill). Volitelně jen v daných zakázkách. Vrací povýšená id.
 */
export async function promoteLegacy(db: AnonDb, opts: { jobIds?: string[]; limit?: number } = {}): Promise<{ ids: string[]; error?: string }> {
  let q = db.from("job_files").select("id").eq("anon_status", "pending").gte("anon_priority", BACKFILL_PRIORITY).eq("archived", false)
    .order("created_at", { ascending: false }).limit(Math.min(500, opts.limit ?? 200));
  if (opts.jobIds) {
    if (!opts.jobIds.length) return { ids: [] };
    q = q.in("job_id", opts.jobIds.slice(0, 200));
  }
  const { data, error: selErr } = await q;
  if (selErr) return { ids: [], error: selErr.message };
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  if (!ids.length) return { ids };
  const { error } = await db.from("job_files").update({ anon_priority: 5, anon_via: "backfill" }).in("id", ids);
  return error ? { ids: [], error: error.message } : { ids };
}

function isLockExpired(r: SubjectRow): boolean {
  const t = Date.parse(String(r.anon_lock_until ?? ""));
  return !Number.isFinite(t) || t < Date.now();
}

// ── Rozvětvení běhů ───────────────────────────────────────────

export const KICK_CONCURRENCY = 5;
export const RUN_PATH = "/api/cron/drawing-anonymize/run";

/**
 * Adresa aplikace pro interní běh (nese tajemství v hlavičce) — vždy z konfigurace (APP_URL /
 * NEXT_PUBLIC_APP_URL / VERCEL_URL), nikdy z hlaviček požadavku (Host / X-Forwarded-Host jde podvrhnout).
 * Adresa požadavku jen jako záloha pro lokální vývoj (localhost / 127.0.0.1).
 */
export function appOrigin(reqUrl?: string | null): string | null {
  for (const c of originCandidates()) {
    // na Vercelu nemá adresa localhost smysl (zkopírované .env.example) → další kandidát
    if (process.env.VERCEL && isLocalOrigin(c)) continue;
    return c;
  }
  if (reqUrl) {
    try {
      const u = new URL(reqUrl);
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return u.origin;
    } catch { /* dál */ }
  }
  return null;
}

/**
 * Kandidáti adresy v pořadí: APP_URL → NEXT_PUBLIC_APP_URL → produkční doména Vercelu (jen v produkci —
 * doménu nechrání Deployment Protection) → VERCEL_URL (adresa nasazení, bývá chráněná → 401).
 */
function originCandidates(): string[] {
  const vercelProd = process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "";
  return [process.env.APP_URL, process.env.NEXT_PUBLIC_APP_URL, vercelProd, process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : ""]
    .map((v) => (v ?? "").trim().replace(/\/+$/, ""))
    .filter((v) => /^https?:\/\/[^/]+/i.test(v));
}

function isLocalOrigin(o: string): boolean {
  try {
    const h = new URL(o).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0";
  } catch {
    return false;
  }
}

export interface KickOptions {
  origin: string | null;
  table?: AnonTable;
  ids?: string[];
  limit?: number;
  fetchImpl?: typeof fetch;
  db?: AnonDb;
  /** Jak dlouho čekat na odpověď (cílová funkce běží dál sama). */
  waitMs?: number;
  /** Ruční běh za uživatele (autor, bez denního limitu). */
  manualBy?: string | null;
}

/**
 * Tajemství interního běhu (/api/cron/drawing-anonymize/run): CRON_SECRET, a když chybí, odvozené ze
 * SUPABASE_SECRET_KEY (HMAC) — automatické zdroje (e-mail, focení, nahrání) tak nezůstanou viset ve frontě
 * ani bez CRON_SECRET. Externí plánovač (GET /api/cron/drawing-anonymize) dál potřebuje CRON_SECRET.
 */
export function internalRunSecret(): string | null {
  const cron = (process.env.CRON_SECRET ?? "").trim();
  if (cron) return cron;
  const key = (process.env.SUPABASE_SECRET_KEY ?? "").trim();
  if (!key) return null;
  return createHmac("sha256", key).update("drawing-anonymize-run/v1").digest("hex");
}

/** Ověření `Authorization: Bearer <tajemství>` interního běhu (časově konstantní porovnání). */
export function internalRunAuth(authorization: string | null | undefined): 200 | 401 | 503 {
  const secret = internalRunSecret();
  if (!secret) return 503;
  const m = /^Bearer\s+(.+)$/i.exec((authorization ?? "").trim());
  if (!m) return 401;
  const a = Buffer.from(m[1].trim()), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b) ? 200 : 401;
}

export interface RunnerStatus {
  cronSecret: boolean;
  internalKick: boolean;
  origin: string | null;
  /** Varování pro Nastavení (null = vše v pořádku). */
  warning: string | null;
  /** Adresa z konfigurace ukazuje na localhost, ale běžíme na Vercelu (zkopírované .env.example). */
  localOriginIgnored?: boolean;
}

/**
 * Pro Nastavení: konfigurace zpracování na pozadí. Zpracování samo NEZÁVISÍ na CRON_SECRET ani na adrese
 * aplikace — první soubor zpracuje přímo požadavek, který ho nahrál (after()), další se zpracují při otevření
 * zakázky. Adresa + tajemství slouží jen k rozvětvení (souběh) a záchrannému plánovači.
 */
export function anonRunnerStatus(): RunnerStatus {
  const cronSecret = Boolean((process.env.CRON_SECRET ?? "").trim());
  const internalKick = Boolean(internalRunSecret());
  const origin = appOrigin(null);
  const localOriginIgnored = Boolean(process.env.VERCEL) && originCandidates().some(isLocalOrigin);
  const parts: string[] = [];
  if (!(process.env.SUPABASE_SECRET_KEY ?? "").trim()) {
    parts.push("Chybí SUPABASE_SECRET_KEY — anonymizace výkresů vůbec neběží (doplň servisní klíč v Nastavení → Integrace).");
  } else {
    if (localOriginIgnored) parts.push("NEXT_PUBLIC_APP_URL / APP_URL ukazuje na localhost — na Vercelu nastav APP_URL na veřejnou adresu aplikace.");
    else if (!origin) parts.push("Chybí APP_URL — souběžné zpracování více výkresů je vypnuté (zpracují se postupně).");
    if (!cronSecret) parts.push("Chybí CRON_SECRET — bez záchranného plánovače: výkresy se zpracují hned po nahrání a při otevření zakázky / Poptávek, staré výkresy jen ručně.");
  }
  const warning = parts.length ? parts.join(" ") : null;
  return { cronSecret, internalKick, origin, warning, localOriginIgnored };
}

export interface KickResult {
  /** Požadavky, které cílová funkce přijala (2xx nebo běží déle než waitMs). */
  kicked: number;
  ids: string[];
  /** Požadavky, které selhaly (401 chráněné nasazení, 404, nedostupná adresa…). */
  failed?: number;
  reason?: string;
}

/** Proč interní běh nepřijal požadavek (česky, pro log a Nastavení). */
export function describeKickFailure(status: number, body: string, origin: string): string {
  const json = /^\s*[{[]/.test(body);
  if ((status === 401 || status === 403) && !json) {
    return `Adresa ${origin} je chráněná (Vercel Deployment Protection, HTTP ${status}) — nastav APP_URL na veřejnou doménu nebo zapni „Protection Bypass for Automation".`;
  }
  if (status === 401) return `Adresa ${origin} odmítla tajemství interního běhu (HTTP 401) — APP_URL nejspíš ukazuje na jiné nasazení.`;
  if (status === 404) return `Na adrese ${origin} není interní běh anonymizace (HTTP 404) — zkontroluj APP_URL.`;
  if (status === 503) return `Interní běh na ${origin} hlásí chybějící konfiguraci (HTTP 503) — zkontroluj SUPABASE_SECRET_KEY / CRON_SECRET.`;
  return `Interní běh na ${origin} vrátil HTTP ${status}.`;
}

/** Poslední selhání rozvětvení v této instanci (Nastavení). */
let lastKickProblem: { at: number; message: string } | null = null;

export function lastKickFailure(): { at: number; message: string } | null {
  return lastKickProblem;
}

/**
 * Vybere ≤ 5 kandidátů (pending podle priority) a pro každý pošle samostatný požadavek na run
 * (internalRunSecret + x-vercel-protection-bypass); čeká jen ≤ 2 s. Počítá POCTIVĚ: 401 (chráněné
 * nasazení), 404, 5xx nebo nedostupná adresa = selhání (failed), ne „rozběhnuto". Je to jen rozvětvení —
 * zpracování nesmí na kick spoléhat (routy zpracují první soubor samy v after(), viz runner.ts).
 */
export async function kick(opts: KickOptions): Promise<KickResult> {
  const secret = internalRunSecret();
  if (!secret) return { kicked: 0, ids: [], reason: "Chybí CRON_SECRET i SUPABASE_SECRET_KEY" };
  if (!opts.origin) return { kicked: 0, ids: [], reason: "Neznámá adresa aplikace" };
  const table = opts.table ?? "job_files";
  let ids = (opts.ids ?? []).slice(0, opts.limit ?? KICK_CONCURRENCY);
  if (!ids.length && opts.db) {
    ids = await runnableIds(opts.db, table, { includeBackfill: true, limit: opts.limit ?? KICK_CONCURRENCY });
  }
  if (!ids.length) return { kicked: 0, ids: [] };
  const f = opts.fetchImpl ?? fetch;
  const headers: Record<string, string> = { "content-type": "application/json", authorization: `Bearer ${secret}` };
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) headers["x-vercel-protection-bypass"] = bypass;
  const origin = opts.origin;
  const problems: string[] = [];
  const outcomes = await Promise.all(ids.map(async (id): Promise<boolean> => {
    try {
      const res = await f(`${origin}${RUN_PATH}`, { method: "POST", headers, body: JSON.stringify({ table, ids: [id], ...(opts.manualBy ? { manualBy: opts.manualBy } : {}) }), signal: AbortSignal.timeout(opts.waitMs ?? 2_000) });
      if (res.ok) return true;
      problems.push(describeKickFailure(res.status, await res.text().catch(() => ""), origin));
      return false;
    } catch (err) {
      // timeout po 2 s je v pořádku — cílová funkce běží dál
      const name = (err as { name?: string } | null)?.name;
      if (name === "TimeoutError" || name === "AbortError") return true;
      problems.push(`Adresa ${origin} je nedostupná (${err instanceof Error ? err.message.slice(0, 120) : "chyba spojení"}) — zkontroluj APP_URL.`);
      return false;
    }
  }));
  const kicked = outcomes.filter(Boolean).length;
  const failed = ids.length - kicked;
  if (failed) {
    lastKickProblem = { at: Date.now(), message: problems[0] };
    console.warn(`[anonymize] Rozvětvení selhalo (${failed}/${ids.length}): ${problems[0]}`);
  } else if (kicked) lastKickProblem = null;
  return { kicked, ids, ...(failed ? { failed, reason: problems[0] } : {}) };
}

/**
 * Šťouchnutí do fronty z kódu bez rendereru (server action, knihovny pošty): kick až po odpovědi
 * (after()), mimo požadavek Next.js hned. Jen pomocník — soubory zpracuje i otevření zakázky.
 */
export function kickInBackground(opts: Omit<KickOptions, "origin"> & { origin?: string | null }): void {
  const task = async () => {
    try {
      await kick({ ...opts, origin: opts.origin ?? appOrigin(null) });
    } catch (err) {
      console.warn(`[anonymize] Šťouchnutí do fronty selhalo: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  try {
    after(task);
  } catch {
    void task();
  }
}

/** Ověření interního běhu pro Nastavení (GET run s tajemstvím, ≤ 2,5 s; výsledek 5 min v paměti). */
let probeCache: { at: number; key: string; result: { ok: boolean; message: string | null } } | null = null;

export async function probeRunner(opts: { fetchImpl?: typeof fetch; force?: boolean } = {}): Promise<{ ok: boolean; message: string | null }> {
  const secret = internalRunSecret();
  const origin = appOrigin(null);
  if (!secret || !origin) return { ok: false, message: null };
  const key = `${origin}|${secret.slice(0, 8)}`;
  if (!opts.force && probeCache && probeCache.key === key && Date.now() - probeCache.at < 5 * 60_000) return probeCache.result;
  const headers: Record<string, string> = { authorization: `Bearer ${secret}` };
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) headers["x-vercel-protection-bypass"] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  let result: { ok: boolean; message: string | null };
  try {
    const res = await (opts.fetchImpl ?? fetch)(`${origin}${RUN_PATH}`, { method: "GET", headers, signal: AbortSignal.timeout(2_500), cache: "no-store" });
    result = res.ok ? { ok: true, message: null } : { ok: false, message: describeKickFailure(res.status, await res.text().catch(() => ""), origin) };
  } catch (err) {
    result = { ok: false, message: `Adresa ${origin} je nedostupná (${err instanceof Error ? err.message.slice(0, 120) : "chyba spojení"}) — zkontroluj APP_URL.` };
  }
  probeCache = { at: Date.now(), key, result };
  return result;
}

/** Jak dlouho smí výkres čekat, než ho Nastavení ohlásí jako zaseknutý. */
export const STUCK_AFTER_MS = 15 * 60_000;

/**
 * Stav zpracování na pozadí pro Nastavení: konfigurace + ověření interního běhu (probe) + poslední selhání
 * rozvětvení + počet zaseknutých výkresů (pending déle než 15 min, přerušený běh). warning = co je špatně
 * (česky, s radou), ok = krátké potvrzení, když je vše v pořádku.
 */
export async function anonRunnerHealth(db: AnonDb, opts: { fetchImpl?: typeof fetch } = {}): Promise<{ warning: string | null; ok: string | null; stuck: number; probeOk: boolean | null }> {
  const st = anonRunnerStatus();
  const parts: string[] = st.warning ? [st.warning] : [];
  let probeOk: boolean | null = null;
  if (st.internalKick && st.origin && (process.env.SUPABASE_SECRET_KEY ?? "").trim()) {
    const p = await probeRunner(opts);
    probeOk = p.ok;
    if (!p.ok && p.message) parts.push(`Souběžné zpracování nefunguje: ${p.message} Výkresy se přesto zpracují postupně (hned po nahrání a při otevření zakázky).`);
  }
  const last = lastKickFailure();
  if (last && probeOk !== false && Date.now() - last.at < 60 * 60_000) parts.push(`Poslední rozvětvení selhalo: ${last.message}`);
  let stuck = 0;
  try {
    const now = new Date().toISOString();
    const cut = new Date(Date.now() - STUCK_AFTER_MS).toISOString();
    const { count } = await db.from("job_files").select("id", { count: "exact", head: true }).eq("archived", false).lt("anon_priority", BACKFILL_PRIORITY)
      .or(`and(anon_status.eq.pending,created_at.lt.${cut},anon_lock_until.is.null),and(anon_status.eq.processing,anon_lock_until.lt.${now})`);
    stuck = count ?? 0;
  } catch {
    // jen informace
  }
  if (stuck) parts.push(`${stuck} ${stuck === 1 ? "výkres čeká" : stuck < 5 ? "výkresy čekají" : "výkresů čeká"} na anonymizaci déle než 15 min — otevři zakázku, nebo v Poptávkách „Anonymizovat vše, co čeká".`);
  const ok = parts.length ? null
    : `Zpracování na pozadí běží: výkres se anonymizuje hned po nahrání${probeOk ? `, souběh přes ${st.origin} ověřen` : ""}${st.cronSecret ? ", záchranný plánovač nastaven" : ""}.`;
  return { warning: parts.length ? parts.join(" ") : null, ok, stuck, probeOk };
}

/**
 * Soubory připravené ke zpracování (pending bez zámku / s prošlým zámkem, processing s prošlým zámkem =
 * přerušený běh), nejnovější první v rámci priority. Bez includeBackfill bez starých výkresů (priorita ≥ 9).
 */
export async function runnableIds(db: AnonDb, table: AnonTable, opts: {
  ids?: string[] | null; jobIds?: string[] | null; includeBackfill?: boolean; exclude?: string[]; limit?: number;
} = {}): Promise<string[]> {
  if (opts.ids && !opts.ids.length) return [];
  if (opts.jobIds && !opts.jobIds.length) return [];
  const nowIso = new Date().toISOString();
  let q = db.from(table).select("id")
    .or(`and(anon_status.eq.pending,anon_lock_until.is.null),and(anon_status.eq.pending,anon_lock_until.lt.${nowIso}),and(anon_status.eq.processing,anon_lock_until.lt.${nowIso})`);
  if (!opts.includeBackfill) q = q.lt("anon_priority", BACKFILL_PRIORITY);
  if (opts.ids?.length) q = q.in("id", opts.ids.slice(0, 200));
  if (table === "job_files") {
    q = q.eq("archived", false);
    if (opts.jobIds?.length) q = q.in("job_id", opts.jobIds.slice(0, 100));
  }
  if (opts.exclude?.length) q = q.not("id", "in", `(${opts.exclude.slice(0, 100).join(",")})`);
  const { data, error } = await q.order("anon_priority", { ascending: true }).order("created_at", { ascending: false }).limit(Math.max(1, Math.min(opts.limit ?? KICK_CONCURRENCY, 50)));
  if (error) {
    console.error(`[anonymize] Fronta (výběr): ${error.message}`);
    return [];
  }
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}


export async function loadSettings(db: AnonDb): Promise<AnonSettings> {
  const { data } = await db.from("drawing_anon_settings").select("*").eq("id", 1).maybeSingle();
  return settingsFromRow(data as Record<string, unknown> | null);
}

export async function event(db: AnonDb, s: Subject, actor: ActorContext, message: string, data: Record<string, unknown>) {
  const jobId = s.jobId;
  if (!jobId || s.table === "drawing_anon_adhoc") return;
  await logJobEvent(db as unknown as JobsDb, {
    jobId, type: "file", message, data: { ...data, fileId: s.table === "job_files" ? s.id : undefined, drawingId: s.table === "drawings" ? s.id : undefined },
    actorId: actor.id, actorKind: actor.kind, via: actor.via ?? "automaticky", agent: actor.agent ?? undefined, entity: "file", entityId: s.table === "job_files" ? s.id : undefined,
  });
}

export function label(s: Subject, drawingNumber?: string | null): string {
  return drawingNumber || s.filename;
}

export async function afterSettled(db: AnonDb, s: Subject) {
  if (s.table !== "job_files") return;
  try {
    await onAnonSettled(db, s.id);
  } catch (err) {
    console.error(`[anonymize] Fronta odeslání: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Po dokončení (done/review/failed/unsupported/skipped) → fronta odeslání (§5.5). */
export async function onAnonSettled(db: AnonDb, fileId: string): Promise<void> {
  const { flushSendQueue } = await import("./send-queue");
  await flushSendQueue(db, { fileId });
}

// ── Schválení, přeskočení ──

export async function approve(db: AnonDb, table: AnonTable, id: string, actor: ActorContext): Promise<{ ok: boolean; error?: string; status?: AnonStatus }> {
  const { data } = await db.from(table).select(SUBJECT_SELECT[table]).eq("id", id).maybeSingle();
  const row = data as unknown as SubjectRow | null;
  if (!row) return { ok: false, error: "Soubor nenalezen." };
  if (row.anon_status !== "review") return { ok: false, error: "Schválit jde jen anonymizaci ke kontrole." };
  if (!row.anon_path) return { ok: false, error: "Anonymizovaná kopie chybí — anonymizuj znovu." };
  const now = new Date().toISOString();
  const { data: upd, error } = await db.from(table).update({ anon_status: "done", anon_reason: null, anon_reviewed_at: now, anon_reviewed_by: actor.id }).eq("id", id).eq("anon_status", "review").select("id");
  if (error) return { ok: false, error: error.message };
  if (!(upd ?? []).length) return { ok: false, error: "Stav se mezitím změnil — obnov stránku." };
  const s = subjectOf(table, row);
  await event(db, s, actor, `Anonymizace výkresu ${label(s)} schválena`, { anonStatus: "done" });
  await afterSettled(db, s);
  return { ok: true, status: "done" };
}

export async function skip(db: AnonDb, table: AnonTable, id: string, actor: ActorContext, reason?: string | null): Promise<{ ok: boolean; error?: string }> {
  const { data } = await db.from(table).select(SUBJECT_SELECT[table]).eq("id", id).maybeSingle();
  const row = data as unknown as SubjectRow | null;
  if (!row) return { ok: false, error: "Soubor nenalezen." };
  if (table === "job_files") {
    const s0 = subjectOf(table, row);
    if (!isAnonCandidate(s0.kind, s0.filename, s0.mime, s0.origin, s0.issuer)) {
      return { ok: false, error: "Soubor se neanonymizuje (náš doklad nebo jiný druh) — není co přeskočit." };
    }
  }
  let who = "";
  if (actor.id) {
    const { data: p } = await db.from("profiles").select("full_name, email").eq("id", actor.id).maybeSingle();
    who = ((p as { full_name: string | null; email: string | null } | null)?.full_name ?? "").trim();
  }
  const text = (reason ?? "").trim().slice(0, 200) || `Náš výkres${who ? ` — ${who}` : ""}`;
  const { error } = await db.from(table).update({
    anon_status: "skipped", anon_reason: text, anon_at: new Date().toISOString(), anon_by: actor.id, anon_actor_kind: "user", anon_via: "rucne", anon_lock_until: null,
  }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  const s = subjectOf(table, row);
  await event(db, s, actor, `Výkres ${label(s)} se nebude anonymizovat — ${text}`, { anonStatus: "skipped" });
  await afterSettled(db, s);
  return { ok: true };
}
