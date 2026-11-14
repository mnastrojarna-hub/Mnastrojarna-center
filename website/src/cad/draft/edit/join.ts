/**
 * BALÍK 1 (edit) – SPOJIT (kolineární úsečky → úsečka, oblouky jedné kružnice → oblouk / kružnice, oblouky jedné
 * elipsy → eliptický oblouk, jinak řetěz konců → křivka, se splajnem / elipsou → spline), OBRÁTIT (směr úsečky,
 * křivky, splajnu) a ODSTRANIT-DUPLICITY (OVERKILL: shodné entity, překrývající se kolineární úsečky, nulové úsečky).
 */
import { tr } from "../../i18n";
import { registerCommand, type CmdCtx, type CmdGen } from "../commands";
import { bulgeArc, cross, deg, dist, dot, len, mul, normA, rad, rot90, sub, TAU, unit } from "../geom";
import { entityBox, kindLabel, type KindCtx } from "../kinds";
import type { DArc, DEllipse, DLine, DPolyline, DSpline, DraftEntity, NewEntity, Vec2 } from "../model";
import { spatialIndex } from "../spatial";
import { normDeg } from "../units";
import { arcNurbs, chainBeziers, lineNurbs, reverseNurbs, toBeziers, toDegree, type Nurbs } from "./nurbs";
import { nurbsToSpline } from "./param";
import { doneSel, EK, kc, nothing, pickObjects, replaceGeom, unlocked, askKw } from "./shared";
import { tolAt, tolNum } from "./tol";

// ---------------------------------------------------------------- díly řetězu

/** díl řetězu: konce, úseky křivky (body + vydutí), nebo NURBS */
type Piece = { id: string; s: Vec2; e: Vec2; pts: Vec2[]; bul: number[]; nurbs: Nurbs[] | null; deg: number };

function ellipseNurbs(el: DEllipse): Nurbs[] {
  const t0 = rad(el.t0 ?? 0);
  let sw = rad(normDeg((el.t1 ?? 360) - (el.t0 ?? 0)));
  if (sw < 1e-12) sw = TAU;
  const U = el.major;
  const V = mul(rot90(el.major), el.ratio);
  return arcNurbs([0, 0], 1, t0, sw).map((b) => ({ ...b, ctrl: b.ctrl.map((q) => [el.c[0] + U[0] * q[0] + V[0] * q[1], el.c[1] + U[1] * q[0] + V[1] * q[1]] as Vec2) }));
}

/** díl z entity (null = nelze řetězit: uzavřená, nekonečná, text…) */
export function pieceOf(e: DraftEntity): Piece | null {
  switch (e.type) {
    case "line":
      return { id: e.id, s: e.a, e: e.b, pts: [e.a, e.b], bul: [0], nurbs: null, deg: 1 };
    case "arc": {
      const A0 = rad(e.a0);
      let S = rad(normDeg(e.a1 - e.a0));
      if (S < 1e-12) S = TAU;
      const s: Vec2 = [e.c[0] + e.r * Math.cos(A0), e.c[1] + e.r * Math.sin(A0)];
      const t: Vec2 = [e.c[0] + e.r * Math.cos(A0 + S), e.c[1] + e.r * Math.sin(A0 + S)];
      return { id: e.id, s, e: t, pts: [s, t], bul: [Math.tan(S / 4)], nurbs: null, deg: 2 };
    }
    case "polyline": {
      if (e.closed || e.pts.length < 2) return null;
      const n = e.pts.length;
      const bul = Array.from({ length: n - 1 }, (_, i) => e.bulges?.[i] ?? 0);
      return { id: e.id, s: e.pts[0], e: e.pts[n - 1], pts: e.pts, bul, nurbs: null, deg: bul.some((b) => Math.abs(b) > 1e-12) ? 2 : 1 };
    }
    case "spline": {
      if (e.closed) return null;
      const N: Nurbs = { deg: e.degree, ctrl: e.ctrl, knots: e.knots, ...(e.weights ? { w: e.weights } : {}) };
      const b = toBeziers(N);
      if (!b.length) return null;
      return { id: e.id, s: b[0].ctrl[0], e: b[b.length - 1].ctrl[b[b.length - 1].ctrl.length - 1], pts: [], bul: [], nurbs: b, deg: e.degree };
    }
    case "ellipse": {
      if (e.t0 === undefined && e.t1 === undefined) return null;
      const b = ellipseNurbs(e);
      return { id: e.id, s: b[0].ctrl[0], e: b[b.length - 1].ctrl[2], pts: [], bul: [], nurbs: b, deg: 2 };
    }
    default:
      return null;
  }
}

