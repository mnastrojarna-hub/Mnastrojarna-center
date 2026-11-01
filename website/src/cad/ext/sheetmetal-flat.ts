/**
 * Plechové díly – čistá 2D část (bez OCCT): parametry plechu, výpočet rozvinu (flat pattern) z historie prvků,
 * export rozvinu do DXF/SVG a tabulka ohybů. Používá ji jádro (prvek „Rozvinout“) i UI (akce exportu).
 *
 * Rozvin se počítá analyticky: základní plech = obrys skici, každý ohyb z hrany / lem přidá k obrysu obdélník
 * o délce BA + L (BA = π/180 · úhel · (R + K·t)), ohyb podle čáry jen přidá čáry ohybu. Panely (rovinné části plechu)
 * si pamatují svůj 3D rámec, aby šlo hranu vybranou v modelu najít a zobrazit ve 2D rozvinu.
 */
import { cross, norm, planeBasis, toWorld } from "../defaults";
import { arcPoints, circleFrom3, findLoops, pointInPolygon, type Loop, type Seg } from "../sketch";
import type { CadDoc, Feature, SketchEntity, SketchPlane, Vec2, Vec3 } from "../types";

export type SheetParams = { t: number; r: number; k: number };
export const DEFAULT_SHEET: SheetParams = { t: 2, r: 2, k: 0.44 };

/** Bend allowance (délka neutrální vrstvy v ohybu) – ISO/DIN praxe s K-faktorem. */
export const bendAllowance = (angleDeg: number, r: number, t: number, k: number) => (Math.PI / 180) * Math.abs(angleDeg) * (r + k * t);

export type ExtF = Extract<Feature, { type: "ext" }>;
const isSheet = (f: Feature, ext: string): f is ExtF => f.type === "ext" && f.ext === ext;
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** Parametry plechu platné pro prvek na indexu `index` (poslední Základní plech / Parametry plechu před ním). */
export function sheetParamsAt(doc: CadDoc, index: number): SheetParams {
  let p = { ...DEFAULT_SHEET };
  for (let i = 0; i < Math.min(index, doc.features.length); i++) {
    const f = doc.features[i];
    if (f.suppressed || f.type !== "ext") continue;
    if (f.ext === "sheet.base" || f.ext === "sheet.params") p = { t: num(f.data.t, p.t), r: num(f.data.r, p.r), k: num(f.data.k, p.k) };
  }
  return p;
}

/** Poloměr ohybu prvku (0 = výchozí z parametrů plechu). */
export const bendRadius = (data: Record<string, unknown>, p: SheetParams) => {
  const r = num(data.radius, 0);
  return r > 0 ? r : p.r;
};

export function baseFeatureIndex(doc: CadDoc, before = doc.features.length): number {
  for (let i = 0; i < Math.min(before, doc.features.length); i++) if (!doc.features[i].suppressed && isSheet(doc.features[i], "sheet.base")) return i;
  return -1;
}

// ---------------- geometrie panelů ----------------

type Affine2 = { o: Vec2; x: Vec2; y: Vec2 };
type Frame3 = { O: Vec3; X: Vec3; Y: Vec3; N: Vec3 };
type Region = { a: Vec2; w: Vec2; min?: number; max?: number };
type Panel = { id: string; frame: Frame3; toFlat: Affine2; regions: Region[] };

export type FlatBend = { n: number; feature: string; a: Vec2; b: Vec2; a2: Vec2; b2: Vec2; angle: number; radius: number; ba: number; dir: "up" | "down" };
export type FlatLayout = {
  outer: Seg[];
  holes: Seg[][];
  bends: FlatBend[];
  t: number;
  warnings: string[];
  basePlane: SketchPlane;
  baseDirection: "normal" | "reverse" | "symmetric";
  bbox: [Vec2, Vec2];
};
export type EdgeGeom = { a: Vec3; b: Vec3 };
/** Kdo umí určit hranu (featureIndex = index prvku ohybu, edgeIndex = index hrany v tělese před prvkem). */
export type EdgeResolver = (featureIndex: number, edgeIndex: number) => Promise<EdgeGeom | null> | EdgeGeom | null;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const d2 = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

