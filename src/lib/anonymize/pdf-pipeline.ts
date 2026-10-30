import "server-only";
import { addUsage } from "@/lib/ai/ai-call";
import type { AiUsage } from "@/lib/jobs/capture-batch-types";
import { boxInsideSent, fitForClaude } from "./claude-image";
import { refineCut } from "./cut-refine";
import { asArray, asNumber, detectVector, isCategory, type AiCallConfig, type AiImageSpec, type VectorPageResult } from "./detect-ai";
import { maybeGray, rasterToJpeg } from "./image";
import { itemFrame, lineRangeToItems, quadBox, substringQuad } from "./lines";
import { openPdf, PDF_MAX_IMAGE_PX, PdfUnsupportedError, type PdfDocument, type PdfPage } from "./pdf-node";
import { preparePdf, type PreparedPdf } from "./pdf-prepare";
import {
  backgroundLevel, buildRasterPdf, burnGraphic, burnRectKeepLines, checkPdfOutput, contrastInkFraction, encodeFlate, encodeJpeg, fillRect, inkFraction,
  PAGE_BUDGET_BYTES, MIN_DPI, renderPageRaster, renderRegion, ringResidue, targetDpi, type OutPage, type Raster,
} from "./pdf-raster";
import { extractPage, looksLikeCadProducer, MAX_PDF_PAGES, PAGES_PER_RUN, type PdfPageInfo } from "./pdf-text";
import {
  applyManual, areaCapWarning, burnable, intersection, intersects, mergeRegions, normalizeRegion, padRegion, protectKeep, sortRegions,
  type RawKeep, type RawRegion,
} from "./regions";
import { containsTerm, filterToggles, isTechnicalText, rulePage, type RuleContext } from "./rules";
import { normalizeText, sha256Hex } from "./text";
import { runVision, type VisionAiCache } from "./vision";
import type { AnonCategory, AnonRegion, AnonWarning, Box, KeepField, LineHit, TextItem } from "./types";

/**
 * Anonymizace PDF (vektor i sken): příprava (zploštění tištěných anotací, kontrola velkých obrázků),
 * detekce (pravidla ∪ AI), vypálení do rastru, nové PDF a výstupní kontroly. Jeden běh = dávka stran
 * (≤ PAGES_PER_RUN a ≤ PIXEL_BUDGET px renderu, s ohledem na deadline; navazování přes `next`).
 * Cache AI je PO STRÁNKÁCH — stránka bez výsledku v cache dostane volání AI (navazující dávky).
 */

export interface PdfAiCache {
  v: 1;
  vector: Record<number, VectorPageResult>;
  specs: Omit<AiImageSpec, "jpeg">[];
  vision: Record<number, VisionAiCache>;
  model: string | null;
  fallback: boolean;
  /** Jistota prvního volání (starší cache bez pageConf). */
  confidence: number;
  /** Jistota AI po stránkách. */
  pageConf?: Record<number, number>;
}

export interface PdfAnonInput {
  bytes: Uint8Array;
  ctx: RuleContext;
  ai: AiCallConfig | null;
  systemExtra?: string;
  keepValues?: Partial<Record<KeepField, string>>;
  verifyPhotos: boolean;
  fillPdf: "white" | "black";
  fillPhoto: "background" | "white" | "black";
  maxDpi: number;
  maxMpx: number;
  /** První stránka tohoto běhu (1-based). */
  pageFrom: number;
  deadline: number;
  manual?: AnonRegion[];
  cache?: PdfAiCache | null;
  /** Mez pixelů renderu na dávku (testy). */
  pixelBudget?: number;
}

export interface PdfRegionText {
  regionId: string;
  category: AnonCategory;
  text: string;
}

export interface PdfPageResult {
  page: number;
  included: boolean;
  why?: "not_drawing";
  out?: OutPage;
  regions: AnonRegion[];
  texts: PdfRegionText[];
  method: "vector" | "scan" | "vision";
  ruleHits: number;
  inkFailed: boolean;
  residue: boolean;
  verifyClean: boolean | null;
  verifyKeepPresent: boolean | null;
  titleBlockFound: boolean;
  /** Stránka má výsledek AI (volání v tomto běhu nebo cache). */
  aiUsed: boolean;
  /** Jistota AI stránky (1 bez AI). */
  aiConfidence: number;
  /** Prázdný render neprázdné stránky (obrázek vynechaný pdf.js…). */
  blank?: boolean;
  /** Nalezené keep hodnoty (číslo výkresu, revize) — pro anonymní název souboru. */
  keepValues?: Partial<Record<KeepField, string>>;
}

/** Keep hodnoty z nalezených polí (jen rozumně vypadající číslo výkresu / revize). */
export function keepValuesOf(keep: RawKeep[]): Partial<Record<KeepField, string>> {
  const out: Partial<Record<KeepField, string>> = {};
  for (const k of keep) {
    const v = (k.value ?? "").trim();
    if (k.field === "drawingNumber" && !out.drawingNumber && /\d/.test(v) && v.length >= 2 && v.length <= 40 && v.split(/\s+/).length <= 3) out.drawingNumber = v;
    if (k.field === "revision" && !out.revision && /^[A-Za-z0-9.-]{1,6}$/.test(v)) out.revision = v;
  }
  return out;
}

