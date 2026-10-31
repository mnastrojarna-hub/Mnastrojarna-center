/**
 * 2D výkres → model prohlížeče: každá hladina je „díl" (skrýt / smazat / barva / strom hladin),
 * čáry jako úsečky (z = 0) s barvami po vrcholech (dvě sady: světlé a tmavé pozadí — barva 7),
 * texty zvlášť, a topologie z přesné geometrie (kružnice a oblouky se středem a poloměrem, rohy
 * = konce úseček / vrcholy polyčar) → stejné uchopování při měření jako u 3D.
 */
import type { Curve, PartTopology, Vec3 } from "./topology";
import type { DrawColor, DrawEntity, Drawing2D, Pt } from "./drawing2d";
import type { DrawingText, MeshPart, ModelNode, ParsedModel } from "./types";

export type { DrawingText };

const FG_LIGHT: [number, number, number] = [0.07, 0.07, 0.08];
const FG_DARK: [number, number, number] = [0.93, 0.93, 0.94];

/** Na světlém pozadí příliš světlé barvy (žlutá, bílá) ztmavit, na tmavém naopak. */
function display(c: DrawColor, dark: boolean): [number, number, number] {
  if (c === "fg") return dark ? FG_DARK : FG_LIGHT;
  const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  if (!dark && l > 0.75) return [c[0] * 0.6, c[1] * 0.6, c[2] * 0.6];
  if (dark && l < 0.15) return [Math.min(1, c[0] + 0.5), Math.min(1, c[1] + 0.5), Math.min(1, c[2] + 0.5)];
  return [c[0], c[1], c[2]];
}

function arcPts(c: Pt, r: number, a0: number, a1: number): Pt[] {
  let sweep = a1 - a0;
  while (sweep <= 0) sweep += Math.PI * 2;
  const n = Math.max(4, Math.ceil(sweep / (Math.PI / 48)));
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (sweep * i) / n;
    out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
  }
  return out;
}

/** Oblouk polyčáry z vrcholů a bulge (tan(úhel/4)). */
export function bulgeArc(p1: Pt, p2: Pt, bulge: number): { c: Pt; r: number; a0: number; a1: number; ccw: boolean } | null {
  if (Math.abs(bulge) < 1e-12) return null;
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const chord = Math.hypot(dx, dy);
  if (chord === 0) return null;
  // vzdálenost středu od tětivy (se znaménkem) a poloměr přímo z bulge: h = c(1−b²)/4b, r = c(1+b²)/4|b|
  const h = (chord * (1 - bulge * bulge)) / (4 * bulge);
  const r = (chord * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
  const mx = (p1[0] + p2[0]) / 2;
  const my = (p1[1] + p2[1]) / 2;
  // levá normála tětivy p1 → p2
  const c: Pt = [mx - (dy / chord) * h, my + (dx / chord) * h];
  const a0 = Math.atan2(p1[1] - c[1], p1[0] - c[0]);
  const a1 = Math.atan2(p2[1] - c[1], p2[0] - c[0]);
  return { c, r, a0, a1, ccw: bulge > 0 };
}

interface Builder {
  seg: number[];
  colL: number[];
  colD: number[];
  curves: Curve[];
  segCurve: number[];
  corners: number[];
}

function newBuilder(): Builder {
  return { seg: [], colL: [], colD: [], curves: [], segCurve: [], corners: [] };
}

function addPolyline(b: Builder, pts: Pt[], color: DrawColor, closed: boolean, info: Partial<Curve> & { kind: Curve["kind"] }) {
  if (pts.length < 2) return;
  const segStart = b.seg.length / 6;
  const cl = display(color, false);
  const cd = display(color, true);
  let length = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const c = pts[i + 1];
    b.seg.push(a[0], a[1], 0, c[0], c[1], 0);
    b.colL.push(...cl, ...cl);
    b.colD.push(...cd, ...cd);
    b.segCurve.push(b.curves.length);
    length += Math.hypot(c[0] - a[0], c[1] - a[1]);
  }
  // bod v polovině délky
  let acc = 0;
  let mid: Vec3 = [pts[0][0], pts[0][1], 0];
  for (let i = 0; i < pts.length - 1; i++) {
    const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    if (acc + l >= length / 2) {
      const t = l > 0 ? (length / 2 - acc) / l : 0;
      mid = [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t, 0];
      break;
    }
    acc += l;
  }
  const start: Vec3 = [pts[0][0], pts[0][1], 0];
  const last = pts[pts.length - 1];
  const end: Vec3 = [last[0], last[1], 0];
  b.curves.push({
    segStart, segCount: pts.length - 1, closed, length, start, end, mid,
    normal: info.kind === "line" && length > 0 ? [(end[0] - start[0]) / length, (end[1] - start[1]) / length, 0] : [0, 0, 1],
    ...info,
  });
  if (!closed) b.corners.push(start[0], start[1], 0, end[0], end[1], 0);
}

