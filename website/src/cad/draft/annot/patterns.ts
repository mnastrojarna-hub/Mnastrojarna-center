/**
 * BALÍK 2 (annot) – vzory šraf: knihovna acad.pat (palce) / acadiso.pat (mm = palce × 25,4) pro ANSI31…38, ISO a běžné
 * vzory, uživatelský vzor _USER (rovnoběžky s roztečí = měřítko, dvojitá = křížem), čtení vlastních .pat souborů,
 * výpočet úseček vzoru ve smyčkách hranice podle stylu ostrovů (normální / vnější / ignorovat) a plocha šrafy.
 */
import { tr } from "../../i18n";
import { bulgeArc, polyArea, type Box } from "../geom";
import type { Vec2 } from "../model";
import type { DHatch } from "./types";

/** řádek vzoru: úhel [°], počátek, posun (dx po čáře, dy kolmo – v rámu čáry), čárky (+ čára, − mezera, 0 tečka) */
export type PatRow = { angle: number; base: Vec2; offset: Vec2; dashes: number[] };
/** řádek vzoru ve světových souřadnicích (natočený a v měřítku): posun je vektor (jako DXF 45/46) */
export type PatLine = { angle: number; base: Vec2; offset: Vec2; dashes: number[] };
export type PatDef = { name: string; desc: string; rows: PatRow[]; iso?: boolean };

const R = (a: number, x: number, y: number, dx: number, dy: number, ...d: number[]): PatRow => ({ angle: a, base: [x, y], offset: [dx, dy], dashes: d });

