import "server-only";
import { revalidatePath } from "next/cache";
import { createOperatorClient, hasServiceKey, isSupabaseConfigured } from "@/lib/supabase/server";
import { checkFeature, getAccess, type Access } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/data/current-user";
import { getJob, getJobFormOptions, getMatchingCandidates } from "@/lib/data/jobs";
import { createJob } from "@/app/actions/jobs";
import { registerJobFileCore } from "@/lib/jobs/job-files-store";
import { recordCorrection } from "@/app/actions/corrections";
import { getModuleMode } from "@/lib/automation";
import { isDocumentReaderConfigured, readBusinessDocument, type ReadDocumentFile } from "@/lib/ai/document-reader";
import { aiFailureMessage, routeDeadline } from "@/lib/ai/ai-call";
import { findOrCreateSupplierByParty, loadSupplierCandidates } from "@/lib/jobs/purchasing-store";
import { analyzeBatch, discardBatch } from "@/lib/jobs/capture-batch-service";
import { liveSessionPaths } from "@/lib/jobs/capture-store";
import { recordTrainingExample } from "@/lib/jobs/training";
import { logJobEvent, type JobsDb } from "@/lib/jobs/events";
import { findOrCreateCustomer } from "@/lib/jobs/customers";
import { isSupplierSideDoc, matchCustomer, matchJob, matchParty } from "@/lib/jobs/matching";
import { emptyExtracted, normalizeExtracted } from "@/lib/jobs/extracted-normalize";
import { JOB_FILE_MAX_BYTES } from "@/lib/jobs/file-kinds";
import {
  cleanDate, cleanNumber, cleanText, computeItemTotals, isUuid, jobFilePath, jobInputToRow, jobItemToRow, jobMasterPath, stageEventMessage,
  todayIso, translateDbError, validateItems, validateJobInput,
} from "@/lib/jobs/mapping";
import { recordCapturedDeliveryNote } from "@/lib/jobs/delivery-notes-db";
import { setInvoiceInfoCore } from "@/lib/jobs/production-store";
import { isJobStage } from "@/lib/jobs/stages";
import { userActor, withChangeNote } from "@/lib/supabase/actor-headers";
import { docNumbersEqual } from "@/lib/jobs/matching";
import { findPurchaseOrderByNumber } from "@/lib/jobs/purchasing-store";
import { resolveMergeTarget } from "@/lib/jobs/job-merge-store";
import {
  autoCaptureCtx, captureHandoffActor, captureProductionHandoff, captureStageGuard, checkPhotoOrderMismatch, confirmOrderByPhoto, markQuoteSentByPhoto, photoOrderRevision,
  proposeFromCapture, receiveSupplierDlByPhoto, recordPhotoDelivery, registerPhotoOrderRevision,
} from "@/lib/jobs/capture-flow";
import { issuerKey, looksLikeCancellation, type OrderChange } from "@/lib/jobs/capture-flow-rules";
import { singleExistingTarget, singleNewTarget, singleOrderDeadline, type SingleOrderDeadline } from "@/lib/jobs/capture-single-deadline";
import { jobQuoteTerms } from "@/lib/jobs/job-quote-terms";
import type { QuoteTerms } from "@/lib/jobs/order-deadline";
import { createSupplierInvoiceFromFile, type InvoiceFileInput } from "@/lib/supplier-invoices/service";
import { invoiceFromBusinessDoc } from "@/lib/supplier-invoices/extract";
import { THANKS_TEXT } from "@/lib/supplier-invoices/types";
import { supplierInvoicePerms } from "@/lib/supplier-invoices/access";
import { detectRoleEmails } from "@/lib/contacts/role-detect";
import { ensureContactPerson, ownAddressFilter, rememberRoleEmails } from "@/lib/contacts/server";
import type {
  CaptureDocKind, CaptureResult, CustomerMatchCandidate, ExtractedBusinessDoc, ExtractedItem, ExtractedParty,
} from "@/lib/jobs/capture-types";
import type { ActionResult, JobDetail, JobItem } from "@/lib/jobs/types";
import { pairDocLines } from "@/lib/jobs/item-pairing";
import { pairedItemUpdate } from "@/lib/jobs/apply-extraction";
import type { JobStage } from "@/lib/supabase/database.types";
import {
  CAPTURE_BATCH_MAX_FILES, CAPTURE_BUCKET, CAPTURE_MAX_PAGES, CAPTURE_TTL_MS, REVIEW_FIELD_KEYS, REVIEW_FIELDS,
  canAutoApply, captureEventMessage, captureFolder, captureHiresPath, capturePagePath,
  captureSessionPath, captureSortPath, chipByKey, chipFor, defaultCustomerChoice, defaultSupplierChoice, documentNumberFor,
  initialReviewState, isAiReadableMime, isAiValue, isBatchUploadable, isCaptureDocKind, isCaptureHiresPath, isCapturePagePath, isCaptureSortPath,
  isFieldLocked,
  openPairQuestions, reviewChanges, reviewItemsToInputs, reviewMergePatches, reviewToFinalDoc, reviewToJobInput, sanitizeReviewState,
  sniffDocumentMime, updateToMerge,
  type AnalyzeCaptureResponse, type CaptureFileRef, type CapturePreview, type CaptureUploadPrep, type PartyMatchView, type ReviewFieldKey,
  type ReviewModel, type ReviewState, type ReviewTarget,
} from "@/lib/jobs/capture-review";
import { masterUploadAllowed, moveMaster } from "@/lib/anonymize/master";

/**
 * „📷 Vyfotit doklad" — serverová orchestrace:
 *  1) prepareCaptureUpload → podepsaná URL, prohlížeč nahraje stránky do capture/<uživatel>/…
 *  2) analyzeCapture → AI přečte doklad (je-li povoleno), spáruje zákazníka a zakázku,
 *     postaví kontrolní formulář; výsledek AI se uloží vedle stránek (<captureId>.json),
 *     aby se mu při ukládání nemuselo věřit z prohlížeče,
 *  3) applyCapture → zapíše zkontrolovaný formulář do zakázky, přesune stránky k zakázce,
 *     zapíše jednu událost do historie a uloží, co člověk opravil (AI se učí).
 * Data jdou servisním klíčem → oprávnění hlídá každá funkce sama.
 */

export type { CaptureFileRef };

export interface AnalyzeCaptureInput {
  files: CaptureFileRef[];
  /** Nahrává se u konkrétní zakázky (cíl je pevný). */
  jobId?: string | null;
  expectedKind?: CaptureDocKind | null;
}

/** Rozpracovaný doklad uložený vedle stránek (capture/<uživatel>/<captureId>.json). */
interface CaptureSession {
  v: 1;
  captureId: string;
  userId: string;
  createdAt: string;
  files: CaptureFileRef[];
  aiUsed: boolean;
  doc: ExtractedBusinessDoc;
  fixedJobId: string | null;
  customerMatch: PartyMatchView | null;
  supplierMatch: PartyMatchView | null;
  /** Spárované zakázky (důvod do výsledku „podle čísla nabídky…"). */
  matches: { jobId: string; reason: string; score: number }[];
}

export interface Ctx {
  db: JobsDb;
  user: CurrentUser;
  access: Access;
  margins: boolean;
}

type Row = Record<string, unknown>;

const AI_NOT_ALLOWED = "Nemáš povolené AI čtení dokladů — vyplň údaje ručně podle fotky. AI se z tvého vyplnění učí.";
const AI_DISABLED = "AI je vypnuté v Nastavení — vyplň údaje ručně podle fotky. AI se z tvého vyplnění učí.";
const AI_MISSING = "AI není nastavené (chybí Claude API klíč) — vyplň údaje ručně podle fotky. AI se z tvého vyplnění učí.";
export const SESSION_GONE = "Doklad už není k dispozici (vypršel nebo už je uložený) — vyfoť ho prosím znovu.";

/** Claude API: obrázek max. 5 MB, celý požadavek do ~32 MB (base64 = +33 %). */
const AI_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const AI_MAX_TOTAL_BYTES = 22 * 1024 * 1024;
const PREVIEW_TTL_S = 3600;

export async function begin(): Promise<Ctx | { error: string }> {
  if (!isSupabaseConfigured()) return { error: "Supabase není nakonfigurováno." };
  const res = await checkFeature("orders");
  if ("error" in res) return { error: res.error };
  const access = await getAccess();
  // autor změn = účet, který fotil (via foto); plná automatika přepne na ✨ AI za tento účet (autoCaptureCtx)
  const db = await createOperatorClient({ actor: userActor(res.user, "foto") });
  return { db, user: res.user, access, margins: access.can("margins") };
}

export function message(err: unknown): string {
  if (typeof err === "string") return translateDbError(err);
  return err instanceof Error ? translateDbError(err.message) : "Neočekávaná chyba.";
}

export function fail(err: unknown): { ok: false; error: string } {
  return { ok: false, error: message(err) };
}

export function failResult(err: unknown, aiUsed = false): CaptureResult {
  return { ok: false, error: message(err), created: false, aiUsed, filled: [] };
}

function bucket(db: JobsDb) {
  return db.storage.from(CAPTURE_BUCKET);
}

/** Smí uživatel nechat doklad přečíst AI? (+ proč ne) */
export async function aiAvailability(access: Access): Promise<{ available: boolean; reason: string | null }> {
  if (access.can("ai_capture") && (await isDocumentReaderConfigured())) return { available: true, reason: null };
  // E2E bez API klíče: testovací AI_FAKE_CAPTURE pro super admina
  if (process.env.AI_FAKE_CAPTURE && can(access.user, "ai_capture", { ...access.ctx, aiEnabled: true, aiConfigured: true })) return { available: true, reason: null };
  const permitted = can(access.user, "ai_capture", { ...access.ctx, aiEnabled: true, aiConfigured: true });
  if (!permitted) return { available: false, reason: AI_NOT_ALLOWED };
  if (!access.ctx.aiEnabled) return { available: false, reason: AI_DISABLED };
  return { available: false, reason: AI_MISSING };
}