function addEntity(b: Builder, e: DrawEntity) {
  switch (e.kind) {
    case "line":
      addPolyline(b, [e.a, e.b], e.color, false, { kind: "line" });
      return;
    case "polyline": {
      const n = e.points.length;
      const segs = e.closed ? n : n - 1;
      for (let i = 0; i < segs; i++) {
        const p1 = e.points[i];
        const p2 = e.points[(i + 1) % n];
        const arc = bulgeArc(p1, p2, e.bulges?.[i] ?? 0);
        if (arc) {
          const pts = arc.ccw ? arcPts(arc.c, arc.r, arc.a0, arc.a1) : arcPts(arc.c, arc.r, arc.a1, arc.a0).reverse();
          addPolyline(b, pts, e.color, false, { kind: "arc", center: [arc.c[0], arc.c[1], 0], radius: arc.r });
        } else addPolyline(b, [p1, p2], e.color, false, { kind: "line" });
      }
      return;
    }
    case "circle": {
      const pts = arcPts(e.c, e.r, 0, Math.PI * 2);
      pts.pop();
      pts.push(pts[0]);
      addPolyline(b, pts, e.color, true, { kind: "circle", center: [e.c[0], e.c[1], 0], radius: e.r });
      return;
    }
    case "arc":
      addPolyline(b, arcPts(e.c, e.r, e.start, e.end), e.color, false, { kind: "arc", center: [e.c[0], e.c[1], 0], radius: e.r });
      return;
    case "ellipse": {
      let a1 = e.end;
      if (a1 <= e.start) a1 += Math.PI * 2;
      const n = Math.max(16, Math.ceil(((a1 - e.start) / (Math.PI * 2)) * 128));
      const pts: Pt[] = [];
      for (let i = 0; i <= n; i++) {
        const t = e.start + ((a1 - e.start) * i) / n;
        pts.push([e.c[0] + e.major[0] * Math.cos(t) - e.major[1] * e.ratio * Math.sin(t), e.c[1] + e.major[1] * Math.cos(t) + e.major[0] * e.ratio * Math.sin(t)]);
      }
      addPolyline(b, pts, e.color, Math.abs(a1 - e.start - Math.PI * 2) < 1e-6, { kind: "curve" });
      return;
    }
    case "curve":
      addPolyline(b, e.closed ? [...e.points, e.points[0]] : e.points, e.color, e.closed, { kind: "curve" });
      return;
    case "point": {
      // malý křížek
      const s = 0.5;
      addPolyline(b, [[e.p[0] - s, e.p[1]], [e.p[0] + s, e.p[1]]], e.color, false, { kind: "line" });
      addPolyline(b, [[e.p[0], e.p[1] - s], [e.p[0], e.p[1] + s]], e.color, false, { kind: "line" });
      b.corners.push(e.p[0], e.p[1], 0);
      return;
    }
    default:
  }
}

export interface DrawingModel {
  model: ParsedModel;
  topology: PartTopology[];
}

export function drawingToModel(d: Drawing2D): DrawingModel {
  const order = d.layers.map((l) => l.name);
  for (const e of d.entities) if (!order.includes(e.layer)) order.push(e.layer);
  const index = new Map(order.map((n, i) => [n, i]));
  const builders = order.map(() => newBuilder());
  const texts: DrawingText[] = [];
  for (const e of d.entities) {
    const pi = index.get(e.layer)!;
    if (e.kind === "text") {
      texts.push({
        part: pi, x: e.p[0], y: e.p[1], text: e.text, height: e.height, rotation: e.rotation,
        hAlign: e.hAlign, vAlign: e.vAlign, width: e.width, color: e.color === "fg" ? null : [e.color[0], e.color[1], e.color[2]],
      });
    } else addEntity(builders[pi], e);
  }
  // hladiny bez čar i textů pryč
  const keep = order.map((_, i) => builders[i].seg.length > 0 || texts.some((t) => t.part === i));
  const remap = new Map<number, number>();
  const parts: MeshPart[] = [];
  const topology: PartTopology[] = [];
  const darkColors: Float32Array[] = [];
  const hidden: number[] = [];
  order.forEach((name, i) => {
    if (!keep[i]) return;
    const b = builders[i];
    remap.set(i, parts.length);
    const layer = d.layers.find((l) => l.name === name);
    if (layer?.off) hidden.push(parts.length);
    const edge = Float32Array.from(b.seg);
    parts.push({
      name, positions: new Float32Array(0), indices: null, lines: edge, lineColors: Float32Array.from(b.colL),
      color: null,
    });
    darkColors.push(Float32Array.from(b.colD));
    topology.push({
      edgeSegments: edge, curves: b.curves, segCurve: Uint32Array.from(b.segCurve), corners: Float32Array.from(b.corners),
      triFace: new Uint32Array(0), faces: [],
    });
  });
  for (const t of texts) t.part = remap.get(t.part) ?? 0;
  // hladina jen s texty má díl (bez čar) — viz keep
  const root: ModelNode = { name: "Hladiny", parts: parts.map((_, i) => i), children: [] };
  return {
    model: { parts, root, format: d.format, warnings: d.warnings, drawing: { texts, darkColors, hidden } },
    topology,
  };
}
