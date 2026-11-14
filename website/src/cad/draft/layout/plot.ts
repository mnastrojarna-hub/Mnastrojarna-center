/**
 * BALÍK 3 (layout) – tisk: převod rozvržení (nebo okna / rozsahu modelu) na stránku vektorových prvků v mm papíru
 * (cesty s úsečkami a Bézierovými oblouky, výplně, texty, ořez výřezů). Z ní vznikne PDF (pdf.ts), SVG a PNG – a náhled
 * tisku v GUI, takže náhled a výstup jsou totožné.
 *
 * Pravidla (jako AutoCAD): tisknou se jen zapnuté, nezmrazené a tisknutelné hladiny; rám výřezu podle své hladiny,
 * obsah výřezu podle hladin svých entit (i když je hladina výřezu vypnutá, zmrazená nebo netiskne); zmrazení hladin
 * ve výřezu (VPLAYER); okraje stránky (vzhled stránky) = netisknutelná oblast – obsah mimo ni se ořízne;
 * tloušťky v mm papíru (nezávisle na měřítku); typy čar přesně podle vzoru (`dashPolyline`) – ve výřezu v jednotkách
 * papíru (PSLTSCALE = 1), jinak × měřítko výřezu; styl tisku barevně / černobíle / v odstínech šedi; ACI 7 = černá.
 */
import { aciRgb, hexRgb } from "../colors";
import { add, boxOf, mul, rot90, xfDet, xfInv, xfMul, xfPt, xfUniform, xfVec, type Affine, type Box } from "../geom";
import { entityPrims, kindOf, type ByBlockStyle, type KindCtx, type Prim, type Seg } from "../kinds";
import { layerVisible, resolveStyle } from "../layers";
import { dashPolyline } from "../linetypes";
import type { DraftEntity, DraftLayout, DraftModel, Vec2 } from "../model";
import { spatialIndex } from "../spatial";
import { extents } from "../status";
import { isViewportInner, vpDrawList } from "./kinds";
import { findLayout, parseSheet, printableRect, sheetRect } from "./sheets";
import type { DViewport } from "./types";
import { ratioLabel, unitMm, vpPolygon, vpXf } from "./util";

export type RGB = [number, number, number];
export type PathCmd = { k: "M"; p: Vec2 } | { k: "L"; p: Vec2 } | { k: "C"; c1: Vec2; c2: Vec2; p: Vec2 } | { k: "Z" };
export type PlotItem =
  /** tah: tloušťka v mm papíru, zakončení (round = tečky a běžné čáry, butt = široké křivky) */
  | { k: "stroke"; cmds: PathCmd[]; color: RGB; lw: number; cap: "round" | "butt" }
  /** výplň (sudo-liché pravidlo) */
  | { k: "fill"; cmds: PathCmd[]; color: RGB }
  /** text: počátek účaří, vektory os textu (X včetně šířkového faktoru, Y včetně sklonu) pro výšku verzálek 1 */
  | { k: "text"; p: Vec2; x: Vec2; y: Vec2; h: number; s: string; color: RGB; font: string }
  | { k: "clip"; poly: Vec2[] }
  | { k: "unclip" };
export type PlotPage = { w: number; h: number; items: PlotItem[]; name: string; scale: number; ratio: string };
export type PlotStyle = "color" | "mono" | "gray";
export type PlotOpts = {
  style?: PlotStyle;
  /** tisknout tloušťky objektů (jinak všechny 0,1 mm) */
  lineweights?: boolean;
  /** cílový formát (jinak formát rozvržení / A3 u modelu) */
  size?: string;
  landscape?: boolean;
  /** měřítko papír : výkres – rozvržení výchozí 1 (1:1), model výchozí „fit“ */
  ratio?: number | "fit";
  /** model: okno [roh, roh] v souřadnicích modelu (jinak rozsah) */
  window?: [Vec2, Vec2];
  /** okraje stránky při tisku modelu / zmenšeného rozvržení [mm] */
  margin?: number;
};

const BLACK: RGB = [0, 0, 0];
/** barva pro tisk (bílý papír): ACI 7 / bílá = černá */
export function plotColor(c: number | string, style: PlotStyle): RGB {
  if (style === "mono") return BLACK;
  let rgb: RGB;
  if (typeof c === "number") rgb = c === 7 || c === 255 ? BLACK : (aciRgb(c) as RGB);
  else rgb = (hexRgb(c) as RGB | null) ?? BLACK;
  if (rgb[0] >= 250 && rgb[1] >= 250 && rgb[2] >= 250) rgb = BLACK;
  if (style === "gray") {
    const g = Math.round(0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]);
    return [g, g, g];
  }
  return rgb;
}

