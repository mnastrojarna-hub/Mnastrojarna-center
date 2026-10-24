import "server-only";
import { addUsage, AiCallError, classifyAiError, routeDeadline } from "@/lib/ai/ai-call";
import { getAiConfig, getSetting } from "@/lib/settings";
import { can } from "@/lib/auth/permissions";
import { aiActor, SYSTEM_ACTOR, userActor, type ActorContext } from "@/lib/supabase/actor-headers";
import type { AiUsage } from "@/lib/jobs/capture-batch-types";
import { logUsage, spentToday } from "./budget";
import { isAnonCandidate, isUnsupportedExt, sourceFormat } from "./candidate";
import { accToDecide, decideAnonStatus, mergeBatch, type DecideInput } from "./decide";
import { isFakeAnon, termsPrompt, usageUsd, type AiCallConfig } from "./detect-ai";
import { anonFilename, outputExt } from "./filename";
import { describeSummary, summarize } from "./regions";
import {
  ANON_COLS, SUBJECT_SELECT, afterSettled, claim, event, label, loadSettings, priceDocIds, subjectOf,
  type AnonDb, type AnonTable, type Subject, type SubjectRow,
} from "./queue";
import { configHash, termsHash, type AnonSettings } from "./settings";
import { gatherTerms } from "./terms";
import { sha256Hex } from "./text";
import { ANON_CATEGORIES, type AnonCategory, type AnonMethod, type AnonPages, type AnonRegion, type AnonStatus, type AnonSummary, type AnonUsage, type AnonWarning, type KeepField } from "./types";
import type { RuleContext } from "./rules";

export * from "./queue";

/**
 * Služba anonymizace výkresů (spec §5): fronta (claim), zpracování jednoho souboru, rozvětvení
 * běhů (kick), ruční úpravy, schválení / přeskočení a navázání fronty odeslání.
 *
 * Vykresluje se JEN v routách /api/drawings/anonymize/**, /api/cron/drawing-anonymize/** a v after()
 * volaném z rout — nikdy v server action (renderer se načítá dynamicky: pdf-pipeline / photo-pipeline).
 * Zápisy jdou servisním klientem s autorem (DB strážce anon_* pustí jen náš server).
 */

// ── Nastavení a kontext běhu ──────────────────────────────────


async function moduleMode(db: AnonDb): Promise<"full" | "approval"> {
  try {
    const { data } = await db.from("automation_settings").select("mode, enabled").eq("module", "drawing_anonymize").maybeSingle();
    const r = data as { mode: "full" | "approval"; enabled: boolean } | null;
    if (r && r.enabled === false) return "approval";
    if (r?.mode) return r.mode;
    const { data: g } = await db.from("automation_global").select("mode").maybeSingle();
    return ((g as { mode: "full" | "approval" } | null)?.mode) ?? "approval";
  } catch {
    return "approval";
  }
}

function truthy(v: string | undefined, d: boolean): boolean {
  if (v === undefined || v === "") return d;
  return ["1", "true", "ano", "yes", "on"].includes(v.trim().toLowerCase());
}

/** Smí běh použít AI? (klíč, hlavní vypínač, ai_capture autora — u systému „AI pro všechny"). */
export async function aiConfigFor(db: AnonDb, userId: string | null, deadline: number, sha: string): Promise<AiCallConfig | null> {
  if (isFakeAnon()) return { apiKey: "fake", model: (await getAiConfig().catch(() => ({ model: "claude-opus-5-5" }))).model || "claude-opus-5-5", deadline, sha };
  const ai = await getAiConfig();
  if (!ai.apiKey) return null;
  const ctx = {
    aiEnabled: truthy(await getSetting("ai_enabled"), true),
    aiCaptureForAll: truthy(await getSetting("ai_capture_for_all"), true),
    aiConfigured: true,
  };
  if (!ctx.aiEnabled) return null;
  if (userId) {
    const { data } = await db.from("profiles").select("role, ai_access, active").eq("id", userId).maybeSingle();
    const p = data as { role: "super_admin" | "obchodnik" | "zamestnanec"; ai_access: boolean; active: boolean } | null;
    if (p && !can({ role: p.role, aiAccess: Boolean(p.ai_access), active: p.active !== false }, "ai_capture", ctx)) return null;
    if (!p && !ctx.aiCaptureForAll) return null;
  } else if (!ctx.aiCaptureForAll) return null;
  return { apiKey: ai.apiKey, model: ai.model, deadline, sha };
}

function keepValuesFrom(s: Subject): Partial<Record<KeepField, string>> {
  const ex = s.extracted ?? {};
  const d = (ex.drawing && typeof ex.drawing === "object" ? ex.drawing : ex) as Record<string, unknown>;
  const pick = (k: string) => (typeof d[k] === "string" && (d[k] as string).trim() ? (d[k] as string).trim() : undefined);
  const out: Partial<Record<KeepField, string>> = {};
  const dn = pick("drawingNumber");
  if (dn) out.drawingNumber = dn;
  const rev = pick("revision");
  if (rev && rev.length >= 1) out.revision = rev;
  const mat = pick("material");
  if (mat) out.material = mat;
  return out;
}

// ── Zpracování jednoho souboru ────────────────────────────────

export interface RunContext {
  actor: ActorContext;
  deadline: number;
  /** Ruční běh (tlačítko) — neblokuje denní limit. */
  manual: boolean;
  /** Uložení editoru: jen přepálení s ručními oblastmi, bez AI, výsledek done (+ reviewed). */
  manualSave?: boolean;
  /** Nová detekce AI i při existující cache (Přepočítat „i AI znovu"). */
  forceAi?: boolean;
  /** false = běh bez AI (jen pravidla → review), např. uživatel bez práva AI čtení. */
  allowAi?: boolean;
}

