import "server-only";
import { revalidatePath } from "next/cache";
import { hasServiceKey } from "@/lib/supabase/server";
import { COMPANY } from "@/lib/company";
import { refreshCompanyFromSettings } from "@/lib/company-server";
import { can } from "@/lib/auth/permissions";
import { getModuleMode } from "@/lib/automation";
import { getJob, getJobFormOptions, getMatchingCandidates } from "@/lib/data/jobs";
import { recordCorrection } from "@/app/actions/corrections";
import { aiFailureMessage, AI_FAILURE_MESSAGE, classifyAiError, routeDeadline } from "@/lib/ai/ai-call";
import { CLASSIFY_MAX_PAGES, classifyBatch } from "@/lib/ai/batch-classifier";
import { readBusinessDocumentDetailed, readDrawing, type BatchContextLine } from "@/lib/ai/document-reader";
import { fakeGroupFor, fakeTagFor, isFakeCapture } from "@/lib/ai/fake-capture";
import type {
  AiFailure, AiUsage, BatchApplyState, BatchDocDraft, BatchDocExtract, BatchDocResult, BatchDocType, BatchFile,
  BatchGroupResult, BatchPage, BatchPreview, BatchResult, BatchResultLink, BatchReviewModel, BatchSort, BatchSortModel,
  BatchWarning, DocApplyState, DocExtractSummary, DuplicateRef, ModelMeta,
} from "@/lib/jobs/capture-batch-types";
import {
  BATCH_TYPES, batchEventMessage, batchStage, batchTypeFor, defaultSortWithoutAi, drawingNumberFromFilename, isBatchDocType,
  isBusinessType, isNewerRevision, makeWarning, normalizeClassification, pagesKey, redactPrices, revisionFromFilename, sideOf,
  uniqueWarnings, validateBatchSort,
} from "@/lib/jobs/capture-batch";
import {
  canAutoApplyBatch, groupBatch, groupDocOf, journalConflictOf, reconcileGroup, sameDocParty, sanitizeBatchApplyState, sanitizeBatchSort, swapParties,
  type GroupJobCandidate, type ReconcileDoc, type StrongMatch,
} from "@/lib/jobs/capture-batch-reconcile";
import {
  EXTRACT_READING_TTL_MS, cleanupStaleBatches, createSession, deleteSessionRow, findExtract, listExtracts, putExtract,
  readSession, readSteps, removeStoragePaths, sessionPaths, setSessionStatus, tryLock, unlock, updateSession, writeStep,
  type BatchSession, type ExtractRow, type StepRow, type StoredExtract,
} from "@/lib/jobs/capture-store";
import {
  classifyPages, docAiInput, downloadFull, extractPdfPages, imagesToPdf, prepareBatchFiles, type PreparedBatch,
} from "@/lib/jobs/capture-files";
import {
  CAPTURE_BUCKET, CAPTURE_MAX_PAGES, captureEventMessage, chipByKey, chipFor, reviewToFinalDoc, sniffDocumentMime,
  type CaptureFileRef, type PartyMatchView, type ReviewOptions,
} from "@/lib/jobs/capture-review";
import type { CaptureDocKind, CustomerMatchCandidate, ExtractedBusinessDoc } from "@/lib/jobs/capture-types";
import { emptyExtracted, normalizeExtracted } from "@/lib/jobs/extracted-normalize";
import { docNumbersEqual, matchCustomer, matchJob, matchParty, type JobMatchCandidateExt } from "@/lib/jobs/matching";
import { recordTrainingExample } from "@/lib/jobs/training";
import { logJobEvent, type JobsDb } from "@/lib/jobs/events";
import { registerJobFileCore } from "@/lib/jobs/job-files-store";
import {
  advancePurchaseOrderStatus, findOrCreateSupplierByParty, findPurchaseOrderByNumber, insertSupplierQuote, isOurParty,
  selectWinningQuoteCore,
} from "@/lib/jobs/purchasing-store";
import { confirmDeliveryNoteCore, markJobPaidCore, setInvoiceInfoCore } from "@/lib/jobs/production-store";
import { upsertDrawingFromCapture } from "@/lib/jobs/drawings-store";
import { captureUuid } from "@/lib/jobs/capture-batch";
import { cleanNumber, isUuid, jobFilePath, stageEventMessage, todayIso } from "@/lib/jobs/mapping";
import { isForward, isJobStage } from "@/lib/jobs/stages";
import { plural } from "@/lib/jobs/deadlines";
import type { JobDetail } from "@/lib/jobs/types";
import type { JobFileKind, JobStage } from "@/lib/supabase/database.types";
import {
  SESSION_GONE, aiAvailability, analyzeSingle, applyBusinessDoc, begin, fail, loadSuppliers, message,
  type Ctx, type PrereadDoc,
} from "@/lib/jobs/capture-service";

/**
 * Dávkové focení — serverová orchestrace (relace v DB, servisní klíč, oprávnění hlídá každá funkce):
 *  analyzeBatch  → příprava souborů, roztřídění AI (souběžně s vytěžením u 2–4 stran), relace,
 *  extractBatchDoc → vytěžení jednoho dokladu (idempotentně, nezávisle na klientovi),
 *  buildBatchReview → skupiny zakázek a vzájemné doplnění (kontrola),
 *  applyBatch → uložení po skupinách a dokladech s deníkem a deterministickými klíči,
 *  discardBatch / batchSession / searchBatchJobs.
 */

type Row = Record<string, unknown>;

const BUSY = "Dávka se právě ukládá — chvíli počkej a zkus to znovu.";
const PREVIEW_TTL_S = 3600;
const DOC_ID_RE = /^(d\d{1,4}|u-[a-z0-9]{8})$/;
/** Odpověď kontroly se má vejít pod 1,5 MB i u velkých adresářů. */
const OPTIONS_BUDGET_BYTES = 1_100_000;

function bucket(db: JobsDb) {
  return db.storage.from(CAPTURE_BUCKET);
}

function ourIco(): string {
  return COMPANY.ico;
}

async function companyFresh(): Promise<void> {
  try { await refreshCompanyFromSettings(); } catch { /* výchozí údaje */ }
}

// ── Pomocné ─────────────────────────────────────────────────
function activeDocs(sort: BatchSort): BatchDocDraft[] {
  return sort.docs.filter((d) => !d.excluded);
}

const isDone = (r: ExtractRow | null | undefined) => r?.status === "ready" || r?.status === "manual";

/**
 * Vytěžení dokladu: přesně podle druhu, jinak stejné strany a stejný formulář — změna druhu
 * v rámci formuláře (potvrzení → faktura) se znovu nečte, obchodní doklad se jen srovná na nový druh.
 */
function extractRowFor(rows: ExtractRow[], d: BatchDocDraft): ExtractRow | null {
  const key = pagesKey(d.pageIds);
  const exact = findExtract(rows, d.id, key, d.type);
  if (isDone(exact)) return exact;
  const form = BATCH_TYPES[d.type].form;
  const same = rows.filter((r) => r.pagesKey === key && isDone(r) && r.data && BATCH_TYPES[r.docType].form === form);
  const other = same.find((r) => r.docId === d.id) ?? same[0];
  if (!other?.data) return exact;
  const ex = other.data.extract;
  const extract: BatchDocExtract = ex.kind === "business" ? { kind: "business", doc: alignDocType(ex.doc, d.type, true).doc } : ex;
  return { ...other, docId: d.id, docType: d.type, data: { ...other.data, extract } };
}

function fileOfPage(session: Pick<BatchSession, "files" | "pages">, pageId: string): BatchFile | null {
  const p = session.pages.find((x) => x.id === pageId);
  return p ? session.files.find((f) => f.id === p.fileId) ?? null : null;
}

function docFilenames(session: Pick<BatchSession, "files" | "pages">, pageIds: string[]): string[] {
  return [...new Set(pageIds.map((id) => fileOfPage(session, id)?.filename).filter((x): x is string => Boolean(x)))];
}

async function previewsOf(db: JobsDb, files: BatchFile[]): Promise<BatchPreview[]> {
  const paths = files.flatMap((f) => [f.path, ...(f.sortPath ? [f.sortPath] : [])]);
  const urls = new Map<string, string>();
  try {
    for (let i = 0; i < paths.length; i += 100) {
      const { data } = await bucket(db).createSignedUrls(paths.slice(i, i + 100), PREVIEW_TTL_S);
      for (const x of (data ?? []) as { path: string | null; signedUrl: string | null }[]) {
        if (x.path && x.signedUrl) urls.set(x.path, x.signedUrl);
      }
    }
  } catch {
    // náhledy jsou pohodlí
  }
  return files.map((f) => ({
    fileId: f.id, path: f.path, filename: f.filename, mimeType: f.mimeType, size: f.size,
    url: urls.get(f.path) ?? null, sortUrl: f.sortPath ? urls.get(f.sortPath) ?? null : null,
    pageCount: f.pageCount, format: f.format,
  }));
}

function summaryOf(row: ExtractRow, margins: boolean): DocExtractSummary {
  const meta = BATCH_TYPES[row.docType];
  const ex = row.data?.extract;
  let number = "";
  let confidence: number | null = null;
  let clarifications = 0;
  if (ex?.kind === "business") {
    number = ex.doc.documentNumber;
    confidence = row.data?.aiUsed ? ex.doc.confidence : null;
    clarifications = ex.doc.needsClarification.length;
  } else if (ex?.kind === "drawing") {
    number = [ex.drawing.drawingNumber, ex.drawing.revision ? `rev. ${ex.drawing.revision}` : ""].filter(Boolean).join(" ");
    confidence = row.data?.aiUsed ? ex.drawing.confidence : null;
    clarifications = ex.drawing.needsClarification.length;
  } else if (ex?.kind === "model") {
    number = ex.model.drawingNumber;
  }
  const party = ex?.kind === "business" ? (meta.side === "supplier" ? ex.doc.supplier.name : ex.doc.customer.name) : "";
  const title = [meta.label, number].filter(Boolean).join(" ") + (party ? ` · ${party}` : "");
  return {
    docId: row.docId, pagesKey: row.pagesKey, type: row.docType, status: row.status,
    error: row.error, aiUsed: Boolean(row.data?.aiUsed), title: margins || meta.side !== "supplier" ? title : redactPrices(title),
    documentNumber: number, confidence, clarifications,
  };
}

/** Souhrny vytěžení pro doklady aktuálního roztřídění. */
function summariesFor(sort: BatchSort, rows: ExtractRow[], margins: boolean): DocExtractSummary[] {
  const out: DocExtractSummary[] = [];
  for (const d of activeDocs(sort)) {
    const r = extractRowFor(rows, d);
    if (r) out.push({ ...summaryOf(r, margins), docId: d.id });
  }
  return out;
}

function warningsFromStrings(list: string[]): BatchWarning[] {
  return list.map((m) => makeWarning("sort_uncertain", "info", [], m));
}

function noteWarning(n: string): BatchWarning {
  return makeWarning("sort_uncertain", "info", [], n.slice(0, 300));
}

// ── Párování (zákazník, dodavatel) ──────────────────────────
interface MatchData {
  jobs: JobMatchCandidateExt[];
  customers: CustomerMatchCandidate[];
  suppliers: CustomerMatchCandidate[];
}

async function loadMatchData(db: JobsDb): Promise<MatchData> {
  const [cand, suppliers] = await Promise.all([getMatchingCandidates(), loadSuppliers(db)]);
  return { jobs: cand.jobs, customers: cand.customers, suppliers };
}

function partyMatches(doc: ExtractedBusinessDoc, type: BatchDocType, m: MatchData): { customerMatch: PartyMatchView | null; supplierMatch: PartyMatchView | null } {
  const side = sideOf(type);
  const cm = doc.customer.name || doc.customer.ico
    ? matchCustomer(doc.customer, m.customers, { supplierNumberAtCustomer: side === "customer" ? doc.supplierNumberAtCustomer : undefined })
    : null;
  const sm = side === "supplier" && (doc.supplier.name || doc.supplier.ico) ? matchParty(doc.supplier, m.suppliers) : null;
  return {
    customerMatch: cm ? { ...cm, name: m.customers.find((x) => x.id === cm.id)?.name ?? "" } : null,
    supplierMatch: sm ? { ...sm, name: m.suppliers.find((x) => x.id === sm.id)?.name ?? "" } : null,
  };
}

// ── 1) Čtení dávky ──────────────────────────────────────────
export interface AnalyzeBatchOptions {
  fixedJobId: string | null;
  expectedKind: CaptureDocKind | null;
  signal: AbortSignal | null;
}

function refsOf(prep: PreparedBatch): CaptureFileRef[] {
  return prep.files.map((f) => ({ path: f.path, filename: f.filename, mimeType: f.mimeType, size: f.size, ...(f.sortPath ? { sortPath: f.sortPath } : {}) }));
}

function isSingleBusiness(sort: BatchSort, prep: PreparedBatch): boolean {
  const docs = activeDocs(sort);
  if (docs.length !== 1 || sort.excludedPageIds.length || sort.docs.length !== 1) return false;
  if (prep.pages.some((p) => p.source === "file") || prep.files.some((f) => f.fromZip)) return false;
  if (prep.files.length > CAPTURE_MAX_PAGES) return false;
  const t = docs[0].type;
  return isBusinessType(t) && t !== "nabidka_dodavatel";
}

async function readWhole(
  prep: PreparedBatch,
  pageIds: string[],
  opts: { deadline: number; signal: AbortSignal | null; hintKind?: CaptureDocKind | null; hintJob?: { jobNumber: string; customerName?: string } | null },
): Promise<{ ok: true; doc: ExtractedBusinessDoc; usage: AiUsage | null; notes: string[] } | { ok: false; error: string; failure: AiFailure }> {
  try {
    const input = await docAiInput(prep.files, prep.pages, pageIds, async (f) => prep.contents.get(f.id) ?? null);
    const notes: string[] = [];
    if (input.skipped) notes.push(`AI nepřečetla ${input.skipped} ${plural(input.skipped, "stránku", "stránky", "stránek")} (nepodporovaný formát nebo příliš velká fotka) — zkontroluj údaje ručně.`);
    if (input.truncated) notes.push("Doklad je pro AI příliš velký — AI četla jen část stránek, zbytek zkontroluj ručně.");
    if (!input.files.length && !isFakeCapture()) return { ok: false, error: "AI umí číst fotky (JPG, PNG, WEBP) a PDF — tenhle formát ne. Vyplň údaje ručně podle náhledu.", failure: "invalid_request" };
    const tag = fakeTagFor(docFilenames(prep, pageIds));
    const res = await readBusinessDocumentDetailed({
      files: input.files,
      hint: opts.hintKind || opts.hintJob
        ? { ...(opts.hintKind ? { expectedKind: opts.hintKind } : {}), ...(opts.hintJob ? { jobNumber: opts.hintJob.jobNumber, customerName: opts.hintJob.customerName } : {}) }
        : undefined,
      deadline: opts.deadline,
      clientSignal: opts.signal,
      ...(tag ? { fake: tag } : {}),
    });
    return { ok: true, doc: res.doc, usage: res.usage, notes };
  } catch (err) {
    return { ok: false, error: aiFailureMessage(err), failure: classifyAiError(err) };
  }
}