/** knihovna (acad.pat v palcích; ISO vzory v mm) */
const LIB: PatDef[] = [
  { name: "ANSI31", desc: "ANSI Iron, Brick, Stone masonry", rows: [R(45, 0, 0, 0, 0.125)] },
  { name: "ANSI32", desc: "ANSI Steel", rows: [R(45, 0, 0, 0, 0.375), R(45, 0.176776695, 0, 0, 0.375)] },
  { name: "ANSI33", desc: "ANSI Bronze, Brass, Copper", rows: [R(45, 0, 0, 0, 0.25), R(45, 0.176776695, 0, 0, 0.25, 0.125, -0.0625)] },
  { name: "ANSI34", desc: "ANSI Plastic, Rubber", rows: [R(45, 0, 0, 0, 0.75), R(45, 0.176776695, 0, 0, 0.75), R(45, 0.353553391, 0, 0, 0.75), R(45, 0.530330086, 0, 0, 0.75)] },
  { name: "ANSI35", desc: "ANSI Fire brick, Refractory material", rows: [R(45, 0, 0, 0, 0.25), R(45, 0.176776695, 0, 0, 0.25, 0.3125, -0.0625, 0, -0.0625)] },
  { name: "ANSI36", desc: "ANSI Marble, Slate, Glass", rows: [R(45, 0, 0, 0.21875, 0.125, 0.3125, -0.0625, 0, -0.0625)] },
  { name: "ANSI37", desc: "ANSI Lead, Zinc, Magnesium, Insulation", rows: [R(45, 0, 0, 0, 0.125), R(135, 0, 0, 0, 0.125)] },
  { name: "ANSI38", desc: "ANSI Aluminum", rows: [R(45, 0, 0, 0, 0.125), R(135, 0, 0, 0.25, 0.125, 0.3125, -0.1875)] },
  { name: "ANGLE", desc: "Angle steel", rows: [R(0, 0, 0, 0, 0.275, 0.2, -0.075), R(90, 0, 0, 0, 0.275, 0.2, -0.075)] },
  { name: "BOX", desc: "Box steel", rows: [R(90, 0, 0, 0, 1), R(90, 0.25, 0, 0, 1), R(0, 0, 0, 0, 1, -0.25, 0.25), R(0, 0, 0.25, 0, 1, -0.25, 0.25), R(0, 0, 0.5, 0, 1, 0.25, -0.25), R(0, 0, 0.75, 0, 1, 0.25, -0.25), R(90, 0.5, 0, 0, 1, 0.25, -0.25), R(90, 0.75, 0, 0, 1, 0.25, -0.25)] },
  { name: "BRICK", desc: "Brick or masonry-type surface", rows: [R(0, 0, 0, 0, 0.25), R(90, 0, 0, 0, 0.5, 0.25, -0.25), R(90, 0.25, 0, 0, 0.5, -0.25, 0.25)] },
  { name: "CLAY", desc: "Clay material", rows: [R(0, 0, 0, 0, 0.1875), R(0, 0, 0.03125, 0, 0.1875), R(0, 0, 0.0625, 0, 0.1875), R(0, 0, 0.125, 0, 0.1875, 0.1875, -0.125)] },
  { name: "CORK", desc: "Cork material", rows: [R(0, 0, 0, 0, 0.125), R(135, 0.0625, -0.0625, 0, 0.35355339, 0.176776696, -0.176776696), R(135, 0.09375, -0.0625, 0, 0.35355339, 0.176776696, -0.176776696), R(135, 0.125, -0.0625, 0, 0.35355339, 0.176776696, -0.176776696)] },
  { name: "CROSS", desc: "A series of crosses", rows: [R(0, 0, 0, 0.25, 0.25, 0.125, -0.375), R(90, 0.0625, -0.0625, 0.25, 0.25, 0.125, -0.375)] },
  { name: "DASH", desc: "Dashed lines", rows: [R(0, 0, 0, 0.125, 0.125, 0.125, -0.125)] },
  { name: "DOTS", desc: "A series of dots", rows: [R(0, 0, 0, 0.03125, 0.0625, 0, -0.0625)] },
  { name: "EARTH", desc: "Earth or ground (subterranean)", rows: [R(0, 0, 0, 0.25, 0.25, 0.25, -0.25), R(0, 0, 0.09375, 0.25, 0.25, 0.25, -0.25), R(0, 0, 0.1875, 0.25, 0.25, 0.25, -0.25), R(90, 0.03125, 0.21875, 0.25, 0.25, 0.25, -0.25), R(90, 0.125, 0.21875, 0.25, 0.25, 0.25, -0.25), R(90, 0.21875, 0.21875, 0.25, 0.25, 0.25, -0.25)] },
  { name: "GRATE", desc: "Grated area", rows: [R(0, 0, 0, 0, 0.03125), R(90, 0, 0, 0, 0.125)] },
  { name: "HEX", desc: "Hexagons", rows: [R(0, 0, 0, 0, 0.216506351, 0.125, -0.25), R(120, 0, 0, 0, 0.216506351, 0.125, -0.25), R(60, 0.125, 0, 0, 0.216506351, 0.125, -0.25)] },
  { name: "HONEY", desc: "Honeycomb pattern", rows: [R(0, 0, 0, 0.1875, 0.108253175, 0.125, -0.25), R(120, 0, 0, 0.1875, 0.108253175, 0.125, -0.25), R(60, 0, 0, 0.1875, 0.108253175, -0.25, 0.125)] },
  { name: "INSUL", desc: "Insulation material", rows: [R(0, 0, 0, 0, 0.375), R(0, 0, 0.125, 0, 0.375, 0.125, -0.125), R(0, 0, 0.25, 0, 0.375, 0.125, -0.125)] },
  { name: "LINE", desc: "Parallel horizontal lines", rows: [R(0, 0, 0, 0, 0.125)] },
  { name: "NET", desc: "Horizontal / vertical grid", rows: [R(0, 0, 0, 0, 0.125), R(90, 0, 0, 0, 0.125)] },
  { name: "NET3", desc: "Network pattern 0-60-120", rows: [R(0, 0, 0, 0, 0.125), R(60, 0, 0, 0, 0.125), R(120, 0, 0, 0, 0.125)] },
  { name: "SQUARE", desc: "Small aligned squares", rows: [R(0, 0, 0, 0, 0.125, 0.125, -0.125), R(90, 0, 0, 0, 0.125, 0.125, -0.125)] },
  { name: "STEEL", desc: "Steel material", rows: [R(45, 0, 0, 0, 0.125), R(45, 0, 0.0625, 0, 0.125)] },
  { name: "TRANS", desc: "Heat transfer material", rows: [R(0, 0, 0, 0, 0.25), R(0, 0, 0.125, 0, 0.25, 0.125, -0.125)] },
  { name: "TRIANG", desc: "Equilateral triangles", rows: [R(60, 0, 0, 0.1875, 0.324759526, 0.1875, -0.1875), R(120, 0, 0, 0.1875, 0.324759526, 0.1875, -0.1875), R(0, -0.09375, 0.162379763, 0.1875, 0.324759526, 0.1875, -0.1875)] },
  { name: "ZIGZAG", desc: "Staircase effect", rows: [R(0, 0, 0, 0.125, 0.125, 0.125, -0.125), R(90, 0.125, 0, 0.125, 0.125, 0.125, -0.125)] },
  // acadiso.pat – čáry podle ISO 128 (mm)
  { name: "ISO02W100", desc: "dashed line", iso: true, rows: [R(0, 0, 0, 0, 5, 12, -3)] },
  { name: "ISO03W100", desc: "dashed space line", iso: true, rows: [R(0, 0, 0, 0, 5, 12, -18)] },
  { name: "ISO04W100", desc: "long dashed dotted line", iso: true, rows: [R(0, 0, 0, 0, 5, 24, -3, 0.5, -3)] },
  { name: "ISO05W100", desc: "long dashed double dotted line", iso: true, rows: [R(0, 0, 0, 0, 5, 24, -3, 0.5, -3, 0.5, -3)] },
  { name: "ISO07W100", desc: "dotted line", iso: true, rows: [R(0, 0, 0, 0, 5, 0.5, -3)] },
  { name: "ISO10W100", desc: "dashed dotted line", iso: true, rows: [R(0, 0, 0, 0, 5, 12, -3, 0.5, -3)] },
];