export interface AnonRunResult {
  id: string;
  table: AnonTable;
  status: AnonStatus;
  reason: string | null;
  continued?: boolean;
  summary?: AnonSummary;
}

interface PipelineOut {
  method: AnonMethod;
  bytes: Uint8Array | null;
  mime: string;
  ext: string;
  regions: AnonRegion[];
  texts: { regionId?: string; category: string; text: string }[];
  pages: AnonPages | null;
  decide: Omit<DecideInput, "mode">;
  usage: AiUsage | null;
  calls: number;
  aiCache: unknown;
  /** Číslo výkresu / revize nalezené na výkresu (keep pole) — pro anonymní název. */
  detected?: Partial<Record<KeepField, string>>;
  continued?: { pages: AnonPages; partBytes: Uint8Array | null };
  /** Navazující dávka: texty se přidají k textům předchozích dávek (nesmazat). */
  appendTexts?: boolean;
}

const BASE_DECIDE: Omit<DecideInput, "mode"> = {
  method: null, aiUsed: false, modelFallback: false, confidence: 1, ruleHitsCovered: true, outputChecksPassed: true, verifyClean: null,
  verifyKeepPresent: null, pxPerMm: null, isPhoto: false, hasMaster: false, warnings: [], customerStandard: false, termInKeep: false,
  titleBlockFound: true,
};

async function download(db: AnonDb, bucket: string, path: string): Promise<Uint8Array> {
  const { data, error } = await db.storage.from(bucket).download(path);
  if (error || !data) throw new Error(`Soubor se nepodařilo stáhnout: ${error?.message ?? "prázdný soubor"}`);
  return new Uint8Array(await data.arrayBuffer());
}

function asUsage(u: AiUsage | null, calls: number): AnonUsage {
  const base = u ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  return { ...base, usd: Math.round(usageUsd(base) * 10000) / 10000, calls };
}

async function readAiCache(db: AnonDb, sha: string, cfg: string): Promise<unknown | null> {
  const { data } = await db.from("drawing_anon_ai_cache").select("cache").eq("src_sha256", sha).eq("config_hash", cfg).maybeSingle();
  return (data as { cache: unknown } | null)?.cache ?? null;
}

async function writeAiCache(db: AnonDb, sha: string, cfg: string, method: string, cache: unknown, model: string | null) {
  if (!cache) return;
  await db.from("drawing_anon_ai_cache").upsert({ src_sha256: sha, config_hash: cfg, method, cache, model, created_at: new Date().toISOString() });
}

/** Pořadí výkresu v zakázce (pro název bez čísla výkresu). */
async function drawingIndex(db: AnonDb, s: Subject): Promise<{ index: number; jobNumber: string | null }> {
  if (s.table !== "job_files" || !s.jobId) return { index: 1, jobNumber: null };
  const { data: job } = await db.from("orders").select("number").eq("id", s.jobId).maybeSingle();
  const { data } = await db.from("job_files").select("id, kind, filename, mime_type, origin, issuer, created_at").eq("job_id", s.jobId).eq("archived", false).order("created_at", { ascending: true });
  const list = ((data ?? []) as { id: string; kind: string; filename: string; mime_type: string | null; origin: string | null; issuer: string | null }[])
    .filter((f) => isAnonCandidate(f.kind, f.filename, f.mime_type, f.origin, f.issuer));
  const i = list.findIndex((f) => f.id === s.id);
  return { index: i >= 0 ? i + 1 : list.length + 1, jobNumber: (job as { number: string } | null)?.number ?? null };
}

