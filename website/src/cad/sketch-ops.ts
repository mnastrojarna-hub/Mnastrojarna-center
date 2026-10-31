/**
 * Editační operace skici (čisté funkce): průsečíky, nejbližší bod, ořez, prodloužení, odsazení,
 * zaoblení/sražení rohu, rozložení tvarů, transformace (posun, otočení, měřítko, zrcadlení) a pole.
 */
import { arcGeom, circleFrom3, keyPoints, prims, shapeSegs, type Prim } from "./sketch";
import { uid, type SketchEntity, type Vec2 } from "./types";

const TAU = Math.PI * 2;
const EPS = 1e-9;
export const d2 = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k];
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
const crs = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];
const nrmA = (x: number) => ((x % TAU) + TAU) % TAU;
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
const R: (p: Vec2) => Vec2 = (p) => [r6(p[0]), r6(p[1])];

/** Úhel leží na oblouku (a0 → a0+sweep, CCW)? */
export function onArc(p: Extract<Prim, { kind: "arc" }>, ang: number, tol = 1e-7) {
  if (p.sweep >= TAU - 1e-9) return true;
  return nrmA(ang - p.a0) <= p.sweep + tol;
}

/** Parametr bodu na primitivu (úsečka 0..1, oblouk 0..1 podél průběhu). */
export function primParam(p: Prim, q: Vec2): number {
  if (p.kind === "line") {
    const d = sub(p.b, p.a);
    return dot(sub(q, p.a), d) / (dot(d, d) || 1e-12);
  }
  const ang = Math.atan2(q[1] - p.c[1], q[0] - p.c[0]);
  return nrmA(ang - p.a0) / p.sweep;
}

export function primPoint(p: Prim, t: number): Vec2 {
  if (p.kind === "line") return add(p.a, mul(sub(p.b, p.a), t));
  const a = p.a0 + p.sweep * t;
  return [p.c[0] + p.r * Math.cos(a), p.c[1] + p.r * Math.sin(a)];
}

/** Nejbližší bod na primitivu (omezeně na jeho rozsah). */
export function nearestOnPrim(p: Prim, q: Vec2): Vec2 {
  if (p.kind === "line") return primPoint(p, Math.max(0, Math.min(1, primParam(p, q))));
  const ang = Math.atan2(q[1] - p.c[1], q[0] - p.c[0]);
  if (onArc(p, ang)) return [p.c[0] + p.r * Math.cos(ang), p.c[1] + p.r * Math.sin(ang)];
  const s = primPoint(p, 0);
  const e = primPoint(p, 1);
  return d2(s, q) < d2(e, q) ? s : e;
}

/** Průsečíky dvou primitiv (v jejich rozsahu; `extend` = úsečky jako nekonečné přímky). */
export function intersect(p: Prim, q: Prim, extend = false): Vec2[] {
  if (p.kind === "line" && q.kind === "line") {
    const r = sub(p.b, p.a);
    const s = sub(q.b, q.a);
    const den = crs(r, s);
    if (Math.abs(den) < EPS) return [];
    const t = crs(sub(q.a, p.a), s) / den;
    const u = crs(sub(q.a, p.a), r) / den;
    if (!extend && (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9)) return [];
    return [add(p.a, mul(r, t))];
  }
  if (p.kind === "arc" && q.kind === "line") return intersect(q, p, extend);
  if (p.kind === "line" && q.kind === "arc") {
    const d = sub(p.b, p.a);
    const f = sub(p.a, q.c);
    const A = dot(d, d);
    const B = 2 * dot(f, d);
    const C = dot(f, f) - q.r * q.r;
    const disc = B * B - 4 * A * C;
    if (disc < -1e-9 || A < EPS) return [];
    const sq = Math.sqrt(Math.max(0, disc));
    const ts = disc < 1e-12 ? [-B / (2 * A)] : [(-B - sq) / (2 * A), (-B + sq) / (2 * A)];
    return ts
      .filter((t) => extend || (t >= -1e-9 && t <= 1 + 1e-9))
      .map((t) => add(p.a, mul(d, t)))
      .filter((pt) => onArc(q, Math.atan2(pt[1] - q.c[1], pt[0] - q.c[0])));
  }
  if (p.kind === "arc" && q.kind === "arc") {
    const dd = d2(p.c, q.c);
    if (dd < EPS || dd > p.r + q.r + 1e-9 || dd < Math.abs(p.r - q.r) - 1e-9) return [];
    const a = (p.r * p.r - q.r * q.r + dd * dd) / (2 * dd);
    const h = Math.sqrt(Math.max(0, p.r * p.r - a * a));
    const m = add(p.c, mul(sub(q.c, p.c), a / dd));
    const off: Vec2 = [(-(q.c[1] - p.c[1]) * h) / dd, ((q.c[0] - p.c[0]) * h) / dd];
    const pts = h < 1e-9 ? [m] : [add(m, off), sub(m, off)];
    return pts.filter((pt) => onArc(p, Math.atan2(pt[1] - p.c[1], pt[0] - p.c[0])) && onArc(q, Math.atan2(pt[1] - q.c[1], pt[0] - q.c[0])));
  }
  return [];
}

