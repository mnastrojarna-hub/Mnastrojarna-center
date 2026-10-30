import "server-only";
import type { JobsDb } from "@/lib/jobs/events";
import type {
  AiFailure, AiUsage, BatchDocExtract, BatchDocType, BatchFile, BatchPage, BatchSort, BatchWarning, DocExtractStatus,
} from "@/lib/jobs/capture-batch-types";
import type { CaptureDocKind, DocIssuer } from "@/lib/jobs/capture-types";
import type { PartyMatchView } from "@/lib/jobs/capture-review";
import { CAPTURE_BUCKET, captureHiresPath } from "@/lib/jobs/capture-review";
import { isUuid } from "@/lib/jobs/mapping";

/**
 * Relace dávkového focení v DB (servisní klíč, RLS bez politik = z prohlížeče nečitelné):
 * capture_sessions (soubory, stránky, návrh roztřídění), capture_doc_extracts (vytěžení per doklad,
 * idempotentně podle stránek a druhu), capture_apply_steps (deník ukládání) a zámek ukládání.
 */

export const SESSION_OPEN_TTL_MS = 24 * 3600 * 1000;
export const SESSION_PARTIAL_TTL_MS = 7 * 24 * 3600 * 1000;
/** Rozečtené vytěžení mladší než tohle se nepouští znovu (běží v jiném požadavku). */
export const EXTRACT_READING_TTL_MS = 280_000;
export const LOCK_TTL_S = 330;

export interface BatchSession {
  v: 2;
  captureId: string;
  userId: string;
  createdAt: string;
  files: BatchFile[];
  pages: BatchPage[];
  aiUsed: boolean;
  reason: string | null;
  aiFailure: AiFailure | null;
  /** Návrh AI (učení, „vrátit návrh AI"). */
  aiSort: BatchSort;
  sortWarnings: BatchWarning[];
  fixedJobId: string | null;
  expectedKind: CaptureDocKind | null;
  classifyUsage: AiUsage | null;
  /** Poslední roztřídění odeslané z kontroly (obnova, učení). */
  lastSort?: BatchSort | null;
  /** Poslední přiřazení / cíle skupin z kontroly (obnova). */
  lastAssign?: Record<string, string> | null;
  lastTargets?: Record<string, string> | null;
  /** Číslo dílu z hlavičky STEP podle fileId. */
  headNumbers?: Record<string, string>;
  /** Roztřídění AI selhalo / neběželo → výchozí odhad. */
  sortSource?: "ai" | "default";
  /** Poslední ukládaný stav (skupiny a doklady) — pro přiložení neuložených dokladů. */
  lastApply?: { groups: { key: string; docIds: string[] }[]; docs: { id: string; type: BatchDocType; pageIds: string[]; title: string; excluded?: boolean }[] } | null;
}

export type SessionStatus = "open" | "partial" | "done" | "discarded";

/** Vytěžení dokladu uložené v DB (server nikdy nevěří datům AI z prohlížeče). */
export interface StoredExtract {
  extract: BatchDocExtract;
  customerMatch: PartyMatchView | null;
  supplierMatch: PartyMatchView | null;
  docKind: CaptureDocKind | null;
  issuer: DocIssuer | null;
  /** AI skutečně četla (ne ruční / deterministické). */
  aiUsed: boolean;
  /** Proč bez AI (nečitelné strany…). */
  note: string | null;
  /** Usage do souhrnu (bez cen). */
  truncated?: boolean;
  /**
   * Faktura dodavatele přečtená čtečkou faktur (SupplierInvoiceExtract) — při uložení dávky z ní vznikne
   * faktura v Fakturách dodavatelů bez dalšího volání AI.
   */
  supplierInvoice?: unknown;
}

export interface ExtractRow {
  docId: string;
  pagesKey: string;
  docType: BatchDocType;
  status: DocExtractStatus;
  data: StoredExtract | null;
  error: string | null;
  usage: AiUsage | null;
  startedAt: string;
  updatedAt: string;
}

function rowToExtract(r: Record<string, unknown>): ExtractRow {
  return {
    docId: r.doc_id as string,
    pagesKey: r.pages_key as string,
    docType: r.doc_type as BatchDocType,
    status: r.status as DocExtractStatus,
    data: (r.data as StoredExtract | null) ?? null,
    error: (r.error as string | null) ?? null,
    usage: (r.usage as AiUsage | null) ?? null,
    startedAt: r.started_at as string,
    updatedAt: r.updated_at as string,
  };
}

