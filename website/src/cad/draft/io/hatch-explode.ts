/**
 * Rozklad šrafy na úsečky vzoru (pro DXF R12, který HATCH nezná) a plné výplně na trojúhelníky SOLID.
 * Smyčky se převedou na mnohoúhelníky (oblouky z vydutí vzorkované), čáry vzoru se protnou se všemi hranami
 * a vnitřek se určí pravidlem sudá–lichá (= styl ostrovů Normální); čárkování se odměřuje od bodu vzoru.
 */
import type { DHatch } from "../annot/types";
import { bulgeArc } from "../geom";
import type { Vec2 } from "../model";
import { patternLines } from "./hatchpat";
import type { PatLine } from "./types";

/** smyčka s vydutím → mnohoúhelník (oblouky po max. 10°) */
export function loopPolygon(pts: Vec2[], bulges?: number[]): Vec2[] {
  const out: Vec2[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    out.push(a);
    const bu = bulges?.[i] ?? 0;
    if (Math.abs(bu) < 1e-12) continue;
    const arc = bulgeArc(a, b, bu);
    const k = Math.max(2, Math.ceil(Math.abs(arc.sweep) / (Math.PI / 18)));
    for (let j = 1; j < k; j++) {
      const t = arc.a0 + (arc.sweep * j) / k;
      out.push([arc.c[0] + arc.r * Math.cos(t), arc.c[1] + arc.r * Math.sin(t)]);
    }
  }
  return out;
}

/** úsečky vzoru šrafy (nejvýš `max` kusů) */
export function hatchPatternSegments(e: DHatch, metric: boolean, max = 50000): [Vec2, Vec2][] {
  const lines: PatLine[] = e.ext?.pat?.length ? e.ext.pat : patternLines(e.pattern, e.scale || 1, e.angle ?? 0, metric) ?? patternLines("ANSI31", e.scale || 1, e.angle ?? 0, metric)!;
  const polys = e.loops.map((l) => loopPolygon(l.pts, l.bulges));
  const edges: [Vec2, Vec2][] = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polys)
    for (let i = 0; i < p.length; i++) {
      const a = p[i];
      edges.push([a, p[(i + 1) % p.length]]);
      x0 = Math.min(x0, a[0]);
      y0 = Math.min(y0, a[1]);
      x1 = Math.max(x1, a[0]);
      y1 = Math.max(y1, a[1]);
    }
  const out: [Vec2, Vec2][] = [];
  if (!edges.length) return out;
  const corners: Vec2[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
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
    const period = L.dashes.reduce((s, x) => s + Math.abs(x), 0);
    for (let k = k0; k <= k1; k++) {
      const P: Vec2 = [base[0] + L.offset[0] * k, base[1] + L.offset[1] * k];
      // průsečíky přímky P + t·d s hranami
      const ts: number[] = [];
      for (const [p, q] of edges) {
        const e1: Vec2 = [q[0] - p[0], q[1] - p[1]];
        const den = d[0] * e1[1] - d[1] * e1[0];
        if (Math.abs(den) < 1e-15) continue;
        const w: Vec2 = [p[0] - P[0], p[1] - P[1]];
        const t = (w[0] * e1[1] - w[1] * e1[0]) / den;
        const u = (w[0] * d[1] - w[1] * d[0]) / den;
        if (u >= 0 && u < 1) ts.push(t);
      }
      if (ts.length < 2) continue;
      ts.sort((x, y) => x - y);
      for (let i = 0; i + 1 < ts.length; i += 2) {
        const ta = ts[i];
        const tb = ts[i + 1];
        if (!L.dashes.length || period < 1e-12) out.push([[P[0] + d[0] * ta, P[1] + d[1] * ta], [P[0] + d[0] * tb, P[1] + d[1] * tb]]);
        else {
          // čárkování: vzor začíná v bodu P posunutém o k·shift
          const phase0 = k * shift;
          let t = ta;
          let rel = (((ta - phase0) % period) + period) % period;
          let di = 0;
          let acc = 0;
          while (di < L.dashes.length && acc + Math.abs(L.dashes[di]) <= rel) acc += Math.abs(L.dashes[di++]);
          di %= L.dashes.length;
          let left = Math.abs(L.dashes[di]) - (rel - acc);
          while (t < tb - 1e-12) {
            const dash = L.dashes[di];
            const end = Math.min(tb, t + Math.max(left, 0));
            if (dash > 0 || (dash === 0 && t >= ta)) out.push([[P[0] + d[0] * t, P[1] + d[1] * t], [P[0] + d[0] * (dash === 0 ? t : end), P[1] + d[1] * (dash === 0 ? t : end)]]);
            t = dash === 0 ? t : end;
            di = (di + 1) % L.dashes.length;
            left = Math.abs(L.dashes[di]);
            rel = 0;
            if (out.length > max) return out;
            if (dash === 0 && left === 0) break;
          }
        }
        if (out.length > max) return out;
      }
    }
  }
  return out;
}

/** plná výplň → trojúhelníky (ořezávání uší; jen jedna smyčka bez ostrovů, jinak null) */
export function solidTriangles(e: DHatch): Vec2[][] | null {
  if (e.loops.length !== 1) return null;
  let poly = loopPolygon(e.loops[0].pts, e.loops[0].bulges);
  if (poly.length < 3) return null;
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  if (area < 0) poly = [...poly].reverse();
  const tris: Vec2[][] = [];
  const idx = poly.map((_, i) => i);
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const inside = (p: Vec2, a: Vec2, b: Vec2, c: Vec2) => cross(a, b, p) >= -1e-12 && cross(b, c, p) >= -1e-12 && cross(c, a, p) >= -1e-12;
  let guard = 0;
  while (idx.length > 3 && guard++ < 100000) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const a = poly[idx[(i + idx.length - 1) % idx.length]];
      const b = poly[idx[i]];
      const c = poly[idx[(i + 1) % idx.length]];
      if (cross(a, b, c) <= 1e-15) continue;
      let ear = true;
      for (const j of idx) {
        const p = poly[j];
        if (p === a || p === b || p === c) continue;
        if (inside(p, a, b, c)) {
          ear = false;
          break;
        }
      }
      if (!ear) continue;
      tris.push([a, b, c]);
      idx.splice(i, 1);
      cut = true;
      break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) tris.push(idx.map((i) => poly[i]));
  return tris;
}
