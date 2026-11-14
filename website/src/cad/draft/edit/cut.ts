/**
 * BALÍK 1 (edit) – geometrie ořezávání a prodlužování: průsečíky entity s řeznými hranami (i prodloužené hrany),
 * zbylé části po oříznutí (otevřené i uzavřené entity), prodloužení konce k hranici, změna délky na konci.
 * Úsečky a oblouky analyticky (dvojitá přesnost), elipsy a splajny Newtonem v curves.ts.
 */
import { cIntersect, type Curve } from "../curves";
import { add, angleOf, bulgeArc, deg, dist, dot, len, mul, normA, polar, rad, rot90, sub, TAU, unit } from "../geom";
import { entityCurves, type KindCtx } from "../kinds";
import type { DArc, DEllipse, DLine, DPolyline, DraftEntity, NewEntity, Vec2 } from "../model";
import { normDeg } from "../units";
import { paramAtLen } from "./nurbs";
import { closestOn, type EC } from "./param";
import { tolAt } from "./tol";

/** shoda bodů řezu (absolutní tolerance + zaokrouhlení double, viz tol.ts) */
const scaleTol = (p: Vec2) => tolAt(p);

/** Parametry průsečíků entity s hranami (bez konců otevřené entity), seřazené a bez duplicit. */
export function cutParams(e: DraftEntity, ec: EC, edges: readonly DraftEntity[], ctx: KindCtx, extendEdges: boolean): number[] {
  const tcs = entityCurves(e, ctx);
  const raw: { u: number; p: Vec2 }[] = [];
  for (const ed of edges) {
    if (ed.id === e.id) continue;
    for (const bc of entityCurves(ed, ctx)) {
      for (let i = 0; i < tcs.length; i++) {
        const tc = tcs[i];
        let pts: Vec2[];
        try {
          pts = extendEdges ? cIntersect(tc, bc, true) : cIntersect(tc, bc, false);
        } catch {
          continue;
        }
        for (const p of pts) {
          if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
          // bod musí ležet na entitě (prodlužují se jen hrany)
          if (closestOn(tc, p).d > scaleTol(p)) continue;
          // bez prodloužení musí ležet i na hraně
          if (!extendEdges && closestOn(bc, p).d > scaleTol(p)) continue;
          raw.push({ u: ec.paramOn(i, p), p });
        }
      }
    }
  }
  return uniqueParams(ec, raw);
}

/** parametry průsečíků s obecnými křivkami (plot, okno křížení) */
export function curveParams(e: DraftEntity, ec: EC, curves: readonly Curve[], ctx: KindCtx): number[] {
  const tcs = entityCurves(e, ctx);
  const raw: { u: number; p: Vec2 }[] = [];
  for (const bc of curves)
    for (let i = 0; i < tcs.length; i++)
      for (const p of cIntersect(tcs[i], bc, false)) {
        if (closestOn(tcs[i], p).d > scaleTol(p)) continue;
        raw.push({ u: ec.paramOn(i, p), p });
      }
  return uniqueParams(ec, raw, true);
}

function uniqueParams(ec: EC, raw: { u: number; p: Vec2 }[], keepEnds = false): number[] {
  const P = ec.hi - ec.lo;
  const norm = (u: number) => (ec.periodic ? ec.lo + (((u - ec.lo) % P) + P) % P : u);
  const out: { u: number; p: Vec2 }[] = [];
  const s0 = Number.isFinite(ec.lo) ? ec.at(ec.lo) : null;
  const s1 = Number.isFinite(ec.hi) ? ec.at(ec.hi) : null;
  for (const r of raw.map((x) => ({ u: norm(x.u), p: x.p })).sort((a, b) => a.u - b.u)) {
    if (!ec.periodic && !keepEnds) {
      if (r.u < ec.lo - 1e-9 || r.u > ec.hi + 1e-9) continue;
      if ((s0 && dist(r.p, s0) <= scaleTol(r.p)) || (s1 && dist(r.p, s1) <= scaleTol(r.p))) continue;
    }
    if (out.some((o) => dist(o.p, r.p) <= scaleTol(r.p))) continue;
    out.push(r);
  }
  return out.map((o) => o.u);
}