/** Odpověď /analyze: jeden doklad = dnešní tok, jinak dávka. */
export async function analyzeBatch(c: Ctx, files: CaptureFileRef[], opts: AnalyzeBatchOptions) {
  const { db, user, access, margins } = c;
  const deadline = routeDeadline();
  await cleanupStaleBatches(db, user.id, (s) => attachPendingDocs(c, s));
  await companyFresh();
  const [ai, mode, fixedJob] = await Promise.all([
    aiAvailability(access),
    getModuleMode("capture"),
    opts.fixedJobId ? getJob(opts.fixedJobId) : Promise.resolve(null),
  ]);
  if (opts.fixedJobId && !fixedJob) return fail("Zakázka nenalezena.");
  const prep = await prepareBatchFiles(db, user.id, files);
  if (!prep.files.length) return fail("Soubory se nepodařilo načíst z úložiště — nahraj je prosím znovu.");
  const expectedType = opts.expectedKind ? batchTypeFor(opts.expectedKind, opts.expectedKind === "poptavka" || opts.expectedKind === "objednavka" ? "zakaznik" : "neznamy") : null;
  const visual = prep.pages.filter((p) => p.source !== "file");
  const readable = visual.filter((p) => prep.files.find((f) => f.id === p.fileId)?.aiReadable);
  const hasZip = prep.files.some((f) => f.fromZip) || prep.removePaths.length > 0;
  const single = (preread: PrereadDoc | null) => analyzeSingle(c, refsOf(prep), { fixedJobId: opts.fixedJobId, expectedKind: opts.expectedKind, signal: opts.signal, preread });

  let sort: BatchSort;
  let pages = prep.pages;
  let warnings: BatchWarning[] = warningsFromStrings(prep.warnings);
  let aiFailure: AiFailure | null = null;
  let reason: string | null = ai.reason;
  let classifyUsage: AiUsage | null = null;
  let sortSource: "ai" | "default" = "default";
  let whole: { doc: ExtractedBusinessDoc; usage: AiUsage | null; pageIds: string[] } | null = null;
  let mdCache: MatchData | null = null;
  const getMd = async () => (mdCache ??= await loadMatchData(db));
  const hintJob = fixedJob ? { jobNumber: fixedJob.number, customerName: fixedJob.customer?.name } : null;

  if (!ai.available) {
    sort = defaultSortWithoutAi(prep.files, prep.pages, "manual", { expectedType });
    const only = activeDocs(sort);
    const loose = only.length === 1 && (isBusinessType(only[0].type) || only[0].type === "ostatni") && only[0].type !== "nabidka_dodavatel";
    if (loose && !prep.pages.some((p) => p.source === "file") && !hasZip && prep.files.length <= CAPTURE_MAX_PAGES) return single(null);
  } else if (readable.length <= 1 && !hasZip) {
    sort = defaultSortWithoutAi(prep.files, prep.pages, "manual", { expectedType });
    const tag = readable.length === 1 ? fakeTagFor(docFilenames(prep, [readable[0].id])) : null;
    if (tag && !isBusinessType(tag.type)) {
      // testovací háček: výkres / fotka podle značky (vytěží se jako doklad dávky)
      const d = sort.docs.find((x) => x.pageIds.includes(readable[0].id));
      if (d) { d.type = tag.type; d.aiType = tag.type; }
      sortSource = "ai";
    } else if (readable.length === 1) {
      const res = await readWhole(prep, [readable[0].id], { deadline, signal: opts.signal, hintKind: opts.expectedKind, hintJob });
      const onlyVisual = visual.length === 1 && !prep.pages.some((p) => p.source === "file") && prep.files.length === 1;
      if (res.ok) {
        const type = batchTypeFor(res.doc.docKind, res.doc.issuer);
        if (onlyVisual && isBusinessType(type) && type !== "nabidka_dodavatel") {
          return single({ doc: res.doc, aiUsed: true, reason: null, notes: res.notes });
        }
        const d = sort.docs.find((x) => x.pageIds.includes(readable[0].id));
        if (d) {
          d.type = type;
          d.aiType = type;
          d.documentNumber = res.doc.documentNumber;
          d.confidence = res.doc.confidence;
          d.title = [BATCH_TYPES[type].label, res.doc.documentNumber].filter(Boolean).join(" ");
          if (isBusinessType(type)) whole = { doc: res.doc, usage: res.usage, pageIds: d.pageIds };
        }
        sortSource = "ai";
      } else {
        aiFailure = res.failure;
        if (onlyVisual) return single({ doc: emptyExtracted(), aiUsed: false, reason: `AI doklad nepřečetla (${res.error.replace(/\.$/, "")}). Vyplň údaje ručně podle náhledu.`, notes: [] });
        warnings.push(makeWarning("ai_failed", "warn", [], `AI doklad nepřečetla — ${res.error}`));
      }
    } else if (visual.length === 1 && !prep.pages.some((p) => p.source === "file") && prep.files.length === 1) {
      return single(null);
    }
  } else {
    const cls = await classifyPages(prep, CLASSIFY_MAX_PAGES);
    const concurrent = readable.length >= 2 && readable.length <= 4 && !hasZip;
    const [res, wholeRes] = await Promise.all([
      classifyBatch({ files: prep.files, pages: prep.pages, sent: cls.sent, fileNotes: cls.notes, deadline, clientSignal: opts.signal }),
      concurrent ? readWhole(prep, readable.map((p) => p.id), { deadline, signal: opts.signal, hintKind: opts.expectedKind, hintJob }) : Promise.resolve(null),
    ]);
    const md = await getMd();
    classifyUsage = res.usage;
    if (res.raw) {
      const norm = normalizeClassification(res.raw, prep.pages, prep.files, {
        ourIco: ourIco(),
        customerIcos: md.customers.map((x) => x.ico ?? "").filter(Boolean),
        supplierIcos: md.suppliers.map((x) => x.ico ?? "").filter(Boolean),
        sentPageIds: res.sentPageIds,
        truncatedPageIds: [...cls.truncated, ...cls.sent.map((p) => p.pageId).filter((id) => !res.sentPageIds.includes(id))],
        margins,
        headNumbers: prep.headNumbers,
      });
      sort = norm.sort;
      pages = norm.pages;
      warnings.push(...norm.warnings);
      if (res.raw.notes.length) warnings.push(...res.raw.notes.slice(0, 5).map((n) => noteWarning(margins ? n : redactPrices(n))));
      sortSource = "ai";
    } else {
      aiFailure = res.failure;
      sort = defaultSortWithoutAi(prep.files, prep.pages, "ai_failed", { expectedType });
      warnings.push(makeWarning(
        "ai_failed", "warn", [],
        `AI stránky neroztřídila (${AI_FAILURE_MESSAGE[res.failure ?? "other"].replace(/\.$/, "")}) — zkontroluj roztřídění.`,
        [],
      ));
      if (res.failure === "spend_limit" || res.failure === "auth") reason = AI_FAILURE_MESSAGE[res.failure];
    }
    // jeden obchodní doklad → dnešní tok (s hotovým vytěžením, je-li)
    if (isSingleBusiness(sort, prep) && activeDocs(sort)[0].pageIds.length === visual.length && aiFailure === null) {
      if (wholeRes?.ok) return single({ doc: wholeRes.doc, aiUsed: true, reason: null, notes: wholeRes.notes });
      if (wholeRes && !wholeRes.ok) {
        return single({ doc: emptyExtracted(), aiUsed: false, reason: `AI doklad nepřečetla (${wholeRes.error.replace(/\.$/, "")}). Vyplň údaje ručně podle náhledu.`, notes: [] });
      }
      const later = await readWhole(prep, activeDocs(sort)[0].pageIds, { deadline, signal: opts.signal, hintKind: opts.expectedKind, hintJob });
      if (later.ok) return single({ doc: later.doc, aiUsed: true, reason: null, notes: later.notes });
      return single({ doc: emptyExtracted(), aiUsed: false, reason: `AI doklad nepřečetla (${later.error.replace(/\.$/, "")}). Vyplň údaje ručně podle náhledu.`, notes: [] });
    }
    // souběžné vytěžení platí pro doklad, který pokrývá všechny čitelné strany
    if (wholeRes?.ok) {
      const ids = readable.map((p) => p.id);
      const d = activeDocs(sort).find((x) => isBusinessType(x.type) && x.pageIds.length === ids.length && ids.every((id) => x.pageIds.includes(id)));
      if (d) whole = { doc: wholeRes.doc, usage: wholeRes.usage, pageIds: d.pageIds };
    }
  }

  // relace dávky
  const captureId = crypto.randomUUID();
  const session: BatchSession = {
    v: 2,
    captureId,
    userId: user.id.toLowerCase(),
    createdAt: new Date().toISOString(),
    files: prep.files,
    pages,
    aiUsed: ai.available,
    reason,
    aiFailure,
    aiSort: sort,
    sortWarnings: uniqueWarnings(warnings),
    fixedJobId: opts.fixedJobId,
    expectedKind: opts.expectedKind,
    classifyUsage,
    lastSort: null,
    headNumbers: prep.headNumbers,
    sortSource,
  };
  const err = await createSession(db, session);
  if (err) return fail(`Dávku se nepodařilo připravit: ${message(err)}`);
  if (prep.removePaths.length) await removeStoragePaths(db, prep.removePaths);

  // hotová vytěžení (souběh / jeden doklad) a deterministické doklady
  const extracts: DocExtractSummary[] = [];
  if (whole) {
    const d = activeDocs(sort).find((x) => pagesKey(x.pageIds) === pagesKey(whole!.pageIds));
    if (d) {
      const doc = alignDocType(whole.doc, d.type, false);
      const stored: StoredExtract = { extract: { kind: "business", doc: doc.doc }, ...partyMatches(doc.doc, d.type, await getMd()), docKind: doc.doc.docKind, issuer: doc.doc.issuer, aiUsed: true, note: null };
      await putExtract(db, captureId, { docId: d.id, pagesKey: pagesKey(d.pageIds), docType: d.type, status: "ready", data: stored, usage: whole.usage, restart: true });
      extracts.push(summaryOf({ docId: d.id, pagesKey: pagesKey(d.pageIds), docType: d.type, status: "ready", data: stored, error: null, usage: whole.usage, startedAt: "", updatedAt: "" }, margins));
    }
  }
  const model: BatchSortModel = {
    captureId,
    aiUsed: ai.available,
    reason,
    aiFailure,
    mode: mode === "full" ? "full" : "approval",
    margins,
    drawingsAccess: access.can("drawings"),
    fixedJobId: opts.fixedJobId,
    fixedJobNumber: fixedJob?.number ?? null,
    files: prep.files,
    pages,
    previews: await previewsOf(db, prep.files),
    sort,
    warnings: session.sortWarnings,
    extracts,
    skipSort: activeDocs(sort).length < 2,
  };
  return { ok: true as const, batch: model };
}

/** Obnova rozpracovaného focení (Pokračovat). */
export async function batchSession(c: Ctx, captureId: string): Promise<{ ok: true; batch: BatchSortModel; extracts: DocExtractSummary[] } | { ok: false; error: string }> {
  const s = await readSession(c.db, c.user.id, captureId);
  if (!s) return fail(SESSION_GONE);
  const { session } = s;
  const mode = await getModuleMode("capture");
  const sort = session.lastSort ?? session.aiSort;
  const rows = await listExtracts(c.db, session.captureId);
  const extracts = summariesFor(sort, rows, c.margins);
  const fixedJob = session.fixedJobId ? await getJob(session.fixedJobId) : null;
  return {
    ok: true,
    batch: {
      captureId: session.captureId,
      aiUsed: session.aiUsed,
      reason: session.reason,
      aiFailure: session.aiFailure,
      mode: mode === "full" ? "full" : "approval",
      margins: c.margins,
      drawingsAccess: c.access.can("drawings"),
      fixedJobId: session.fixedJobId,
      fixedJobNumber: fixedJob?.number ?? null,
      files: session.files,
      pages: session.pages,
      previews: await previewsOf(c.db, session.files),
      sort,
      warnings: session.sortWarnings,
      extracts,
      skipSort: activeDocs(sort).length < 2,
    },
    extracts,
  };
}

// ── 2) Vytěžení dokladu ─────────────────────────────────────
/** Druh dokladu z vytěžení sladit s druhem z roztřídění (typ z roztřídění / od uživatele platí). */
function alignDocType(doc: ExtractedBusinessDoc, type: BatchDocType, userFixed: boolean): { doc: ExtractedBusinessDoc; conflict: BatchDocType | null } {
  const meta = BATCH_TYPES[type];
  if (!meta.docKind || !meta.issuer) return { doc, conflict: null };
  const read = batchTypeFor(doc.docKind, doc.issuer);
  if (read === type) return { doc, conflict: null };
  const sameSide = sideOf(read) === meta.side;
  const fixed = sameSide ? { ...doc, docKind: meta.docKind, issuer: meta.issuer } : swapParties(doc, ourIco(), type);
  return { doc: fixed, conflict: userFixed ? null : read };
}

async function sessionFileContent(db: JobsDb, f: BatchFile): Promise<Uint8Array | null> {
  return downloadFull(db, f.path);
}