export interface PdfAnonResult {
  totalPages: number;
  pages: PdfPageResult[];
  next: number | null;
  /** KAŽDÁ zahrnutá stránka dávky má výsledek AI. */
  aiUsed: boolean;
  fallback: boolean;
  usage: AiUsage | null;
  calls: number;
  /** Nejnižší jistota AI přes zahrnuté stránky s AI (1 = žádná). */
  confidence: number;
  warnings: AnonWarning[];
  customerStandard: boolean;
  termInKeep: boolean;
  /** PDF stran tohoto běhu, které jsou výkresy (null = žádná). */
  partPdf: Uint8Array | null;
  outputProblems: string[];
  cache: PdfAiCache | null;
  failure: string | null;
  /**
   * failure je vlastnost SOUBORU (heslo k otevření, neplatné PDF, XFA, moc stran, obří sken) → „nelze",
   * bez opakování. Chyba prostředí / běhu se nikdy nevrací jako failure — vyhodí se (opakuje se).
   */
  unsupported?: boolean;
  isCad: boolean;
}

const RENDER_FAIL = "Písmo se nevykreslilo (chybí fonty pdf.js) — anonymizace PDF selhala.";
/** Render na dávku (4 strany po 40 MPx) — A0 a dlouhé archy se rozloží do víc běhů. */
export const PIXEL_BUDGET = 160_000_000;
/** Rezerva před deadlinem: extrakce dalších stran / zpracování další strany. */
const EXTRACT_RESERVE_MS = 150_000;
const PAGE_RESERVE_MS = 50_000;

function ptBox(it: TextItem): Box {
  return { x: it.x, y: it.y, w: it.w, h: it.h };
}

function toPx(b: Box, s: number): Box {
  return { x: b.x * s, y: b.y * s, w: b.w * s, h: b.h * s };
}

async function regionId(page: number, r: RawRegion): Promise<string> {
  const k = `${page}|${r.category}|${Math.round(r.box.x)}|${Math.round(r.box.y)}|${Math.round(r.box.w)}|${Math.round(r.box.h)}`;
  return `p${page}-${(await sha256Hex(k)).slice(0, 12)}`;
}

/** Přehled stránky (≤ 3,75 MPx) + výřez razítka (≥ 200 DPI, jen výřez — ne celá stránka) pro AI. */
async function aiImagesForPage(page: PdfPage, info: PdfPageInfo, startIndex: number): Promise<AiImageSpec[]> {
  const W = info.widthPt, H = info.heightPt;
  const out: AiImageSpec[] = [];
  const f = fitForClaude(W, H, 10);
  const ov = await renderPageRaster(page, f.s, true);
  out.push({ index: startIndex, kind: "overview", page: info.page, crop: { x: 0, y: 0, w: W, h: H }, s: ov.width / W, outW: ov.width, outH: ov.height, jpeg: await rasterToJpeg(ov), label: `stránka ${info.page} — přehled celé stránky` });
  const tb = info.titleBlock ?? info.titleBlockGuess;
  if (tb.w > 0 && tb.h > 0) {
    const want = 200 / 72;
    const cf = fitForClaude(tb.w * want, tb.h * want, 1);
    const { raster: crop } = await renderRegion(page, want * cf.s, tb, true);
    out.push({ index: startIndex + 1, kind: "crop", page: info.page, crop: tb, s: crop.width / tb.w, outW: crop.width, outH: crop.height, jpeg: await rasterToJpeg(crop), label: `stránka ${info.page} — výřez razítka` });
  }
  return out;
}

function linesListFor(info: PdfPageInfo): string {
  const rows: string[] = [];
  let body = 0;
  for (const l of info.lines) {
    if (l.zone === "body") {
      if (isTechnicalText(l.text) || body > 400) continue;
      body++;
    }
    const t = l.text.replace(/[\r\n|]+/g, " ").slice(0, 200);
    rows.push(`${l.id} | ${JSON.stringify(t)} | ${Math.round(l.box.x)},${Math.round(l.box.y)},${Math.round(l.box.x + l.box.w)},${Math.round(l.box.y + l.box.h)} | zone=${l.zone}`);
    if (rows.length >= 1500) break;
  }
  return rows.join("\n");
}

/** Je na stránce v oblasti razítka inkoust bez textu (text jako křivky)? */
function titleInkWithoutText(info: PdfPageInfo, preview: Raster, s: number): boolean {
  const tb = info.titleBlock ?? info.titleBlockGuess;
  const px = toPx(tb, s);
  const ink = inkFraction(preview, px, backgroundLevel(preview));
  const textInTb = info.items.filter((it) => intersects(ptBox(it), tb)).length;
  return ink > 0.01 && textInTb < 3;
}

/** Prázdný render (žádný tmavý pixel) stránky, která má obsah → pdf.js něco vynechal. */
function renderedBlank(r: Raster, info: PdfPageInfo): boolean {
  const hasContent = info.items.length > 0 || info.images.length > 0 || (info.opCount ?? 0) > 2;
  if (!hasContent) return false;
  return inkFraction(r, { x: 0, y: 0, w: r.width, h: r.height }, 255) < 1e-6;
}

