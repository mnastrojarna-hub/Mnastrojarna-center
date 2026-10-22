import "server-only";
import { revalidatePath } from "next/cache";
import { createOperatorClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { checkFeature, getAccess, type Access } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/data/current-user";
import { getJob, getJobFormOptions, getMatchingCandidates } from "@/lib/data/jobs";
import { createJob } from "@/app/actions/jobs";
import { registerJobFile } from "@/app/actions/job-files";
import { recordCorrection } from "@/app/actions/corrections";
import { getModuleMode } from "@/lib/automation";
import { isDocumentReaderConfigured, readBusinessDocument, type ReadDocumentFile } from "@/lib/ai/document-reader";
import { recordTrainingExample } from "@/lib/jobs/training";
import { logJobEvent, type JobsDb } from "@/lib/jobs/events";
import { composeAddress, findOrCreateCustomer, normalizeCountry, normalizeDic, normalizeIco } from "@/lib/jobs/customers";
import { docFieldValues, planJobUpdate, planNewJob } from "@/lib/jobs/apply-extraction";
import { isSupplierSideDoc, matchCustomer, matchJob, matchParty } from "@/lib/jobs/matching";
import { emptyExtracted, normalizeExtracted } from "@/lib/jobs/extracted-normalize";
import { JOB_FILE_MAX_BYTES } from "@/lib/jobs/file-kinds";
import {
  cleanNumber, cleanText, fetchPaged, isUuid, jobFilePath, jobInputToRow, jobItemToRow, stageEventMessage,
  translateDbError, validateItems, validateJobInput,
} from "@/lib/jobs/mapping";
import { isJobStage } from "@/lib/jobs/stages";
import type {
  CaptureDocKind, CaptureResult, CustomerMatchCandidate, ExtractedBusinessDoc, ExtractedParty,
} from "@/lib/jobs/capture-types";
import type { ActionResult, JobDetail } from "@/lib/jobs/types";
import type { JobStage } from "@/lib/supabase/database.types";
import {
  CAPTURE_BUCKET, CAPTURE_MAX_PAGES, CAPTURE_TTL_MS, REVIEW_FIELD_KEYS, REVIEW_FIELDS,
  buildExistingTarget, buildNewTarget, canAutoApply, captureEventMessage, captureFolder, capturePagePath,
  captureSessionPath, chipByKey, chipFor, defaultCustomerChoice, defaultSupplierChoice, documentNumberFor,
  initialReviewState, isAiReadableMime, isAiValue, isCaptureDocKind, isCaptureMime, isCapturePagePath, isFieldLocked,
  reviewChanges, reviewItemsToInputs, reviewMergePatches, reviewToFinalDoc, reviewToJobInput, sanitizeReviewState,
  sniffDocumentMime,
  type AnalyzeCaptureResponse, type CaptureFileRef, type CapturePreview, type PartyMatchView, type ReviewFieldKey,
  type ReviewModel, type ReviewState, type ReviewTarget,
} from "@/lib/jobs/capture-review";

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

interface Ctx {
  db: JobsDb;
  user: CurrentUser;
  access: Access;
  margins: boolean;
}

type Row = Record<string, unknown>;

const AI_NOT_ALLOWED = "Nemáš povolené AI čtení dokladů — vyplň údaje ručně podle fotky. AI se z tvého vyplnění učí.";
const AI_DISABLED = "AI je vypnuté v Nastavení — vyplň údaje ručně podle fotky. AI se z tvého vyplnění učí.";
const AI_MISSING = "AI není nastavené (chybí Claude API klíč) — vyplň údaje ručně podle fotky. AI se z tvého vyplnění učí.";
const SESSION_GONE = "Doklad už není k dispozici (vypršel nebo už je uložený) — vyfoť ho prosím znovu.";

/** Claude API: obrázek max. 5 MB, celý požadavek do ~32 MB (base64 = +33 %). */
const AI_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const AI_MAX_TOTAL_BYTES = 22 * 1024 * 1024;
const PREVIEW_TTL_S = 3600;

async function begin(): Promise<Ctx | { error: string }> {
  if (!isSupabaseConfigured()) return { error: "Supabase není nakonfigurováno." };
  const res = await checkFeature("orders");
  if ("error" in res) return { error: res.error };
  const access = await getAccess();
  const db = await createOperatorClient();
  return { db, user: res.user, access, margins: access.can("margins") };
}

function message(err: unknown): string {
  if (typeof err === "string") return translateDbError(err);
  return err instanceof Error ? translateDbError(err.message) : "Neočekávaná chyba.";
}

function fail(err: unknown): { ok: false; error: string } {
  return { ok: false, error: message(err) };
}

function failResult(err: unknown, aiUsed = false): CaptureResult {
  return { ok: false, error: message(err), created: false, aiUsed, filled: [] };
}

function bucket(db: JobsDb) {
  return db.storage.from(CAPTURE_BUCKET);
}

/** Smí uživatel nechat doklad přečíst AI? (+ proč ne) */
async function aiAvailability(access: Access): Promise<{ available: boolean; reason: string | null }> {
  if (access.can("ai_capture") && (await isDocumentReaderConfigured())) return { available: true, reason: null };
  // E2E bez API klíče: testovací AI_FAKE_CAPTURE pro super admina
  if (process.env.AI_FAKE_CAPTURE && access.user?.role === "super_admin") return { available: true, reason: null };
  const permitted = can(access.user, "ai_capture", { ...access.ctx, aiEnabled: true, aiConfigured: true });
  if (!permitted) return { available: false, reason: AI_NOT_ALLOWED };
  if (!access.ctx.aiEnabled) return { available: false, reason: AI_DISABLED };
  return { available: false, reason: AI_MISSING };
}

// ── Soubory ─────────────────────────────────────────────────
const IMAGE_EXT = /\.(pdf|jpe?g|png|webp|gif|heic|heif)$/i;

function cleanFileRefs(userId: string, raw: unknown): CaptureFileRef[] | string {
  if (!Array.isArray(raw) || raw.length === 0) return "Vyfoť nebo vyber aspoň jednu stránku dokladu.";
  if (raw.length > CAPTURE_MAX_PAGES) return `Doklad může mít nejvýš ${CAPTURE_MAX_PAGES} stránek.`;
  const out: CaptureFileRef[] = [];
  for (const r of raw) {
    const o = r && typeof r === "object" ? (r as Record<string, unknown>) : {};
    if (!isCapturePagePath(userId, o.path)) return "Neplatná cesta souboru.";
    if (out.some((f) => f.path === o.path)) continue;
    const filename = cleanText(o.filename, 255) ?? o.path.split("/").pop() ?? "doklad";
    const mimeType = (cleanText(o.mimeType, 200) ?? "").toLowerCase();
    const size = cleanNumber(o.size) ?? 0;
    if (size < 0 || size > JOB_FILE_MAX_BYTES) return "Neplatná velikost souboru.";
    out.push({ path: o.path, filename, mimeType, size: Math.round(size) });
  }
  return out;
}

/** Úklid zapomenutých dokladů uživatele (starší než 24 h). Best-effort. */
async function cleanupStale(db: JobsDb, userId: string): Promise<void> {
  try {
    const folder = captureFolder(userId);
    const { data } = await bucket(db).list(folder, { limit: 100, sortBy: { column: "created_at", order: "asc" } });
    const cutoff = Date.now() - CAPTURE_TTL_MS;
    const old = ((data ?? []) as { name: string; created_at?: string | null }[])
      .filter((f) => f.name && f.created_at && Date.parse(f.created_at) < cutoff)
      .map((f) => `${folder}/${f.name}`);
    if (old.length) await bucket(db).remove(old);
  } catch {
    // úklid nesmí shodit nahrávání
  }
}

async function signedPreviews(db: JobsDb, files: CaptureFileRef[]): Promise<CapturePreview[]> {
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
}): Promise<ActionResult<{ path: string; token: string; bucket: string }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  const filename = cleanText(input?.filename, 255);
  if (!filename) return fail("Chybí název souboru.");
  const size = cleanNumber(input.size);
  if (size === null || size <= 0) return fail("Soubor je prázdný.");
  if (size > JOB_FILE_MAX_BYTES) return fail(`Soubor je příliš velký (max. ${Math.round(JOB_FILE_MAX_BYTES / 1024 / 1024)} MB).`);
  const mime = cleanText(input.mimeType, 200) ?? "";
  if (!isCaptureMime(mime) && !IMAGE_EXT.test(filename)) {
    return fail("Sem patří fotka nebo PDF dokladu. Jiné soubory (3D modely, Excel…) přidej v kartě zakázky do Dokumentů.");
  }
  try {
    await cleanupStale(c.db, c.user.id);
    const path = capturePagePath(c.user.id, crypto.randomUUID(), filename);
    const { data, error } = await bucket(c.db).createSignedUploadUrl(path);
    if (error || !data?.token) return fail(error?.message ?? "Nahrání se nepodařilo připravit.");
    return { ok: true, path: (data.path as string | undefined) ?? path, token: data.token as string, bucket: CAPTURE_BUCKET };
  } catch (err) {
    return fail(err);
  }
}

