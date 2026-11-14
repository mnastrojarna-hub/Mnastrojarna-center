/**
 * BALÍK 1 (edit) – zaoblení (FILLET) a zkosení (CHAMFER): dvě úsečky (i rovnoběžné), úsečka / oblouk / kružnice
 * obecně (středy z průsečíků ekvidistant), všechny vrcholy křivky, oříznutí / prodloužení objektů k bodům dotyku.
 * Přesně: tečné body a střed analyticky, poloměr přesně zadaný.
 */
import { tr } from "../../i18n";
import { cClosest, cIntersect, type Curve } from "../curves";
import { add, angleOf, cross, deg, dist, dot, mul, normA, rot90, sub, TAU, unit } from "../geom";
import { entityCurves, type KindCtx } from "../kinds";
import type { DPolyline, DraftEntity, NewEntity, Vec2 } from "../model";
import { normDeg } from "../units";
import { extendTo } from "./cut";
import { editCurve } from "./param";
import { tolAt } from "./tol";

export type Carrier = { kind: "line"; a: Vec2; b: Vec2 } | { kind: "circle"; c: Vec2; r: number };
export type Pick = { e: DraftEntity; p: Vec2; ci: number; car: Carrier };

/** nosná křivka v místě výběru (úsek křivky nejbližší bodu) */
export function pickCarrier(e: DraftEntity, p: Vec2, ctx: KindCtx): Pick | null {
  const cs = entityCurves(e, ctx);
  let ci = -1;
  let bd = Infinity;
  cs.forEach((c, i) => {
    if (c.k !== "line" && c.k !== "arc") return;
    const d = cClosest(c, p).d;
    if (d < bd) {
      bd = d;
      ci = i;
    }
  });
  if (ci < 0) return null;
  const c = cs[ci];
  if (c.k === "line") return { e, p, ci, car: { kind: "line", a: c.a, b: c.b } };
  if (c.k === "arc") return { e, p, ci, car: { kind: "circle", c: c.c, r: c.r } };
  return null;
}

const carrierCurve = (c: Carrier): Curve => (c.kind === "line" ? { k: "line", a: c.a, b: c.b, inf: 2 } : { k: "arc", c: c.c, r: c.r, a0: 0, sweep: TAU });
const foot = (c: Carrier, X: Vec2): Vec2 => {
  if (c.kind === "circle") return add(c.c, mul(unit(sub(X, c.c)), c.r));
  const d = sub(c.b, c.a);
  return add(c.a, mul(d, dot(sub(X, c.a), d) / dot(d, d)));
};
function offsets(c: Carrier, r: number): Curve[] {
  if (c.kind === "line") {
    const n = mul(unit(rot90(sub(c.b, c.a))), r);
    return [
      { k: "line", a: add(c.a, n), b: add(c.b, n), inf: 2 },
      { k: "line", a: sub(c.a, n), b: sub(c.b, n), inf: 2 },
    ];
  }
  const out: Curve[] = [{ k: "arc", c: c.c, r: c.r + r, a0: 0, sweep: TAU }];
  if (Math.abs(c.r - r) > 1e-12 * Math.max(1, c.r)) out.push({ k: "arc", c: c.c, r: Math.abs(c.r - r), a0: 0, sweep: TAU });
  return out;
}

/** `bulge` = směr vydutí oblouku u rovnoběžných úseček (půlkružnice) */
export type FilletGeom = { T1: Vec2; T2: Vec2; X: Vec2 | null; r: number; corner: Vec2 | null; bulge?: Vec2 };

/**
 * Zaoblení dvou nosných křivek poloměrem r (r = 0 = roh v průsečíku). Úsečky: osa úhlu směrem k bodům výběru (přesně),
 * rovnoběžné úsečky: půlkružnice; jinak střed z průsečíků ekvidistant nejblíž bodům výběru.
 */
