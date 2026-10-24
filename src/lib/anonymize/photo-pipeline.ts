import "server-only";
import type { AiUsage } from "@/lib/jobs/capture-batch-types";
import { addUsage } from "@/lib/ai/ai-call";
import type { AiCallConfig } from "./detect-ai";
import { checkImageOutput, decodeImage, encodeImageOutput, imagePages, maybeGray, rasterToJpeg } from "./image";
import { buildRasterPdf, type OutPage } from "./pdf-raster";
import { keepValuesOf, reburn } from "./pdf-pipeline";
import { applyManual, burnable, normalizeRegion, sortRegions } from "./regions";
import type { RuleContext } from "./rules";
import { normalizeText, sha256Hex } from "./text";
import { runVision, type VisionAiCache } from "./vision";
import type { AnonCategory, AnonRegion, AnonWarning, KeepField } from "./types";

/**
 * Fotka / obrázek / vícestránkový TIFF → anonymizovaný obrázek (JPEG q90, PNG zůstane PNG) bez
 * metadat, nebo PDF (víc stran TIFFu). Detekce a vypálení: vision.ts.
 */

export interface PhotoAnonInput {
  bytes: Uint8Array;
  /** Zdroj je master v plném rozlišení (anon_source_path), ne zmenšený hlavní soubor. */
  hasMaster: boolean;
  ctx: RuleContext;
  ai: AiCallConfig | null;
  systemExtra?: string;
  keepValues?: Partial<Record<KeepField, string>>;
  verify: boolean;
  fill: "background" | "white" | "black";
  manual?: AnonRegion[];
  cache?: { v: 1; pages: Record<number, VisionAiCache> } | null;
  /** Výstup jako PDF (víc fotek jednoho výkresu / TIFF). */
  asPdf?: boolean;
}

export interface PhotoAnonResult {
  method: "image" | "image_pdf";
  bytes: Uint8Array | null;
  mime: string;
  ext: string;
  regions: AnonRegion[];
  texts: { regionId: string; category: AnonCategory; text: string }[];
  warnings: AnonWarning[];
  isDrawing: boolean | null;
  aiUsed: boolean;
  fallback: boolean;
  confidence: number;
  usage: AiUsage | null;
  calls: number;
  verifyClean: boolean | null;
  verifyKeepPresent: boolean | null;
  pxPerMm: number | null;
  titleBlockFound: boolean;
  customerStandard: boolean;
  termInKeep: boolean;
  outputProblems: string[];
  keepValues: Partial<Record<KeepField, string>>;
  cache: { v: 1; pages: Record<number, VisionAiCache> } | null;
  unsupported: string | null;
  pages: number;
}