/** Zahodit rozpracovaný doklad (stránky + relaci). */
export async function discardCapture(input: { captureId?: string | null; paths?: string[] }): Promise<ActionResult> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  try {
    const paths = (Array.isArray(input?.paths) ? input.paths : []).filter((p) => isCapturePagePath(c.user.id, p));
    let session: CaptureSession | null = null;
    if (input?.captureId && isUuid(input.captureId)) {
      session = await readSession(c.db, c.user.id, input.captureId);
      paths.push(captureSessionPath(c.user.id, input.captureId));
      for (const f of session?.files ?? []) if (!paths.includes(f.path)) paths.push(f.path);
    }
    if (paths.length) {
      const { error } = await bucket(c.db).remove(paths.slice(0, 100));
      if (error) return fail(error.message);
    }
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// ── 2) Čtení a návrh ────────────────────────────────────────
function supplierCandidate(r: { id: string; name: string; ico: string | null; dic: string | null; email: string | null }): CustomerMatchCandidate {
  return {
    id: r.id, name: r.name, ico: r.ico ?? null, dic: r.dic ?? null, email: r.email ?? null,
    contactEmails: [], customerNumber: null, supplierNumberAtCustomer: null,
  };
}

async function loadSuppliers(db: JobsDb): Promise<CustomerMatchCandidate[]> {
  const { data } = await fetchPaged<{ id: string; name: string; ico: string | null; dic: string | null; email: string | null }>(
    (from, to) => db.from("suppliers").select("id, name, ico, dic, email").order("name").order("id").range(from, to),
    20_000,
  );
  return data.map(supplierCandidate);
}

const MONEY_RE = /\d[\d\s.,]*\s*(?:Kč|CZK|EUR|€|USD|\$|,-)/gi;

/** Bez práva na marže nesmí ze shrnutí dodavatelského dokladu prosáknout nákupní ceny. */
function redactPrices(text: string): string {
  return text.replace(MONEY_RE, "…");
}

function existingTarget(job: JobDetail, session: Pick<CaptureSession, "aiUsed" | "doc">, margins: boolean, reason: string | null, score: number | null): ReviewTarget {
  return buildExistingTarget({
    job,
    plan: session.aiUsed ? planJobUpdate(job, session.doc) : null,
    docValues: session.aiUsed ? docFieldValues(session.doc) : undefined,
    reason,
    score,
    margins,
  });
}

function newTarget(session: Pick<CaptureSession, "aiUsed" | "doc">, margins: boolean): ReviewTarget {
  return buildNewTarget({
    plan: session.aiUsed ? planNewJob(session.doc) : null,
    margins,
    docKind: session.doc.docKind,
    issuer: session.doc.issuer,
  });
}

export async function analyzeCapture(raw: AnalyzeCaptureInput): Promise<AnalyzeCaptureResponse> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  const files = cleanFileRefs(c.user.id, raw?.files);
  if (typeof files === "string") return fail(files);
  const fixedJobId = raw?.jobId ? (isUuid(raw.jobId) ? raw.jobId.toLowerCase() : "") : null;
  if (fixedJobId === "") return fail("Zakázka nenalezena.");
  const expectedKind = isCaptureDocKind(raw?.expectedKind) ? raw.expectedKind : null;

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
    if (ai.available) {
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
          });
          aiUsed = true;
          reason = null;
        }
      } catch (err) {
        reason = `AI doklad nepřečetla (${message(err)}). Vyplň údaje ručně podle náhledu.`;
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
    if (fixedJob) {
      targets.push(existingTarget(fixedJob, session, margins, "doklad nahráváš u této zakázky", null));
    } else {
      if (aiUsed) {
        const m = matchJob(doc, candidates.jobs, { customerId: cm?.id ?? null, supplierId: sm?.id ?? null });
        const picks = [
          ...(m.best ? [{ jobId: m.best.jobId, reason: m.best.reason, score: m.best.score }] : []),
          ...m.alternatives.map((a) => ({ jobId: a.jobId, reason: a.reason, score: a.score })),
        ];
        session.matches = picks;
        const jobs = await Promise.all(picks.map((p) => getJob(p.jobId)));
        picks.forEach((p, i) => {
          const j = jobs[i];
          if (j) targets.push(existingTarget(j, session, margins, p.reason, p.score));
        });
      }
      targets.push(newTarget(session, margins));
    }
    // nejlepší shoda jen nad prahem (alternativy jsou jen nabídka)
    const best = targets.find((t) => t.mode === "existing" && (fixedJob || (t.score ?? 0) >= 60)) ?? targets[targets.length - 1];

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
      const applied = await applyWithSession(c, session, model.initial, { auto: true });
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
    return { ok: true, target: existingTarget(job, session, c.margins, "vybráno ručně", null) };
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
    return await applyWithSession(c, session, input.state, { auto: false });
  } catch (err) {
    return failResult(err);
  }
}