export async function extractBatchDoc(
  c: Ctx,
  input: { captureId: string; docId: string; type: string; pageIds: unknown; force?: boolean },
): Promise<{ ok: true; summary: DocExtractSummary } | { ok: false; error: string }> {
  const s = await readSession(c.db, c.user.id, input.captureId);
  if (!s) return fail(SESSION_GONE);
  const { session } = s;
  if (!DOC_ID_RE.test(input.docId ?? "")) return fail("Neplatný doklad.");
  if (!isBatchDocType(input.type)) return fail("Neznámý druh dokladu.");
  const type = input.type;
  const pageIds = Array.isArray(input.pageIds) ? input.pageIds.filter((x): x is string => typeof x === "string") : [];
  if (!pageIds.length || new Set(pageIds).size !== pageIds.length) return fail("Doklad nemá žádnou stránku.");
  if (pageIds.some((id) => !session.pages.some((p) => p.id === id))) return fail("Stránka nepatří k této dávce.");
  const key = pagesKey(pageIds);
  const db = c.db;
  const rows = await listExtracts(db, session.captureId);
  const existing = rows.find((r) => r.docId === input.docId && r.pagesKey === key && r.docType === type)
    ?? findExtract(rows, input.docId, key, type);
  if (existing && !input.force) {
    if (existing.status === "ready" || existing.status === "manual") return { ok: true, summary: { ...summaryOf(existing, c.margins), docId: input.docId } };
    if (existing.status === "reading" && Date.now() - Date.parse(existing.startedAt) < EXTRACT_READING_TTL_MS) {
      return { ok: true, summary: { ...summaryOf(existing, c.margins), docId: input.docId, status: "reading" } };
    }
  }
  await putExtract(db, session.captureId, { docId: input.docId, pagesKey: key, docType: type, status: "reading", restart: true });
  const meta = BATCH_TYPES[type];
  const deadline = routeDeadline();
  const ai = await aiAvailability(c.access);
  const aiDoc = session.aiSort.docs.find((d) => pagesKey(d.pageIds) === key);
  const userFixed = Boolean(aiDoc && aiDoc.type !== type) || !aiDoc;
  const names = docFilenames(session, pageIds);
  let stored: StoredExtract;
  let status: "ready" | "manual" | "error" = "ready";
  let error: string | null = null;
  let usage: AiUsage | null = null;
  try {
    await companyFresh();
    if (meta.form === "business" || meta.form === "drawing") {
      const files = await docAiInput(session.files, session.pages, pageIds, (f) => sessionFileContent(db, f));
      const note = files.skipped ? `AI nepřečetla ${files.skipped} ${plural(files.skipped, "stránku", "stránky", "stránek")} — zkontroluj ručně.` : null;
      if (!ai.available || (!files.files.length && !isFakeCapture())) {
        status = "manual";
        const reason = !ai.available ? ai.reason : fileOfPage(session, pageIds[0])?.aiSkipReason ?? "AI tenhle soubor nepřečte — vyplň ručně.";
        stored = meta.form === "business"
          ? { extract: { kind: "business", doc: { ...emptyExtracted(), docKind: meta.docKind!, issuer: meta.issuer! } }, customerMatch: null, supplierMatch: null, docKind: meta.docKind, issuer: meta.issuer, aiUsed: false, note: reason }
          : { extract: { kind: "drawing", drawing: drawingFromName(names[0] ?? "") }, customerMatch: null, supplierMatch: null, docKind: "vykres", issuer: null, aiUsed: false, note: reason };
      } else if (meta.form === "business") {
        const others = (session.lastSort ?? session.aiSort).docs.filter((d) => !d.excluded && pagesKey(d.pageIds) !== key);
        const batchContext: BatchContextLine[] = others.slice(0, 12).map((d) => ({
          label: BATCH_TYPES[d.type].label, documentNumber: d.documentNumber,
          partyName: c.margins || sideOf(d.type) !== "supplier" ? d.partyName : "",
        }));
        const res = await readBusinessDocumentDetailed({
          files: files.files,
          hint: {
            batchLabel: meta.label, expectedKind: meta.docKind ?? undefined, expectedIssuer: meta.issuer ?? undefined,
            issuerFixed: userFixed, batchContext,
          },
          deadline,
          clientSignal: null,
          fake: { type, group: fakeGroupFor(type, names) },
        });
        usage = res.usage;
        const aligned = alignDocType(res.doc, type, userFixed);
        const md = await loadMatchData(db);
        stored = {
          extract: { kind: "business", doc: aligned.doc }, ...partyMatches(aligned.doc, type, md),
          docKind: aligned.doc.docKind, issuer: aligned.doc.issuer, aiUsed: true,
          note: [note, aligned.conflict ? `AI při čtení dokladu odhadla „${BATCH_TYPES[aligned.conflict].label}"` : null].filter(Boolean).join(" · ") || null,
          truncated: files.truncated,
        };
      } else {
        const res = await readDrawing({ files: files.files, deadline, clientSignal: null, fake: { type, group: fakeGroupFor(type, names) } });
        usage = res.usage;
        const fromName = drawingFromName(names[0] ?? "");
        stored = {
          extract: { kind: "drawing", drawing: { ...res.drawing, drawingNumber: res.drawing.drawingNumber || fromName.drawingNumber, revision: res.drawing.revision || fromName.revision } },
          customerMatch: null, supplierMatch: null, docKind: "vykres", issuer: null, aiUsed: true, note,
        };
      }
    } else if (meta.form === "model") {
      const f = fileOfPage(session, pageIds[0]);
      const number = aiDoc?.documentNumber || session.headNumbers?.[f?.id ?? ""] || drawingNumberFromFilename(f?.filename ?? "");
      const m: ModelMeta = { format: f?.format ?? null, drawingNumber: number, revision: revisionFromFilename(f?.filename ?? ""), title: "" };
      stored = { extract: { kind: "model", model: m }, customerMatch: null, supplierMatch: null, docKind: null, issuer: null, aiUsed: false, note: null };
    } else {
      stored = { extract: { kind: "none" }, customerMatch: null, supplierMatch: null, docKind: null, issuer: null, aiUsed: false, note: null };
    }
  } catch (err) {
    status = "error";
    error = aiFailureMessage(err);
    stored = { extract: { kind: "none" }, customerMatch: null, supplierMatch: null, docKind: null, issuer: null, aiUsed: false, note: null };
  }
  // relace mezitím zahozená → nic neukládat
  const still = await readSession(db, c.user.id, session.captureId);
  if (!still) return fail(SESSION_GONE);
  await putExtract(db, session.captureId, {
    docId: input.docId, pagesKey: key, docType: type, status,
    data: status === "error" ? null : stored, error, usage,
  });
  const summary = summaryOf({
    docId: input.docId, pagesKey: key, docType: type, status, data: status === "error" ? null : stored, error, usage, startedAt: "", updatedAt: "",
  }, c.margins);
  return { ok: true, summary };
}

function drawingFromName(name: string) {
  return {
    drawingNumber: drawingNumberFromFilename(name), revision: revisionFromFilename(name), title: "", material: "", dimensions: "",
    weightKg: 0, generalTolerance: "", tightestTolerance: "", surface: "", heatTreatment: "", surfaceTreatment: "", quantity: 0,
    customerName: "", drawingDate: "", sheet: "", scale: "", notes: "", summary: "", confidence: 0, needsClarification: [],
  };
}

// ── 3) Kontrola ─────────────────────────────────────────────
interface ReviewContext {
  session: BatchSession;
  sort: BatchSort;
  rows: ExtractRow[];
  md: MatchData;
  docs: ReconcileDoc[];
  typeConflicts: BatchWarning[];
}

/** Silná shoda podle přesných čísel (matchJob ≥ 88, naše objednávka dodavateli, číslo faktury / DL). */
async function strongMatchOf(db: JobsDb, type: BatchDocType, doc: ExtractedBusinessDoc, md: MatchData, customerId: string | null, supplierId: string | null): Promise<StrongMatch | null> {
  const m = matchJob(doc, md.jobs, { customerId, supplierId });
  if (m.best && m.best.score >= 88) return { jobId: m.best.jobId, jobNumber: m.best.jobNumber, reason: m.best.reason, score: m.best.score };
  if (sideOf(type) === "supplier") {
    const po = doc.customerOrderNumber || (type === "objednavka_my" ? doc.documentNumber : "");
    if (po) {
      const hit = await findPurchaseOrderByNumber(db, po);
      if (hit) {
        const job = md.jobs.find((j) => j.id === hit.jobId);
        return { jobId: hit.jobId, jobNumber: job?.number ?? hit.number, reason: `podle naší objednávky ${hit.number}`, score: 92 };
      }
    }
  }
  if ((type === "faktura_my" || type === "dodaci_list_my") && doc.documentNumber) {
    const col = type === "faktura_my" ? "invoice_number" : "delivery_note_number";
    const { data } = await db.from("orders").select("id, number").eq(col, doc.documentNumber).limit(2);
    const rows = (data ?? []) as { id: string; number: string }[];
    if (rows.length === 1) return { jobId: rows[0].id, jobNumber: rows[0].number, reason: `podle čísla ${type === "faktura_my" ? "faktury" : "dodacího listu"} ${doc.documentNumber}`, score: 90 };
  }
  return null;
}

async function reviewContext(c: Ctx, session: BatchSession, sort: BatchSort): Promise<ReviewContext> {
  const db = c.db;
  const [rows, md] = await Promise.all([listExtracts(db, session.captureId), loadMatchData(db)]);
  const docs: ReconcileDoc[] = [];
  const typeConflicts: BatchWarning[] = [];
  for (const d of activeDocs(sort)) {
    // stejné strany, jiný druh téhož formuláře = bez nového čtení (extractRowFor)
    const row = extractRowFor(rows, d);
    const extract: BatchDocExtract | null = isDone(row) ? row?.data?.extract ?? null : null;
    const data = row?.data ?? null;
    const files = docFilenames(session, d.pageIds);
    let strong: StrongMatch | null = null;
    if (extract?.kind === "business") {
      strong = await strongMatchOf(db, d.type, extract.doc, md, data?.customerMatch?.id ?? null, data?.supplierMatch?.id ?? null);
    }
    if (data?.truncated) {
      typeConflicts.push(makeWarning("pages_truncated", "warn", [d.id], `${BATCH_TYPES[d.type].label}: AI četla jen prvních 20 fotek — zbytek zkontroluj ručně.`));
    }
    if (data?.note && /odhadla/.test(data.note) && d.type === d.aiType) {
      typeConflicts.push(makeWarning("sort_uncertain", "warn", [d.id], `${BATCH_TYPES[d.type].label}: ${data.note}`));
    }
    const docNo = extract?.kind === "business" ? extract.doc.documentNumber || d.documentNumber
      : extract?.kind === "drawing" ? extract.drawing.drawingNumber || d.documentNumber
        : extract?.kind === "model" ? extract.model.drawingNumber || d.documentNumber : d.documentNumber;
    docs.push({
      id: d.id,
      type: d.type,
      flags: d.flags,
      documentNumber: docNo,
      drawingNumbers: d.drawingNumbers,
      title: d.title,
      filename: files[0] ?? "",
      aiType: d.aiType,
      extract,
      aiUsed: Boolean(data?.aiUsed),
      reason: row?.status === "error" ? row.error : data?.note ?? (data?.aiUsed ? null : session.reason),
      confidence: data?.aiUsed && extract?.kind === "business" ? extract.doc.confidence : data?.aiUsed && extract?.kind === "drawing" ? extract.drawing.confidence : null,
      customerMatch: data?.customerMatch ?? null,
      supplierMatch: data?.supplierMatch ?? null,
      strongMatch: strong,
    });
  }
  return { session, sort, rows, md, docs, typeConflicts };
}

async function candidateJobs(
  ctx: ReviewContext,
  docs: ReconcileDoc[],
  groupTarget: string | null,
  override: string | null,
  fixedJobId: string | null,
): Promise<GroupJobCandidate[]> {
  const picks: { id: string; reason: string | null; score: number | null }[] = [];
  const add = (id: string | null | undefined, reason: string | null, score: number | null) => {
    if (id && isUuid(id) && !picks.some((p) => p.id === id)) picks.push({ id, reason, score });
  };
  if (override && override !== "new") add(override, "vybráno ručně", null);
  if (groupTarget) {
    const strong = docs.map((d) => d.strongMatch).find((s) => s?.jobId === groupTarget);
    add(groupTarget, groupTarget === fixedJobId ? "doklad nahráváš u této zakázky" : strong?.reason ?? null, groupTarget === fixedJobId ? null : strong?.score ?? null);
  }
  const gd = groupDocOf(docs, ourIco());
  const primary = docs.find((d) => d.id === gd.primaryId) ?? null;
  if (primary?.extract?.kind === "business") {
    const m = matchJob(gd.doc, ctx.md.jobs, { customerId: primary.customerMatch?.id ?? null, supplierId: primary.supplierMatch?.id ?? null });
    if (m.best) add(m.best.jobId, m.best.reason, m.best.score);
    for (const a of m.alternatives) add(a.jobId, a.reason, a.score);
  }
  // výkresy / dodavatelské doklady bez zákazníka: zakázky se stejným výkresem (jen nabídka)
  const nums = docs.flatMap((d) => [...d.drawingNumbers, ...(d.extract?.kind === "drawing" ? [d.extract.drawing.drawingNumber] : []), ...(d.extract?.kind === "model" ? [d.extract.model.drawingNumber] : [])]).filter(Boolean);
  if (nums.length) {
    for (const j of ctx.md.jobs) {
      if (picks.length >= 5) break;
      const hit = nums.find((n) => j.drawingNumbers.some((x) => docNumbersEqual(x, n)));
      if (hit) add(j.id, `stejný výkres ${hit}`, 50);
    }
  }
  const jobs = await Promise.all(picks.slice(0, 5).map((p) => getJob(p.id)));
  const out: GroupJobCandidate[] = [];
  picks.slice(0, 5).forEach((p, i) => {
    const j = jobs[i];
    if (j) out.push({ job: j, reason: p.reason, score: p.score });
  });
  return out;
}