// ── Soubory ─────────────────────────────────────────────────
const IMAGE_EXT = /\.(pdf|jpe?g|png|webp|gif|heic|heif)$/i;

export function cleanFileRefs(userId: string, raw: unknown, max: number = CAPTURE_MAX_PAGES): CaptureFileRef[] | string {
  if (!Array.isArray(raw) || raw.length === 0) return "Vyfoť nebo vyber aspoň jednu stránku dokladu.";
  if (raw.length > max) {
    return max === CAPTURE_MAX_PAGES ? `Doklad může mít nejvýš ${CAPTURE_MAX_PAGES} stránek.` : `Najednou jde nahrát nejvýš ${max} souborů.`;
  }
  const out: CaptureFileRef[] = [];
  for (const r of raw) {
    const o = r && typeof r === "object" ? (r as Record<string, unknown>) : {};
    if (!isCapturePagePath(userId, o.path)) return "Neplatná cesta souboru.";
    if (out.some((f) => f.path === o.path)) continue;
    const filename = cleanText(o.filename, 255) ?? o.path.split("/").pop() ?? "doklad";
    const mimeType = (cleanText(o.mimeType, 200) ?? "").toLowerCase();
    const size = cleanNumber(o.size) ?? 0;
    if (size < 0 || size > JOB_FILE_MAX_BYTES) return "Neplatná velikost souboru.";
    const sortPath = o.sortPath === undefined || o.sortPath === null || o.sortPath === "" ? null : o.sortPath;
    if (sortPath !== null && !isCaptureSortPath(userId, sortPath)) return "Neplatná cesta náhledu.";
    out.push({ path: o.path, filename, mimeType, size: Math.round(size), ...(sortPath ? { sortPath } : {}) });
  }
  return out;
}

/**
 * Úklid zapomenutých dokladů uživatele (starší než 24 h). Soubory otevřených a částečně uložených
 * dávek (relace v DB platí až 7 dní) se nemažou. Best-effort.
 */
async function cleanupStale(db: JobsDb, userId: string): Promise<void> {
  try {
    const folder = captureFolder(userId);
    const { data } = await bucket(db).list(folder, { limit: 100, sortBy: { column: "created_at", order: "asc" } });
    const cutoff = Date.now() - CAPTURE_TTL_MS;
    const candidates = ((data ?? []) as { name: string; created_at?: string | null }[])
      .filter((f) => f.name && f.created_at && Date.parse(f.created_at) < cutoff)
      .map((f) => `${folder}/${f.name}`);
    if (!candidates.length) return;
    // dávky: chyba čtení relací = raději nic nemazat
    const live = await liveSessionPaths(db, userId);
    const old = candidates.filter((p) => !live.has(p));
    if (old.length) await bucket(db).remove(old);
  } catch {
    // úklid nesmí shodit nahrávání
  }
}

export async function signedPreviews(db: JobsDb, files: CaptureFileRef[]): Promise<CapturePreview[]> {
  let urls: (string | null)[] = files.map(() => null);
  try {
    const { data } = await bucket(db).createSignedUrls(files.map((f) => f.path), PREVIEW_TTL_S);
    const list = (data ?? []) as { path: string | null; signedUrl: string | null }[];
    urls = files.map((f) => list.find((x) => x.path === f.path)?.signedUrl ?? null);
  } catch {
    // náhled je jen pohodlí — klient má i místní náhled
  }
  return files.map((f, i) => ({ path: f.path, filename: f.filename, mimeType: f.mimeType, size: f.size, url: urls[i] }));
}

/** Stránky pro AI: skutečný formát podle obsahu, jen čitelné formáty a v limitech API. */
async function loadAiFiles(db: JobsDb, files: CaptureFileRef[]): Promise<{ files: ReadDocumentFile[]; skipped: string[] }> {
  const out: ReadDocumentFile[] = [];
  const skipped: string[] = [];
  let total = 0;
  for (const f of files) {
    const { data, error } = await bucket(db).download(f.path);
    if (error || !data) throw new Error(`Stránku ${f.filename} se nepodařilo načíst z úložiště.`);
    const buf = Buffer.from(await (data as Blob).arrayBuffer());
    const mime = sniffDocumentMime(buf) ?? (isAiReadableMime(f.mimeType) ? f.mimeType : null);
    if (!mime || (mime.startsWith("image/") && buf.length > AI_MAX_IMAGE_BYTES)) {
      skipped.push(f.filename);
      continue;
    }
    total += buf.length;
    if (total > AI_MAX_TOTAL_BYTES) throw new Error("Doklad je pro AI příliš velký — nahraj méně stránek nebo menší fotky.");
    out.push({ mediaType: mime, dataBase64: buf.toString("base64") });
  }
  return { files: out, skipped };
}

// ── Relace dokladu ──────────────────────────────────────────
async function writeSession(db: JobsDb, s: CaptureSession): Promise<string | null> {
  const body = Buffer.from(JSON.stringify(s), "utf8");
  const { error } = await bucket(db).upload(captureSessionPath(s.userId, s.captureId), body, {
    contentType: "application/json",
    upsert: true,
  });
  return error ? (error.message as string) : null;
}

async function readSession(db: JobsDb, userId: string, captureId: string): Promise<CaptureSession | null> {
  if (!isUuid(captureId)) return null;
  try {
    const { data, error } = await bucket(db).download(captureSessionPath(userId, captureId));
    if (error || !data) return null;
    const s = JSON.parse(await (data as Blob).text()) as CaptureSession;
    if (!s || s.v !== 1 || s.userId !== userId.toLowerCase() || s.captureId !== captureId.toLowerCase()) return null;
    if (Date.now() - Date.parse(s.createdAt) > CAPTURE_TTL_MS) return null;
    const files = cleanFileRefs(userId, s.files);
    if (typeof files === "string") return null;
    return {
      ...s,
      files,
      doc: normalizeExtracted(s.doc),
      fixedJobId: isUuid(s.fixedJobId) ? s.fixedJobId : null,
      matches: Array.isArray(s.matches) ? s.matches.filter((m) => m && isUuid(m.jobId)) : [],
    };
  } catch {
    return null;
  }
}

// ── 1) Nahrání stránky ──────────────────────────────────────
export async function prepareCaptureUpload(input: {
  filename: string;
  size: number;
  mimeType?: string;
  /** Fotka v dávce: i podepsaná URL pro náhled roztřídění (1280 px). */
  sortPreview?: boolean;
  /** Fotka: i podepsaná URL pro master v plném rozlišení (originál z fotoaparátu → anonymizace výkresu). */
  master?: { size: number; mimeType: string } | null;
}): Promise<ActionResult<CaptureUploadPrep>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  const filename = cleanText(input?.filename, 255);
  if (!filename) return fail("Chybí název souboru.");
  const size = cleanNumber(input.size);
  if (size === null || size <= 0) return fail("Soubor je prázdný.");
  if (!isBatchUploadable(filename, size)) return fail("Soubor je větší než 50 MB.");
  try {
    await cleanupStale(c.db, c.user.id);
    const path = capturePagePath(c.user.id, crypto.randomUUID(), filename);
    const { data, error } = await bucket(c.db).createSignedUploadUrl(path);
    if (error || !data?.token) return fail(error?.message ?? "Nahrání se nepodařilo připravit.");
    const out: CaptureUploadPrep = {
      path: (data.path as string | undefined) ?? path, token: data.token as string, bucket: CAPTURE_BUCKET,
    };
    const hires = input.master ? captureHiresPath(out.path) : null;
    if (hires && (await masterUploadAllowed(c.db, input.master?.mimeType, cleanNumber(input.master?.size)))) {
      // master je jen pomůcka anonymizace — bez URL se nahraje jen zmenšená fotka
      const m = await bucket(c.db).createSignedUploadUrl(hires);
      if (!m.error && m.data?.token) {
        out.masterPath = (m.data.path as string | undefined) ?? hires;
        out.masterToken = m.data.token as string;
      }
    }
    const mime = (cleanText(input.mimeType, 200) ?? "").toLowerCase();
    if (input.sortPreview === true && (mime.startsWith("image/") || IMAGE_EXT.test(filename))) {
      const sortPath = captureSortPath(c.user.id, out.path);
      const sort = await bucket(c.db).createSignedUploadUrl(sortPath);
      if (!sort.error && sort.data?.token) {
        out.sortPath = (sort.data.path as string | undefined) ?? sortPath;
        out.sortToken = sort.data.token as string;
      }
    }
    return { ok: true, ...out };
  } catch (err) {
    return fail(err);
  }
}

/** Zahodit rozpracovaný doklad (stránky + relaci). */
export async function discardCapture(input: { captureId?: string | null; paths?: string[] }): Promise<ActionResult> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  try {
    const paths = (Array.isArray(input?.paths) ? input.paths : [])
      .filter((p) => isCapturePagePath(c.user.id, p) || isCaptureSortPath(c.user.id, p) || isCaptureHiresPath(c.user.id, p));
    // odebraná stránka dávky: i její náhled roztřídění a master (cesty jsou deterministické)
    for (const p of [...paths]) {
      if (!isCapturePagePath(c.user.id, p)) continue;
      const sp = captureSortPath(c.user.id, p);
      if (isCaptureSortPath(c.user.id, sp) && !paths.includes(sp) && !sp.includes("00000000-0000-0000-0000-000000000000")) paths.push(sp);
      const hp = captureHiresPath(p);
      if (hp && isCaptureHiresPath(c.user.id, hp) && !paths.includes(hp)) paths.push(hp);
    }
    let session: CaptureSession | null = null;
    if (input?.captureId && isUuid(input.captureId)) {
      // dávka (relace v DB) má vlastní zahození
      if (hasServiceKey()) {
        const batch = await discardBatch(c, input.captureId, paths);
        if (batch) return batch;
      }
      session = await readSession(c.db, c.user.id, input.captureId);
      paths.push(captureSessionPath(c.user.id, input.captureId));
      for (const f of session?.files ?? []) {
        if (!paths.includes(f.path)) paths.push(f.path);
        if (f.sortPath && !paths.includes(f.sortPath)) paths.push(f.sortPath);
        const hp = captureHiresPath(f.path);
        if (hp && !paths.includes(hp)) paths.push(hp);
      }
    }
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await bucket(c.db).remove(paths.slice(i, i + 100));
      if (error) return fail(error.message);
    }
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// ── 2) Čtení a návrh ────────────────────────────────────────
/** Dodavatelé jako kandidáti párování. */
export async function loadSuppliers(db: JobsDb): Promise<CustomerMatchCandidate[]> {
  return loadSupplierCandidates(db);
}

