/**
 * Popisy děr ve výkrese i pro díry z primitiv (12. vlna) – chytré kóty (drawing-dims.ts `holeDims`) znaly jen prvek `díra`:
 *  – válec odebraný z tělesa (`válec 6,8 16 … odebrat`, i po libovolné ose a odkazem) = díra „Ø6,8 ↧16“ nebo „Ø6,8 skrz“;
 *    hloubka a průchodnost z geometrie (dno = rovinná plocha / hrot uvnitř kružnice díry na konci válce), kuželové zahloubení
 *    v ústí (`kužel 12 0 6 … odebrat`) = „⌵ Ø12 × 90°“;
 *  – vnitřní kosmetický / modelovaný závit souosý s takovou dírou nebo s dírou prvku `díra` bez závitu z ní udělá závitovou díru
 *    („M8 ↧12“ + „Ø6,8 ↧16“); bez díry v historii se díra hledá v geometrii (válcová plocha vrtáku závitu).
 * Poloha a osa prvků zadaných odkazem z placements.ts (zapisuje je stavba). Čisté funkce nad výtahem geometrie (bez jádra).
 */
import { threadByName } from "./defaults";
import { drillFitsThread, threadMinorD } from "./hole-spec";
import type { GAxis, GCyl, PartGeom } from "./drawing-dims-geom";
import { tr } from "./i18n";
import { placementOf } from "./placements";
import type { CadDoc, Feature, Vec3 } from "./types";

type HoleF = Extract<Feature, { type: "hole" }>;
type CylF = Extract<Feature, { type: "cylinder" }>;
type ThreadF = Extract<Feature, { type: "thread" }>;

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => mul(a, 1 / (len(a) || 1));
const AXV: Record<string, Vec3> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
const parallel = (a: Vec3, b: Vec3) => Math.abs(Math.abs(dot(unit(a), unit(b))) - 1) < 1e-4;
/** vzdálenost bodu od osy */
const radOf = (ax: GAxis, q: Vec3) => {
  const w = sub(q, ax.p);
  return len(sub(w, mul(ax.dir, dot(w, ax.dir))));
};

/** Je konec válcové plochy díry (parametr `t` podél osy) uzavřený dnem – rovinnou plochou uvnitř kružnice díry, nebo hrotem? */
function closedAt(g: PartGeom, c: GCyl, t: number, tol: number): boolean {
  const at = add(c.p, mul(c.dir, t));
  const disc = g.planes.some(
    (p) => parallel(p.n, c.dir) && radOf(c, p.c) < tol && Math.abs(dot(sub(p.c, at), c.dir)) < tol && p.area <= Math.PI * c.r * c.r * 1.01 && p.circles.some((q) => Math.abs(q.r - c.r) < 1e-3 && len(sub(q.c, at)) < tol) && p.circles.every((q) => q.r <= c.r + 1e-3),
  );
  if (disc) return true;
  // hrot vrtáku: souosý kužel, který na konci navazuje poloměrem díry a zužuje se (zahloubení v ústí se naopak rozšiřuje)
  return g.cones.some((k) => !k.ext && parallel(k.dir, c.dir) && radOf(c, k.p) < tol && [[k.t0, k.r0, k.r1], [k.t1, k.r1, k.r0]].some(([te, re, ro]) => Math.abs(dot(sub(add(k.p, mul(k.dir, te)), at), c.dir)) < tol && Math.abs(re - c.r) < 1e-3 && ro < re - 1e-3));
}

/** Kuželové zahloubení v otevřeném konci díry: souosý kužel, který na konci navazuje poloměrem díry a rozšiřuje se ven. */
function sinkAt(g: PartGeom, c: GCyl, t: number, tol: number): { d: number; angle: number; len: number } | null {
  const at = add(c.p, mul(c.dir, t));
  for (const k of g.cones) {
    if (k.ext || !parallel(k.dir, c.dir) || radOf(c, k.p) >= tol) continue;
    for (const [te, re, to, ro] of [[k.t0, k.r0, k.t1, k.r1], [k.t1, k.r1, k.t0, k.r0]]) {
      if (Math.abs(dot(sub(add(k.p, mul(k.dir, te)), at), c.dir)) < tol && Math.abs(re - c.r) < 1e-3 && ro > re + 1e-3) {
        const l = Math.abs(to - te);
        return { d: 2 * ro, angle: (2 * Math.atan2(ro - re, l) * 180) / Math.PI, len: l };
      }
    }
  }
  return null;
}

/**
 * Válcová plocha díry o poloměru `r` na ose (bod, směr): hloubka od povrchu (0 = skrz; s kuželovým zahloubením v ústí se měří od
 * jeho horního okraje – jako u prvku díra) a zahloubení (`kužel … odebrat` v ústí díry → „⌵ Ø12 × 90°“).
 */
