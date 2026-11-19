/**
 * Náhled kola a soukolí ve 2D – čistá geometrie (bez Reactu a DOM, testy v Node): obrys zubů, díra, roztečná / hlavová /
 * patní / základní kružnice; kuželová a hypoidní kola a šnek z boku (poloviční řez polotovaru zrcadlený podle osy);
 * soukolí = obě kola v poloze sestavy promítnutá do roviny záběru (válcová: rovina XY, hřeben / kuželová: rovina XZ),
 * u vnějšího válcového soukolí i přímka záběru. Souřadnice v mm, osa y nahoru (SVG ji otáčí samo).
 */
import { apply3, rotMatrix } from "@/cad/assembly";
import { KINDS, gearCompute, gearProfile, profilePolyline, type GearData, type GearKind, type PairKind, type PairResult, type Profile2D, type Vec2 } from "@/cad/gears";
import type { Vec3 } from "@/cad/types";

export type ShapeRole = "body" | "section";
/** uzavřený obrys tělesa s otvory (vyplňuje se pravidlem sudá–lichá) */
export type Shape2 = { outer: Vec2[]; holes: Vec2[][]; role: ShapeRole; wheel?: 0 | 1 };
export type CircleRole = "ref" | "tip" | "root" | "base";
export type Circle2 = { c: Vec2; r: number; role: CircleRole };
export type Line2 = { a: Vec2; b: Vec2; role: "axis" | "pitch" | "action" };
export type Sketch2 = { shapes: Shape2[]; circles: Circle2[]; lines: Line2[]; box: [Vec2, Vec2] };

/** druhy kreslené jako čelní řez (osa kolmo na náhled) */
const TRANSVERSE = new Set<GearKind>(["spur", "helical", "herringbone", "internal", "cycloid", "cyclodisc", "sprocket", "pulley", "ratchet", "wormwheel"]);
/** druhy kreslené z boku (osa v rovině náhledu) */
const SIDE = new Set<GearKind>(["bevel", "hypoid", "worm"]);

const circlePts = (c: Vec2, r: number, n = 96): Vec2[] => Array.from({ length: n }, (_, i) => [c[0] + r * Math.cos((2 * Math.PI * i) / n), c[1] + r * Math.sin((2 * Math.PI * i) / n)] as Vec2);

function boxOf(pts: Iterable<Vec2>, circles: Circle2[] = []): [Vec2, Vec2] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    x0 = Math.min(x0, p[0]);
    y0 = Math.min(y0, p[1]);
    x1 = Math.max(x1, p[0]);
    y1 = Math.max(y1, p[1]);
  }
  for (const c of circles) {
    x0 = Math.min(x0, c.c[0] - c.r);
    y0 = Math.min(y0, c.c[1] - c.r);
    x1 = Math.max(x1, c.c[0] + c.r);
    y1 = Math.max(y1, c.c[1] + c.r);
  }
  if (!Number.isFinite(x0)) return [[-1, -1], [1, 1]];
  return [[x0, y0], [x1, y1]];
}
const allPts = (s: Pick<Sketch2, "shapes" | "lines">): Vec2[] => [...s.shapes.flatMap((x) => [x.outer, ...x.holes].flat()), ...s.lines.flatMap((l) => [l.a, l.b])];
const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** přesnost lomené čáry podle velikosti kola (náhled: ~1/1500 průměru, miniatura hrubší) */
const tolFor = (p: Profile2D, coarse: boolean) => Math.max(1e-3, Math.abs(p.circles.tip || p.circles.ref || 50) / (coarse ? 300 : 1500));

/** kružnice profilu (jen kladné průměry) */
function profileCircles(p: Profile2D): Circle2[] {
  const out: Circle2[] = [];
  const add = (d: number | undefined, role: CircleRole) => d && d > 0 && out.push({ c: [0, 0], r: d / 2, role });
  add(p.circles.ref, "ref");
  add(p.circles.tip, "tip");
  add(p.circles.root, "root");
  add(p.circles.base, "base");
  return out;
}