async function runPipeline(db: AnonDb, s: Subject, bytes: Uint8Array, fmt: ReturnType<typeof sourceFormat>, opts: {
  ctx: RuleContext; ai: AiCallConfig | null; settings: AnonSettings; systemExtra: string; keepValues: Partial<Record<KeepField, string>>;
  manual: AnonRegion[]; cache: unknown; deadline: number;
  /** Ruční uložení editoru — přenese se do navazujících dávek. */
  manualBy?: string | null;
}): Promise<PipelineOut | { unsupported: string }> {
  if (fmt === "pdf") {
    const { anonymizePdf } = await import("./pdf-pipeline");
    const prevPages = s.row.anon_pages;
    const pageFrom = prevPages?.next && prevPages.next > 1 ? prevPages.next : 1;
    const r = await anonymizePdf({
      bytes, ctx: opts.ctx, ai: opts.ai, systemExtra: opts.systemExtra, keepValues: opts.keepValues, verifyPhotos: opts.settings.verifyPhotos,
      fillPdf: opts.settings.fillPdf, fillPhoto: opts.settings.fillPhoto, maxDpi: opts.settings.maxDpi, maxMpx: opts.settings.maxMpx,
      pageFrom, deadline: opts.deadline, manual: opts.manual, cache: (opts.cache as never) ?? null,
    });
    if (r.failure && !r.pages.length) {
      if (/heslem|XFA|víc než|není platné|příliš velký/i.test(r.failure)) return { unsupported: r.failure };
      throw new Error(r.failure);
    }
    const included = [...(pageFrom > 1 ? prevPages?.included ?? [] : []), ...r.pages.filter((p) => p.included).map((p) => p.page)];
    const excluded = [...(pageFrom > 1 ? prevPages?.excluded ?? [] : []), ...r.pages.filter((p) => !p.included).map((p) => ({ page: p.page, why: "not_drawing" as const }))];
    const regions = [...(pageFrom > 1 ? (s.row.anon_regions ?? []).filter((x) => !x.manual) : []), ...r.pages.flatMap((p) => p.regions)];
    const inc = r.pages.filter((p) => p.included);
    const scanPages = inc.filter((p) => p.method !== "vector");
    // stav rozhodnutí přes VŠECHNY dávky (varování, zbytky, AI u každé stránky, jistota…)
    const acc = mergeBatch(pageFrom > 1 ? prevPages?.acc ?? null : null, {
      warnings: r.warnings, residue: r.pages.some((p) => p.residue), outputOk: r.outputProblems.length === 0,
      customerStandard: r.customerStandard, termInKeep: r.termInKeep, confidence: r.confidence, aiUsed: r.aiUsed, hasIncluded: inc.length > 0,
      fallback: r.fallback, titleBlockFound: inc.every((p) => p.titleBlockFound),
      verifyClean: scanPages.length ? (scanPages.some((p) => p.verifyClean === false) ? false : true) : null,
      verifyKeepMissing: scanPages.some((p) => p.verifyKeepPresent === false),
      detected: inc.find((p) => p.keepValues?.drawingNumber)?.keepValues,
      usage: asUsage(r.usage, r.calls),
    }, { manualBy: opts.manualBy ?? (pageFrom > 1 ? prevPages?.acc?.manualBy ?? null : null) });
    const pages: AnonPages = { total: r.totalPages, included, excluded, next: r.failure ? null : r.next, parts: [...(pageFrom > 1 ? prevPages?.parts ?? [] : [])], acc };
    const decide: Omit<DecideInput, "mode"> = {
      ...BASE_DECIDE,
      ...accToDecide(acc, { method: "raster_pdf", failure: r.failure, notDrawing: !included.length && (r.next === null || Boolean(r.failure)) }),
    };
    if (excluded.length && included.length) decide.warnings.push({ code: "excluded_pages", message: `Vynecháno ${excluded.length} stran, které nejsou výkresem (dopis, faktura…).` });
    const texts = r.pages.flatMap((p) => p.texts);
    // chyba stránky (písma, prázdný render, výstup) → hned failed, nenavazovat
    if (r.failure) {
      return { method: "raster_pdf", bytes: null, mime: "application/pdf", ext: "pdf", regions, texts, pages, decide, usage: r.usage, calls: r.calls, aiCache: r.cache, appendTexts: pageFrom > 1 };
    }
    if (r.next !== null) {
      return { method: "raster_pdf", bytes: null, mime: "application/pdf", ext: "pdf", regions, texts, pages, decide, usage: r.usage, calls: r.calls, aiCache: r.cache, continued: { pages, partBytes: r.partPdf }, appendTexts: pageFrom > 1 };
    }
    // spojení částí z předchozích běhů
    let out = r.partPdf;
    if (pages.parts?.length) {
      const parts: Uint8Array[] = [];
      for (const p of pages.parts) parts.push(await download(db, s.bucket, p));
      if (r.partPdf) parts.push(r.partPdf);
      const { mergePdfParts, checkPdfOutput } = await import("./pdf-raster");
      out = parts.length ? await mergePdfParts(parts) : null;
      if (out) {
        const chk = await checkPdfOutput(out, undefined);
        const { openPdf } = await import("./pdf-node");
        const doc = await openPdf(out, { requireFonts: false });
        const n = doc.numPages;
        await doc.destroy().catch(() => undefined);
        if (!chk.ok || n !== included.length) decide.outputChecksPassed = false;
      }
    }
    return { method: "raster_pdf", bytes: out, mime: "application/pdf", ext: "pdf", regions, texts, pages, decide, usage: r.usage, calls: r.calls, aiCache: r.cache, detected: acc.detected, appendTexts: pageFrom > 1 };
  }
  if (fmt === "image" || fmt === "tiff" || fmt === "heic") {
    const { anonymizeImage } = await import("./photo-pipeline");
    const r = await anonymizeImage({
      bytes, hasMaster: s.hasMaster, ctx: opts.ctx, ai: opts.ai, systemExtra: opts.systemExtra, keepValues: opts.keepValues,
      verify: opts.settings.verifyPhotos, fill: opts.settings.fillPhoto, manual: opts.manual, cache: (opts.cache as never) ?? null,
    });
    if (r.unsupported) return { unsupported: r.unsupported };
    const pages: AnonPages = { total: r.pages, included: Array.from({ length: r.pages }, (_, i) => i + 1), excluded: [] };
    return {
      method: r.method, bytes: r.bytes, mime: r.mime, ext: r.ext, regions: r.regions, texts: r.texts, pages,
      decide: {
        ...BASE_DECIDE, method: r.method, aiUsed: r.aiUsed, modelFallback: r.fallback, confidence: r.confidence, outputChecksPassed: r.outputProblems.length === 0,
        verifyClean: r.verifyClean, verifyKeepPresent: r.verifyKeepPresent, pxPerMm: r.pxPerMm, isPhoto: true, hasMaster: s.hasMaster,
        warnings: r.warnings, customerStandard: r.customerStandard, termInKeep: r.termInKeep, titleBlockFound: r.titleBlockFound,
        notDrawing: r.isDrawing === false,
      },
      usage: r.usage, calls: r.calls, aiCache: r.cache, detected: r.keepValues,
    };
  }
  if (fmt === "dxf") {
    const { anonymizeDxf } = await import("./dxf");
    const r = anonymizeDxf(bytes, opts.ctx);
    if (r.unsupported || !r.bytes) return { unsupported: r.unsupported ?? "DXF nelze přečíst." };
    return {
      method: "dxf", bytes: r.bytes, mime: "application/dxf", ext: "dxf", regions: [], texts: r.texts, pages: null,
      decide: { ...BASE_DECIDE, method: "dxf", aiUsed: false, warnings: [...r.warnings, ...(r.verified ? [] : [{ code: "residue" as const, message: `Kontrola DXF: ${r.problems.join(", ")}` }])], outputChecksPassed: r.verified },
      usage: null, calls: 0, aiCache: null,
    };
  }
  if (fmt === "step") {
    const { anonymizeStep } = await import("./step");
    const r = anonymizeStep(bytes, opts.ctx);
    if (r.unsupported || !r.bytes) return { unsupported: r.unsupported ?? "STEP nelze přečíst." };
    const warnings: AnonWarning[] = [];
    if (r.suspicious) warnings.push({ code: "step_suspicious", message: "Ve STEP zůstal podezřelý text (e-mail, doména, právní forma) — zkontroluj." });
    if (r.problems.length) warnings.push({ code: "residue", message: "Ve STEP zůstal citlivý text — zkontroluj." });
    // bez termínů zakázky (zákazník z CRM) pravidla nepoznají název firmy v názvu / popisu dílu
    if (!opts.ctx.terms.length) warnings.push({ code: "no_terms", message: "STEP bez známého zákazníka (CRM) — zkontroluj názvy a popisy dílů." });
    return {
      method: "step", bytes: r.bytes, mime: "application/step", ext: /\.stp$/i.test(s.filename) ? "stp" : "step", regions: [], texts: r.texts, pages: null,
      // STEP bez AI: pravidla jsou úplná (literály), výsledek done bez varování
      decide: { ...BASE_DECIDE, method: "step", aiUsed: true, confidence: 1, warnings, termInKeep: r.termInKeep, outputChecksPassed: r.problems.length === 0 },
      usage: null, calls: 0, aiCache: null,
    };
  }
  return { unsupported: "Formát nelze anonymizovat — pošli dodavateli PDF, DXF nebo STEP." };
}

