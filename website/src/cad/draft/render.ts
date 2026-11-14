/**
 * Vykreslení 2D výkresu do Canvas 2D. Souřadnice se převádějí na obrazovku v JavaScriptu (dvojitá přesnost –
 * i výkres se souřadnicemi 1 000 000 se při velkém přiblížení nechvěje). Entity mimo okno se přeskočí (prostorový index),
 * entity stejného stylu se kreslí jednou cestou (rychlost při 20 000+ entitách). Typy čar = přesné délky vzoru × LTSCALE
 * × měřítko entity (setLineDash v pixelech), tloušťky podle LWDISPLAY, barvy ACI / pravé, ByLayer / ByBlock.
 * Používá ho pracovní plocha (model i papírový prostor) a balík 3 (výřezy, náhled tisku) přes `drawEntities`.
 */
import { displayHex } from "./colors";
import { add, boxOf, emptyBox, mul, rot90, xfDet, xfInv, xfMul, xfPt, xfUniform, xfVec, type Affine, type Box } from "./geom";
import { entityPrims, kindOf, setTextMeasure, textWidth1, type ByBlockStyle, type KindCtx, type Prim, type Seg } from "./kinds";
import { layerVisible, resolveStyle, type ResolvedStyle } from "./layers";
import type { DraftEntity, DraftModel, NewEntity, Vec2 } from "./model";
import { spatialIndex, type SpatialIndex } from "./spatial";

/** pohled: střed ve světových souřadnicích, měřítko [px na jednotku], velikost plátna [CSS px], hustota pixelů */
export type View = { cx: number; cy: number; scale: number; w: number; h: number; dpr: number };

export const toScreen = (v: View, p: Vec2): Vec2 => [(p[0] - v.cx) * v.scale + v.w / 2, v.h / 2 - (p[1] - v.cy) * v.scale];
export const toWorld = (v: View, s: Vec2): Vec2 => [(s[0] - v.w / 2) / v.scale + v.cx, (v.h / 2 - s[1]) / v.scale + v.cy];
export const viewBox = (v: View): Box => ({ x0: v.cx - v.w / 2 / v.scale, y0: v.cy - v.h / 2 / v.scale, x1: v.cx + v.w / 2 / v.scale, y1: v.cy + v.h / 2 / v.scale });
/** pohled, který ukáže obálku s okrajem */
export function fitView(b: Box, w: number, h: number, dpr: number, margin = 0.06): View {
  const bw = Math.max(1e-9, b.x1 - b.x0);
  const bh = Math.max(1e-9, b.y1 - b.y0);
  const scale = Math.min((w * (1 - 2 * margin)) / bw, (h * (1 - 2 * margin)) / bh);
  return { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, scale: Number.isFinite(scale) && scale > 0 ? Math.min(scale, 1e7) : 1, w, h, dpr };
}

export type RenderOpts = {
  dark: boolean;
  /** zobrazovat tloušťky čar (LWDISPLAY) */
  lwdisplay: boolean;
  /** vybrané entity (zvýraznění + úchopy) */
  sel?: ReadonlySet<string>;
  /** entita pod kurzorem */
  hover?: string | null;
  /** jen tisknutelné hladiny (náhled tisku) */
  plotOnly?: boolean;
  /** tloušťky v mm papíru → px (tisk, PDF) místo zobrazení na obrazovce */
  lwPxPerMm?: number;
  /** barva všech entit (náhled černobílého tisku) */
  mono?: string;
};

let measureCanvas: CanvasRenderingContext2D | null = null;
/** přesné měření šířky textu pro zarovnání (jen v prohlížeči) */
export function installTextMeasure() {
  if (typeof document === "undefined" || measureCanvas) return;
  measureCanvas = document.createElement("canvas").getContext("2d");
  if (!measureCanvas) return;
  const cache = new Map<string, number>();
  setTextMeasure((s, font) => {
    const k = `${font}|${s}`;
    let w = cache.get(k);
    if (w === undefined) {
      // výška textu = výška verzálek = 0,72 × velikost písma (stejně jako při vykreslení)
      measureCanvas!.font = `${100 / 0.72}px ${font}`;
      w = measureCanvas!.measureText(s).width / 100;
      if (cache.size > 5000) cache.clear();
      cache.set(k, w);
    }
    return w;
  });
}