/** Dříve uložené doklady (stejné číslo / hash) — výchozí „Neukládat znovu". */
async function duplicatesOf(db: JobsDb, session: BatchSession, docs: ReconcileDoc[], targetJobs: Map<string, JobDetail>): Promise<Record<string, DuplicateRef>> {
  const out: Record<string, DuplicateRef> = {};
  for (const d of docs) {
    const meta = BATCH_TYPES[d.type];
    const f = fileOfPageOfDoc(session, d);
    const kind: JobFileKind = meta.fileKind;
    const num = d.documentNumber;
    let hit: { id: string; job_id: string; created_at: string } | null = null;
    const notThisCapture = `capture_id.is.null,capture_id.neq.${session.captureId}`;
    let weak = false;
    if (num && meta.form === "business") {
      // obchodní doklad stejného druhu, vystavitele a strany (IČO / název) — i u jiné zakázky;
      // jen stejné číslo bez ověřitelné strany = slabá shoda (jen upozornit)
      const { data } = await db.from("job_files").select("id, job_id, created_at, ai_extracted")
        .eq("kind", kind).eq("ai_extracted->>documentNumber", num).or(notThisCapture).limit(20);
      const party = d.extract?.kind === "business" ? (meta.side === "supplier" ? d.extract.doc.supplier : d.extract.doc.customer) : null;
      let weakHit: { id: string; job_id: string; created_at: string } | null = null;
      for (const r of (data ?? []) as { id: string; job_id: string; created_at: string; ai_extracted: Record<string, unknown> | null }[]) {
        const same = sameDocParty(r.ai_extracted, meta, party);
        if (same === "yes") { hit = r; break; }
        if (same === "unknown" && !weakHit) weakHit = r;
      }
      if (!hit && weakHit) { hit = weakHit; weak = true; }
    }
    if (num && (meta.form === "drawing" || meta.form === "model") && targetJobs.size) {
      // výkres / model stejného čísla a revize (formátu) jen u cílové zakázky (ne z této dávky)
      {
        const { data: dr } = await db.from("job_files").select("id, job_id, created_at, ai_extracted")
          .eq("kind", kind).eq("ai_extracted->>drawingNumber", num).or(notThisCapture).limit(20);
        const rev = d.extract?.kind === "drawing" ? d.extract.drawing.revision : d.extract?.kind === "model" ? d.extract.model.revision : "";
        const fmt = d.extract?.kind === "model" ? d.extract.model.format : null;
        hit = ((dr ?? []) as { id: string; job_id: string; created_at: string; ai_extracted: Record<string, unknown> | null }[])
          .find((r) => targetJobs.has(r.job_id) && String(r.ai_extracted?.revision ?? "").toUpperCase() === rev.toUpperCase()
            && (meta.form !== "model" || (r.ai_extracted?.format ?? null) === fmt)) ?? null;
      }
    }
    if ((!hit || weak) && f?.sha256 && !f.sha256.startsWith("p:")) {
      // stejný obsah: obchodní doklad kdekoli, výkres / model jen u cílové zakázky
      const { data } = await db.from("job_files").select("id, job_id, created_at").eq("content_sha256", f.sha256).or(notThisCapture).limit(20);
      const rows = (data ?? []) as { id: string; job_id: string; created_at: string }[];
      const same = (meta.form === "business" ? rows[0] : rows.find((r) => targetJobs.has(r.job_id))) ?? null;
      if (same) { hit = same; weak = false; }
    }
    if (!hit && meta.form === "business" && num && d.type === "faktura_my") {
      // číslo faktury zapsané u zakázky, ale bez souboru → jen upozornit (soubor se hodí uložit)
      const { data } = await db.from("orders").select("id, number, invoice_date").eq("invoice_number", num).limit(1);
      const o = ((data ?? []) as { id: string; number: string; invoice_date: string | null }[])[0];
      if (o) out[d.id] = { jobId: o.id, jobNumber: o.number, fileId: null, what: `Faktura ${num}`, date: o.invoice_date ?? "", weak: true };
      continue;
    }
    if (!hit) continue;
    const { data: job } = await db.from("orders").select("id, number").eq("id", hit.job_id).maybeSingle();
    const j = job as { id: string; number: string } | null;
    if (!j) continue;
    out[d.id] = {
      jobId: j.id, jobNumber: j.number, fileId: hit.id, what: `${meta.label}${num ? ` ${num}` : ""}`,
      date: new Date(hit.created_at).toLocaleDateString("cs-CZ", { timeZone: "Europe/Prague" }),
      ...(weak ? { weak: true } : {}),
    };
  }
  return out;
}

function fileOfPageOfDoc(session: BatchSession, d: Pick<ReconcileDoc, "id">): BatchFile | null {
  const sort = session.lastSort ?? session.aiSort;
  const draft = sort.docs.find((x) => x.id === d.id);
  return draft ? fileOfPage(session, draft.pageIds[0]) : null;
}

async function archiveConflictsOf(db: JobsDb, docs: ReconcileDoc[], customerId: string | null): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!customerId) return out;
  for (const d of docs) {
    if (d.type !== "vykres") continue;
    const num = d.extract?.kind === "drawing" ? d.extract.drawing.drawingNumber || d.documentNumber : d.documentNumber;
    if (!num) continue;
    const rev = (d.extract?.kind === "drawing" ? d.extract.drawing.revision : "").trim() || "-";
    const { data } = await db.from("drawings").select("id, revision, customer_id").eq("drawing_number", num);
    const hit = ((data ?? []) as { revision: string; customer_id: string | null }[]).find((r) => r.revision.toLowerCase() === rev.toLowerCase());
    if (hit && hit.customer_id && hit.customer_id !== customerId) out[d.id] = `Číslo ${num} ${rev} je v archivu u jiného zákazníka.`;
  }
  return out;
}

/** ReviewOptions do limitu velikosti odpovědi (zákazníci skupin a nedávných zakázek vždy). */
function trimOptions(opts: ReviewOptions, keepCustomerIds: Set<string>): ReviewOptions {
  const size = (x: unknown) => JSON.stringify(x).length;
  if (size(opts) <= OPTIONS_BUDGET_BYTES) return opts;
  const keep = opts.customers.filter((c) => keepCustomerIds.has(c.id));
  const rest = opts.customers.filter((c) => !keepCustomerIds.has(c.id));
  const base = size({ ...opts, customers: keep });
  let budget = OPTIONS_BUDGET_BYTES - base;
  const out = [...keep];
  for (const c of rest) {
    const s = size(c) + 1;
    if (budget - s < 0) break;
    budget -= s;
    out.push(c);
  }
  return { ...opts, customers: out.sort((a, b) => a.name.localeCompare(b.name, "cs")) };
}

export interface ReviewRequest {
  captureId: string;
  sort: unknown;
  assign?: unknown;
  targets?: unknown;
  customerConfirmed?: unknown;
}

function cleanStringMap(raw: unknown, keyRe: RegExp, valueOk: (v: string) => boolean): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 200)) {
    if (keyRe.test(k) && typeof v === "string" && valueOk(v.toLowerCase())) out[k] = v.toLowerCase();
  }
  return out;
}

/** Kontrola dávky: skupiny zakázek, údaje se zdroji, doklady, upozornění a výchozí stav. */
export async function buildBatchReview(c: Ctx, req: ReviewRequest): Promise<{ ok: true; review: BatchReviewModel } | { ok: false; error: string }> {
  const s = await readSession(c.db, c.user.id, req.captureId);
  if (!s) return fail(SESSION_GONE);
  const { session } = s;
  const sort = sanitizeBatchSort(req.sort);
  if (typeof sort === "string") return fail(sort);
  const invalid = validateBatchSort(sort, session.pages);
  if (invalid) return fail(invalid);
  const assign = cleanStringMap(req.assign, DOC_ID_RE, (v) => v === "new" || /^g\d{1,3}$/.test(v));
  const targets = cleanStringMap(req.targets, /^g\d{1,3}$/, (v) => v === "new" || isUuid(v));
  const confirmed = Array.isArray(req.customerConfirmed)
    ? req.customerConfirmed.filter((x): x is string => typeof x === "string" && /^g\d{1,3}$/.test(x)).slice(0, 100) : [];
  await companyFresh();
  const review = await reviewModel(c, session, sort, { assign, targets, confirmed });
  session.lastSort = sort;
  session.lastAssign = assign;
  session.lastTargets = targets;
  await updateSession(c.db, session.captureId, session);
  return { ok: true, review };
}

async function reviewModel(
  c: Ctx,
  session: BatchSession,
  sort: BatchSort,
  opts: { assign: Record<string, string>; targets: Record<string, string>; confirmed: string[] },
): Promise<BatchReviewModel> {
  const { db, margins } = c;
  const ctx = await reviewContext(c, session, sort);
  const [mode, formOptions] = await Promise.all([getModuleMode("capture"), getJobFormOptions()]);
  const grouped = groupBatch({
    docs: ctx.docs, ourIco: ourIco(), fixedJobId: session.fixedJobId, assign: opts.assign, customerConfirmed: opts.confirmed,
  });
  const warnings: BatchWarning[] = [];
  const activeIds = new Set(ctx.docs.map((d) => d.id));
  // upozornění z roztřídění platí, jen dokud se doklad / stránka nezměnily
  warnings.push(...session.sortWarnings.filter((w) => {
    if (!w.docIds.every((id) => activeIds.has(id))) return false;
    if (w.actions.some((a) => a.kind === "restore_page" && a.pageId && !sort.excludedPageIds.includes(a.pageId))) return false;
    if (w.code === "issuer_mismatch" || w.code === "complaint" || w.code === "sort_uncertain") {
      return w.docIds.every((id) => {
        const d = sort.docs.find((x) => x.id === id);
        return d && d.type === d.aiType;
      });
    }
    return true;
  }));
  warnings.push(...grouped.warnings, ...ctx.typeConflicts);
  const groups: BatchReviewModel["groups"] = [];
  const docReviews: BatchReviewModel["docs"] = [];
  const states: BatchApplyState["groups"] = [];
  const docStates: BatchApplyState["docs"] = {};
  const keepCustomers = new Set<string>();
  for (const g of grouped.groups) {
    const gdocs = g.docIds.map((id) => ctx.docs.find((d) => d.id === id)!).filter(Boolean);
    const override = opts.targets[g.key] ?? null;
    const jobs = await candidateJobs(ctx, gdocs, g.targetJobId, override, session.fixedJobId);
    const jobMap = new Map(jobs.map((j) => [j.job.id, j.job as JobDetail]));
    const { data: winners } = jobs.length
      ? await db.from("supplier_quotes").select("job_id").in("job_id", jobs.map((j) => j.job.id)).eq("selected", true)
      : { data: [] };
    const customerId = gdocs.map((d) => d.customerMatch?.id).find(Boolean) ?? jobs[0]?.job.customer?.id ?? null;
    const rec = reconcileGroup({
      captureId: session.captureId,
      group: g,
      docs: gdocs,
      margins,
      mode: mode === "full" ? "full" : "approval",
      ourIco: ourIco(),
      fixedJobId: session.fixedJobId,
      jobs,
      targetOverride: override,
      jobsWithWinner: ((winners ?? []) as { job_id: string }[]).map((w) => w.job_id),
      duplicates: await duplicatesOf(db, session, gdocs, jobMap),
      archiveConflicts: await archiveConflictsOf(db, gdocs, customerId),
    });
    groups.push(rec.review);
    docReviews.push(...rec.docs);
    states.push(rec.state);
    Object.assign(docStates, rec.docStates);
    warnings.push(...rec.warnings.map((w) => ({ ...w, groupKey: w.groupKey ?? g.key })));
    if (rec.review.model.customerMatch) keepCustomers.add(rec.review.model.customerMatch.id);
    for (const t of rec.review.model.targets) if (t.customerId) keepCustomers.add(t.customerId);
  }
  // pořadí dokladů jako v roztřídění
  const order = new Map(activeDocs(sort).map((d, i) => [d.id, i]));
  docReviews.sort((a, b) => (order.get(a.docId) ?? 0) - (order.get(b.docId) ?? 0));
  const recentJobs = [...ctx.md.jobs].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 300);
  for (const j of recentJobs.slice(0, 50)) if (j.customerId) keepCustomers.add(j.customerId);
  const options = trimOptions({
    customers: formOptions.customers,
    suppliers: formOptions.suppliers,
    jobs: recentJobs.map((j) => ({ id: j.id, number: j.number, title: j.title, customerName: j.customerName, stage: j.stage })),
  }, keepCustomers);
  return {
    captureId: session.captureId,
    aiUsed: session.aiUsed,
    mode: mode === "full" ? "full" : "approval",
    margins,
    drawingsAccess: c.access.can("drawings"),
    fixedJobId: session.fixedJobId,
    options,
    groups,
    docs: docReviews,
    warnings: uniqueWarnings(warnings),
    initial: { sort, groups: states, docs: docStates },
  };
}