/** rámec vykreslení: transformace do mm papíru, násobek vzoru čar (jednotky entity → mm papíru), ByBlock */
type Frame = { xf: Affine; lt: number; byBlock: ByBlockStyle | null; layer0: string | null; depth: number };
type Ctx = { model: DraftModel; kctx: KindCtx; style: PlotStyle; lw: boolean; out: PlotItem[]; page: Box; ps: 0 | 1 };

const tolChord = 0.004; // mm papíru – odchylka tětivy při rozložení oblouků pro přerušované čáry

/** Bézierovy úseky kruhového / eliptického oblouku: lokální afinní `loc` (jednotková kružnice → svět), úhly [rad] */
function arcBeziers(loc: Affine, t0: number, sweep: number, xf: Affine, cmds: PathCmd[], start: boolean) {
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 4) - 1e-9));
  const d = sweep / n;
  const k = (4 / 3) * Math.tan(d / 4);
  const m = xfMul(xf, loc);
  const P = (t: number): Vec2 => [Math.cos(t), Math.sin(t)];
  const T = (t: number): Vec2 => [-Math.sin(t), Math.cos(t)];
  if (start) cmds.push({ k: "M", p: xfPt(m, P(t0)) });
  for (let i = 0; i < n; i++) {
    const a = t0 + i * d;
    const b = i === n - 1 ? t0 + sweep : a + d;
    const p0 = P(a);
    const p3 = P(b);
    cmds.push({ k: "C", c1: xfPt(m, add(p0, mul(T(a), k))), c2: xfPt(m, add(p3, mul(T(b), -k))), p: xfPt(m, p3) });
  }
}
/** body oblouku pro přerušovanou čáru (tětiva ≤ tol v mm papíru) */
function arcPoints(loc: Affine, t0: number, sweep: number, xf: Affine, pts: Vec2[], scaleMm: number) {
  const r = Math.max(1e-12, scaleMm);
  const step = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tolChord / r)));
  const n = Math.min(20000, Math.max(4, Math.ceil(Math.abs(sweep) / Math.max(1e-6, step))));
  const m = xfMul(xf, loc);
  for (let i = pts.length ? 1 : 0; i <= n; i++) {
    const t = t0 + (sweep * i) / n;
    pts.push(xfPt(m, [Math.cos(t), Math.sin(t)]));
  }
}
const circleLoc = (c: Vec2, r: number): Affine => [r, 0, 0, r, c[0], c[1]];
const ellLoc = (c: Vec2, rx: number, ry: number, rot: number): Affine => {
  const cs = Math.cos(rot);
  const sn = Math.sin(rot);
  return [cs * rx, sn * rx, -sn * ry, cs * ry, c[0], c[1]];
};
const xfScale = (m: Affine) => Math.sqrt(Math.abs(xfDet(m)));
const same = (a: Vec2, b: Vec2) => Math.abs(a[0] - b[0]) < 1e-12 && Math.abs(a[1] - b[1]) < 1e-12;

/** cesta z úseků (Bézier pro oblouky – plná čára) */
function segsToCmds(segs: Seg[], closed: boolean | undefined, xf: Affine): PathCmd[] {
  const cmds: PathCmd[] = [];
  let cur: Vec2 | null = null;
  const moveTo = (p: Vec2) => {
    if (!cur || !same(cur, p)) cmds.push({ k: "M", p });
  };
  for (const s of segs) {
    if (s.k === "L") {
      const a = xfPt(xf, s.a);
      const b = xfPt(xf, s.b);
      moveTo(a);
      cmds.push({ k: "L", p: b });
      cur = b;
    } else if (s.k === "P") {
      s.pts.forEach((p0, i) => {
        const p = xfPt(xf, p0);
        if (i === 0) moveTo(p);
        else cmds.push({ k: "L", p });
        cur = p;
      });
    } else if (s.k === "A" || s.k === "E") {
      const loc = s.k === "A" ? circleLoc(s.c, s.r) : ellLoc(s.c, s.rx, s.ry, s.rot);
      const t0 = s.k === "A" ? s.a0 : s.t0;
      const sweep = s.k === "A" ? s.a1 - s.a0 : s.t1 - s.t0;
      const p0 = xfPt(xfMul(xf, loc), [Math.cos(t0), Math.sin(t0)]);
      const start = !cur || !same(cur, p0);
      arcBeziers(loc, t0, sweep, xf, cmds, start);
      cur = xfPt(xfMul(xf, loc), [Math.cos(t0 + sweep), Math.sin(t0 + sweep)]);
    }
  }
  if (closed && cmds.length) cmds.push({ k: "Z" });
  return cmds;
}