// ── Relace ──────────────────────────────────────────────────
export async function createSession(db: JobsDb, s: BatchSession): Promise<string | null> {
  const { error } = await db.from("capture_sessions").insert({
    id: s.captureId,
    user_id: s.userId,
    status: "open",
    data: s as unknown as Record<string, unknown>,
    expires_at: new Date(Date.now() + SESSION_OPEN_TTL_MS).toISOString(),
  } as never);
  return error ? error.message : null;
}

/** Relace vlastníka (jinak null — cizí, neexistující, prošlá). */
export async function readSession(
  db: JobsDb,
  userId: string,
  captureId: string,
  opts: { allowDone?: boolean } = {},
): Promise<{ session: BatchSession; status: SessionStatus } | null> {
  if (!isUuid(captureId) || !isUuid(userId)) return null;
  const { data } = await db
    .from("capture_sessions")
    .select("id, user_id, status, data, expires_at")
    .eq("id", captureId.toLowerCase())
    .eq("user_id", userId.toLowerCase())
    .maybeSingle();
  const row = data as { status: SessionStatus; data: BatchSession; expires_at: string } | null;
  if (!row || !row.data || row.data.v !== 2) return null;
  if (row.status === "discarded") return null;
  if (row.status === "done" && !opts.allowDone) return null;
  if (row.status === "open" && Date.parse(row.expires_at) < Date.now()) return null;
  return { session: row.data, status: row.status };
}

export async function updateSession(db: JobsDb, captureId: string, s: BatchSession): Promise<void> {
  await db.from("capture_sessions").update({ data: s as unknown as Record<string, unknown>, updated_at: new Date().toISOString() } as never).eq("id", captureId);
}

export async function setSessionStatus(db: JobsDb, captureId: string, status: SessionStatus): Promise<void> {
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (status === "partial") patch.expires_at = new Date(Date.now() + SESSION_PARTIAL_TTL_MS).toISOString();
  if (status === "done" || status === "discarded") patch.expires_at = new Date(Date.now() + 3600 * 1000).toISOString();
  await db.from("capture_sessions").update(patch as never).eq("id", captureId);
}

export async function deleteSessionRow(db: JobsDb, captureId: string): Promise<void> {
  await db.from("capture_sessions").delete().eq("id", captureId);
}

/** Všechny cesty úložiště relace (stránky, náhledy roztřídění, mastery fotek v plném rozlišení). */
export function sessionPaths(s: Pick<BatchSession, "files">): string[] {
  const out: string[] = [];
  for (const f of s.files ?? []) {
    if (f.path) out.push(f.path);
    if (f.sortPath) out.push(f.sortPath);
    // master (capture/<uživatel>/<uuid>.hires) — odvozený z cesty stránky, nemusí existovat
    const hires = f.path ? captureHiresPath(f.path) : null;
    if (hires) out.push(hires);
  }
  return [...new Set(out)];
}

export async function removeStoragePaths(db: JobsDb, paths: string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    if (!chunk.length) continue;
    try {
      await db.storage.from(CAPTURE_BUCKET).remove(chunk);
    } catch {
      // úklid je best-effort
    }
  }
}

// ── Zámek ukládání ──────────────────────────────────────────
export async function tryLock(db: JobsDb, captureId: string, userId: string, token: string): Promise<boolean> {
  const { data, error } = await db.rpc("capture_try_lock" as never, {
    p_capture: captureId, p_user: userId, p_token: token, p_ttl_seconds: LOCK_TTL_S,
  } as never);
  if (error) return false;
  return data === true;
}

export async function unlock(db: JobsDb, captureId: string, token: string): Promise<void> {
  try {
    await db.rpc("capture_unlock" as never, { p_capture: captureId, p_token: token } as never);
  } catch {
    // zámek vyprší sám
  }
}

// ── Deník ukládání ──────────────────────────────────────────
export interface StepRow { status: "started" | "done" | "failed"; result: Record<string, unknown> | null }

export async function readSteps(db: JobsDb, captureId: string): Promise<Map<string, StepRow>> {
  const { data } = await db.from("capture_apply_steps").select("step, status, result").eq("capture_id", captureId);
  const out = new Map<string, StepRow>();
  for (const r of (data ?? []) as { step: string; status: StepRow["status"]; result: Record<string, unknown> | null }[]) {
    out.set(r.step, { status: r.status, result: r.result });
  }
  return out;
}

export async function writeStep(
  db: JobsDb,
  captureId: string,
  step: string,
  status: StepRow["status"],
  result: Record<string, unknown> | null = null,
): Promise<void> {
  await db.from("capture_apply_steps").upsert({
    capture_id: captureId, step, status, result, updated_at: new Date().toISOString(),
  } as never, { onConflict: "capture_id,step" });
}