export function filletGeom(A: Pick, B: Pick, r: number): FilletGeom | null {
  const c1 = A.car;
  const c2 = B.car;
  if (c1.kind === "line" && c2.kind === "line") {
    const d1 = unit(sub(c1.b, c1.a));
    const d2 = unit(sub(c2.b, c2.a));
    const den = cross(d1, d2);
    if (Math.abs(den) < 1e-12) {
      // rovnoběžné: půlkružnice na konci prvního objektu u bodu výběru
      const D = Math.abs(cross(d1, sub(c2.a, c1.a)));
      if (D < 1e-12) return null;
      const ends = [c1.a, c1.b];
      const near = dist(ends[0], A.p) <= dist(ends[1], A.p) ? 0 : 1;
      const E = ends[near];
      const T2 = foot(c2, E);
      const X = mul(add(E, T2), 0.5);
      return { T1: E, T2, X, r: D / 2, corner: null, bulge: unit(sub(E, ends[1 - near])) };
    }
    const P = add(c1.a, mul(d1, cross(sub(c2.a, c1.a), d2) / den));
    const s1 = dot(sub(foot(c1, A.p), P), d1) >= 0 ? 1 : -1;
    const s2 = dot(sub(foot(c2, B.p), P), d2) >= 0 ? 1 : -1;
    const u1 = mul(d1, s1);
    const u2 = mul(d2, s2);
    if (r <= 0) return { T1: P, T2: P, X: null, r: 0, corner: P };
    const th = Math.acos(Math.max(-1, Math.min(1, dot(u1, u2))));
    if (th < 1e-12 || Math.PI - th < 1e-12) return null;
    const t = r / Math.tan(th / 2);
    const X = add(P, mul(unit(add(u1, u2)), r / Math.sin(th / 2)));
    return { T1: add(P, mul(u1, t)), T2: add(P, mul(u2, t)), X, r, corner: P };
  }
  if (r <= 0) {
    const xs = cIntersect(carrierCurve(c1), carrierCurve(c2), true);
    if (!xs.length) return null;
    const m = mul(add(A.p, B.p), 0.5);
    const P = xs.reduce((b, x) => (dist(x, m) < dist(b, m) ? x : b), xs[0]);
    return { T1: P, T2: P, X: null, r: 0, corner: P };
  }
  let best: FilletGeom | null = null;
  let bd = Infinity;
  for (const o1 of offsets(c1, r))
    for (const o2 of offsets(c2, r))
      for (const X of cIntersect(o1, o2, true)) {
        const T1 = foot(c1, X);
        const T2 = foot(c2, X);
        const sc = dist(T1, A.p) + dist(T2, B.p);
        if (sc < bd) {
          bd = sc;
          best = { T1, T2, X, r, corner: null };
        }
      }
  return best;
}

/** kratší oblouk se středem X z T1 do T2 (geometrie entity); `bulge` = vydutí do daného směru (půlkružnice) */
export function filletArc(X: Vec2, r: number, T1: Vec2, T2: Vec2, bulge?: Vec2): NewEntity {
  const a1 = angleOf(sub(T1, X));
  const a2 = angleOf(sub(T2, X));
  let ccw = normA(a2 - a1) <= Math.PI;
  if (bulge) {
    const m = a1 + normA(a2 - a1) / 2;
    ccw = Math.cos(m) * bulge[0] + Math.sin(m) * bulge[1] > 0;
  }
  return { type: "arc", c: X, r, a0: normDeg(deg(ccw ? a1 : a2)), a1: normDeg(deg(ccw ? a2 : a1)) } as NewEntity;
}

/** znaménkový menší úhel z T1 do T2 kolem X */
export const minorSweep = (X: Vec2, T1: Vec2, T2: Vec2) => Math.atan2(cross(sub(T1, X), sub(T2, X)), dot(sub(T1, X), sub(T2, X)));

/**
 * Oříznutí / prodloužení vybraného objektu k bodu T tak, aby zůstala část na straně bodu výběru. U dvou úseček
 * (`corner` = průsečík nosných přímek) rozhoduje strana výběru vůči průsečíku – jako AutoCAD: výběr přímo v bodě
 * dotyku nebo mezi rohem a bodem dotyku zachová díl odvrácený od rohu. Leží-li bod dotyku za vzdáleným koncem
 * zachovaného dílu, je poloměr / vzdálenost pro objekt příliš velký (chyba, nic se nezmění).
 * Kružnice se nemění (null), u křivky se prodlužuje jen krajní úsek.
 */