/**
 * Zbylé intervaly parametru po odebrání dílů, ve kterých leží `picks`. Řezy `cuts` dělí entitu na díly.
 * Uzavřená entita potřebuje alespoň 2 řezy (jinak null). Prázdné pole = entita zmizí celá.
 */
export function keepIntervals(ec: EC, cuts: number[], picks: number[]): [number, number][] | null {
  if (!ec.periodic) {
    const ks = [ec.lo, ...cuts.filter((u) => u > ec.lo && u < ec.hi), ec.hi];
    const removed = new Set<number>();
    for (const u0 of picks) {
      const u = Math.max(ec.lo, Math.min(ec.hi, u0));
      for (let i = 0; i < ks.length - 1; i++)
        if (u >= ks[i] && u <= ks[i + 1]) {
          removed.add(i);
          break;
        }
    }
    const out: [number, number][] = [];
    let cur: [number, number] | null = null;
    for (let i = 0; i < ks.length - 1; i++) {
      if (removed.has(i)) {
        if (cur) out.push(cur);
        cur = null;
      } else if (cur) cur[1] = ks[i + 1];
      else cur = [ks[i], ks[i + 1]];
    }
    if (cur) out.push(cur);
    return out;
  }
  const P = ec.hi - ec.lo;
  const md = (u: number) => ec.lo + (((u - ec.lo) % P) + P) % P;
  const cs = [...new Set(cuts.map(md))].sort((a, b) => a - b);
  const n = cs.length;
  if (n < 2) return null;
  const ivOf = (u0: number) => {
    let u = md(u0);
    if (u < cs[0]) u += P;
    for (let i = 0; i < n; i++) {
      const a = cs[i];
      const b = i === n - 1 ? cs[0] + P : cs[i + 1];
      if (u >= a && u <= b) return i;
    }
    return n - 1;
  };
  const removed = new Set(picks.map(ivOf));
  if (removed.size === n) return [];
  const r = [...removed][0];
  const out: [number, number][] = [];
  let cur: [number, number] | null = null;
  for (let k = 0; k < n - 1 + 1; k++) {
    const base = r + 1 + k;
    const idx = base % n;
    if (k === n - 1 && idx === r) break;
    const off = base >= n ? P : 0;
    const a = cs[idx] + off;
    const b = (idx === n - 1 ? cs[0] + P : cs[idx + 1]) + off;
    if (removed.has(idx)) {
      if (cur) out.push(cur);
      cur = null;
    } else if (cur) cur[1] = b;
    else cur = [a, b];
  }
  if (cur) out.push(cur);
  return out.map(([a, b]) => (a >= ec.hi - 1e-15 ? [a - P, b - P] : [a, b]));
}

// ---------------------------------------------------------------- prodloužení konce

/** směr ven z konce (0 = začátek, 1 = konec) */
const outward = (ec: EC, which: 0 | 1): Vec2 => (which === 1 ? ec.tan(ec.hi) : mul(ec.tan(ec.lo), -1));

/** konec entity, který je blíž bodu výběru */
export function nearEnd(ec: EC, p: Vec2): 0 | 1 {
  return dist(ec.at(ec.lo), p) <= dist(ec.at(ec.hi), p) ? 0 : 1;
}

type ArcSpec = { c: Vec2; r: number; ang: number; ccw: boolean };
/** kruhová povaha konce (oblouk, kruhový úsek křivky) – pro prodloužení po kružnici */
function endArc(e: DraftEntity, ec: EC, which: 0 | 1): ArcSpec | null {
  if (e.type === "arc") {
    const p = ec.at(which === 1 ? ec.hi : ec.lo);
    return { c: e.c, r: e.r, ang: angleOf(sub(p, e.c)), ccw: which === 1 };
  }
  if (e.type === "polyline" && !e.closed) {
    const n = e.pts.length;
    const i = which === 1 ? n - 2 : 0;
    const bu = e.bulges?.[i] ?? 0;
    if (Math.abs(bu) < 1e-12) return null;
    const a = bulgeArc(e.pts[i], e.pts[i + 1], bu);
    const p = which === 1 ? e.pts[n - 1] : e.pts[0];
    // na konci pokračuje ve směru úhlu oblouku, na začátku proti
    return { c: a.c, r: a.r, ang: angleOf(sub(p, a.c)), ccw: which === 1 ? a.sweep > 0 : a.sweep < 0 };
  }
  return null;
}

