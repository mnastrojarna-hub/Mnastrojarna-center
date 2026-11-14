/**
 * Geometrie předlohy: entity 2D modelu (i obsah vložených bloků) → křivky v souřadnicích výkresu s druhem čáry
 * (obrys / skrytá / osa), texty, kružnice. Vynechá neviditelné entity, vypnuté hladiny a anotace (kóty, šrafy,
 * odkazy); objekty AutoCAD Mechanical rozliší podle třídy (normálie STDPART2D = geometrie, pozice, drsnost… = značky).
 */
import { cBox, cLength, cSample, cTransform, type Curve } from "../draft/curves";
import { boxUnion, emptyBox, IDENTITY, isEmptyBox, xfMul, xfPt, type Affine, type Box } from "../draft/geom";
import { entityCurves, type KindCtx } from "../draft/kinds";
import { findLayer, layerVisible } from "../draft/layers";
import { findBlock } from "../draft/layout/blocks";
import type { DraftEntity, DraftModel, Vec2 } from "../draft/model";

export type LineClass = "contour" | "hidden" | "center" | "thin" | "other";
export type GeomItem = {
  /** id entity v modelovém prostoru (u obsahu bloku id vložení) */
  top: string;
  curve: Curve;
  lt: LineClass;
  layer: string;
  /** objekt AutoCAD Mechanical, ze kterého křivka je (STDPART2D…) */
  acm?: string;
  /** křivka normálie závitu (STDPART2D …/ITHREAD…) – jádro d1 se v modelu kreslí jako vrták (porovnání s volnější tolerancí) */
  thread?: boolean;
};
export type TextItem = { top: string; s: string; p: Vec2; h: number; rot: number; layer: string; acm?: string; attrib?: string };

const GEOM_TYPES = new Set(["line", "arc", "circle", "polyline", "spline", "ellipse"]);
/** třídy AutoCAD Mechanical, které jsou geometrií pohledu (normálie – šrouby, díry, kolíky) */
export const ACM_GEOMETRY = new Set(["STDPART2D"]);

/** vlastnosti vložení bloku pro entity bloku na hladině 0 a s ByBlock (hladina, typ čáry, tloušťka) */
export type ParentProps = { layer?: string; lt?: string; lw?: number };

/** hladiny os (plná čára, ale osa) */
const CENTER_LAYER = /^(am_7n?|osy|osa|axes?|axis|center(lines?)?|centre(lines?)?|achsen|mittellinien?)$/i;
/**
 * Hladiny anotací a pomocné geometrie – do obrysu tělesa nepatří: kóty, šrafy, konstrukční a tenké čáry (AutoCAD
 * Mechanical AM_4 tenké čáry / závit, AM_5 kóty a tenké značky, AM_8 šrafy, AM_9 konstrukční značky normálií),
 * rámečky a razítka, kóty a šrafy výkresů MN CAD (KOTY, SRAFY, RAM), tenké čáry PDF.
 */
const THIN_LAYER = /^(am_(4|5|8|9)n?|am_paref|am_bor|koty|kóty|kota|kóta|dims?|dimensions?|dimension[-_ ]?lines?|bemaßung|bemassung|maße|masse|srafy|šrafy|srafovani|šrafování|hatch(es|ing)?|schraffur|ram|rám|ramecek|rámeček|rahmen|frame|border|title|titleblock|razitko|razítko|schriftfeld|defpoints|konstrukce|construction|constr|hilfslinien|pdf_thin)$/i;
/** typy čar konstrukčních a lomových čar (AutoCAD Mechanical Amconstr, Amzigzag) */
const THIN_LT = /constr|zigzag|break/;

const CONSTRUCTION_LAYER = /^(am_9n?|defpoints|konstrukce|construction|constr|hilfslinien)$/i;
/** pomocná / konstrukční čára (AutoCAD Mechanical AM_9: značka středu normálie Ø2, konstrukční čáry) – není geometrií ani dírou */
export function isConstruction(model: DraftModel, e: DraftEntity, parentLayer?: string): boolean {
  const layer = e.layer === "0" && parentLayer ? parentLayer : e.layer;
  if (CONSTRUCTION_LAYER.test(layer)) return true;
  const lt = e.linetype && !/^by(layer|block)$/i.test(e.linetype) ? e.linetype : findLayer(model, layer)?.linetype;
  return /constr/i.test(lt ?? "");
}