function reversePiece(p: Piece): Piece {
  return {
    ...p,
    s: p.e,
    e: p.s,
    pts: [...p.pts].reverse(),
    bul: [...p.bul].reverse().map((b) => -b),
    nurbs: p.nurbs ? [...p.nurbs].reverse().map(reverseNurbs) : null,
  };
}

/** Bézierovy úseky dílu (úsečky a oblouky křivky převedené na NURBS) */
function pieceBeziers(p: Piece): Nurbs[] {
  if (p.nurbs) return p.nurbs;
  const out: Nurbs[] = [];
  for (let i = 0; i < p.pts.length - 1; i++) {
    const a = p.pts[i];
    const b = p.pts[i + 1];
    if (dist(a, b) < 1e-12) continue;
    if (Math.abs(p.bul[i]) < 1e-12) out.push(lineNurbs(a, b, 1));
    else {
      const arc = bulgeArc(a, b, p.bul[i]);
      out.push(...arcNurbs(arc.c, arc.r, arc.a0, arc.sweep));
    }
  }
  return out;
}

/**
 * Řetězy dílů spojených konci (tolerance). Pořadí: od prvního dílu (zdroje); z kandidátů na obou koncích řetězu se
 * bere díl, který je v seznamu nejdřív (stejně jako lineární průchod). Konce dílů jsou v mřížce (buňka = 2 × tolerance),
 * takže řetěz o n dílech v libovolném pořadí (import DXF, ROZLOŽIT) se sestaví v O(n), ne O(n²).
 */
export function chains(pieces: Piece[], tol: number): { parts: Piece[]; closed: boolean }[] {
  const n = pieces.length;
  const used = new Uint8Array(n);
  let maxC = 0;
  for (const p of pieces) maxC = Math.max(maxC, Math.abs(p.s[0]), Math.abs(p.s[1]), Math.abs(p.e[0]), Math.abs(p.e[1]));
  // tolAt(p, tol) ≤ tolAt([maxC, 0], tol) pro každý konec → shoda leží nejvýš v sousední buňce
  const h = 2 * tolAt([maxC, 0], tol) || 1;
  const grid = new Map<string, number[]>();
  const cell = (x: number, y: number) => `${Math.floor(x / h)},${Math.floor(y / h)}`;
  const put = (p: Vec2, i: number) => {
    const k = cell(p[0], p[1]);
    const a = grid.get(k);
    if (!a) grid.set(k, [i]);
    else if (a[a.length - 1] !== i) a.push(i);
  };
  pieces.forEach((p, i) => {
    put(p.s, i);
    put(p.e, i);
  });
  /** nepoužité díly s koncem v buňkách kolem bodu p (použité se z buněk průběžně vyřazují) */
  const near = (p: Vec2, out: Set<number>) => {
    const cx = Math.floor(p[0] / h);
    const cy = Math.floor(p[1] / h);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const k = `${cx + dx},${cy + dy}`;
        const a = grid.get(k);
        if (!a) continue;
        let w = 0;
        for (const i of a) if (!used[i]) a[w++] = i;
        a.length = w;
        if (!w) grid.delete(k);
        for (const i of a) out.add(i);
      }
  };
  const out: { parts: Piece[]; closed: boolean }[] = [];
  let next = 0;
  for (;;) {
    while (next < n && used[next]) next++;
    if (next >= n) break;
    used[next] = 1;
    // řetěz = obrácená přední část + zadní část (bez unshift – ten je O(n))
    const front: Piece[] = [];
    const back: Piece[] = [pieces[next]];
    const first = () => (front.length ? front[front.length - 1] : back[0]);
    for (;;) {
      const end = back[back.length - 1].e;
      const start = first().s;
      if (front.length + back.length > 1 && dist(end, start) <= tolAt(end, tol)) break;
      const cand = new Set<number>();
      near(end, cand);
      near(start, cand);
      let grew = false;
      for (const i of [...cand].sort((a, b) => a - b)) {
        const q = pieces[i];
        if (dist(q.s, end) <= tolAt(end, tol)) back.push(q);
        else if (dist(q.e, end) <= tolAt(end, tol)) back.push(reversePiece(q));
        else if (dist(q.e, start) <= tolAt(start, tol)) front.push(q);
        else if (dist(q.s, start) <= tolAt(start, tol)) front.push(reversePiece(q));
        else continue;
        used[i] = 1;
        grew = true;
        break;
      }
      if (!grew) break;
    }
    const chain = [...front.reverse(), ...back];
    const closed = chain.length > 1 && dist(chain[chain.length - 1].e, chain[0].s) <= tolAt(chain[0].s, tol);
    out.push({ parts: chain, closed });
  }
  return out;
}