/**
 * Nejbližší bod na prodloužení konce `which`, kde prodloužení protne hranice. Vrací bod (null = nic).
 * Úsečky a přímkové konce křivky po polopřímce, oblouky po kružnici, eliptické oblouky po elipse.
 */
export function extendHit(e: DraftEntity, ec: EC, which: 0 | 1, bounds: readonly DraftEntity[], ctx: KindCtx, extendEdges: boolean): Vec2 | null {
  if (!ec.extendable) return null;
  const end = ec.at(which === 1 ? ec.hi : ec.lo);
  const arcS = endArc(e, ec, which);
  let best: Vec2 | null = null;
  let bd = Infinity;
  const consider = (p: Vec2, d: number) => {
    if (d > tolAt(end, 1e-9) && d < bd) {
      bd = d;
      best = p;
    }
  };
  for (const b of bounds) {
    if (b.id === e.id) continue;
    for (const bc of entityCurves(b, ctx)) {
      if (arcS) {
        const full: Curve = { k: "arc", c: arcS.c, r: arcS.r, a0: 0, sweep: TAU };
        for (const p of cIntersect(full, bc, extendEdges)) {
          if (!extendEdges && closestOn(bc, p).d > scaleTol(p)) continue;
          const a = angleOf(sub(p, arcS.c));
          const d = arcS.ccw ? normA(a - arcS.ang) : normA(arcS.ang - a);
          // nesmí zasáhnout do stávajícího oblouku
          const back = e.type === "arc" ? TAU - rad(normDeg((e as DArc).a1 - (e as DArc).a0)) : TAU;
          if (d < back - 1e-12) consider(p, d * arcS.r);
        }
      } else if (e.type === "ellipse") {
        const el = e as DEllipse;
        const T = which === 1 ? ec.hi : ec.lo;
        const gap: Curve = { k: "ell", c: el.c, u: el.major, v: mul(rot90(el.major), el.ratio), t0: which === 1 ? T : T - (TAU - (ec.hi - ec.lo)), t1: which === 1 ? T + (TAU - (ec.hi - ec.lo)) : T };
        for (const p of cIntersect(gap, bc, false)) {
          const t = ec.param(p);
          const d = which === 1 ? normA(t - T) : normA(T - t);
          consider(p, d);
        }
      } else {
        const dir = outward(ec, which);
        const ray: Curve = { k: "line", a: end, b: add(end, dir), inf: 1 };
        for (const p of cIntersect(ray, bc, extendEdges)) {
          if (!extendEdges && closestOn(bc, p).d > scaleTol(p)) continue;
          const s = dot(sub(p, end), dir);
          if (s > 0) consider(p, s);
        }
      }
    }
  }
  return best;
}