const flatOf = (m: Affine2, p: Vec2): Vec2 => [m.o[0] + m.x[0] * p[0] + m.y[0] * p[1], m.o[1] + m.x[1] * p[0] + m.y[1] * p[1]];
const flatVec = (m: Affine2, v: Vec2): Vec2 => [m.x[0] * v[0] + m.y[0] * v[1], m.x[1] * v[0] + m.y[1] * v[1]];
/** inverzní převod směru z rozvinu do lokálních souřadnic panelu */
function localVec(m: Affine2, v: Vec2): Vec2 {
  const det = m.x[0] * m.y[1] - m.x[1] * m.y[0] || 1;
  return [(v[0] * m.y[1] - v[1] * m.y[0]) / det, (m.x[0] * v[1] - m.x[1] * v[0]) / det];
}
const det2 = (m: Affine2) => m.x[0] * m.y[1] - m.x[1] * m.y[0];
const local3 = (fr: Frame3, p: Vec3): Vec3 => {
  const d = sub(p, fr.O);
  return [dot(d, fr.X), dot(d, fr.Y), dot(d, fr.N)];
};
const world3 = (fr: Frame3, p: Vec2): Vec3 => add(fr.O, add(mul(fr.X, p[0]), mul(fr.Y, p[1])));
const unit2 = (v: Vec2): Vec2 => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};
/** Rodriguesova rotace vektoru kolem osy `u` o úhel (°) */
function rotVec(v: Vec3, u: Vec3, deg: number): Vec3 {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const uxv = cross(u, v);
  const k = dot(u, v) * (1 - c);
  return [v[0] * c + uxv[0] * s + u[0] * k, v[1] * c + uxv[1] * s + u[1] * k, v[2] * c + uxv[2] * s + u[2] * k];
}

/** Smyčky skici → segmenty (kružnice jako dva oblouky). */
export function loopSegs(l: Loop): Seg[] {
  if (l.kind === "segs") return l.segs.map((s) => ({ ...s }));
  const { cx, cy, r } = l;
  return [
    { kind: "arc", a: [cx + r, cy], m: [cx, cy + r], b: [cx - r, cy] },
    { kind: "arc", a: [cx - r, cy], m: [cx, cy - r], b: [cx + r, cy] },
  ];
}
export function segsPolygon(segs: Seg[]): Vec2[] {
  const pts: Vec2[] = [];
  for (const s of segs) {
    if (s.kind === "line") pts.push(s.a);
    else pts.push(...arcPoints(s.a, s.m, s.b, 12).slice(0, -1));
  }
  return pts;
}
export function polygonArea(p: Vec2[]) {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % p.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}
const mapSeg = (s: Seg, f: (p: Vec2) => Vec2): Seg => (s.kind === "line" ? { kind: "line", a: f(s.a), b: f(s.b) } : { kind: "arc", a: f(s.a), m: f(s.m), b: f(s.b) });

/** Skica → vnější obrys + díry (největší smyčka = obrys). */
export function sketchLoops(entities: SketchEntity[]): { outer: Seg[]; holes: Seg[][] } {
  const { loops } = findLoops(entities.filter((e) => !e.construction));
  if (!loops.length) throw new Error("Skica plechu neobsahuje uzavřený profil.");
  const ranked = loops.map((l) => ({ l, area: Math.abs(polygonArea(segsPolygon(loopSegs(l)))) })).sort((a, b) => b.area - a.area);
  return { outer: loopSegs(ranked[0].l), holes: ranked.slice(1).map((x) => loopSegs(x.l)) };
}

function lineEntity(entities: SketchEntity[]): [Vec2, Vec2] {
  for (const e of entities) {
    if (e.type === "line") return [e.a, e.b];
    if (e.type === "polyline" && e.points.length >= 2) return [e.points[0], e.points[1]];
  }
  throw new Error("Skica ohybu musí obsahovat úsečku (čáru ohybu).");
}

// ---------------- výpočet rozvinu ----------------

type Ctx = { doc: CadDoc; outer: Seg[]; holes: Seg[][]; bends: FlatBend[]; panels: Panel[]; warnings: string[]; t: number; tol: number };