/** Hledání zakázky pro „Jiná…" (číslo, název, zákazník, č. objednávky). */
export async function searchBatchJobs(c: Ctx, qRaw: string): Promise<{ ok: true; jobs: ReviewOptions["jobs"] } | { ok: false; error: string }> {
  const q = (qRaw ?? "").replace(/[%_,()*\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  if (q.length < 2) return fail("Napiš aspoň 2 znaky.");
  const like = `%${q}%`;
  const { data, error } = await c.db
    .from("orders")
    .select("id, number, title, status, customer_order_number, customer:customers!customer_id(name)")
    .or(`number.ilike.${like},title.ilike.${like},customer_order_number.ilike.${like}`)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return fail(error.message);
  const { data: byCustomer } = await c.db
    .from("customers").select("id").ilike("name", like).limit(20);
  const custIds = ((byCustomer ?? []) as { id: string }[]).map((x) => x.id);
  let more: unknown[] = [];
  if (custIds.length) {
    const { data: m } = await c.db
      .from("orders").select("id, number, title, status, customer:customers!customer_id(name)")
      .in("customer_id", custIds).order("created_at", { ascending: false }).limit(20);
    more = m ?? [];
  }
  const out: ReviewOptions["jobs"] = [];
  for (const r of [...(data ?? []), ...more] as { id: string; number: string; title: string | null; status: string; customer: { name: string } | { name: string }[] | null }[]) {
    if (out.some((x) => x.id === r.id) || out.length >= 20) continue;
    const cust = Array.isArray(r.customer) ? r.customer[0] : r.customer;
    out.push({ id: r.id, number: r.number, title: r.title ?? "", customerName: cust?.name ?? null, stage: isJobStage(r.status) ? r.status : "poptavka" });
  }
  return { ok: true, jobs: out };
}

// ── 4) Uložení ──────────────────────────────────────────────
interface GroupDone {
  jobId: string;
  jobNumber: string;
  created: boolean;
  customerId: string | null;
  customerName: string | null;
  customerCreated: boolean;
  stageFrom: JobStage | null;
  stageTo: JobStage | null;
  matchedBy: string | null;
  itemIds: Record<string, string>;
  filled: string[];
  itemsAdded: number;
  /** Nová zakázka založená se stavem primárního dokladu — vyšší stav až po uložení všech dokladů skupiny. */
  stageDeferred?: JobStage | null;
}

const DOC_ORDER: BatchDocType[] = [
  "objednavka_zakaznik", "poptavka_zakaznik", "nabidka_my", "potvrzeni_my", "dodaci_list_my", "faktura_my",
  "objednavka_my", "poptavka_my", "nabidka_dodavatel", "potvrzeni_dodavatel", "dodaci_list_dodavatel", "faktura_dodavatel",
  "vykres", "model_3d", "foto", "ostatni",
];

function links(jobId: string, jobNumber: string, kind: JobFileKind, extra: BatchResultLink[] = []): BatchResultLink[] {
  return [
    { label: `Zakázka ${jobNumber}`, href: `/orders/${jobId}` },
    { label: `Dokumenty: ${chipLabel(kind)}`, href: `/orders/${jobId}?tab=dokumenty` },
    ...extra,
  ];
}

function chipLabel(kind: JobFileKind): string {
  const map: Partial<Record<JobFileKind, string>> = {
    vykres: "Výkres", model_3d: "3D model", foto: "Fotka", naceneni: "Nacenění", nabidka: "Nabídka", objednavka: "Objednávka",
    objednavka_vydana: "Objednávka dodavateli", potvrzeni: "Potvrzení", dodaci_list: "Dodací list", faktura: "Faktura",
    poptavka: "Poptávka", korespondence: "Korespondence", ostatni: "Ostatní",
  };
  return map[kind] ?? "Dokument";
}

/**
 * Soubor(y) dokladu k zakázce: celé PDF / fotka přesunem, část PDF řezem, fotky vícestránkového dokladu do PDF.
 * complete = přiloženy všechny části (jinak doklad zůstane neuložený a opakování dopřiloží zbytek —
 * přesun i registrace jsou idempotentní podle cílové cesty).
 */
async function attachDocFiles(
  c: Ctx,
  session: BatchSession,
  draft: BatchDocDraft,
  jobId: string,
  meta: { kind: JobFileKind; title: string; note?: string; aiExtracted?: Record<string, unknown> | null; aiConfidence?: number | null; orderItemId?: string | null; replaceFileId?: string | null; quoteId?: string | null },
  warnings: string[],
): Promise<{ ids: string[]; complete: boolean }> {
  const { db, user } = c;
  const pages = draft.pageIds.map((id) => session.pages.find((p) => p.id === id)).filter((p): p is BatchPage => Boolean(p));
  const byFile: { file: BatchFile; pages: BatchPage[] }[] = [];
  for (const p of pages) {
    const f = session.files.find((x) => x.id === p.fileId);
    if (!f) continue;
    const last = byFile[byFile.length - 1];
    if (last && last.file.id === f.id) last.pages.push(p);
    else byFile.push({ file: f, pages: [p] });
  }
  const register = async (path: string, filename: string, mimeType: string, size: number, part: number, total: number, sha?: string | null) => {
    const reg = await registerJobFileCore(db, user.id, {
      jobId, path, filename, mimeType: mimeType || undefined, size: size || undefined, kind: meta.kind,
      title: `${meta.title}${total > 1 ? ` · str. ${part + 1}/${total}` : ""}`,
      note: part === 0 ? meta.note : undefined,
      aiExtracted: part === 0 ? meta.aiExtracted ?? null : null,
      aiConfidence: part === 0 ? meta.aiConfidence ?? null : null,
      orderItemId: part === 0 ? meta.orderItemId ?? null : null,
      replaceFileId: part === 0 ? meta.replaceFileId ?? undefined : undefined,
      quoteId: part === 0 ? meta.quoteId ?? undefined : undefined,
      captureId: session.captureId,
      contentSha256: sha ?? null,
      silent: true,
      noAutoVersion: true,
    });
    if (!reg.ok || !reg.file) {
      warnings.push(`${filename}: ${reg.error ?? "soubor se nepodařilo uložit"}`);
      return null;
    }
    return reg.file.id;
  };
  const moveTo = async (from: string, dest: string): Promise<boolean> => {
    const { error } = await bucket(db).move(from, dest);
    if (!error) return true;
    // opakování: zdroj už přesunutý → cíl existuje
    const dir = dest.slice(0, dest.lastIndexOf("/"));
    const name = dest.slice(dest.lastIndexOf("/") + 1);
    const { data } = await bucket(db).list(dir, { search: name });
    return ((data ?? []) as { name: string }[]).some((x) => x.name === name);
  };
  const upload = async (dest: string, bytes: Uint8Array, contentType: string): Promise<boolean> => {
    const { error } = await bucket(db).upload(dest, bytes, { contentType, upsert: true });
    return !error;
  };

  // vícestránkový doklad z fotek → jedno PDF
  const allImages = byFile.length > 1 && byFile.every((b) => b.pages.length === 1 && b.pages[0].source === "image");
  if (allImages && isBusinessType(draft.type)) {
    const imgs: { bytes: Uint8Array; mime: string }[] = [];
    for (const b of byFile) {
      const bytes = await downloadFull(db, b.file.path);
      const mime = bytes ? sniffDocumentMime(bytes) : null;
      if (!bytes || !mime) { imgs.length = 0; break; }
      imgs.push({ bytes, mime });
    }
    const pdf = imgs.length === byFile.length ? await imagesToPdf(imgs).catch(() => null) : null;
    if (pdf) {
      const name = `${meta.title.replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80) || "doklad"}.pdf`;
      const dest = jobFilePath(jobId, captureUuid(session.captureId, draft.id, "merged"), name);
      if (await upload(dest, pdf, "application/pdf")) {
        const id = await register(dest, name, "application/pdf", pdf.length, 0, 1, null);
        return { ids: id ? [id] : [], complete: Boolean(id) };
      }
    }
  }

  const out: string[] = [];
  let complete = true;
  const total = byFile.reduce((s, b) => s + (b.file.pageCount > 1 && b.pages.length < b.file.pageCount ? 1 : b.pages.length > 1 && b.pages[0].source === "image" ? b.pages.length : 1), 0);
  let part = 0;
  for (const b of byFile) {
    const f = b.file;
    const whole = f.pageCount <= 1 || b.pages.length === f.pageCount;
    if (whole) {
      const dest = jobFilePath(jobId, captureUuid(session.captureId, `file-${f.id}`, 0), f.filename);
      if (await moveTo(f.path, dest)) {
        const id = await register(dest, f.filename, f.mimeType, f.size, part, total, f.sha256);
        if (id) out.push(id);
        else complete = false;
      } else {
        warnings.push(`Soubor ${f.filename} se nepodařilo přiložit.`);
        complete = false;
      }
      part++;
      continue;
    }
    // část PDF → vlastní soubor
    const nums = b.pages.map((p) => p.page);
    const label = nums.length > 1 ? `${nums[0]}-${nums[nums.length - 1]}` : `${nums[0]}`;
    const base = f.filename.replace(/\.pdf$/i, "");
    const name = `${base}-str${label}.pdf`;
    const dest = jobFilePath(jobId, captureUuid(session.captureId, draft.id, `part-${f.id}`), name);
    let ok = false;
    try {
      const bytes = await downloadFull(db, f.path);
      if (bytes) {
        const cut = await extractPdfPages(bytes, nums);
        ok = await upload(dest, cut, "application/pdf");
        if (ok) {
          const id = await register(dest, name, "application/pdf", cut.length, part, total, null);
          if (id) out.push(id);
          else complete = false;
        }
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      // řez selhal → celé PDF jednou, další doklady z něj odkazují stejný dokument
      warnings.push(`${f.filename} se nepodařilo rozdělit — přiloženo celé (doklad je na str. ${label.replace("-", "–")}).`);
      const wholeDest = jobFilePath(jobId, captureUuid(session.captureId, `file-${f.id}`, 0), f.filename);
      const { data: exists } = await db.from("job_files").select("id").eq("storage_path", wholeDest).maybeSingle();
      if (exists) out.push((exists as { id: string }).id);
      else {
        const bytes = await downloadFull(db, f.path);
        const id = bytes && await upload(wholeDest, bytes, "application/pdf")
          ? await register(wholeDest, f.filename, "application/pdf", bytes.length, part, total, f.sha256) : null;
        if (id) out.push(id);
        else complete = false;
      }
    }
    part++;
  }
  return { ids: out, complete: complete && out.length > 0 };
}

function businessExtractOf(row: ExtractRow | null): ExtractedBusinessDoc | null {
  return row?.data?.extract?.kind === "business" ? normalizeExtracted(row.data.extract.doc) : null;
}

export interface ApplyBatchInput { captureId: string; state: unknown }

/** Uložení dávky (po skupinách a dokladech, deník + deterministické klíče; částečné uložení = partial). */
export async function applyBatch(c: Ctx, input: ApplyBatchInput): Promise<BatchResult> {
  const empty = (error: string): BatchResult => ({ ok: false, status: "failed", error, aiUsed: false, groups: [], docs: [], pending: [], warnings: [] });
  if (!input || !isUuid(input.captureId)) return empty(SESSION_GONE);
  const s = await readSession(c.db, c.user.id, input.captureId, { allowDone: true });
  if (!s) return empty(SESSION_GONE);
  const { session } = s;
  // opakované uložení hotové dávky: všechny kroky jsou v deníku hotové → jen výsledek, nic znovu
  if (s.status === "done") return resultFromJournal(c, session);
  const token = crypto.randomUUID();
  if (!(await tryLock(c.db, session.captureId, c.user.id, token))) return empty(BUSY);
  try {
    await companyFresh();
    return await applyLocked(c, session, input.state);
  } catch (err) {
    return empty(message(err));
  } finally {
    await unlock(c.db, session.captureId, token);
  }
}

/** Výsledek už uložené dávky z deníku (opakované „Uložit vše" nic nezdvojí). */
async function resultFromJournal(c: Ctx, session: BatchSession): Promise<BatchResult> {
  const steps = await readSteps(c.db, session.captureId);
  const result: BatchResult = { ok: true, status: "done", aiUsed: session.aiUsed, groups: [], docs: [], pending: [], warnings: [] };
  for (const g of session.lastApply?.groups ?? []) {
    const st = steps.get(`group:${g.key}`);
    const done = st?.status === "done" ? (st.result as unknown as GroupDone | null) : null;
    if (!done) continue;
    const stage = steps.get(`stage:${g.key}`)?.result as { from?: JobStage; to?: JobStage } | null | undefined;
    result.groups.push({
      key: g.key, ok: true, jobId: done.jobId, jobNumber: done.jobNumber, created: done.created, matchedBy: done.matchedBy ?? undefined,
      customerName: done.customerName ?? undefined, customerCreated: done.customerCreated,
      stageFrom: done.created ? undefined : stage?.to ? stage.from : done.stageFrom ?? undefined, stageTo: stage?.to ?? done.stageTo ?? undefined,
    });
    for (const id of g.docIds) {
      const d = steps.get(`doc:${id}`);
      if (d?.status === "done" && d.result && "docId" in d.result) result.docs.push(d.result as unknown as BatchDocResult);
    }
  }
  return result;
}

async function journalConflict(db: JobsDb, session: BatchSession, steps: Map<string, StepRow>, state: BatchApplyState): Promise<string | null> {
  if (!session.lastApply || !steps.size) return null;
  // skupina, jejíž pokus zakázku už založil (i když pak selhal) — klíč zakázky je obsazený
  const { data } = await db.from("orders").select("capture_key").like("capture_key", `${session.captureId}:%`).limit(200);
  const jobKeys = new Set(((data ?? []) as { capture_key: string | null }[]).map((r) => (r.capture_key ?? "").split(":")[1] ?? "").filter(Boolean));
  return journalConflictOf(session.lastApply, steps, jobKeys, state);
}

async function applyLocked(c: Ctx, session: BatchSession, rawState: unknown): Promise<BatchResult> {
  const { db, user, margins } = c;
  const rows = await listExtracts(db, session.captureId);
  // zákazníci zákaznických dokladů (konflikt zákazníka)
  const preSort = sanitizeBatchSort((rawState as Record<string, unknown> | null)?.sort);
  const parties: Record<string, { name: string; ico: string } | null> = {};
  if (typeof preSort !== "string") {
    for (const d of activeDocs(preSort)) {
      const b = businessExtractOf(extractRowFor(rows, d));
      parties[d.id] = b ? { name: b.customer.name, ico: b.customer.ico } : null;
    }
  }
  const sane = sanitizeBatchApplyState(rawState, { pages: session.pages, margins, ourIco: ourIco(), customerParties: parties });
  if (!sane.ok) return { ok: false, status: "failed", error: sane.error, aiUsed: session.aiUsed, groups: [], docs: [], pending: [], warnings: [] };
  let state = sane.state;
  const auto = state.auto === true;

  // plná automatika: znovu ověřit nad daty relace a uložit návrh serveru
  if (auto) {
    const review = await reviewModel(c, session, state.sort, { assign: session.lastAssign ?? {}, targets: session.lastTargets ?? {}, confirmed: [] });
    const summaries = summariesFor(state.sort, rows, margins);
    if (!canAutoApplyBatch(review, summaries)) {
      return { ok: false, status: "failed", error: "Vyžaduje kontrolu", aiUsed: session.aiUsed, groups: [], docs: [], pending: [], warnings: [] };
    }
    state = { ...review.initial, auto: true };
  }

  const steps = await readSteps(db, session.captureId);
  const conflict = await journalConflict(db, session, steps, state);
  if (conflict) return { ok: false, status: "failed", error: conflict, aiUsed: session.aiUsed, groups: [], docs: [], pending: [], warnings: [] };
  session.lastSort = state.sort;
  session.lastApply = {
    groups: state.groups.map((g) => ({ key: g.key, docIds: g.docIds })),
    docs: state.sort.docs.map((d) => ({ id: d.id, type: d.type, pageIds: d.pageIds, title: d.title, excluded: d.excluded })),
  };
  await updateSession(db, session.captureId, session);
  // hned „partial": přerušené ukládání (timeout) se nesmí uklidit / zahodit jako neuložená dávka
  await setSessionStatus(db, session.captureId, "partial");
  const ctx = await reviewContext(c, session, state.sort);
  const result: BatchResult = { ok: true, status: "done", aiUsed: session.aiUsed, autoApplied: auto || undefined, groups: [], docs: [], pending: [], warnings: [] };

  const groupsOrdered = [...state.groups].sort((a, b) => {
    const has = (g: typeof a) => g.docIds.some((id) => isBusinessType(state.sort.docs.find((d) => d.id === id)?.type ?? "ostatni")) ? 0 : 1;
    return has(a) - has(b);
  });

  for (const g of groupsOrdered) {
    const gdocs = g.docIds.map((id) => ctx.docs.find((d) => d.id === id)).filter((d): d is ReconcileDoc => Boolean(d));
    const gd = groupDocOf(gdocs, ourIco());
    const primary = gdocs.find((d) => d.id === gd.primaryId) ?? null;
    const stepKey = `group:${g.key}`;
    let done: GroupDone | null = null;
    const prev = steps.get(stepKey);
    if (prev?.status === "done" && prev.result) done = prev.result as unknown as GroupDone;
    if (!done) {
      await writeStep(db, session.captureId, stepKey, "started");
      const job = { ...g.job, fields: { ...g.job.fields } };
      if (!job.fields.title?.trim() && g.jobDraftTitle.trim()) job.fields.title = g.jobDraftTitle.trim().slice(0, 300);
      // nová zakázka: stav z primárního dokladu; vyšší stav z dalších dokladů až po jejich uložení
      let stageDeferred: JobStage | null = null;
      if (job.targetKey === "new" && job.stage !== "keep") {
        const p = primary ? state.sort.docs.find((d) => d.id === primary.id) : null;
        const pst = p && isBusinessType(p.type) ? state.docs[p.id] : null;
        const base = p && isBusinessType(p.type)
          ? batchStage([{ type: p.type, flags: p.flags, paidComplete: pst?.kind === "business" ? pst.state.paidComplete : false }], { mode: "new", stage: null })
          : "poptavka";
        if (base !== "keep" && isForward(base, job.stage)) {
          stageDeferred = job.stage;
          job.stage = base;
        }
      }
      const runGroup = () => applyBusinessDoc(c, {
        captureId: session.captureId, userId: user.id, files: [], aiUsed: Boolean(primary?.aiUsed), doc: gd.doc,
        fixedJobId: null, customerMatch: primary?.customerMatch ?? null, supplierMatch: primary?.supplierMatch ?? null, matches: [],
      }, job, { auto, captureKey: `${session.captureId}:${g.key}`, stage: false, attachFiles: false, summaryEvent: false, learn: false, cleanupSession: false });
      let res = await runGroup();
      // číslo zakázky obsazené (čítač za importovanými daty) → další číslo, max. 3×
      for (let i = 0; i < 3 && !res.ok && job.targetKey === "new" && res.error === "Záznam s tímto číslem už existuje."; i++) res = await runGroup();
      if (!res.ok || !res.jobId || !res.jobNumber) {
        await writeStep(db, session.captureId, stepKey, "failed", { error: res.error ?? "" });
        result.groups.push({ key: g.key, ok: false, error: res.error ?? "Zakázku se nepodařilo uložit.", created: false });
        for (const id of g.docIds) result.pending.push(id);
        continue;
      }
      done = {
        jobId: res.jobId, jobNumber: res.jobNumber, created: res.created, customerId: res.customerId ?? null,
        customerName: res.customerName ?? null, customerCreated: Boolean(res.customerCreated), stageFrom: res.stageFrom ?? null,
        stageTo: res.created ? res.stageTo ?? null : null, matchedBy: res.matchedBy ?? null, itemIds: res.itemIds ?? {},
        filled: res.filled ?? [], itemsAdded: res.itemsAdded ?? 0,
        stageDeferred: res.created ? stageDeferred : null,
      };
      if (res.warnings) result.warnings.push(...res.warnings);
      await writeStep(db, session.captureId, stepKey, "done", done as unknown as Row);
    }
    const gres: BatchGroupResult = {
      key: g.key, ok: true, jobId: done.jobId, jobNumber: done.jobNumber, created: done.created, matchedBy: done.matchedBy ?? undefined,
      customerName: done.customerName ?? undefined, customerCreated: done.customerCreated,
      stageFrom: done.stageFrom ?? undefined, stageTo: done.stageTo ?? undefined,
    };
    result.groups.push(gres);

    // doklady skupiny
    const ordered = [...g.docIds].sort((a, b) => {
      const ta = state.sort.docs.find((d) => d.id === a)?.type ?? "ostatni";
      const tb = state.sort.docs.find((d) => d.id === b)?.type ?? "ostatni";
      return DOC_ORDER.indexOf(ta) - DOC_ORDER.indexOf(tb);
    });
    const drawingIds: Record<string, string> = {};
    const savedDocs: { type: BatchDocType; documentNumber: string }[] = [];
    for (const docId of ordered) {
      const draft = state.sort.docs.find((d) => d.id === docId)!;
      const ds = state.docs[docId];
      const rdoc = ctx.docs.find((d) => d.id === docId) ?? null;
      const dkey = `doc:${docId}`;
      const prevDoc = steps.get(dkey);
      if (prevDoc?.status === "done" && prevDoc.result) {
        const r = prevDoc.result as unknown as BatchDocResult;
        result.docs.push(r);
        if (r.drawingId && rdoc) drawingIds[rdoc.documentNumber] = r.drawingId;
        if (r.ok && !r.skipped) savedDocs.push({ type: r.type, documentNumber: rdoc?.documentNumber ?? "" });
        continue;
      }
      await writeStep(db, session.captureId, dkey, "started");
      try {
        const r = await applyDoc(c, session, ctx, g, done, draft, ds, rdoc, drawingIds, auto, docId === gd.primaryId);
        result.docs.push(r);
        if (r.ok && !r.skipped) savedDocs.push({ type: r.type, documentNumber: rdoc?.documentNumber ?? "" });
        if (!r.ok) result.pending.push(docId);
        await writeStep(db, session.captureId, dkey, r.ok ? "done" : "failed", r as unknown as Row);
      } catch (err) {
        const r: BatchDocResult = {
          docId, groupKey: g.key, type: draft.type, label: BATCH_TYPES[draft.type].label, ok: false, error: message(err),
          jobId: done.jobId, jobNumber: done.jobNumber, fileIds: [], fileKind: BATCH_TYPES[draft.type].fileKind, title: draft.title,
          summary: "", links: [],
        };
        result.docs.push(r);
        result.pending.push(docId);
        await writeStep(db, session.captureId, dkey, "failed", r as unknown as Row);
      }
    }

    // stav jednou za skupinu (jen dopředu, vůči znovu načtenému stavu) — až po uložení všech dokladů skupiny
    const stageKey = `stage:${g.key}`;
    const groupPending = g.docIds.some((id) => result.pending.includes(id));
    const stageTarget: JobStage | "keep" = done.created ? done.stageDeferred ?? "keep" : g.job.stage;
    if (!groupPending && stageTarget !== "keep" && steps.get(stageKey)?.status !== "done") {
      const { data: cur } = await db.from("orders").select("id, status").eq("id", done.jobId).maybeSingle();
      const from = isJobStage((cur as Row | null)?.status) ? ((cur as Row).status as JobStage) : null;
      const to = stageTarget;
      if (from && isForward(from, to)) {
        const { error } = await db.from("orders").update({ status: to } as never).eq("id", done.jobId);
        if (!error) {
          await logJobEvent(db, {
            jobId: done.jobId, type: "stage", message: stageEventMessage(from, to, "podle vyfocených dokladů"),
            data: { from, to, source: "foto", captureId: session.captureId, batch: true }, actorId: user.id,
          });
          if (!done.created) gres.stageFrom = from;
          gres.stageTo = to;
        } else {
          result.warnings.push(`Stav zakázky ${done.jobNumber} se nepodařilo změnit.`);
        }
      }
      await writeStep(db, session.captureId, stageKey, "done", { from, to });
    } else if (steps.get(stageKey)?.status === "done") {
      const r = steps.get(stageKey)!.result as { from?: JobStage; to?: JobStage } | null;
      if (r?.to) { if (!done.created) gres.stageFrom = r.from; gres.stageTo = r.to; }
    } else if (groupPending && stageTarget !== "keep") {
      result.warnings.push(`Stav zakázky ${done.jobNumber} se posune, až se uloží všechny její doklady.`);
    }

    // souhrnná událost skupiny
    const evKey = `event:${g.key}`;
    if (savedDocs.length && steps.get(evKey)?.status !== "done") {
      await logJobEvent(db, {
        jobId: done.jobId, type: session.aiUsed ? "ai" : "file",
        message: batchEventMessage({ docs: savedDocs, aiUsed: gdocs.some((d) => d.aiUsed), auto }),
        data: { captureId: session.captureId, batch: true, docIds: g.docIds, ...(auto ? { auto: true } : {}) },
        actorId: user.id,
      });
      await writeStep(db, session.captureId, evKey, "done");
    }
  }

  // vyřazené doklady → stránky smazat
  for (const d of state.sort.docs.filter((x) => x.excluded)) {
    result.docs.push({
      docId: d.id, groupKey: "", type: d.type, label: BATCH_TYPES[d.type].label, ok: true, skipped: "excluded",
      jobId: null, jobNumber: null, fileIds: [], fileKind: BATCH_TYPES[d.type].fileKind, title: d.title, summary: "", links: [],
    });
  }

  // učení: roztřídění
  if (steps.get("learn:sort")?.status !== "done") {
    await learnSort(c, session, state);
    await writeStep(db, session.captureId, "learn:sort", "done");
  }

  // stav relace
  if (result.pending.length) {
    result.status = result.docs.some((d) => d.ok && !d.skipped) || result.groups.some((g) => g.ok) ? "partial" : "failed";
    result.ok = result.status === "partial";
    if (!result.ok) result.error = result.groups.find((g) => !g.ok)?.error ?? result.docs.find((d) => !d.ok)?.error ?? "Dávku se nepodařilo uložit.";
    await setSessionStatus(db, session.captureId, "partial");
  } else {
    // vše uloženo → zbylé soubory relace pryč (přesunuté už nejsou, náhledy a vyřazené ano)
    await removeStoragePaths(db, sessionPaths(session));
    await setSessionStatus(db, session.captureId, "done");
  }
  try {
    revalidatePath("/orders");
    revalidatePath("/");
    revalidatePath("/drawings");
    for (const g of result.groups) if (g.jobId) revalidatePath(`/orders/${g.jobId}`);
  } catch {
    // mimo požadavek Next.js
  }
  return result;
}

async function applyDoc(
  c: Ctx,
  session: BatchSession,
  ctx: ReviewContext,
  g: BatchApplyState["groups"][number],
  done: GroupDone,
  draft: BatchDocDraft,
  ds: DocApplyState | undefined,
  rdoc: ReconcileDoc | null,
  drawingIds: Record<string, string>,
  auto: boolean,
  isPrimary: boolean,
): Promise<BatchDocResult> {
  const { db, user, margins } = c;
  const meta = BATCH_TYPES[draft.type];
  const jobId = done.jobId;
  const jobNumber = done.jobNumber;
  const warnings: string[] = [];
  const base: BatchDocResult = {
    docId: draft.id, groupKey: g.key, type: draft.type, label: meta.label, ok: true, jobId, jobNumber,
    fileIds: [], fileKind: meta.fileKind, title: "", summary: "", links: [],
  };
  if (!ds) return { ...base, ok: false, error: "Chybí údaje dokladu." };
  const row = extractRowFor(ctx.rows, draft);
  const fromDb = row && isDone(row) ? row.data : null;
  const aiUsed = Boolean(fromDb?.aiUsed);

  if (ds.kind === "business") {
    const st = ds.state;
    if (st.onDuplicate === "skip" && rdoc && (await isDuplicate(db, session, rdoc, jobId))) {
      await removeStoragePaths(db, draftPaths(session, draft));
      return { ...base, skipped: "duplicate", title: `${meta.label} ${st.documentNumber}`.trim(), summary: "Už uloženo dříve — neukládá se znovu." };
    }
    const doc = rdoc?.extract?.kind === "business" ? rdoc.extract.doc : { ...emptyExtracted(), docKind: meta.docKind!, issuer: meta.issuer! };
    const number = st.documentNumber || doc.documentNumber;
    const chip = chipByKey(draft.type as Parameters<typeof chipByKey>[0]);
    const title = `${chip.docTitle}${number ? ` ${number}` : ""}`;
    const hide = !margins && meta.side === "supplier";
    // ai_extracted se v aplikaci neukazuje (jen „má data z AI") — plný doklad kvůli zapsání do Nákupu později
    const extracted: Record<string, unknown> | null = aiUsed
      ? { ...doc, documentNumber: number || doc.documentNumber, captureDocId: draft.id }
      : number ? { documentNumber: number, captureDocId: draft.id } : { captureDocId: draft.id };
    // naše nabídka → nabídka zakázky stejného čísla
    let quoteId: string | null = null;
    if (draft.type === "nabidka_my" && number && !st.fileOnly) {
      const { data } = await db.from("quotes").select("id, number").eq("job_id", jobId).limit(50);
      quoteId = ((data ?? []) as { id: string; number: string }[]).find((q) => docNumbersEqual(q.number, number))?.id ?? null;
    }
    const pendingQuote = draft.type === "nabidka_dodavatel" && !margins && !st.fileOnly;
    if (pendingQuote && extracted) extracted.purchasingPending = true;
    const replaceFileId = st.onDuplicate === "version" && rdoc ? (await duplicateFileInJob(db, session, rdoc, jobId)) : null;
    const att = await attachDocFiles(c, session, draft, jobId, {
      kind: meta.fileKind, title, note: st.docNote || undefined, aiExtracted: extracted, aiConfidence: aiUsed ? doc.confidence : null,
      quoteId, replaceFileId,
    }, warnings);
    const fileIds = att.ids;
    if (!att.complete) return { ...base, ok: false, fileIds, error: warnings[0] ?? "Doklad se nepodařilo přiložit.", title };
    const out: BatchDocResult = { ...base, fileIds, title, links: links(jobId, jobNumber, meta.fileKind) };
    const summary: string[] = [];
    /** Doplněná pole (do události dokladu — historie změn s autorem). */
    const changes: string[] = [];
    const filled = async (q: PromiseLike<{ data: unknown; error: unknown }>, label: string) => {
      const { data, error } = await q;
      if (!error && Array.isArray(data) && data.length) changes.push(label);
    };
    if (!st.fileOnly) {
      if (draft.type === "objednavka_zakaznik" && doc.supplierNumberAtCustomer && done.customerId) {
        await filled(db.from("customers").update({ supplier_number_at_customer: doc.supplierNumberAtCustomer } as never).eq("id", done.customerId).is("supplier_number_at_customer", null).select("id"),
          `naše číslo dodavatele u zákazníka ${doc.supplierNumberAtCustomer}`);
      }
      if (draft.type === "dodaci_list_my") {
        if (number) await filled(db.from("orders").update({ delivery_note_number: number } as never).eq("id", jobId).is("delivery_note_number", null).select("id"), `číslo dodacího listu ${number}`);
        if (st.confirmDelivered) {
          const r = await confirmDeliveryNoteCore(db, user.id, jobId, { date: st.documentDate || undefined, fileId: fileIds[0], stage: false, extra: { captureId: session.captureId, docId: draft.id } });
          if (r.ok) summary.push("potvrzený zákazníkem");
          else warnings.push(r.error);
        }
      }
      if (draft.type === "faktura_my") {
        if (draft.flags.includes("proforma") || draft.flags.includes("credit_note")) {
          summary.push(draft.flags.includes("proforma") ? "zálohová — bez fakturace" : "dobropis — bez fakturace");
        } else {
          // jen prázdné nebo shodné číslo faktury — jiná (dílčí) faktura údaje zakázky nepřepíše
          const { data: inv } = await db.from("orders").select("invoice_number").eq("id", jobId).maybeSingle();
          const curNo = ((inv as { invoice_number: string | null } | null)?.invoice_number ?? "").trim();
          if (curNo && (!number || !docNumbersEqual(curNo, number))) {
            warnings.push(`Zakázka už má fakturu ${curNo} — číslo ani datum faktury se nepřepsaly.`);
          } else {
            const r = await setInvoiceInfoCore(db, user.id, jobId, {
              invoiceNumber: number || undefined,
              invoiceDate: st.documentDate || doc.documentDate || undefined,
              ...(st.invoiceDueDate ? { invoiceDueDate: st.invoiceDueDate } : {}),
            }, { stage: false, extra: { captureId: session.captureId, docId: draft.id } });
            if (r.ok) {
              if (r.invoiceDueDate) summary.push(`splatnost ${new Date(r.invoiceDueDate).toLocaleDateString("cs-CZ")}`);
            } else warnings.push(r.error);
            if (st.paidComplete) {
              const p = await markJobPaidCore(db, user.id, jobId, { date: st.documentDate || todayIso(), extra: { captureId: session.captureId, docId: draft.id } });
              if (p.ok) summary.push("zaplaceno");
              else warnings.push(p.error);
            }
          }
        }
      }
      if (draft.type === "objednavka_my" && number) {
        const po = await findPurchaseOrderByNumber(db, number, jobId) ?? await findPurchaseOrderByNumber(db, number);
        if (po) {
          if (!po.fileId) await filled(db.from("purchase_orders").update({ file_id: fileIds[0] } as never).eq("id", po.id).is("file_id", null).select("id"), `soubor k objednávce ${po.number}`);
          summary.push(`objednávka ${po.number}`);
        } else {
          warnings.push(`Objednávka ${number} není v Nákupu — zapiš ji tam, ať se hlídá dodávka.`);
        }
      }
      if (draft.type === "nabidka_dodavatel") {
        if (margins) {
          // „Bez dodavatele" = jen jméno z dokladu (nikdy naše firma, nic se nezakládá)
          const supplier = st.supplier.mode === "existing"
            ? { id: st.supplier.id }
            : st.supplier.mode === "new" ? await findOrCreateSupplierByParty(db, st.supplier.party) : null;
          const lines = st.quoteLines.length ? st.quoteLines : [];
          const q = await insertSupplierQuote(db, user.id, jobId, {
            supplierId: supplier?.id ?? null,
            supplierName: supplier ? undefined : (!isOurParty(doc.supplier) && doc.supplier.name) || "Dodavatel z focení",
            number: number || undefined,
            quoteDate: st.documentDate || doc.documentDate || undefined,
            deliveryDate: doc.promisedDeliveryDate || undefined,
            currency: doc.currency || undefined,
            fileId: fileIds[0],
            source: "foto",
            items: lines.map((l) => ({
              drawingNumber: l.drawingNumber || undefined, name: l.name || undefined, material: l.material || undefined,
              quantity: cleanNumber(l.quantity) ?? 1, unit: l.unit || "ks", unitPrice: cleanNumber(l.unitPrice),
            })),
            total: lines.length ? null : doc.totalWithoutVat > 0 ? doc.totalWithoutVat : null,
          }, { captureId: session.captureId, captureDocId: draft.id });
          if (!q.ok) return { ...out, ok: false, error: q.error };
          out.supplierQuoteId = q.id;
          out.links = [...out.links, { label: "Nákup: nabídka dodavatele", href: `/orders/${jobId}?tab=nakup` }];
          if (st.selectWinner) {
            const w = await selectWinningQuoteCore(db, user.id, q.id);
            if (w.ok) summary.push("vybrána jako vítězná");
            else warnings.push(w.error);
          }
        } else {
          out.purchasingPending = true;
          const name = doc.supplier.name || "dodavatele";
          await logJobEvent(db, {
            jobId, type: "quote", message: `Nabídka dodavatele ${name}${number ? ` č. ${number}` : ""} čeká na zapsání do Nákupu`,
            data: { captureId: session.captureId, docId: draft.id, fileId: fileIds[0], purchasingPending: true }, actorId: user.id,
          });
          summary.push("čeká na zapsání do Nákupu");
        }
      }
      if ((draft.type === "potvrzeni_dodavatel" || draft.type === "dodaci_list_dodavatel") && margins && st.advancePurchaseOrder) {
        const poNo = doc.customerOrderNumber;
        const po = poNo ? await findPurchaseOrderByNumber(db, poNo) : null;
        if (po) {
          const to = draft.type === "potvrzeni_dodavatel" ? "potvrzena" : "dodana";
          if (to === "potvrzena" && doc.promisedDeliveryDate) {
            await filled(db.from("purchase_orders").update({ confirmed_date: doc.promisedDeliveryDate } as never).eq("id", po.id).is("confirmed_date", null).select("id"),
              `potvrzený termín objednávky ${po.number} ${new Date(doc.promisedDeliveryDate).toLocaleDateString("cs-CZ")}`);
          }
          const r = await advancePurchaseOrderStatus(db, user.id, po, to, `podle vyfoceného dokladu`, { captureId: session.captureId, docId: draft.id });
          if (r.ok && r.changed) summary.push(`objednávka ${po.number} → ${to === "potvrzena" ? "potvrzená" : "dodaná"}`);
        }
      } else if ((draft.type === "potvrzeni_dodavatel" || draft.type === "dodaci_list_dodavatel") && !margins) {
        warnings.push("Stav objednávky dodavateli zkontroluj v Nákupu.");
      }
      if (draft.type === "faktura_dodavatel") warnings.push("Fakturu dodavatele zkontroluj v Nákupu.");
      if (draft.flags.includes("complaint")) warnings.push("Doklad vypadá na reklamaci — stav zakázky se nemění.");
    }
    // událost dokladu (bez cen) + doplněná pole
    const head = captureEventMessage({
      chip: draft.type as Parameters<typeof captureEventMessage>[0]["chip"], aiUsed, documentNumber: number,
      filled: isPrimary ? done.filled : [], itemsAdded: isPrimary ? done.itemsAdded : 0, itemsMerged: 0, pages: draft.pageIds.length, auto,
    });
    await logJobEvent(db, {
      jobId, type: aiUsed ? "ai" : "file",
      message: changes.length ? `${head} · doplněno: ${changes.join(", ")}`.slice(0, 1000) : head,
      data: { captureId: session.captureId, docId: draft.id, batch: true, fileIds, docKind: meta.docKind, issuer: meta.issuer, fileKind: meta.fileKind, ...(changes.length ? { filledFields: changes } : {}) },
      actorId: user.id,
    });
    // učení
    const changed = draft.aiType !== null && draft.aiType !== draft.type;
    const numberChanged = aiUsed && number !== doc.documentNumber;
    await recordTrainingExample({
      kind: "capture",
      source: aiUsed ? (changed || numberChanged ? "corrected" : "ai") : "manual",
      extracted: aiUsed ? fromDb?.extract.kind === "business" ? (hide ? redactDoc(fromDb.extract.doc) : fromDb.extract.doc) : null : null,
      final: isPrimary
        ? reviewToFinalDoc(doc, { ...g.job, chip: chipFor(meta.docKind!, meta.issuer!).chip.key, docKind: meta.docKind!, issuer: meta.issuer! }, { customerName: done.customerName, margins })
        : { ...(hide ? redactDoc(doc) : doc), docKind: meta.docKind, issuer: meta.issuer, documentNumber: number, documentDate: st.documentDate || doc.documentDate, summary: "", needsClarification: [] },
      jobId, jobFileId: fileIds[0], docKind: meta.docKind ?? undefined, createdBy: user.id,
    });
    if (changed && draft.aiType) {
      try {
        await recordCorrection({
          agentKey: "capture", field: "Druh dokladu", context: `${meta.label}${number ? ` · ${number}` : ""}`.slice(0, 500),
          aiValue: BATCH_TYPES[draft.aiType].label, correctedValue: meta.label,
        });
      } catch {
        // učení nesmí shodit uložení
      }
    }
    out.summary = [...summary, ...warnings].join(" · ");
    return out;
  }

  if (ds.kind === "drawing") {
    const st = ds.state;
    if (st.onDuplicate === "skip" && rdoc && (await isDuplicate(db, session, rdoc, jobId))) {
      await removeStoragePaths(db, draftPaths(session, draft));
      return { ...base, skipped: "duplicate", title: `Výkres ${st.drawingNumber}`.trim(), summary: "Už uloženo dříve — neukládá se znovu." };
    }
    const number = st.drawingNumber.trim();
    const title = `Výkres${number ? ` ${number}` : ""}${st.revision ? ` rev. ${st.revision}` : ""}`;
    const itemId = await resolveItemLink(db, st.link, jobId, done, `${session.captureId}:${g.key}:draw-${draft.id}`, {
      drawingNumber: number, revision: st.revision, name: st.title, material: st.material, quantity: cleanNumber(st.quantity) ?? 1,
    }, margins);
    // verze: stejné číslo a novější revize → nová verze; prázdná / starší revize se uloží vedle (upozornění)
    const prevVer = number ? await previousVersion(db, jobId, "vykres", number, st.revision, null) : { id: null, conflict: null };
    const replaceFileId = (st.onDuplicate === "version" && rdoc ? await duplicateFileInJob(db, session, rdoc, jobId) : null) ?? prevVer.id;
    if (!replaceFileId && prevVer.conflict) warnings.push(prevVer.conflict);
    const drawingData = fromDb?.extract.kind === "drawing" ? fromDb.extract.drawing : null;
    const aiExtracted: Record<string, unknown> = {
      ...(drawingData ?? {}),
      drawingNumber: number, revision: st.revision, title: st.title, material: st.material, dimensions: st.dimensions,
      generalTolerance: st.generalTolerance, tightestTolerance: st.tightestTolerance, quantity: cleanNumber(st.quantity) ?? 0,
      documentNumber: number, captureDocId: draft.id,
    };
    const att = await attachDocFiles(c, session, draft, jobId, {
      kind: "vykres", title, note: st.note || undefined, aiExtracted, aiConfidence: aiUsed ? drawingData?.confidence ?? null : null,
      orderItemId: itemId, replaceFileId,
    }, warnings);
    const fileIds = att.ids;
    if (!att.complete) return { ...base, ok: false, fileIds, error: warnings[0] ?? "Výkres se nepodařilo přiložit." };
    const out: BatchDocResult = { ...base, fileIds, title, itemId: itemId ?? undefined, links: links(jobId, jobNumber, "vykres", itemId ? [{ label: "Položky zakázky", href: `/orders/${jobId}?tab=polozky` }] : []) };
    // položka: prázdné číslo / revize / materiál / název z výkresu
    const itemChanges: string[] = [];
    if (itemId) {
      const { data: it } = await db.from("order_items").select("id, drawing_number, revision, material, name").eq("id", itemId).maybeSingle();
      const cur = (it ?? {}) as Row;
      const patch: Row = {};
      if (!cur.drawing_number && number) { patch.drawing_number = number; itemChanges.push(`číslo výkresu ${number}`); }
      if (!cur.revision && st.revision) { patch.revision = st.revision; itemChanges.push(`revize ${st.revision}`); }
      if (!cur.material && st.material) { patch.material = st.material; itemChanges.push(`materiál ${st.material}`); }
      if (!cur.name && st.title) { patch.name = st.title; itemChanges.push(`název ${st.title}`); }
      if (Object.keys(patch).length) {
        const { error } = await db.from("order_items").update(patch as never).eq("id", itemId);
        if (error) itemChanges.length = 0;
      }
    }
    // archiv výkresů (s právem „drawings" dle přepínače, jinak vždy potichu)
    const archive = can(c.user, "drawings", c.access.ctx) ? st.archive : true;
    if (archive && number) {
      const f = session.files.find((x) => x.id === session.pages.find((p) => p.id === draft.pageIds[0])?.fileId);
      const { data: fileRow } = await db.from("job_files").select("id, storage_path, mime_type").eq("id", fileIds[0]).maybeSingle();
      const fr = fileRow as { id: string; storage_path: string; mime_type: string | null } | null;
      const fileType = f?.format === "DXF" ? "DXF" : f?.format === "DWG" ? "DXF" : (fr?.mime_type ?? "").startsWith("image/") ? "IMG" : "PDF";
      const res = await upsertDrawingFromCapture(db, {
        drawingNumber: number, revision: st.revision, customerId: done.customerId, title: st.title, material: st.material,
        dimensions: st.dimensions, generalTolerance: st.generalTolerance, tightestTolerance: st.tightestTolerance,
        quantity: cleanNumber(st.quantity), fileType, storagePath: fr?.storage_path ?? "", jobFileId: fileIds[0], jobId,
        aiMetadata: drawingData ? { ...drawingData } : {}, uploadedBy: user.id,
      });
      if (res.status === "inserted" || res.status === "linked") {
        await db.from("job_files").update({ drawing_id: res.drawingId } as never).eq("id", fileIds[0]);
        if (itemId) await db.from("order_items").update({ drawing_id: res.drawingId } as never).eq("id", itemId).is("drawing_id", null);
        out.drawingId = res.drawingId;
        out.drawingArchived = res.status === "inserted";
        drawingIds[number] = res.drawingId;
        out.links.push({ label: "Archiv výkresů", href: `/drawings` });
        if (res.status === "linked") warnings.push("Výkres už v archivu je — propojeno.");
      } else {
        warnings.push(res.message);
      }
    }
    await logDrawingEvent(c, session, draft, jobId, {
      what: title, fileIds, itemId, itemCreated: st.link.mode === "add", itemChanges, archived: out.drawingArchived === true, aiUsed,
    });
    await recordTrainingExample({
      kind: "capture_drawing", source: aiUsed ? "ai" : "manual", extracted: aiUsed ? drawingData : null,
      final: { ...aiExtracted, captureDocId: undefined }, jobId, jobFileId: fileIds[0], docKind: "vykres", createdBy: user.id,
    });
    out.summary = warnings.join(" · ");
    return out;
  }

  if (ds.kind === "model") {
    const st = ds.state;
    const modelMeta = fromDb?.extract.kind === "model" ? fromDb.extract.model : null;
    const format = modelMeta?.format ?? session.files.find((f) => f.id === session.pages.find((p) => p.id === draft.pageIds[0])?.fileId)?.format ?? null;
    if (st.onDuplicate === "skip" && rdoc && (await isDuplicate(db, session, rdoc, jobId))) {
      await removeStoragePaths(db, draftPaths(session, draft));
      return { ...base, skipped: "duplicate", title: `3D model ${st.drawingNumber}`.trim(), summary: "Už uloženo dříve — neukládá se znovu." };
    }
    const number = st.drawingNumber.trim();
    const title = `3D model${number ? ` ${number}` : ""}${format ? ` (${format})` : ""}`;
    const itemId = await resolveItemLink(db, st.link, jobId, done, `${session.captureId}:${g.key}:model-${draft.id}`, {
      drawingNumber: number, revision: st.revision, name: st.title, material: "", quantity: 1,
    }, margins);
    const replaceFileId = number ? (await previousVersion(db, jobId, "model_3d", number, null, format)).id : null;
    const aiExtracted: Record<string, unknown> = { format, drawingNumber: number, revision: st.revision, title: st.title, documentNumber: number, captureDocId: draft.id };
    const att = await attachDocFiles(c, session, draft, jobId, { kind: "model_3d", title, note: st.note || undefined, aiExtracted, orderItemId: itemId, replaceFileId }, warnings);
    const fileIds = att.ids;
    if (!att.complete) return { ...base, ok: false, fileIds, error: warnings[0] ?? "Model se nepodařilo přiložit." };
    // výkres stejného čísla: přednostně z dávky, jinak z archivu jen u zákazníka zakázky (stejná revize, nejnovější)
    let drawingId = number ? drawingIds[number] ?? Object.entries(drawingIds).find(([k]) => docNumbersEqual(k, number))?.[1] ?? null : null;
    if (!drawingId && number && done.customerId) {
      const { data } = await db.from("drawings").select("id, revision").eq("drawing_number", number).eq("customer_id", done.customerId)
        .order("created_at", { ascending: false }).limit(20);
      const rows = (data ?? []) as { id: string; revision: string | null }[];
      const rev = st.revision.trim().toUpperCase();
      drawingId = (rev ? rows.find((r) => (r.revision ?? "").trim().toUpperCase() === rev) : null)?.id ?? rows[0]?.id ?? null;
    }
    if (drawingId) await db.from("job_files").update({ drawing_id: drawingId } as never).eq("id", fileIds[0]);
    await logDrawingEvent(c, session, draft, jobId, {
      what: title, fileIds, itemId, itemCreated: st.link.mode === "add", itemChanges: [], archived: false, aiUsed: false,
    });
    return { ...base, fileIds, title, itemId: itemId ?? undefined, drawingId: drawingId ?? undefined, links: links(jobId, jobNumber, "model_3d"), summary: warnings.join(" · ") };
  }

  const st = ds.state;
  const title = st.title || draft.title || docFilenames(session, draft.pageIds)[0] || "Soubor";
  const att = await attachDocFiles(c, session, draft, jobId, { kind: st.fileKind, title, note: st.note || undefined }, warnings);
  const fileIds = att.ids;
  if (!att.complete) return { ...base, ok: false, fileIds, error: warnings[0] ?? "Soubor se nepodařilo přiložit." };
  return { ...base, fileIds, fileKind: st.fileKind, title, links: links(jobId, jobNumber, st.fileKind), summary: warnings.join(" · ") };
}

/** Doklad bez nákupních cen (bez práva na marže). */
function redactDoc(doc: ExtractedBusinessDoc): ExtractedBusinessDoc {
  return {
    ...doc,
    items: doc.items.map((i) => ({ ...i, unitPrice: 0 })),
    totalWithoutVat: 0,
    summary: redactPrices(doc.summary),
    note: redactPrices(doc.note),
    needsClarification: doc.needsClarification.map(redactPrices),
  };
}

function draftPaths(session: BatchSession, draft: BatchDocDraft): string[] {
  const files = new Set(draft.pageIds.map((id) => session.pages.find((p) => p.id === id)?.fileId).filter(Boolean) as string[]);
  // soubor sdílený s jiným dokladem (PDF s více doklady) se nemaže
  const sort = session.lastSort ?? session.aiSort;
  const shared = new Set(sort.docs.filter((d) => d.id !== draft.id && !d.excluded).flatMap((d) => d.pageIds.map((id) => session.pages.find((p) => p.id === id)?.fileId)));
  return session.files.filter((f) => files.has(f.id) && !shared.has(f.id)).flatMap((f) => [f.path, ...(f.sortPath ? [f.sortPath] : [])]);
}

function jobKey(jobId: string): Map<string, JobDetail> {
  return new Map([[jobId, { id: jobId } as JobDetail]]);
}

async function isDuplicate(db: JobsDb, session: BatchSession, rdoc: ReconcileDoc, jobId: string): Promise<boolean> {
  const dup = await duplicatesOf(db, session, [rdoc], jobKey(jobId));
  return Boolean(dup[rdoc.id]);
}

async function duplicateFileInJob(db: JobsDb, session: BatchSession, rdoc: ReconcileDoc, jobId: string): Promise<string | null> {
  const dup = await duplicatesOf(db, session, [rdoc], jobKey(jobId));
  const d = dup[rdoc.id];
  return d && d.jobId === jobId ? d.fileId : null;
}

/**
 * Předchozí verze v zakázce: model stejného formátu; výkres jen se starší revizí (prázdná / starší /
 * neporovnatelná revize nic nearchivuje — conflict = upozornění, soubor se uloží vedle).
 */
async function previousVersion(
  db: JobsDb, jobId: string, kind: JobFileKind, number: string, revision: string | null, format: string | null,
): Promise<{ id: string | null; conflict: string | null }> {
  const { data } = await db.from("job_files").select("id, ai_extracted, created_at").eq("job_id", jobId).eq("kind", kind).eq("archived", false).limit(200);
  const rows = ((data ?? []) as { id: string; ai_extracted: Record<string, unknown> | null }[])
    .filter((r) => { const n = String(r.ai_extracted?.drawingNumber ?? ""); return Boolean(n) && docNumbersEqual(n, number); });
  if (kind === "model_3d") return { id: rows.find((r) => (r.ai_extracted?.format ?? null) === format)?.id ?? null, conflict: null };
  const rev = String(revision ?? "").trim();
  const other = rows.filter((r) => String(r.ai_extracted?.revision ?? "").trim().toUpperCase() !== rev.toUpperCase());
  const older = other.find((r) => isNewerRevision(rev, String(r.ai_extracted?.revision ?? "")));
  if (older) return { id: older.id, conflict: null };
  if (!other.length) return { id: null, conflict: null };
  const was = String(other[0].ai_extracted?.revision ?? "").trim();
  return {
    id: null,
    conflict: `Výkres ${number}: u zakázky už je ${was ? `rev. ${was}` : "verze bez revize"} — ${rev ? `rev. ${rev}` : "tenhle bez revize"} se uložil vedle, zkontroluj revizi.`,
  };
}

/** Událost výkresu / modelu (soubor, položka, archiv) s autorem — historie změn položek. */
async function logDrawingEvent(
  c: Ctx,
  session: BatchSession,
  draft: BatchDocDraft,
  jobId: string,
  e: { what: string; fileIds: string[]; itemId: string | null; itemCreated: boolean; itemChanges: string[]; archived: boolean; aiUsed: boolean },
): Promise<void> {
  const parts = [`${e.what} přiložen z focení`];
  if (e.itemId && e.itemCreated) parts.push("založena nová položka");
  else if (e.itemChanges.length) parts.push(`doplněno k položce: ${e.itemChanges.join(", ")}`);
  if (e.archived) parts.push("zapsán do archivu výkresů");
  await logJobEvent(c.db, {
    jobId, type: e.aiUsed ? "ai" : "file", message: parts.join(" · ").slice(0, 1000),
    data: {
      captureId: session.captureId, docId: draft.id, batch: true, fileIds: e.fileIds, fileKind: BATCH_TYPES[draft.type].fileKind,
      ...(e.itemId ? { itemId: e.itemId, itemCreated: e.itemCreated, itemChanges: e.itemChanges } : {}),
    },
    actorId: c.user.id,
  });
}

/** Vazba výkresu / modelu na položku zakázky (existující, nová ze skupiny, nebo založit). */
async function resolveItemLink(
  db: JobsDb,
  link: { mode: "item"; itemId: string } | { mode: "docItem"; itemKey: string } | { mode: "add" } | { mode: "none" },
  jobId: string,
  done: GroupDone,
  captureKey: string,
  item: { drawingNumber: string; revision: string; name: string; material: string; quantity: number },
  margins: boolean,
): Promise<string | null> {
  void margins;
  if (link.mode === "item") {
    const { data } = await db.from("order_items").select("id").eq("id", link.itemId).eq("order_id", jobId).maybeSingle();
    if (!data) throw new Error("Vybraná položka nepatří k zakázce — vyber ji znovu.");
    return link.itemId;
  }
  if (link.mode === "docItem") return done.itemIds[link.itemKey] ?? null;
  if (link.mode === "add") {
    const key = captureKey.slice(0, 300);
    const { data: ex } = await db.from("order_items").select("id").eq("capture_key", key).maybeSingle();
    if (ex) return (ex as { id: string }).id;
    const { data: last } = await db.from("order_items").select("position").eq("order_id", jobId).order("position", { ascending: false }).limit(1);
    const pos = (((last ?? []) as { position: number | null }[])[0]?.position ?? -1) + 1;
    const { data, error } = await db.from("order_items").insert({
      order_id: jobId, position: pos, drawing_number: item.drawingNumber || null, revision: item.revision || null,
      name: item.name || null, material: item.material || null, quantity: item.quantity > 0 ? item.quantity : 1, unit: "ks",
      capture_key: key,
    } as never).select("id").single();
    if (error || !data) throw new Error("Položku se nepodařilo založit.");
    return (data as { id: string }).id;
  }
  return null;
}

/** Učení z roztřídění (capture_sort) — jen z dat relace v DB. */
async function learnSort(c: Ctx, session: BatchSession, state: BatchApplyState): Promise<void> {
  const label = (d: BatchDocDraft) => ({ ...d, label: BATCH_TYPES[d.type].label });
  const changed = JSON.stringify(session.aiSort.docs.map((d) => [d.type, d.pageIds, d.excluded]))
    !== JSON.stringify(state.sort.docs.map((d) => [d.type, d.pageIds, d.excluded]));
  await recordTrainingExample({
    kind: "capture_sort",
    source: session.sortSource === "ai" ? (changed ? "corrected" : "ai") : "manual",
    extracted: session.sortSource === "ai" ? { docs: session.aiSort.docs.map(label), excludedPageIds: session.aiSort.excludedPageIds } : null,
    final: { docs: state.sort.docs.map(label), excludedPageIds: state.sort.excludedPageIds },
    createdBy: c.user.id,
  });
}

// ── 5) Zahození a úklid ─────────────────────────────────────
/**
 * Neuložené doklady částečně uložené dávky → k zakázce skupiny jako „Ostatní" (nic se neztratí).
 * true = vše přiloženo (soubory relace jde smazat). Doklady skupiny bez zakázky přiložit nejde:
 * dropOrphans (uživatel dávku výslovně zavřel / zahodil) je pustí, jinak se relace nechá.
 */
export async function attachPendingDocs(c: Ctx, session: BatchSession, opts: { dropOrphans?: boolean } = {}): Promise<boolean> {
  const db = c.db;
  const steps = await readSteps(db, session.captureId);
  const plan = session.lastApply;
  if (!plan) return Boolean(opts.dropOrphans);
  let all = true;
  for (const g of plan.groups) {
    const gs = steps.get(`group:${g.key}`);
    const done = gs?.status === "done" ? (gs.result as unknown as GroupDone | null) : null;
    for (const docId of g.docIds) {
      if (steps.get(`doc:${docId}`)?.status === "done") continue;
      if (!done) { if (!opts.dropOrphans) all = false; continue; }
      const d = plan.docs.find((x) => x.id === docId);
      if (!d) continue;
      const draft: BatchDocDraft = {
        id: d.id, type: d.type, pageIds: d.pageIds, aiType: null, confidence: null, reason: "", title: d.title, documentNumber: "",
        partyName: "", drawingNumbers: [], format: null, flags: [], issuerCheck: "unknown", excluded: false,
      };
      const warnings: string[] = [];
      const att = await attachDocFiles({ ...c }, session, draft, done.jobId, {
        kind: "ostatni", title: d.title || BATCH_TYPES[d.type].label, note: "Neuloženo z focení — zkontroluj",
      }, warnings);
      const ids = att.ids;
      if (att.complete) {
        await writeStep(db, session.captureId, `doc:${docId}`, "done", { attachedAs: "ostatni", fileIds: ids });
        await logJobEvent(db, {
          jobId: done.jobId, type: "file", message: `Neuložený doklad z focení přiložen jako Ostatní: ${d.title || BATCH_TYPES[d.type].label}`,
          data: { captureId: session.captureId, docId, fileIds: ids }, actorId: c.user.id,
        });
      } else all = false;
    }
  }
  return all;
}

/**
 * Zahodit dávku: open → smazat stránky, náhledy, rozbalené položky a řádky; partial → neuložené
 * doklady přiložit jako „Ostatní" (nebo nechat relaci do úklidu). null = není to dávka (v1).
 */
export async function discardBatch(c: Ctx, captureId: string, extraPaths: string[]): Promise<{ ok: true } | { ok: false; error: string } | null> {
  const s = await readSession(c.db, c.user.id, captureId, { allowDone: true });
  if (!s) {
    const { data } = await c.db.from("capture_sessions").select("id").eq("id", captureId).eq("user_id", c.user.id).maybeSingle();
    return data ? { ok: true } : null;
  }
  const { session, status } = s;
  if (status === "partial") {
    const all = await attachPendingDocs(c, session, { dropOrphans: true });
    if (all) {
      await removeStoragePaths(c.db, [...sessionPaths(session), ...extraPaths]);
      await setSessionStatus(c.db, captureId, "discarded");
    }
    return { ok: true };
  }
  await removeStoragePaths(c.db, [...sessionPaths(session), ...extraPaths]);
  if (status === "done") await setSessionStatus(c.db, captureId, "discarded");
  else await deleteSessionRow(c.db, captureId);
  return { ok: true };
}


// ── Vstupy rout (oprávnění: „orders" + vlastník relace) ─────
const NO_SERVICE_KEY = "Dávkové focení potřebuje servisní klíč Supabase (Nastavení → Integrace).";

async function beginBatch(): Promise<Ctx | { error: string }> {
  const c = await begin();
  if ("error" in c) return c;
  if (!hasServiceKey()) return { error: NO_SERVICE_KEY };
  return c;
}

export async function captureBatchSession(input: { captureId: string }) {
  const c = await beginBatch();
  if ("error" in c) return fail(c.error);
  try {
    return await batchSession(c, input.captureId);
  } catch (err) {
    return fail(err);
  }
}

export async function captureBatchExtract(input: { captureId: string; docId: string; type: string; pageIds: unknown; force?: boolean }) {
  const c = await beginBatch();
  if ("error" in c) return fail(c.error);
  try {
    return await extractBatchDoc(c, input);
  } catch (err) {
    return fail(err);
  }
}

export async function captureBatchReview(input: ReviewRequest) {
  const c = await beginBatch();
  if ("error" in c) return fail(c.error);
  try {
    return await buildBatchReview(c, input);
  } catch (err) {
    return fail(err);
  }
}

export async function captureBatchJobs(input: { q: string }) {
  const c = await beginBatch();
  if ("error" in c) return fail(c.error);
  try {
    return await searchBatchJobs(c, input.q);
  } catch (err) {
    return fail(err);
  }
}

export async function captureBatchApply(input: ApplyBatchInput): Promise<BatchResult> {
  const c = await beginBatch();
  if ("error" in c) return { ok: false, status: "failed", error: c.error, aiUsed: false, groups: [], docs: [], pending: [], warnings: [] };
  return applyBatch(c, input);
}
