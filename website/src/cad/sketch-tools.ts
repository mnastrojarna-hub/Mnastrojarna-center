/**
 * Nástroje skici (5. vlna) – čisté funkce bez UI, testované ve vitestu:
 * číselné zadání při kreslení, odvozené (automatické) vazby, výkonný ořez tažením, řetězce entit a odsazení
 * řetězce, rozdělení v bodě, projekce hran modelu do roviny skici a další způsoby tvorby tvarů
 * (obdélník 3 body, kružnice 2 body, mnohoúhelník vepsaný/opsaný, drážka obloukem).
 */
import { planeBasis } from "./defaults";
import { evalExpr } from "./params";
import { arcGeom, prims, type Prim } from "./sketch";
import { d2, intersect, primParam, trim } from "./sketch-ops";
import { uid, type SketchConstraint, type SketchEntity, type SketchPlane, type Vec2 } from "./types";

const TAU = Math.PI * 2;
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k];
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
const crs = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];
const len = (a: Vec2) => Math.hypot(a[0], a[1]);
const unit = (a: Vec2): Vec2 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};
const perp = (a: Vec2): Vec2 => [-a[1], a[0]];
const nrmA = (x: number) => ((x % TAU) + TAU) % TAU;
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
const R = (p: Vec2): Vec2 => [r6(p[0]), r6(p[1])];
const angOf = (p: Vec2, c: Vec2) => Math.atan2(p[1] - c[1], p[0] - c[0]);
const onCircle = (c: Vec2, r: number, t: number): Vec2 => [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)];

/** Oblouk entity ze středu, poloměru a úhlů t0 → t1 (libovolný směr; prostřední bod v půli). */
export function arcFrom(c: Vec2, r: number, t0: number, t1: number, construction?: boolean): SketchEntity {
  return { id: uid(), type: "arc", a: R(onCircle(c, r, t0)), b: R(onCircle(c, r, (t0 + t1) / 2)), c: R(onCircle(c, r, t1)), construction };
}

// ======================= číselné zadání =======================

/** Výsledek rozboru textu zadaného u kurzoru. */
export type CoordInput = { kind: "abs" | "rel"; v: Vec2 } | { kind: "polar"; len: number; ang: number } | { kind: "num"; v: number };

/** Číslo z textu (výraz, desetinná čárka i tečka); NaN při chybě. */
export function parseNum(text: string): number {
  const t = text.trim().replace(/,/g, ".");
  if (!t) return NaN;
  try {
    return evalExpr(t);
  } catch {
    const n = Number(t);
    return Number.isFinite(n) ? n : NaN;
  }
}

/**
 * Rozbor zadání: `30` = číslo, `30;20` / `30,20` / `30x20` = absolutní souřadnice (resp. dvě hodnoty),
 * `@30;20` = relativně k poslednímu bodu, `50<45` = polárně (délka<úhel, relativně). Desetinná čárka se přijme
 * jen tam, kde nejde o oddělovač dvou hodnot (`30,5` = dvě hodnoty, `30,5mm`… použijte tečku).
 */
export function parseInput(text: string): CoordInput | null {
  let t = text.trim();
  if (!t) return null;
  const rel = t.startsWith("@");
  if (rel) t = t.slice(1);
  if (t.includes("<")) {
    const [a, b] = t.split("<");
    const l = parseNum(a);
    const g = parseNum(b);
    return Number.isFinite(l) && Number.isFinite(g) ? { kind: "polar", len: l, ang: g } : null;
  }
  const sepRe = /;|x|×/i;
  let parts: string[];
  if (sepRe.test(t)) parts = t.split(sepRe);
  else if ((t.match(/,/g) ?? []).length === 1 && t.split(",").every((s) => Number.isFinite(parseNum(s)))) parts = t.split(",");
  else parts = [t];
  const nums = parts.map(parseNum);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  if (nums.length === 2) return { kind: rel ? "rel" : "abs", v: [nums[0], nums[1]] };
  if (nums.length === 1) return { kind: "num", v: nums[0] };
  return null;
}

