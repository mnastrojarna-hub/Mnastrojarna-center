import "server-only";
import { fitForClaude, quadInsideSent, boxInsideSent } from "./claude-image";
import {
  detectPhotoLines, detectPhotoOverview, verifyTranscribe, isCategory, asArray, asNumber,
  type AiCallConfig, type AiCallMeta, type AiImageSpec, type LinesResult, type OverviewResult,
} from "./detect-ai";
import { burnPolygons, cloneRaster, cropRaster, cropToJpeg, ringMedianColor, straighten, whitenOutside } from "./image";
import { quadBox, substringQuad } from "./lines";
import { areaCapWarning, mergeRegions, padRegion, protectKeep, type RawKeep, type RawRegion } from "./regions";
import { containsTerm, filterToggles, isTechnicalText, rulePage, type RuleContext } from "./rules";
import { normalizeText } from "./text";
import { checkTranscript, type VerifyTile } from "./verify";
import { burnGraphic, burnRectKeepLines, type Raster } from "./pdf-raster";
import type { AnonCategory, AnonWarning, Box, KeepField, Quad, TextItem, TextLine, Zone } from "./types";
import type { AiUsage } from "@/lib/jobs/capture-batch-types";
import { addUsage } from "@/lib/ai/ai-call";

/**
 * Fotky a skeny (spec §2.3): průchod 1 (přehled → list, úhel, razítko, kandidáti), narovnání a ořez
 * listu, průchod 2 (výřezy razítka, revizí, kandidátů a okrajových pásů v plném rozlišení → řádky
 * OCR jako čtyřúhelníky), pravidla nad OCR (pojistka nezávislá na AI), odsazení, vypálení polygonů
 * a průchod 3 — ověření doslovným přepisem s deterministickou kontrolou (max. 1 kolo doplnění).
 */

export interface VisionAiCache {
  v: 1;
  overview: OverviewResult | null;
  overviewSpec: { s: number; outW: number; outH: number } | null;
  tiles: { crop: Box; s: number; outW: number; outH: number; zone: Zone; label: string }[];
  lines: LinesResult | null;
  verifyClean: boolean | null;
  confidence: number;
  model: string | null;
  fallback: boolean;
}

export interface VisionInput {
  raster: Raster;
  mode: "photo" | "scan";
  page: number;
  ctx: RuleContext;
  ai: AiCallConfig | null;
  systemExtra?: string;
  keepValues?: Partial<Record<KeepField, string>>;
  verify: boolean;
  fill: "background" | "white" | "black";
  /** OCR vrstva skenu jako nápověda. */
  hints?: string;
  cache?: VisionAiCache | null;
}

export interface VisionText {
  index: number;
  category: AnonCategory;
  text: string;
}

export interface VisionOutput {
  /** Vypálený výstup (narovnaný, oříznutý). */
  raster: Raster;
  /** Týž rastr PŘED vypálením (pro ruční úpravy). */
  clean: Raster;
  regions: RawRegion[];
  keep: RawKeep[];
  warnings: AnonWarning[];
  isDrawing: boolean | null;
  confidence: number;
  aiUsed: boolean;
  fallback: boolean;
  usage: AiUsage | null;
  calls: number;
  verifyClean: boolean | null;
  verifyKeepPresent: boolean | null;
  pxPerMm: number | null;
  titleBlockFound: boolean;
  customerStandard: boolean;
  termInKeep: boolean;
  aiCache: VisionAiCache | null;
  /** Transformace bodů zdroje (dekódovaný obraz) → výstup. */
  toOutput: (x: number, y: number) => [number, number];
  /** Grafiku se nepodařilo celou zakrýt (přesahuje okno). */
  residue: boolean;
}

const MAX_IMAGES = 14;
const MIN_TILE_SCALE = 0.9;

/** Rozdělí box tak, aby každá dlaždice prošla fitForClaude s s ≥ minS. */
export function splitForClaude(b: Box, minS = MIN_TILE_SCALE): Box[] {
  let nx = 1, ny = 1;
  for (let guard = 0; guard < 64; guard++) {
    const tw = b.w / nx, th = b.h / ny;
    if (fitForClaude(tw, th).s >= minS || (tw < 64 && th < 64)) break;
    if (tw >= th) nx++;
    else ny++;
  }
  const out: Box[] = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      out.push({ x: b.x + (b.w * i) / nx, y: b.y + (b.h * j) / ny, w: b.w / nx, h: b.h / ny });
    }
  }
  return out;
}