/** Atribuce běhu: ručně = uživatel, automatika = AI za nahrávajícího (bez AI = systém). */
export function runActor(s: Subject, ctx: RunContext, aiUsed: boolean): ActorContext {
  if (ctx.manual || ctx.manualSave) return ctx.actor;
  return aiUsed ? aiActor(s.uploadedBy, "drawing-anon", "automaticky") : { ...SYSTEM_ACTOR };
}

/** Čitelné texty smazaných oblastí (jen super admin). append = navazující dávka (texty dřívějších dávek zůstanou). */
async function writeTexts(db: AnonDb, s: Subject, texts: { regionId?: string; category: string; text: string }[], append = false) {
  const col = s.table === "job_files" ? "job_file_id" : s.table === "drawings" ? "drawing_id" : "adhoc_id";
  if (!append) await db.from("drawing_anon_texts").delete().eq(col, s.id);
  const prefix = append ? `${crypto.randomUUID().slice(0, 6)}-` : "";
  const rows = texts.slice(0, 500).map((t, i) => ({ [col]: s.id, region_id: t.regionId ?? `${prefix}t${i}`, category: t.category, text: t.text.slice(0, 500) }));
  const uniq = new Map(rows.map((r) => [r.region_id as string, r]));
  if (append && uniq.size) {
    // id oblastí jsou po stránkách (p11-…) — už zapsané se nepřepisují
    const { data: have } = await db.from("drawing_anon_texts").select("region_id").eq(col, s.id).limit(5000);
    for (const h of (have ?? []) as { region_id: string }[]) uniq.delete(h.region_id);
  }
  if (uniq.size) await db.from("drawing_anon_texts").insert([...uniq.values()]);
}



async function finish(db: AnonDb, s: Subject, patch: Record<string, unknown>): Promise<void> {
  const { error } = await db.from(s.table).update({ ...patch, anon_lock_until: null, ...(s.table === "drawing_anon_adhoc" ? { updated_at: new Date().toISOString() } : {}) }).eq("id", s.id);
  if (error) throw new Error(`Uložení výsledku anonymizace selhalo: ${error.message}`);
}

/** Útrata AI jednoho běhu (sčítá se po každém volání — i když běh potom selže). */
interface Spend {
  usage: AiUsage | null;
  calls: number;
}

/** Zpracuje jeden (claimnutý) soubor. Útrata AI se zapíše do drawing_anon_usage_log vždy (i při chybě). */
export async function anonymizeOne(db: AnonDb, table: AnonTable, row: SubjectRow, ctxIn: RunContext): Promise<AnonRunResult> {
  // navazující dávka po ručním uložení editoru → stejný uživatel, bez AI, výsledek done (+ reviewed)
  const manualBy = !ctxIn.manualSave && (row.anon_pages?.next ?? 0) > 1 ? row.anon_pages?.acc?.manualBy ?? null : null;
  const ctx: RunContext = manualBy ? { ...ctxIn, manual: true, manualSave: true, actor: userActor({ id: manualBy }, "rucne") } : ctxIn;
  const spend: Spend = { usage: null, calls: 0 };
  try {
    const res = await anonymizeOneInner(db, table, row, ctx, spend);
    if (manualBy && res.status === "done") {
      await event(db, subjectOf(table, row), ctx.actor, "Anonymizace upravena ručně (dokončeno po dávkách stran)", { manual: true }).catch(() => undefined);
    }
    return res;
  } finally {
    await logUsage(db, {
      table, id: row.id, via: ctx.manual || ctx.manualSave ? "rucne" : (row.anon_via ?? "automaticky"), manual: Boolean(ctx.manual || ctx.manualSave),
      usage: spend.usage, calls: spend.calls,
    });
  }
}

