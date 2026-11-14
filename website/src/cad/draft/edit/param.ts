/**
 * BALÍK 1 (edit) – parametrický popis entit pro ořezávání, prodlužování, přerušení, prodloužení délky, dělení
 * a pole po dráze. Vlastní tabulka podle `e.type` (smlouva: „rozdělit entitu v parametru“ dělá balík sám pro druhy
 * jádra; jiné druhy se nejdřív rozloží).
 *
 * Parametr u: úsečka 0…1, přímka / polopřímka = vzdálenost od bodu, oblouk / kružnice = úhel od počátku [rad],
 * elipsa = parametr t [rad], křivka = index úseku + podíl (0…počet úseků), spline = uzlový parametr.
 */
import { cClosest, cDeriv, cPoint, type Curve } from "../curves";
import { add, angleOf, bulgeArc, deg, dist, dot, len, lerp, mul, normA, polar, rad, rot90, sub, TAU, unit } from "../geom";
import { entityCurves, type KindCtx } from "../kinds";
import type { DArc, DCircle, DEllipse, DLine, DPolyline, DRay, DSpline, DXLine, DraftEntity, NewEntity, Vec2 } from "../model";
import { normDeg } from "../units";
import { asCurve, joinNurbs, nurbsLen, nurbsRange, paramAtLen, subNurbs, toBeziers, type Nurbs } from "./nurbs";
import { tolAt } from "./tol";

export type EC = {
  type: string;
  lo: number;
  hi: number;
  /** uzavřená (kružnice, celá elipsa, uzavřená křivka / spline) – parametr se opakuje s periodou hi − lo */
  periodic: boolean;
  /** lze prodloužit za konce (úsečka, oblouk, krajní úseky křivky, eliptický oblouk) */
  extendable: boolean;
  at(u: number): Vec2;
  /** jednotková tečna ve směru rostoucího u */
  tan(u: number): Vec2;
  /** parametr nejbližšího bodu (u úsečky a oblouku i mimo rozsah – prodloužení) */
  param(p: Vec2): number;
  /** parametr bodu ležícího na křivce výpočtu `ci` (pořadí entityCurves) */
  paramOn(ci: number, p: Vec2): number;
  /** geometrie části mezi u0 < u1 (u periodické smí u1 přesáhnout hi – přes počátek) */
  piece(u0: number, u1: number): NewEntity | null;
  /** délka mezi u0 < u1 */
  len(u0: number, u1: number): number;
  /** parametr ve vzdálenosti s od u0 (vpřed) */
  atLen(u0: number, s: number): number;
};

const geomOnly = <T extends object>(o: T) => o as unknown as NewEntity;

type NurbsCurve = Extract<Curve, { k: "nurbs" }>;
type BezSeg = { c: NurbsCurve; box: [number, number, number, number] };
const BEZ = new WeakMap<object, { deg: number; knots: number[]; w?: number[]; segs: BezSeg[] }>();
/** Bézierovy úseky NURBS křivky s obálkou řídicích bodů (mezipaměť podle pole řídicích bodů, ověří stupeň, uzly, váhy) */
function bezSegs(c: NurbsCurve): BezSeg[] {
  const hit = BEZ.get(c.ctrl);
  if (hit && hit.deg === c.deg && hit.knots === c.knots && hit.w === c.w) return hit.segs;
  const N: Nurbs = { deg: c.deg, ctrl: c.ctrl, knots: c.knots, ...(c.w ? { w: c.w } : {}) };
  const segs = toBeziers(N).map((b) => {
    const xs = b.ctrl.map((q) => q[0]);
    const ys = b.ctrl.map((q) => q[1]);
    return { c: asCurve(b), box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as [number, number, number, number] };
  });
  BEZ.set(c.ctrl, { deg: c.deg, knots: c.knots, w: c.w, segs });
  return segs;
}