// ── Vytěžení ────────────────────────────────────────────────
export async function listExtracts(db: JobsDb, captureId: string): Promise<ExtractRow[]> {
  const { data } = await db.from("capture_doc_extracts").select("*").eq("capture_id", captureId);
  return ((data ?? []) as Record<string, unknown>[]).map(rowToExtract);
}

export async function getExtract(db: JobsDb, captureId: string, docId: string, pagesKey: string, docType: BatchDocType): Promise<ExtractRow | null> {
  const { data } = await db
    .from("capture_doc_extracts")
    .select("*")
    .eq("capture_id", captureId)
    .eq("doc_id", docId)
    .eq("pages_key", pagesKey)
    .eq("doc_type", docType)
    .maybeSingle();
  return data ? rowToExtract(data as Record<string, unknown>) : null;
}

/** Vytěžení podle stránek a druhu (i z jiného id dokladu — stejné strany = stejný výsledek). */
export function findExtract(rows: ExtractRow[], docId: string, pagesKey: string, docType: BatchDocType): ExtractRow | null {
  return rows.find((r) => r.docId === docId && r.pagesKey === pagesKey && r.docType === docType)
    ?? rows.find((r) => r.pagesKey === pagesKey && r.docType === docType && (r.status === "ready" || r.status === "manual"))
    ?? null;
}

export async function putExtract(
  db: JobsDb,
  captureId: string,
  row: { docId: string; pagesKey: string; docType: BatchDocType; status: DocExtractStatus; data?: StoredExtract | null; error?: string | null; usage?: AiUsage | null; restart?: boolean },
): Promise<void> {
  const now = new Date().toISOString();
  const rec: Record<string, unknown> = {
    capture_id: captureId,
    doc_id: row.docId,
    pages_key: row.pagesKey,
    doc_type: row.docType,
    status: row.status,
    data: row.data ?? null,
    error: row.error ?? null,
    usage: row.usage ?? null,
    updated_at: now,
  };
  if (row.restart) rec.started_at = now;
  await db.from("capture_doc_extracts").upsert(rec as never, { onConflict: "capture_id,doc_id,pages_key,doc_type" });
}

// ── Úklid ───────────────────────────────────────────────────
/** Částečně uložená dávka, kterou nejde přiložit (skupina bez zakázky), se drží nejdéle tak dlouho. */
export const SESSION_PARTIAL_MAX_AGE_MS = 30 * 24 * 3600 * 1000;

/**
 * Prošlé relace uživatele: open → smazat soubory a řádek; partial → attach (přiložit nedokončené
 * doklady k zakázce) a smazat, jen když se přiložilo vše — jinak relaci prodloužit (další pokus,
 * „Pokračovat"), nejdéle 30 dní; done / discarded starší než hodina → smazat řádek. Best-effort.
 */
export async function cleanupStaleBatches(
  db: JobsDb,
  userId: string,
  attach: (s: BatchSession) => Promise<boolean>,
): Promise<void> {
  try {
    const { data } = await db
      .from("capture_sessions")
      .select("id, status, data, expires_at")
      .eq("user_id", userId)
      .lt("expires_at", new Date().toISOString())
      .limit(20);
    for (const r of (data ?? []) as { id: string; status: SessionStatus; data: BatchSession }[]) {
      if (r.status === "partial") {
        let all = false;
        try { all = await attach(r.data); } catch { all = false; }
        const tooOld = !(Date.now() - Date.parse(r.data?.createdAt ?? "") <= SESSION_PARTIAL_MAX_AGE_MS);
        if (!all && !tooOld) {
          await setSessionStatus(db, r.id, "partial");
          continue;
        }
      }
      if (r.status === "open" || r.status === "partial") await removeStoragePaths(db, sessionPaths(r.data));
      await deleteSessionRow(db, r.id);
    }
  } catch {
    // úklid nesmí shodit focení
  }
}

/** Cesty úložiště otevřených a částečně uložených dávek uživatele (úklid starého toku je nesmí smazat). */
export async function liveSessionPaths(db: JobsDb, userId: string): Promise<Set<string>> {
  const out = new Set<string>();
  const { data, error } = await db
    .from("capture_sessions")
    .select("data")
    .eq("user_id", userId.toLowerCase())
    .in("status", ["open", "partial"])
    .limit(200);
  if (error) throw new Error(error.message);
  for (const r of (data ?? []) as { data: BatchSession }[]) for (const p of sessionPaths(r.data ?? { files: [] })) out.add(p);
  return out;
}