function boreOf(g: PartGeom, at: Vec3, dir: Vec3, r: number, tol: number): { depth: number; cs?: { d: number; angle: number } } | null {
  const T = Math.max(tol, 0.01);
  const c = g.cyls.find((x) => !x.ext && Math.abs(x.r - r) < 1e-3 && parallel(x.dir, dir) && radOf(x, at) < T);
  if (!c) return null;
  const ends = [c.t0, c.t1];
  const closed = ends.map((t) => closedAt(g, c, t, T));
  let depth = closed.some(Boolean) ? c.t1 - c.t0 : 0;
  for (let k = 0; k < 2; k++) {
    if (closed[k]) continue;
    const s = sinkAt(g, c, ends[k], T);
    if (!s) continue;
    if (depth > 0) depth += s.len;
    return { depth, cs: { d: s.d, angle: Math.round(s.angle * 100) / 100 } };
  }
  return { depth };
}

const holeDirOf = (f: HoleF): Vec3 => unit(f.dirDef?.kind === "vector" ? f.dirDef.v : (AXV[f.axis] ?? [0, 0, 1]));

/**
 * Díry pro popisy: prvky `díra` (beze změny, případně se souosým vnitřním závitem jako závitová díra) + díry z odebraných válců
 * + díry vnitřních závitů bez díry v historii. `notes` = co se popsat nedá (do přehledu „vynecháno“ chytrých kót).
 */
export function primHoles(doc: CadDoc, g: PartGeom, holes: HoleF[], tol: number): { holes: HoleF[]; notes: string[] } {
  const notes: string[] = [];
  const out = holes.slice();
  // ── válec odebraný z tělesa = díra (Ø, hloubka nebo skrz)
  for (const f of doc.features) {
    if (f.suppressed || f.type !== "cylinder" || f.mode !== "cut") continue;
    const pl = placementOf(f as CylF);
    if (!pl) {
      notes.push(tr("{0}: poloha odkazem není vyřešená – popis díry chybí (přestavte model)", f.name));
      continue;
    }
    const bore = boreOf(g, pl.position, pl.dir, f.radius, tol);
    if (!bore) continue; // odebraný válec netvoří díru (kapsa přes okraj, nic neodebral) – kótuje se jako tvar
    const cs = bore.cs ? { kind: "countersink" as const, csDiameter: bore.cs.d, csAngle: bore.cs.angle } : { kind: "simple" as const };
    out.push({ id: f.id, name: f.name, type: "hole", ...cs, position: pl.position, axis: "Z", dirDef: { kind: "vector", v: pl.dir }, flip: false, diameter: 2 * f.radius, depth: bore.depth, cbDiameter: 0, cbDepth: 0 });
  }
  // ── vnitřní závit: závitová díra (souosá díra z historie, jinak díra vrtáku v geometrii)
  for (const f of doc.features) {
    if (f.suppressed || f.type !== "thread" || !f.internal) continue;
    const th = f as ThreadF;
    const t = threadByName(th.designation);
    const pl = placementOf(th);
    if (!t || !pl) {
      notes.push(tr("{0}: poloha odkazem není vyřešená – popis závitu chybí (přestavte model)", f.name));
      continue;
    }
    const starts = (h: HoleF): Vec3[] => [h.position, ...(h.points ?? []).flatMap((q) => (q.kind === "xyz" ? [q.p as Vec3] : []))];
    const i = out.findIndex((h) => parallel(holeDirOf(h), pl.dir) && starts(h).some((p) => radOf({ p, dir: holeDirOf(h) }, pl.position) < Math.max(tol, 0.01)));
    const h = i >= 0 ? out[i] : null;
    if (h && h.kind === "tapped") continue; // závitová díra už závit má
    // vrták jiný než tabulkový, ale ke závitu se hodí (jádro D1 6,647, zadaný 6,7 – hole-spec.ts) = závitová díra s tímto vrtákem
    const own = h ? Math.abs(h.diameter - t.tap) > 1e-3 : false;
    if (h && own && !drillFitsThread(h.diameter, t)) {
      notes.push(tr("{0}: díra Ø{1} není vrták závitu {2} (Ø{3}) – závit v popisu díry doplňte ručně", f.name, String(Math.round(h.diameter * 1000) / 1000), t.name, String(t.tap)));
      continue;
    }
    if (h) {
      out[i] = { ...h, kind: "tapped", thread: t.name, threadDepth: th.length, diameter: own ? h.diameter : t.tap, ...(own ? { tapDrill: Math.abs(h.diameter - threadMinorD(t)) < 1e-3 ? ("minor" as const) : ("custom" as const) } : {}) };
      continue;
    }
    const bore = boreOf(g, pl.position, pl.dir, t.tap / 2, tol);
    if (!bore) {
      notes.push(tr("{0}: díra vrtáku Ø{1} pro vnitřní závit v geometrii nenalezena – popis závitu chybí", f.name, String(t.tap)));
      continue;
    }
    out.push({ id: f.id, name: f.name, type: "hole", kind: "tapped", thread: t.name, threadDepth: th.length, position: pl.position, axis: "Z", dirDef: { kind: "vector", v: pl.dir }, flip: false, diameter: t.tap, depth: bore.depth, cbDiameter: 0, cbDepth: 0 });
  }
  return { holes: out, notes };
}