function findPanel(ctx: Ctx, pts: Vec3[]): { panel: Panel; onTop: boolean } | null {
  for (let i = ctx.panels.length - 1; i >= 0; i--) {
    const p = ctx.panels[i];
    const ls = pts.map((q) => local3(p.frame, q));
    const top = ls.every((l) => Math.abs(l[2]) < ctx.tol);
    const bottom = ls.every((l) => Math.abs(l[2] + ctx.t) < ctx.tol);
    if (!top && !bottom) continue;
    const ok = ls.every((l) => {
      const fp = flatOf(p.toFlat, [l[0], l[1]]);
      return p.regions.every((rg) => {
        const v = rg.w[0] * (fp[0] - rg.a[0]) + rg.w[1] * (fp[1] - rg.a[1]);
        return (rg.min == null || v >= rg.min - ctx.tol) && (rg.max == null || v <= rg.max + ctx.tol);
      });
    });
    if (ok) return { panel: p, onTop: top };
  }
  return null;
}

/** Najde v obrysu rovný segment s danými koncovými body (v libovolném pořadí). */
function findSegment(outer: Seg[], a: Vec2, b: Vec2, tol: number): { index: number; reversed: boolean } | null {
  for (let i = 0; i < outer.length; i++) {
    const s = outer[i];
    if (s.kind !== "line") continue;
    if (d2(s.a, a) < tol && d2(s.b, b) < tol) return { index: i, reversed: false };
    if (d2(s.a, b) < tol && d2(s.b, a) < tol) return { index: i, reversed: true };
  }
  return null;
}

function outwardOf(outer: Seg[], a: Vec2, b: Vec2): Vec2 {
  const d = unit2([b[0] - a[0], b[1] - a[1]]);
  const perp: Vec2 = [-d[1], d[0]];
  const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const poly = segsPolygon(outer);
  const probe: Vec2 = [mid[0] + perp[0] * 0.05, mid[1] + perp[1] * 0.05];
  return pointInPolygon(probe, poly) ? [-perp[0], -perp[1]] : perp;
}

/**
 * Rozvin plechu z historie prvků (do indexu `upTo` výlučně). `resolve` dodá hranu (koncové body ve světě)
 * pro ohyb z hrany / lem – v jádře ze stavby tělesa, v UI z uložené geometrie.
 */