/** Všechny průsečíky mezi entitami skici (pro uchopení „Průsečík“). */
export function allIntersections(entities: SketchEntity[], limit = 4000): Vec2[] {
  const ps = entities.flatMap(prims);
  const out: Vec2[] = [];
  for (let i = 0; i < ps.length && out.length < limit; i++)
    for (let j = i + 1; j < ps.length; j++) {
      if (ps[i].id === ps[j].id && ps[i].part == null) continue;
      for (const x of intersect(ps[i], ps[j])) {
        // vynechat sdílené koncové body téže entity (rohy obdélníku apod.)
        if (ps[i].id === ps[j].id) continue;
        out.push(x);
      }
    }
  return out;
}

// ---------------- transformace ----------------

/** Podobnostní transformace: bod → bod, úhel (°) → úhel, měřítko, zrcadlení. */
export type Xf = { p: (q: Vec2) => Vec2; ang: (deg: number) => number; k: number; mirror: boolean };

export const xfMove = (d: Vec2): Xf => ({ p: (q) => add(q, d), ang: (a) => a, k: 1, mirror: false });
export const xfRotate = (c: Vec2, deg: number): Xf => {
  const t = (deg * Math.PI) / 180;
  return { p: (q) => [c[0] + (q[0] - c[0]) * Math.cos(t) - (q[1] - c[1]) * Math.sin(t), c[1] + (q[0] - c[0]) * Math.sin(t) + (q[1] - c[1]) * Math.cos(t)], ang: (a) => a + deg, k: 1, mirror: false };
};
export const xfScale = (c: Vec2, k: number): Xf => ({ p: (q) => add(c, mul(sub(q, c), k)), ang: (a) => a, k, mirror: false });
/** Zrcadlení podle přímky a→b. */
export const xfMirror = (a: Vec2, b: Vec2): Xf => {
  const d = sub(b, a);
  const L = Math.hypot(...d) || 1;
  const u: Vec2 = [d[0] / L, d[1] / L];
  const phi = (Math.atan2(u[1], u[0]) * 180) / Math.PI;
  return {
    p: (q) => {
      const v = sub(q, a);
      const proj = mul(u, dot(v, u));
      return add(a, sub(mul(proj, 2), v));
    },
    ang: (x) => 2 * phi - x,
    k: 1,
    mirror: true,
  };
};

export function transformEntity(e: SketchEntity, T: Xf, newId = false): SketchEntity {
  const id = newId ? uid() : e.id;
  const P = (q: Vec2) => R(T.p(q));
  switch (e.type) {
    case "line":
      return { ...e, id, a: P(e.a), b: P(e.b) };
    case "arc":
      return { ...e, id, a: P(e.a), b: P(e.b), c: P(e.c) };
    case "polyline":
    case "spline":
      return { ...e, id, points: e.points.map(P) };
    case "point":
      return { ...e, id, p: P(e.p) };
    case "circle": {
      const c = P([e.cx, e.cy]);
      return { ...e, id, cx: c[0], cy: c[1], r: r6(e.r * T.k) };
    }
    case "rect": {
      const c = P([e.cx, e.cy]);
      return { ...e, id, cx: c[0], cy: c[1], w: r6(e.w * T.k), h: r6(e.h * T.k), r: r6(e.r * T.k), angle: r6(T.ang(e.angle)) };
    }
    case "polygon": {
      const c = P([e.cx, e.cy]);
      return { ...e, id, cx: c[0], cy: c[1], r: r6(e.r * T.k), angle: r6(T.mirror ? T.ang(e.angle) - 180 : T.ang(e.angle)) };
    }
    case "slot": {
      const c = P([e.cx, e.cy]);
      return { ...e, id, cx: c[0], cy: c[1], length: r6(e.length * T.k), width: r6(e.width * T.k), angle: r6(T.ang(e.angle)) };
    }
    case "ellipse": {
      const c = P([e.cx, e.cy]);
      return { ...e, id, cx: c[0], cy: c[1], rx: r6(e.rx * T.k), ry: r6(e.ry * T.k), angle: r6(T.ang(e.angle)) };
    }
  }
}