async function anonymizeOneInner(db: AnonDb, table: AnonTable, row: SubjectRow, ctx: RunContext, spend: Spend): Promise<AnonRunResult> {
  const t0 = Date.now();
  const s = subjectOf(table, row);
  const baseVia = ctx.manual || ctx.manualSave ? "rucne" : (row.anon_via ?? "automaticky");
  try {
    const settings = await loadSettings(db);
    const mode = ctx.manualSave ? "full" : await moduleMode(db);
    let fmt = sourceFormat(s.filename, s.mime);
    if (fmt === "unsupported" || isUnsupportedExt(s.filename)) {
      const reason = "Formát nelze anonymizovat — pošli dodavateli PDF, DXF nebo STEP.";
      await finish(db, s, { anon_status: "unsupported", anon_reason: reason, anon_at: new Date().toISOString(), anon_actor_kind: "system", anon_via: baseVia });
      return { id: s.id, table, status: "unsupported", reason };
    }
    // nákupní doklad (#25 — ceny dodavatele) se neanonymizuje: kopie by obešla pravidlo o cenách
    if (table === "job_files" && (await priceDocIds(db, [s.id])).has(s.id.toLowerCase())) {
      const reason = "Nákupní doklad — neanonymizuje se.";
      await finish(db, s, { anon_status: "skipped", anon_reason: reason, anon_at: new Date().toISOString(), anon_actor_kind: "system", anon_via: baseVia, anon_path: null });
      await removeOld(db, s, row, null);
      await afterSettled(db, s);
      return { id: s.id, table, status: "skipped", reason };
    }
    if (!s.sourcePath) throw new Error("Soubor nemá uloženou cestu.");
    const bytes = await download(db, s.bucket, s.sourcePath);
    if (bytes.length > 50 * 1024 * 1024) {
      await finish(db, s, { anon_status: "failed", anon_reason: "Soubor je větší než 50 MB — anonymizuj ho po částech.", anon_at: new Date().toISOString() });
      return { id: s.id, table, status: "failed", reason: "Soubor je větší než 50 MB." };
    }
    fmt = sourceFormat(s.filename, s.mime, bytes.subarray(0, 16));
    const sha = await sha256Hex(bytes);
    const gathered = await gatherTerms(db, { jobId: s.jobId, settings, extracted: s.extracted });
    const ruleCtx: RuleContext = { terms: gathered.terms, keepTerms: gathered.keep, redact: settings.redact };
    const cfgHash = await configHash(settings);
    const tHash = await termsHash(gathered.raw);
    const manual = (row.anon_regions ?? []).filter((r) => r && r.manual);

    // cache výsledku AI podle obsahu (M11)
    let aiCache: unknown = null;
    if (ctx.manualSave || !ctx.forceAi) aiCache = await readAiCache(db, sha, cfgHash);
    // stejný obsah + stejné termíny + bez ručních zásahů → kopie hotového výstupu (bez AI i bez renderu)
    if (aiCache && !manual.length && !ctx.manualSave && table === "job_files") {
      const { data: twin } = await db.from("job_files").select(`id, job_id, ${ANON_COLS}`)
        .eq("anon_summary->>srcSha", sha).eq("anon_config_hash", cfgHash).eq("anon_terms_hash", tHash).in("anon_status", ["done", "review"]).neq("id", s.id).limit(1);
      const tw = ((twin ?? []) as SubjectRow[])[0];
      if (tw?.anon_path && tw.anon_sha256) {
        const newPath = `${s.outPrefix}${crypto.randomUUID()}-${String(tw.anon_filename ?? "vykres.pdf")}`;
        const { error: cpErr } = await db.storage.from("job-files").copy(String(tw.anon_path), newPath);
        if (!cpErr) {
          const regions = ((tw.anon_regions ?? []) as AnonRegion[]).map((r) => ({ ...r, source: "cache" as const }));
          const st = (mode === "approval" ? "review" : tw.anon_status) as AnonStatus;
          const summary = { ...((tw.anon_summary ?? {}) as AnonSummary), srcSha: sha, cachedFrom: tw.id } as AnonSummary;
          const actor = runActor(s, ctx, true);
          await finish(db, s, {
            anon_status: st, anon_path: newPath, anon_filename: tw.anon_filename, anon_mime: tw.anon_mime, anon_size: tw.anon_size, anon_sha256: tw.anon_sha256,
            anon_method: tw.anon_method, anon_pages: tw.anon_pages, anon_regions: regions, anon_summary: summary, anon_confidence: tw.anon_confidence,
            anon_reason: st === "review" ? (tw.anon_reason ?? "Režim se schválením — zkontroluj anonymizaci.") : null, anon_config_hash: cfgHash, anon_terms_hash: tHash,
            anon_ai_cache: { ref: sha }, anon_at: new Date().toISOString(), anon_by: actor.id, anon_actor_kind: actor.kind, anon_via: baseVia, anon_usage: asUsage(null, 0),
          });
          const { data: tt } = await db.from("drawing_anon_texts").select("region_id, category, text").eq("job_file_id", tw.id);
          await writeTexts(db, s, ((tt ?? []) as { region_id: string; category: string; text: string }[]).map((x) => ({ regionId: x.region_id, category: x.category, text: x.text })));
          await event(db, s, actor, `AI anonymizovala výkres ${label(s)} (převzato ze stejného souboru) — ${describeSummary(summary)}`, { anonStatus: st, cached: true });
          await afterSettled(db, s);
          return { id: s.id, table, status: st, reason: null, summary };
        }
      }
    }

    // AI povolena? (ruční uložení editoru AI nevolá). Cache je PO STRÁNKÁCH — AI se volá jen pro stránky,
    // které v ní chybí (navazující dávky PDF), proto se konfigurace připraví i při existující cache.
    let ai: AiCallConfig | null = null;
    if (!ctx.manualSave && ctx.allowAi !== false && (fmt === "pdf" || fmt === "image" || fmt === "tiff" || fmt === "heic")) {
      ai = await aiConfigFor(db, ctx.manual ? ctx.actor.id : s.uploadedBy, ctx.deadline, sha);
      if (ai) ai.onUsage = (u) => { spend.usage = addUsage(spend.usage, u); spend.calls++; };
    }
    // denní limit jen pro automatiku (s hotovou cache se nic neplatí)
    if (ai && !aiCache && !ctx.manual && !isFakeAnon()) {
      const spent = await spentToday(db);
      if (spent >= settings.dailyUsd) {
        // odložit do zítřka (pending se zámkem — claim ho do té doby nevezme)
        const { pragueDayStart } = await import("./budget");
        const tomorrow = new Date(Date.parse(pragueDayStart()) + 24 * 3_600_000 + 5 * 60_000).toISOString();
        await db.from(s.table).update({ anon_status: "pending", anon_lock_until: tomorrow, anon_attempts: Math.max(0, (row.anon_attempts ?? 1) - 1), anon_reason: "Denní limit AI pro automatiku je vyčerpán — pokračuje zítra (nebo spusť ručně)." }).eq("id", s.id);
        return { id: s.id, table, status: "pending", reason: "budget" };
      }
    }

    const keepValues = keepValuesFrom(s);
    const systemExtra = termsPrompt(gathered.raw, gathered.keep);
    let out: PipelineOut | { unsupported: string };
    const aiFailWarnings: AnonWarning[] = [];
    const manualBy = ctx.manualSave ? ctx.actor.id : null;
    try {
      out = await runPipeline(db, s, bytes, fmt, { ctx: ruleCtx, ai, settings, systemExtra, keepValues, manual, cache: aiCache, deadline: ctx.deadline, manualBy });
    } catch (err) {
      if (!(err instanceof AiCallError) || !ai) throw err;
      // AI selhala → jen pravidla (výsledek ke kontrole)
      aiFailWarnings.push({ code: "ai_failed", message: `AI detekce selhala (${err.message}) — použita jen pravidla.` });
      out = await runPipeline(db, s, bytes, fmt, { ctx: ruleCtx, ai: null, settings, systemExtra, keepValues, manual, cache: null, deadline: ctx.deadline, manualBy });
    }
    if ("unsupported" in out) {
      await finish(db, s, { anon_status: "unsupported", anon_reason: out.unsupported, anon_at: new Date().toISOString(), anon_actor_kind: "system", anon_via: baseVia });
      await event(db, s, SYSTEM_ACTOR, `Výkres ${label(s)} nelze anonymizovat — ${out.unsupported}`, { anonStatus: "unsupported" });
      await afterSettled(db, s);
      return { id: s.id, table, status: "unsupported", reason: out.unsupported };
    }
    out.decide.warnings.push(...aiFailWarnings);
    if (out.pages?.acc && aiFailWarnings.length) out.pages.acc.warnings.push(...aiFailWarnings);
    const actor = runActor(s, ctx, out.decide.aiUsed);
    // u PDF po dávkách sečtená útrata všech dávek
    const usage = out.pages?.acc?.usage ?? asUsage(out.usage, out.calls);

    // navazování po dávkách stránek
    if (out.continued) {
      const partPath = out.continued.partBytes ? `${s.outPrefix}${s.id}/part-${(out.continued.pages.parts?.length ?? 0) + 1}.pdf` : null;
      if (partPath && out.continued.partBytes) {
        const { error: upErr } = await db.storage.from(s.bucket).upload(partPath, out.continued.partBytes, { contentType: "application/pdf", upsert: true });
        if (upErr) throw new Error(`Uložení části selhalo: ${upErr.message}`);
      }
      const pages = { ...out.continued.pages, parts: [...(out.continued.pages.parts ?? []), ...(partPath ? [partPath] : [])] };
      await db.from(s.table).update({
        anon_status: "pending", anon_lock_until: null, anon_attempts: Math.max(0, (row.anon_attempts ?? 1) - 1), anon_pages: pages,
        anon_regions: [...out.regions.filter((r) => !r.manual), ...manual], anon_usage: usage,
      }).eq("id", s.id);
      await writeTexts(db, s, out.texts, out.appendTexts);
      if (out.aiCache) await writeAiCache(db, sha, cfgHash, out.method, out.aiCache, null);
      return { id: s.id, table, status: "pending", reason: null, continued: true };
    }

    // název, upload
    const regions = out.regions;
    const drawingNumber = keepValues.drawingNumber ?? out.detected?.drawingNumber;
    const revision = keepValues.drawingNumber ? keepValues.revision : out.detected?.revision ?? keepValues.revision;
    const idx = await drawingIndex(db, s);
    const name = anonFilename({ drawingNumber, revision, ext: outputExt(out.method, out.ext), jobNumber: idx.jobNumber, index: idx.index, terms: ruleCtx.terms });
    if (name.review) out.decide.warnings.push({ code: "term_in_keep", message: name.review });

    const decideIn: DecideInput = { ...out.decide, mode };
    const decision = decideAnonStatus(decideIn);
    let status = decision.status;
    let reason = decision.reason;
    let reviewed: Record<string, unknown> = {};
    if (ctx.manualSave && (status === "review" || status === "done")) {
      status = "done";
      reason = null;
      reviewed = { anon_reviewed_at: new Date().toISOString(), anon_reviewed_by: ctx.actor.id };
    }
    if (status === "skipped") {
      await finish(db, s, {
        anon_status: "skipped", anon_reason: "Není výkres", anon_at: new Date().toISOString(), anon_by: actor.id, anon_actor_kind: out.decide.aiUsed ? "ai" : "system",
        anon_via: baseVia, anon_pages: out.pages, anon_usage: usage, anon_config_hash: cfgHash, anon_terms_hash: tHash, anon_path: null,
        anon_summary: { counts: {}, total: 0, warnings: [], srcSha: sha } as unknown as AnonSummary,
      });
      if (out.aiCache) await writeAiCache(db, sha, cfgHash, out.method, out.aiCache, null);
      await event(db, s, actor, `${out.decide.aiUsed ? "AI" : "Systém"}: ${label(s)} není výkres — anonymizace přeskočena`, { anonStatus: "skipped" });
      await removeOld(db, s, row, null);
      await afterSettled(db, s);
      return { id: s.id, table, status: "skipped", reason: "Není výkres" };
    }
    if (status === "failed" || status === "pending" || !out.bytes) {
      const r = reason ?? "Výstup se nepodařilo vytvořit.";
      const retry: AnonStatus = status === "pending" ? "pending" : "failed";
      // nový pokus začne od první strany (části předchozích dávek pryč)
      await finish(db, s, { anon_status: retry, anon_reason: r, anon_at: new Date().toISOString(), anon_usage: usage, ...(out.method === "raster_pdf" ? { anon_pages: null } : {}) });
      await removeParts(db, s, row);
      await event(db, s, actor, `Anonymizace výkresu ${label(s)} selhala — ${r}`, { anonStatus: retry });
      await afterSettled(db, s);
      return { id: s.id, table, status: retry as AnonStatus, reason: r };
    }
    const outPath = `${s.outPrefix}${crypto.randomUUID()}-${name.filename}`;
    const { error: upErr } = await db.storage.from(s.bucket).upload(outPath, out.bytes, { contentType: out.mime, upsert: false });
    if (upErr) throw new Error(`Uložení anonymizované kopie selhalo: ${upErr.message}`);
    const outSha = await sha256Hex(out.bytes);
    const summary: AnonSummary & { srcSha?: string } = {
      ...summarize(regions, decision.warnings), method: out.method, ms: Date.now() - t0, aiCalls: out.calls, srcSha: sha,
      ...(out.pages ? { pages: { total: out.pages.total, included: out.pages.included, excluded: out.pages.excluded } } : {}),
    };
    await finish(db, s, {
      anon_status: status, anon_path: outPath, anon_filename: name.filename, anon_mime: out.mime, anon_size: out.bytes.length, anon_sha256: outSha,
      anon_method: out.method, anon_pages: out.pages ? { ...out.pages, next: null, parts: [] } : null,
      // ruční sada (i „removed") zůstává — při přepočtu má přednost
      anon_regions: [...regions.filter((r) => !r.manual), ...manual], anon_summary: summary,
      anon_confidence: Math.max(0, Math.min(1, Math.round(out.decide.confidence * 1000) / 1000)), anon_reason: reason, anon_config_hash: cfgHash, anon_terms_hash: tHash,
      anon_ai_cache: out.aiCache ? { ref: sha } : null, anon_at: new Date().toISOString(), anon_by: actor.id, anon_actor_kind: actor.kind, anon_via: baseVia,
      anon_usage: usage, ...reviewed,
    });
    await writeTexts(db, s, out.texts, out.appendTexts);
    if (out.aiCache) await writeAiCache(db, sha, cfgHash, out.method, out.aiCache, null);
    const who = actor.kind === "ai" ? "AI anonymizovala" : actor.kind === "user" ? "Anonymizováno ručně —" : "Systém anonymizoval";
    const msg = status === "review"
      ? `${who} výkres ${label(s, drawingNumber)} — ke kontrole: ${reason ?? "zkontroluj"} (${describeSummary(summary)})`
      : `${who} výkres ${label(s, drawingNumber)} — ${describeSummary(summary)}`;
    await event(db, s, actor, msg, { anonStatus: status, counts: summary.counts, total: summary.total });
    await removeOld(db, s, row, outPath);
    await afterSettled(db, s);
    return { id: s.id, table, status, reason, summary };
  } catch (err) {
    const failure = classifyAiError(err);
    const message = err instanceof Error ? err.message.slice(0, 300) : "Neočekávaná chyba.";
    const attempts = row.anon_attempts ?? 1;
    const status: AnonStatus = attempts < 3 && failure !== "auth" && failure !== "spend_limit" ? "pending" : "failed";
    try {
      await db.from(s.table).update({ anon_status: status, anon_reason: message, anon_lock_until: null, ...(status === "failed" ? { anon_at: new Date().toISOString() } : {}) }).eq("id", s.id);
      if (status === "failed") {
        await event(db, s, SYSTEM_ACTOR, `Anonymizace výkresu ${label(s)} selhala — ${message}`, { anonStatus: "failed" });
        await afterSettled(db, s);
      }
    } catch {
      // zápis chyby nesmí shodit běh
    }
    return { id: s.id, table, status, reason: message };
  }
}