const MONEY_RE = /\d[\d\s.,]*\s*(?:Kč|CZK|EUR|€|USD|\$|,-)/gi;

/** Bez práva na marže nesmí ze shrnutí dodavatelského dokladu prosáknout nákupní ceny. */
function redactPrices(text: string): string {
  return text.replace(MONEY_RE, "…");
}

/**
 * Objednávka zákazníka bez reálného termínu → termín z naší nabídky zakázky v systému (lhůta od data
 * objednávky); termín = datum objednávky / před ním bez nabídky s lhůtou → drop + varování (i bez nabídky).
 * Vrací navržený termín a text upozornění, jinak null.
 */
export function orderDeadlineForJob(
  doc: ExtractedBusinessDoc,
  quoteTerms: QuoteTerms[] | undefined,
  today?: string,
): SingleOrderDeadline | null {
  return singleOrderDeadline(doc, quoteTerms, today);
}

export function existingTarget(
  job: JobDetail, session: Pick<CaptureSession, "aiUsed" | "doc">, margins: boolean, reason: string | null, score: number | null,
  quoteTerms?: QuoteTerms[],
): ReviewTarget {
  return singleExistingTarget(job, session, margins, reason, score, quoteTerms);
}

export function newTarget(session: Pick<CaptureSession, "aiUsed" | "doc">, margins: boolean): ReviewTarget {
  return singleNewTarget(session, margins);
}

/**
 * „AI čte": jeden doklad (1 obchodní doklad kromě nabídky dodavatele, žádný další soubor) = dnešní
 * tok a odpověď { model }; jinak dávka { batch } (roztřídění, vytěžení per doklad, kontrola skupin).
 * Bez servisního klíče dávka neběží — vše je jeden doklad jako dřív.
 */
export async function analyzeCapture(raw: AnalyzeCaptureInput, signal?: AbortSignal | null): Promise<AnalyzeCaptureResponse> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  const files = cleanFileRefs(c.user.id, raw?.files, hasServiceKey() ? CAPTURE_BATCH_MAX_FILES : CAPTURE_MAX_PAGES);
  if (typeof files === "string") return fail(files);
  const fixedJobId = raw?.jobId ? (isUuid(raw.jobId) ? raw.jobId.toLowerCase() : "") : null;
  if (fixedJobId === "") return fail("Zakázka nenalezena.");
  const expectedKind = isCaptureDocKind(raw?.expectedKind) ? raw.expectedKind : null;
  if (!hasServiceKey()) return analyzeSingle(c, files, { fixedJobId, expectedKind, signal });
  try {
    return await analyzeBatch(c, files, { fixedJobId, expectedKind, signal: signal ?? null });
  } catch (err) {
    return fail(err);
  }
}

/** Už přečtený doklad (souběh roztřídění a vytěžení v dávce) — dnešní tok ho jen převezme. */
export interface PrereadDoc {
  doc: ExtractedBusinessDoc;
  aiUsed: boolean;
  reason: string | null;
  notes: string[];
}

/** Dnešní tok jednoho dokladu: AI čtení (nebo převzaté), párování, kontrolní formulář, relace v1. */
export async function analyzeSingle(
  c: Ctx,
  files: CaptureFileRef[],
  opts: { fixedJobId: string | null; expectedKind: CaptureDocKind | null; signal?: AbortSignal | null; preread?: PrereadDoc | null },
): Promise<AnalyzeCaptureResponse> {
  const { fixedJobId, expectedKind } = opts;
  if (files.length > CAPTURE_MAX_PAGES) return fail(`Doklad může mít nejvýš ${CAPTURE_MAX_PAGES} stránek.`);
  // v1 relace nese jen stránky dokladu (náhledy roztřídění se smažou s ní)
  try {
    const { db, margins, access } = c;
    const [ai, previews, options, candidates, suppliers, fixedJob, mode] = await Promise.all([
      aiAvailability(access),
      signedPreviews(db, files),
      getJobFormOptions(),
      getMatchingCandidates(),
      loadSuppliers(db),
      fixedJobId ? getJob(fixedJobId) : Promise.resolve(null),
      getModuleMode("capture"),
    ]);
    if (fixedJobId && !fixedJob) return fail("Zakázka nenalezena.");

    // AI čtení (jinak ruční vyplnění se stejným formulářem)
    let doc: ExtractedBusinessDoc = emptyExtracted();
    let aiUsed = false;
    let reason = ai.reason;
    const notes: string[] = [];
    if (opts.preread) {
      doc = opts.preread.doc;
      aiUsed = opts.preread.aiUsed;
      reason = opts.preread.reason ?? (aiUsed ? null : ai.reason);
      notes.push(...opts.preread.notes);
    } else if (ai.available) {
      try {
        const loaded = await loadAiFiles(db, files);
        if (loaded.skipped.length) {
          notes.push(`AI nepřečetla ${loaded.skipped.join(", ")} (nepodporovaný formát nebo příliš velká fotka) — zkontroluj údaje z ${loaded.skipped.length > 1 ? "těchto stránek" : "této stránky"} ručně.`);
        }
        if (!loaded.files.length) {
          reason = "AI umí číst fotky (JPG, PNG, WEBP) a PDF — tenhle formát ne. Vyplň údaje ručně podle náhledu.";
        } else {
          doc = await readBusinessDocument({
            files: loaded.files,
            hint: {
              jobNumber: fixedJob?.number,
              customerName: fixedJob?.customer?.name,
              expectedKind: expectedKind ?? undefined,
            },
            deadline: routeDeadline(),
            clientSignal: opts.signal ?? null,
          });
          aiUsed = true;
          reason = null;
        }
      } catch (err) {
        reason = `AI doklad nepřečetla (${aiFailureMessage(err).replace(/\.$/, "")}). Vyplň údaje ručně podle náhledu.`;
      }
    }
    if (!aiUsed && expectedKind) doc = { ...doc, docKind: expectedKind };

    // párování
    const supplierSide = isSupplierSideDoc(doc);
    const cm = aiUsed ? matchCustomer(doc.customer, candidates.customers, { supplierNumberAtCustomer: doc.supplierNumberAtCustomer }) : null;
    const customerMatch: PartyMatchView | null = cm
      ? { ...cm, name: candidates.customers.find((x) => x.id === cm.id)?.name ?? "" }
      : null;
    const sm = aiUsed && (supplierSide || doc.supplier.name || doc.supplier.ico) ? matchParty(doc.supplier, suppliers) : null;
    const supplierMatch: PartyMatchView | null = sm
      ? { ...sm, name: suppliers.find((x) => x.id === sm.id)?.name ?? "" }
      : null;

    const session: CaptureSession = {
      v: 1,
      captureId: crypto.randomUUID(),
      userId: c.user.id.toLowerCase(),
      createdAt: new Date().toISOString(),
      files,
      aiUsed,
      doc,
      fixedJobId,
      customerMatch,
      supplierMatch,
      matches: [],
    };

    // cíle: pevná zakázka, nebo nejlepší shoda + možnosti + nová zakázka
    const targets: ReviewTarget[] = [];
    // objednávka bez reálného termínu → termín z naší nabídky zakázky v systému (lhůta od data objednávky)
    const isOrder = aiUsed && doc.docKind === "objednavka" && doc.issuer !== "my" && doc.issuer !== "dodavatel";
    const deadlineNotes: Record<string, string> = {};
    const withTerms = async (j: JobDetail, reasonText: string | null, score: number | null) => {
      const terms = isOrder ? await jobQuoteTerms(db, j) : [];
      const dl = orderDeadlineForJob(doc, terms);
      if (dl?.message) deadlineNotes[j.id] = dl.message;
      return existingTarget(j, session, margins, reasonText, score, terms);
    };
    if (fixedJob) {
      targets.push(await withTerms(fixedJob, "doklad nahráváš u této zakázky", null));
    } else {
      if (aiUsed) {
        const m = matchJob(doc, candidates.jobs, { customerId: cm?.id ?? null, supplierId: sm?.id ?? null });
        const picks = [
          ...(m.best ? [{ jobId: m.best.jobId, reason: m.best.reason, score: m.best.score }] : []),
          ...m.alternatives.map((a) => ({ jobId: a.jobId, reason: a.reason, score: a.score })),
        ];
        session.matches = picks;
        const jobs = await Promise.all(picks.map((p) => getJob(p.jobId)));
        const built = await Promise.all(picks.map((p, i) => (jobs[i] ? withTerms(jobs[i]!, p.reason, p.score) : Promise.resolve(null))));
        for (const t of built) if (t) targets.push(t);
      }
      targets.push(newTarget(session, margins));
    }
    // nejlepší shoda jen nad prahem (alternativy jsou jen nabídka)
    const best = targets.find((t) => t.mode === "existing" && (fixedJob || (t.score ?? 0) >= 60)) ?? targets[targets.length - 1];
    if (best.jobId && deadlineNotes[best.jobId]) notes.push(deadlineNotes[best.jobId]);
    // nová zakázka: stejná upozornění jako dávka — termín = datum objednávky / před ním (bez nabídky) se neuloží,
    // termín v minulosti → „doplň termín" (obojí = bez plné automatiky); termín jen z položky se tiše převezme
    else if (!best.jobId && isOrder) {
      const dl = orderDeadlineForJob(doc, []);
      if (dl?.message) notes.push(dl.message);
    }

    const hideMoney = !margins && supplierSide;
    const model: ReviewModel = {
      captureId: session.captureId,
      aiUsed,
      reason,
      docKind: doc.docKind,
      issuer: doc.issuer,
      chipExact: chipFor(doc.docKind, doc.issuer).exact,
      documentNumber: doc.documentNumber,
      confidence: aiUsed ? doc.confidence : null,
      summary: hideMoney ? redactPrices(doc.summary) : doc.summary,
      needsClarification: [...notes, ...(hideMoney ? doc.needsClarification.map(redactPrices) : doc.needsClarification)],
      docCustomer: doc.customer,
      docSupplier: doc.supplier,
      customerMatch,
      supplierMatch,
      fixedJobId,
      targets,
      margins,
      mode: mode === "full" ? "full" : "approval",
      previews,
      options: {
        customers: options.customers,
        suppliers: options.suppliers,
        jobs: candidates.jobs.map((j) => ({ id: j.id, number: j.number, title: j.title, customerName: j.customerName, stage: j.stage })),
      },
      initial: initialReviewState({
        docKind: doc.docKind,
        issuer: doc.issuer,
        target: best,
        customerMatch,
        supplierMatch,
        docCustomer: doc.customer,
        docSupplier: doc.supplier,
        docNote: doc.note,
      }),
    };

    const writeErr = await writeSession(db, session);
    if (writeErr) return fail(`Doklad se nepodařilo připravit k uložení: ${writeErr}`);

    // plná automatika: jistý doklad se uloží hned, člověk jen případně upraví
    if (canAutoApply(model)) {
      const applied = await applyBusinessDoc(await autoCaptureCtx(c, true), session, model.initial, { auto: true });
      if (applied.ok) return { ok: true, model, applied };
      model.needsClarification = [`Automatické uložení se nepovedlo (${applied.error}) — zkontroluj a ulož ručně.`, ...model.needsClarification];
    }
    return { ok: true, model };
  } catch (err) {
    return fail(err);
  }
}