function isEmptyValue(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "") || (typeof v === "number" && v === 0);
}

function clamp01(v: number): number {
  return Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
}

/** Dodavatel podle IČO / DIČ / názvu, jinak nový. */
async function findOrCreateSupplier(db: JobsDb, party: ExtractedParty): Promise<{ id: string; name: string; created: boolean } | null> {
  const suppliers = await loadSuppliers(db);
  const hit = matchParty(party, suppliers);
  if (hit && hit.score >= 80) return { id: hit.id, name: suppliers.find((s) => s.id === hit.id)?.name ?? party.name, created: false };
  const insert: Row = {
    name: party.name.trim().slice(0, 300),
    ico: normalizeIco(party.ico),
    dic: normalizeDic(party.dic),
    email: party.email.trim().toLowerCase() || null,
    phone: party.phone.trim() || null,
    contact_person: party.contactPerson.trim() || null,
    country: normalizeCountry(party.country),
    address: composeAddress(party),
  };
  const { data, error } = await db.from("suppliers").insert(insert as never).select("id, name").single();
  if (error || !data) {
    console.error(`[capture] Založení dodavatele selhalo: ${error?.message ?? "bez odpovědi"}`);
    return null;
  }
  return { id: (data as { id: string }).id, name: (data as { name: string }).name, created: true };
}