/** Smaže části navazujících dávek (originál ani hotový výstup ne). */
async function removeParts(db: AnonDb, s: Subject, row: SubjectRow) {
  const paths = ((row.anon_pages?.parts ?? []) as string[]).filter((p) => typeof p === "string" && p.startsWith(s.outPrefix) && p !== s.storagePath && p !== row.anon_path);
  if (paths.length) await db.storage.from(s.bucket).remove(paths).catch(() => undefined);
}

/** Smaže předchozí výstup a části (originál nikdy). */
async function removeOld(db: AnonDb, s: Subject, row: SubjectRow, keepPath: string | null) {
  const paths = [row.anon_path, ...((row.anon_pages?.parts ?? []) as string[])].filter((p): p is string => typeof p === "string" && p.startsWith(s.outPrefix) && p !== keepPath && p !== s.storagePath);
  if (paths.length) await db.storage.from(s.bucket).remove(paths).catch(() => undefined);
}



/** Claim + zpracování (route run / after()). */
export async function runClaimed(db: AnonDb, table: AnonTable, ids: string[] | null, ctx: Omit<RunContext, "actor"> & { actor?: ActorContext }, limit = 1): Promise<AnonRunResult[]> {
  const rows = await claim(db, table, limit, ids);
  const out: AnonRunResult[] = [];
  for (const r of rows) {
    if (Date.now() > ctx.deadline - 30_000) break;
    out.push(await anonymizeOne(db, table, r, { ...ctx, actor: ctx.actor ?? SYSTEM_ACTOR }));
  }
  return out;
}