/** Bod ze zadání: absolutní / relativní / polární vůči `from` (bez `from` vůči počátku). `num` bod neurčuje → null. */
export function resolveInput(inp: CoordInput, from: Vec2 | null): Vec2 | null {
  const o: Vec2 = from ?? [0, 0];
  if (inp.kind === "abs") return inp.v;
  if (inp.kind === "rel") return add(o, inp.v);
  if (inp.kind === "polar") return add(o, [inp.len * Math.cos((inp.ang * Math.PI) / 180), inp.len * Math.sin((inp.ang * Math.PI) / 180)]);
  return null;
}

/** Bod úsečky z délky a/nebo úhlu (chybějící hodnota se vezme z polohy kurzoru). */
export function polarPoint(from: Vec2, cursor: Vec2, L: number | null, angDeg: number | null): Vec2 {
  const v = sub(cursor, from);
  const l = L ?? len(v);
  const a = angDeg != null ? (angDeg * Math.PI) / 180 : Math.atan2(v[1], v[0]);
  if (angDeg != null && L == null) {
    // zadán jen úhel: průmět kurzoru na paprsek
    const u: Vec2 = [Math.cos(a), Math.sin(a)];
    const t = Math.max(0.01, dot(v, u));
    return add(from, mul(u, t));
  }
  return add(from, [l * Math.cos(a), l * Math.sin(a)]);
}

// ======================= odvozené vazby při kreslení =======================

export type AutoKind = "horizontal" | "vertical" | "parallel" | "perpendicular" | "tangent";
/** Referenční směr pro odvození: úsečka (rovnoběžně/kolmo) nebo tečna oblouku v bodě navázání. */
export type AutoRef = { id: string; dir: Vec2; kind: "line" | "tangent" };
export type AutoResult = { p: Vec2; kinds: AutoKind[]; ref?: string };

/**
 * Odvodí vazbu kreslené úsečky `from → p`: vodorovně/svisle (do `tolDeg`), jinak tečně k oblouku / rovnoběžně
 * či kolmo k referenční úsečce. Vrací upravený koncový bod (přesně na směru) a druh vazby (max. jeden – bez
 * nadbytečných vazeb).
 */
export function inferLine(from: Vec2, p: Vec2, refs: AutoRef[] = [], tolDeg = 3): AutoResult {
  const v = sub(p, from);
  const L = len(v);
  if (L < 1e-9) return { p, kinds: [] };
  const deg = (Math.atan2(v[1], v[0]) * 180) / Math.PI;
  const dH = Math.min(Math.abs(deg), 180 - Math.abs(deg));
  const dV = Math.abs(90 - Math.abs(deg));
  if (dH <= tolDeg) return { p: [p[0], from[1]], kinds: ["horizontal"] };
  if (dV <= tolDeg) return { p: [from[0], p[1]], kinds: ["vertical"] };
  const project = (u: Vec2): Vec2 => add(from, mul(u, dot(v, u)));
  for (const r of refs) {
    const u = unit(r.dir);
    if (len(u) < 1e-9) continue;
    const d = (Math.abs(Math.atan2(crs(v, u), dot(v, u))) * 180) / Math.PI; // 0..180
    const dpar = Math.min(d, 180 - d);
    const dperp = Math.abs(90 - d);
    if (r.kind === "tangent") {
      if (dpar <= tolDeg) return { p: project(u), kinds: ["tangent"], ref: r.id };
      continue;
    }
    if (dpar <= tolDeg) return { p: project(u), kinds: ["parallel"], ref: r.id };
    if (dperp <= tolDeg) return { p: project(perp(u)), kinds: ["perpendicular"], ref: r.id };
  }
  return { p, kinds: [] };
}

/** Tečný směr entity v jejím koncovém bodě (pro navázání úsečky/oblouku tečně). */
export function tangentAt(e: SketchEntity, key: string): Vec2 | null {
  if (e.type === "line") return key === "b" ? sub(e.b, e.a) : key === "a" ? sub(e.a, e.b) : null;
  if (e.type === "arc") {
    const g = arcGeom(e.a, e.b, e.c);
    if (!g) return null;
    const p = key === "a" ? e.a : key === "c" ? e.c : null;
    if (!p) return null;
    const rr = sub(p, g.c);
    // oblouk v CCW parametrizaci začíná v a0; pokračování z konce = CCW tečna, z počátku = CW tečna
    const startsAtA = d2(e.a, onCircle(g.c, g.r, g.a0)) < 1e-6;
    const ccwOut = (key === "c") === startsAtA;
    return ccwOut ? [-rr[1], rr[0]] : [rr[1], -rr[0]];
  }
  return null;
}

