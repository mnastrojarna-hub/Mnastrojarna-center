import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logJobEvent, type JobsDb } from "@/lib/jobs/events";
import { SYSTEM_ACTOR, type ActorContext } from "@/lib/supabase/actor-headers";
import { isAnonCandidate, isUnsupportedExt } from "./candidate";
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
    hasMaster: Boolean(row.anon_source_path), filename: String(row.filename ?? "vykres"), mime: str(row.mime_type), kind: "vykres",
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
}

/** Ruční / hromadné zařazení (force = i done/review/skipped). */
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
}): Promise<EnqueueResult> {
  const table = input.table ?? "job_files";
  const out: EnqueueResult = { queued: 0, statuses: {}, skipped: [] };
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
    if (table === "job_files" && !isAnonCandidate(s.kind, s.filename, s.mime, s.origin, s.issuer)) {
      out.skipped.push({ id: r.id, reason: "Není externí výkres (náš doklad nebo jiný druh)." });
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
    const { error } = await db.from(table).update({
      anon_status: unsupported ? "unsupported" : "pending", anon_priority: input.priority ?? 0, anon_attempts: 0, anon_lock_until: null,
      anon_reason: unsupported ? "Formát nelze anonymizovat — pošli dodavateli PDF, DXF nebo STEP." : null,
      anon_via: input.via ?? "rucne",
    }).eq("id", r.id);
    if (error) { out.skipped.push({ id: r.id, reason: error.message }); continue; }
    out.statuses[r.id] = unsupported ? "unsupported" : "pending";
    if (!unsupported) out.queued++;
  }
  return out;
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
  const env = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  if (env) return env.replace(/\/+$/, "");
  if (reqUrl) {
    try {
      const u = new URL(reqUrl);
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return u.origin;
    } catch { /* dál */ }
  }
  return null;
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

/** Pro Nastavení: běží zpracování na pozadí? (bez CRON_SECRET jen šťouchnutím, bez plánovače). */
export function anonRunnerStatus(): { cronSecret: boolean; internalKick: boolean; origin: string | null; warning: string | null } {
  const cronSecret = Boolean((process.env.CRON_SECRET ?? "").trim());
  const internalKick = Boolean(internalRunSecret());
  const origin = appOrigin(null);
  const warning = !internalKick
    ? "Chybí SUPABASE_SECRET_KEY — anonymizace na pozadí neběží."
    : !cronSecret
      ? "Chybí CRON_SECRET — anonymizace běží jen po nahrání / ručně, bez záchranného plánovače (soubory po chybě zůstanou ve frontě)."
      : !origin ? "Chybí APP_URL — automatické šťouchnutí do fronty nezná adresu aplikace." : null;
  return { cronSecret, internalKick, origin, warning };
}

/**
 * Vybere ≤ 5 kandidátů (pending podle priority) a pro každý pošle samostatný požadavek na run
 * (internalRunSecret + x-vercel-protection-bypass); čeká jen ≤ 2 s. Bez tajemství / originu vrátí 0
 * (route pak zpracuje sám v after(); server action nikdy nevykresluje).
 */
export async function kick(opts: KickOptions): Promise<{ kicked: number; ids: string[]; reason?: string }> {
  const secret = internalRunSecret();
  if (!secret) return { kicked: 0, ids: [], reason: "Chybí CRON_SECRET i SUPABASE_SECRET_KEY" };
  if (!opts.origin) return { kicked: 0, ids: [], reason: "Neznámá adresa aplikace" };
  const table = opts.table ?? "job_files";
  let ids = (opts.ids ?? []).slice(0, opts.limit ?? KICK_CONCURRENCY);
  if (!ids.length && opts.db) {
    const nowIso = new Date().toISOString();
    const { data } = await opts.db.from(table).select("id, anon_status, anon_lock_until")
      .or(`and(anon_status.eq.pending,anon_lock_until.is.null),and(anon_status.eq.pending,anon_lock_until.lt.${nowIso}),and(anon_status.eq.processing,anon_lock_until.lt.${nowIso})`)
      .order("anon_priority", { ascending: true }).order("created_at", { ascending: false })
      .limit(opts.limit ?? KICK_CONCURRENCY);
    ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  }
  if (!ids.length) return { kicked: 0, ids: [] };
  const f = opts.fetchImpl ?? fetch;
  const headers: Record<string, string> = { "content-type": "application/json", authorization: `Bearer ${secret}` };
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) headers["x-vercel-protection-bypass"] = bypass;
  await Promise.all(ids.map(async (id) => {
    try {
      await f(`${opts.origin}${RUN_PATH}`, { method: "POST", headers, body: JSON.stringify({ table, ids: [id], ...(opts.manualBy ? { manualBy: opts.manualBy } : {}) }), signal: AbortSignal.timeout(opts.waitMs ?? 2_000) });
    } catch {
      // timeout po 2 s je v pořádku — cílová funkce běží dál
    }
  }));
  return { kicked: ids.length, ids };
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