export async function anonymizePdf(input: PdfAnonInput): Promise<PdfAnonResult> {
  const res: PdfAnonResult = {
    totalPages: 0, pages: [], next: null, aiUsed: false, fallback: false, usage: null, calls: 0, confidence: 1, warnings: [],
    customerStandard: false, termInKeep: false, partPdf: null, outputProblems: [], cache: null, failure: null, isCad: false,
  };
  // příprava: tištěné anotace do obsahu (pravidla čtou, co se vykreslí), velké obrázky
  // (pdf-lib nepřečte PDF s heslem vlastníka ani některé opravitelné vady → originál pro pdf.js, ke kontrole)
  const prepared = await preparePdf(input.bytes, PDF_MAX_IMAGE_PX)
    .catch((): PreparedPdf => ({ bytes: input.bytes, flattened: {}, removed: 0, kept: 0, oversized: [], unreadable: true }));
  let pdf: PdfDocument;
  try {
    pdf = await openPdf(prepared.bytes);
  } catch (err) {
    // jen vada souboru (heslo k otevření, neplatné PDF) je „nelze"; chyba prostředí se vyhodí a opakuje
    if (!(err instanceof PdfUnsupportedError)) throw err;
    res.failure = err.message;
    res.unsupported = true;
    return res;
  }
  try {
    res.totalPages = pdf.numPages;
    if (pdf.numPages > MAX_PDF_PAGES) {
      res.failure = `PDF má víc než ${MAX_PDF_PAGES} stran — nelze anonymizovat.`;
      res.unsupported = true;
      return res;
    }
    const meta = await pdf.getMetadata().catch(() => null);
    const info0 = (meta?.info ?? {}) as Record<string, unknown>;
    if (info0.IsXFAPresent && !(await pdf.getPage(1).then((p) => p.getTextContent()).then((t) => t.items.length).catch(() => 0))) {
      res.failure = "PDF je čistý XFA formulář — nelze anonymizovat.";
      res.unsupported = true;
      return res;
    }
    res.isCad = looksLikeCadProducer(info0);
    const from = Math.max(1, input.pageFrom);
    const big = prepared.oversized.find((o) => o.page >= from);
    if (big) {
      res.failure = `Sken na straně ${big.page} je příliš velký (${Math.round(big.px / 1e6)} MPx) — naskenuj ho nejvýš v 300 DPI nebo pošli menší soubor.`;
      res.unsupported = true;
      return res;
    }
    const to = Math.min(pdf.numPages, from + PAGES_PER_RUN - 1);
    const cache: PdfAiCache = input.cache ?? { v: 1, vector: {}, specs: [], vision: {}, model: null, fallback: false, confidence: 1 };
    cache.pageConf ??= {};
    const cachedBefore = (p: number) => Boolean(input.cache && (input.cache.vector[p] || input.cache.vision[p]));
    res.fallback = cache.fallback;
    const budget = input.pixelBudget ?? PIXEL_BUDGET;

    // 1) Extrakce stránek (dávka podle počtu stran, pixelů renderu a času)
    const pages: PageCtx[] = [];
    let px = 0;
    for (let p = from; p <= to; p++) {
      if (pages.length && Date.now() > input.deadline - EXTRACT_RESERVE_MS) { res.next = p; break; }
      const probe = await pdf.getPage(p);
      const vp1 = probe.getViewport({ scale: 1 });
      const dpi = targetDpi(vp1.width, vp1.height, input.maxDpi, input.maxMpx);
      const pagePx = vp1.width * vp1.height * (dpi / 72) ** 2;
      if (pages.length && px + pagePx > budget) { res.next = p; break; }
      px += pagePx;
      const { info, page } = await extractPage(pdf, p);
      const ps = Math.min(1.5, Math.sqrt(1_000_000 / (info.widthPt * info.heightPt)));
      const preview = await renderPageRaster(page, ps, true);
      const color = previewIsColor(preview);
      const curves = titleInkWithoutText(info, preview, ps);
      const untrusted = !info.quality.trustworthy || curves;
      if (untrusted && !info.scan) res.warnings.push({ code: "text_layer_untrusted", message: "Textová vrstva stránky neodpovídá obrazu — zpracováno jako obrázek.", page: p });
      if (prepared.unreadable && info.annots.length) {
        res.warnings.push({ code: "text_layer_untrusted", message: "Anotace PDF se nepodařilo převést do obsahu — zkontroluj poznámky a razítka.", page: p });
      }
      // výkres podle pravidel = kotvy razítka na stránce; CAD producent rozhoduje jen bez AI (smíšené PDF)
      const rulesDrawing = info.anchors >= 2 || (res.isCad && !input.ai && !cachedBefore(p));
      pages.push({ info, page, color, preview, ps, vision: Boolean(info.scan) || untrusted, rulesDrawing, cachedBefore: cachedBefore(p) });
    }
    if (res.next === null && to < pdf.numPages) res.next = to + 1;

    // 2) AI pro vektorové stránky BEZ výsledku v cache (jedno volání na dávku)
    const needAi = pages.filter((p) => !p.vision && !cache.vector[p.info.page]);
    if (input.ai && needAi.length) {
      const specs: AiImageSpec[] = [];
      const lists: string[] = [];
      for (const vp of needAi) {
        // indexy obrázků platí v rámci jednoho volání (img = index v požadavku); v cache se páruje i se stránkou
        specs.push(...(await aiImagesForPage(vp.page, vp.info, specs.length)));
        lists.push(`— stránka ${vp.info.page} (${Math.round(vp.info.widthPt)}×${Math.round(vp.info.heightPt)} bodů) —\n${linesListFor(vp.info)}`);
      }
      try {
        const r = await detectVector(input.ai, { images: specs, linesText: lists.join("\n"), pages: needAi.map((v) => v.info.page), systemExtra: input.systemExtra });
        res.usage = addUsage(res.usage, r.meta.usage);
        res.calls++;
        if (r.meta.fallback) res.fallback = true;
        cache.model = r.meta.model;
        cache.fallback = res.fallback;
        const conf = asNumber(r.data.confidence, 0.5);
        // specifikace obrázků (souřadnice boxů) — stránky z dřívějších dávek zůstávají
        const newSpecs = specs.map(({ jpeg: _j, ...rest }) => { void _j; return rest; });
        cache.specs = [...cache.specs.filter((s) => !needAi.some((n) => n.info.page === s.page)), ...newSpecs];
        if (!input.cache) cache.confidence = conf;
        const asked = new Set(needAi.map((n) => n.info.page));
        for (const pg of asArray<VectorPageResult>(r.data.pages)) {
          if (typeof pg?.index === "number" && asked.has(pg.index)) {
            cache.vector[pg.index] = pg;
            cache.pageConf[pg.index] = conf;
          }
        }
      } catch (err) {
        res.warnings.push({ code: "ai_failed", message: `AI detekce selhala (${err instanceof Error ? err.message : "chyba"}) — použita jen pravidla.` });
      }
    }

    // 3) Stránky (před každou další kontrola času — zbytek naváže další běh s cache)
    const outPages: OutPage[] = [];
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      if (i > 0 && Date.now() > input.deadline - PAGE_RESERVE_MS) {
        res.next = p.info.page;
        for (const rest of pages.slice(i)) rest.page.cleanup();
        break;
      }
      const pr = p.vision
        ? await visionPage(p, input, cache, res)
        : await vectorPage(p, input, cache, res);
      res.pages.push(pr);
      if (pr.included && pr.out) outPages.push(pr.out);
      p.page.cleanup();
      if (pr.inkFailed || pr.blank) {
        // chyba stránky = chyba souboru (dál nemá smysl)
        for (const rest of pages.slice(i + 1)) rest.page.cleanup();
        break;
      }
    }
    const included = res.pages.filter((p) => p.included);
    res.aiUsed = included.length ? included.every((p) => p.aiUsed) : Boolean(input.ai) || Object.keys(cache.vector).length > 0;
    res.confidence = included.filter((p) => p.aiUsed).reduce((m, p) => Math.min(m, p.aiConfidence), 1);
    res.cache = Object.keys(cache.vector).length || Object.keys(cache.vision).length ? cache : null;
    if (res.pages.some((p) => p.inkFailed)) res.failure = RENDER_FAIL;
    else if (res.pages.some((p) => p.blank)) {
      const b = res.pages.find((p) => p.blank)!;
      res.failure = `Strana ${b.page} se vykreslila prázdná, i když obsah má (např. příliš velký obrázek) — anonymizace selhala.`;
    } else if (included.some((p) => !p.out)) {
      res.failure = `Stranu ${included.find((p) => !p.out)!.page} se nepodařilo vytvořit — anonymizace selhala.`;
    }
    if (res.failure) return res;
    if (outPages.length) {
      res.partPdf = await buildRasterPdf(outPages);
      const chk = await checkPdfOutput(res.partPdf, outPages.map((o) => ({ widthPt: o.widthPt, heightPt: o.heightPt })));
      res.outputProblems = chk.problems;
    }
    return res;
  } finally {
    await pdf.destroy().catch(() => undefined);
  }
}