/** šířka čáry v px pro obrazovku: 0,25 mm ≈ 1 px (96 dpi), minimálně 1 px */
const lwPx = (mm: number, opts: RenderOpts, dpr: number) => (opts.lwPxPerMm ? Math.max(0.5, mm * opts.lwPxPerMm) : opts.lwdisplay ? Math.max(1, Math.round(mm * 3.78 * 10) / 10) * dpr : dpr);

type Group = { color: string; width: number; dash: number[] | null; segs: { xf: Affine | null; prim: Extract<Prim, { k: "path" | "inf" }> }[] };

/** entita vrstvy 0 uvnitř bloku na vrstvě vložení – stejný objekt pro stejnou dvojici (mezipaměti prims / křivek podle identity) */
const layer0Cache = new WeakMap<DraftEntity, Map<string, DraftEntity>>();
function onLayer(c: DraftEntity, layer: string): DraftEntity {
  let m = layer0Cache.get(c);
  if (!m) layer0Cache.set(c, (m = new Map()));
  let r = m.get(layer);
  if (!r) m.set(layer, (r = { ...c, layer } as DraftEntity));
  return r;
}

/** kontext vykreslení vnořených entit (bloky, výřezy): transformace do světa, vlastnosti pro ByBlock */
export type Frame = { xf: Affine | null; byBlock?: ByBlockStyle | null; clip?: Vec2[] };

/**
 * Vykreslí entity seznamu (viditelné hladiny, v okně). Vrací počet vykreslených entit a čas.
 * `ctx` musí mít jednotkovou transformaci; kreslí se v pixelech zařízení.
 */
