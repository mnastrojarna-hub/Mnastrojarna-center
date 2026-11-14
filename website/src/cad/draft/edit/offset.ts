/**
 * BALÍK 1 (edit) – ekvidistanta (OFFSET): úsečka, přímka, polopřímka a kružnice / oblouk přesně; křivka s oblouky
 * přesně po úsecích (úsečka → rovnoběžka, oblouk → soustředný oblouk) se spojením sousedních úseků v průsečíku
 * prodloužení (OFFSETGAPTYPE 0), zaniklé oblouky se vypustí; elipsa a spline → spline proložený body ekvidistanty.
 */
import { cClosest, cIntersect, type Curve } from "../curves";
import { add, angleOf, bulgeArc, cross, dist, dot, len, lerp, mul, normA, polar, rot90, sub, TAU, unit } from "../geom";
import type { KindCtx } from "../kinds";
import { polylineArea, polylineCurves, splineFromFit } from "../kinds-core";
import type { DPolyline, DraftEntity, NewEntity, Vec2 } from "../model";
import { editCurve } from "./param";
import { tolAt } from "./tol";

const tolOf = (p: Vec2) => tolAt(p, 1e-9);

/** strana bodu P vůči entitě: +1 vlevo od směru (nebo ven u kružnice / oblouku), −1 vpravo (dovnitř) */
export function offsetSide(e: DraftEntity, P: Vec2, ctx: KindCtx): number {
  if (e.type === "circle" || e.type === "arc") return dist(P, e.c) >= e.r ? 1 : -1;
  const ec = editCurve(e, ctx);
  if (!ec) return 1;
  let u = ec.param(P);
  if (Number.isFinite(ec.lo)) u = Math.max(ec.lo, u);
  if (Number.isFinite(ec.hi)) u = Math.min(ec.hi, u);
  const Q = ec.at(u);
  // nejbližší bod ve vrcholu křivky: bod na prodloužení jednoho úseku má vůči jeho tečně nulový vektorový součin –
  // rozhodne tečna před / za vrcholem s větším |součinem| (mimo vypuklý roh mají obě stejné znaménko)
  const du = 1e-7 * (Number.isFinite(ec.hi - ec.lo) ? Math.max(1e-9, ec.hi - ec.lo) : 1);
  let c = cross(ec.tan(u), sub(P, Q));
  for (const v of [u - du, u + du]) {
    if ((Number.isFinite(ec.lo) && v < ec.lo && !ec.periodic) || (Number.isFinite(ec.hi) && v > ec.hi && !ec.periodic)) continue;
    const cv = cross(ec.tan(v), sub(P, Q));
    if (Math.abs(cv) > Math.abs(c)) c = cv;
  }
  if (Math.abs(c) > 1e-12) return c > 0 ? 1 : -1;
  return 1;
}

/** vzdálenost bodu od entity (OFFSET Bodem) */
export function offsetDistTo(e: DraftEntity, P: Vec2, ctx: KindCtx): number {
  if (e.type === "circle" || e.type === "arc") return Math.abs(dist(P, e.c) - e.r);
  const ec = editCurve(e, ctx);
  if (!ec) return 0;
  if (e.type === "line" || e.type === "xline" || e.type === "ray") {
    const u = ec.param(P);
    return dist(P, ec.at(u));
  }
  let u = ec.param(P);
  if (Number.isFinite(ec.lo)) u = Math.max(ec.lo, u);
  if (Number.isFinite(ec.hi)) u = Math.min(ec.hi, u);
  return dist(P, ec.at(u));
}

type OSeg = { a: Vec2; b: Vec2; arc: { c: Vec2; r: number; s: number } | null };

/** úhel oblouku se znaménkem směru `s` z bodu a do bodu b kolem c */
function sweepOf(c: Vec2, a: Vec2, b: Vec2, s: number): number {
  const fa = angleOf(sub(a, c));
  const fb = angleOf(sub(b, c));
  return s > 0 ? normA(fb - fa) : -normA(fa - fb);
}