/** Lineární pole: count kopií (vč. originálu) s krokem `step`; vrací jen nové entity. */
export function linearPattern(sel: SketchEntity[], step: Vec2, count: number, step2?: Vec2, count2 = 1): SketchEntity[] {
  const out: SketchEntity[] = [];
  for (let i = 0; i < Math.max(1, count); i++)
    for (let j = 0; j < Math.max(1, count2); j++) {
      if (!i && !j) continue;
      const d: Vec2 = [step[0] * i + (step2?.[0] ?? 0) * j, step[1] * i + (step2?.[1] ?? 0) * j];
      for (const e of sel) out.push(transformEntity(e, xfMove(d), true));
    }
  return out;
}

/** Kruhové pole kolem středu: count kusů rovnoměrně v úhlu `total` (360 = celý kruh). */
export function circularPattern(sel: SketchEntity[], c: Vec2, count: number, total = 360): SketchEntity[] {
  const n = Math.max(2, Math.round(count));
  const step = total >= 360 ? 360 / n : total / (n - 1);
  const out: SketchEntity[] = [];
  for (let i = 1; i < n; i++) for (const e of sel) out.push(transformEntity(e, xfRotate(c, step * i), true));
  return out;
}

// ---------------- rozložení ----------------

/** Rozloží tvar (obdélník, mnohoúhelník, drážka, lomená čára) na úsečky a oblouky. */
export function explode(e: SketchEntity): SketchEntity[] {
  if (e.type === "polyline") {
    const out: SketchEntity[] = e.points.slice(1).map((p, i) => ({ id: uid(), type: "line", a: e.points[i], b: p, construction: e.construction }));
    if (e.closed && e.points.length > 2) out.push({ id: uid(), type: "line", a: e.points[e.points.length - 1], b: e.points[0], construction: e.construction });
    return out;
  }
  if (e.type === "rect" || e.type === "polygon" || e.type === "slot") {
    const segs = shapeSegs(e);
    if (!segs) return [e];
    return segs.map((s) => (s.kind === "line" ? { id: uid(), type: "line", a: R(s.a), b: R(s.b), construction: e.construction } : { id: uid(), type: "arc", a: R(s.a), b: R(s.m), c: R(s.b), construction: e.construction }));
  }
  return [e];
}

// ---------------- ořez a prodloužení ----------------

function arcEntity(c: Vec2, r: number, t0: number, t1: number, base: SketchEntity): SketchEntity {
  const P = (t: number): Vec2 => R([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]);
  return { id: uid(), type: "arc", a: P(t0), b: P((t0 + t1) / 2), c: P(t1), construction: base.construction };
}

/**
 * Ořez: rozdělí entitu v průsečících s ostatními a odstraní úsek, na který se kliklo.
 * Tvary (obdélník…) se nejdřív rozloží. Vrací nový seznam entit, nebo null (nic k oříznutí).
 */