/** Vazby z odvozeného druhu (pro novou úsečku `id`). */
export function autoConstraints(id: string, res: AutoResult, refKindOf: (refId: string) => "line" | "arc" | null): SketchConstraint[] {
  const out: SketchConstraint[] = [];
  for (const k of res.kinds) {
    if (k === "horizontal" || k === "vertical") out.push({ id: uid(), type: k, refs: [{ e: id, k: "self" }] });
    else if ((k === "parallel" || k === "perpendicular") && res.ref && refKindOf(res.ref) === "line") out.push({ id: uid(), type: k, refs: [{ e: id, k: "self" }, { e: res.ref, k: "self" }] });
    else if (k === "tangent" && res.ref && refKindOf(res.ref) === "arc") out.push({ id: uid(), type: "tangent", refs: [{ e: res.ref, k: "self" }, { e: id, k: "self" }] });
  }
  return out;
}

// ======================= výkonný ořez =======================

/**
 * Výkonný ořez: odstraní každý úsek křivky, který protíná tažená cesta kurzoru (v pořadí podél cesty).
 * Vrací nový seznam entit, nebo null, pokud cesta nic neprotnula.
 */
export function powerTrim(entities: SketchEntity[], path: Vec2[]): SketchEntity[] | null {
  if (path.length < 2) return null;
  const segs: Prim[] = path.slice(1).map((p, i) => ({ kind: "line" as const, a: path[i], b: p, id: "_path" })).filter((s) => d2(s.a, s.b) > 1e-9);
  let list = entities;
  let changed = false;
  const skip = new Set<string>();
  for (let guard = 0; guard < 400; guard++) {
    let best: { id: string; p: Vec2; t: number } | null = null;
    for (let si = 0; si < segs.length; si++) {
      for (const e of list) {
        if (skip.has(e.id) || e.type === "point") continue;
        for (const pr of prims(e)) for (const x of intersect(segs[si], pr)) {
          const t = si + primParam(segs[si], x);
          if (!best || t < best.t) best = { id: e.id, p: x, t };
        }
      }
      if (best) break;
    }
    if (!best) break;
    const r = trim(list, best.id, best.p);
    if (!r) {
      skip.add(best.id);
      continue;
    }
    list = r;
    changed = true;
  }
  return changed ? list : null;
}

// ======================= řetězce a odsazení řetězce =======================

/** Orientovaný úsek řetězce: úsečka a→b, nebo oblouk se středem, poloměrem a úhly t0→t1 (ccw = t1 > t0). */
export type ChainSeg = { id: string; a: Vec2; b: Vec2; arc?: { c: Vec2; r: number; t0: number; t1: number }; construction?: boolean };

function segOf(e: SketchEntity, reverse: boolean): ChainSeg | null {
  if (e.type === "line") return reverse ? { id: e.id, a: e.b, b: e.a, construction: e.construction } : { id: e.id, a: e.a, b: e.b, construction: e.construction };
  if (e.type === "arc") {
    const g = arcGeom(e.a, e.b, e.c);
    if (!g) return null;
    const startsAtA = d2(e.a, onCircle(g.c, g.r, g.a0)) < 1e-6;
    // a → c ve směru entity
    let t0 = startsAtA ? g.a0 : g.a0 + g.sweep;
    let t1 = startsAtA ? g.a0 + g.sweep : g.a0;
    let a = e.a;
    let b = e.c;
    if (reverse) {
      [t0, t1] = [t1, t0];
      [a, b] = [b, a];
    }
    return { id: e.id, a, b, arc: { c: g.c, r: g.r, t0, t1 }, construction: e.construction };
  }
  return null;
}

/**
 * Řetězec úseček/oblouků navazujících koncovými body na entitu `startId` (končí na větvení nebo volném konci).
 * Vrací orientované úseky v pořadí a zda je řetězec uzavřený.
 */