/** vlastní vzory načtené z .pat (relace prohlížeče / testy); výkres nese řádky v `ext.pat` */
const CUSTOM = new Map<string, PatDef>();
export const patternLibrary = (): PatDef[] => [...LIB, ...CUSTOM.values()];
export const findPattern = (name: string): PatDef | undefined => {
  const k = name.trim().toUpperCase();
  return LIB.find((p) => p.name === k) ?? CUSTOM.get(k);
};
export const isSolidName = (n: string) => /^solid$/i.test(n.trim());
export const isUserName = (n: string) => /^_?user$/i.test(n.trim());

/** Čtení souboru .pat (formát AutoCADu: *NÁZEV, popis / řádky úhel, x, y, dx, dy [, čárky…]). */
export function parsePat(text: string): PatDef[] {
  const out: PatDef[] = [];
  let cur: PatDef | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, "").trim();
    if (!line) continue;
    if (line.startsWith("*")) {
      const [n, ...d] = line.slice(1).split(",");
      cur = { name: n.trim().toUpperCase(), desc: d.join(",").trim(), rows: [] };
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    const v = line.split(",").map((x) => Number(x.trim()));
    if (v.length < 5 || v.slice(0, 5).some((x) => !Number.isFinite(x))) throw new Error(tr("vzor {0}: neplatný řádek „{1}“", cur.name, raw.trim()));
    cur.rows.push(R(v[0], v[1], v[2], v[3], v[4], ...v.slice(5).filter((x) => Number.isFinite(x))));
  }
  return out.filter((p) => p.rows.length);
}
/** přidá vzory z .pat do knihovny relace (vrací názvy) */
export function registerPatterns(text: string): string[] {
  const defs = parsePat(text);
  if (!defs.length) throw new Error(tr("soubor neobsahuje žádný vzor šrafy (*NÁZEV a řádky)"));
  for (const d of defs) CUSTOM.set(d.name, d);
  return defs.map((d) => d.name);
}

const rotV = (v: Vec2, a: number): Vec2 => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)];
/** řádky definice → světové řádky vzoru (natočené o `angle` [°], v měřítku) */
export function rowsToLines(rows: PatRow[], k: number, angle: number): PatLine[] {
  const a = (angle * Math.PI) / 180;
  return rows.map((r) => {
    const la = ((r.angle + angle) * Math.PI) / 180;
    return { angle: r.angle + angle, base: rotV([r.base[0] * k, r.base[1] * k], a), offset: rotV([r.offset[0] * k, r.offset[1] * k], la), dashes: r.dashes.map((d) => d * k) };
  });
}