export function defaultDeadline(start = Date.now()): number {
  return routeDeadline(start);
}

// ── Ruční úpravy, schválení, přeskočení ───────────────────────

export function validateManualRegions(input: unknown): AnonRegion[] | null {
  if (!Array.isArray(input) || input.length > 500) return null;
  const out: AnonRegion[] = [];
  for (const r of input as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") return null;
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
    const x = n(r.x), y = n(r.y), w = n(r.w), h = n(r.h), page = n(r.page);
    if (![x, y, w, h, page].every(Number.isFinite) || page < 1 || page > 500 || x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1.0001 || y + h > 1.0001) return null;
    const manual = r.manual === "added" || r.manual === "removed" ? r.manual : null;
    if (!manual) continue; // automatické oblasti posílá klient jen pro zobrazení
    const category = (ANON_CATEGORIES as readonly string[]).includes(String(r.category)) ? (r.category as AnonCategory) : "other";
    const id = typeof r.id === "string" && /^[A-Za-z0-9:_-]{1,80}$/.test(r.id) ? r.id : `m-${crypto.randomUUID().slice(0, 12)}`;
    const reg: AnonRegion = { id, page: Math.floor(page), x, y, w, h, category, source: "manual", zone: "body", manual };
    if (Array.isArray(r.quad) && r.quad.length === 8 && (r.quad as unknown[]).every((v) => typeof v === "number" && v >= 0 && v <= 1)) reg.quad = r.quad as AnonRegion["quad"];
    out.push(reg);
  }
  return out;
}