export function trimToPoint(pk: Pick, T: Vec2, ctx: KindCtx, corner?: Vec2 | null): NewEntity | null {
  const e = pk.e;
  if (e.type === "circle") return null;
  const ec = editCurve(e, ctx);
  if (!ec || ec.periodic) return null;
  const uT = ec.paramOn(pk.ci, T);
  const up = Math.max(ec.lo, Math.min(ec.hi, ec.paramOn(pk.ci, pk.p)));
  const tol = 1e-12 * Math.max(1, Math.abs(ec.hi));
  const ref = corner ? ec.paramOn(pk.ci, corner) : uT;
  if (up >= ref - tol) {
    if (corner && uT >= ec.hi - tol) throw new Error(tr("{0}: poloměr nebo vzdálenost je příliš velká – bod dotyku leží za koncem objektu", e.id));
    if (Math.abs(uT - ec.lo) <= tol) return null;
    if (uT < ec.lo) return e.type === "polyline" ? extendTo(e, 0, T) : ec.piece(uT, ec.hi);
    return ec.piece(uT, ec.hi);
  }
  if (corner && uT <= ec.lo + tol) throw new Error(tr("{0}: poloměr nebo vzdálenost je příliš velká – bod dotyku leží za koncem objektu", e.id));
  if (Math.abs(uT - ec.hi) <= tol) return null;
  if (uT > ec.hi) return e.type === "polyline" ? extendTo(e, 1, T) : ec.piece(ec.lo, uT);
  return ec.piece(ec.lo, uT);
}

/** zkosení dvou úseček: vzdálenosti d1, d2 od průsečíku na stranách bodů výběru */
export function chamferGeom(A: Pick, B: Pick, d1: number, d2: number): { C1: Vec2; C2: Vec2; corner: Vec2 } | null {
  if (A.car.kind !== "line" || B.car.kind !== "line") return null;
  const e1 = unit(sub(A.car.b, A.car.a));
  const e2 = unit(sub(B.car.b, B.car.a));
  const den = cross(e1, e2);
  if (Math.abs(den) < 1e-12) return null;
  const P = add(A.car.a, mul(e1, cross(sub(B.car.a, A.car.a), e2) / den));
  const s1 = dot(sub(foot(A.car, A.p), P), e1) >= 0 ? 1 : -1;
  const s2 = dot(sub(foot(B.car, B.p), P), e2) >= 0 ? 1 : -1;
  return { C1: add(P, mul(e1, s1 * d1)), C2: add(P, mul(e2, s2 * d2)), corner: P };
}

/** druhá vzdálenost zkosení z délky na první úsečce a úhlu (metoda Úhel) */
export function chamferByAngle(A: Pick, B: Pick, d1: number, angDeg: number): number | null {
  const g = chamferGeom(A, B, 1, 1);
  if (!g) return null;
  const u1 = unit(sub(g.C1, g.corner));
  const u2 = unit(sub(g.C2, g.corner));
  const th = Math.acos(Math.max(-1, Math.min(1, dot(u1, u2))));
  const a = (angDeg * Math.PI) / 180;
  const s = Math.sin(Math.PI - th - a);
  if (s <= 1e-12) return null;
  return (d1 * Math.sin(a)) / s;
}

type VFill = { k: number; t1: number; t2: number; T1: Vec2; T2: Vec2; bulge: number };

/** úsekové délky křivky (jen přímé úseky; oblouk = null) */
function lineSegs(e: DPolyline): ({ a: Vec2; b: Vec2; L: number } | null)[] {
  const n = e.pts.length;
  const cnt = e.closed ? n : n - 1;
  const out: ({ a: Vec2; b: Vec2; L: number } | null)[] = [];
  for (let i = 0; i < cnt; i++) {
    const a = e.pts[i];
    const b = e.pts[(i + 1) % n];
    out.push(Math.abs(e.bulges?.[i] ?? 0) > 1e-12 ? null : { a, b, L: dist(a, b) });
  }
  return out;
}

/**
 * Zaoblení (r > 0) nebo zkosení (d1, d2) vrcholů křivky mezi přímými úseky. `only` = jen tento vrchol.
 * Vrcholy, kde jsou úseky příliš krátké, se přeskočí. Vrací novou křivku a počet upravených vrcholů.
 */