/**
 * Náhled jednoho kola v místní soustavě druhu (zub 0 na +X, osa Z do obrazovky; hřeben: roztečná přímka y = 0; kuželové
 * a hypoidní: osa svisle, vrchol nahoře; šnek: osa vodorovně). Neplatná data → prázdný náhled (bez výjimky).
 */
export function wheelSketch(kind: GearKind, d: GearData, o: { coarse?: boolean } = {}): Sketch2 {
  const def = KINDS[kind];
  const data = { ...def.defaults(), ...d };
  try {
    if (SIDE.has(kind)) return sideSketch(kind, data, o.coarse ?? false);
    const p = gearProfile(def.ext, data);
    const tol = tolFor(p, o.coarse ?? false);
    const pts = profilePolyline(p, tol);
    const c = gearCompute(def.ext, data);
    if (kind === "rack") {
      const h0 = num(c.h0, 10);
      const outer: Vec2[] = [...pts, [pts[pts.length - 1][0], -h0], [pts[0][0], -h0]];
      const lines: Line2[] = [{ a: [pts[0][0] - 2, 0], b: [pts[pts.length - 1][0] + 2, 0], role: "pitch" }];
      const shapes: Shape2[] = [{ outer, holes: [], role: "body" }];
      return { shapes, circles: [], lines, box: boxOf(allPts({ shapes, lines })) };
    }
    const ring = kind === "internal" || (kind === "cyclodisc" && data.part === "ring");
    const holes: Vec2[][] = [];
    let outer = pts;
    if (ring) {
      const rOut = kind === "internal" ? num(c.rimD, p.circles.root + 10) / 2 : num(c.ringD, p.circles.root + 10) / 2;
      outer = circlePts([0, 0], rOut, 144);
      holes.push(pts);
    } else {
      const bore = kind === "cyclodisc" ? num(data.centerD) : num(data.bore);
      if (bore > 0) holes.push(circlePts([0, 0], bore / 2, 64));
    }
    const shapes: Shape2[] = [{ outer, holes, role: "body" }];
    const circles = kind === "cyclodisc" ? [] : profileCircles(p);
    if (kind === "cyclodisc") circles.push({ c: [0, 0], r: num(data.pinCircle, 60) / 2, role: "ref" });
    return { shapes, circles, lines: [], box: boxOf(allPts({ shapes, lines: [] }), circles) };
  } catch {
    return { shapes: [], circles: [], lines: [], box: [[-1, -1], [1, 1]] };
  }
}

/** poloviční řez polotovaru (r, z) zrcadlený podle osy; `axis` = "y" (kuželová: osa svisle) nebo "x" (šnek: osa vodorovně) */
function mirrorSection(sec: Vec2[], axis: "x" | "y"): Vec2[] {
  const map = (r: number, z: number): Vec2 => (axis === "y" ? [r, z] : [z, r]);
  return [...sec.map(([r, z]) => map(r, z)), ...[...sec].reverse().map(([r, z]) => map(-r, z))];
}
function sideSketch(kind: GearKind, data: GearData, coarse: boolean): Sketch2 {
  const def = KINDS[kind];
  const i = def.read(data);
  const c = def.compute(i);
  const sec = def.blank(i, c);
  if (!sec.length) throw new Error("blank");
  const ax: "x" | "y" = kind === "worm" ? "x" : "y";
  const shapes: Shape2[] = [{ outer: mirrorSection(sec, ax), holes: [], role: "section" }];
  const lines: Line2[] = [];
  const zs = sec.map((p) => p[1]);
  const z0 = Math.min(...zs);
  const z1 = Math.max(...zs);
  if (kind === "worm") {
    // osa a zuby závitu nahoře a dole (osový řez: dole posunutý o půl stoupání)
    lines.push({ a: [z0 - 3, 0], b: [z1 + 3, 0], role: "axis" });
    const p = gearProfile(def.ext, data);
    const pts = profilePolyline(p, tolFor(p, coarse));
    const rm = p.circles.ref / 2;
    const shift = (p.pitch ?? 0) / 2;
    const top = pts.map(([x, y]) => [x, rm + y] as Vec2);
    const bottom = pts.map(([x, y]) => [x + shift, -(rm + y)] as Vec2);
    const span = (q: Vec2[]): Vec2[] => [...q, [q[q.length - 1][0], 0], [q[0][0], 0]];
    shapes.push({ outer: span(top), holes: [], role: "body" }, { outer: span(bottom), holes: [], role: "body" });
  } else {
    lines.push({ a: [0, z0 - 3], b: [0, Math.max(z1, 0) + 3], role: "axis" });
  }
  return { shapes, circles: [], lines, box: boxOf(allPts({ shapes, lines })) };
}