export function chainOf(entities: SketchEntity[], startId: string, tol = 1e-3): { segs: ChainSeg[]; closed: boolean } {
  const cand = entities.filter((e) => (e.type === "line" || e.type === "arc") && e.id !== startId);
  const start = entities.find((e) => e.id === startId);
  const s0 = start ? segOf(start, false) : null;
  if (!s0) return { segs: [], closed: false };
  const used = new Set<string>([startId]);
  const ends = (e: SketchEntity): [Vec2, Vec2] => (e.type === "line" ? [e.a, e.b] : e.type === "arc" ? [e.a, e.c] : [[0, 0], [0, 0]]);
  const grow = (from: Vec2): ChainSeg | null => {
    const hits = cand.filter((e) => !used.has(e.id) && ends(e).some((p) => d2(p, from) < tol));
    if (hits.length !== 1) return null; // větvení nebo konec
    const e = hits[0];
    const [a] = ends(e);
    const seg = segOf(e, !(d2(a, from) < tol));
    if (!seg) return null;
    used.add(e.id);
    return seg;
  };
  const fwd: ChainSeg[] = [s0];
  for (let i = 0; i < 1000; i++) {
    const end = fwd[fwd.length - 1].b;
    if (d2(end, s0.a) < tol && fwd.length > 1) return { segs: fwd, closed: true };
    const n = grow(end);
    if (!n) break;
    fwd.push(n);
  }
  const back: ChainSeg[] = [];
  for (let i = 0; i < 1000; i++) {
    const startP = back.length ? back[back.length - 1].a : s0.a;
    const n = grow(startP);
    if (!n) break;
    // vzadu se řetězí pozpátku: orientaci otočit
    back.push(n.arc ? { ...n, a: n.b, b: n.a, arc: { ...n.arc, t0: n.arc.t1, t1: n.arc.t0 } } : { ...n, a: n.b, b: n.a });
  }
  const segs = [...back.reverse(), ...fwd];
  const closed = segs.length > 1 && d2(segs[0].a, segs[segs.length - 1].b) < tol;
  return { segs, closed };
}