/** Pole, která zakázka už má (formulář je nepřepisuje). */
function lockedKeys(target: ReviewTarget): ReviewFieldKey[] {
  return REVIEW_FIELD_KEYS.filter((k) => isFieldLocked(target, k));
}

async function applyWithSession(
  c: Ctx,
  session: CaptureSession,
  rawState: unknown,
  opts: { auto: boolean },
): Promise<CaptureResult> {
  const sane = sanitizeReviewState(rawState, { fixedJobId: session.fixedJobId });
  if (!sane.ok) return failResult(sane.error, session.aiUsed);
  const state: ReviewState = sane.state;
  const { db, user, margins } = c;
  const { doc, aiUsed } = session;
  const chip = chipByKey(state.chip);
  const supplierSide = isSupplierSideDoc(state);
  const warnings: string[] = [];

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
      ownerId: user.id,
    });
    if (!found) return failResult("Zákazníka se nepodařilo založit.", aiUsed);
    customerId = found.id;
    customerCreated = found.created;
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

  let jobId: string;
  let jobNumber: string;
  let created = false;
  let stageFrom: JobStage | null = null;
  let stageTo: JobStage | null = null;
  let itemsAdded = 0;
  let itemsMerged = 0;
  const written: ReviewFieldKey[] = [];

  if (target.mode === "new") {
    const stage: JobStage = state.stage === "keep" ? "poptavka" : state.stage;
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

    // položky nejdřív — když selžou, nic se nezapíše
    let insertedIds: string[] = [];
    if (items.length) {
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

    // doplnění existujících položek (jen prázdné údaje)
    for (const m of reviewMergePatches(state.merges, margins)) {
      const { data: cur } = await db
        .from("order_items")
        .select("id, quantity, unit_price, purchase_unit_price, material, name, revision")
        .eq("id", m.id)
        .eq("order_id", jobId)
        .maybeSingle();
      if (!cur) continue;
      const curRow = cur as Row;
      const patch: Row = {};
      const map: [keyof typeof m.patch, string][] = [
        ["quantity", "quantity"], ["unitPrice", "unit_price"], ["purchaseUnitPrice", "purchase_unit_price"],
        ["material", "material"], ["name", "name"], ["revision", "revision"],
      ];
      for (const [k, col] of map) {
        const v = m.patch[k];
        if (v === undefined || v === null || v === "") continue;
        if (col === "purchase_unit_price" && !margins) continue;
        if (!isEmptyValue(curRow[col])) continue;
        patch[col] = v;
      }
      if (!Object.keys(patch).length) continue;
      const { error } = await db.from("order_items").update(patch as never).eq("id", m.id);
      if (error) warnings.push(`Položku se nepodařilo doplnit: ${message(error.message)}`);
      else itemsMerged++;
    }

    // stav
    if (state.stage !== "keep" && state.stage !== stageFrom) {
      const { error } = await db.from("orders").update({ status: state.stage } as never).eq("id", jobId);
      if (error) {
        warnings.push(`Stav se nepodařilo změnit: ${message(error.message)}`);
      } else {
        stageTo = state.stage;
        await logJobEvent(db, {
          jobId, type: "stage", message: stageEventMessage(stageFrom, state.stage, `podle dokladu (${chip.label.toLowerCase()})`),
          data: { from: stageFrom, to: state.stage, source: "foto" }, actorId: user.id,
        });
      }
    }
  }

  // stránky dokladu → k zakázce (první stránka = hlavní dokument s daty z AI)
  const docNumber = documentNumberFor(state, doc.documentNumber);
  const fileIds: string[] = [];
  const total = session.files.length;
  for (let i = 0; i < total; i++) {
    const f = session.files[i];
    const dest = jobFilePath(jobId, crypto.randomUUID(), f.filename);
    const { error: mvErr } = await bucket(db).move(f.path, dest);
    if (mvErr) {
      warnings.push(`Stránku ${f.filename} se nepodařilo přiložit (${message(mvErr.message)}).`);
      continue;
    }
    const reg = await registerJobFile({
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
    });
    if (!reg.ok || !reg.file) {
      warnings.push(`Stránku ${f.filename} se nepodařilo uložit (${reg.error ?? "neznámá chyba"}).`);
      continue;
    }
    fileIds.push(reg.file.id);
  }

  // jedna událost v historii
  const filledColumns = aiUsed ? written.filter((k) => isAiValue(target, state, k, true)).map((k) => REVIEW_FIELDS[k].column) : [];
  const filledLabels = written.map((k) => REVIEW_FIELDS[k].label);
  if (customerAttached && customerName && !jobCustomerId) filledLabels.unshift(customerCreated ? `Zákazník (nový: ${customerName})` : `Zákazník ${customerName}`);
  await logJobEvent(db, {
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
  if (aiUsed || manualFilled) {
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
  for (const ch of changes.slice(0, 20)) {
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
  try {
    await bucket(db).remove([captureSessionPath(user.id, session.captureId)]);
  } catch {
    // vyprší sama
  }
  revalidatePath("/orders");
  revalidatePath(`/orders/${jobId}`);
  revalidatePath("/");

  return {
    ok: true,
    jobId,
    jobNumber,
    created,
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
  };
}