/** řetěz → křivka (úseky a oblouky); kolineární navazující úsečky se sloučí */
export function chainToPolyline(parts: Piece[], closed: boolean): NewEntity {
  const pts: Vec2[] = [];
  const bul: number[] = [];
  for (const p of parts) {
    for (let i = 0; i < p.pts.length - 1; i++) {
      if (!pts.length) pts.push(p.pts[0]);
      const b = p.pts[i + 1];
      if (dist(pts[pts.length - 1], b) < 1e-12) continue;
      bul.push(p.bul[i]);
      pts.push(b);
    }
  }
  if (closed && pts.length > 2 && dist(pts[0], pts[pts.length - 1]) <= tolAt(pts[0], 1e-6)) pts.pop();
  else if (closed) bul.pop();
  // sloučit kolineární úsečky (prostřední vrchol)
  const P: Vec2[] = [];
  const B: number[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const prevB = B.length ? B[B.length - 1] : null;
    if (P.length >= 2 && prevB === 0 && (bul[i] ?? 0) === 0 && i < n) {
      const a = P[P.length - 2];
      const m = P[P.length - 1];
      const d1 = sub(m, a);
      const d2 = sub(pts[i], m);
      if (Math.abs(cross(d1, d2)) <= 1e-12 * len(d1) * len(d2) && dot(d1, d2) > 0) {
        P[P.length - 1] = pts[i];
        continue;
      }
    }
    P.push(pts[i]);
    B.push(bul[i] ?? 0);
  }
  return { type: "polyline", pts: P, ...(B.some((b) => Math.abs(b) > 1e-12) ? { bulges: B } : {}), ...(closed ? { closed: true } : {}) } as NewEntity;
}

/** řetěz → spline (stupeň = nejvyšší stupeň dílů, alespoň 2 s oblouky) */
export function chainToSpline(parts: Piece[], closed: boolean): NewEntity {
  const bz = parts.flatMap(pieceBeziers);
  const p = Math.max(...bz.map((b) => b.deg), ...parts.map((x) => x.deg));
  const sp = nurbsToSpline(chainBeziers(bz.map((b) => toDegree(b, p)))) as NewEntity & { closed?: boolean };
  if (closed) sp.closed = true;
  return sp;
}

// ---------------------------------------------------------------- SPOJIT