/** lomené čáry z úseků (pro přerušované čáry); každá souvislá část zvlášť */
function segsToPolys(segs: Seg[], closed: boolean | undefined, xf: Affine): Vec2[][] {
  const out: Vec2[][] = [];
  let cur: Vec2[] = [];
  const push = (p: Vec2) => {
    if (cur.length && same(cur[cur.length - 1], p)) return;
    cur.push(p);
  };
  const ensure = (p: Vec2) => {
    if (cur.length && !same(cur[cur.length - 1], p)) {
      if (cur.length > 1) out.push(cur);
      cur = [];
    }
  };
  for (const s of segs) {
    if (s.k === "L") {
      const a = xfPt(xf, s.a);
      ensure(a);
      push(a);
      push(xfPt(xf, s.b));
    } else if (s.k === "P") {
      const pts = s.pts.map((p) => xfPt(xf, p));
      if (pts.length) ensure(pts[0]);
      for (const p of pts) push(p);
    } else {
      const loc = s.k === "A" ? circleLoc(s.c, s.r) : ellLoc(s.c, s.rx, s.ry, s.rot);
      const t0 = s.k === "A" ? s.a0 : s.t0;
      const sweep = s.k === "A" ? s.a1 - s.a0 : s.t1 - s.t0;
      const m = xfMul(xf, loc);
      const p0 = xfPt(m, [Math.cos(t0), Math.sin(t0)]);
      ensure(p0);
      const pts: Vec2[] = [];
      arcPoints(loc, t0, sweep, xf, pts, xfScale(m) || 1);
      for (const p of pts) push(p);
    }
  }
  if (closed && cur.length > 1) push(cur[0]);
  if (cur.length > 1) out.push(cur);
  return out;
}

/** nekonečná přímka / polopřímka oříznutá na stránku */
function clipInf(p: Vec2, d: Vec2, ray: boolean, b: Box): [Vec2, Vec2] | null {
  const L = Math.hypot(d[0], d[1]);
  if (L < 1e-300) return null;
  const u: Vec2 = [d[0] / L, d[1] / L];
  let t0 = ray ? 0 : -Infinity;
  let t1 = Infinity;
  for (const [pp, uu, lo, hi] of [
    [p[0], u[0], b.x0, b.x1],
    [p[1], u[1], b.y0, b.y1],
  ] as const) {
    if (Math.abs(uu) < 1e-15) {
      if (pp < lo || pp > hi) return null;
    } else {
      let a = (lo - pp) / uu;
      let c = (hi - pp) / uu;
      if (a > c) [a, c] = [c, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, c);
    }
  }
  if (t0 > t1) return null;
  return [add(p, mul(u, t0)), add(p, mul(u, t1))];
}