export async function flatLayout(doc: CadDoc, resolve: EdgeResolver, upTo = doc.features.length): Promise<FlatLayout> {
  const bi = baseFeatureIndex(doc, upTo);
  if (bi < 0) throw new Error("Nejdřív vytvořte Základní plech (karta Plech).");
  const base = doc.features[bi] as ExtF;
  const sk = doc.features.find((f) => f.id === base.data.sketchId && f.type === "sketch") as Extract<Feature, { type: "sketch" }> | undefined;
  if (!sk) throw new Error("Základní plech nemá přiřazenou skicu.");
  const params = sheetParamsAt(doc, bi + 1);
  const t = params.t;
  const { outer, holes } = sketchLoops(sk.entities);
  const dir = (base.data.direction as FlatLayout["baseDirection"]) ?? "normal";
  const pb = planeBasis(sk.plane);
  const topOffset = dir === "normal" ? t : dir === "symmetric" ? t / 2 : 0;
  const ctx: Ctx = {
    doc,
    outer,
    holes,
    bends: [],
    warnings: [],
    t,
    tol: 0.03,
    panels: [{ id: base.id, frame: { O: add(pb.origin, mul(pb.n, topOffset)), X: pb.x, Y: pb.y, N: pb.n }, toFlat: { o: [0, 0], x: [1, 0], y: [0, 1] }, regions: [] }],
  };

  for (let i = bi + 1; i < Math.min(upTo, doc.features.length); i++) {
    const f = doc.features[i];
    if (f.suppressed) continue;
    if (f.type === "sketch" || f.type === "datum") continue;
    if (f.type !== "ext" || !f.ext.startsWith("sheet.")) {
      ctx.warnings.push(`Prvek „${f.name}“ není plechový – v rozvinu je vynechán.`);
      continue;
    }
    const p = sheetParamsAt(doc, i);
    const data = f.data ?? {};
    switch (f.ext) {
      case "sheet.params":
      case "sheet.unfold":
        break;
      case "sheet.flange":
      case "sheet.hem": {
        const edges = (data.edges as number[] | undefined) ?? [];
        if (!edges.length) throw new Error(`${f.name}: není vybrána hrana.`);
        const hem = f.ext === "sheet.hem";
        const angle = hem ? 180 : num(data.angle, 90);
        const length = num(data.length, hem ? 10 : 20);
        const R = hem ? (data.kind === "closed" ? Math.max(0.05, 0.1 * t) : bendRadius(data, p)) : bendRadius(data, p);
        const ba = bendAllowance(angle, R, t, p.k);
        for (const ei of edges) {
          const eg = await resolve(i, ei);
          if (!eg) throw new Error(`${f.name}: hranu ohybu se nepodařilo určit – otevřete prvek a vyberte hranu znovu.`);
          const hit = findPanel(ctx, [eg.a, eg.b]);
          if (!hit) throw new Error(`${f.name}: hrana neleží na rovné ploše plechu.`);
          const { panel, onTop } = hit;
          const la = local3(panel.frame, eg.a);
          const lb = local3(panel.frame, eg.b);
          const fa = flatOf(panel.toFlat, [la[0], la[1]]);
          const fb = flatOf(panel.toFlat, [lb[0], lb[1]]);
          const seg = findSegment(ctx.outer, fa, fb, Math.max(ctx.tol * 2, 0.05));
          if (!seg) throw new Error(`${f.name}: ohyb lze založit jen na celé rovné hraně obrysu plechu (ne na oblouku ani části hrany).`);
          const s = ctx.outer[seg.index] as Extract<Seg, { kind: "line" }>;
          // přesné body obrysu
          const A: Vec2 = seg.reversed ? s.b : s.a;
          const B: Vec2 = seg.reversed ? s.a : s.b;
          const w2 = outwardOf(ctx.outer, A, B);
          const Lw = ba + length;
          const far = (q: Vec2): Vec2 => [q[0] + w2[0] * Lw, q[1] + w2[1] * Lw];
          const bend2 = (q: Vec2): Vec2 => [q[0] + w2[0] * ba, q[1] + w2[1] * ba];
          const sa = s.a;
          const sb = s.b;
          const rect: Seg[] = [
            { kind: "line", a: sa, b: far(sa) },
            { kind: "line", a: far(sa), b: far(sb) },
            { kind: "line", a: far(sb), b: sb },
          ];
          ctx.outer.splice(seg.index, 1, ...rect);
          // směr ohybu z pohledu rozvinu (shora na základní plech)
          const flip = !!data.flip;
          const nSign = (onTop ? 1 : -1) * (flip ? -1 : 1) * (det2(panel.toFlat) < 0 ? -1 : 1);
          ctx.bends.push({ n: ctx.bends.length + 1, feature: f.id, a: A, b: B, a2: bend2(A), b2: bend2(B), angle, radius: R, ba, dir: nSign > 0 ? "up" : "down" });
          // nový panel (ohnutá část) – 3D rámec
          const nEff = mul(panel.frame.N, (onTop ? 1 : -1) * (flip ? -1 : 1));
          const wl = localVec(panel.toFlat, w2);
          const wW = norm(add(mul(panel.frame.X, wl[0]), mul(panel.frame.Y, wl[1])));
          const uW = norm(cross(wW, nEff));
          const s0 = dot(eg.a, uW) <= dot(eg.b, uW) ? eg.a : eg.b;
          const s0f = s0 === eg.a ? fa : fb;
          const otherF = s0 === eg.a ? fb : fa;
          const lz = local3(panel.frame, s0)[2];
          const s0top = sub(s0, mul(panel.frame.N, lz));
          const innerOrigin = dot(nEff, panel.frame.N) > 0 ? s0top : sub(s0top, mul(panel.frame.N, t));
          const c = add(innerOrigin, mul(nEff, R));
          const ar = (angle * Math.PI) / 180;
          const dW: Vec3 = add(mul(wW, Math.cos(ar)), mul(nEff, Math.sin(ar)));
          const arcEnd = add(c, mul(sub(mul(wW, Math.sin(ar)), mul(nEff, Math.cos(ar))), R));
          const NF: Vec3 = sub(mul(nEff, Math.cos(ar)), mul(wW, Math.sin(ar)));
          const u2f = unit2([otherF[0] - s0f[0], otherF[1] - s0f[1]]);
          const L = d2(fa, fb);
          const o2: Vec2 = [s0f[0] + w2[0] * ba, s0f[1] + w2[1] * ba];
          ctx.panels.push({
            id: `${f.id}:${ei}`,
            frame: { O: arcEnd, X: uW, Y: dW, N: NF },
            toFlat: { o: o2, x: u2f, y: w2 },
            regions: [
              { a: o2, w: u2f, min: 0, max: L },
              { a: o2, w: w2, min: 0, max: length },
            ],
          });
        }
        break;
      }
      case "sheet.bend": {
        const bsk = doc.features.find((x) => x.id === data.sketchId && x.type === "sketch") as Extract<Feature, { type: "sketch" }> | undefined;
        if (!bsk) throw new Error(`${f.name}: vyberte skicu s čárou ohybu.`);
        const [q0, q1] = lineEntity(bsk.entities);
        const p0 = toWorld(bsk.plane, q0);
        const p1 = toWorld(bsk.plane, q1);
        const hit = findPanel(ctx, [p0, p1]);
        if (!hit) throw new Error(`${f.name}: čára ohybu musí ležet na ploše plechu (skica na ploše nebo rovině plechu).`);
        const { panel, onTop } = hit;
        const l0 = local3(panel.frame, p0);
        const l1 = local3(panel.frame, p1);
        const A = flatOf(panel.toFlat, [l0[0], l0[1]]);
        const B = flatOf(panel.toFlat, [l1[0], l1[1]]);
        const dAB = unit2([B[0] - A[0], B[1] - A[1]]);
        const left: Vec2 = [-dAB[1], dAB[0]];
        const w2: Vec2 = data.side === "right" ? [-left[0], -left[1]] : left;
        const angle = num(data.angle, 90);
        const R = bendRadius(data, p);
        const ba = bendAllowance(angle, R, t, p.k);
        const down = data.direction === "down";
        const nSign = (onTop ? 1 : -1) * (down ? -1 : 1) * (det2(panel.toFlat) < 0 ? -1 : 1);
        ctx.bends.push({ n: ctx.bends.length + 1, feature: f.id, a: A, b: B, a2: [A[0] + w2[0] * ba, A[1] + w2[1] * ba], b2: [B[0] + w2[0] * ba, B[1] + w2[1] * ba], angle, radius: R, ba, dir: nSign > 0 ? "up" : "down" });
        // panely: pevná část (w ≤ 0) a pohyblivá (w ≥ BA) s otočeným rámcem
        const nEff = mul(panel.frame.N, (onTop ? 1 : -1) * (down ? -1 : 1));
        const wl = localVec(panel.toFlat, w2);
        const wW = norm(add(mul(panel.frame.X, wl[0]), mul(panel.frame.Y, wl[1])));
        const uW = norm(cross(wW, nEff));
        const lz = l0[2];
        const p0top = sub(p0, mul(panel.frame.N, lz));
        const innerOrigin = dot(nEff, panel.frame.N) > 0 ? p0top : sub(p0top, mul(panel.frame.N, t));
        const c = add(innerOrigin, mul(nEff, R));
        const rotP = (q: Vec3) => add(c, rotVec(sub(q, c), uW, angle));
        const O2 = rotP(sub(panel.frame.O, mul(wW, ba)));
        const moving: Panel = {
          id: `${f.id}:m`,
          frame: { O: O2, X: rotVec(panel.frame.X, uW, angle), Y: rotVec(panel.frame.Y, uW, angle), N: rotVec(panel.frame.N, uW, angle) },
          toFlat: panel.toFlat,
          regions: [...panel.regions, { a: A, w: w2, min: ba }],
        };
        panel.regions = [...panel.regions, { a: A, w: w2, max: 0 }];
        ctx.panels.push(moving);
        break;
      }
      case "sheet.cut": {
        const csk = doc.features.find((x) => x.id === data.sketchId && x.type === "sketch") as Extract<Feature, { type: "sketch" }> | undefined;
        if (!csk) {
          ctx.warnings.push(`${f.name}: bez skici – vynechán.`);
          break;
        }
        const { loops } = findLoops(csk.entities.filter((e) => !e.construction));
        for (const l of loops) {
          const segs = loopSegs(l);
          const pts = segsPolygon(segs).slice(0, 3).map((q) => toWorld(csk.plane, q));
          const hit = findPanel(ctx, pts);
          if (!hit) {
            ctx.warnings.push(`${f.name}: výřez neleží na rovné ploše plechu – v rozvinu vynechán.`);
            continue;
          }
          const m = (q: Vec2): Vec2 => {
            const l3 = local3(hit.panel.frame, toWorld(csk.plane, q));
            return flatOf(hit.panel.toFlat, [l3[0], l3[1]]);
          };
          const hole = segs.map((s) => mapSeg(s, m));
          const poly = segsPolygon(ctx.outer);
          if (!segsPolygon(hole).every((q) => pointInPolygon(q, poly))) ctx.warnings.push(`${f.name}: výřez zasahuje mimo obrys – v rozvinu je zobrazen jako samostatná křivka.`);
          ctx.holes.push(hole);
        }
        break;
      }
      case "sheet.relief": {
        const pt = data.point as Vec3 | undefined;
        if (!pt) break;
        const hit = findPanel(ctx, [pt]);
        if (!hit) {
          ctx.warnings.push(`${f.name}: bod úlevy neleží na plechu – vynechán.`);
          break;
        }
        const l3 = local3(hit.panel.frame, pt);
        const cpt = flatOf(hit.panel.toFlat, [l3[0], l3[1]]);
        const sz = num(data.size, 4);
        if (data.kind === "round") ctx.holes.push(loopSegs({ kind: "circle", cx: cpt[0], cy: cpt[1], r: sz / 2, sourceIds: [] }));
        else {
          const h = sz / 2;
          const q = (dx: number, dy: number): Vec2 => [cpt[0] + dx, cpt[1] + dy];
          ctx.holes.push([
            { kind: "line", a: q(-h, -h), b: q(h, -h) },
            { kind: "line", a: q(h, -h), b: q(h, h) },
            { kind: "line", a: q(h, h), b: q(-h, h) },
            { kind: "line", a: q(-h, h), b: q(-h, -h) },
          ]);
        }
        break;
      }
      case "sheet.rib":
        ctx.warnings.push(`${f.name}: prolis se v rozvinu nezobrazuje (tvářený prvek).`);
        break;
      default:
        ctx.warnings.push(`${f.name}: neznámý plechový prvek – vynechán.`);
    }
  }
  const all = [...segsPolygon(ctx.outer), ...ctx.holes.flatMap(segsPolygon)];
  const bbox: [Vec2, Vec2] = all.length ? [[Math.min(...all.map((p) => p[0])), Math.min(...all.map((p) => p[1]))], [Math.max(...all.map((p) => p[0])), Math.max(...all.map((p) => p[1]))]] : [[0, 0], [0, 0]];
  return { outer: ctx.outer, holes: ctx.holes, bends: ctx.bends, t, warnings: ctx.warnings, basePlane: sk.plane, baseDirection: dir, bbox };
}