const collinear = (a: DLine, b: DLine, tol: number) => {
  const d = unit(sub(a.b, a.a));
  const off = (p: Vec2) => Math.abs(cross(d, sub(p, a.a)));
  return Math.abs(cross(d, unit(sub(b.b, b.a)))) <= 1e-9 && off(b.a) <= tolAt(b.a, tol) && off(b.b) <= tolAt(b.b, tol);
};

/**
 * Spojí entity (první = zdroj, jeho id zůstane). Vrací výsledky: nová geometrie zdroje řetězu a id spotřebovaných.
 */
export function joinGeometry(ents: DraftEntity[], tol = 1e-6): { src: DraftEntity; geom: NewEntity; used: string[] }[] {
  if (ents.length < 2) return [];
  const lines = ents.filter((e): e is DLine => e.type === "line");
  if (lines.length === ents.length && ents.every((e) => collinear(lines[0], e as DLine, tol))) {
    const d = unit(sub(lines[0].b, lines[0].a));
    const t = (p: Vec2) => dot(sub(p, lines[0].a), d);
    const ts = lines.flatMap((l) => [t(l.a), t(l.b)]);
    const lo = Math.min(...ts);
    const hi = Math.max(...ts);
    const P = (s: number): Vec2 => [lines[0].a[0] + d[0] * s, lines[0].a[1] + d[1] * s];
    const at = (s: number) => lines.flatMap((l) => [l.a, l.b]).find((q) => Math.abs(t(q) - s) < 1e-12) ?? P(s);
    return [{ src: lines[0], geom: { type: "line", a: at(lo), b: at(hi) } as NewEntity, used: lines.slice(1).map((l) => l.id) }];
  }
  const arcs = ents.filter((e): e is DArc => e.type === "arc");
  if (arcs.length === ents.length && arcs.every((a) => dist(a.c, arcs[0].c) <= tolAt(a.c, tol) && Math.abs(a.r - arcs[0].r) <= tolNum(a.r, tol))) {
    const src = arcs[0];
    const A0 = rad(src.a0);
    // od počátku zdroje proti směru hodin pokrýt všechny oblouky
    let end = 0;
    for (const a of arcs) {
      const s = normA(rad(a.a0) - A0);
      let sw = rad(normDeg(a.a1 - a.a0));
      if (sw < 1e-12) sw = TAU;
      end = Math.max(end, s + sw);
    }
    if (end >= TAU - 1e-9) return [{ src, geom: { type: "circle", c: src.c, r: src.r } as NewEntity, used: arcs.slice(1).map((a) => a.id) }];
    return [{ src, geom: { type: "arc", c: src.c, r: src.r, a0: src.a0, a1: normDeg(deg(A0 + end)) } as NewEntity, used: arcs.slice(1).map((a) => a.id) }];
  }
  const pieces = ents.map(pieceOf).filter((p): p is Piece => !!p);
  const byId = new Map(ents.map((e) => [e.id, e]));
  const out: { src: DraftEntity; geom: NewEntity; used: string[] }[] = [];
  const order = new Map(ents.map((e, i) => [e.id, i]));
  for (const ch of chains(pieces, tol)) {
    if (ch.parts.length < 2) continue;
    // zdroj = první vybraný v řetězu
    const ids = ch.parts.map((p) => p.id);
    const srcId = ids.reduce((a, b) => ((order.get(b) ?? 0) < (order.get(a) ?? 0) ? b : a));
    const src = byId.get(srcId)!;
    const spline = ch.parts.some((p) => !!p.nurbs);
    const geom = spline ? chainToSpline(ch.parts, ch.closed) : chainToPolyline(ch.parts, ch.closed);
    out.push({ src, geom, used: ids.filter((id) => id !== src.id) });
  }
  return out;
}