export function cornerPolyline(e: DPolyline, mode: { r?: number; d1?: number; d2?: number; ang?: number }, only?: number): { geom: NewEntity; count: number; skipped: number } {
  const n = e.pts.length;
  const segs = lineSegs(e);
  const cnt = segs.length;
  const used = new Array(cnt).fill(0).map(() => [0, 0]);
  const fills: (VFill | null)[] = new Array(n).fill(null);
  let skipped = 0;
  for (let k = 0; k < n; k++) {
    if (only !== undefined && k !== only) continue;
    if (!e.closed && (k === 0 || k === n - 1)) continue;
    const ip = (k - 1 + cnt) % cnt;
    const inx = k % cnt;
    const s1 = segs[ip];
    const s2 = segs[inx];
    if (!s1 || !s2 || s1.L < 1e-12 || s2.L < 1e-12) continue;
    const V = e.pts[k];
    const u1 = unit(sub(s1.a, V));
    const u2 = unit(sub(s2.b, V));
    const th = Math.acos(Math.max(-1, Math.min(1, dot(u1, u2))));
    if (th < 1e-9 || Math.PI - th < 1e-9) continue;
    let t1: number;
    let t2: number;
    let bulge = 0;
    if (mode.r !== undefined) {
      t1 = t2 = mode.r / Math.tan(th / 2);
      const sweep = Math.sign(cross(mul(u1, -1), u2)) * (Math.PI - th);
      bulge = Math.tan(sweep / 4);
    } else {
      t1 = mode.d1 ?? 0;
      if (mode.ang !== undefined) {
        // délka na prvním úseku a úhel od něj: sinová věta v trojúhelníku vrchol – C1 – C2
        const a = (mode.ang * Math.PI) / 180;
        const sn = Math.sin(Math.PI - th - a);
        if (sn <= 1e-12) {
          skipped++;
          continue;
        }
        t2 = (t1 * Math.sin(a)) / sn;
      } else t2 = mode.d2 ?? 0;
    }
    if (t1 > s1.L - used[ip][0] + 1e-9 || t2 > s2.L + 1e-9) {
      skipped++;
      continue;
    }
    used[ip][1] = t1;
    used[inx][0] = t2;
    fills[k] = { k, t1, t2, T1: add(V, mul(u1, t1)), T2: add(V, mul(u2, t2)), bulge };
  }
  const pts: Vec2[] = [];
  const bul: number[] = [];
  let count = 0;
  for (let k = 0; k < n; k++) {
    const f = fills[k];
    const ob = e.bulges?.[k] ?? 0;
    if (!f || (f.t1 < 1e-12 && f.t2 < 1e-12)) {
      pts.push(e.pts[k]);
      bul.push(ob);
      continue;
    }
    count++;
    pts.push(f.T1, f.T2);
    bul.push(f.bulge, ob);
  }
  dropTiny(pts, bul, !!e.closed);
  return { geom: { type: "polyline", pts, ...(bul.some((b) => Math.abs(b) > 1e-12) ? { bulges: bul } : {}), ...(e.closed ? { closed: true } : {}), ...(e.width ? { width: e.width } : {}) } as NewEntity, count, skipped };
}

/**
 * Sloučí vrcholy, mezi kterými zbyl nulový úsek (tečné body sousedních zaoblení se potkaly – poloměr = polovina
 * strany): bez toho by křivka měla úseky délky ~1e-15 s obráceným směrem. Vydutí nulového úseku se zahodí.
 */
function dropTiny(pts: Vec2[], bul: number[], closed: boolean) {
  for (let i = 0; i + 1 < pts.length; ) {
    if (dist(pts[i], pts[i + 1]) <= tolAt(pts[i], 1e-9)) {
      pts.splice(i + 1, 1);
      bul.splice(i, 1);
    } else i++;
  }
  if (closed && pts.length > 2 && dist(pts[pts.length - 1], pts[0]) <= tolAt(pts[0], 1e-9)) {
    // nulový úsek poslední → první: vypadne poslední vrchol i vydutí toho úseku
    pts.pop();
    bul.pop();
  }
}

/** index vrcholu mezi dvěma sousedními úseky křivky (null = nesousedí) */
export function sharedVertex(e: DPolyline, s1: number, s2: number): number | null {
  const n = e.pts.length;
  const cnt = e.closed ? n : n - 1;
  if ((s1 + 1) % cnt === s2 && (e.closed || s1 + 1 < n - 1 || s2 === s1 + 1)) return (s1 + 1) % n;
  if ((s2 + 1) % cnt === s1) return (s2 + 1) % n;
  return null;
}

/** úsek křivky výběru (index vrcholu, kde úsek začíná) */
export const segOfPick = (e: DraftEntity, pk: Pick, ctx: KindCtx) => entityCurves(e, ctx)[pk.ci]?.seg ?? 0;