/** nosná křivka úseku (přímka / celá kružnice) pro průsečík sousedů */
const carrier = (s: OSeg): Curve => (s.arc ? { k: "arc", c: s.arc.c, r: s.arc.r, a0: 0, sweep: TAU } : { k: "line", a: s.a, b: s.b, inf: 2 });

type PSeg = OSeg & { v: Vec2; w: Vec2 };

/**
 * Spojí posunuté úseky: soused v průsečíku nosných křivek nejblíž původnímu vrcholu, bez průsečíku obloukem kolem
 * vrcholu. Vrací body a vydutí výsledné křivky a indexy úseků, které se spojením obrátily (zanikly).
 */
function joinSegs(segs: PSeg[], closed: boolean, side: number): { pts: Vec2[]; bul: number[]; reversed: number[] } {
  const m = segs.length;
  const pts: Vec2[] = [];
  const bul: number[] = [];
  const reversed: number[] = [];
  const joins: (Vec2 | null)[] = new Array(m).fill(null); // bod mezi úsekem k a k+1
  const extra: ({ c: Vec2; s: number } | null)[] = new Array(m).fill(null);
  const pairs = closed ? m : m - 1;
  for (let k = 0; k < pairs; k++) {
    const A = segs[k];
    const B = segs[(k + 1) % m];
    if (dist(A.b, B.a) <= tolOf(A.b)) {
      joins[k] = A.b;
      continue;
    }
    const V = A.w;
    const xs = m > 1 ? cIntersect(carrier(A), carrier(B), true) : [];
    let best: Vec2 | null = null;
    let bd = Infinity;
    for (const x of xs) {
      const dd = dist(x, V);
      if (dd < bd) {
        bd = dd;
        best = x;
      }
    }
    if (best) joins[k] = best;
    else if (dist(A.w, B.v) <= tolOf(A.w)) {
      // žádný rozumný průsečík (rovnoběžné úseky obrácené o 180°, míjející se oblouky): oblouk kolem vrcholu
      joins[k] = null;
      extra[k] = { c: V, s: side < 0 ? 1 : -1 };
    } else joins[k] = null; // úseky v originále nesousedí (mezi nimi zanikl úsek) – spojí je úsečka

  }
  const startOf = (k: number) => (k === 0 && !closed ? segs[0].a : joins[(k - 1 + m) % m] ?? segs[k].a);
  const endOf = (k: number) => (k === m - 1 && !closed ? segs[m - 1].b : joins[k] ?? segs[k].b);
  for (let k = 0; k < m; k++) {
    const s = segs[k];
    const a = startOf(k);
    const b = endOf(k);
    pts.push(a);
    if (s.arc) {
      const sw = sweepOf(s.arc.c, a, b, s.arc.s);
      // přetočený oblouk = úsek zanikl mezi sousedy
      if (Math.abs(sw) > Math.abs(s.arc.s) + Math.PI) reversed.push(k);
      bul.push(Math.tan(sw / 4));
    } else {
      // úsečka obrácená proti původnímu směru (nebo nulová) = zanikla
      const o = sub(s.w, s.v);
      if (dot(sub(b, a), o) <= 1e-12 * dot(o, o)) reversed.push(k);
      bul.push(0);
    }
    if (extra[k] && (closed || k < m - 1)) {
      // spojovací oblouk kolem původního vrcholu (poloměr d)
      const nb = segs[(k + 1) % m].a;
      pts.push(b);
      const sw = sweepOf(extra[k]!.c, b, nb, Math.sign(cross(sub(b, extra[k]!.c), sub(nb, extra[k]!.c))) || 1);
      bul.push(Math.tan(sw / 4));
    }
  }
  if (!closed) {
    pts.push(endOf(m - 1));
    bul.push(0);
  }
  return { pts, bul, reversed };
}