/** Strana odsazení řetězce podle bodu: +1 vlevo od směru řetězce, −1 vpravo. */
export function chainSide(segs: ChainSeg[], q: Vec2): number {
  let best: ChainSeg | null = null;
  let bd = Infinity;
  for (const s of segs) {
    const d = distToSeg(s, q);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  if (!best) return 1;
  if (best.arc) {
    const ccw = best.arc.t1 > best.arc.t0;
    const inside = d2(q, best.arc.c) < best.arc.r;
    return (ccw ? inside : !inside) ? 1 : -1;
  }
  return crs(sub(best.b, best.a), sub(q, best.a)) >= 0 ? 1 : -1;
}

function distToSeg(s: ChainSeg, q: Vec2): number {
  if (!s.arc) {
    const d = sub(s.b, s.a);
    const t = Math.max(0, Math.min(1, dot(sub(q, s.a), d) / (dot(d, d) || 1e-12)));
    return d2(add(s.a, mul(d, t)), q);
  }
  const ang = angOf(q, s.arc.c);
  const lo = Math.min(s.arc.t0, s.arc.t1);
  const sw = Math.abs(s.arc.t1 - s.arc.t0);
  if (nrmA(ang - lo) <= sw) return Math.abs(d2(q, s.arc.c) - s.arc.r);
  return Math.min(d2(q, s.a), d2(q, s.b));
}

const segTangentEnd = (s: ChainSeg): Vec2 => (s.arc ? mul(perp(sub(s.b, s.arc.c)), s.arc.t1 > s.arc.t0 ? 1 : -1) : sub(s.b, s.a));
const segTangentStart = (s: ChainSeg): Vec2 => (s.arc ? mul(perp(sub(s.a, s.arc.c)), s.arc.t1 > s.arc.t0 ? 1 : -1) : sub(s.b, s.a));

function segPrimFull(s: ChainSeg): Prim {
  if (s.arc) return { kind: "arc", c: s.arc.c, r: s.arc.r, a0: 0, sweep: TAU, id: s.id };
  return { kind: "line", a: s.a, b: s.b, id: s.id };
}

/** Nastaví konec úseku do bodu X (u oblouku změnou koncového úhlu se zachováním směru). */
function setEnd(s: ChainSeg, X: Vec2): ChainSeg {
  if (!s.arc) return { ...s, b: X };
  const ang = angOf(X, s.arc.c);
  const ccw = s.arc.t1 > s.arc.t0;
  const t1 = ccw ? s.arc.t0 + nrmA(ang - s.arc.t0) : s.arc.t0 - nrmA(s.arc.t0 - ang);
  return { ...s, b: onCircle(s.arc.c, s.arc.r, t1), arc: { ...s.arc, t1 } };
}
function setStart(s: ChainSeg, X: Vec2): ChainSeg {
  if (!s.arc) return { ...s, a: X };
  const ang = angOf(X, s.arc.c);
  const ccw = s.arc.t1 > s.arc.t0;
  const t0 = ccw ? s.arc.t1 - nrmA(s.arc.t1 - ang) : s.arc.t1 + nrmA(ang - s.arc.t1);
  return { ...s, a: onCircle(s.arc.c, s.arc.r, t0), arc: { ...s.arc, t0 } };
}

function segEntity(s: ChainSeg, construction?: boolean): SketchEntity {
  if (!s.arc) return { id: uid(), type: "line", a: R(s.a), b: R(s.b), construction };
  return arcFrom(s.arc.c, s.arc.r, s.arc.t0, s.arc.t1, construction);
}

/**
 * Odsazení řetězce o vzdálenost `d` (kladně vlevo od směru řetězce). Rohy úseček se protáhnou do ostrého rohu,
 * nenavazující rohy s oblouky se spojí obloukem (jako SolidWorks). Vrací nové entity, nebo null (odsazení
 * větší než poloměr oblouku / degenerace).
 */
export function offsetChain(segs: ChainSeg[], closed: boolean, d: number, construction?: boolean): SketchEntity[] | null {
  if (!segs.length || Math.abs(d) < 1e-9) return null;
  const off: ChainSeg[] = [];
  for (const s of segs) {
    if (s.arc) {
      const ccw = s.arc.t1 > s.arc.t0;
      const r = ccw ? s.arc.r - d : s.arc.r + d;
      if (r <= 1e-6) return null;
      off.push({ ...s, a: onCircle(s.arc.c, r, s.arc.t0), b: onCircle(s.arc.c, r, s.arc.t1), arc: { ...s.arc, r } });
    } else {
      const n = mul(perp(unit(sub(s.b, s.a))), d);
      off.push({ ...s, a: add(s.a, n), b: add(s.b, n) });
    }
  }
  const joins: SketchEntity[][] = segs.map(() => []);
  const n = segs.length;
  const pairs = closed ? n : n - 1;
  for (let i = 0; i < pairs; i++) {
    const j = (i + 1) % n;
    const s1 = off[i];
    const s2 = off[j];
    if (d2(s1.b, s2.a) < 1e-6) continue; // tečné navázání – zůstává spojené
    const corner = segs[i].b;
    const turn = crs(unit(segTangentEnd(segs[i])), unit(segTangentStart(segs[j])));
    const gap = turn * d < 0; // vnější roh → mezera
    const bothLines = !s1.arc && !s2.arc;
    if (bothLines || !gap) {
      const xs = intersect(segPrimFull(s1), segPrimFull(s2), true);
      if (xs.length) {
        let X = xs[0];
        for (const x of xs) if (d2(x, corner) < d2(X, corner)) X = x;
        off[i] = setEnd(s1, X);
        off[j] = setStart(s2, X);
        continue;
      }
    }
    // zaoblený spoj kolem původního rohu
    const ua = unit(sub(s1.b, corner));
    const ub = unit(sub(s2.a, corner));
    const bis = unit(add(ua, ub));
    const rr = Math.abs(d);
    joins[i].push({ id: uid(), type: "arc", a: R(s1.b), b: R(add(corner, mul(len(bis) < 1e-9 ? perp(ua) : bis, rr))), c: R(s2.a), construction });
  }
  const out: SketchEntity[] = [];
  off.forEach((s, i) => {
    if (d2(s.a, s.b) > 1e-6 || s.arc) out.push(segEntity(s, construction));
    out.push(...joins[i]);
  });
  return out;
}

// ======================= rozdělení =======================

/** Rozdělí úsečku nebo oblouk v bodě (bod se promítne na křivku). Kružnice se dělí dvěma body (`splitCircle`). */
export function splitAt(entities: SketchEntity[], id: string, p: Vec2): SketchEntity[] | null {
  const e = entities.find((x) => x.id === id);
  if (!e) return null;
  if (e.type === "line") {
    const t = primParam({ kind: "line", a: e.a, b: e.b, id }, p);
    if (t <= 1e-6 || t >= 1 - 1e-6) return null;
    const X = R(add(e.a, mul(sub(e.b, e.a), t)));
    return entities.flatMap((x) => (x.id === id ? [{ ...e, a: e.a, b: X }, { ...e, id: uid(), a: X, b: e.b }] : [x]));
  }
  if (e.type === "arc") {
    const s = segOf(e, false);
    if (!s?.arc) return null;
    const ang = angOf(p, s.arc.c);
    const ccw = s.arc.t1 > s.arc.t0;
    const sw = Math.abs(s.arc.t1 - s.arc.t0);
    const u = ccw ? nrmA(ang - s.arc.t0) : nrmA(s.arc.t0 - ang);
    if (u <= 1e-6 || u >= sw - 1e-6) return null;
    const tm = ccw ? s.arc.t0 + u : s.arc.t0 - u;
    const a1 = arcFrom(s.arc.c, s.arc.r, s.arc.t0, tm, e.construction);
    const a2 = arcFrom(s.arc.c, s.arc.r, tm, s.arc.t1, e.construction);
    return entities.flatMap((x) => (x.id === id ? [{ ...a1, id }, a2] : [x]));
  }
  return null;
}

/** Rozdělí kružnici dvěma body na dva oblouky. */
export function splitCircle(entities: SketchEntity[], id: string, p1: Vec2, p2: Vec2): SketchEntity[] | null {
  const e = entities.find((x) => x.id === id);
  if (!e || e.type !== "circle") return null;
  const c: Vec2 = [e.cx, e.cy];
  const t1 = angOf(p1, c);
  let t2 = angOf(p2, c);
  while (t2 <= t1 + 1e-9) t2 += TAU;
  if (t2 - t1 < 1e-6 || t2 - t1 > TAU - 1e-6) return null;
  const a1 = arcFrom(c, e.r, t1, t2, e.construction);
  const a2 = arcFrom(c, e.r, t2, t1 + TAU, e.construction);
  return entities.flatMap((x) => (x.id === id ? [{ ...a1, id }, a2] : [x]));
}

// ======================= projekce hran modelu =======================

/**
 * Průmět hran modelu (dvojice bodů ve světových souřadnicích, x,y,z po šesticích) do roviny skici.
 * `inPlaneOnly` = jen hrany ležící v rovině (±tol), jinak všechny (kolmý průmět). Krátké a duplicitní úsečky se
 * vynechají, navazující kolineární úsečky se sloučí.
 */
export function projectModelLines(lines: ArrayLike<number>, plane: SketchPlane, opts: { inPlaneOnly: boolean; tol?: number; construction?: boolean; minLen?: number }): SketchEntity[] {
  const b = planeBasis(plane);
  const tol = opts.tol ?? 0.01;
  const minLen = opts.minLen ?? 1e-3;
  const loc = (i: number): [number, number, number] => {
    const px = lines[i] - b.origin[0];
    const py = lines[i + 1] - b.origin[1];
    const pz = lines[i + 2] - b.origin[2];
    return [px * b.x[0] + py * b.x[1] + pz * b.x[2], px * b.y[0] + py * b.y[1] + pz * b.y[2], px * b.n[0] + py * b.n[1] + pz * b.n[2]];
  };
  const seen = new Set<string>();
  const raw: [Vec2, Vec2][] = [];
  const key = (p: Vec2) => `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)}`;
  for (let i = 0; i + 5 < lines.length; i += 6) {
    const P = loc(i);
    const Q = loc(i + 3);
    if (opts.inPlaneOnly && (Math.abs(P[2]) > tol || Math.abs(Q[2]) > tol)) continue;
    const a: Vec2 = [r6(P[0]), r6(P[1])];
    const c: Vec2 = [r6(Q[0]), r6(Q[1])];
    if (d2(a, c) < minLen) continue;
    const k1 = `${key(a)}|${key(c)}`;
    const k2 = `${key(c)}|${key(a)}`;
    if (seen.has(k1) || seen.has(k2)) continue;
    seen.add(k1);
    raw.push([a, c]);
  }
  return mergeCollinear(raw).map(([a, c]) => ({ id: uid(), type: "line", a, b: c, construction: opts.construction }));
}

/** Sloučí navazující kolineární úsečky (koncový bod jedné = počáteční druhé, stejný směr). */
export function mergeCollinear(segs: [Vec2, Vec2][], tol = 1e-4): [Vec2, Vec2][] {
  const list = segs.map(([a, b]) => ({ a, b, dead: false }));
  const key = (p: Vec2) => `${Math.round(p[0] / tol)},${Math.round(p[1] / tol)}`;
  const byStart = new Map<string, number[]>();
  const byEnd = new Map<string, number[]>();
  list.forEach((s, i) => {
    byStart.set(key(s.a), [...(byStart.get(key(s.a)) ?? []), i]);
    byEnd.set(key(s.b), [...(byEnd.get(key(s.b)) ?? []), i]);
  });
  const collinear = (u: Vec2, v: Vec2) => Math.abs(crs(unit(u), unit(v))) < 1e-6 && dot(u, v) > 0;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (s.dead) continue;
    for (let guard = 0; guard < 10000; guard++) {
      const cands = (byStart.get(key(s.b)) ?? []).filter((j) => j !== i && !list[j].dead && collinear(sub(s.b, s.a), sub(list[j].b, list[j].a)));
      const others = (byEnd.get(key(s.b)) ?? []).filter((j) => j !== i && !list[j].dead);
      if (cands.length !== 1 || others.length) break;
      const j = cands[0];
      list[j].dead = true;
      s.b = list[j].b;
      byStart.set(key(list[j].a), []);
    }
  }
  return list.filter((s) => !s.dead).map((s) => [s.a, s.b]);
}