/** Jiná zakázka vybraná ručně v kontrolním formuláři → návrh pro ni. */
export async function captureTarget(input: { captureId: string; jobId: string }): Promise<ActionResult<{ target: ReviewTarget }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!input || !isUuid(input.jobId)) return fail("Zakázka nenalezena.");
  try {
    const session = await readSession(c.db, c.user.id, input.captureId);
    if (!session) return fail(SESSION_GONE);
    if (session.fixedJobId) return fail("Doklad patří k zakázce, u které se nahrával.");
    const job = await getJob(input.jobId);
    if (!job) return fail("Zakázka nenalezena.");
    const isOrder = session.aiUsed && session.doc.docKind === "objednavka" && session.doc.issuer !== "my" && session.doc.issuer !== "dodavatel";
    const terms = isOrder ? await jobQuoteTerms(c.db, job) : [];
    return { ok: true, target: existingTarget(job, session, c.margins, "vybráno ručně", null, terms) };
  } catch (err) {
    return fail(err);
  }
}

// ── 3) Uložení ──────────────────────────────────────────────
export async function applyCapture(input: { captureId: string; state: unknown }): Promise<CaptureResult> {
  const c = await begin();
  if ("error" in c) return failResult(c.error);
  if (!input || !isUuid(input.captureId)) return failResult(SESSION_GONE);
  try {
    const session = await readSession(c.db, c.user.id, input.captureId);
    if (!session) return failResult(SESSION_GONE);
    // faktura dodavatele (chip ve formuláři) → Faktury dodavatelů, ne zakázka
    if ((input.state as { chip?: unknown } | null)?.chip === "faktura_dodavatel") return await applySupplierInvoiceCapture(c, session);
    return await applyBusinessDoc(c, session, input.state, { auto: false });
  } catch (err) {
    return failResult(err);
  }
}

/** Jeden doklad označený jako faktura dodavatele → Faktury dodavatelů (stránky přesune, relaci uklidí). */
async function applySupplierInvoiceCapture(c: Ctx, session: CaptureSession): Promise<CaptureResult> {
  const files: InvoiceFileInput[] = [];
  for (const f of session.files) {
    const { data } = await bucket(c.db).download(f.path);
    if (!data) return failResult(`Stránku ${f.filename} se nepodařilo načíst z úložiště.`, session.aiUsed);
    files.push({ bytes: new Uint8Array(await (data as Blob).arrayBuffer()), filename: f.filename, mimeType: f.mimeType });
  }
  const pdf = files.some((f) => (f.mimeType ?? "").includes("pdf"));
  // vytěžení z obchodního čtení použít jen, když ho AI opravdu četla jako fakturu od dodavatele — jinak
  // (např. objednávka zákazníka přeznačená chipem) by položky byly prodejní ceny zákazníka a dodavatel chyběl:
  // fakturu přečte znovu čtečka faktur
  const asInvoice = session.aiUsed && session.doc.docKind === "faktura" && session.doc.issuer === "dodavatel";
  const res = await createSupplierInvoiceFromFile(files, pdf ? "upload" : "photo", userActor(c.user, "foto"), {
    db: c.db,
    captureKey: `single:${session.captureId}`,
    extract: asInvoice ? invoiceFromBusinessDoc(session.doc) : null,
    aiUsed: asInvoice,
    process: "background",
    contextJobId: session.fixedJobId ?? null,
  });
  if (!res.ok) return failResult(res.error, session.aiUsed);
  try {
    await bucket(c.db).remove([...session.files.map((f) => f.path), captureSessionPath(c.user.id, session.captureId)]);
  } catch {
    // úklid je best-effort
  }
  const see = supplierInvoicePerms(c.access.can).amounts;
  return {
    ok: true, created: false, aiUsed: session.aiUsed, filled: [], docLabel: "Faktura dodavatele",
    summary: see ? "Uloženo do Faktur dodavatelů — zkontroluj rozdělení na zakázky." : THANKS_TEXT,
    supplierInvoice: { id: see ? res.id : null },
  };
}

function isEmptyValue(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "") || (typeof v === "number" && v === 0);
}

function clamp01(v: number): number {
  return Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
}

/** Zakázka, kterou dřívější pokus dávky založil (klíč focení); sloučená (#24) → zakázka, do které se sloučila. */
async function jobByCaptureKey(db: JobsDb, captureKey: string): Promise<string | null> {
  const { data } = await db.from("orders").select("id, merged_into_id").eq("capture_key", captureKey).maybeSingle();
  const row = data as { id: string; merged_into_id: string | null } | null;
  if (!row) return null;
  if (!row.merged_into_id) return row.id;
  return (await resolveMergeTarget(db, row.id))?.id ?? row.merged_into_id;
}

/**
 * Adresy s účelem z dokladu (AI roleEmails, a k tomu rozpoznání „faktury zasílejte na …" v poznámce a
 * podmínkách) → e-maily podle účelu u zákazníka / dodavatele. Ruční nastavení nepřepíše (rememberRoleEmails).
 */
export async function rememberDocRoleEmails(
  db: JobsDb, doc: ExtractedBusinessDoc, party: { customerId: string | null; supplierId: string | null },
): Promise<number> {
  if (!party.customerId && !party.supplierId) return 0;
  const text = [doc.note, doc.paymentTerms, doc.deliveryTerms].filter(Boolean).join("\n");
  const fromText = detectRoleEmails(text);
  const ai = doc.roleEmails ?? [];
  let added = 0;
  const own = await ownAddressFilter(db);
  if (party.customerId) {
    const list = [...ai.filter((r) => r.party === "customer"), ...(party.supplierId ? [] : fromText)];
    if (list.length) added += await rememberRoleEmails(db, { customerId: party.customerId }, list, { exclude: own });
  }
  if (party.supplierId) {
    const list = [...ai.filter((r) => r.party === "supplier"), ...fromText];
    if (list.length) added += await rememberRoleEmails(db, { supplierId: party.supplierId }, list, { exclude: own });
  }
  return added;
}

/** Dodavatel podle IČO / DIČ / názvu, jinak nový. */
export async function findOrCreateSupplier(db: JobsDb, party: ExtractedParty): Promise<{ id: string; name: string; created: boolean } | null> {
  return findOrCreateSupplierByParty(db, party);
}

/** Pole, která zakázka už má (formulář je nepřepisuje). */
function lockedKeys(target: ReviewTarget): ReviewFieldKey[] {
  return REVIEW_FIELD_KEYS.filter((k) => isFieldLocked(target, k));
}

export interface ApplyBusinessOptions {
  auto: boolean;
  /** Dávka: „<captureId>:<skupina>" — idempotentní založení zakázky a položek (opakování nic nezdvojí). */
  captureKey?: string | null;
  /** false = stav existující zakázky se nemění (dávka posouvá stav jednou za skupinu). */
  stage?: boolean;
  /** false = stránky se nepřikládají (dávka přikládá každý doklad zvlášť). */
  attachFiles?: boolean;
  /** false = bez souhrnné události (dávka zapíše vlastní). */
  summaryEvent?: boolean;
  /** false = bez učení AI (dávka učí per doklad). */
  learn?: boolean;
  /** false = relace v1 se nemaže. */
  cleanupSession?: boolean;
}

/** Doklad k uložení (relace v1, nebo skupina dávky se sloučeným dokladem). */
export type BusinessDocSession = Pick<
  CaptureSession, "captureId" | "userId" | "files" | "aiUsed" | "doc" | "fixedJobId" | "customerMatch" | "supplierMatch" | "matches"