// ---------------- DXF / SVG / tabulka ----------------

const fmt = (n: number) => (Math.round(n * 100) / 100).toString();
const fmtCs = (n: number) => (Math.round(n * 100) / 100).toLocaleString("cs-CZ");

function arcParams(s: Extract<Seg, { kind: "arc" }>): { c: Vec2; r: number; start: number; end: number } | null {
  const circ = circleFrom3(s.a, s.m, s.b);
  if (!circ) return null;
  const ang = (p: Vec2) => (Math.atan2(p[1] - circ.c[1], p[0] - circ.c[0]) * 180) / Math.PI;
  const ccw = (s.m[0] - s.a[0]) * (s.b[1] - s.a[1]) - (s.m[1] - s.a[1]) * (s.b[0] - s.a[0]) > 0;
  return ccw ? { c: circ.c, r: circ.r, start: ang(s.a), end: ang(s.b) } : { c: circ.c, r: circ.r, start: ang(s.b), end: ang(s.a) };
}

/** DXF R12 rozvinu: OBRYS (obrys + díry), OHYBY (osy ohybů, čerchovaně), OHYBY_ZONA (hranice ohybu, čárkovaně), TEXT. */
export function flatToDxf(l: FlatLayout, name = "Rozvin"): string {
  const o: string[] = [];
  const add = (...kv: (string | number)[]) => o.push(...kv.map(String));
  const f = (n: number) => (Math.round(n * 1e4) / 1e4).toString();
  add(0, "SECTION", 2, "HEADER", 9, "$ACADVER", 1, "AC1009", 9, "$INSUNITS", 70, 4, 0, "ENDSEC");
  add(0, "SECTION", 2, "TABLES");
  add(0, "TABLE", 2, "LTYPE", 70, 3);
  add(0, "LTYPE", 2, "CONTINUOUS", 70, 0, 3, "Solid line", 72, 65, 73, 0, 40, 0);
  add(0, "LTYPE", 2, "CENTER", 70, 0, 3, "Center ____ _ ____ _", 72, 65, 73, 4, 40, 50.8, 49, 31.75, 49, -6.35, 49, 6.35, 49, -6.35);
  add(0, "LTYPE", 2, "HIDDEN", 70, 0, 3, "Hidden __ __ __", 72, 65, 73, 2, 40, 9.525, 49, 6.35, 49, -3.175);
  add(0, "ENDTAB");
  add(0, "TABLE", 2, "LAYER", 70, 4);
  for (const [nm, col, lt] of [["OBRYS", 7, "CONTINUOUS"], ["OHYBY", 1, "CENTER"], ["OHYBY_ZONA", 8, "HIDDEN"], ["TEXT", 7, "CONTINUOUS"]] as const) add(0, "LAYER", 2, nm, 70, 0, 62, col, 6, lt);
  add(0, "ENDTAB", 0, "ENDSEC", 0, "SECTION", 2, "ENTITIES");
  const seg = (s: Seg, layer: string) => {
    if (s.kind === "line") add(0, "LINE", 8, layer, 10, f(s.a[0]), 20, f(s.a[1]), 30, 0, 11, f(s.b[0]), 21, f(s.b[1]), 31, 0);
    else {
      const ap = arcParams(s);
      if (!ap) return;
      add(0, "ARC", 8, layer, 10, f(ap.c[0]), 20, f(ap.c[1]), 30, 0, 40, f(ap.r), 50, f(ap.start), 51, f(ap.end));
    }
  };
  for (const s of l.outer) seg(s, "OBRYS");
  for (const h of l.holes) for (const s of h) seg(s, "OBRYS");
  const text = (x: number, y: number, h: number, s: string, layer = "TEXT") => add(0, "TEXT", 8, layer, 10, f(x), 20, f(y), 30, 0, 40, f(h), 1, s.replace(/°/g, "%%d"));
  for (const b of l.bends) {
    const m: Vec2 = [(b.a[0] + b.a2[0]) / 2, (b.a[1] + b.a2[1]) / 2];
    const m2: Vec2 = [(b.b[0] + b.b2[0]) / 2, (b.b[1] + b.b2[1]) / 2];
    add(0, "LINE", 8, "OHYBY", 10, f(m[0]), 20, f(m[1]), 30, 0, 11, f(m2[0]), 21, f(m2[1]), 31, 0);
    add(0, "LINE", 8, "OHYBY_ZONA", 10, f(b.a[0]), 20, f(b.a[1]), 30, 0, 11, f(b.b[0]), 21, f(b.b[1]), 31, 0);
    add(0, "LINE", 8, "OHYBY_ZONA", 10, f(b.a2[0]), 20, f(b.a2[1]), 30, 0, 11, f(b.b2[0]), 21, f(b.b2[1]), 31, 0);
    const mid: Vec2 = [(m[0] + m2[0]) / 2, (m[1] + m2[1]) / 2];
    text(mid[0] + 1, mid[1] + 1, Math.max(1.5, Math.min(3.5, l.t * 1.2)), `${b.n}: ${fmt(b.angle)}° ${b.dir === "up" ? "NAHORU" : "DOLU"} R${fmt(b.radius)}`, "OHYBY");
  }
  // tabulka ohybů pod rozvinem
  const h = Math.max(2, Math.min(4, l.t * 1.5));
  let y = l.bbox[0][1] - 4 * h;
  const x = l.bbox[0][0];
  text(x, y, h, `${name} - rozvin, plech t=${fmt(l.t)} mm`);
  for (const b of l.bends) {
    y -= 1.6 * h;
    text(x, y, h, `Ohyb ${b.n}: ${fmt(b.angle)}° ${b.dir === "up" ? "nahoru" : "dolu"}, R${fmt(b.radius)}, BA ${fmt(b.ba)} mm`);
  }
  add(0, "ENDSEC", 0, "EOF");
  return o.join("\n") + "\n";
}