/**
 * Ekvidistanta křivky (přesně po úsecích). side +1 = vlevo od směru vrcholů. Úseky, které se na vnitřní straně
 * obrátí (krátká hrana, malý oblouk), se vypustí a sousedé se spojí znovu (jako AutoCAD); uzavřená křivka, která
 * by se celá obrátila (vnitřní ekvidistanta větší než polovina šířky), zanikne → null.
 */
export function offsetPolyline(e: DPolyline, d: number, side: number): NewEntity[] {
  const n = e.pts.length;
  const cnt = e.closed ? n : n - 1;
  let segs: PSeg[] = [];
  for (let i = 0; i < cnt; i++) {
    const a = e.pts[i];
    const b = e.pts[(i + 1) % n];
    if (dist(a, b) < 1e-12) continue;
    const bu = e.bulges?.[i] ?? 0;
    if (Math.abs(bu) > 1e-12) {
      const arc = bulgeArc(a, b, bu);
      const r2 = arc.r - Math.sign(arc.sweep) * side * d;
      if (r2 <= 1e-9 * Math.max(1, arc.r)) continue; // oblouk zanikl
      segs.push({ a: add(arc.c, mul(unit(sub(a, arc.c)), r2)), b: add(arc.c, mul(unit(sub(b, arc.c)), r2)), arc: { c: arc.c, r: r2, s: arc.sweep }, v: a, w: b });
    } else {
      const nrm = mul(unit(rot90(sub(b, a))), side * d);
      segs.push({ a: add(a, nrm), b: add(b, nrm), arc: null, v: a, w: b });
    }
  }
  if (!segs.length) return [];
  /**
   * Obrácený úsek zanikne (vypustí se a sousedé se spojí), jen když se sousedé po jeho vypuštění protnou – jinak
   * (rovnoběžní sousedé: úzká drážka „U“ s ekvidistantou ≥ polovina šířky) úsek zůstane na posunuté poloze; uzavřenou
   * křivku, která se tím obrátila, vyřadí kontrola plochy níže.
   */
  const collapsible = (k: number) => {
    const m = segs.length;
    const closed = !!e.closed;
    if (!closed && (k === 0 || k === m - 1)) return true;
    if (m < 3) return true;
    const A = segs[(k - 1 + m) % m];
    const B = segs[(k + 1) % m];
    return cIntersect(carrier(A), carrier(B), true).length > 0;
  };
  let res = joinSegs(segs, !!e.closed, side);
  for (let guard = 0; ; guard++) {
    const bad = new Set(res.reversed.filter(collapsible));
    if (!bad.size) break;
    if (guard >= cnt) return [];
    segs = segs.filter((_, k) => !bad.has(k));
    if (segs.length < (e.closed ? 2 : 1)) return [];
    res = joinSegs(segs, !!e.closed, side);
  }
  const { pts, bul } = res;
  // odstranit nulové úseky
  const P: Vec2[] = [];
  const Bu: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    if (P.length && dist(P[P.length - 1], pts[i]) <= tolOf(pts[i])) {
      Bu[Bu.length - 1] = bul[i];
      continue;
    }
    P.push(pts[i]);
    Bu.push(bul[i]);
  }
  if (e.closed && P.length > 1 && dist(P[0], P[P.length - 1]) <= tolOf(P[0])) {
    P.pop();
    Bu.pop();
  }
  if (!e.closed) foldEnds(P, Bu);
  if (P.length < 2) return [];
  const raw = { pts: P, bulges: Bu, closed: !!e.closed };
  const a0 = e.closed ? polylineArea(e) : 0;
  const out: NewEntity[] = [];
  for (const ch of trimLoops(raw, e, d)) {
    if (ch.closed) {
      // uzavřená: plocha musí mít stejné znaménko jako původní (jinak se ekvidistanta obrátila – zanikla)
      if (ch.pts.length < 3 && !ch.bulges.some((b) => Math.abs(b) > 1e-12)) continue;
      const a1 = polylineArea(ch);
      if (Math.sign(a0) !== Math.sign(a1) || Math.abs(a1) <= 1e-12 * Math.max(1, Math.abs(a0))) continue;
    }
    out.push({
      type: "polyline",
      pts: ch.pts,
      ...(ch.bulges.some((b) => Math.abs(b) > 1e-12) ? { bulges: ch.bulges } : {}),
      ...(ch.closed ? { closed: true } : {}),
      ...(e.width ? { width: e.width } : {}),
    } as NewEntity);
  }
  return out;
}