/** řádky vzoru šrafy (null = plná / přechod nebo neznámý vzor bez řádků v ext) */
export function hatchLines(e: DHatch, metric: boolean, k = 1): PatLine[] | null {
  if (e.solid || isSolidName(e.pattern) || e.gradient) return null;
  const sc = (e.scale || 1) * k;
  if (isUserName(e.pattern)) {
    const rows = [R(0, 0, 0, 0, 1)];
    if (e.double) rows.push(R(90, 0, 0, 0, 1));
    return rowsToLines(rows, sc, e.angle ?? 0);
  }
  const def = findPattern(e.pattern);
  if (def) {
    const unit = def.iso ? 1 : metric ? 25.4 : 1;
    const rows = e.double && def.rows.length === 1 ? [...def.rows, { ...def.rows[0], angle: def.rows[0].angle + 90 }] : def.rows;
    return rowsToLines(rows, unit * sc, e.angle ?? 0);
  }
  const ext = (e.ext as { pat?: PatLine[] } | undefined)?.pat;
  return ext?.length ? ext : null;
}

// ---------------------------------------------------------------- smyčky

/** smyčka s vydutím → mnohoúhelník (oblouky po nejvýš `stepDeg`) */
export function loopPolygon(pts: Vec2[], bulges?: number[], stepDeg = 4): Vec2[] {
  const out: Vec2[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    out.push(a);
    const bu = bulges?.[i] ?? 0;
    if (Math.abs(bu) < 1e-12 || (a[0] === b[0] && a[1] === b[1])) continue;
    const arc = bulgeArc(a, b, bu);
    const kk = Math.max(2, Math.ceil(Math.abs(arc.sweep) / ((stepDeg * Math.PI) / 180)));
    for (let j = 1; j < kk; j++) {
      const t = arc.a0 + (arc.sweep * j) / kk;
      out.push([arc.c[0] + arc.r * Math.cos(t), arc.c[1] + arc.r * Math.sin(t)]);
    }
  }
  return out;
}
/** plocha smyčky s oblouky (se znaménkem, kladná proti směru hodin) */
export function loopArea(pts: Vec2[], bulges?: number[]): number {
  let s = polyArea(pts);
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const bu = bulges?.[i] ?? 0;
    if (Math.abs(bu) < 1e-12) continue;
    const arc = bulgeArc(pts[i], pts[(i + 1) % n], bu);
    s += ((arc.r * arc.r) / 2) * (arc.sweep - Math.sin(arc.sweep));
  }
  return s;
}
export function inPoly(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** hloubka vnoření smyček (0 = vnější) – podle bodu uvnitř každé smyčky */
export function loopDepths(polys: Vec2[][]): number[] {
  return polys.map((p, i) => {
    const probe = p[0];
    let d = 0;
    polys.forEach((q, j) => {
      if (j !== i && q.length >= 3 && Math.abs(polyArea(q)) > Math.abs(polyArea(p)) && inPoly(probe, q)) d++;
    });
    return d;
  });
}
/** smyčky, které se uplatní podle stylu ostrovů (0 normální = všechny, 1 vnější = hloubka ≤ 1, 2 ignorovat = jen vnější) */
export function activeLoops(e: DHatch, polys: Vec2[][]): number[] {
  const st = e.islandStyle ?? 0;
  const depth = loopDepths(polys);
  return polys.map((_, i) => i).filter((i) => polys[i].length >= 3 && (st === 0 || (st === 1 ? depth[i] <= 1 : depth[i] === 0)));
}

/** plocha šrafy: součet podle sudo-lichého pravidla aktivních smyček (vnější − ostrovy + ostrovy v ostrovech…) */
export function hatchArea(e: DHatch): number {
  const polys = e.loops.map((l) => loopPolygon(l.pts, l.bulges));
  const act = activeLoops(e, polys);
  const depth = loopDepths(act.map((i) => polys[i]));
  let s = 0;
  act.forEach((i, k) => {
    const a = Math.abs(loopArea(e.loops[i].pts, e.loops[i].bulges));
    s += depth[k] % 2 === 0 ? a : -a;
  });
  return s;
}

/** Úsečky vzoru šrafy ve smyčkách (sudo-liché pravidlo aktivních smyček). Nejvýš `max` úseček (pak `dense`). */
export function hatchSegments(e: DHatch, lines: PatLine[], max = 100000): { segs: [Vec2, Vec2][]; dense: boolean } {
  const polys = e.loops.map((l) => loopPolygon(l.pts, l.bulges));
  const act = activeLoops(e, polys).map((i) => polys[i]);
  const edges: [Vec2, Vec2][] = [];
  const box: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const p of act)
    for (let i = 0; i < p.length; i++) {
      const a = p[i];
      edges.push([a, p[(i + 1) % p.length]]);
      if (a[0] < box.x0) box.x0 = a[0];
      if (a[1] < box.y0) box.y0 = a[1];
      if (a[0] > box.x1) box.x1 = a[0];
      if (a[1] > box.y1) box.y1 = a[1];
    }
  const out: [Vec2, Vec2][] = [];
  if (!edges.length) return { segs: out, dense: false };
  const corners: Vec2[] = [[box.x0, box.y0], [box.x1, box.y0], [box.x1, box.y1], [box.x0, box.y1]];
  const origin = e.origin ?? [0, 0];
  for (const L of lines) {
    const a = (L.angle * Math.PI) / 180;
    const d: Vec2 = [Math.cos(a), Math.sin(a)];
    const n: Vec2 = [-d[1], d[0]];
    const spacing = L.offset[0] * n[0] + L.offset[1] * n[1];
    const shift = L.offset[0] * d[0] + L.offset[1] * d[1];
    if (Math.abs(spacing) < 1e-12) continue;
    const base: Vec2 = [origin[0] + L.base[0], origin[1] + L.base[1]];
    const proj = corners.map((c) => ((c[0] - base[0]) * n[0] + (c[1] - base[1]) * n[1]) / spacing);
    const k0 = Math.floor(Math.min(...proj)) - 1;
    const k1 = Math.ceil(Math.max(...proj)) + 1;
    if ((k1 - k0) * Math.max(1, edges.length / 50) > max * 4) return { segs: out, dense: true };
    const dashes = L.dashes;
    const period = dashes.reduce((s, x) => s + Math.abs(x), 0);
    for (let kk = k0; kk <= k1; kk++) {
      const P: Vec2 = [base[0] + L.offset[0] * kk, base[1] + L.offset[1] * kk];
      const ts: number[] = [];
      for (const [p, q] of edges) {
        // průsečík jen při změně strany (pravidlo polouzavřené poloroviny – vrchol se nepočítá dvakrát)
        const sp = (p[0] - P[0]) * n[0] + (p[1] - P[1]) * n[1];
        const sq = (q[0] - P[0]) * n[0] + (q[1] - P[1]) * n[1];
        if (sp >= 0 === sq >= 0) continue;
        const f = sp / (sp - sq);
        const X: Vec2 = [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
        ts.push((X[0] - P[0]) * d[0] + (X[1] - P[1]) * d[1]);
      }
      if (ts.length < 2) continue;
      ts.sort((x, y) => x - y);
      const pt = (t: number): Vec2 => [P[0] + d[0] * t, P[1] + d[1] * t];
      for (let i = 0; i + 1 < ts.length; i += 2) {
        const ta = ts[i];
        const tb = ts[i + 1];
        if (tb - ta < 1e-12) continue;
        if (!dashes.length || period < 1e-12) out.push([pt(ta), pt(tb)]);
        else {
          // čárkování od bodu P posunutého o k·posun (fáze vzoru)
          const phase = kk * shift;
          let start = Math.floor((ta - phase) / period) * period + phase;
          for (; start < tb; start += period) {
            let t = start;
            for (const dsh of dashes) {
              const l = Math.abs(dsh);
              if (dsh >= 0) {
                const s0 = Math.max(t, ta);
                const s1 = Math.min(t + l, tb);
                if (dsh === 0 ? t >= ta && t <= tb : s1 > s0) out.push(dsh === 0 ? [pt(t), pt(t)] : [pt(s0), pt(s1)]);
              }
              t += l;
            }
            if (out.length > max) return { segs: out, dense: true };
          }
        }
        if (out.length > max) return { segs: out, dense: true };
      }
    }
  }
  return { segs: out, dense: false };
}