// ======================= další tvary =======================

/** Obdélník třemi body: p1→p2 první strana (směr a šířka), p3 určuje výšku (kolmá vzdálenost). */
export function rectFrom3(p1: Vec2, p2: Vec2, p3: Vec2): Extract<SketchEntity, { type: "rect" }> | null {
  const v = sub(p2, p1);
  const w = len(v);
  if (w < 1e-6) return null;
  const u = unit(v);
  const n = perp(u);
  const h = dot(sub(p3, p1), n);
  if (Math.abs(h) < 1e-6) return null;
  const c = add(add(p1, mul(u, w / 2)), mul(n, h / 2));
  return { id: uid(), type: "rect", cx: r6(c[0]), cy: r6(c[1]), w: r6(w), h: r6(Math.abs(h)), r: 0, angle: r6((Math.atan2(u[1], u[0]) * 180) / Math.PI) };
}

/** Kružnice dvěma body na průměru. */
export function circleFrom2(a: Vec2, b: Vec2): Extract<SketchEntity, { type: "circle" }> | null {
  const d = d2(a, b);
  if (d < 1e-6) return null;
  return { id: uid(), type: "circle", cx: r6((a[0] + b[0]) / 2), cy: r6((a[1] + b[1]) / 2), r: r6(d / 2) };
}