/** tloušťka čáry entity [mm] (ByLayer → hladina, ByBlock → vložení; výchozí / neznámá = undefined) */
function lwOf(model: DraftModel, e: DraftEntity, layer: string, parent?: ParentProps): number | undefined {
  let lw = e.lineweight;
  if (lw === undefined || lw === "ByLayer") lw = findLayer(model, layer)?.lineweight;
  if (lw === "ByBlock") return parent?.lw;
  return typeof lw === "number" ? lw : undefined;
}

/**
 * Tloušťka „tlusté“ čáry výkresu (obrys) = nejčastější výslovná tloušťka ≥ 0,35 mm u plných čar geometrie (ISO 128:
 * tlustá : tenká = 2 : 1). null = výkres tloušťky nepoužívá. Mezipaměť podle modelu.
 */
const thickCache = new WeakMap<DraftModel, number | null>();
export function thickLineweight(model: DraftModel): number | null {
  if (thickCache.has(model)) return thickCache.get(model)!;
  const n = new Map<number, number>();
  const visit = (list: readonly DraftEntity[], parent: ParentProps | undefined, depth: number) => {
    if (depth > 4) return;
    for (const e of list) {
      if (e.type === "insert") {
        const blk = findBlock(model, (e as { block: string }).block);
        if (!blk || depth >= 4) continue;
        const layer = e.layer === "0" && parent?.layer ? parent.layer : e.layer;
        visit(blk.entities, { layer, lw: lwOf(model, e, layer, parent) }, depth + 1);
        continue;
      }
      if (!GEOM_TYPES.has(e.type)) continue;
      const layer = e.layer === "0" && parent?.layer ? parent.layer : e.layer;
      const lw = lwOf(model, e, layer, parent);
      if (lw !== undefined && lw >= 0.35) n.set(lw, (n.get(lw) ?? 0) + 1);
    }
  };
  visit(model.entities, undefined, 0);
  let best: number | null = null;
  let bn = 0;
  for (const [lw, c] of n) if (c > bn || (c === bn && best !== null && lw < best)) [best, bn] = [lw, c];
  thickCache.set(model, best);
  return best;
}

/**
 * Druh čáry (ISO 128): skrytá = čárkovaná, osa = čerchovaná (typ čáry entity / hladiny / vložení), tenká = hladina
 * anotací a pomocných čar nebo výslovná tloušťka pod 0,7 × tloušťky obrysu výkresu (tenké plné čáry: závit, kótovací
 * a odkazové čáry, šrafy, úhlopříčky rovinných ploch – hranami tělesa nejsou). Entita bloku na hladině 0 má hladinu
 * vložení (jako při kreslení).
 */
export function lineClass(model: DraftModel, e: DraftEntity, parent?: ParentProps | string): LineClass {
  const par: ParentProps | undefined = typeof parent === "string" ? { lt: parent } : parent;
  const layer = e.layer === "0" && par?.layer ? par.layer : e.layer;
  if (layer === "PDF_THIN") return "thin";
  let lt = e.linetype;
  if (!lt || /^bylayer$/i.test(lt)) lt = findLayer(model, layer)?.linetype;
  if (lt && /^byblock$/i.test(lt)) lt = par?.lt;
  const n = (lt ?? "").toLowerCase();
  if (n && n !== "continuous") {
    if (/center|centre|mitte|osa|dashdot|strichpunkt|iso0?4|iso0?8|iso10|phantom|divide/.test(n)) return "center";
    if (/hidden|dash|skryt|verdeckt|strich|iso0?2|iso0?3|dot/.test(n)) return "hidden";
    if (THIN_LT.test(n)) return "thin";
    return "other";
  }
  if (CENTER_LAYER.test(layer)) return "center";
  if (THIN_LAYER.test(layer)) return "thin";
  const lw = lwOf(model, e, layer, par);
  const thick = thickLineweight(model);
  if (lw !== undefined && thick !== null && lw < 0.7 * thick - 1e-9) return "thin";
  return "contour";
}