/**
 * Nejbližší bod křivky. U NURBS po Bézierových úsecích: `cClosest` jádra vzorkuje celou křivku a Newtonem může
 * uvíznout v ostrém zlomu (násobný uzel – např. SPOJIT úseček se splajnem), protože derivace se tam láme; v rámci
 * jednoho Bézierova úseku je křivka hladká. Úseky, jejichž obálka řídicích bodů je dál než dosud nejlepší bod, se přeskočí.
 */
export function closestOn(c: Curve, p: Vec2): { t: number; p: Vec2; d: number } {
  if (c.k !== "nurbs") return cClosest(c, p);
  const segs = bezSegs(c);
  if (segs.length <= 1) return cClosest(c, p);
  const boxD = (b: [number, number, number, number]) => Math.hypot(Math.max(b[0] - p[0], 0, p[0] - b[2]), Math.max(b[1] - p[1], 0, p[1] - b[3]));
  const order = segs.map((s, i) => ({ i, d: boxD(s.box) })).sort((a, b) => a.d - b.d);
  let best: { t: number; p: Vec2; d: number } | null = null;
  for (const o of order) {
    if (best && o.d > best.d) break;
    const r = cClosest(segs[o.i].c, p);
    if (!best || r.d < best.d) best = r;
  }
  return best!;
}

function lineEC(e: DLine): EC {
  const d = sub(e.b, e.a);
  const L2 = dot(d, d) || 1;
  const L = Math.sqrt(L2);
  const at = (u: number): Vec2 => (u === 0 ? e.a : u === 1 ? e.b : lerp(e.a, e.b, u));
  return {
    type: "line",
    lo: 0,
    hi: 1,
    periodic: false,
    extendable: true,
    at,
    tan: () => unit(d),
    param: (p) => dot(sub(p, e.a), d) / L2,
    paramOn: (_ci, p) => dot(sub(p, e.a), d) / L2,
    piece: (u0, u1) => geomOnly({ type: "line", a: at(u0), b: at(u1) }),
    len: (u0, u1) => L * (u1 - u0),
    atLen: (u0, s) => u0 + s / L,
  };
}

function infEC(e: DXLine | DRay): EC {
  const dir = unit(e.dir);
  const at = (u: number): Vec2 => (u === 0 ? e.p : add(e.p, mul(dir, u)));
  const xl = e.type === "xline";
  return {
    type: e.type,
    lo: xl ? -Infinity : 0,
    hi: Infinity,
    periodic: false,
    extendable: false,
    at,
    tan: () => dir,
    param: (p) => dot(sub(p, e.p), dir),
    paramOn: (_ci, p) => dot(sub(p, e.p), dir),
    piece: (u0, u1) => {
      if (Number.isFinite(u0) && Number.isFinite(u1)) return geomOnly({ type: "line", a: at(u0), b: at(u1) });
      if (!Number.isFinite(u0) && Number.isFinite(u1)) return geomOnly({ type: "ray", p: at(u1), dir: mul(dir, -1) });
      if (Number.isFinite(u0)) return geomOnly({ type: "ray", p: at(u0), dir });
      return geomOnly({ type: "xline", p: e.p, dir });
    },
    len: (u0, u1) => u1 - u0,
    atLen: (u0, s) => u0 + s,
  };
}

/** úhel bodu relativně k počátku a0 s volbou „před počátkem“ pro body za koncem oblouku */
function arcParamOf(c: Vec2, A0: number, S: number, p: Vec2): number {
  const t = normA(angleOf(sub(p, c)) - A0);
  if (t > S + 1e-12 && t - S > TAU - t) return t - TAU;
  return t;
}