export function drawEntities(ctx: CanvasRenderingContext2D, model: DraftModel, list: readonly DraftEntity[], idx: SpatialIndex | null, view: View, opts: RenderOpts, frame: Frame = { xf: null }): { drawn: number; ms: number } {
  const t0 = performance.now();
  const box = viewBox(view);
  const kctx: KindCtx = { model };
  const vis = idx ? idx.query(box) : list;
  const groups = new Map<string, Group>();
  const texts: { e: DraftEntity; prim: Extract<Prim, { k: "text" }>; color: string; xf: Affine | null }[] = [];
  const fills: { prim: Extract<Prim, { k: "fill" }>; color: string; xf: Affine | null }[] = [];
  const marks: { p: Vec2; color: string; xf: Affine | null }[] = [];
  /** vnořené entity s ořezem (výřezy rozvržení) – kreslí se zvlášť s clip() */
  const clipped: { entities: DraftEntity[]; xf: Affine; outer: Affine | null; byBlock: ByBlockStyle; clip: Vec2[] }[] = [];
  let drawn = 0;
  const visit = (e: DraftEntity, fr: Frame, depth: number) => {
    if (!layerVisible(model, e.layer)) return;
    const st = resolveStyle(model, e, fr.byBlock);
    if (opts.plotOnly && !st.plot) return;
    const color = opts.mono ?? displayHex(st.color, opts.dark);
    for (const prim of entityPrims(e, kctx)) {
      if (prim.k === "path" || prim.k === "inf") {
        const width = prim.k === "path" && prim.width && prim.width > 0 ? -prim.width : lwPx(st.lineweight, opts, view.dpr);
        const dash = dashFor(st, view, fr.xf);
        const key = `${color}|${width}|${dash ? dash.join(",") : ""}`;
        let g = groups.get(key);
        if (!g) groups.set(key, (g = { color, width, dash, segs: [] }));
        g.segs.push({ xf: fr.xf, prim });
      } else if (prim.k === "text") texts.push({ e, prim, color, xf: fr.xf });
      else if (prim.k === "fill") fills.push({ prim, color, xf: fr.xf });
      else if (prim.k === "mark") marks.push({ p: prim.p, color, xf: fr.xf });
      else if (prim.k === "sub" && depth < 16) {
        const xf = fr.xf ? xfMul(fr.xf, prim.xf) : prim.xf;
        const bb: ByBlockStyle = prim.byBlock ?? { color: st.color, linetype: st.linetype?.name ?? "Continuous", lineweight: st.lineweight };
        if (prim.clip && prim.clip.length >= 3) clipped.push({ entities: prim.entities, xf, outer: fr.xf, byBlock: bb, clip: prim.clip });
        else for (const c of prim.entities) visit(c.layer === "0" ? onLayer(c, e.layer) : c, { xf, byBlock: bb, clip: fr.clip }, depth + 1);
      }
    }
    drawn++;
  };
  for (const e of vis) visit(e, frame, 0);
  // výchozí transformace volajícího (obvykle jednotková) – texty ji nastavují přímo místo save / restore
  const T0 = typeof ctx.getTransform === "function" ? ctx.getTransform() : null;
  const fastText = !!T0 && T0.isIdentity;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "butt";
  // výplně pod čarami
  for (const f of fills) {
    ctx.fillStyle = f.color;
    ctx.beginPath();
    for (const ring of f.prim.rings) ring.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).apply(ctx, dev(view, f.xf ? xfPt(f.xf, p) : p)));
    ctx.fill("evenodd");
  }
  for (const g of groups.values()) {
    ctx.strokeStyle = g.color;
    ctx.setLineDash(g.dash ?? []);
    if (g.width < 0) {
      // široká křivka: šířka ve světových jednotkách
      for (const s of g.segs) {
        ctx.lineWidth = Math.max(view.dpr, -g.width * view.scale * view.dpr * (s.xf ? Math.sqrt(Math.abs(xfDet(s.xf))) : 1));
        ctx.lineCap = "butt";
        ctx.beginPath();
        addPrim(ctx, s.prim, view, s.xf, box);
        ctx.stroke();
      }
      continue;
    }
    ctx.lineWidth = g.width;
    ctx.beginPath();
    for (const s of g.segs) addPrim(ctx, s.prim, view, s.xf, box);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  // malý text (< 4 px na obrazovce) jen jako čárka – jedna cesta za barvu (jako AutoCAD); tisk kreslí text od 1,2 px
  const greekPx = opts.plotOnly || opts.lwPxPerMm ? 1.2 : 4 * view.dpr;
  const greek = new Map<string, [number, number, number, number][]>();
  for (const t of texts) {
    const g = drawText(ctx, t.prim, t.color, view, t.xf, greekPx, fastText);
    if (g) {
      let arr = greek.get(t.color);
      if (!arr) greek.set(t.color, (arr = []));
      arr.push(g);
    }
  }
  if (fastText) ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (greek.size) {
    ctx.lineWidth = view.dpr;
    for (const [color, segs] of greek) {
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      for (const g of segs) {
        ctx.moveTo(g[0], g[1]);
        ctx.lineTo(g[2], g[3]);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  for (const m of marks) drawMark(ctx, m.xf ? xfPt(m.xf, m.p) : m.p, m.color, model, view);
  // výřezy: ořez polygonem a jen entity v jeho dosahu (prostorový index seznamu, např. modelového prostoru)
  for (const c of clipped) {
    ctx.save();
    ctx.beginPath();
    c.clip.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).apply(ctx, dev(view, c.outer ? xfPt(c.outer, p) : p)));
    ctx.closePath();
    ctx.clip();
    const inv = xfInv(c.xf);
    const outerPts = c.clip.map((p) => (c.outer ? xfPt(c.outer, p) : p));
    const inner = boxOf(outerPts.map((p) => xfPt(inv, p)));
    const sub = spatialIndex(c.entities, kctx).query(inner);
    drawn += drawEntities(ctx, model, sub, null, view, opts, { xf: c.xf, byBlock: c.byBlock }).drawn;
    ctx.restore();
  }
  ctx.restore();
  return { drawn, ms: performance.now() - t0 };
}

/** vzor čárkování v pixelech zařízení (null = plná) */
function dashFor(st: ResolvedStyle, view: View, xf: Affine | null): number[] | null {
  const lt = st.linetype;
  if (!lt || !lt.pattern.length || lt.pattern.every((x) => x > 0)) return null;
  const k = st.ltscale * view.scale * view.dpr * (xf ? (xfUniform(xf) ?? 1) : 1);
  const pat = lt.pattern.map((x) => Math.abs(x) * k);
  const period = pat.reduce((a, b) => a + b, 0);
  // vzor menší než 3 px = plná čára (jako AutoCAD); obrovský vzor = plná (čárka delší než okno)
  if (period < 3 * view.dpr || period > 1e6) return null;
  // setLineDash střídá čára / mezera; tečka (0) = čárka 1 px; sousední prvky stejného druhu se sloučí
  const out: number[] = [];
  for (const v of lt.pattern) {
    const isDash = v >= 0;
    const len = v === 0 ? view.dpr : Math.abs(v) * k;
    const wantDash = out.length % 2 === 0;
    if (isDash === wantDash) out.push(len);
    else if (out.length) out[out.length - 1] += len;
    else out.push(0, len);
  }
  if (out.length % 2) out.push(0);
  return out;
}

/** bod → pixely zařízení */
const dev = (v: View, p: Vec2): [number, number] => [((p[0] - v.cx) * v.scale + v.w / 2) * v.dpr, (v.h / 2 - (p[1] - v.cy) * v.scale) * v.dpr];

function addPrim(ctx: CanvasRenderingContext2D, prim: Extract<Prim, { k: "path" | "inf" }>, v: View, xf: Affine | null, box: Box) {
  if (prim.k === "inf") {
    const p = xf ? xfPt(xf, prim.p) : prim.p;
    const d = xf ? xfVec(xf, prim.dir) : prim.dir;
    const seg = clipInfinite(p, d, prim.ray, box);
    if (!seg) return;
    ctx.moveTo(...dev(v, seg[0]));
    ctx.lineTo(...dev(v, seg[1]));
    return;
  }
  let first = true;
  let start: [number, number] | null = null;
  for (const s0 of prim.segs) {
    const s = xf ? xfSeg(s0, xf) : s0;
    if (s.k === "L") {
      const a = dev(v, s.a);
      if (first) {
        ctx.moveTo(...a);
        start = a;
      }
      ctx.lineTo(...dev(v, s.b));
    } else if (s.k === "A") {
      const c = dev(v, s.c);
      const r = s.r * v.scale * v.dpr;
      const p0 = dev(v, [s.c[0] + s.r * Math.cos(s.a0), s.c[1] + s.r * Math.sin(s.a0)]);
      if (first) {
        ctx.moveTo(...p0);
        start = p0;
      }
      if (r > 1e6) ctx.lineTo(...dev(v, [s.c[0] + s.r * Math.cos(s.a1), s.c[1] + s.r * Math.sin(s.a1)]));
      else ctx.arc(c[0], c[1], r, -s.a0, -s.a1, s.ccw);
    } else if (s.k === "E") {
      const c = dev(v, s.c);
      const cosr = Math.cos(s.rot);
      const sinr = Math.sin(s.rot);
      const pt = (t: number): Vec2 => [s.c[0] + s.rx * Math.cos(t) * cosr - s.ry * Math.sin(t) * sinr, s.c[1] + s.rx * Math.cos(t) * sinr + s.ry * Math.sin(t) * cosr];
      const p0 = dev(v, pt(s.t0));
      if (first) {
        ctx.moveTo(...p0);
        start = p0;
      }
      ctx.ellipse(c[0], c[1], Math.max(0, s.rx * v.scale * v.dpr), Math.max(0, s.ry * v.scale * v.dpr), -s.rot, -s.t0, -s.t1, s.ccw);
    } else if (s.k === "P") {
      s.pts.forEach((p, i) => {
        const q = dev(v, p);
        if (first && i === 0) {
          ctx.moveTo(...q);
          start = q;
        } else ctx.lineTo(...q);
      });
    }
    first = false;
  }
  // lineTo místo closePath: closePath na jedné velké dávkové cestě je v Chromiu O(n²) (2000 smyček 763 ms → 12 ms)
  if (prim.closed && start) ctx.lineTo(start[0], start[1]);
}

/** úsek dráhy v afinní transformaci (oblouk při nestejném měřítku → eliptický oblouk) */
export function xfSeg(s: Seg, m: Affine): Seg {
  if (s.k === "L") return { k: "L", a: xfPt(m, s.a), b: xfPt(m, s.b) };
  if (s.k === "P") return { k: "P", pts: s.pts.map((p) => xfPt(m, p)) };
  const k = xfUniform(m);
  const flip = xfDet(m) < 0;
  if (s.k === "A" && k !== null) {
    const rot = Math.atan2(m[1], m[0]);
    if (!flip) return { k: "A", c: xfPt(m, s.c), r: s.r * k, a0: s.a0 + rot, a1: s.a1 + rot, ccw: s.ccw };
    // zrcadlení: úhel a → rot − a, směr opačný
    return { k: "A", c: xfPt(m, s.c), r: s.r * k, a0: rot - s.a0, a1: rot - s.a1, ccw: !s.ccw };
  }
  // obecně: vzorkovaná lomená čára
  const pts: Vec2[] = [];
  const N = 64;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    if (s.k === "A") {
      const a = s.a0 + (s.a1 - s.a0) * t;
      pts.push(xfPt(m, [s.c[0] + s.r * Math.cos(a), s.c[1] + s.r * Math.sin(a)]));
    } else {
      const tt = s.t0 + (s.t1 - s.t0) * t;
      const cosr = Math.cos(s.rot);
      const sinr = Math.sin(s.rot);
      pts.push(xfPt(m, [s.c[0] + s.rx * Math.cos(tt) * cosr - s.ry * Math.sin(tt) * sinr, s.c[1] + s.rx * Math.cos(tt) * sinr + s.ry * Math.sin(tt) * cosr]));
    }
  }
  return { k: "P", pts };
}