/**
 * Mnohoúhelník ze středu a bodu: vepsaný (bod = vrchol, poloměr opsané kružnice) nebo opsaný (bod = střed strany,
 * poloměr vepsané kružnice). `r` entity je vždy poloměr opsané kružnice.
 */
export function polygonFrom(c: Vec2, p: Vec2, sides: number, circumscribed: boolean): Extract<SketchEntity, { type: "polygon" }> | null {
  const n = Math.max(3, Math.round(sides));
  const d = d2(c, p);
  if (d < 1e-6) return null;
  const deg = (Math.atan2(p[1] - c[1], p[0] - c[0]) * 180) / Math.PI;
  if (!circumscribed) return { id: uid(), type: "polygon", cx: c[0], cy: c[1], r: r6(d), sides: n, angle: r6(deg - 90) };
  return { id: uid(), type: "polygon", cx: c[0], cy: c[1], r: r6(d / Math.cos(Math.PI / n)), sides: n, angle: r6(deg - 90 - 180 / n) };
}

/** Poloměr opsané kružnice z poloměru vepsané (apotémy) a naopak. */
export const polygonCircumR = (inscribedR: number, sides: number) => inscribedR / Math.cos(Math.PI / Math.max(3, Math.round(sides)));

/**
 * Drážka obloukem: střed oblouku, začátek a konec osy drážky (proti směru hodin), šířka. Vznikne vnější a vnitřní
 * oblouk + dvě půlkruhové čepičky, provázané vazbami (totožnost, tečnost, soustřednost) → 6 stupňů volnosti.
 */