registerCommand({
  id: "JOIN",
  names: { cs: ["spojit"], en: ["join"], de: ["verbinden"] },
  alias: ["J"],
  group: "modify",
  desc: () => tr("spojí entity: kolineární úsečky → úsečka, oblouky jedné kružnice → oblouk (Uzavřít = kružnice), úsečky / oblouky / křivky navazující konci → křivka, se splajnem nebo eliptickým obloukem → spline"),
  usage: () => tr("spojit e1 e2 e3 | spojit vše | spojit e4 e5 uzavřít (oblouky → kružnice)"),
  run: function* (c): CmdGen {
    const ids = unlocked(c, yield* pickObjects(c, tr("Vyberte objekty ke spojení")));
    if (ids.length < 2) return nothing(c, tr("vyberte alespoň dva objekty"));
    const ents = ids.map((id) => c.tx.get(id)!);
    let res = joinGeometry(ents);
    if (ents.every((e) => e.type === "arc") && res.length === 1 && res[0].geom.type === "arc") {
      const k = yield* askKw(tr("Uzavřít oblouk na kružnici?"), [EK.close, EK.no], "no", true);
      if (k.k === "kw" && k.id === "close") res = [{ ...res[0], geom: { type: "circle", c: (res[0].geom as DArc).c, r: (res[0].geom as DArc).r } as NewEntity }];
    }
    if (!res.length) {
      c.log(tr("nic nespojeno – objekty spolu nesousedí (konce se musí dotýkat) nebo je nelze spojit"));
      return;
    }
    let used = 0;
    for (const r of res) {
      replaceGeom(c, r.src, r.geom);
      for (const id of r.used) c.tx.remove(id);
      used += r.used.length + 1;
      c.log(tr("✓ {0}: spojeno {1} objektů → {2}", r.src.id, r.used.length + 1, kindLabel(r.geom.type)));
    }
    if (used < ids.length) c.log(tr("⚠ nespojeno: {0} objektů", ids.length - used));
    doneSel(c);
  },
});

// ---------------------------------------------------------------- OBRÁTIT

/** obrácený směr úsečky, křivky a splajnu (null = druh nelze obrátit) */
export function reverseGeom(e: DraftEntity): NewEntity | null {
  if (e.type === "line") return { type: "line", a: e.b, b: e.a } as NewEntity;
  if (e.type === "polyline") {
    const pl = e as DPolyline;
    const n = pl.pts.length;
    const segs = pl.closed ? n : n - 1;
    if (pl.closed) {
      // uzavřená: začátek zůstane, pořadí ostatních vrcholů se obrátí
      const pts = [pl.pts[0], ...pl.pts.slice(1).reverse()];
      const bul = pl.bulges ? Array.from({ length: n }, (_, i) => -(pl.bulges![(n - 1 - i) % n] ?? 0)) : undefined;
      const wid = pl.widths ? Array.from({ length: n }, (_, i) => [...(pl.widths![(n - 1 - i) % n] ?? [0, 0])].reverse() as [number, number]) : undefined;
      return { ...strip(pl), pts, ...(bul ? { bulges: bul } : {}), ...(wid ? { widths: wid } : {}) } as NewEntity;
    }
    const pts = [...pl.pts].reverse();
    const bul = pl.bulges ? [...Array.from({ length: segs }, (_, i) => -(pl.bulges![segs - 1 - i] ?? 0)), 0] : undefined;
    const wid = pl.widths ? [...Array.from({ length: segs }, (_, i) => [...(pl.widths![segs - 1 - i] ?? [0, 0])].reverse() as [number, number]), [0, 0] as [number, number]] : undefined;
    return { ...strip(pl), pts, ...(bul ? { bulges: bul } : {}), ...(wid ? { widths: wid } : {}) } as NewEntity;
  }
  if (e.type === "spline") {
    const sp = e as DSpline;
    const r = reverseNurbs({ deg: sp.degree, ctrl: sp.ctrl, knots: sp.knots, ...(sp.weights ? { w: sp.weights } : {}) });
    return { ...strip(sp), ctrl: r.ctrl, knots: r.knots, ...(r.w ? { weights: r.w } : {}), ...(sp.fit ? { fit: [...sp.fit].reverse() } : {}) } as NewEntity;
  }
  return null;
}
const strip = <T extends DraftEntity>(e: T) => {
  const { id: _i, ...rest } = e;
  void _i;
  return rest;
};