/**
 * Otevřená ekvidistanta, jejíž krajní rovný úsek se vrací po předchozím (otočka o 180°, např. drážka „U“ s ekvidistantou
 * přesně v polovině šířky): krajní úsek leží celý na sousedním → vypustí se (výsledek nevede dvakrát po téže čáře).
 */
function foldEnds(P: Vec2[], Bu: number[]) {
  const folded = (a: Vec2, b: Vec2, c: Vec2) => {
    const u = sub(b, a);
    const v = sub(c, b);
    const lu = len(u);
    const lv = len(v);
    return lu > 0 && lv > 0 && dot(u, v) < 0 && Math.abs(cross(u, v)) <= 1e-12 * lu * lv;
  };
  for (let guard = 0; P.length >= 3 && guard < P.length; guard++) {
    const n = P.length;
    // konec: poslední úsek se vrací po předposledním a není delší
    if (Math.abs(Bu[n - 3]) <= 1e-12 && Math.abs(Bu[n - 2]) <= 1e-12 && folded(P[n - 3], P[n - 2], P[n - 1]) && dist(P[n - 2], P[n - 1]) <= dist(P[n - 3], P[n - 2]) + tolOf(P[n - 1])) {
      P.pop();
      Bu.pop();
      Bu[Bu.length - 1] = 0;
      continue;
    }
    // začátek: první úsek se vrací po druhém (čteno od začátku) a není delší
    if (Math.abs(Bu[0]) <= 1e-12 && Math.abs(Bu[1]) <= 1e-12 && folded(P[2], P[1], P[0]) && dist(P[0], P[1]) <= dist(P[1], P[2]) + tolOf(P[0])) {
      P.shift();
      Bu.shift();
      continue;
    }
    break;
  }
}

// ---------------------------------------------------------------- odstranění smyček (globální samoprůniky)

/** orientovaný úsek: úsečka a→b nebo oblouk se středem c, počátečním úhlem a0 a znaménkovým úhlem sw */
type DS = { a: Vec2; b: Vec2; arc: { c: Vec2; r: number; a0: number; sw: number } | null };
type Chain = { pts: Vec2[]; bulges: number[]; closed: boolean };

const dsAt = (s: DS, t: number): Vec2 => (s.arc ? polar(s.arc.c, s.arc.a0 + s.arc.sw * t, s.arc.r) : t <= 0 ? s.a : t >= 1 ? s.b : lerp(s.a, s.b, t));
const dsCurve = (s: DS): Curve => (s.arc ? (s.arc.sw >= 0 ? { k: "arc", c: s.arc.c, r: s.arc.r, a0: normA(s.arc.a0), sweep: s.arc.sw } : { k: "arc", c: s.arc.c, r: s.arc.r, a0: normA(s.arc.a0 + s.arc.sw), sweep: -s.arc.sw }) : { k: "line", a: s.a, b: s.b });
function dsParam(s: DS, p: Vec2): number {
  if (!s.arc) {
    const d = sub(s.b, s.a);
    return Math.max(0, Math.min(1, dot(sub(p, s.a), d) / (dot(d, d) || 1)));
  }
  const A = angleOf(sub(p, s.arc.c));
  let x = s.arc.sw >= 0 ? normA(A - s.arc.a0) : normA(s.arc.a0 - A);
  const S = Math.abs(s.arc.sw);
  if (x > S + 1e-9) x = x - TAU > -1e-9 ? 0 : x;
  return Math.max(0, Math.min(1, x / (S || 1)));
}
function dsBox(s: DS): [number, number, number, number] {
  if (!s.arc) return [Math.min(s.a[0], s.b[0]), Math.min(s.a[1], s.b[1]), Math.max(s.a[0], s.b[0]), Math.max(s.a[1], s.b[1])];
  const { c, r } = s.arc;
  return [c[0] - r, c[1] - r, c[0] + r, c[1] + r];
}
function chainSegs(ch: Chain): DS[] {
  const n = ch.pts.length;
  const cnt = ch.closed ? n : n - 1;
  const out: DS[] = [];
  for (let i = 0; i < cnt; i++) {
    const a = ch.pts[i];
    const b = ch.pts[(i + 1) % n];
    const bu = ch.bulges[i] ?? 0;
    if (Math.abs(bu) > 1e-12 && dist(a, b) > 1e-12) {
      const g = bulgeArc(a, b, bu);
      out.push({ a, b, arc: { c: g.c, r: g.r, a0: g.a0, sw: g.sweep } });
    } else out.push({ a, b, arc: null });
  }
  return out;
}