/** geometrie entity s koncem `which` přesunutým do bodu P na jejím prodloužení (úsečka, oblouk, křivka, eliptický oblouk) */
export function extendTo(e: DraftEntity, which: 0 | 1, P: Vec2): NewEntity | null {
  if (e.type === "line") return (which === 1 ? { type: "line", a: (e as DLine).a, b: P } : { type: "line", a: P, b: (e as DLine).b }) as NewEntity;
  if (e.type === "arc") {
    const a = normDeg(deg(angleOf(sub(P, e.c))));
    return (which === 1 ? { type: "arc", c: e.c, r: e.r, a0: e.a0, a1: a } : { type: "arc", c: e.c, r: e.r, a0: a, a1: e.a1 }) as NewEntity;
  }
  if (e.type === "ellipse") {
    const U = e.major;
    const V = mul(rot90(e.major), e.ratio);
    const l = sub(P, e.c);
    const t = normDeg(deg(Math.atan2(dot(l, V) / dot(V, V), dot(l, U) / dot(U, U))));
    return (which === 1 ? { ...strip(e), t0: e.t0 ?? 0, t1: t } : { ...strip(e), t0: t, t1: e.t1 ?? 360 }) as NewEntity;
  }
  if (e.type === "polyline" && !e.closed) {
    const pl = e as DPolyline;
    const n = pl.pts.length;
    const pts = pl.pts.slice();
    const bul = Array.from({ length: n }, (_, k) => pl.bulges?.[k] ?? 0);
    const i = which === 1 ? n - 2 : 0;
    if (Math.abs(bul[i]) > 1e-12) {
      const a = bulgeArc(pts[i], pts[i + 1], bul[i]);
      const s = a.sweep;
      const fixed = which === 1 ? pts[i] : pts[i + 1];
      const fa = angleOf(sub(fixed, a.c));
      const na = angleOf(sub(P, a.c));
      let ns: number;
      if (which === 1) ns = s > 0 ? normA(na - fa) : -normA(fa - na);
      else ns = s > 0 ? normA(fa - na) : -normA(na - fa);
      bul[i] = Math.tan(ns / 4);
    }
    if (which === 1) pts[n - 1] = P;
    else pts[0] = P;
    return { ...strip(pl), pts, ...(pl.bulges ? { bulges: bul } : {}) } as NewEntity;
  }
  return null;
}
const strip = <T extends DraftEntity>(e: T) => {
  const { id: _i, layer: _l, ...rest } = e;
  void _i;
  void _l;
  return rest;
};

/**
 * Změna délky na konci `which` o `delta` (záporné = zkrácení): zkrácení přes parametr délky (všechny druhy),
 * prodloužení po přirozeném prodloužení (úsečka, oblouk, krajní úsek křivky, eliptický oblouk).
 */
export function lengthenBy(e: DraftEntity, ec: EC, which: 0 | 1, delta: number): NewEntity | null {
  const L = ec.len(ec.lo, ec.hi);
  if (delta < 0) {
    if (-delta >= L - 1e-12) throw new Error("tooShort");
    if (which === 1) return ec.piece(ec.lo, ec.atLen(ec.lo, L + delta));
    return ec.piece(ec.atLen(ec.lo, -delta), ec.hi);
  }
  if (delta === 0) return null;
  if (!ec.extendable) throw new Error("notExtendable");
  const end = ec.at(which === 1 ? ec.hi : ec.lo);
  const arcS = endArc(e, ec, which);
  if (arcS) {
    const da = delta / arcS.r;
    if (e.type === "arc" && rad(normDeg((e as DArc).a1 - (e as DArc).a0)) + da >= TAU - 1e-12) throw new Error("full");
    return extendTo(e, which, polar(arcS.c, arcS.ang + (arcS.ccw ? da : -da), arcS.r));
  }
  if (e.type === "ellipse") {
    const T = which === 1 ? ec.hi : ec.lo;
    const sp = (t: number) => len(sub(ec.at(t + 1e-7), ec.at(t - 1e-7))) / 2e-7;
    const span = TAU - (ec.hi - ec.lo);
    if (which === 1) {
      const t = paramAtLen(ec.len, sp, T, T + span, delta);
      return extendTo(e, 1, ec.at(t));
    }
    // dozadu: hledá se t < T s délkou (t, T) = delta
    let lo = T - span;
    let hi = T;
    for (let k = 0; k < 80; k++) {
      const m = (lo + hi) / 2;
      if (ec.len(m, T) > delta) lo = m;
      else hi = m;
    }
    return extendTo(e, 0, ec.at((lo + hi) / 2));
  }
  const dir = outward(ec, which);
  return extendTo(e, which, add(end, mul(unit(dir), delta)));
}

/** délka a (u oblouku) úhel entity */
export function lengthInfo(e: DraftEntity, ec: EC): { length: number; angle?: number } {
  const length = ec.len(ec.lo, ec.hi);
  return e.type === "arc" ? { length, angle: deg(ec.hi - ec.lo) } : { length };
}