function circleEC(e: DCircle): EC {
  const at = (u: number) => polar(e.c, u, e.r);
  return {
    type: "circle",
    lo: 0,
    hi: TAU,
    periodic: true,
    extendable: false,
    at,
    tan: (u) => [-Math.sin(u), Math.cos(u)],
    param: (p) => normA(angleOf(sub(p, e.c))),
    paramOn: (_ci, p) => normA(angleOf(sub(p, e.c))),
    piece: (u0, u1) => (u1 - u0 >= TAU - 1e-12 ? geomOnly({ type: "circle", c: e.c, r: e.r }) : geomOnly({ type: "arc", c: e.c, r: e.r, a0: normDeg(deg(u0)), a1: normDeg(deg(u1)) })),
    len: (u0, u1) => e.r * (u1 - u0),
    atLen: (u0, s) => u0 + s / e.r,
  };
}

function arcEC(e: DArc): EC {
  const A0 = normA(rad(e.a0));
  let S = rad(normDeg(e.a1 - e.a0));
  if (S < 1e-12) S = TAU;
  const at = (u: number) => polar(e.c, A0 + u, e.r);
  return {
    type: "arc",
    lo: 0,
    hi: S,
    periodic: false,
    extendable: true,
    at,
    tan: (u) => [-Math.sin(A0 + u), Math.cos(A0 + u)],
    param: (p) => arcParamOf(e.c, A0, S, p),
    paramOn: (_ci, p) => arcParamOf(e.c, A0, S, p),
    piece: (u0, u1) => {
      if (u1 - u0 >= TAU - 1e-12) return geomOnly({ type: "circle", c: e.c, r: e.r });
      const a0 = Math.abs(u0) < 1e-15 ? e.a0 : normDeg(deg(A0 + u0));
      const a1 = Math.abs(u1 - S) < 1e-15 ? e.a1 : normDeg(deg(A0 + u1));
      return geomOnly({ type: "arc", c: e.c, r: e.r, a0, a1 });
    },
    len: (u0, u1) => e.r * (u1 - u0),
    atLen: (u0, s) => u0 + s / e.r,
  };
}

function ellipseEC(e: DEllipse): EC {
  const U = e.major;
  const V = mul(rot90(e.major), e.ratio);
  const full = (e.t0 === undefined && e.t1 === undefined) || Math.abs(normDeg((e.t1 ?? 360) - (e.t0 ?? 0))) < 1e-12;
  const T0 = rad(e.t0 ?? 0);
  let S = rad(normDeg((e.t1 ?? 360) - (e.t0 ?? 0)));
  if (full || S < 1e-12) S = TAU;
  const at = (t: number): Vec2 => [e.c[0] + U[0] * Math.cos(t) + V[0] * Math.sin(t), e.c[1] + U[1] * Math.cos(t) + V[1] * Math.sin(t)];
  const der = (t: number): Vec2 => [-U[0] * Math.sin(t) + V[0] * Math.cos(t), -U[1] * Math.sin(t) + V[1] * Math.cos(t)];
  const speed = (t: number) => len(der(t));
  // nejbližší bod (Newton na celé elipse) – u bodu na elipse přesně jeho parametr
  const fullC: Curve = { k: "ell", c: e.c, u: U, v: V, t0: T0, t1: T0 + TAU };
  const raw = (p: Vec2) => cClosest(fullC, p).t;
  const param = (p: Vec2) => {
    const t = normA(raw(p) - T0);
    if (full) return T0 + t;
    if (t > S + 1e-12 && t - S > TAU - t) return T0 + t - TAU;
    return T0 + t;
  };
  const lenFn = (a: number, b: number) => {
    let s = 0;
    const n = Math.max(1, Math.ceil((b - a) / (Math.PI / 8)));
    for (let i = 0; i < n; i++) s += gauss(speed, a + ((b - a) * i) / n, a + ((b - a) * (i + 1)) / n);
    return s;
  };
  return {
    type: "ellipse",
    lo: T0,
    hi: T0 + S,
    periodic: full,
    extendable: !full,
    at,
    tan: (t) => unit(der(t)),
    param,
    paramOn: (_ci, p) => param(p),
    piece: (u0, u1) => {
      if (u1 - u0 >= TAU - 1e-12) return geomOnly({ type: "ellipse", c: e.c, major: e.major, ratio: e.ratio });
      return geomOnly({ type: "ellipse", c: e.c, major: e.major, ratio: e.ratio, t0: normDeg(deg(u0)), t1: normDeg(deg(u1)) });
    },
    len: lenFn,
    atLen: (u0, s) => paramAtLen(lenFn, speed, u0, u0 + TAU * 2, s),
  };
}