function emitPrim(c: Ctx, e: DraftEntity, prim: Prim, fr: Frame, st: ReturnType<typeof resolveStyle>, color: RGB) {
  const lw = c.lw ? st.lineweight : 0.1;
  if (prim.k === "path") {
    if (prim.width && prim.width > 0) {
      c.out.push({ k: "stroke", cmds: segsToCmds(prim.segs, prim.closed, fr.xf), color, lw: prim.width * xfScale(fr.xf), cap: "butt" });
      return;
    }
    const lt = st.linetype;
    const dashed = lt && lt.pattern.length && !lt.pattern.every((x) => x > 0);
    if (!dashed) {
      c.out.push({ k: "stroke", cmds: segsToCmds(prim.segs, prim.closed, fr.xf), color, lw, cap: "round" });
      return;
    }
    const scale = st.ltscale * fr.lt;
    const cmds: PathCmd[] = [];
    for (const poly of segsToPolys(prim.segs, prim.closed, fr.xf)) {
      const { dashes, dots } = dashPolyline(poly, lt!.pattern, scale);
      for (const [a, b] of dashes) cmds.push({ k: "M", p: a }, { k: "L", p: b });
      for (const p of dots) cmds.push({ k: "M", p }, { k: "L", p });
    }
    if (cmds.length) c.out.push({ k: "stroke", cmds, color, lw, cap: "round" });
  } else if (prim.k === "inf") {
    const seg = clipInf(xfPt(fr.xf, prim.p), xfVec(fr.xf, prim.dir), prim.ray, c.page);
    if (seg) c.out.push({ k: "stroke", cmds: [{ k: "M", p: seg[0] }, { k: "L", p: seg[1] }], color, lw, cap: "round" });
  } else if (prim.k === "fill") {
    const cmds: PathCmd[] = [];
    for (const ring of prim.rings) {
      ring.forEach((p, i) => cmds.push({ k: i ? "L" : "M", p: xfPt(fr.xf, p) }));
      cmds.push({ k: "Z" });
    }
    if (cmds.length) c.out.push({ k: "fill", cmds, color });
  } else if (prim.k === "text") {
    if (!prim.s) return;
    const d0: Vec2 = [Math.cos(prim.rot), Math.sin(prim.rot)];
    const y0 = add(rot90(d0), mul(d0, Math.tan(prim.oblique || 0)));
    c.out.push({ k: "text", p: xfPt(fr.xf, prim.p), x: mul(xfVec(fr.xf, d0), prim.wf || 1), y: xfVec(fr.xf, y0), h: prim.h, s: prim.s, color, font: prim.font });
  } else if (prim.k === "mark") {
    const p = xfPt(fr.xf, prim.p);
    const mode = c.model.vars.pdmode;
    const base = mode & 31;
    const ps = c.model.vars.pdsize;
    const sz = ps > 0 ? ps * xfScale(fr.xf) : 2;
    const r = sz / 2;
    const cmds: PathCmd[] = [];
    if (base === 0) cmds.push({ k: "M", p }, { k: "L", p });
    else if (base === 2) cmds.push({ k: "M", p: [p[0] - r, p[1]] }, { k: "L", p: [p[0] + r, p[1]] }, { k: "M", p: [p[0], p[1] - r] }, { k: "L", p: [p[0], p[1] + r] });
    else if (base === 3) cmds.push({ k: "M", p: [p[0] - r, p[1] - r] }, { k: "L", p: [p[0] + r, p[1] + r] }, { k: "M", p: [p[0] - r, p[1] + r] }, { k: "L", p: [p[0] + r, p[1] - r] });
    else if (base === 4) cmds.push({ k: "M", p }, { k: "L", p: [p[0], p[1] + r] });
    if (mode & 32) arcBeziers(circleLoc(p, r), 0, Math.PI * 2, [1, 0, 0, 1, 0, 0], cmds, true);
    if (mode & 64) cmds.push({ k: "M", p: [p[0] - r, p[1] - r] }, { k: "L", p: [p[0] + r, p[1] - r] }, { k: "L", p: [p[0] + r, p[1] + r] }, { k: "L", p: [p[0] - r, p[1] + r] }, { k: "Z" });
    if (cmds.length) c.out.push({ k: "stroke", cmds, color, lw: c.lw ? Math.max(st.lineweight, 0.25) : 0.25, cap: "round" });
  } else if (prim.k === "sub") {
    if (fr.depth > 16) return;
    const xf = xfMul(fr.xf, prim.xf);
    const k = xfUniform(prim.xf) ?? Math.sqrt(Math.abs(xfDet(prim.xf)));
    const bb: ByBlockStyle = prim.byBlock ?? { color: st.color, linetype: st.linetype?.name ?? "Continuous", lineweight: st.lineweight };
    const sub: Frame = { xf, lt: fr.lt * (k || 1), byBlock: bb, layer0: e.layer, depth: fr.depth + 1 };
    if (prim.clip && prim.clip.length >= 3) {
      c.out.push({ k: "clip", poly: prim.clip.map((p) => xfPt(fr.xf, p)) });
      for (const ch of prim.entities) emitEntity(c, ch, sub);
      c.out.push({ k: "unclip" });
    } else for (const ch of prim.entities) emitEntity(c, ch, sub);
  }
}