export function slotArcEntities(center: Vec2, start: Vec2, end: Vec2, width: number): { entities: SketchEntity[]; constraints: SketchConstraint[] } | null {
  const Rm = d2(center, start);
  const w = Math.abs(width);
  if (Rm < 1e-6 || w < 1e-6 || Rm - w / 2 <= 1e-6) return null;
  const ts = angOf(start, center);
  let te = angOf(end, center);
  while (te <= ts + 1e-9) te += TAU;
  if (te - ts > TAU - 1e-6) return null;
  const ro = Rm + w / 2;
  const ri = Rm - w / 2;
  const S = onCircle(center, Rm, ts);
  const E = onCircle(center, Rm, te);
  const tS: Vec2 = [-Math.sin(ts), Math.cos(ts)];
  const tE: Vec2 = [-Math.sin(te), Math.cos(te)];
  const outer = arcFrom(center, ro, ts, te);
  const capEnd: SketchEntity = { id: uid(), type: "arc", a: R(onCircle(center, ro, te)), b: R(add(E, mul(tE, w / 2))), c: R(onCircle(center, ri, te)) };
  const inner = arcFrom(center, ri, te, ts);
  const capStart: SketchEntity = { id: uid(), type: "arc", a: R(onCircle(center, ri, ts)), b: R(sub(S, mul(tS, w / 2))), c: R(onCircle(center, ro, ts)) };
  const C = (a: SketchEntity, ka: string, b: SketchEntity, kb: string): SketchConstraint => ({ id: uid(), type: "coincident", refs: [{ e: a.id, k: ka }, { e: b.id, k: kb }] });
  const T = (a: SketchEntity, b: SketchEntity): SketchConstraint => ({ id: uid(), type: "tangent", refs: [{ e: a.id, k: "self" }, { e: b.id, k: "self" }] });
  return {
    entities: [outer, capEnd, inner, capStart],
    constraints: [
      C(outer, "c", capEnd, "a"),
      C(capEnd, "c", inner, "a"),
      C(inner, "c", capStart, "a"),
      C(capStart, "c", outer, "a"),
      T(outer, capEnd),
      T(capEnd, inner),
      T(inner, capStart),
      T(capStart, outer),
      { id: uid(), type: "concentric", refs: [{ e: outer.id, k: "self" }, { e: inner.id, k: "self" }] },
    ],
  };
}

/** Třetí bod oblouku (na oblouku) pro oblouk a→c daného poloměru; `side` = strana středu vůči tětivě (±1). */
export function arcMidForRadius(a: Vec2, c: Vec2, r: number, side: number): Vec2 | null {
  const ch = d2(a, c);
  if (ch < 1e-9 || r < ch / 2) return null;
  const m: Vec2 = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
  const n = perp(unit(sub(c, a)));
  const h = Math.sqrt(Math.max(0, r * r - (ch / 2) ** 2));
  const center = add(m, mul(n, side * h));
  // prostřední bod oblouku leží proti středu (kratší oblouk)
  return R(add(center, mul(n, -side * r)));
}

/** Koncový bod tečného oblouku daného poloměru z bodu `s` s tečnou `t`; `side` (±1) = strana středu, `cursor` určuje úhel. */
export function tangentArcEnd(s: Vec2, t: Vec2, r: number, side: number, cursor: Vec2): Vec2 {
  const u = unit(t);
  const n = perp(u);
  const c = add(s, mul(n, side * r));
  return R(add(c, mul(unit(sub(cursor, c)), r)));
}

/** Délka oblouku entity (null pro ostatní). */
export function arcLengthOf(e: SketchEntity): number | null {
  if (e.type !== "arc") return null;
  const g = arcGeom(e.a, e.b, e.c);
  return g ? g.r * g.sweep : null;
}