>;

export type BusinessApplyResult = CaptureResult & {
  /** Klíč položky formuláře → id položky zakázky (nově založené). */
  itemIds?: Record<string, string>;
  /** Objednávka se stejným číslem u zakázky s objednávkou → rozdíl pro novou revizi (položky se nepřepsaly). */
  orderRevision?: OrderChange[];
};

/**
 * Zapíše zkontrolovaný formulář do zakázky: zákazník (najít / založit), dodavatel, nová zakázka
 * nebo doplnění prázdných polí existující, položky, doplnění položek, stav (jen dopředu), stránky
 * dokladu k zakázce, jedna událost a učení. Dávka volá totéž per skupina s vlastními volbami.
 */
export async function applyBusinessDoc(
  c: Ctx,
  session: BusinessDocSession,
  rawState: unknown,
  opts: ApplyBusinessOptions,
): Promise<BusinessApplyResult> {
  const sane = sanitizeReviewState(rawState, { fixedJobId: opts.captureKey ? null : session.fixedJobId });
  if (!sane.ok) return failResult(sane.error, session.aiUsed);
  const state: ReviewState = sane.state;
  const { db, user, margins } = c;
  const { doc, aiUsed } = session;
  const chip = chipByKey(state.chip);
  const supplierSide = isSupplierSideDoc(state);
  const warnings: string[] = [];
  const captureKey = opts.captureKey ?? null;
  const itemIds: Record<string, string> = {};
  let createdEarlier = false;

  // dávka: zakázka už založená dřívějším pokusem → jen doplnit
  if (captureKey && state.targetKey === "new") {
    const prevId = await jobByCaptureKey(db, captureKey);
    if (prevId) {
      state.targetKey = prevId;
      createdEarlier = true;
    }
  }

  // cíl
  let detail: JobDetail | null = null;
  let jobRow: Row | null = null;
  let target: ReviewTarget;
  if (state.targetKey !== "new") {
    detail = await getJob(state.targetKey);
    if (!detail) return failResult("Zakázka nenalezena — vyber jinou nebo založ novou.", aiUsed);
    const { data } = await db.from("orders").select("*").eq("id", detail.id).maybeSingle();
    jobRow = (data as Row | null) ?? null;
    if (!jobRow) return failResult("Zakázka nenalezena — vyber jinou nebo založ novou.", aiUsed);
    target = existingTarget(detail, session, margins, null, null);
  } else {
    target = newTarget(session, margins);
  }

  // údaje formuláře
  const input = reviewToJobInput(state, target, margins);
  const invalid = validateJobInput(input);
  if (invalid) return failResult(invalid, aiUsed);
  const items = reviewItemsToInputs(state.items, margins);
  const badItems = validateItems(items);
  if (badItems) return failResult(badItems, aiUsed);
  if (target.mode === "new" && !input.title && state.customer.mode === "none" && !items.length) {
    return failResult("Doplň aspoň název zakázky, zákazníka nebo položku.", aiUsed);
  }

  // zákazník (u existující zakázky se nemění, jen doplní, když chybí)
  let customerId: string | null = null;
  let customerName: string | null = null;
  let customerCreated = false;
  let customerAttached = false;
  /** Obchodník zákazníka — nová zakázka patří jemu (jinak tomu, kdo doklad vyfotil). */
  let customerOwnerId: string | null = null;
  const jobCustomerId = (jobRow?.customer_id as string | null | undefined) ?? null;
  if (jobCustomerId) {
    customerId = jobCustomerId;
    customerName = detail?.customer?.name ?? null;
  } else if (state.customer.mode === "existing") {
    const { data } = await db.from("customers").select("id, name, owner_id").eq("id", state.customer.id).maybeSingle();
    if (!data) return failResult("Vybraný zákazník neexistuje.", aiUsed);
    const row = data as { id: string; name: string; owner_id: string | null };
    customerId = row.id;
    customerName = row.name;
    customerOwnerId = row.owner_id ?? null;
    customerAttached = true;
  } else if (state.customer.mode === "new") {
    const p = state.customer.party;
    const found = await findOrCreateCustomer(db, {
      ...p,
      supplierNumberAtCustomer: !supplierSide && doc.supplierNumberAtCustomer ? doc.supplierNumberAtCustomer : undefined,
      ownerId: user.role === "zamestnanec" ? null : user.id, // #25: zaměstnanec obchodníkem zákazníka není
    });
    if (!found) return failResult("Zákazníka se nepodařilo založit.", aiUsed);
    customerId = found.id;
    customerCreated = found.created;
    // nový zákazník z dokladu: kontaktní osoba z dokladu = první kontaktní osoba (jméno, e-mail, telefon)
    if (found.created) await ensureContactPerson(db, { customerId: found.id }, { name: p.contactPerson, email: p.email, phone: p.phone }).catch(() => null);
    customerAttached = true;
    const { data } = await db.from("customers").select("name, owner_id").eq("id", found.id).maybeSingle();
    const row = data as { name: string; owner_id: string | null } | null;
    customerName = row?.name ?? p.name;
    customerOwnerId = row?.owner_id ?? null;
  }

  // dodavatel (jen dodavatelské doklady)
  let supplierId: string | null = null;
  let supplierName: string | null = null;
  if (supplierSide && state.supplier.mode === "existing") {
    const { data } = await db.from("suppliers").select("id, name").eq("id", state.supplier.id).maybeSingle();
    if (!data) return failResult("Vybraný dodavatel neexistuje.", aiUsed);
    supplierId = (data as { id: string }).id;
    supplierName = (data as { name: string }).name;
  } else if (supplierSide && state.supplier.mode === "new") {
    const s = await findOrCreateSupplier(db, state.supplier.party);
    if (!s) return failResult("Dodavatele se nepodařilo založit.", aiUsed);
    supplierId = s.id;
    supplierName = s.name;
  }

  // „Faktury zasílejte na …" z dokladu (AI roleEmails + rozpoznání v poznámce / podmínkách) → e-maily podle účelu
  await rememberDocRoleEmails(db, doc, { customerId, supplierId }).catch((err) => {
    console.error(`[capture] E-maily podle účelu se nepodařilo uložit: ${err instanceof Error ? err.message : String(err)}`);
  });

  let jobId: string;
  let jobNumber: string;
  let created = false;
  let stageFrom: JobStage | null = null;
  let stageTo: JobStage | null = null;
  let itemsAdded = 0;
  let itemsMerged = 0;
  const written: ReviewFieldKey[] = [];
  let orderRevision: OrderChange[] | null = null;
  /** Co focení udělalo s podrobnými stavy (zobrazí se po uložení). */
  const flowNotes: string[] = [];
  /** Vyfocený náš DL: dodané kusy z fotky (→ řádek delivery_notes, až bude fotka u zakázky). */
  let photoDl: Awaited<ReturnType<typeof recordPhotoDelivery>> | null = null;

  if (target.mode === "new" && captureKey) {
    // dávka: zakázka bez položek, hned klíč relace, položky s klíčem (opakování je nezdvojí)
    // (do výroby nikdy rovnou — „Potvrzená objednávka" a pak předání do výroby, B.4)
    const stage: JobStage = state.stage === "keep" ? "poptavka" : state.stage === "ve_vyrobe" ? "potvrzeno" : state.stage;
    const totals = computeItemTotals(items.map((it) => ({ quantity: it.quantity, unitPrice: it.unitPrice, purchaseUnitPrice: margins ? it.purchaseUnitPrice : null })));
    const extra: Record<string, unknown> = {};
    if (input.value === undefined && totals.value !== null) extra.value = totals.value;
    if (margins && input.purchaseCost === undefined && totals.purchaseCost !== null) extra.purchaseCost = totals.purchaseCost;
    if (!input.title) extra.title = items[0]?.name ?? items[0]?.drawingNumber ?? "Nová zakázka z focení";
    const res = await createJob(
      { ...input, ...extra, customerId, supplierId, stage, items: [], ...(customerOwnerId ? { ownerId: customerOwnerId } : {}) },
      { source: "foto", aiFilled: aiUsed, aiConfidence: aiUsed ? doc.confidence : undefined, captureKey },
    );
    if (!res.ok || !res.id || !res.number) {
      // souběh / opakování: zakázku s tímto klíčem už založil jiný pokus → použít ji
      const againId = await jobByCaptureKey(db, captureKey);
      if (againId) return applyBusinessDoc(c, session, { ...state, targetKey: againId }, opts);
      return failResult(res.error ?? "Zakázku se nepodařilo založit.", aiUsed);
    }
    jobId = res.id;
    jobNumber = res.number;
    created = true;
    stageTo = stage;
    const ins = await insertCaptureItems(db, jobId, state.items, items, captureKey, margins);
    if ("error" in ins) {
      await db.from("orders").delete().eq("id", jobId);
      return failResult(`Položky se nepodařilo uložit: ${ins.error}`, aiUsed);
    }
    Object.assign(itemIds, ins.ids);
    itemsAdded = ins.added;
    for (const k of REVIEW_FIELD_KEYS) if ((input as Record<string, unknown>)[k] !== undefined) written.push(k);
  } else if (target.mode === "new") {
    const stage: JobStage = state.stage === "keep" ? "poptavka" : state.stage === "ve_vyrobe" ? "potvrzeno" : state.stage;
    const res = await createJob(
      { ...input, customerId, supplierId, stage, items, ...(customerOwnerId ? { ownerId: customerOwnerId } : {}) },
      { source: "foto", aiFilled: aiUsed, aiConfidence: aiUsed ? doc.confidence : undefined },
    );
    if (!res.ok || !res.id || !res.number) return failResult(res.error ?? "Zakázku se nepodařilo založit.", aiUsed);
    jobId = res.id;
    jobNumber = res.number;
    created = true;
    stageTo = stage;
    itemsAdded = items.length;
    for (const k of REVIEW_FIELD_KEYS) if ((input as Record<string, unknown>)[k] !== undefined) written.push(k);
  } else {
    const row = jobRow!;
    jobId = detail!.id;
    jobNumber = detail!.number;
    stageFrom = isJobStage(row.status) ? row.status : null;

    // objednávka se stejným číslem u zakázky, která objednávku už má → revize (2.8): položky se NEpřepisují
    if (state.chip === "objednavka_zakaznik") {
      const rev = await photoOrderRevision(db, jobId, input.customerOrderNumber ?? doc.customerOrderNumber, doc);
      if (rev.revision) {
        orderRevision = rev.changes;
        items.length = 0;
        state.items = [];
        state.merges = [];
      }
    }

    // nejistý řádek (≈ 2 %) bez odpovědi se neuloží — formulář se ptá „je to položka X?"
    const open = openPairQuestions(state.items);
    if (open.length) {
      const q = open[0];
      const what = q.name || q.drawingNumber || q.description || "položka";
      return failResult(`Rozhodni u řádku „${what}": je to položka ${q.pair!.itemLabel}, nebo nová položka?`, aiUsed);
    }
    // pojistka: řádek od AI, který JISTĚ je existující položkou (číslo výkresu, název + počet + cena),
    // se nepřidá podruhé — zapíše se do té položky (majitel 30. 10.: Z-2026-022 zdvojené položky)
    if (items.length) {
      const paired = await pairRowsWithJobItems(db, jobId, state, items, {
        purchase: supplierSide, margins, orderRef: state.chip === "objednavka_zakaznik",
        lineWins: state.chip === "objednavka_zakaznik" && isEmptyValue(row.customer_order_number),
      });
      Object.assign(itemIds, paired.itemIds);
      if (paired.labels.length) flowNotes.push(`Spárováno s existujícími položkami (nepřidáno znovu): ${paired.labels.join("; ")}`);
    }
    // „Ano" u otázky: řádek se stal doplněním položky — vazby výkresů na ten řádek míří na položku
    const fromRows = state.merges.filter((m) => m.apply && m.fromKey && !itemIds[m.fromKey]);
    if (fromRows.length) {
      const { data: own } = await db.from("order_items").select("id").eq("order_id", jobId).in("id", fromRows.map((m) => m.itemId));
      const ok = new Set(((own ?? []) as { id: string }[]).map((r) => r.id));
      for (const m of fromRows) if (ok.has(m.itemId)) itemIds[m.fromKey!] = m.itemId;
    }

    // položky nejdřív — když selžou, nic se nezapíše
    let insertedIds: string[] = [];
    if (captureKey && items.length) {
      const ins = await insertCaptureItems(db, jobId, state.items, items, captureKey, margins);
      if ("error" in ins) return failResult(`Položky se nepodařilo uložit: ${ins.error}`, aiUsed);
      Object.assign(itemIds, ins.ids);
      insertedIds = ins.inserted;
      itemsAdded = ins.added;
    } else if (items.length) {
      const { data: last } = await db.from("order_items").select("position").eq("order_id", jobId).order("position", { ascending: false }).limit(1);
      const start = (((last ?? []) as { position: number | null }[])[0]?.position ?? -1) + 1;
      const rows = items.map((it, i) => {
        const r = jobItemToRow(it, start + i);
        if (!margins) r.purchase_unit_price = null;
        return { ...r, order_id: jobId };
      });
      const { data: ins, error } = await db.from("order_items").insert(rows as never).select("id");
      if (error) return failResult(`Položky se nepodařilo uložit: ${error.message}`, aiUsed);
      insertedIds = ((ins ?? []) as { id: string }[]).map((r) => r.id);
      itemsAdded = insertedIds.length;
    }

    // pole: jen prázdná (ani mezitím vyplněná se nepřepíšou)
    const cols = jobInputToRow(input);
    delete cols.status;
    if (!margins) delete cols.purchase_cost;
    const update: Row = {};
    for (const k of REVIEW_FIELD_KEYS) {
      const col = REVIEW_FIELDS[k].column;
      if (!(col in cols) || cols[col] === null || !isEmptyValue(row[col])) continue;
      update[col] = cols[col];
      written.push(k);
    }
    if (customerId && !row.customer_id) update.customer_id = customerId;
    if (supplierId && !row.supplier_id) update.supplier_id = supplierId;
    if (aiUsed && written.some((k) => isAiValue(target, state, k, true))) {
      update.ai_filled = true;
      if (row.ai_confidence === null || row.ai_confidence === undefined) update.ai_confidence = clamp01(doc.confidence);
    }
    if (Object.keys(update).length) {
      const { error } = await db.from("orders").update(update as never).eq("id", jobId);
      if (error) {
        if (insertedIds.length) await db.from("order_items").delete().in("id", insertedIds);
        return failResult(error.message, aiUsed);
      }
    }

    // doplnění existujících položek (jen prázdné údaje; výjimka: počet kusů a dohodnutá cena z objednávky
    // zákazníka u zakázky, která objednávku ještě neměla — vždy platí objednávka). Číslo výkresu, revize,
    // materiál se nikdy nepřepíší; text řádku zákazníka / termín položky se připíše do poznámky.
    const orderQtyWins = state.chip === "objednavka_zakaznik" && isEmptyValue(row.customer_order_number);
    let overridden = false;
    for (const m of reviewMergePatches(state.merges, margins)) {
      const { data: cur } = await db
        .from("order_items")
        .select("id, quantity, unit_price, purchase_unit_price, drawing_number, material, name, revision, description, note")
        .eq("id", m.id)
        .eq("order_id", jobId)
        .maybeSingle();
      if (!cur) continue;
      const curRow = cur as Row;
      const patch: Row = {};
      const map: [keyof typeof m.patch, string][] = [
        ["quantity", "quantity"], ["unitPrice", "unit_price"], ["purchaseUnitPrice", "purchase_unit_price"],
        ["drawingNumber", "drawing_number"], ["material", "material"], ["name", "name"], ["revision", "revision"],
        ["description", "description"],
      ];
      for (const [k, col] of map) {
        const v = m.patch[k];
        if (v === undefined || v === null || v === "") continue;
        if (col === "purchase_unit_price" && !margins) continue;
        const wins = orderQtyWins && ((col === "quantity" && m.overrideQuantity) || (col === "unit_price" && m.overridePrice));
        if (!isEmptyValue(curRow[col]) && !wins) continue;
        if (wins && !isEmptyValue(curRow[col]) && Number(curRow[col]) !== Number(v)) overridden = true;
        patch[col] = v;
      }
      const note = typeof m.patch.note === "string" ? m.patch.note.trim() : "";
      const curNote = typeof curRow.note === "string" ? curRow.note.trim() : "";
      if (note && !curNote.includes(note)) patch.note = (curNote ? `${curNote}\n${note}` : note).slice(0, 2000);
      if (!Object.keys(patch).length) continue;
      const { error } = await db.from("order_items").update(patch as never).eq("id", m.id);
      if (error) warnings.push(`Položku se nepodařilo doplnit: ${message(error.message)}`);
      else itemsMerged++;
    }
    // objednávka změnila počet / cenu spárovaných položek → hodnota zakázky = součet položek (jako ruční úprava)
    if (overridden) {
      const { data: all } = await db.from("order_items").select("quantity, unit_price").eq("order_id", jobId);
      const rows = (all ?? []) as { quantity: number | string | null; unit_price: number | string | null }[];
      if (rows.length && rows.every((r) => Number(r.unit_price) > 0)) {
        const value = Math.round(rows.reduce((s, r) => s + (Number(r.quantity) || 0) * Number(r.unit_price), 0) * 100) / 100;
        await db.from("orders").update({ value } as never).eq("id", jobId);
      }
    }

    // náš dodací list → dodané množství po položkách (DB při 100 % posune na „Dodáno zákazníkovi")
    if (opts.stage !== false && state.chip === "dodaci_list_my" && doc.items.length) {
      const d = (photoDl = await recordPhotoDelivery(db, user.id, jobId, doc.items, { documentNumber: documentNumberFor(state, doc.documentNumber) }));
      if (d.recorded) flowNotes.push(d.complete ? "Dodáno vše" : `Dodáno částečně: ${d.lines.join("; ")}`);
    }
    // DL dodavatele k naší objednávce → převzetí po položkách (2.7)
    if (opts.stage !== false && state.chip === "dodaci_list_dodavatel" && margins && doc.customerOrderNumber) {
      const po = await findPurchaseOrderByNumber(db, doc.customerOrderNumber, jobId);
      if (po) {
        const r = await receiveSupplierDlByPhoto(db, user.id, po, doc.items);
        if (!r.ok) warnings.push(`Objednávku ${po.number} se nepodařilo převzít: ${message(r.error)}`);
        else {
          if (r.summary) flowNotes.push(r.summary);
          if (r.hint) flowNotes.push(r.hint);
        }
      }
    }

    // stav (jen dopředu; revize objednávky stav nemění; dodání / nákup podle pravidel 2.7)
    if (opts.stage !== false && !orderRevision && state.stage !== "keep" && state.stage !== stageFrom) {
      const { data: cur } = await db.from("orders").select("status").eq("id", jobId).maybeSingle();
      const now = isJobStage((cur as Row | null)?.status) ? ((cur as Row).status as JobStage) : stageFrom;
      const guard = now === state.stage ? null : await captureStageGuard(db, jobId, state.stage);
      if (now === state.stage) {
        stageTo = state.stage;
      } else if (state.stage === "ve_vyrobe") {
        // do výroby jen předáním (kdo + termín; objednávka dodavatele se použije, AI žádnou nevystaví) — B.4
        const h = await captureProductionHandoff(db, captureHandoffActor(c, opts.auto), jobId, {
          customerOrderNumber: input.customerOrderNumber ?? doc.customerOrderNumber, promisedDeliveryDate: doc.promisedDeliveryDate,
          documentNumber: documentNumberFor(state, doc.documentNumber), supplier: doc.supplier,
        }, opts.auto ? "auto" : "review");
        if (h.moved && h.stage) stageTo = h.stage;
        if (h.note) flowNotes.push(h.note);
        if (h.warning) flowNotes.push(h.warning);
      } else if (guard && !guard.ok) {
        flowNotes.push(guard.warning);
      } else {
        // událost o změně stavu zapíše DB (autor z hlavičky, poznámka x-change-note)
        const upd = db.from("orders").update({ status: state.stage } as never).eq("id", jobId);
        const { error } = await withChangeNote(upd, `podle dokladu (${chip.label.toLowerCase()})`);
        if (error) warnings.push(`Stav se nepodařilo změnit: ${message(error.message)}`);
        else stageTo = state.stage;
      }
    }
  }

  // nová zakázka z potvrzení dodavatele: založená jako „Potvrzená objednávka" → předání do výroby (B.4)
  if (created && !createdEarlier && opts.stage !== false && state.stage === "ve_vyrobe") {
    const h = await captureProductionHandoff(db, captureHandoffActor(c, opts.auto), jobId, {
      customerOrderNumber: input.customerOrderNumber ?? doc.customerOrderNumber, promisedDeliveryDate: doc.promisedDeliveryDate,
      documentNumber: documentNumberFor(state, doc.documentNumber), supplier: doc.supplier,
    }, opts.auto ? "auto" : "review");
    if (h.moved && h.stage) stageTo = h.stage;
    if (h.note) flowNotes.push(h.note);
    if (h.warning) flowNotes.push(h.warning);
  }

  // stránky dokladu → k zakázce (první stránka = hlavní dokument s daty z AI)
  const docNumber = documentNumberFor(state, doc.documentNumber);
  const fileIds: string[] = [];
  const total = opts.attachFiles === false ? 0 : session.files.length;
  for (let i = 0; i < total; i++) {
    const f = session.files[i];
    const dest = jobFilePath(jobId, crypto.randomUUID(), f.filename);
    const { error: mvErr } = await bucket(db).move(f.path, dest);
    if (mvErr) {
      warnings.push(`Stránku ${f.filename} se nepodařilo přiložit (${message(mvErr.message)}).`);
      continue;
    }
    // fotka: master v plném rozlišení (nahrál ho prohlížeč vedle zmenšené stránky) → zdroj anonymizace
    const master = (f.mimeType ?? "").toLowerCase().startsWith("image/") ? jobMasterPath(dest) : null;
    const hasMaster = master ? await moveMaster(db, CAPTURE_BUCKET, captureHiresPath(f.path), master) : false;
    const reg = await registerJobFileCore(db, user.id, {
      ...(hasMaster && master ? { anonSourcePath: master } : {}),
      jobId,
      path: dest,
      filename: f.filename,
      mimeType: f.mimeType || undefined,
      size: f.size || undefined,
      kind: state.fileKind,
      title: `${chip.docTitle}${docNumber ? ` ${docNumber}` : ""}${total > 1 ? ` · str. ${i + 1}/${total}` : ""}`,
      note: i === 0 && state.docNote ? state.docNote : undefined,
      aiExtracted: i === 0 && aiUsed ? (doc as unknown as Record<string, unknown>) : null,
      aiConfidence: i === 0 && aiUsed ? doc.confidence : null,
      // stránky jednoho dokladu: žádné automatické verze podle názvu, historie = jedna souhrnná událost níže
      silent: true,
      noAutoVersion: true,
      origin: "capture",
      issuer: issuerKey(state.issuer),
    });
    if (!reg.ok || !reg.file) {
      warnings.push(`Stránku ${f.filename} se nepodařilo uložit (${reg.error ?? "neznámá chyba"}).`);
      continue;
    }
    fileIds.push(reg.file.id);
    if (f.sortPath) {
      try { await bucket(db).remove([f.sortPath]); } catch { /* náhled roztřídění vyprší sám */ }
    }
  }

  // vyfocený náš DL → delivery_notes (jediný zdroj čísla DL; dodávka má svůj DL, žádný druhý „na dodané zboží")
  if (photoDl?.shipped.length && fileIds[0]) {
    const { data: fr } = await db.from("job_files").select("storage_path").eq("id", fileIds[0]).maybeSingle();
    await recordCapturedDeliveryNote(db, jobId, {
      number: docNumber, storagePath: (fr as { storage_path: string | null } | null)?.storage_path ?? null,
      issueDate: cleanDate(doc.documentDate), lines: photoDl.shipped,
    });
  }
  // vyfocená naše faktura (číslo zapsané výše) → datum, splatnost a evidence faktur (jako „mimo systém")
  if (opts.stage !== false && state.chip === "faktura_my" && written.includes("invoiceNumber")) {
    const r = await setInvoiceInfoCore(db, user.id, jobId, { invoiceDate: cleanDate(doc.documentDate) ?? todayIso() }, { stage: false });
    if (!r.ok) warnings.push(r.error);
  }

  // podrobné stavy podle dokladu (2.8) — jen u jednoho dokladu; dávka to dělá per doklad
  if (opts.stage !== false) {
    const notes = await applyDocFlow(c, jobId, state.chip, doc, {
      orderRevision, fileId: fileIds[0] ?? null, documentNumber: docNumber,
      customerOrderNumber: input.customerOrderNumber ?? doc.customerOrderNumber, auto: opts.auto,
    });
    flowNotes.push(...notes.notes);
    warnings.push(...notes.warnings);
  }

  // jedna událost v historii
  const filledColumns = aiUsed ? written.filter((k) => isAiValue(target, state, k, true)).map((k) => REVIEW_FIELDS[k].column) : [];
  const filledLabels = written.map((k) => REVIEW_FIELDS[k].label);
  if (customerAttached && customerName && !jobCustomerId) filledLabels.unshift(customerCreated ? `Zákazník (nový: ${customerName})` : `Zákazník ${customerName}`);
  if (opts.summaryEvent !== false) await logJobEvent(db, {
    jobId,
    type: aiUsed ? "ai" : "file",
    message: captureEventMessage({
      chip: state.chip, aiUsed, documentNumber: docNumber, filled: filledLabels,
      itemsAdded, itemsMerged, pages: total, auto: opts.auto,
    }),
    data: {
      ...(aiUsed ? { filledColumns, confidence: doc.confidence } : {}),
      docKind: state.docKind, issuer: state.issuer, fileKind: state.fileKind, fileIds,
      itemsAdded, itemsMerged, ...(opts.auto ? { auto: true } : {}),
    },
    actorId: user.id,
  });

  // učení AI: co člověk opravil
  const changes = aiUsed
    ? reviewChanges(
      {
        chip: chipFor(doc.docKind, doc.issuer).chip.key,
        customer: defaultCustomerChoice(target, session.customerMatch, doc.customer),
        supplier: defaultSupplierChoice(target, session.supplierMatch, doc.supplier),
        fields: target.proposed,
        items: target.newItems,
      },
      state,
      { locked: lockedKeys(target), customerLocked: Boolean(jobCustomerId), supplierRelevant: supplierSide, margins },
    )
    : [];
  const manualFilled = !aiUsed && (written.length > 0 || itemsAdded > 0 || customerAttached);
  if (opts.learn !== false && (aiUsed || manualFilled)) {
    await recordTrainingExample({
      source: aiUsed ? (changes.length ? "corrected" : "ai") : "manual",
      extracted: aiUsed ? doc : null,
      final: reviewToFinalDoc(doc, state, { customerName, supplierName, margins }),
      jobId,
      jobFileId: fileIds[0],
      docKind: state.docKind,
      createdBy: user.id,
    });
  }
  const context = `${chip.label} · ${customerName ?? "bez zákazníka"}${docNumber ? ` · ${docNumber}` : ""}`.slice(0, 500);
  for (const ch of opts.learn === false ? [] : changes.slice(0, 20)) {
    try {
      await recordCorrection({
        agentKey: "capture",
        field: ch.label,
        context,
        aiValue: ch.aiValue || "(nevyplněno)",
        correctedValue: ch.value || "(prázdné)",
      });
    } catch {
      // učení AI nesmí shodit uložení
    }
  }

  // úklid relace
  if (opts.cleanupSession !== false) {
    try {
      await bucket(db).remove([captureSessionPath(user.id, session.captureId)]);
    } catch {
      // vyprší sama
    }
  }
  revalidatePath("/orders");
  revalidatePath(`/orders/${jobId}`);
  revalidatePath("/");

  return {
    ok: true,
    jobId,
    jobNumber,
    created: created || createdEarlier,
    matchedBy: target.mode !== "existing" ? undefined
      : session.fixedJobId ? "doklad nahraný u zakázky"
      : session.matches.find((m) => m.jobId === jobId)?.reason ?? "vybráno ručně",
    matchScore: target.mode === "existing" ? session.matches.find((m) => m.jobId === jobId)?.score : undefined,
    customerId: customerId ?? undefined,
    customerName: customerName ?? undefined,
    customerCreated,
    fileId: fileIds[0],
    fileIds,
    fileKind: state.fileKind,
    docKind: state.docKind,
    issuer: state.issuer,
    docLabel: chip.label,
    aiUsed,
    filled: filledLabels,
    stageFrom: stageFrom ?? undefined,
    stageTo: stageTo ?? undefined,
    itemsAdded,
    itemsMerged,
    confidence: aiUsed ? doc.confidence : undefined,
    summary: aiUsed ? (margins || !supplierSide ? doc.summary : redactPrices(doc.summary)) : undefined,
    autoApplied: opts.auto || undefined,
    warnings: warnings.length ? warnings : undefined,
    flowNotes: flowNotes.length ? flowNotes : undefined,
    ...(captureKey ? { itemIds } : {}),
    ...(orderRevision ? { orderRevision } : {}),
  };
}