/** Uloží ruční sadu oblastí (optimistický zámek přes anon_at) a vypálí znovu bez AI → done. */
export async function saveManualRegions(db: AnonDb, table: AnonTable, id: string, regions: AnonRegion[], expectedAt: string | null, actor: ActorContext, deadline: number): Promise<AnonRunResult | { conflict: true } | { notFound: true }> {
  const { data } = await db.from(table).select(SUBJECT_SELECT[table]).eq("id", id).maybeSingle();
  const row = data as unknown as SubjectRow | null;
  if (!row) return { notFound: true };
  if ((row.anon_at ?? null) !== (expectedAt ?? null)) return { conflict: true };
  const prevManual = (row.anon_regions ?? []).filter((r) => r.manual);
  const auto = (row.anon_regions ?? []).filter((r) => !r.manual);
  const nextRow: SubjectRow = { ...row, anon_regions: [...auto, ...regions], anon_pages: null };
  const res = await anonymizeOne(db, table, nextRow, { actor, deadline, manual: true, manualSave: true });
  const added = regions.filter((r) => r.manual === "added" && !prevManual.some((p) => p.id === r.id)).length;
  const removed = regions.filter((r) => r.manual === "removed" && !prevManual.some((p) => p.id === r.id)).length;
  if (res.status === "done") {
    const s = subjectOf(table, row);
    // seznam ručních zásahů zůstává (manual:*) — při přepočtu se nepřepočítávají
    const { data: cur } = await db.from(table).select("anon_regions").eq("id", id).maybeSingle();
    const curRegions = ((cur as { anon_regions: AnonRegion[] | null } | null)?.anon_regions ?? []).filter((r) => !r.manual);
    await db.from(table).update({ anon_regions: [...curRegions, ...regions] }).eq("id", id);
    await event(db, s, actor, `Anonymizace upravena ručně (+${added}, −${removed})`, { added, removed });
  }
  return res;
}