/** afinní transformace vložení bloku: bod vložení, natočení, měřítka, bod vložení bloku */
export function insertXf(e: { p: Vec2; sx?: number; sy?: number; rot?: number }, base: Vec2): Affine {
  const a = ((e.rot ?? 0) * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const sx = e.sx ?? 1;
  const sy = e.sy ?? 1;
  // x' = R·S·(x − base) + p
  const m: Affine = [c * sx, s * sx, -s * sy, c * sy, 0, 0];
  const t = xfPt(m, [-base[0], -base[1]]);
  return [m[0], m[1], m[2], m[3], t[0] + e.p[0], t[1] + e.p[1]];
}

type Walk = { model: DraftModel; ctx: KindCtx; skip: Set<string>; geom: GeomItem[]; texts: TextItem[]; withText: boolean };

function walk(w: Walk, list: readonly DraftEntity[], xf: Affine, top: string | null, depth: number, parent: ParentProps | undefined, acm: string | undefined, thread = false) {
  if (depth > 8) return;
  for (const e of list) {
    if (e.ext?.invisible || !layerVisible(w.model, e.layer)) continue;
    const id = top ?? e.id;
    if (top === null && w.skip.has(e.id)) continue;
    if (e.type === "insert") {
      const ins = e as DraftEntity & { block: string; p: Vec2; sx?: number; sy?: number; rot?: number; attribs?: { tag: string; value: string; p: Vec2; h: number; rot?: number; invisible?: boolean }[] };
      const cls = e.ext?.acm?.cls;
      // objekty Mechanical, které nejsou geometrií (pozice, drsnost, kusovník…), do geometrie nepatří – jejich texty ano
      const blk = findBlock(w.model, ins.block);
      if (!blk) continue;
      const m = xfMul(xf, insertXf(ins, blk.base));
      if (cls && !ACM_GEOMETRY.has(cls)) {
        if (w.withText) walkTexts(w, blk.entities, m, id, depth + 1, cls);
        continue;
      }
      const layer = e.layer === "0" && parent?.layer ? parent.layer : e.layer;
      const lt = e.linetype && /^byblock$/i.test(e.linetype) ? parent?.lt : e.linetype && !/^bylayer$/i.test(e.linetype) ? e.linetype : findLayer(w.model, layer)?.linetype;
      const lw0 = e.lineweight === "ByBlock" ? parent?.lw : typeof e.lineweight === "number" ? e.lineweight : findLayer(w.model, layer)?.lineweight;
      const th = thread || (cls === "STDPART2D" && /THREAD/i.test(`${e.ext?.acm?.type ?? ""} ${e.ext?.acm?.branch ?? ""}`));
      walk(w, blk.entities, m, id, depth + 1, { layer, lt, lw: typeof lw0 === "number" ? lw0 : undefined }, cls ?? acm, th);
      if (w.withText) for (const a of ins.attribs ?? []) if (!a.invisible && a.value) w.texts.push({ top: id, s: a.value, p: xfPt(xf, a.p), h: a.h, rot: a.rot ?? 0, layer: e.layer, attrib: a.tag });
      continue;
    }
    if (GEOM_TYPES.has(e.type)) {
      const lt0 = lineClass(w.model, e, parent);
      const layer = e.layer === "0" && parent?.layer ? parent.layer : e.layer;
      for (const c of entityCurves(e, w.ctx)) {
        // závit normálie: ¾ kružnice = vnější průměr závitu (ISO 6410 tenká čára, i čárkovaná u skrytého závitu) – model ji nemá
        const lt = thread && c.k === "arc" && Math.abs(c.sweep) >= 4.2 && Math.abs(c.sweep) <= 5.8 ? "thin" : lt0;
        w.geom.push({ top: id, curve: xf === IDENTITY ? c : cTransform(c, xf), lt, layer, ...(acm ? { acm } : {}), ...(thread ? { thread } : {}) });
      }
      continue;
    }
    if (w.withText && (e.type === "text" || e.type === "mtext")) pushText(w, e, xf, id, acm);
  }
}

function walkTexts(w: Walk, list: readonly DraftEntity[], xf: Affine, top: string, depth: number, acm: string) {
  if (depth > 8) return;
  for (const e of list) {
    if (e.ext?.invisible) continue;
    if (e.type === "text" || e.type === "mtext") pushText(w, e, xf, top, acm);
    else if (e.type === "insert") {
      const ins = e as DraftEntity & { block: string; p: Vec2; sx?: number; sy?: number; rot?: number };
      const blk = findBlock(w.model, ins.block);
      if (blk) walkTexts(w, blk.entities, xfMul(xf, insertXf(ins, blk.base)), top, depth + 1, acm);
    }
  }
}

function pushText(w: Walk, e: DraftEntity, xf: Affine, top: string, acm: string | undefined) {
  const t = e as DraftEntity & { p: Vec2; h: number; s: string; rot?: number };
  const s = e.type === "mtext" ? mtextToPlain(t.s) : t.s;
  if (!s.trim()) return;
  const k = Math.hypot(xf[0], xf[1]) || 1;
  const rot = ((t.rot ?? 0) + (Math.atan2(xf[1], xf[0]) * 180) / Math.PI + 360) % 360;
  w.texts.push({ top, s, p: xfPt(xf, t.p), h: t.h * k, rot, layer: e.layer, ...(acm ? { acm } : {}) });
}

/** MTEXT → prostý text (formátovací kódy pryč, odstavce jako mezera) */
export function mtextToPlain(s: string): string {
  return s
    .replace(/\\[PpXx]/g, " ")
    .replace(/\\S([^;]*?)[\^/#]([^;]*);/g, "$1/$2")
    .replace(/\\[ACcFfHhQqTtWw][^;\\]*;/g, "")
    .replace(/\\[LlOoKk~]/g, "")
    .replace(/[{}]/g, "")
    .replace(/%%c/gi, "Ø")
    .replace(/%%d/gi, "°")
    .replace(/%%p/gi, "±")
    .replace(/\s+/g, " ")
    .trim();
}

/** geometrie a texty modelového prostoru (bez entit `skip` – rámečky a razítka listů) */
export function flatten(model: DraftModel, opts: { skip?: Set<string>; texts?: boolean; list?: readonly DraftEntity[] } = {}): { geom: GeomItem[]; texts: TextItem[] } {
  const w: Walk = { model, ctx: { model }, skip: opts.skip ?? new Set(), geom: [], texts: [], withText: opts.texts !== false };
  walk(w, opts.list ?? model.entities, IDENTITY, null, 0, undefined, undefined);
  return { geom: w.geom, texts: w.texts };
}

/** obálka křivky (null = nekonečná) */
export const curveBox = (c: Curve): Box | null => cBox(c);
export function boxOfCurves(cs: readonly Curve[]): Box | null {
  let b = emptyBox();
  for (const c of cs) {
    const cb = cBox(c);
    if (cb) b = boxUnion(b, cb);
  }
  return isEmptyBox(b) ? null : b;
}

/** křivka → úsečky (oblouky a splajny vzorkované po nejvýš `step` délky) */
export function curveSegs(c: Curve, step = 1): [Vec2, Vec2][] {
  if (c.k === "line") return c.inf ? [] : [[c.a, c.b]];
  const L = cLength(c);
  if (!Number.isFinite(L) || L <= 0) return [];
  const n = Math.max(2, Math.min(720, Math.ceil(L / Math.max(step, 1e-3))));
  const { pts } = cSample(c, n);
  const out: [Vec2, Vec2][] = [];
  for (let i = 1; i < pts.length; i++) out.push([pts[i - 1], pts[i]]);
  return out;
}

/** kružnice / oblouk křivky (pro díry, kontrolu kót) */
export function curveCircle(c: Curve): { c: Vec2; r: number; full: boolean } | null {
  if (c.k !== "arc") return null;
  return { c: c.c, r: c.r, full: Math.abs(c.sweep) >= 2 * Math.PI - 1e-6 };
}