// ---------------- soukolí ----------------

/** rovina náhledu soukolí: normála N a osy U, V */
function viewOf(kind: PairKind): { N: Vec3; U: Vec3; V: Vec3 } {
  return kind === "rack" || kind === "bevel" || kind === "hypoid" ? { N: [0, 1, 0], U: [1, 0, 0], V: [0, 0, 1] } : { N: [0, 0, 1], U: [1, 0, 0], V: [0, 1, 0] };
}
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * Náhled soukolí: obě kola v poloze sestavy (`res.placement`) promítnutá do roviny záběru. Kolo s osou kolmo na rovinu se
 * kreslí čelním řezem, kolo s osou v rovině z boku (polotovar), hřeben svým profilem. Vnější válcové soukolí dostane
 * přímku záběru (tečna k oběma základním kružnicím přes valivý bod).
 */
export function pairSketch(kind: PairKind, res: PairResult, o: { coarse?: boolean } = {}): Sketch2 {
  const { N, U, V } = viewOf(kind);
  const shapes: Shape2[] = [];
  const circles: Circle2[] = [];
  const lines: Line2[] = [];
  const proj = (w: Vec3): Vec2 => [dot(w, U), dot(w, V)];
  res.wheels.forEach((w, idx) => {
    const gk = w.ext.slice(5) as GearKind;
    if (!KINDS[gk]) return;
    const pl = res.placement[idx];
    const R = rotMatrix(pl.rot);
    const at = pl.at;
    const toWorld = (l: Vec3): Vec3 => {
      const r = apply3(R, l);
      return [r[0] + at[0], r[1] + at[1], r[2] + at[2]];
    };
    const sk = wheelSketch(gk, w.data, o);
    const wheel = idx as 0 | 1;
    if (gk === "rack") {
      const c = (() => {
        try {
          return gearCompute(w.ext, { ...KINDS.rack.defaults(), ...w.data });
        } catch {
          return {} as Record<string, number>;
        }
      })();
      const h0 = num(c.h0, 10);
      const lift = (p: Vec2): Vec2 => proj(toWorld([p[0], 0, p[1] + h0]));
      for (const s of sk.shapes) shapes.push({ outer: s.outer.map(lift), holes: s.holes.map((h) => h.map(lift)), role: s.role, wheel });
      for (const l of sk.lines) lines.push({ a: lift(l.a), b: lift(l.b), role: l.role });
      return;
    }
    const axis = unit(apply3(R, [0, 0, 1]));
    const along = Math.abs(dot(axis, N));
    if (TRANSVERSE.has(gk) || (along > 0.99 && !SIDE.has(gk))) {
      if (along < 0.99) return; // čelní řez šikmo k náhledu – nekreslí se
      const lift = (p: Vec2): Vec2 => proj(toWorld([p[0], p[1], 0]));
      for (const s of sk.shapes) shapes.push({ outer: s.outer.map(lift), holes: s.holes.map((h) => h.map(lift)), role: s.role, wheel });
      const c0 = proj(toWorld([0, 0, 0]));
      for (const c of sk.circles) circles.push({ c: c0, r: c.r, role: c.role });
      return;
    }
    if (along > 0.05) return;
    // z boku: poloviční řez polotovaru podél osy, šířka kolmo na osu v rovině náhledu
    const def = KINDS[gk];
    try {
      const i = def.read({ ...def.defaults(), ...w.data });
      const sec = def.blank(i, def.compute(i));
      const u = unit(cross(N, axis));
      const pt = (r: number, z: number): Vec2 => proj([at[0] + z * axis[0] + r * u[0], at[1] + z * axis[1] + r * u[1], at[2] + z * axis[2] + r * u[2]]);
      shapes.push({ outer: [...sec.map(([r, z]) => pt(r, z)), ...[...sec].reverse().map(([r, z]) => pt(-r, z))], holes: [], role: "section", wheel });
      const zs = sec.map((q) => q[1]);
      lines.push({ a: pt(0, Math.min(...zs) - 3), b: pt(0, Math.max(...zs) + 3), role: "axis" });
    } catch {
      /* neplatné kolo – v náhledu chybí, chybu ukáže tabulka */
    }
  });
  // přímka záběru vnějšího válcového soukolí
  if ((kind === "spur" || kind === "helical" || kind === "herringbone") && res.ok) {
    try {
      const [w1, w2] = res.wheels;
      const a = res.placement[1].at[0] - res.placement[0].at[0];
      const c1 = gearCompute(w1.ext, { ...KINDS[w1.ext.slice(5) as GearKind].defaults(), ...w1.data });
      const c2 = gearCompute(w2.ext, { ...KINDS[w2.ext.slice(5) as GearKind].defaults(), ...w2.data });
      const z1 = num(w1.data.z);
      const z2 = num(w2.data.z);
      const rw1 = (a * z1) / (z1 + z2);
      const aw = Math.acos(Math.min(1, num(c1.rb) / rw1));
      if (Number.isFinite(aw) && a > 0) lines.push({ a: [num(c1.rb) * Math.cos(aw), num(c1.rb) * Math.sin(aw)], b: [a - num(c2.rb) * Math.cos(aw), -num(c2.rb) * Math.sin(aw)], role: "action" });
    } catch {
      /* bez přímky záběru */
    }
  }
  return { shapes, circles, lines, box: boxOf(allPts({ shapes, lines }), circles) };
}