/**
 * Odstraní smyčky ekvidistanty (samoprůniky nesousedních úseků – úzká drážka při vnější ekvidistantě, zúžení při
 * vnitřní): křivka se v průsečících rozdělí a díly, jejichž střed leží blíž původní entitě než d, se vypustí;
 * zbylé díly se spojí do řetězců (při rozdělení na více částí vznikne více křivek).
 */
function trimLoops(raw: Chain, src: DPolyline, d: number): Chain[] {
  const segs = chainSegs(raw);
  const m = segs.length;
  if (m < 3 || m > 20000) return [raw];
  const closed = raw.closed;
  // průsečíky nesousedních úseků (zametání podle x)
  const boxes = segs.map(dsBox);
  const order = segs.map((_, i) => i).sort((i, j) => boxes[i][0] - boxes[j][0]);
  const cuts: number[][] = segs.map(() => []);
  let any = false;
  const tol = 1e-9 * Math.max(1, d);
  for (let oi = 0; oi < m; oi++) {
    const i = order[oi];
    const bi = boxes[i];
    for (let oj = oi + 1; oj < m; oj++) {
      const j = order[oj];
      const bj = boxes[j];
      if (bj[0] > bi[2] + tol) break;
      if (bj[1] > bi[3] + tol || bj[3] < bi[1] - tol) continue;
      const adj = Math.abs(i - j) === 1 || (closed && Math.abs(i - j) === m - 1);
      const si = segs[i];
      const sj = segs[j];
      if (!si.arc && !sj.arc) {
        // překrývající se kolineární úsečky (cIntersect je nevrací): řez v koncových bodech druhé úsečky
        const di = sub(si.b, si.a);
        const dj = sub(sj.b, sj.a);
        const Li = len(di);
        const Lj = len(dj);
        if (Li > 0 && Lj > 0 && Math.abs(cross(di, dj)) <= 1e-12 * Li * Lj && Math.abs(cross(di, sub(sj.a, si.a))) <= 1e-9 * Li * Math.max(1, d)) {
          for (const [S, T, other] of [[si, i, sj], [sj, j, si]] as const) {
            for (const q of [other.a, other.b]) {
              const t = dsParam(S, q);
              if (t > 1e-9 && t < 1 - 1e-9 && dist(dsAt(S, t), q) <= tol * 10) {
                cuts[T].push(t);
                any = true;
              }
            }
          }
          continue;
        }
      }
      for (const x of cIntersect(dsCurve(si), dsCurve(sj))) {
        const ti = dsParam(segs[i], x);
        const tj = dsParam(segs[j], x);
        if (adj) {
          // sousední úseky se dotýkají ve společném vrcholu – to není samoprůnik
          const shared = (i + 1) % m === j ? segs[i].b : segs[j].b;
          if (dist(x, shared) <= 1e-7 * Math.max(1, d)) continue;
        }
        cuts[i].push(ti);
        cuts[j].push(tj);
        any = true;
      }
    }
  }
  if (!any) return [raw];
  // původní křivky pro kontrolu vzdálenosti
  const orig = polylineCurves(src);
  const oBox = orig.map((c) => (c.k === "line" ? [Math.min(c.a[0], c.b[0]), Math.min(c.a[1], c.b[1]), Math.max(c.a[0], c.b[0]), Math.max(c.a[1], c.b[1])] : c.k === "arc" ? [c.c[0] - c.r, c.c[1] - c.r, c.c[0] + c.r, c.c[1] + c.r] : [-Infinity, -Infinity, Infinity, Infinity]));
  const lim = d * (1 - 1e-7) - 1e-9;
  const tooClose = (p: Vec2) => {
    for (let k = 0; k < orig.length; k++) {
      const b = oBox[k];
      if (p[0] < b[0] - lim || p[0] > b[2] + lim || p[1] < b[1] - lim || p[1] > b[3] + lim) continue;
      if (cClosest(orig[k], p).d < lim) return true;
    }
    return false;
  };
  // díly
  type Piece = { s: DS; t0: number; t1: number; a: Vec2; b: Vec2 };
  const kept: Piece[] = [];
  // shodné díly (překryv kolineárních úseků) jen jednou
  const q = (p: Vec2) => `${Math.round(p[0] / (tol * 1e3))},${Math.round(p[1] / (tol * 1e3))}`;
  const seen = new Set<string>();
  segs.forEach((sg, i) => {
    const ts = [0, ...cuts[i].filter((t) => t > 1e-9 && t < 1 - 1e-9).sort((x, y) => x - y), 1];
    for (let k = 0; k + 1 < ts.length; k++) {
      const t0 = ts[k];
      const t1 = ts[k + 1];
      if (t1 - t0 <= 1e-12) continue;
      if (tooClose(dsAt(sg, (t0 + t1) / 2))) continue;
      const a = dsAt(sg, t0);
      const b = dsAt(sg, t1);
      const key = `${q(a)}|${q(b)}|${q(dsAt(sg, (t0 + t1) / 2))}`;
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push({ s: sg, t0, t1, a, b });
    }
  });
  if (!kept.length) return [];
  // řetězce
  const near = (p: Vec2, q: Vec2) => dist(p, q) <= tolAt(p, 1e-7 * Math.max(1, d));
  const chains: Piece[][] = [];
  for (const pc of kept) {
    const last = chains[chains.length - 1];
    if (last && near(last[last.length - 1].b, pc.a)) last.push(pc);
    else chains.push([pc]);
  }
  if (chains.length > 1 && near(chains[chains.length - 1][chains[chains.length - 1].length - 1].b, chains[0][0].a)) chains[0] = [...chains.pop()!, ...chains[0]];
  const out: Chain[] = [];
  for (const ch of chains) {
    const isClosed = closed && near(ch[ch.length - 1].b, ch[0].a);
    const pts: Vec2[] = [];
    const bul: number[] = [];
    for (const pc of ch) {
      const bu = pc.s.arc ? Math.tan((pc.s.arc.sw * (pc.t1 - pc.t0)) / 4) : 0;
      // navazující díly téže přímky / kružnice sloučit (vrchol v místě odříznuté smyčky nepotřebujeme)
      const prev = pts.length ? { a: pts[pts.length - 1], bu: bul[bul.length - 1] } : null;
      if (prev && Math.abs(prev.bu) <= 1e-12 && Math.abs(bu) <= 1e-12 && Math.abs(cross(sub(pc.a, prev.a), sub(pc.b, pc.a))) <= 1e-12 * Math.max(1, dist(prev.a, pc.a) * dist(pc.a, pc.b)) && dot(sub(pc.a, prev.a), sub(pc.b, pc.a)) > 0) continue;
      pts.push(pc.a);
      bul.push(bu);
    }
    if (!isClosed) {
      pts.push(ch[ch.length - 1].b);
      bul.push(0);
    } else if (pts.length > 3) {
      // uzavřená: vrchol v místě řezu uprostřed rovné hrany (počátek řetězce) vypustit
      const n = pts.length;
      const A = pts[n - 1];
      const B = pts[0];
      const C = pts[1];
      if (Math.abs(bul[n - 1]) <= 1e-12 && Math.abs(bul[0]) <= 1e-12 && Math.abs(cross(sub(B, A), sub(C, B))) <= 1e-12 * Math.max(1, dist(A, B) * dist(B, C)) && dot(sub(B, A), sub(C, B)) > 0) {
        pts.shift();
        bul.shift();
      }
    }
    if (pts.length >= 2) out.push({ pts, bulges: bul, closed: isClosed });
  }
  return out;
}