export async function anonymizeImage(input: PhotoAnonInput): Promise<PhotoAnonResult> {
  const res: PhotoAnonResult = {
    method: "image", bytes: null, mime: "image/jpeg", ext: "jpg", regions: [], texts: [], warnings: [], isDrawing: null, aiUsed: false,
    fallback: false, confidence: 1, usage: null, calls: 0, verifyClean: null, verifyKeepPresent: null, pxPerMm: null, titleBlockFound: false,
    customerStandard: false, termInKeep: false, outputProblems: [], keepValues: {}, cache: null, unsupported: null, pages: 1,
  };
  let meta: { pages: number; format: string; compression?: string };
  try {
    meta = await imagePages(input.bytes);
  } catch {
    res.unsupported = "Obrázek nelze přečíst (HEIC z prohlížeče bez převodu, poškozený soubor) — pošli JPEG nebo PDF.";
    return res;
  }
  if (meta.format === "heif") {
    res.unsupported = "Fotka HEIC nejde na serveru přečíst — vyfoť znovu (JPEG) nebo nahraj PDF.";
    return res;
  }
  if (meta.format === "tiff" && /ccitt|fax|group ?4/i.test(meta.compression ?? "")) {
    res.unsupported = "TIFF s faxovou kompresí (G4) nelze přečíst — pošli PDF.";
    return res;
  }
  const pageCount = meta.format === "tiff" ? Math.max(1, meta.pages) : 1;
  res.pages = pageCount;
  const asPdf = input.asPdf || pageCount > 1;
  const png = meta.format === "png";
  if (!input.hasMaster) res.warnings.push({ code: "no_master", message: "Fotka v nízkém rozlišení — zkontroluj (příště vyfoť v plném rozlišení)." });
  const cache = input.cache ?? { v: 1 as const, pages: {} };
  const outPages: OutPage[] = [];
  let single: Uint8Array | null = null;
  let firstDrawing: boolean | null = null;
  const pxs: number[] = [];
  /** Každá zpracovaná stránka (výkres) měla AI. */
  let allAi = true;
  let anyDrawing = false;
  const MAX_TIFF_PAGES = 50;
  if (pageCount > MAX_TIFF_PAGES) {
    res.warnings.push({ code: "truncated", message: `TIFF má ${pageCount} stran — zpracováno jen prvních ${MAX_TIFF_PAGES}; zbytek pošli zvlášť.` });
  }
  const excluded: number[] = [];

  for (let p = 1; p <= Math.min(pageCount, MAX_TIFF_PAGES); p++) {
    let raster;
    try {
      raster = await decodeImage(input.bytes, pageCount > 1 ? p - 1 : undefined);
    } catch (err) {
      res.unsupported = `Obrázek nelze přečíst: ${err instanceof Error ? err.message.slice(0, 120) : "chyba"}`;
      return res;
    }
    const cachedPage = cache.pages[p] ?? null;
    const v = await runVision({
      raster, mode: "photo", page: p, ctx: input.ctx, ai: cachedPage ? null : input.ai, systemExtra: input.systemExtra,
      keepValues: input.keepValues, verify: input.verify, fill: input.fill, cache: cachedPage,
    });
    res.usage = addUsage(res.usage, v.usage);
    res.calls += v.calls;
    if (v.fallback) res.fallback = true;
    if (v.aiCache) cache.pages[p] = v.aiCache;
    // vícestránkový TIFF: stránka, která není výkres (průvodní dopis), se vynechá jako u PDF
    if (asPdf && v.isDrawing === false) {
      excluded.push(p);
      if (firstDrawing === null) firstDrawing = false;
      continue;
    }
    anyDrawing = true;
    if (!v.aiUsed) allAi = false;
    res.warnings.push(...v.warnings);
    if (v.customerStandard) res.customerStandard = true;
    if (v.termInKeep) res.termInKeep = true;
    if (v.aiUsed) res.confidence = Math.min(res.confidence, v.confidence);
    if (firstDrawing === null || v.isDrawing === true) firstDrawing = v.isDrawing;
    res.verifyClean = res.verifyClean === false ? false : v.verifyClean;
    res.verifyKeepPresent = res.verifyKeepPresent === false ? false : v.verifyKeepPresent;
    if (v.titleBlockFound) res.titleBlockFound = true;
    if (v.pxPerMm !== null) pxs.push(v.pxPerMm);
    res.keepValues = { ...keepValuesOf(v.keep), ...res.keepValues };

    const OW = v.raster.width, OH = v.raster.height;
    const auto: AnonRegion[] = [];
    for (const r of v.regions) {
      const k = `${p}|${r.category}|${Math.round(r.box.x)}|${Math.round(r.box.y)}|${Math.round(r.box.w)}|${Math.round(r.box.h)}`;
      const id = `p${p}-${(await sha256Hex(k)).slice(0, 12)}`;
      const n = normalizeRegion({ ...r, textHash: r.text ? await sha256Hex(normalizeText(r.text)) : undefined }, OW, OH, id);
      if (!n) continue;
      auto.push(n);
      if (r.text) res.texts.push({ regionId: id, category: r.category, text: r.text });
    }
    const manual = (input.manual ?? []).filter((m) => m.page === p);
    const final = applyManual(auto, manual);
    res.regions.push(...final);
    const out = manual.length ? await reburn(v, final, input.fill) : v.raster;

    if (asPdf) {
      const img = maybeGray(out);
      const jpeg = await rasterToJpeg(img, 85);
      // stránka podle poměru stran fotky (ne A4): delší strana 842 bodů
      const k = 842 / Math.max(out.width, out.height);
      outPages.push({ widthPt: out.width * k, heightPt: out.height * k, image: { kind: "jpeg", data: jpeg, width: img.width, height: img.height, colors: img.channels } });
    } else {
      single = await encodeImageOutput(out, png ? "png" : "jpeg");
      const samples = burnable(final).slice(0, 50).map((r) => ({ x: (r.x + r.w / 2) * out.width, y: (r.y + r.h / 2) * out.height }))
        .map((pt) => {
          const o = (Math.round(Math.min(out.height - 1, pt.y)) * out.width + Math.round(Math.min(out.width - 1, pt.x))) * out.channels;
          return { ...pt, fill: Array.from(out.data.subarray(o, o + out.channels)) };
        });
      const chk = await checkImageOutput(single, { width: out.width, height: out.height, samples });
      res.outputProblems.push(...chk.problems);
    }
  }
  res.isDrawing = anyDrawing ? (firstDrawing ?? true) : firstDrawing;
  res.aiUsed = anyDrawing ? allAi : Boolean(input.ai) || Object.keys(cache.pages).length > 0;
  res.pxPerMm = pxs.length ? Math.min(...pxs) : null;
  res.regions = sortRegions(res.regions);
  res.cache = Object.keys(cache.pages).length ? cache : null;
  if (excluded.length && anyDrawing) {
    res.warnings.push({ code: "excluded_pages", message: `Vynecháno ${excluded.length} stran, které nejsou výkresem (dopis, faktura…).` });
  }
  if (asPdf && !outPages.length) {
    // žádná stránka není výkres → přeskočeno (service: notDrawing)
    res.isDrawing = false;
    res.method = "image_pdf";
    res.mime = "application/pdf";
    res.ext = "pdf";
    return res;
  }
  if (asPdf) {
    res.method = "image_pdf";
    res.mime = "application/pdf";
    res.ext = "pdf";
    res.bytes = await buildRasterPdf(outPages);
    const { checkPdfOutput } = await import("./pdf-raster");
    const chk = await checkPdfOutput(res.bytes, outPages.map((o) => ({ widthPt: o.widthPt, heightPt: o.heightPt })));
    res.outputProblems.push(...chk.problems);
  } else {
    res.bytes = single;
    res.mime = png ? "image/png" : "image/jpeg";
    res.ext = png ? "png" : "jpg";
  }
  return res;
}