export function trim(entities: SketchEntity[], id: string, click: Vec2): SketchEntity[] | null {
  const target = entities.find((e) => e.id === id);
  if (!target) return null;
  if (["rect", "polygon", "slot", "polyline"].includes(target.type)) {
    const parts = explode(target);
    const list = entities.flatMap((e) => (e.id === id ? parts : [e]));
    // úsek nejblíž kliknutí
    let best = parts[0];
    let bd = Infinity;
    for (const p of parts) for (const pr of prims(p)) {
      const d = d2(nearestOnPrim(pr, click), click);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return trim(list, best.id, click) ?? list;
  }
  if (target.type !== "line" && target.type !== "arc" && target.type !== "circle") return null;
  const tp = prims(target)[0];
  if (!tp) return null;
  const others = entities.filter((e) => e.id !== id).flatMap(prims);
  const ts = new Set<number>();
  for (const o of others) for (const x of intersect(tp, o)) {
    const t = primParam(tp, x);
    if (t > 1e-6 && t < 1 - 1e-6) ts.add(Math.round(t * 1e9) / 1e9);
  }
  // kružnice: i průsečíky v t≈0 jsou dělicí body
  if (tp.kind === "arc" && tp.sweep >= TAU - 1e-9) for (const o of others) for (const x of intersect(tp, o)) ts.add(Math.round(primParam(tp, x) * 1e9) / 1e9);
  const cuts = [...ts].sort((a, b) => a - b);
  const tc = primParam(tp, nearestOnPrim(tp, click));
  if (tp.kind === "line") {
    if (!cuts.length) return entities.filter((e) => e.id !== id); // bez průsečíků → smazat celé
    const bounds = [0, ...cuts, 1];
    const pieces: SketchEntity[] = [];
    for (let i = 0; i < bounds.length - 1; i++) {
      if (tc >= bounds[i] && tc <= bounds[i + 1]) continue;
      pieces.push({ id: uid(), type: "line", a: R(primPoint(tp, bounds[i])), b: R(primPoint(tp, bounds[i + 1])), construction: target.construction });
    }
    return entities.flatMap((e) => (e.id === id ? pieces : [e]));
  }
  const full = tp.sweep >= TAU - 1e-9;
  if (full) {
    if (cuts.length < 2) return cuts.length ? null : entities.filter((e) => e.id !== id);
    // kružnice → oblouk mimo úsek s kliknutím
    let k = cuts.findIndex((c) => c > tc);
    if (k < 0) k = 0;
    const from = cuts[k];
    const to = cuts[(k - 1 + cuts.length) % cuts.length];
    const t0 = tp.a0 + from * tp.sweep;
    let t1 = tp.a0 + to * tp.sweep;
    while (t1 <= t0) t1 += TAU;
    return entities.flatMap((e) => (e.id === id ? [arcEntity(tp.c, tp.r, t0, t1, target)] : [e]));
  }
  if (!cuts.length) return entities.filter((e) => e.id !== id);
  const bounds = [0, ...cuts, 1];
  const pieces: SketchEntity[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    if (tc >= bounds[i] && tc <= bounds[i + 1]) continue;
    pieces.push(arcEntity(tp.c, tp.r, tp.a0 + bounds[i] * tp.sweep, tp.a0 + bounds[i + 1] * tp.sweep, target));
  }
  return entities.flatMap((e) => (e.id === id ? pieces : [e]));
}

/** Prodloužení úsečky (konec bližší kliknutí) k nejbližšímu průsečíku s jinou entitou. */
export function extend(entities: SketchEntity[], id: string, click: Vec2): SketchEntity[] | null {
  const e = entities.find((x) => x.id === id);
  if (!e || e.type !== "line") return null;
  const atB = d2(click, e.b) < d2(click, e.a);
  const from = atB ? e.b : e.a;
  const dir = atB ? sub(e.b, e.a) : sub(e.a, e.b);
  const L = Math.hypot(...dir);
  if (L < EPS) return null;
  const ray: Prim = { kind: "line", a: from, b: add(from, mul(dir, 1e6 / L)), id: "_" };
  let best: Vec2 | null = null;
  let bd = Infinity;
  for (const o of entities.filter((x) => x.id !== id).flatMap(prims))
    for (const x of intersect(ray, o)) {
      const d = d2(x, from);
      if (d > 1e-6 && d < bd) {
        bd = d;
        best = x;
      }
    }
  if (!best) return null;
  return entities.map((x) => (x.id === id ? { ...e, [atB ? "b" : "a"]: R(best!) } : x));
}

// ---------------- odsazení ----------------

/** Strana odsazení podle bodu: +1 vlevo od směru / vně kružnice, −1 opačně. */
export function offsetSide(e: SketchEntity, q: Vec2): number {
  const ps = prims(e);
  if (!ps.length) return 1;
  let best = ps[0];
  let bd = Infinity;
  for (const p of ps) {
    const d = d2(nearestOnPrim(p, q), q);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  if (e.type === "rect" || e.type === "polygon" || e.type === "slot" || e.type === "circle" || e.type === "ellipse" || ((e.type === "polyline" || e.type === "spline") && e.closed)) {
    const k = keyPoints(e);
    const c = k.center ?? centroid(e.type === "polyline" || e.type === "spline" ? e.points : Object.values(k));
    const n = nearestOnPrim(best, q);
    return d2(q, c) >= d2(n, c) ? 1 : -1;
  }
  if (best.kind === "arc") return d2(q, best.c) >= best.r ? 1 : -1;
  return crs(sub(best.b, best.a), sub(q, best.a)) >= 0 ? 1 : -1;
}

const centroid = (pts: Vec2[]): Vec2 => [pts.reduce((s, p) => s + p[0], 0) / (pts.length || 1), pts.reduce((s, p) => s + p[1], 0) / (pts.length || 1)];

/** Odsadí entitu o vzdálenost d (kladně = ven/vlevo). */
export function offsetEntity(e: SketchEntity, d: number): SketchEntity | null {
  const id = uid();
  switch (e.type) {
    case "line": {
      const v = sub(e.b, e.a);
      const L = Math.hypot(...v) || 1;
      const n: Vec2 = [(-v[1] / L) * d, (v[0] / L) * d];
      return { ...e, id, a: R(add(e.a, n)), b: R(add(e.b, n)) };
    }
    case "circle":
      return e.r + d > 1e-6 ? { ...e, id, r: r6(e.r + d) } : null;
    case "arc": {
      const g = circleFrom3(e.a, e.b, e.c);
      if (!g) return null;
      const k = (g.r + d) / g.r;
      if (k <= 0) return null;
      const P = (q: Vec2) => R(add(g.c, mul(sub(q, g.c), k)));
      return { ...e, id, a: P(e.a), b: P(e.b), c: P(e.c) };
    }
    case "rect":
      return e.w + 2 * d > 0 && e.h + 2 * d > 0 ? { ...e, id, w: r6(e.w + 2 * d), h: r6(e.h + 2 * d), r: r6(Math.max(0, e.r ? e.r + d : 0)) } : null;
    case "polygon": {
      const n = Math.max(3, Math.round(e.sides));
      const r = e.r + d / Math.cos(Math.PI / n);
      return r > 0 ? { ...e, id, r: r6(r) } : null;
    }
    case "slot":
      return e.width + 2 * d > 0 ? { ...e, id, width: r6(e.width + 2 * d), length: r6(e.length + 2 * d) } : null;
    case "ellipse":
      return e.rx + d > 0 && e.ry + d > 0 ? { ...e, id, rx: r6(e.rx + d), ry: r6(e.ry + d) } : null;
    case "polyline":
    case "spline": {
      const pts = offsetPolyline(e.points, e.closed, d);
      return pts ? { ...e, id, points: pts } : null;
    }
    case "point":
      return null;
  }
}

/** Odsazení lomené čáry s ostrými rohy (průsečíky posunutých segmentů). U uzavřené: kladně ven. */
function offsetPolyline(pts: Vec2[], closed: boolean, d: number): Vec2[] | null {
  const n = pts.length;
  if (n < 2) return null;
  let dd = d;
  if (closed) {
    // kladné d = ven: orientace podle obsahu
    let A = 0;
    for (let i = 0; i < n; i++) A += crs(pts[i], pts[(i + 1) % n]);
    dd = A > 0 ? -d : d;
  }
  const segs: [Vec2, Vec2][] = [];
  const m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const v = sub(b, a);
    const L = Math.hypot(...v) || 1;
    const o: Vec2 = [(-v[1] / L) * dd, (v[0] / L) * dd];
    segs.push([add(a, o), add(b, o)]);
  }
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    if (!closed && i === 0) {
      out.push(R(segs[0][0]));
      continue;
    }
    if (!closed && i === n - 1) {
      out.push(R(segs[m - 1][1]));
      continue;
    }
    const s1 = segs[(i - 1 + m) % m];
    const s2 = segs[i % m];
    const x = intersect({ kind: "line", a: s1[0], b: s1[1], id: "" }, { kind: "line", a: s2[0], b: s2[1], id: "" }, true)[0];
    out.push(R(x ?? s2[0]));
  }
  return out;
}