/**
 * Podrobné stavy toku podle uloženého dokladu (spec 2.8): objednávka → revize / rozpor s nabídkou /
 * návrh storna, naše nabídka → odeslaná, naše potvrzení → potvrzení odesláno. Sdílí jeden doklad
 * i dávka (volá se až po uložení stránek a posunu stavu zakázky).
 */
export async function applyDocFlow(
  c: Pick<Ctx, "db" | "user">,
  jobId: string,
  chipKey: string,
  doc: ExtractedBusinessDoc,
  opts: { orderRevision?: OrderChange[] | null; fileId?: string | null; documentNumber?: string | null; customerOrderNumber?: string | null; auto?: boolean; quoteId?: string | null },
): Promise<{ notes: string[]; warnings: string[] }> {
  const { db } = c;
  const notes: string[] = [];
  const warnings: string[] = [];
  try {
    if (chipKey === "objednavka_zakaznik") {
      if (opts.orderRevision) {
        if (!opts.orderRevision.length) notes.push("Objednávka beze změny proti evidované — jen přiložena.");
        else {
          const r = await registerPhotoOrderRevision(db, jobId, {
            changes: opts.orderRevision, fileId: opts.fileId, customerOrderNumber: opts.customerOrderNumber, documentNumber: opts.documentNumber,
          });
          if (r.ok && r.revision) notes.push(`Změna objednávky zapsána jako revize ${r.revision} (${opts.orderRevision.length} ${opts.orderRevision.length === 1 ? "rozdíl" : opts.orderRevision.length < 5 ? "rozdíly" : "rozdílů"}) — položky se nepřepsaly, potvrď změnu.`);
          else if (!r.ok) warnings.push(`Revizi objednávky se nepodařilo zapsat: ${message(r.error)}`);
        }
      } else {
        const m = await checkPhotoOrderMismatch(db, jobId, doc);
        if (m.hint) notes.push(m.hint);
      }
      if (looksLikeCancellation(doc)) {
        const ok = await proposeFromCapture(db, jobId, {
          phase: "order", to: "stornovana", reason: "projekt_zrusen", label: "Stornovat objednávku — podle vyfoceného dokladu",
          note: (doc.summary || "Doklad vypadá na storno objednávky.").slice(0, 500), confidence: doc.confidence,
        });
        if (ok) notes.push("Doklad vypadá na storno — připraven návrh, rozhodne obchodník.");
      }
    } else if (chipKey === "nabidka_my") {
      let quoteId = opts.quoteId ?? null;
      const number = (opts.documentNumber || doc.documentNumber || "").trim();
      if (!quoteId && number) {
        const { data } = await db.from("quotes").select("id, number").eq("job_id", jobId).limit(50);
        quoteId = ((data ?? []) as { id: string; number: string }[]).find((q) => docNumbersEqual(q.number, number))?.id ?? null;
      }
      if (quoteId) {
        const r = await markQuoteSentByPhoto(db, quoteId, doc.documentDate);
        if (!r.ok) warnings.push(r.error);
        else if (r.changed) notes.push(`Nabídka ${number || ""} označena jako odeslaná (z fotky).`.replace("  ", " "));
      }
    } else if (chipKey === "potvrzeni_my") {
      const r = await confirmOrderByPhoto(db, jobId);
      if (!r.ok) warnings.push(`Potvrzení objednávky se nepodařilo zapsat: ${message(r.error)}`);
      else if (r.changed) notes.push("Potvrzení objednávky zapsáno jako odeslané (z fotky).");
    }
  } catch (err) {
    warnings.push(message(err));
  }
  return { notes, warnings };
}