registerCommand({
  id: "REVERSE",
  names: { cs: ["obrátit", "obratit"], en: ["reverse"], de: ["umkehren"] },
  group: "modify",
  desc: () => tr("obrátí směr úseček, křivek a splajnů (pořadí vrcholů – směr typu čáry s textem, začátek pro ROZMĚŘIT)"),
  usage: () => tr("obrátit e3 e4"),
  run: function* (c): CmdGen {
    const ids = unlocked(c, yield* pickObjects(c, tr("Vyberte úsečky, křivky nebo splajny")));
    if (!ids.length) return nothing(c);
    let n = 0;
    for (const id of ids) {
      const e = c.tx.get(id)!;
      const g = reverseGeom(e);
      if (!g) {
        c.log(tr("{0} ({1}) nelze obrátit", id, kindLabel(e.type)));
        continue;
      }
      replaceGeom(c, e, g);
      n++;
    }
    c.log(tr("✓ obrácen směr: {0}", n));
    doneSel(c);
  },
});

// ---------------------------------------------------------------- ODSTRANIT DUPLICITY

const PROPS = ["layer", "color", "linetype", "lineweight", "ltscale", "transparency"] as const;
type OverOpts = { tol: number; ignore: Set<string>; mergeLines: boolean };

/** shodná geometrie (do tolerance) – u druhů balíků porovnání JSON bez id a handle */
export function sameGeom(a: DraftEntity, b: DraftEntity, tol: number, ctx: KindCtx): boolean {
  if (a.type !== b.type) return false;
  // absolutní tolerance polohy (jako OVERKILL v AutoCADu): body, poloměry, konce oblouků, vzepětí oblouků křivky
  const eq = (p: Vec2, q: Vec2) => dist(p, q) <= tolAt(p, tol);
  const num = (x: number, y: number) => Math.abs(x - y) <= tolNum(x, tol);
  switch (a.type) {
    case "point":
      return eq(a.p, (b as typeof a).p);
    case "line": {
      const B = b as DLine;
      return (eq(a.a, B.a) && eq(a.b, B.b)) || (eq(a.a, B.b) && eq(a.b, B.a));
    }
    case "circle":
      return eq(a.c, (b as typeof a).c) && num(a.r, (b as typeof a).r);
    case "arc": {
      const B = b as DArc;
      // úhly konců jako vzdálenost po oblouku (r · Δφ)
      const ang = (x: number, y: number) => Math.abs(rad(((x - y + 540) % 360) - 180)) * a.r <= tolNum(a.r, tol);
      return eq(a.c, B.c) && num(a.r, B.r) && ang(a.a0, B.a0) && ang(a.a1, B.a1);
    }
    case "polyline": {
      const B = b as DPolyline;
      if (a.pts.length !== B.pts.length || !!a.closed !== !!B.closed) return false;
      const n = a.pts.length;
      const bu = (e: DPolyline, i: number) => e.bulges?.[i] ?? 0;
      // vzepětí úseku = vydutí × polovina tětivy → rozdíl vydutí jako vzdálenost
      const half = (i: number) => dist(a.pts[i], a.pts[(i + 1) % n]) / 2;
      const sameBu = (i: number, x: number, y: number) => Math.abs(x - y) * half(i) <= tolAt(a.pts[i], tol);
      const fw = a.pts.every((p, i) => eq(p, B.pts[i])) && a.pts.every((_, i) => sameBu(i, bu(a, i), bu(B, i)));
      if (fw) return true;
      if (a.closed) return false;
      return a.pts.every((p, i) => eq(p, B.pts[n - 1 - i])) && Array.from({ length: n - 1 }, (_, i) => i).every((i) => sameBu(i, bu(a, i), -bu(B, n - 2 - i)));
    }
    default: {
      void ctx;
      const norm = (e: DraftEntity) => {
        const { id: _i, ext: _x, layer: _l, color: _c, linetype: _t, lineweight: _w, ltscale: _s, transparency: _p, ...g } = e as DraftEntity & Record<string, unknown>;
        void [_i, _x, _l, _c, _t, _w, _s, _p];
        return JSON.stringify(g, (_k, v) => (typeof v === "number" ? Math.round(v / (tol || 1e-12)) * (tol || 1e-12) : v));
      };
      return norm(a) === norm(b);
    }
  }
}