/** ekvidistanta obecné hladké křivky (elipsa, spline) – spline proložený body P(t) ± d·normála */
function offsetSampled(e: DraftEntity, d: number, side: number, ctx: KindCtx): NewEntity | null {
  const ec = editCurve(e, ctx);
  if (!ec) return null;
  const N = e.type === "ellipse" ? 96 : Math.min(600, Math.max(64, ((e as { ctrl?: Vec2[] }).ctrl?.length ?? 8) * 12));
  const pts: Vec2[] = [];
  const cnt = ec.periodic ? N : N + 1;
  for (let i = 0; i < cnt; i++) {
    const u = ec.lo + ((ec.hi - ec.lo) * i) / N;
    const t = ec.tan(u);
    pts.push(add(ec.at(u), mul(rot90(t), side * d)));
  }
  const fit = splineFromFit(pts, ec.periodic);
  return { type: "spline", degree: fit.degree, ctrl: fit.ctrl, knots: fit.knots, fit: fit.fit, ...(fit.closed ? { closed: true } : {}) } as NewEntity;
}

/**
 * Ekvidistanta entity ve vzdálenosti d na stranu bodu P. Vrací geometrii (bez stylu) – u křivky i více dílů, když
 * se ekvidistanta zúžením rozdělí – nebo chybu s důvodem („radius“, „collapse“ = zanikla, „kind“ = nelze).
 */