/** Barevná stránka? Stačí pár desítek sytých pixelů (červená revize, poznámka) — absolutní práh, ne podíl. */
export const COLOR_MIN_PIXELS = 20;
function previewIsColor(r: Raster): boolean {
  let colored = 0;
  for (let i = 0; i < r.width * r.height; i++) {
    const o = i * 3;
    if (Math.max(r.data[o], r.data[o + 1], r.data[o + 2]) - Math.min(r.data[o], r.data[o + 1], r.data[o + 2]) > 48 && ++colored >= COLOR_MIN_PIXELS) return true;
  }
  return false;
}

type PageCtx = { info: PdfPageInfo; page: PdfPage; color: boolean; preview: Raster; ps: number; vision: boolean; rulesDrawing: boolean; cachedBefore: boolean };

type BurnKind = "text" | "graphic" | "manual";

/** Vektorová stránka: přesné obdélníky z textové vrstvy. */
async function vectorPage(p: PageCtx, input: PdfAnonInput, cache: PdfAiCache, res: PdfAnonResult): Promise<PdfPageResult> {
  const { info } = p;
  const W = info.widthPt, H = info.heightPt;
  const aiPage = cache.vector[info.page] ?? null;
  const result: PdfPageResult = {
    page: info.page, included: true, regions: [], texts: [], method: "vector", ruleHits: 0, inkFailed: false, residue: false, verifyClean: null,
    verifyKeepPresent: null, titleBlockFound: Boolean(info.titleBlock), aiUsed: Boolean(aiPage),
    aiConfidence: aiPage ? (cache.pageConf?.[info.page] ?? cache.confidence) : 1,
  };
  const isDrawing = p.rulesDrawing ? true : aiPage ? Boolean(aiPage.isDrawing) : null;
  if (isDrawing === false) return { ...result, included: false, why: "not_drawing" };
  const aiSource = p.cachedBefore ? "cache" as const : "ai" as const;

  const pr = rulePage(info.lines, input.ctx, { keepValues: input.keepValues });
  if (pr.customerStandardLines.length) res.customerStandard = true;
  if (pr.termInKeep) res.termInKeep = true;
  for (const w of pr.warnings) res.warnings.push({ ...w, page: info.page });
  const lineById = new Map(info.lines.map((l) => [l.id, l]));
  const itemById = new Map(info.items.map((i) => [i.id, i]));
  const hits: LineHit[] = [...pr.hits];
  const keep: RawKeep[] = [];
  for (const k of pr.keep) {
    const l = lineById.get(k.lineId);
    if (!l) continue;
    for (const part of lineRangeToItems(l, k.start, k.end)) {
      const it = itemById.get(part.itemId);
      if (it) keep.push({ page: info.page, box: quadBox(substringQuad(it, part.from, part.to, 0)), field: k.field, value: k.value });
    }
  }

  // AI: řádky, boxy, keep, podniková norma, důvěryhodnost
  const aiRegions: RawRegion[] = [];
  if (aiPage) {
    if (aiPage.textLayerTrustworthy === false) {
      // AI říká, že text neodpovídá obrazu → stránka cestou vision
      res.warnings.push({ code: "text_layer_untrusted", message: "Textová vrstva stránky neodpovídá obrazu — zpracováno jako obrázek.", page: info.page });
      return visionPage({ ...p, vision: true }, input, cache, res);
    }
    const keepLines = new Set(asArray<{ id: string; field: string }>(aiPage.keep).map((k) => k.id));
    for (const k of asArray<{ id: string; field: KeepField }>(aiPage.keep)) {
      const l = lineById.get(k.id);
      if (!l) continue;
      for (const s of l.spans) {
        const it = itemById.get(s.itemId);
        if (it) keep.push({ page: info.page, box: ptBox(it), field: k.field, value: l.text });
      }
    }
    for (const c of asArray<{ id: string }>(aiPage.customerStandard)) if (lineById.has(c.id)) res.customerStandard = true;
    let aiBodyText = false;
    for (const rl of asArray<VectorPageResult["redactLines"][number]>(aiPage.redactLines)) {
      const l = lineById.get(rl.id);
      if (!l || !isCategory(rl.category)) continue;
      const sub = String(rl.substring ?? "");
      let start = sub ? l.text.indexOf(sub) : 0;
      let end = sub ? start + sub.length : l.text.length;
      if (sub && start < 0) {
        const nl = normalizeText(l.text), ns = normalizeText(sub);
        if (!ns || !nl.includes(ns)) continue; // podřetězec musí existovat
        start = 0;
        end = l.text.length;
      }
      if (keepLines.has(rl.id) && asArray<{ id: string; field: string }>(aiPage.keep).some((k) => k.id === rl.id && k.field === "drawingNumber")) continue;
      const text = l.text.slice(start, end);
      // „custom" jen s termínem zakázky — jinak běžná kategorie s technickou výjimkou (AI nesmí tiše mazat kóty a poznámky)
      let category: AnonCategory = rl.category;
      if (category === "custom" && !containsTerm(text, input.ctx.terms)) category = "other";
      if (category !== "custom" && isTechnicalText(text)) continue;
      if (l.zone === "body" && (category === "other" || category === "custom") && !containsTerm(text, input.ctx.terms)) aiBodyText = true;
      hits.push({ lineId: l.id, start, end, category, rule: category === "person" ? "person_drawn" : category, source: aiSource, confidence: asNumber(rl.confidence, 0.8) });
    }
    if (aiBodyText) res.warnings.push({ code: "ai_removed_text", message: "AI smazala text v těle výkresu (poznámka, popis) — zkontroluj, že nejde o technický údaj.", page: info.page });
    for (const b of asArray<VectorPageResult["boxes"][number]>(aiPage.boxes)) {
      const spec = cache.specs.find((s) => s.index === b.img && s.page === info.page);
      if (!spec || !isCategory(b.category)) continue;
      if (!boxInsideSent(spec, b.x, b.y, b.w, b.h)) {
        res.warnings.push({ code: "coords_out_of_image", message: "AI vrátila souřadnice mimo obrázek — zkontroluj.", page: info.page });
        continue;
      }
      const box: Box = { x: spec.crop.x + b.x / spec.s, y: spec.crop.y + b.y / spec.s, w: b.w / spec.s, h: b.h / spec.s };
      aiRegions.push({ page: info.page, box, category: b.category, source: aiSource, zone: zoneOfBox(box, info), textHeight: 0, confidence: asNumber(b.confidence, 0.8) });
    }
    if (info.titleBlock === null && aiPage.titleBlock && aiPage.titleBlock.w > 0) result.titleBlockFound = true;
  }

  // logo-obrázky v razítku / rámu (pravidlo); zbylé anotace razítek / podpisů
  const ruleGraphics: RawRegion[] = [];
  for (const im of info.images) {
    if (info.scan && im === info.scan) continue;
    const z = zoneOfBox(im.box, info);
    if ((z === "title_block" || z === "frame" || z === "revisions") && im.box.w * im.box.h < 0.15 * W * H) {
      ruleGraphics.push({ page: info.page, box: im.box, category: "logo", source: "rule", zone: z, textHeight: 0 });
    }
  }
  for (const a of info.annots) {
    if (/^(Stamp|Ink)$/i.test(a.subtype)) {
      ruleGraphics.push({ page: info.page, box: a.box, category: /ink/i.test(a.subtype) ? "signature" : "logo", source: "rule", zone: zoneOfBox(a.box, info), textHeight: 0 });
    }
  }

  // zásahy → oblasti v bodech (podřetězec / celá položka)
  const textRegions: RawRegion[] = [];
  const hitItems = new Set<string>();
  /** Položky zasažené jen zčásti → rozsahy smazaných znaků (zbytek položky zůstává). */
  const partial = new Map<string, [number, number][]>();
  for (const h of filterToggles(hits, input.ctx.redact)) {
    const l = lineById.get(h.lineId);
    if (!l) continue;
    for (const part of lineRangeToItems(l, h.start, h.end)) {
      const it = itemById.get(part.itemId);
      if (!it) continue;
      const whole = h.wholeItem || part.whole;
      const q = whole ? substringQuad(it, 0, it.str.length, 0) : substringQuad(it, part.from, part.to, 1);
      if (whole) hitItems.add(it.id);
      if (!whole) partial.set(it.id, [...(partial.get(it.id) ?? []), [part.from, part.to]]);
      textRegions.push({ page: info.page, box: quadBox(q), ...(Math.abs(it.rot) > 0.5 ? { quad: q } : {}), category: h.category, source: h.source, zone: l.zone, textHeight: it.fontSize, text: it.str.slice(whole ? 0 : part.from, whole ? it.str.length : part.to), confidence: h.confidence, ...(whole ? {} : { tight: true }) });
    }
  }
  result.ruleHits = pr.hits.length;

  let raw = [...textRegions, ...aiRegions, ...filterToggles(ruleGraphics.map((r) => ({ ...r, rule: r.category })), input.ctx.redact)]
    .map((r) => padRegion(r, "vector", W, H));
  const prot = protectKeep(raw, keep, "vector");
  raw = mergeRegions(prot.regions, keep);
  res.warnings.push(...prot.warnings);
  const cap = areaCapWarning(raw, W, H, info.titleBlock, info.page);
  if (cap) res.warnings.push(cap);

  // normalizace + ruční sada
  const auto: AnonRegion[] = [];
  const texts: PdfRegionText[] = [];
  for (const r of raw) {
    const id = await regionId(info.page, r);
    const n = normalizeRegion({ ...r, textHash: r.text ? await sha256Hex(normalizeText(r.text)) : undefined }, W, H, id);
    if (!n) continue;
    auto.push(n);
    if (r.text) texts.push({ regionId: id, category: r.category, text: r.text });
  }
  const manual = (input.manual ?? []).filter((m) => m.page === info.page);
  const final = applyManual(auto, manual);
  result.regions = final;
  result.keepValues = keepValuesOf(keep);
  result.texts = texts.filter((t) => final.some((f) => f.id === t.regionId));

  // render + vypálení
  let dpi = targetDpi(W, H, input.maxDpi, input.maxMpx);
  for (let attempt = 0; attempt < 6; attempt++) {
    const s = dpi / 72;
    const raster = await renderPageRaster(p.page, s, p.color);
    if (renderedBlank(raster, info)) {
      result.blank = true;
      return result;
    }
    const fill = input.fillPdf === "black" ? [0, 0, 0] : [255, 255, 255];
    const burn = burnable(final);
    const pxRects: { box: Box; em: number; text: boolean; kind: BurnKind }[] = burn.map((r) => ({
      box: { x: r.x * raster.width, y: r.y * raster.height, w: r.w * raster.width, h: r.h * raster.height }, em: 0, text: false,
      kind: r.manual === "added" || r.source === "manual" ? "manual" : r.textHash ? "text" : "graphic",
    }));
    // výška písma pro prstenec a linky: nejvyšší položka v textové oblasti
    for (const pr2 of pxRects) {
      if (pr2.kind !== "text") continue;
      const ptB = { x: pr2.box.x / s, y: pr2.box.y / s, w: pr2.box.w / s, h: pr2.box.h / s };
      const inside = info.items.filter((it) => intersects(ptBox(it), ptB));
      if (inside.length) { pr2.em = Math.max(...inside.map((i) => i.fontSize)) * s; pr2.text = true; }
    }

    // přesný řez položek „popisek + hodnota" podle skutečné mezery v rastru (jiná písma než Helvetica)
    const keptParts: Box[] = [];
    let cutUncertain = false;
    for (const [itemId, ranges] of partial) {
      const it = itemById.get(itemId);
      if (!it || hitItems.has(itemId)) continue;
      if (Math.abs(it.rot) > 0.5) { cutUncertain = true; continue; }
      const f = itemFrame(it);
      const cut = refineCut(raster, {
        str: it.str, x0: f.ox * s, x1: (f.ox + f.adv) * s, yTop: (f.oy - 1.0 * f.em) * s, yBot: (f.oy + 0.3 * f.em) * s, em: f.em * s, ranges,
      });
      if (!cut.certain) { cutUncertain = true; continue; }
      const yT = (f.oy - 1.25 * f.em) * s, yB = (f.oy + 0.55 * f.em) * s;
      // odhadnutý obdélník, který zasahuje do ponechaného popisku („Kreslil:"), se zkrátí na skutečnou mezeru
      const bandT = (f.oy - 1.0 * f.em) * s, bandB = (f.oy + 0.3 * f.em) * s;
      for (const r of pxRects) {
        if (r.kind !== "text") continue;
        const ov = Math.min(r.box.y + r.box.h, bandB) - Math.max(r.box.y, bandT);
        if (ov < 0.5 * (bandB - bandT)) continue;
        for (const [ka, kb] of cut.kept) {
          const x0 = r.box.x, x1 = r.box.x + r.box.w;
          if (x0 > ka && x0 < kb && x1 > kb) r.box = { ...r.box, x: kb, w: x1 - kb };
          else if (x1 > ka && x1 < kb && x0 < ka) r.box = { ...r.box, w: ka - x0 };
        }
      }
      for (const [a, b] of cut.burn) pxRects.push({ box: { x: a, y: yT, w: b - a, h: yB - yT }, em: f.em * s, text: true, kind: "text" });
      for (const [a, b] of cut.kept) keptParts.push({ x: a, y: (f.oy - 1.0 * f.em) * s, w: b - a, h: 1.3 * f.em * s });
    }
    if (cutUncertain) res.warnings.push({ code: "cut_uncertain", message: "Popisek a jméno jsou v jednom textu a hranici nejde přesně určit — zkontroluj, že ze jména nic nezůstalo.", page: info.page });

    // grafika celá (s rozšířením o přečnívající tvar), ručně přidané celé, text se zachováním tenkých linek tabulky
    for (const r of pxRects) {
      if (r.kind === "graphic") {
        const g = burnGraphic(raster, r.box, fill);
        r.box = g.box;
        if (g.residue) result.residue = true;
      } else if (r.kind === "manual") fillRect(raster, r.box, fill);
    }
    for (const r of pxRects) if (r.kind === "text") burnRectKeepLines(raster, r.box, fill, 255, r.em);

    // smazaná oblast nesmí zakrýt technický údaj (kóta, tolerance, norma) ani keep pole
    const keepPx = keep.map((k) => toPx(k.box, s));
    const covered = info.items.some((it) => {
      if (it.source !== "text" || !it.str.trim() || hitItems.has(it.id) || partial.has(it.id)) return false;
      const b = toPx(ptBox(it), s);
      const area = Math.max(1, b.w * b.h);
      const cov = pxRects.reduce((m, r) => Math.max(m, (intersection(b, r.box)?.w ?? 0) * (intersection(b, r.box)?.h ?? 0) / area), 0);
      if (cov < 0.3) return false;
      return isTechnicalText(it.str) || keepPx.some((k) => intersects(k, b));
    });
    if (covered) res.warnings.push({ code: "ai_removed_text", message: "Smazaná oblast zakrývá technický údaj (kóta, tolerance, materiál) — zkontroluj.", page: info.page });

    // kontrola inkoustu ponechaného textu
    const bg = 255;
    const keptItems = info.items.filter((it) => it.str.trim() && it.fontSize >= 1.5 && it.source === "text" && !hitItems.has(it.id)
      && !pxRects.some((r) => intersects(toPx(ptBox(it), s), r.box)));
    const important = keptItems.filter((it) => zoneOfBox(ptBox(it), info) !== "body");
    const body = keptItems.filter((it) => zoneOfBox(ptBox(it), info) === "body");
    const sample = [...important, ...body.filter((_, i) => i % Math.max(1, Math.ceil(body.length / 200)) === 0)];
    // inkoust = kontrast proti místnímu pozadí (žlutý / světle šedý / bílý na tmavém je vidět).
    // Chybějící písma = VĚTŠINA položek nebo keep pole bez inkoustu; ojedinělé položky bez inkoustu
    // (bílý, zakrytý, průhledný text) → varování ke kontrole, ne selhání.
    // Písmo, které se nevykreslilo, se projeví na VŠECH svých položkách → po písmech: ≥ 3 položky
    // ve vzorku a ≥ 90 % bez inkoustu = chybějící písmo (i když je to menšina stránky).
    let failed = 0;
    const byFont = new Map<string, { n: number; fail: number }>();
    for (const it of sample) {
      const miss = contrastInkFraction(raster, toPx(ptBox(it), s)) < 0.005;
      if (miss) failed++;
      const f = byFont.get(it.fontName ?? "?") ?? { n: 0, fail: 0 };
      f.n++;
      if (miss) f.fail++;
      byFont.set(it.fontName ?? "?", f);
    }
    const fontFailed = [...byFont.values()].some((f) => f.n >= 3 && f.fail >= 0.9 * f.n);
    const keepFailed = keep.some((k) => !pxRects.some((r) => intersects(toPx(k.box, s), r.box)) && contrastInkFraction(raster, toPx(k.box, s)) < 0.005);
    if (sample.length && (failed > sample.length * 0.5 || keepFailed || fontFailed)) {
      result.inkFailed = true;
      return result;
    }
    if (failed > 0) {
      res.warnings.push({
        code: "hidden_text",
        message: `Část textu výkresu se nevykreslila (${failed} z ${sample.length} ${sample.length === 1 ? "údaje" : "údajů"} — bílý, zakrytý nebo skrytý text) — zkontroluj náhled.`,
        page: info.page,
      });
    }

    // zbytky kolem smazaných položek (dotahy, diakritika) → rozšířit o 0,15 em, max. 2×
    // ponechané části zčásti zasažených položek se nepočítají jako zbytek JEN po přesném řezu (keptParts)
    const excludeBoxes = keptItems.map((it) => toPx(ptBox(it), s)).concat(keepPx, keptParts);
    for (const r of pxRects) {
      if (!r.text || r.em <= 0) continue;
      for (let k = 0; k < 3; k++) {
        const ring = Math.max(2, 0.3 * r.em);
        const residue = ringResidue(raster, r.box, ring, excludeBoxes, Math.max(4, 0.5 * r.em), bg);
        const ringArea = (r.box.w + 2 * ring) * (r.box.h + 2 * ring) - r.box.w * r.box.h;
        if (residue <= Math.max(3, 0.002 * ringArea)) break;
        if (k === 2) { result.residue = true; break; }
        const d = 0.15 * r.em;
        r.box = { x: r.box.x - d, y: r.box.y - d, w: r.box.w + 2 * d, h: r.box.h + 2 * d };
        burnRectKeepLines(raster, r.box, fill, 255, r.em);
      }
    }
    if (result.residue) res.warnings.push({ code: "residue", message: "Kolem smazaného místa zůstaly zbytky — zkontroluj.", page: info.page });

    // kódování v rozpočtu 2,5 MB / strana; barva jen když po vypálení zůstala (červené logo zmizelo → šedá)
    const enc = raster.channels === 3 ? maybeGray(raster, { minPixels: 40 }) : raster;
    let img = await encodeFlate(enc);
    if (img.data.length > PAGE_BUDGET_BYTES) {
      const j = await encodeJpeg(enc, 85);
      if (j.data.length < img.data.length) img = j;
    }
    if (img.data.length > PAGE_BUDGET_BYTES && dpi > MIN_DPI) {
      dpi = Math.max(MIN_DPI, dpi * 0.85);
      continue;
    }
    result.out = { widthPt: W, heightPt: H, image: img };
    return result;
  }
  return result;
}