/**
 * Pojistka proti zdvojení položek (sdílený párovač item-pairing): řádky od AI, které JISTĚ odpovídají
 * existující položce zakázky (a člověk je neoznačil „Je to nová položka"), se ze vkládaných vyřadí
 * a zapíšou jako doplnění té položky. Mění state.items / items / state.merges na místě.
 */
async function pairRowsWithJobItems(
  db: JobsDb,
  jobId: string,
  state: ReviewState,
  items: ReturnType<typeof reviewItemsToInputs>,
  opts: { purchase: boolean; lineWins: boolean; orderRef: boolean; margins: boolean },
): Promise<{ itemIds: Record<string, string>; labels: string[] }> {
  const out = { itemIds: {} as Record<string, string>, labels: [] as string[] };
  const idx = state.items.map((r, i) => (r.aiFilled && r.pair?.answer !== "new" ? i : -1)).filter((i) => i >= 0 && items[i]);
  if (!idx.length) return out;
  const { data } = await db.from("order_items")
    .select("id, position, drawing_number, revision, name, description, material, quantity, unit, unit_price, purchase_unit_price, note")
    .eq("order_id", jobId).order("position");
  const rows = (data ?? []) as Row[];
  if (!rows.length) return out;
  const jobItems: JobItem[] = rows.map((r) => ({
    id: String(r.id), position: Number(r.position) || 0,
    drawingNumber: (r.drawing_number as string | null) ?? null, revision: (r.revision as string | null) ?? null,
    name: (r.name as string | null) ?? null, description: (r.description as string | null) ?? null,
    material: (r.material as string | null) ?? null, quantity: Number(r.quantity) || 0, unit: (r.unit as string | null) ?? "ks",
    unitPrice: r.unit_price === null || r.unit_price === undefined ? null : Number(r.unit_price),
    purchaseUnitPrice: r.purchase_unit_price === null || r.purchase_unit_price === undefined ? null : Number(r.purchase_unit_price),
    note: (r.note as string | null) ?? null,
  }));
  const lines: ExtractedItem[] = idx.map((i) => {
    const it = items[i];
    return {
      drawingNumber: it.drawingNumber ?? "", revision: it.revision ?? "", name: it.name ?? "", description: it.description ?? "",
      material: it.material ?? "", quantity: it.quantity, unit: it.unit ?? "ks",
      unitPrice: (opts.purchase ? it.purchaseUnitPrice : it.unitPrice) ?? 0,
      deliveryDate: /Termín položky (\d{4}-\d{2}-\d{2})/.exec(it.note ?? "")?.[1] ?? "",
    };
  });
  const res = pairDocLines(lines, jobItems, { purchase: opts.purchase, lineWins: opts.lineWins });
  const drop = new Set<number>();
  for (const p of res.pairs) {
    if (p.confidence !== "sure") continue;
    const i = idx[p.line];
    const ex = jobItems.find((x) => x.id === p.itemId)!;
    const key = state.items[i].key;
    const m = updateToMerge(pairedItemUpdate(ex, lines[p.line], opts.purchase, opts.lineWins, opts.orderRef), ex, opts.margins, key);
    if (m) {
      const prev = state.merges.find((x) => x.itemId === ex.id);
      if (prev) {
        prev.patch = { ...m.patch, ...prev.patch };
        prev.apply = true;
        if (m.override?.length) prev.override = [...new Set([...(prev.override ?? []), ...m.override])];
      } else state.merges.push(m);
    }
    out.itemIds[key] = ex.id;
    out.labels.push(`${lines[p.line].name || lines[p.line].drawingNumber || "řádek"} → ${[ex.drawingNumber, ex.name].filter(Boolean).join(" ") || `položka ${ex.position + 1}`}`);
    drop.add(i);
  }
  if (drop.size) {
    const keepRows = state.items.filter((_, i) => !drop.has(i));
    const keepInputs = items.filter((_, i) => !drop.has(i));
    state.items = keepRows;
    items.length = 0;
    items.push(...keepInputs);
  }
  return out;
}