/** Najde duplicity a překrývající se kolineární úsečky. Vrací id ke smazání a úpravy úseček. */
export function overkill(list: readonly DraftEntity[], ctx: KindCtx, o: OverOpts): { remove: string[]; update: { e: DraftEntity; geom: NewEntity }[] } {
  const remove = new Set<string>();
  const sameProps = (a: DraftEntity, b: DraftEntity) => PROPS.every((k) => o.ignore.has(k) || JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null) || (k === "color" && (a.color ?? "ByLayer") === (b.color ?? "ByLayer")));
  const idx = spatialIndex(list, ctx);
  // nulové úsečky
  for (const e of list) if (e.type === "line" && dist(e.a, e.b) <= tolAt(e.a, o.tol)) remove.add(e.id);
  // shodné entity (ponechá se dřívější v seznamu)
  const order = new Map(list.map((e, i) => [e.id, i]));
  for (const e of list) {
    if (remove.has(e.id)) continue;
    const b = entityBox(e, ctx);
    const cands = b ? idx.query({ x0: b.x0 - o.tol, y0: b.y0 - o.tol, x1: b.x1 + o.tol, y1: b.y1 + o.tol }) : idx.infinite;
    for (const f of cands) {
      if (f.id === e.id || remove.has(f.id) || (order.get(f.id) ?? 0) < (order.get(e.id) ?? 0)) continue;
      if (sameProps(e, f) && sameGeom(e, f, o.tol, ctx)) remove.add(f.id);
    }
  }
  // překrývající se kolineární úsečky → jedna
  const update: { e: DraftEntity; geom: NewEntity }[] = [];
  if (o.mergeLines) {
    const lines = list.filter((e): e is DLine => e.type === "line" && !remove.has(e.id));
    const used = new Set<string>();
    for (const l of lines) {
      if (used.has(l.id)) continue;
      const d = unit(sub(l.b, l.a));
      const t = (p: Vec2) => dot(sub(p, l.a), d);
      let lo = Math.min(t(l.a), t(l.b));
      let hi = Math.max(t(l.a), t(l.b));
      const group: DLine[] = [];
      const inGroup = new Set<string>();
      let grew = true;
      while (grew) {
        grew = false;
        // kandidáti z prostorového indexu: překrývající se úsečka musí zasahovat do obálky dosavadní skupiny
        // (bez indexu O(n²) – 10 000 úseček by trvalo desítky sekund)
        const pa: Vec2 = [l.a[0] + d[0] * lo, l.a[1] + d[1] * lo];
        const pb: Vec2 = [l.a[0] + d[0] * hi, l.a[1] + d[1] * hi];
        const g = tolAt(pa, o.tol) + tolAt(pb, o.tol);
        const cands = idx.query({ x0: Math.min(pa[0], pb[0]) - g, y0: Math.min(pa[1], pb[1]) - g, x1: Math.max(pa[0], pb[0]) + g, y1: Math.max(pa[1], pb[1]) + g });
        for (const m of cands) {
          if (m.type !== "line" || m.id === l.id || remove.has(m.id) || used.has(m.id) || inGroup.has(m.id) || !sameProps(l, m) || !collinear(l, m, o.tol)) continue;
          const a = Math.min(t(m.a), t(m.b));
          const b = Math.max(t(m.a), t(m.b));
          // částečný překryv (ne jen dotyk konců)
          if (Math.min(b, hi) - Math.max(a, lo) > tolAt(l.a, o.tol)) {
            group.push(m);
            inGroup.add(m.id);
            lo = Math.min(lo, a);
            hi = Math.max(hi, b);
            grew = true;
          }
        }
      }
      if (!group.length) continue;
      used.add(l.id);
      for (const m of group) {
        used.add(m.id);
        remove.add(m.id);
      }
      const P = (s: number): Vec2 => [l.a[0] + d[0] * s, l.a[1] + d[1] * s];
      const all = [l, ...group].flatMap((x) => [x.a, x.b]);
      const at = (s: number) => all.find((q) => Math.abs(t(q) - s) < 1e-12) ?? P(s);
      update.push({ e: l, geom: { type: "line", a: at(lo), b: at(hi) } as NewEntity });
    }
  }
  return { remove: [...remove], update };
}