function emitViewport(c: Ctx, vp: DViewport, fr: Frame) {
  // hladina výřezu řídí jen rám (vypnutá / zmrazená / netisknutelná hladina = výřez bez rámu, obsah se tiskne – jako
  // AutoCAD, kde se tak rámy výřezů schovávají); obsah vypne jen „výřez vypnout“ (on = false)
  const st = resolveStyle(c.model, vp, fr.byBlock);
  const pg = vpPolygon(vp);
  // obsah: model oříznutý obrysem (i když hladina rámu netiskne)
  if (vp.on !== false && vp.scale > 0) {
    const xf = xfMul(fr.xf, vpXf(vp));
    const list = vpDrawList(c.model, vp);
    const inv = xfInv(vpXf(vp));
    const mb = boxOf(pg.map((p) => xfPt(inv, p)));
    const cand = spatialIndex(list, c.kctx).query(mb);
    c.out.push({ k: "clip", poly: pg.map((p) => xfPt(fr.xf, p)) });
    const lt = (c.ps ? unitMm(c.model) : vp.scale) * fr.lt;
    const sub: Frame = { xf, lt, byBlock: { color: 7, linetype: "Continuous", lineweight: c.model.vars.lwdefault }, layer0: null, depth: fr.depth + 1 };
    for (const e of cand) emitEntity(c, e, sub);
    c.out.push({ k: "unclip" });
  }
  // rám
  if (st.plot && layerVisible(c.model, vp.layer)) c.out.push({ k: "stroke", cmds: [...pg.map((p, i): PathCmd => ({ k: i ? "L" : "M", p: xfPt(fr.xf, p) })), { k: "Z" }], color: plotColor(st.color, c.style), lw: c.lw ? st.lineweight : 0.1, cap: "round" });
}

function emitEntity(c: Ctx, e0: DraftEntity, fr: Frame) {
  if (isViewportInner(e0)) return;
  const e = fr.layer0 && e0.layer === "0" ? ({ ...e0, layer: fr.layer0 } as DraftEntity) : e0;
  if (e.type === "viewport") return emitViewport(c, e as DViewport, fr);
  if (!layerVisible(c.model, e.layer)) return;
  const st = resolveStyle(c.model, e, fr.byBlock);
  if (!st.plot) return;
  const color = plotColor(st.color, c.style);
  const prims = e === e0 ? entityPrims(e, c.kctx) : (kindOf(e)?.prims(e, c.kctx) ?? []);
  for (const p of prims) emitPrim(c, e, p, fr, st, color);
}

function newCtx(model: DraftModel, page: Box, opts: PlotOpts): Ctx {
  return { model, kctx: { model }, style: opts.style ?? "color", lw: opts.lineweights !== false, out: [], page, ps: model.vars.psltscale === 0 ? 0 : 1 };
}

/** cílová stránka: formát a orientace (výchozí podle zdroje) */
function targetPage(opts: PlotOpts, srcW: number, srcH: number): { w: number; h: number } {
  if (!opts.size) return { w: srcW, h: srcH };
  const sh = parseSheet(opts.size);
  if (!sh) throw new Error(`plot: ${opts.size}`);
  const land = opts.landscape ?? srcW >= srcH;
  return land ? { w: sh.h, h: sh.w } : { w: sh.w, h: sh.h };
}

/**
 * Tisk rozvržení: list 1:1 (souřadnice papíru → mm stránky), nebo na jiný formát s měřítkem / „fit“ (vystředěno).
 */
export function plotLayout(model: DraftModel, layoutKey: string, opts: PlotOpts = {}): PlotPage {
  const l = findLayout(model, layoutKey);
  if (!l) throw new Error(`layout ${layoutKey}`);
  return plotLayoutObj(model, l, opts);
}
export function plotLayoutObj(model: DraftModel, l: DraftLayout, opts: PlotOpts = {}): PlotPage {
  const sr = sheetRect(l);
  const sw = sr.x1 - sr.x0;
  const shh = sr.y1 - sr.y0;
  const pg = targetPage(opts, sw, shh);
  const margin = opts.margin ?? (opts.size ? 5 : 0);
  const fit = Math.min((pg.w - 2 * margin) / sw, (pg.h - 2 * margin) / shh);
  const k = opts.ratio === "fit" ? fit : typeof opts.ratio === "number" ? opts.ratio : opts.size ? Math.min(1, fit) : 1;
  // střed listu → střed stránky (1:1 na stejném formátu = jen posun počátku do rohu listu)
  const xf: Affine = [k, 0, 0, k, pg.w / 2 - k * (sr.x0 + sr.x1) / 2, pg.h / 2 - k * (sr.y0 + sr.y1) / 2];
  const c = newCtx(model, { x0: 0, y0: 0, x1: pg.w, y1: pg.h }, opts);
  // okraje tisku: obsah mimo tisknutelnou plochu se neotiskne (ořez na plochu, ne posun listu)
  const pr = printableRect(l);
  const clipM = pr.x0 > sr.x0 + 1e-9 || pr.y0 > sr.y0 + 1e-9 || pr.x1 < sr.x1 - 1e-9 || pr.y1 < sr.y1 - 1e-9;
  if (clipM) c.out.push({ k: "clip", poly: ([[pr.x0, pr.y0], [pr.x1, pr.y0], [pr.x1, pr.y1], [pr.x0, pr.y1]] as Vec2[]).map((p) => xfPt(xf, p)) });
  for (const e of l.entities) emitEntity(c, e, { xf, lt: k, byBlock: null, layer0: null, depth: 0 });
  if (clipM) c.out.push({ k: "unclip" });
  return { w: pg.w, h: pg.h, items: c.out, name: l.name, scale: k, ratio: ratioLabel(k) };
}