export function offsetEntity(e: DraftEntity, d: number, P: Vec2, ctx: KindCtx): NewEntity[] {
  if (!(d > 0)) throw new Error("dist");
  const side = offsetSide(e, P, ctx);
  switch (e.type) {
    case "line": {
      const n = mul(unit(rot90(sub(e.b, e.a))), side * d);
      return [{ type: "line", a: add(e.a, n), b: add(e.b, n) } as NewEntity];
    }
    case "xline":
    case "ray": {
      const n = mul(unit(rot90(e.dir)), side * d);
      return [{ type: e.type, p: add(e.p, n), dir: e.dir } as NewEntity];
    }
    case "circle":
    case "arc": {
      const r = e.r + side * d;
      if (r <= 1e-12) throw new Error("radius");
      return [(e.type === "circle" ? { type: "circle", c: e.c, r } : { type: "arc", c: e.c, r, a0: e.a0, a1: e.a1 }) as NewEntity];
    }
    case "polyline": {
      const r = offsetPolyline(e, d, side);
      if (!r.length) throw new Error("collapse");
      return r;
    }
    case "ellipse":
    case "spline": {
      const r = offsetSampled(e, d, side, ctx);
      if (!r) throw new Error("kind");
      return [r];
    }
    default:
      throw new Error("kind");
  }
}

/** náhled ekvidistanty (bez výjimek) */
export function offsetPreview(e: DraftEntity, d: number, P: Vec2, ctx: KindCtx): NewEntity[] {
  try {
    return offsetEntity(e, d, P, ctx);
  } catch {
    return [];
  }
}

/** vzdálenost bodu od přímky (pomůcka testů a náhledu) */
export const lineDist = (p: Vec2, a: Vec2, b: Vec2) => Math.abs(cross(sub(b, a), sub(p, a))) / (len(sub(b, a)) || 1);