registerCommand({
  id: "OVERKILL",
  names: { cs: ["odstranit-duplicity", "duplicity"], en: ["overkill"], de: ["overkill", "doppelte-löschen"] },
  group: "modify",
  desc: () => tr("odstraní duplicitní entity (shodná geometrie a vlastnosti do tolerance), sloučí překrývající se kolineární úsečky a smaže nulové úsečky; Tolerance, Ignorovat vlastnosti, Sloučit ano / ne"),
  usage: () => tr("odstranit-duplicity vše | odstranit-duplicity vše tolerance 0.001 | odstranit-duplicity vše ignorovat barva hladina \"\" (konec)"),
  run: function* (c): CmdGen {
    const ids = yield* pickObjects(c, tr("Vyberte objekty"));
    if (!ids.length) return nothing(c);
    const o: OverOpts = { tol: 1e-6, ignore: new Set(), mergeLines: true };
    for (;;) {
      const k = yield { k: "kw", msg: tr("Zadejte volbu nastavení (Enter = pokračovat)"), kw: [EK.tolerance, EK.ignore, EK.merge], none: true };
      if (k.k !== "kw") break;
      if (k.id === "tolerance") {
        const v = yield { k: "dist", msg: tr("Zadejte toleranci"), def: o.tol, min: 0 };
        if (v.k === "num") o.tol = v.v;
      } else if (k.id === "ignore") {
        const opts = [
          { id: "layer", cs: "Hladina", en: "Layer", de: "Layer" },
          { id: "color", cs: "Barva", en: "Color", de: "Farbe" },
          { id: "linetype", cs: "Typčáry", en: "Linetype", de: "Linientyp" },
          { id: "lineweight", cs: "Tloušťka", en: "Lineweight", de: "Linienstärke" },
          { id: "ltscale", cs: "Měřítkočáry", en: "Ltscale", de: "Ltfaktor" },
          { id: "transparency", cs: "Průhlednost", en: "Transparency", de: "Transparenz" },
        ];
        for (;;) {
          const g = yield { k: "kw", msg: tr("Ignorovat vlastnost (Enter = hotovo)"), kw: opts, none: true };
          if (g.k !== "kw") break;
          o.ignore.add(g.id);
        }
      } else {
        const v = yield* askKw(tr("Sloučit překrývající se kolineární úsečky?"), [EK.yes, EK.no], "yes");
        o.mergeLines = !(v.k === "kw" && v.id === "no");
      }
    }
    const sel = new Set(unlocked(c, ids));
    const list = c.tx.entities.filter((e) => sel.has(e.id));
    const r = overkill(list, kc(c), o);
    for (const u of r.update) replaceGeom(c, u.e, u.geom);
    for (const id of r.remove) c.tx.remove(id);
    c.out("removed", r.remove);
    c.log(tr("✓ odstraněno duplicit: {0}, sloučeno úseček: {1}", r.remove.length, r.update.length));
    doneSel(c);
  },
});