/** Gauss-Legendre 8 bodů na intervalu */
const GL: [number, number][] = [
  [-0.960289856497536, 0.10122853629037626],
  [-0.796666477413627, 0.22238103445337448],
  [-0.525532409916329, 0.31370664587788727],
  [-0.18343464249565, 0.362683783378362],
  [0.18343464249565, 0.362683783378362],
  [0.525532409916329, 0.31370664587788727],
  [0.796666477413627, 0.22238103445337448],
  [0.960289856497536, 0.10122853629037626],
];
function gauss(f: (t: number) => number, a: number, b: number): number {
  const h = (b - a) / 2;
  const m = (a + b) / 2;
  let s = 0;
  for (const [x, w] of GL) s += w * f(m + h * x);
  return s * h;
}

type PSeg = { a: Vec2; b: Vec2; bulge: number; arc: { c: Vec2; r: number; a0: number; sweep: number } | null; L: number; w: [number, number] };

function polySegs(e: DPolyline): PSeg[] {
  const n = e.pts.length;
  const cnt = e.closed ? n : n - 1;
  const out: PSeg[] = [];
  for (let i = 0; i < cnt; i++) {
    const a = e.pts[i];
    const b = e.pts[(i + 1) % n];
    const bu = e.bulges?.[i] ?? 0;
    const arc = Math.abs(bu) > 1e-12 && dist(a, b) > 1e-12 ? bulgeArc(a, b, bu) : null;
    const w = e.widths?.[i] ?? [e.width ?? 0, e.width ?? 0];
    out.push({ a, b, bulge: arc ? bu : 0, arc, L: arc ? arc.r * Math.abs(arc.sweep) : dist(a, b), w: [w[0], w[1]] });
  }
  return out;
}

const segAt = (s: PSeg, f: number): Vec2 => (f === 0 ? s.a : f === 1 ? s.b : s.arc ? polar(s.arc.c, s.arc.a0 + s.arc.sweep * f, s.arc.r) : lerp(s.a, s.b, f));
function segParam(s: PSeg, p: Vec2, clamp: boolean): number {
  let f: number;
  if (s.arc) {
    const ang = angleOf(sub(p, s.arc.c));
    const sw = s.arc.sweep;
    let d = sw > 0 ? normA(ang - s.arc.a0) : normA(s.arc.a0 - ang);
    const S = Math.abs(sw);
    if (d > S + 1e-12 && d - S > TAU - d) d -= TAU;
    f = d / S;
  } else {
    const d = sub(s.b, s.a);
    f = dot(sub(p, s.a), d) / (dot(d, d) || 1);
  }
  return clamp ? Math.max(0, Math.min(1, f)) : f;
}