/** nekonečná přímka / polopřímka oříznutá na okno (s rezervou) */
export function clipInfinite(p: Vec2, d: Vec2, ray: boolean, b: Box): [Vec2, Vec2] | null {
  const L = Math.hypot(d[0], d[1]);
  if (L < 1e-300) return null;
  const u: Vec2 = [d[0] / L, d[1] / L];
  const pad = Math.max(b.x1 - b.x0, b.y1 - b.y0);
  const x0 = b.x0 - pad;
  const x1 = b.x1 + pad;
  const y0 = b.y0 - pad;
  const y1 = b.y1 + pad;
  let t0 = ray ? 0 : -Infinity;
  let t1 = Infinity;
  for (const [pp, uu, lo, hi] of [
    [p[0], u[0], x0, x1],
    [p[1], u[1], y0, y1],
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

function drawText(ctx: CanvasRenderingContext2D, t: Extract<Prim, { k: "text" }>, color: string, v: View, xf: Affine | null, greekPx = 1.2, fast = false): [number, number, number, number] | null {
  let p = t.p;
  let dir: Vec2 = [Math.cos(t.rot), Math.sin(t.rot)];
  let h = t.h;
  let mirror = false;
  if (xf) {
    p = xfPt(xf, p);
    const d2 = xfVec(xf, dir);
    const up = xfVec(xf, rot90(dir));
    h = t.h * Math.hypot(up[0], up[1]);
    mirror = xfDet(xf) < 0;
    dir = d2;
  }
  const px = h * v.scale * v.dpr;
  // nečitelně malý text se nekreslí
  if (px < 1.2 || !t.s) return null;
  const s = dev(v, p);
  const ang = Math.atan2(dir[1], dir[0]);
  const sx = Math.hypot(dir[0], dir[1]) / (xf ? Math.hypot(...xfVec(xf, [1, 0])) || 1 : 1);
  const kx = t.wf * (sx || 1);
  if (px < greekPx) {
    // „řecký“ text: čárka v půli výšky, délka odhadem 0,6 výšky na znak (bez měření písma)
    const c = Math.cos(-ang);
    const sn = Math.sin(-ang);
    const len = px * 0.6 * kx * t.s.length;
    const up = (mirror ? 1 : -1) * px * 0.35;
    const x0 = s[0] - sn * up;
    const y0 = s[1] + c * up;
    return [x0, y0, x0 + c * len, y0 + sn * len];
  }
  const my = mirror ? -1 : 1;
  if (fast) {
    // jedna transformace místo save / translate / rotate / restore (rychlejší u tisíců textů); volající ji vrátí
    const c = Math.cos(-ang);
    const sn = Math.sin(-ang);
    ctx.setTransform(c * kx, sn * kx, -sn * my, c * my, s[0], s[1]);
  } else {
    ctx.save();
    ctx.translate(s[0], s[1]);
    ctx.rotate(-ang);
    ctx.scale(kx, my);
  }
  if (t.oblique) ctx.transform(1, 0, -Math.tan(t.oblique), 1, 0, 0);
  // výška textu = výška verzálek: velikost písma ≈ výška / 0,72
  ctx.font = `${px / 0.72}px ${t.font}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = color;
  ctx.fillText(t.s, 0, 0);
  if (!fast) ctx.restore();
  return null;
}

function drawMark(ctx: CanvasRenderingContext2D, p: Vec2, color: string, model: DraftModel, v: View) {
  const mode = model.vars.pdmode;
  const sz = model.vars.pdsize > 0 ? model.vars.pdsize * v.scale * v.dpr : model.vars.pdsize < 0 ? (Math.abs(model.vars.pdsize) / 100) * v.h * v.dpr : 0.05 * v.h * v.dpr;
  const [x, y] = dev(v, p);
  const r = Math.max(2, sz / 2);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = v.dpr;
  const base = mode & 31;
  if (base === 0) ctx.fillRect(x - v.dpr, y - v.dpr, 2 * v.dpr, 2 * v.dpr);
  ctx.beginPath();
  if (base === 2) {
    ctx.moveTo(x - r, y);
    ctx.lineTo(x + r, y);
    ctx.moveTo(x, y - r);
    ctx.lineTo(x, y + r);
  } else if (base === 3) {
    ctx.moveTo(x - r, y - r);
    ctx.lineTo(x + r, y + r);
    ctx.moveTo(x - r, y + r);
    ctx.lineTo(x + r, y - r);
  } else if (base === 4) {
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - r);
  }
  if (mode & 32) ctx.moveTo(x + r, y), ctx.arc(x, y, r, 0, Math.PI * 2);
  if (mode & 64) ctx.rect(x - r, y - r, 2 * r, 2 * r);
  ctx.stroke();
}

/** zvýraznění vybraných / pod kurzorem: stejné dráhy silněji a modře, úchopy */
export function drawHighlight(ctx: CanvasRenderingContext2D, model: DraftModel, ents: readonly DraftEntity[], view: View, opts: { color: string; width: number; dash?: number[]; grips?: boolean; gripColor?: string }) {
  const kctx: KindCtx = { model };
  const box = viewBox(view);
  ctx.save();
  ctx.strokeStyle = opts.color;
  ctx.fillStyle = opts.color;
  ctx.lineWidth = opts.width * view.dpr;
  ctx.setLineDash((opts.dash ?? []).map((x) => x * view.dpr));
  ctx.beginPath();
  for (const e of ents)
    for (const prim of entityPrims(e, kctx)) {
      if (prim.k === "path" || prim.k === "inf") addPrim(ctx, prim, view, null, box);
      else if (prim.k === "text" || prim.k === "mark") {
        const b = textOrMarkBox(prim);
        const a = dev(view, [b.x0, b.y0]);
        const c = dev(view, [b.x1, b.y1]);
        ctx.rect(a[0], c[1], c[0] - a[0], a[1] - c[1]);
      } else if (prim.k === "sub") for (const c of prim.entities) for (const pp of entityPrims(c, kctx)) if (pp.k === "path") addPrim(ctx, pp, view, prim.xf, box);
    }
  ctx.stroke();
  ctx.setLineDash([]);
  if (opts.grips && ents.length <= 300) {
    const g = 3.5 * view.dpr;
    ctx.fillStyle = opts.gripColor ?? "#2f6fdf";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = view.dpr;
    for (const e of ents) {
      const k = entityPrims(e, kctx).length ? e : null;
      if (!k) continue;
      for (const p of gripsOf(e, kctx)) {
        const [x, y] = dev(view, p);
        ctx.fillRect(x - g, y - g, 2 * g, 2 * g);
        ctx.strokeRect(x - g, y - g, 2 * g, 2 * g);
      }
    }
  }
  ctx.restore();
}

const gripsOf = (e: DraftEntity, k: KindCtx) => kindOf(e)?.grips(e, k) ?? [];
function textOrMarkBox(prim: Extract<Prim, { k: "text" | "mark" }>): Box {
  if (prim.k === "mark") return { x0: prim.p[0], y0: prim.p[1], x1: prim.p[0], y1: prim.p[1] };
  const b = emptyBox();
  const d: Vec2 = [Math.cos(prim.rot), Math.sin(prim.rot)];
  const up = mul(rot90(d), prim.h);
  const w = textWidth1(prim.s, prim.font) * prim.h * prim.wf;
  for (const p of [prim.p, add(prim.p, mul(d, w)), add(add(prim.p, mul(d, w)), up), add(prim.p, up)]) {
    b.x0 = Math.min(b.x0, p[0]);
    b.y0 = Math.min(b.y0, p[1]);
    b.x1 = Math.max(b.x1, p[0]);
    b.y1 = Math.max(b.y1, p[1]);
  }
  return b;
}

/** náhled nových entit (gumová čára) stylem aktuální hladiny */
export function drawPreview(ctx: CanvasRenderingContext2D, model: DraftModel, ents: NewEntity[], view: View, dark: boolean) {
  if (!ents.length) return;
  const list = ents.map((e, i) => ({ ...e, id: `~p${i}`, layer: e.layer ?? model.vars.clayer }) as DraftEntity);
  drawEntities(ctx, model, list, null, view, { dark, lwdisplay: false });
}

/** mřížka (GRID): rozestup se zvětšuje 2× / 5× / 10×, aby čáry nebyly hustší než 12 px; každá 5. silnější */
export function drawGrid(ctx: CanvasRenderingContext2D, view: View, step0: number, dark: boolean) {
  let step = step0 > 0 ? step0 : 10;
  while (step * view.scale < 12) step *= 5;
  while (step * view.scale > 600) step /= 5;
  const b = viewBox(view);
  ctx.save();
  ctx.lineWidth = 1;
  const minor = dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  const major = dark ? "rgba(255,255,255,0.13)" : "rgba(0,0,0,0.12)";
  for (const [kind, color] of [
    [1, minor],
    [5, major],
  ] as const) {
    ctx.strokeStyle = color;
    ctx.beginPath();
    const s = step * kind;
    for (let x = Math.ceil(b.x0 / s) * s; x <= b.x1; x += s) {
      const px = Math.round(dev(view, [x, 0])[0]) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, view.h * view.dpr);
    }
    for (let y = Math.ceil(b.y0 / s) * s; y <= b.y1; y += s) {
      const py = Math.round(dev(view, [0, y])[1]) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(view.w * view.dpr, py);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** ikona souřadného systému v počátku (nebo v rohu, je-li počátek mimo okno) */
export function drawUcs(ctx: CanvasRenderingContext2D, view: View) {
  let [x, y] = dev(view, [0, 0]);
  const m = 40 * view.dpr;
  if (x < m || y > view.h * view.dpr - m || x > view.w * view.dpr - m || y < m) {
    x = 16 * view.dpr;
    y = view.h * view.dpr - 16 * view.dpr;
  }
  const L = 28 * view.dpr;
  ctx.save();
  ctx.lineWidth = 2 * view.dpr;
  ctx.strokeStyle = "#e03930";
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + L, y);
  ctx.stroke();
  ctx.strokeStyle = "#16a34a";
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - L);
  ctx.stroke();
  ctx.font = `${10 * view.dpr}px sans-serif`;
  ctx.fillStyle = "#e03930";
  ctx.fillText("X", x + L + 2 * view.dpr, y + 4 * view.dpr);
  ctx.fillStyle = "#16a34a";
  ctx.fillText("Y", x - 3 * view.dpr, y - L - 4 * view.dpr);
  ctx.restore();
}

/** značka uchopení (AutoCAD: čtverec konec, trojúhelník polovina, kruh střed, kosočtverec kvadrant, × průsečík…) */
export function drawSnapMarker(ctx: CanvasRenderingContext2D, view: View, p: Vec2, kind: string, color = "#f5c518") {
  const [x, y] = dev(view, p);
  const r = 6 * view.dpr;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 * view.dpr;
  ctx.beginPath();
  switch (kind) {
    case "end":
      ctx.rect(x - r, y - r, 2 * r, 2 * r);
      break;
    case "mid":
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.lineTo(x - r, y + r);
      ctx.closePath();
      break;
    case "cen":
      ctx.arc(x, y, r, 0, Math.PI * 2);
      break;
    case "qua":
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      break;
    case "int":
    case "app":
      ctx.moveTo(x - r, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.moveTo(x - r, y + r);
      ctx.lineTo(x + r, y - r);
      break;
    case "per":
      ctx.moveTo(x - r, y + r);
      ctx.lineTo(x + r, y + r);
      ctx.moveTo(x - r, y + r);
      ctx.lineTo(x - r, y - r);
      ctx.moveTo(x - r, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + r);
      break;
    case "tan":
      ctx.arc(x, y, r * 0.8, 0, Math.PI * 2);
      ctx.moveTo(x - r, y - r);
      ctx.lineTo(x + r, y - r);
      break;
    case "nea":
      ctx.moveTo(x - r, y - r);
      ctx.lineTo(x + r, y - r);
      ctx.lineTo(x - r, y + r);
      ctx.lineTo(x + r, y + r);
      ctx.closePath();
      break;
    case "nod":
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.moveTo(x - r * 0.7, y - r * 0.7);
      ctx.lineTo(x + r * 0.7, y + r * 0.7);
      ctx.moveTo(x - r * 0.7, y + r * 0.7);
      ctx.lineTo(x + r * 0.7, y - r * 0.7);
      break;
    case "ins":
      ctx.rect(x - r, y - r, r, r);
      ctx.rect(x, y, r, r);
      break;
    default:
      ctx.rect(x - r / 2, y - r / 2, r, r);
  }
  ctx.stroke();
  ctx.restore();
}