/** Tisk modelového prostoru: okno nebo rozsah, měřítko papír : skutečnost (nebo „fit“), vystředěno na stránce. */
export function plotModel(model: DraftModel, opts: PlotOpts = {}): PlotPage {
  const ex = opts.window ? boxOf(opts.window) : extents(model, model.entities);
  const pg = targetPage({ ...opts, size: opts.size ?? "A3" }, 420, 297);
  const margin = opts.margin ?? 10;
  if (!ex) return { w: pg.w, h: pg.h, items: [], name: "Model", scale: 1, ratio: "1:1" };
  const um = unitMm(model);
  const w = Math.max(1e-9, ex.x1 - ex.x0);
  const h = Math.max(1e-9, ex.y1 - ex.y0);
  const k = opts.ratio === undefined || opts.ratio === "fit" ? Math.min((pg.w - 2 * margin) / w, (pg.h - 2 * margin) / h) : opts.ratio * um;
  const xf: Affine = [k, 0, 0, k, pg.w / 2 - k * (ex.x0 + ex.x1) / 2, pg.h / 2 - k * (ex.y0 + ex.y1) / 2];
  const page: Box = { x0: 0, y0: 0, x1: pg.w, y1: pg.h };
  const c = newCtx(model, page, opts);
  const win: Box = { x0: (0 - xf[4]) / k, y0: (0 - xf[5]) / k, x1: (pg.w - xf[4]) / k, y1: (pg.h - xf[5]) / k };
  const cand = spatialIndex(model.entities, c.kctx).query(win);
  if (opts.window) c.out.push({ k: "clip", poly: [xfPt(xf, [ex.x0, ex.y0]), xfPt(xf, [ex.x1, ex.y0]), xfPt(xf, [ex.x1, ex.y1]), xfPt(xf, [ex.x0, ex.y1])] });
  for (const e of cand) emitEntity(c, e, { xf, lt: k, byBlock: null, layer0: null, depth: 0 });
  if (opts.window) c.out.push({ k: "unclip" });
  return { w: pg.w, h: pg.h, items: c.out, name: "Model", scale: k, ratio: ratioLabel(k / um) };
}

/** délka cesty (úsečky + Bézierovy oblouky numericky) – pomůcka pro testy a kontrolu měřítka */
export function cmdsLength(cmds: PathCmd[]): number {
  let L = 0;
  let cur: Vec2 = [0, 0];
  let start: Vec2 = [0, 0];
  for (const c of cmds) {
    if (c.k === "M") cur = start = c.p;
    else if (c.k === "L") {
      L += Math.hypot(c.p[0] - cur[0], c.p[1] - cur[1]);
      cur = c.p;
    } else if (c.k === "C") {
      const n = 64;
      let prev = cur;
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const u = 1 - t;
        const p: Vec2 = [u * u * u * cur[0] + 3 * u * u * t * c.c1[0] + 3 * u * t * t * c.c2[0] + t * t * t * c.p[0], u * u * u * cur[1] + 3 * u * u * t * c.c1[1] + 3 * u * t * t * c.c2[1] + t * t * t * c.p[1]];
        L += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
        prev = p;
      }
      cur = c.p;
    } else {
      L += Math.hypot(start[0] - cur[0], start[1] - cur[1]);
      cur = start;
    }
  }
  return L;
}