export function flatToSvg(l: FlatLayout, name = "Rozvin"): string {
  const [[x0, y0], [x1, y1]] = l.bbox;
  const M = 12;
  const W = x1 - x0 + 2 * M;
  const H = y1 - y0 + 2 * M + 8 * (l.bends.length + 1);
  const X = (x: number) => (x - x0 + M).toFixed(3);
  const Y = (y: number) => (y1 - y + M).toFixed(3);
  const path = (segs: Seg[]) => {
    let d = "";
    segs.forEach((s, i) => {
      if (i === 0) d += `M${X(s.a[0])} ${Y(s.a[1])}`;
      if (s.kind === "line") d += ` L${X(s.b[0])} ${Y(s.b[1])}`;
      else {
        const ap = arcParams(s);
        if (!ap) return;
        const ccw = (s.m[0] - s.a[0]) * (s.b[1] - s.a[1]) - (s.m[1] - s.a[1]) * (s.b[0] - s.a[0]) > 0;
        const sweep = ((ap.end - ap.start + 360) % 360) > 180 ? 1 : 0;
        d += ` A${ap.r.toFixed(3)} ${ap.r.toFixed(3)} 0 ${sweep} ${ccw ? 0 : 1} ${X(s.b[0])} ${Y(s.b[1])}`;
      }
    });
    return d + " Z";
  };
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  const parts: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" font-family="Roboto, Arial, sans-serif"><rect width="${W}" height="${H}" fill="#fff"/>`];
  parts.push(`<path d="${path(l.outer)}" fill="none" stroke="#111" stroke-width="0.5"/>`);
  for (const h of l.holes) parts.push(`<path d="${path(h)}" fill="none" stroke="#111" stroke-width="0.5"/>`);
  for (const b of l.bends) {
    const m: Vec2 = [(b.a[0] + b.a2[0]) / 2, (b.a[1] + b.a2[1]) / 2];
    const m2: Vec2 = [(b.b[0] + b.b2[0]) / 2, (b.b[1] + b.b2[1]) / 2];
    parts.push(`<line x1="${X(m[0])}" y1="${Y(m[1])}" x2="${X(m2[0])}" y2="${Y(m2[1])}" stroke="#E03930" stroke-width="0.35" stroke-dasharray="6 1.5 1 1.5"/>`);
    parts.push(`<line x1="${X(b.a[0])}" y1="${Y(b.a[1])}" x2="${X(b.b[0])}" y2="${Y(b.b[1])}" stroke="#777" stroke-width="0.2" stroke-dasharray="2 1"/>`);
    parts.push(`<line x1="${X(b.a2[0])}" y1="${Y(b.a2[1])}" x2="${X(b.b2[0])}" y2="${Y(b.b2[1])}" stroke="#777" stroke-width="0.2" stroke-dasharray="2 1"/>`);
    parts.push(`<text x="${X((m[0] + m2[0]) / 2)}" y="${Y((m[1] + m2[1]) / 2)}" font-size="3" fill="#E03930">${b.n}: ${fmtCs(b.angle)}° ${b.dir === "up" ? "▲" : "▼"} R${fmtCs(b.radius)}</text>`);
  }
  let ty = y1 - y0 + 2 * M + 2;
  parts.push(`<text x="${M}" y="${ty}" font-size="4" font-weight="700">${esc(name)} – rozvin · t = ${fmtCs(l.t)} mm</text>`);
  for (const b of l.bends) {
    ty += 6;
    parts.push(`<text x="${M}" y="${ty}" font-size="3.2">Ohyb ${b.n}: ${fmtCs(b.angle)}° ${b.dir === "up" ? "nahoru" : "dolů"}, R ${fmtCs(b.radius)}, BA ${fmtCs(b.ba)} mm</text>`);
  }
  parts.push("</svg>");
  return parts.join("");
}

export function bendTable(l: FlatLayout): string {
  const [[x0, y0], [x1, y1]] = l.bbox;
  const lines = [`Rozvin: ${fmtCs(x1 - x0)} × ${fmtCs(y1 - y0)} mm · tloušťka ${fmtCs(l.t)} mm · ${l.bends.length} ohybů`, ""];
  if (!l.bends.length) lines.push("Žádné ohyby – díl je rovný plech.");
  for (const b of l.bends) lines.push(`Ohyb ${b.n}: úhel ${fmtCs(b.angle)}°, ${b.dir === "up" ? "nahoru" : "dolů"}, vnitřní R ${fmtCs(b.radius)} mm, délka osy ${fmtCs(d2(b.a, b.b))} mm, BA ${fmtCs(b.ba)} mm`);
  if (l.warnings.length) lines.push("", ...l.warnings.map((w) => "⚠ " + w));
  return lines.join("\n");
}