// ---------------- zaoblení a sražení rohu ----------------

/** Společný (nebo prodloužený) roh dvou úseček a směry ramen od rohu ke vzdáleným koncům. */
function corner(l1: Extract<SketchEntity, { type: "line" }>, l2: Extract<SketchEntity, { type: "line" }>) {
  const x = intersect({ kind: "line", a: l1.a, b: l1.b, id: "" }, { kind: "line", a: l2.a, b: l2.b, id: "" }, true)[0];
  if (!x) return null;
  const far1 = d2(l1.a, x) > d2(l1.b, x) ? l1.a : l1.b;
  const far2 = d2(l2.a, x) > d2(l2.b, x) ? l2.a : l2.b;
  const u1 = sub(far1, x);
  const u2 = sub(far2, x);
  const L1 = Math.hypot(...u1);
  const L2 = Math.hypot(...u2);
  if (L1 < EPS || L2 < EPS) return null;
  return { x, far1, far2, u1: mul(u1, 1 / L1), u2: mul(u2, 1 / L2), L1, L2 };
}

/** Zaoblení rohu dvou úseček poloměrem r: zkrátí úsečky a vloží tečný oblouk. */
export function filletLines(entities: SketchEntity[], id1: string, id2: string, r: number): SketchEntity[] | null {
  const l1 = entities.find((e) => e.id === id1);
  const l2 = entities.find((e) => e.id === id2);
  if (l1?.type !== "line" || l2?.type !== "line" || !(r > 0)) return null;
  const c = corner(l1, l2);
  if (!c) return null;
  const cosT = Math.max(-1, Math.min(1, dot(c.u1, c.u2)));
  const theta = Math.acos(cosT);
  if (theta < 1e-6 || theta > Math.PI - 1e-6) return null;
  const t = r / Math.tan(theta / 2);
  if (t > c.L1 + 1e-9 || t > c.L2 + 1e-9) return null;
  const p1 = add(c.x, mul(c.u1, t));
  const p2 = add(c.x, mul(c.u2, t));
  const bis = add(c.u1, c.u2);
  const bl = Math.hypot(...bis);
  const center = add(c.x, mul(bis, r / Math.sin(theta / 2) / bl));
  const mid = add(center, mul(sub(c.x, center), r / d2(c.x, center)));
  const arc: SketchEntity = { id: uid(), type: "arc", a: R(p1), b: R(mid), c: R(p2), construction: l1.construction };
  return entities.flatMap((e) => (e.id === id1 ? [{ ...l1, a: R(c.far1), b: R(p1) }] : e.id === id2 ? [{ ...l2, a: R(p2), b: R(c.far2) }, arc] : [e]));
}