function polylineEC(e: DPolyline, ctx: KindCtx): EC {
  const segs = polySegs(e);
  const S = segs.length;
  const closed = !!e.closed;
  const curves = entityCurves(e, ctx);
  const split = (u: number): [number, number] => {
    if (closed) u = ((u % S) + S) % S;
    let i = Math.floor(u + 1e-12);
    if (i >= S) i = S - 1;
    if (i < 0) i = 0;
    let f = u - i;
    if (Math.abs(f) < 1e-12) f = 0;
    if (Math.abs(f - 1) < 1e-12) f = 1;
    return [i, f];
  };
  const at = (u: number) => {
    const [i, f] = split(u);
    return segAt(segs[i], f);
  };
  const tan = (u: number): Vec2 => {
    const [i, f] = split(u);
    const s = segs[i];
    if (!s.arc) return unit(sub(s.b, s.a));
    const r = unit(sub(segAt(s, f), s.arc.c));
    return s.arc.sweep > 0 ? rot90(r) : mul(rot90(r), -1);
  };
  const param = (p: Vec2) => {
    let best = 0;
    let bd = Infinity;
    segs.forEach((s, i) => {
      if (s.L < 1e-15) return;
      const f = segParam(s, p, true);
      const d = dist(segAt(s, f), p);
      if (d < bd) {
        bd = d;
        best = i + f;
      }
    });
    return best;
  };
  const segLen = (i: number, f0: number, f1: number) => segs[i].L * (f1 - f0);
  const lenFn = (u0: number, u1: number) => {
    let s = 0;
    let u = u0;
    let guard = 0;
    while (u < u1 - 1e-12 && guard++ < 4 * S + 8) {
      const k = Math.floor(u + 1e-12);
      const nu = Math.min(k + 1, u1);
      const [i, f0] = split(u);
      const f1 = f0 + (nu - u);
      s += segLen(i, f0, f1);
      u = nu;
    }
    return s;
  };
  return {
    type: "polyline",
    lo: 0,
    hi: S,
    periodic: closed,
    extendable: !closed,
    at,
    tan,
    param,
    paramOn: (ci, p) => {
      const c = curves[ci];
      const i = c?.seg ?? 0;
      return i + segParam(segs[i], p, false);
    },
    piece: (u0, u1) => {
      const pts: Vec2[] = [at(u0)];
      const bul: number[] = [];
      const wid: [number, number][] = [];
      let u = u0;
      let guard = 0;
      while (u < u1 - 1e-12 && guard++ < 4 * S + 8) {
        const k = Math.floor(u + 1e-12);
        const nu = Math.min(k + 1, u1);
        const [i, f0] = split(u);
        const f1 = Math.min(1, f0 + (nu - u));
        const s = segs[i];
        bul.push(s.arc ? Math.tan((s.arc.sweep * (f1 - f0)) / 4) : 0);
        wid.push([s.w[0] + (s.w[1] - s.w[0]) * f0, s.w[0] + (s.w[1] - s.w[0]) * f1]);
        pts.push(f1 === 1 ? s.b : segAt(s, f1));
        u = nu;
      }
      if (pts.length < 2) return null;
      const hasW = wid.some(([a, b]) => a > 0 || b > 0);
      const constW = wid.every(([a, b]) => Math.abs(a - wid[0][0]) < 1e-12 && Math.abs(b - wid[0][0]) < 1e-12);
      return geomOnly({
        type: "polyline",
        pts,
        ...(bul.some((b) => Math.abs(b) > 1e-12) ? { bulges: [...bul, 0] } : {}),
        ...(hasW ? (constW ? { width: wid[0][0] } : { widths: [...wid, [0, 0]] }) : {}),
      });
    },
    len: lenFn,
    atLen: (u0, s) => {
      let u = u0;
      let rest = s;
      let guard = 0;
      while (guard++ < 4 * S + 8) {
        const k = Math.floor(u + 1e-12);
        const [i, f0] = split(u);
        const L = segs[i].L * (1 - f0);
        if (rest <= L + 1e-12 || (!closed && k + 1 >= S)) return u + (segs[i].L > 0 ? rest / segs[i].L : 0);
        rest -= L;
        u = k + 1;
      }
      return u;
    },
  };
}

const splineNurbs = (e: DSpline): Nurbs => ({ deg: e.degree, ctrl: e.ctrl, knots: e.knots, ...(e.weights ? { w: e.weights } : {}) });
export const nurbsToSpline = (n: Nurbs): NewEntity => geomOnly({ type: "spline", degree: n.deg, ctrl: n.ctrl, knots: n.knots, ...(n.w ? { weights: n.w } : {}) });