/**
 * Položky dávky s klíčem relace: založí jen ty, které ještě nejsou (opakované uložení po pádu
 * nic nezdvojí), a vrátí id podle klíče řádku formuláře.
 */
async function insertCaptureItems(
  db: JobsDb,
  jobId: string,
  reviewItems: ReviewState["items"],
  inputs: ReturnType<typeof reviewItemsToInputs>,
  captureKey: string,
  margins: boolean,
): Promise<{ ids: Record<string, string>; inserted: string[]; added: number } | { error: string }> {
  const rows = reviewItems.filter((i) => !(!i.drawingNumber.trim() && !i.name.trim() && !i.description.trim()));
  const keys = rows.map((r) => `${captureKey}:${r.key}`.slice(0, 300));
  const ids: Record<string, string> = {};
  const { data: existing } = await db.from("order_items").select("id, capture_key").eq("order_id", jobId).in("capture_key", keys.length ? keys : ["-"]);
  for (const e of (existing ?? []) as { id: string; capture_key: string }[]) {
    const i = keys.indexOf(e.capture_key);
    if (i >= 0) ids[rows[i].key] = e.id;
  }
  const { data: last } = await db.from("order_items").select("position").eq("order_id", jobId).order("position", { ascending: false }).limit(1);
  let pos = (((last ?? []) as { position: number | null }[])[0]?.position ?? -1) + 1;
  const toInsert: Record<string, unknown>[] = [];
  const toKeys: string[] = [];
  rows.forEach((r, i) => {
    if (ids[r.key]) return;
    const row = jobItemToRow(inputs[i], pos++);
    if (!margins) row.purchase_unit_price = null;
    toInsert.push({ ...row, order_id: jobId, capture_key: keys[i] });
    toKeys.push(r.key);
  });
  if (!toInsert.length) return { ids, inserted: [], added: 0 };
  const { data: ins, error } = await db.from("order_items").insert(toInsert as never).select("id, capture_key");
  if (error) return { error: error.message };
  const inserted: string[] = [];
  for (const r of (ins ?? []) as { id: string; capture_key: string }[]) {
    const i = keys.indexOf(r.capture_key);
    if (i >= 0) ids[rows[i].key] = r.id;
    inserted.push(r.id);
  }
  return { ids, inserted, added: inserted.length };
}