/** Sražení rohu dvou úseček vzdáleností d (na obou ramenech). */
export function chamferLines(entities: SketchEntity[], id1: string, id2: string, d: number, d2v = d): SketchEntity[] | null {
  const l1 = entities.find((e) => e.id === id1);
  const l2 = entities.find((e) => e.id === id2);
  if (l1?.type !== "line" || l2?.type !== "line" || !(d > 0)) return null;
  const c = corner(l1, l2);
  if (!c || d > c.L1 || d2v > c.L2) return null;
  const p1 = add(c.x, mul(c.u1, d));
  const p2 = add(c.x, mul(c.u2, d2v));
  const ch: SketchEntity = { id: uid(), type: "line", a: R(p1), b: R(p2), construction: l1.construction };
  return entities.flatMap((e) => (e.id === id1 ? [{ ...l1, a: R(c.far1), b: R(p1) }] : e.id === id2 ? [{ ...l2, a: R(p2), b: R(c.far2) }, ch] : [e]));
}

// ---------------- měření ----------------

/** Vzdálenost bodu od entity (nejbližší bod na ní). */
export function distToEntity(e: SketchEntity, q: Vec2): { d: number; p: Vec2 } {
  let best = { d: Infinity, p: q };
  if (e.type === "point") return { d: d2(e.p, q), p: e.p };
  for (const pr of prims(e)) {
    const p = nearestOnPrim(pr, q);
    const d = d2(p, q);
    if (d < best.d) best = { d, p };
  }
  return best;
}

/** Úhel mezi dvěma úsečkami (0–180°). */
export function angleBetween(a1: Vec2, b1: Vec2, a2: Vec2, b2: Vec2) {
  const u = sub(b1, a1);
  const v = sub(b2, a2);
  return (Math.atan2(Math.abs(crs(u, v)), dot(u, v)) * 180) / Math.PI;
}

export { arcGeom };