function clampBox(b: Box, W: number, H: number): Box | null {
  const x = Math.max(0, b.x), y = Math.max(0, b.y);
  const x2 = Math.min(W, b.x + b.w), y2 = Math.min(H, b.y + b.h);
  return x2 - x >= 8 && y2 - y >= 8 ? { x, y, w: x2 - x, h: y2 - y } : null;
}

function grow(b: Box, f: number, minPx = 0): Box {
  const dx = Math.max(b.w * f, minPx), dy = Math.max(b.h * f, minPx);
  return { x: b.x - dx, y: b.y - dy, w: b.w + 2 * dx, h: b.h + 2 * dy };
}

function center(b: Box): [number, number] {
  return [b.x + b.w / 2, b.y + b.h / 2];
}

function inBox(p: [number, number], b: Box | null): boolean {
  return Boolean(b) && p[0] >= b!.x && p[0] <= b!.x + b!.w && p[1] >= b!.y && p[1] <= b!.y + b!.h;
}

function mapBox(b: Box, f: (x: number, y: number) => [number, number]): Box {
  const pts = [f(b.x, b.y), f(b.x + b.w, b.y), f(b.x, b.y + b.h), f(b.x + b.w, b.y + b.h)];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function quadFrom(q: number[], crop: Box, s: number): Quad {
  return q.map((v, i) => (i % 2 === 0 ? crop.x + v / s : crop.y + v / s)) as Quad;
}

const GRAPHIC_CATEGORY: Record<string, AnonCategory> = { logo: "logo", stamp: "logo", signature: "signature", code: "code" };

/** Řádek OCR → položka (čtyřúhelník p1 p2 = horní hrana ve směru čtení). */
function ocrItem(id: string, page: number, text: string, q: Quad): TextItem {
  const [x1, y1, x2, y2, , , x4, y4] = q;
  const adv = Math.hypot(x2 - x1, y2 - y1);
  const hgt = Math.hypot(x4 - x1, y4 - y1);
  const rot = (Math.atan2(-(y2 - y1), x2 - x1) * 180) / Math.PI;
  const box = quadBox(q);
  return { id, page, str: text, ...box, fontSize: Math.max(1, hgt / 1.3), rot: Math.abs(rot) < 0.5 ? 0 : rot, source: "ocr", ox: x4, oy: y4, adv, quad: q };
}

export async function runVision(input: VisionInput): Promise<VisionOutput> {
  const warnings: AnonWarning[] = [];
  const W0 = input.raster.width, H0 = input.raster.height;
  let usage: AiUsage | null = null;
  let calls = 0;
  let fallback = false;
  let model: string | null = null;
  const note = (m: AiCallMeta) => {
    usage = addUsage(usage, m.usage);
    calls++;
    if (m.fallback) fallback = true;
    model = m.model;
  };
  const cache = input.cache ?? null;
  const ai = input.ai;
  const aiUsed = Boolean(ai) || Boolean(cache?.overview);

  // ── Průchod 1: přehled ──
  let overview: OverviewResult | null = cache?.overview ?? null;
  let ovSpec = cache?.overviewSpec ?? null;
  if (!overview && ai) {
    const ov = await cropToJpeg(input.raster, { x: 0, y: 0, w: W0, h: H0 });
    ovSpec = { s: ov.s, outW: ov.outW, outH: ov.outH };
    const spec: AiImageSpec = { index: 0, kind: "overview", page: input.page, crop: ov.crop, s: ov.s, outW: ov.outW, outH: ov.outH, jpeg: ov.jpeg, label: input.mode === "photo" ? "fotka výkresu — přehled" : "sken stránky — přehled" };
    const r = await detectPhotoOverview(ai, { images: [spec], systemExtra: input.systemExtra, extra: { width: W0, height: H0, mode: input.mode } });
    note(r.meta);
    overview = r.data;
  }

  let isDrawing: boolean | null = overview ? Boolean(overview.isDrawing) : null;
  let confidence = overview ? asNumber(overview.confidence, 0.5) : 0;
  const s0 = ovSpec?.s ?? 1;
  const fromOv = (v: number) => v / s0;

  // list, úhel, razítko, kandidáti v souřadnicích zdroje
  let sheet: number[] | null = null;
  let angle = 0;
  let tb: Box | null = null;
  let rev: Box | null = null;
  const cands: { box: Box; kind: string }[] = [];
  if (overview && ovSpec) {
    const sh = asArray<number>(overview.sheet);
    if (sh.length === 8 && quadInsideSent(ovSpec, sh)) {
      const q = sh.map(fromOv);
      const b = quadBox(q);
      if (b.w * b.h > 0.15 * W0 * H0) sheet = q;
    } else if (sh.length) {
      warnings.push({ code: "coords_out_of_image", message: "AI vrátila souřadnice mimo obrázek — zkontroluj.", page: input.page });
    }
    angle = Math.max(-45, Math.min(45, asNumber(overview.angleDeg, 0)));
    const t = overview.titleBlock;
    if (t && t.w > 0 && t.h > 0) {
      if (boxInsideSent(ovSpec, t.x, t.y, t.w, t.h)) tb = { x: fromOv(t.x), y: fromOv(t.y), w: fromOv(t.w), h: fromOv(t.h) };
      else warnings.push({ code: "coords_out_of_image", message: "AI vrátila souřadnice mimo obrázek — zkontroluj.", page: input.page });
    }
    const rv = overview.revisions;
    if (rv && rv.w > 0 && rv.h > 0 && boxInsideSent(ovSpec, rv.x, rv.y, rv.w, rv.h)) rev = { x: fromOv(rv.x), y: fromOv(rv.y), w: fromOv(rv.w), h: fromOv(rv.h) };
    for (const c of asArray<{ x: number; y: number; w: number; h: number; kind: string }>(overview.candidates).slice(0, 8)) {
      if (!boxInsideSent(ovSpec, c.x, c.y, c.w, c.h)) {
        warnings.push({ code: "coords_out_of_image", message: "AI vrátila souřadnice mimo obrázek — zkontroluj.", page: input.page });
        continue;
      }
      cands.push({ box: { x: fromOv(c.x), y: fromOv(c.y), w: fromOv(c.w), h: fromOv(c.h) }, kind: c.kind });
    }
  }

  // ── Narovnání a ořez listu (M10) ──
  let raster = input.raster;
  let M: (x: number, y: number) => [number, number] = (x, y) => [x, y];
  if (Math.abs(angle) > 1) {
    const st = await straighten(raster, angle);
    raster = st.raster;
    M = st.map;
  }
  let off: [number, number] = [0, 0];
  if (input.mode === "photo" && sheet) {
    const poly = sheet.map((v, i) => (i % 2 === 0 ? M(v, sheet![i + 1])[0] : M(sheet![i - 1], v)[1]));
    const b = quadBox(poly);
    const crop = clampBox(grow(b, 0.02), raster.width, raster.height);
    if (crop) {
      raster = await cropRaster(raster, crop);
      off = [Math.floor(crop.x), Math.floor(crop.y)];
      const local = poly.map((v, i) => v - off[i % 2]);
      // vše mimo polygon listu bílou (stůl, vizitka, monitor); rezerva 0,3 % kvůli nepřesnosti rohů
      whitenOutside(raster, grow2Poly(local, 0.003 * Math.max(b.w, b.h)));
    }
  } else if (input.mode === "photo" && !sheet && ai) {
    warnings.push({ code: "no_title_block", message: "List výkresu se na fotce nepodařilo ohraničit — zkontroluj okolí listu.", page: input.page });
  }
  if (raster === input.raster) raster = cloneRaster(raster);
  const toW = (x: number, y: number): [number, number] => {
    const [a, b] = M(x, y);
    return [a - off[0], b - off[1]];
  };
  const W = raster.width, H = raster.height;
  const tbW = tb ? clampBox(mapBox(tb, toW), W, H) : null;
  const revW = rev ? clampBox(mapBox(rev, toW), W, H) : null;
  const candW = cands.map((c) => ({ box: clampBox(mapBox(c.box, toW), W, H), kind: c.kind })).filter((c) => c.box) as { box: Box; kind: string }[];

  // ── Průchod 2: výřezy v plném rozlišení ──
  type Tile = { crop: Box; zone: Zone; label: string };
  let tiles: Tile[] = [];
  if (cache?.tiles?.length) {
    tiles = cache.tiles.map((t) => ({ crop: t.crop, zone: t.zone, label: t.label }));
  } else if (ai) {
    const push = (b: Box | null, zone: Zone, label: string) => {
      if (!b) return;
      for (const part of splitForClaude(b)) tiles.push({ crop: part, zone, label });
    };
    // pořadí = důležitost (razítko, revize, náhradní razítko, kandidáti, okraje) — při překročení meze
    // se vynechá konec seznamu a výsledek jde ke kontrole
    if (tbW) push(clampBox(grow(tbW, 0.15), W, H), "title_block", "razítko");
    if (revW) push(clampBox(grow(revW, 0.15), W, H), "revisions", "tabulka revizí");
    if (!tbW) push(clampBox({ x: W * 0.5, y: H * 0.65, w: W * 0.5, h: H * 0.35 }, W, H), "title_block", "pravý dolní roh (možné razítko)");
    for (const c of candW.slice(0, 4)) push(clampBox(grow(c.box, 0.5, 32), W, H), "body", `kandidát (${c.kind})`);
    // okrajové pásy listu (6 %) — text v okraji, plot stamp, logo v rámu
    const bw = Math.max(16, 0.06 * W), bh = Math.max(16, 0.06 * H);
    push(clampBox({ x: 0, y: H - bh, w: W, h: bh }, W, H), "frame", "dolní okraj listu");
    push(clampBox({ x: W - bw, y: bh, w: bw, h: H - 2 * bh }, W, H), "frame", "pravý okraj listu");
    push(clampBox({ x: 0, y: 0, w: W, h: bh }, W, H), "frame", "horní okraj listu");
    push(clampBox({ x: 0, y: bh, w: bw, h: H - 2 * bh }, W, H), "frame", "levý okraj listu");
    if (tiles.length > MAX_IMAGES) {
      warnings.push({ code: "truncated", message: `Výkres je velký — AI prošla jen ${MAX_IMAGES} nejdůležitějších výřezů (razítko, revize, část okrajů); zkontroluj okraje.`, page: input.page });
      tiles = tiles.slice(0, MAX_IMAGES);
    }
  }

  const tileSpecs: AiImageSpec[] = [];
  for (let i = 0; i < tiles.length; i++) {
    const j = await cropToJpeg(raster, tiles[i].crop);
    tiles[i].crop = j.crop;
    tileSpecs.push({ index: i, kind: "tile", page: input.page, crop: j.crop, s: j.s, outW: j.outW, outH: j.outH, jpeg: j.jpeg, label: tiles[i].label });
  }

  let lines: LinesResult | null = cache?.lines ?? null;
  if (!lines && ai && tileSpecs.length) {
    const r = await detectPhotoLines(ai, { images: tileSpecs, systemExtra: input.systemExtra, hints: input.hints, extra: { toWorking: toW, width: W, height: H } });
    note(r.meta);
    lines = r.data;
    confidence = Math.min(confidence || 1, asNumber(r.data.confidence, 0.5));
  }

  // ── Řádky OCR → položky, zóny, pravidla ──
  const zoneOf = (b: Box): Zone => {
    const c = center(b);
    if (inBox(c, revW) && !inBox(c, tbW)) return "revisions";
    if (inBox(c, tbW)) return inBox(c, revW) ? "revisions" : "title_block";
    if (c[0] < 0.06 * W || c[0] > 0.94 * W || c[1] < 0.06 * H || c[1] > 0.94 * H) return "frame";
    return "body";
  };
  const textLines: TextLine[] = [];
  const items = new Map<string, TextItem>();
  const aiRegions: RawRegion[] = [];
  const keep: RawKeep[] = [];
  const pass2Texts: { id: string; text: string; redacted: boolean }[] = [];
  let outside = false;
  let aiBodyText = false;
  for (const tile of asArray<LinesResult["tiles"][number]>(lines?.tiles)) {
    const spec = tileSpecs[tile.img] ?? (cache?.tiles?.[tile.img] ? { ...cache.tiles[tile.img], index: tile.img } : null);
    if (!spec) continue;
    const crop = spec.crop, s = spec.s;
    asArray<LinesResult["tiles"][number]["lines"][number]>(tile.lines).forEach((ln, k) => {
      const q = asArray<number>(ln.quad);
      if (q.length !== 8 || !quadInsideSent(spec, q)) { outside = true; return; }
      const wq = quadFrom(q, crop, s);
      const text = String(ln.text ?? "").slice(0, 400);
      const id = `p${input.page}:T${tile.img}L${k}`;
      const it = ocrItem(id, input.page, text, wq);
      items.set(id, it);
      const tl: TextLine = { id, page: input.page, text, spans: [{ itemId: id, start: 0, end: text.length, offset: 0 }], box: quadBox(wq), fontSize: it.fontSize, rot: it.rot, zone: tile.img < tiles.length ? (tiles[tile.img].zone === "frame" ? "frame" : zoneOf(quadBox(wq))) : zoneOf(quadBox(wq)) };
      textLines.push(tl);
      const keepField = ln.keepField && ln.keepField !== "none" ? (ln.keepField as KeepField) : null;
      if (keepField) keep.push({ page: input.page, box: quadBox(wq), field: keepField, value: text });
      let redact = Boolean(ln.redact) && isCategory(ln.category);
      if (keepField === "drawingNumber") redact = false; // AI nikdy nesmaže číslo výkresu
      // „custom" jen s termínem zakázky — jinak běžná kategorie s technickou výjimkou
      let category = (isCategory(ln.category) ? ln.category : "other") as AnonCategory;
      if (category === "custom" && !containsTerm(text, input.ctx.terms)) category = "other";
      if (redact && category !== "custom" && isTechnicalText(text)) redact = false;
      if (redact && tl.zone === "body" && category === "other") aiBodyText = true;
      pass2Texts.push({ id, text, redacted: redact });
      if (redact) {
        aiRegions.push({ page: input.page, box: quadBox(wq), quad: wq, category, source: cache ? "cache" : "ai", zone: tl.zone, textHeight: it.fontSize * 1.3, text });
      }
    });
    for (const g of asArray<LinesResult["tiles"][number]["graphics"][number]>(tile.graphics)) {
      const q = asArray<number>(g.quad);
      if (q.length !== 8 || !quadInsideSent(spec, q)) { outside = true; continue; }
      const wq = quadFrom(q, crop, s);
      aiRegions.push({ page: input.page, box: quadBox(wq), quad: wq, category: GRAPHIC_CATEGORY[g.kind] ?? "logo", source: cache ? "cache" : "ai", zone: zoneOf(quadBox(wq)), textHeight: 0, confidence: asNumber(g.confidence, 0.8) });
    }
  }
  if (outside) warnings.push({ code: "coords_out_of_image", message: "AI vrátila souřadnice mimo obrázek — zkontroluj.", page: input.page });
  if (aiBodyText) warnings.push({ code: "ai_removed_text", message: "AI smazala text v těle výkresu (poznámka, popis) — zkontroluj, že nejde o technický údaj.", page: input.page });
  aiRegions.splice(0, aiRegions.length, ...filterToggles(aiRegions.map((r) => ({ ...r, rule: r.category === "person" ? "person_drawn" : r.category })), input.ctx.redact));

  const pr = rulePage(textLines, input.ctx, { keepValues: input.keepValues });
  for (const k of pr.keep) {
    const it = items.get(k.lineId);
    if (it) keep.push({ page: input.page, box: quadBox(substringQuad(it, k.start, k.end, 0)), field: k.field, value: k.value });
  }
  const ruleRegions: RawRegion[] = [];
  for (const h of pr.hits) {
    const it = items.get(h.lineId);
    if (!it) continue;
    const q = h.wholeItem ? (it.quad as Quad) : substringQuad(it, h.start, h.end, 1);
    ruleRegions.push({ page: input.page, box: quadBox(q), quad: q, category: h.category, source: "rule", zone: textLines.find((l) => l.id === h.lineId)?.zone ?? "body", textHeight: it.fontSize * 1.3, text: it.str.slice(h.start, h.end) });
    const p2 = pass2Texts.find((t) => t.id === h.lineId);
    if (p2) p2.redacted = true;
  }

  let regions = [...ruleRegions, ...aiRegions].map((r) => padRegion(r, "photo", W, H));
  const prot = protectKeep(regions, keep, "photo");
  regions = mergeRegions(prot.regions, keep);
  warnings.push(...prot.warnings);
  const cap = areaCapWarning(regions, W, H, tbW, input.page);
  if (cap) warnings.push(cap);

  // ── Vypálení ──
  const fillFor = (r: RawRegion): number[] => {
    if (input.fill === "white") return [255, 255, 255];
    if (input.fill === "black") return [0, 0, 0];
    return ringMedianColor(raster, r.box, Math.max(4, r.textHeight * 0.5));
  };
  const burned = cloneRaster(raster);
  let residue = false;
  // po narovnání jsou řádky osové → text: obdélník se zachováním tenkých linek tabulky; grafika (logo,
  // razítko, kód): celý obdélník rozšířený o přečnívající tvar; šikmé → polygon
  const burnAll = (target: Raster, rs: RawRegion[]) => {
    const polys: { quad: readonly number[]; fill: readonly number[] }[] = [];
    for (const r of rs) {
      const fill = fillFor(r);
      if (!r.quad || isAxisAligned(r.quad)) {
        const bg = Math.max(96, (fill[0] * 299 + (fill[1] ?? fill[0]) * 587 + (fill[2] ?? fill[0]) * 114) / 1000);
        if (r.textHeight > 0) burnRectKeepLines(target, r.box, fill, bg, r.textHeight);
        else if (burnGraphic(target, r.box, fill, bg).residue) residue = true;
      } else polys.push({ quad: r.quad, fill });
    }
    burnPolygons(target, polys);
  };
  burnAll(burned, regions);
  if (residue) warnings.push({ code: "residue", message: "Logo nebo grafika přesahuje označenou oblast — zkontroluj okolí.", page: input.page });

  // ── Průchod 3: ověření přepisem ──
  let verifyClean: boolean | null = cache ? cache.verifyClean : null;
  let verifyKeepPresent: boolean | null = null;
  const keepValues = [...new Set([...keep.filter((k) => k.field === "drawingNumber" || k.field === "revision" || k.field === "material").map((k) => k.value ?? ""), ...Object.values(input.keepValues ?? {}).filter(Boolean) as string[]])]
    .map((v) => v.trim()).filter((v) => v.length >= 2 && v.length <= 60);
  const wantVerify = input.verify && ai && !cache && tileSpecs.length > 0 && (input.mode === "photo" || confidence < 0.9);
  if (wantVerify && ai) {
    for (let round = 0; round < 2; round++) {
      const vSpecs: AiImageSpec[] = [];
      for (const t of tileSpecs) {
        const j = await cropToJpeg(burned, t.crop);
        vSpecs.push({ ...t, jpeg: j.jpeg, s: j.s, outW: j.outW, outH: j.outH });
      }
      const v = await verifyTranscribe(ai, { images: vSpecs, extra: { round, toWorking: toW } });
      note(v.meta);
      const vt: VerifyTile[] = asArray<{ img: number; lines: string[]; graphics: { quad: number[]; description: string }[] }>(v.data.tiles).map((t) => ({
        img: t.img, zone: tiles[t.img]?.zone ?? "body", lines: asArray<string>(t.lines).map(String), graphics: asArray<{ quad: number[]; description: string }>(t.graphics),
      }));
      // citlivé = firma, osoby, kontakty, termíny (cesty hlídají pravidla; jejich slova bývají i v názvu dílu)
      const sensitive = regions.filter((r) => r.category !== "path" && r.category !== "logo").map((r) => r.text ?? "").filter(Boolean);
      const kept = pass2Texts.filter((p) => !p.redacted).map((p) => p.text);
      const out = checkTranscript({ tiles: vt, sensitive, kept, ctx: input.ctx, keepValues });
      verifyKeepPresent = out.missingKeep.length === 0;
      if (out.leaks.length === 0) {
        verifyClean = true;
        break;
      }
      verifyClean = false;
      if (round === 1) break;
      // doplnit oblasti: řádky průchodu 2 s uniklým tokenem + grafika z přepisu
      const extra: RawRegion[] = [];
      for (const leak of out.leaks) {
        if (leak.kind === "graphic" && leak.quad && leak.quad.length === 8) {
          const spec = vSpecs[leak.img];
          if (!spec || !quadInsideSent(spec, leak.quad)) continue;
          const wq = quadFrom(leak.quad, spec.crop, spec.s);
          extra.push(padRegion({ page: input.page, box: quadBox(wq), quad: wq, category: "logo", source: "ai", zone: tiles[leak.img]?.zone ?? "body", textHeight: 0 }, "photo", W, H));
          continue;
        }
        const tok = leak.token;
        for (const p of pass2Texts) {
          if (p.redacted) continue;
          const n = normalizeText(p.text);
          if (tok && (n.includes(tok) || tok.includes(n))) {
            const it = items.get(p.id);
            if (!it?.quad) continue;
            p.redacted = true;
            extra.push(padRegion({ page: input.page, box: quadBox(it.quad), quad: it.quad, category: "other", source: "ai", zone: textLines.find((l) => l.id === p.id)?.zone ?? "body", textHeight: it.fontSize * 1.3, text: p.text }, "photo", W, H));
          }
        }
      }
      if (!extra.length) break;
      regions = mergeRegions([...regions, ...extra], keep);
      burnAll(burned, extra);
    }
  }

  const titleBlockFound = Boolean(tbW);
  // px/mm z výšky řádků razítka (řádek ≈ 3 mm u písma 2,5 mm)
  const tbHeights = textLines.filter((l) => l.zone === "title_block").map((l) => l.box.h).sort((a, b) => a - b);
  const pxPerMm = tbHeights.length ? tbHeights[Math.floor(tbHeights.length / 2)] / 3 : null;

  const aiCache: VisionAiCache | null = overview || lines ? {
    v: 1, overview, overviewSpec: ovSpec,
    tiles: tileSpecs.map((t, i) => ({ crop: t.crop, s: t.s, outW: t.outW, outH: t.outH, zone: tiles[i].zone, label: t.label })),
    lines, verifyClean, confidence, model: model ?? cache?.model ?? null, fallback: fallback || Boolean(cache?.fallback),
  } : null;

  return {
    raster: burned, clean: raster, regions, keep, warnings, isDrawing, confidence, aiUsed, fallback: fallback || Boolean(cache?.fallback), usage, calls,
    verifyClean, verifyKeepPresent, pxPerMm, titleBlockFound, customerStandard: pr.customerStandardLines.length > 0, termInKeep: pr.termInKeep,
    aiCache, toOutput: toW, residue,
  };
}

/** Čtyřúhelník s hranami do 1° od os. */
function isAxisAligned(q: readonly number[]): boolean {
  const a = Math.abs(Math.atan2(q[3] - q[1], q[2] - q[0]) * 180 / Math.PI);
  const b = Math.abs(Math.atan2(q[7] - q[1], q[6] - q[0]) * 180 / Math.PI);
  return Math.min(a, 180 - a) <= 1 && Math.abs(b - 90) <= 1;
}


/** Polygon listu mírně zvětšený od těžiště (rezerva 2 %). */
function grow2Poly(poly: number[], d: number): number[] {
  const n = poly.length / 2;
  let cx = 0, cy = 0;
  for (let i = 0; i < n; i++) { cx += poly[i * 2]; cy += poly[i * 2 + 1]; }
  cx /= n; cy /= n;
  return poly.map((v, i) => {
    const px = poly[i - (i % 2)], py = poly[i - (i % 2) + 1];
    const len = Math.hypot(px - cx, py - cy) || 1;
    return i % 2 === 0 ? v + ((px - cx) / len) * d : v + ((py - cy) / len) * d;
  });
}