function zoneOfBox(b: Box, info: PdfPageInfo) {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const inside = (z: Box | null) => Boolean(z) && cx >= z!.x && cx <= z!.x + z!.w && cy >= z!.y && cy <= z!.y + z!.h;
  if (inside(info.revisions) && !inside(info.titleBlock)) return "revisions" as const;
  if (inside(info.titleBlock ?? info.titleBlockGuess)) return "title_block" as const;
  const W = info.widthPt, H = info.heightPt;
  if (cx < 0.04 * W || cx > 0.96 * W || cy < 0.04 * H || cy > 0.96 * H) return "frame" as const;
  return "body" as const;
}

/** Skenová stránka / nedůvěryhodný text: render v nativním rozlišení → vision (jako fotka, bez ořezu). */
async function visionPage(p: PageCtx, input: PdfAnonInput, cache: PdfAiCache, res: PdfAnonResult): Promise<PdfPageResult> {
  const { info } = p;
  const W = info.widthPt, H = info.heightPt;
  const cached = cache.vision[info.page] ?? null;
  const result: PdfPageResult = {
    page: info.page, included: true, regions: [], texts: [], method: info.scan ? "scan" : "vision", ruleHits: 0, inkFailed: false, residue: false,
    verifyClean: null, verifyKeepPresent: null, titleBlockFound: false, aiUsed: false, aiConfidence: 1,
  };
  let scale: number;
  if (info.scan && info.scan.pxW > 0) {
    scale = info.scan.pxW / Math.max(1, info.scan.box.w);
  } else {
    scale = targetDpi(W, H, input.maxDpi, input.maxMpx) / 72;
  }
  scale = Math.min(scale, Math.sqrt((input.maxMpx * 1e6) / (W * H)), 600 / 72);
  const raster = await renderPageRaster(p.page, scale, true);
  if (renderedBlank(raster, info)) {
    result.blank = true;
    return result;
  }
  if (info.scan) res.warnings.push({ code: "scan_page", message: "Skenovaná stránka — zpracováno jako obrázek.", page: info.page });
  const hints = info.lines.length ? info.lines.slice(0, 300).map((l) => l.text).join("\n") : undefined;
  const v = await runVision({
    raster, mode: "scan", page: info.page, ctx: input.ctx, ai: cached ? null : input.ai, systemExtra: input.systemExtra,
    keepValues: input.keepValues, verify: input.verifyPhotos, fill: input.fillPhoto, hints, cache: cached,
  });
  res.usage = addUsage(res.usage, v.usage);
  res.calls += v.calls;
  if (v.fallback) res.fallback = true;
  if (v.aiCache) {
    cache.vision[info.page] = v.aiCache;
    if (v.aiUsed) cache.pageConf = { ...(cache.pageConf ?? {}), [info.page]: v.confidence };
  }
  res.warnings.push(...v.warnings);
  if (v.customerStandard) res.customerStandard = true;
  if (v.termInKeep) res.termInKeep = true;
  result.aiUsed = v.aiUsed;
  result.aiConfidence = v.aiUsed ? v.confidence : 1;
  if (!v.aiUsed && !p.rulesDrawing) res.warnings.push({ code: "no_ai", message: "Bez AI nelze sken anonymizovat — zkontroluj ručně.", page: info.page });
  const isDrawing = p.rulesDrawing ? true : v.isDrawing;
  if (isDrawing === false) return { ...result, included: false, why: "not_drawing" };
  result.verifyClean = v.verifyClean;
  result.verifyKeepPresent = v.verifyKeepPresent;
  result.titleBlockFound = v.titleBlockFound;
  result.residue = v.residue;
  const OW = v.raster.width, OH = v.raster.height;
  const auto: AnonRegion[] = [];
  for (const r of v.regions) {
    const id = await regionId(info.page, r);
    const n = normalizeRegion({ ...r, textHash: r.text ? await sha256Hex(normalizeText(r.text)) : undefined }, OW, OH, id);
    if (n) {
      auto.push(n);
      if (r.text) result.texts.push({ regionId: id, category: r.category, text: r.text });
    }
  }
  const manual = (input.manual ?? []).filter((m) => m.page === info.page);
  const final = applyManual(auto, manual);
  // ruční přidané oblasti (a ruční zrušení) se do rastru promítnou: zrušené automatické už jsou vypálené
  // v runVision → při ruční úpravě se proto vždy vypaluje znovu z čistého renderu
  const out = manual.length ? await reburn(v, final, input.fillPhoto) : v.raster;
  result.regions = sortRegions(final);
  const img = maybeGray(out);
  const jpeg = await encodeJpeg(img, 85);
  result.out = { widthPt: W, heightPt: H, image: jpeg };
  return result;
}

/** Vypálí znovu z čistého (narovnaného) rastru podle konečné sady oblastí (ruční úpravy). */
export async function reburn(v: { clean: Raster }, final: AnonRegion[], fill: "background" | "white" | "black"): Promise<Raster> {
  const { cloneRaster: clone, burnPolygons, ringMedianColor } = await import("./image");
  const base = clone(v.clean);
  burnPolygons(base, burnable(final).map((r) => {
    const box = { x: r.x * base.width, y: r.y * base.height, w: r.w * base.width, h: r.h * base.height };
    const value = fill === "black" ? [0, 0, 0] : fill === "white" ? [255, 255, 255] : ringMedianColor(v.clean, box, Math.max(4, box.h * 0.3));
    return {
      quad: r.quad ? r.quad.map((q, i) => q * (i % 2 === 0 ? base.width : base.height)) : [box.x, box.y, box.x + box.w, box.y, box.x + box.w, box.y + box.h, box.x, box.y + box.h],
      fill: value,
    };
  }));
  return base;
}