/** obrys → cesta SVG (y dolů) */
export function pathOf(pts: Vec2[], closed = true): string {
  if (!pts.length) return "";
  const f = (v: number) => (Math.round(v * 1000) / 1000).toString();
  return "M" + pts.map((p) => `${f(p[0])} ${f(-p[1])}`).join("L") + (closed ? "Z" : "");
}
/** těleso s otvory jako jedna cesta (fill-rule evenodd) */
export const shapePath = (s: Shape2) => [s.outer, ...s.holes].map((p) => pathOf(p)).join("");

/** výřez náhledu kolem zubu 0 (detail paty a hlavy) – jen čelní druhy kreslené kolem počátku */
export function toothFocus(kind: GearKind, d: GearData): [Vec2, Vec2] | null {
  if (!TRANSVERSE.has(kind) && kind !== "rack") return null;
  try {
    const def = KINDS[kind];
    const p = gearProfile(def.ext, { ...def.defaults(), ...d });
    if (kind === "rack") {
      const pitch = p.pitch ?? 6;
      const span = 1.6 * pitch;
      return [[pitch / 2 - span, -span * 0.75], [pitch / 2 + span, span * 0.75]];
    }
    const r = (p.circles.ref || p.circles.tip) / 2;
    const pitch = (2 * Math.PI * r) / Math.max(1, p.count);
    const span = 1.6 * pitch;
    return [[r - span * 0.75, -span], [r + span * 0.75, span]];
  } catch {
    return null;
  }
}