function splineEC(e: DSpline): EC {
  const N = splineNurbs(e);
  const [lo, hi] = nurbsRange(N);
  const cc = asCurve(N);
  const at = (u: number) => cPointN(cc, u);
  const closedGeom = dist(at(lo), at(hi)) < tolAt(at(lo), 1e-9);
  const periodic = !!e.closed || closedGeom;
  const speed = (t: number) => len(cDeriv(cc, t));
  const lenFn = (a: number, b: number) => nurbsLen(N, a, b);
  const piece = (u0: number, u1: number): NewEntity | null => {
    if (u1 <= hi + 1e-12) {
      const s = subNurbs(N, u0, Math.min(u1, hi));
      return s ? nurbsToSpline(s) : null;
    }
    const a = subNurbs(N, u0, hi);
    const b = subNurbs(N, lo, u1 - (hi - lo));
    if (a && b) return nurbsToSpline(joinNurbs(a, b));
    return a ? nurbsToSpline(a) : b ? nurbsToSpline(b) : null;
  };
  return {
    type: "spline",
    lo,
    hi,
    periodic,
    extendable: false,
    at,
    tan: (u) => unit(cDeriv(cc, u)),
    param: (p) => closestOn(cc, p).t,
    paramOn: (_ci, p) => closestOn(cc, p).t,
    piece,
    len: (a, b) => (b <= hi + 1e-12 ? lenFn(a, Math.min(b, hi)) : lenFn(a, hi) + lenFn(lo, b - (hi - lo))),
    atLen: (u0, s) => paramAtLen(lenFn, speed, u0, hi, s),
  };
}
const cPointN = (c: Extract<Curve, { k: "nurbs" }>, u: number): Vec2 => {
  // přesné konce (sevřená křivka)
  if (u <= c.knots[c.deg]) return c.ctrl[0];
  if (u >= c.knots[c.ctrl.length] && c.knots[c.knots.length - 1] === c.knots[c.ctrl.length]) return c.ctrl[c.ctrl.length - 1];
  return cPoint(c, u);
};

/** parametrický popis entity (null = druh, který se takto upravit nedá – text, bod, entity balíků) */
export function editCurve(e: DraftEntity, ctx: KindCtx): EC | null {
  switch (e.type) {
    case "line":
      return dist(e.a, e.b) > 1e-12 ? lineEC(e) : null;
    case "xline":
    case "ray":
      return infEC(e);
    case "circle":
      return circleEC(e);
    case "arc":
      return arcEC(e);
    case "ellipse":
      return ellipseEC(e);
    case "polyline":
      return e.pts.length >= 2 ? polylineEC(e, ctx) : null;
    case "spline":
      return e.ctrl.length > e.degree ? splineEC(e) : null;
    default:
      return null;
  }
}

/** začátek a konec otevřené entity (null u uzavřených / nekonečných) */
export function ends(ec: EC): [Vec2, Vec2] | null {
  if (ec.periodic || !Number.isFinite(ec.lo) || !Number.isFinite(ec.hi)) return null;
  return [ec.at(ec.lo), ec.at(ec.hi)];
}

/** body výpočtu entity s parametry (pro průsečíky) */
export function curvesWithIndex(e: DraftEntity, ctx: KindCtx): { c: Curve; i: number }[] {
  return entityCurves(e, ctx).map((c, i) => ({ c, i }));
}

/** body a tečny v rovnoměrných délkových odstupech (DĚLIT, MĚŘIT, POLE PO DRÁZE) */
export function pointsAlong(ec: EC, starts: number[]): { p: Vec2; t: Vec2; u: number }[] {
  return starts.map((s) => {
    const u = ec.atLen(ec.lo, s);
    return { p: ec.at(u), t: ec.tan(u), u };
  });
}

export const totalLen = (ec: EC) => ec.len(ec.lo, ec.hi);
