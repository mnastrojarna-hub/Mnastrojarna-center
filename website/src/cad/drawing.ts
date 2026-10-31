/**
 * Výkresová dokumentace z 3D modelu (jako výkresové prostředí ZW3D / Inventoru):
 * pravoúhlé promítání ISO E (evropské) nebo ISO A (americké), volitelné pohledy, izometrie,
 * řez A-A se šrafováním, osy děr a válců, kóty (celkové + průměry), rohové razítko Mnástrojárny.
 * Čáry dle ISO 128: obrys 0,5 · skryté 0,25 čárkovaně · osy a kóty 0,18 · šrafy 0,18.
 * Výstup: geometrie listu (polys/texts) → SVG, DXF (R12, LTYPE/vrstvy) a PDF (src/cad/pdf.ts).
 */
import * as r from "replicad";
import type { PlaneName, Vec2, Vec3 } from "./types";

// ---------------------------------------------------------------- typy

export type Layer = "visible" | "hidden" | "center" | "cut" | "dim" | "hatch" | "frame" | "thin" | "title";
export type Poly = { pts: Vec2[]; layer: Layer; fill?: boolean; width?: number };
export type DText = {
  x: number;
  y: number;
  s: string;
  size: number;
  anchor?: "start" | "middle" | "end";
  /** stupně, po směru hodinových ručiček (SVG) */
  rotate?: number;
  bold?: boolean;
  layer?: "dim" | "text";
  brand?: boolean;
};

export type DrawingMeta = {
  name: string;
  material: string;
  massKg?: number;
  author?: string;
  date?: string;
  number?: string;
  revision?: string;
  /** poznámka k tolerancím (výchozí ISO 2768-mK) */
  tolerance?: string;
  /** kusovník (sestava) – vykreslí se nad razítkem dle ISO 7573 */
  bom?: BomItem[];
};

export type BomItem = { pos: number; name: string; number?: string; qty: number; material?: string; massKg?: number; note?: string };

export type SheetName = "A4" | "A3" | "A2" | "A1" | "A0";
export type ViewKey = "front" | "top" | "left" | "right" | "back" | "bottom";

export type DrawingOptions = {
  sheet: "auto" | SheetName;
  orientation: "landscape" | "portrait";
  /** "auto" nebo měřítko jako číslo (0.5 = 1:2, 2 = 2:1) */
  scale: "auto" | number;
  projection: "E" | "A";
  views: Record<ViewKey | "iso", boolean>;
  hidden: boolean;
  section: null | { plane: PlaneName; offset: number };
  centerLines: boolean;
  dimensions: "none" | "overall" | "auto";
};

export const defaultDrawingOptions: DrawingOptions = {
  sheet: "auto",
  orientation: "landscape",
  scale: "auto",
  projection: "E",
  views: { front: true, top: true, left: true, right: false, back: false, bottom: false, iso: true },
  hidden: true,
  section: null,
  centerLines: true,
  dimensions: "auto",
};

/** Umístění pohledu na listu (pro mapování kliknutí → souřadnice pohledu a zpět). */
export type PlacedView = { key: string; px: number; py: number; s: number; x0: number; y0: number; w: number; h: number };

export type DrawingResult = {
  sheet: { name: SheetName; w: number; h: number };
  /** umístěné pohledy (bez izometrie) */
  views: PlacedView[];
  scale: string;
  scaleValue: number;
  polys: Poly[];
  texts: DText[];
  svg: string;
  dxf: string;
  warnings: string[];
};

export const SHEETS: Record<SheetName, [number, number]> = {
  A4: [297, 210],
  A3: [420, 297],
  A2: [594, 420],
  A1: [841, 594],
  A0: [1189, 841],
};
const SHEET_ORDER: SheetName[] = ["A4", "A3", "A2", "A1", "A0"];

/** Normalizovaná měřítka ISO 5455. */
export const STANDARD_SCALES = [50, 20, 10, 5, 2, 1, 1 / 2, 1 / 5, 1 / 10, 1 / 20, 1 / 50, 1 / 100, 1 / 200];
export const scaleLabel = (s: number) => (s >= 1 ? `${Math.round(s * 100) / 100}:1` : `1:${Math.round((1 / s) * 100) / 100}`);

export const VIEW_LABEL: Record<ViewKey | "iso", string> = {
  front: "Zepředu (hlavní)",
  top: "Shora",
  left: "Zleva",
  right: "Zprava",
  back: "Zezadu",
  bottom: "Zdola",
  iso: "Izometrie",
};

// ---------------------------------------------------------------- SVG path → polyline

/** Rozloží SVG path (absolutní příkazy M L H V A C Q Z) na polyline v souřadnicích SVG. */
export function pathToPolylines(d: string): Vec2[][] {
  const tokens = d.match(/[MLHVACQZmlhvacqz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const out: Vec2[][] = [];
  let cur: Vec2[] = [];
  let p: Vec2 = [0, 0];
  let start: Vec2 = [0, 0];
  let i = 0;
  let cmd = "";
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++].toUpperCase();
    switch (cmd) {
      case "M":
        if (cur.length > 1) out.push(cur);
        p = [num(), num()];
        start = p;
        cur = [p];
        cmd = "L";
        break;
      case "L":
        p = [num(), num()];
        cur.push(p);
        break;
      case "H":
        p = [num(), p[1]];
        cur.push(p);
        break;
      case "V":
        p = [p[0], num()];
        cur.push(p);
        break;
      case "C": {
        const c1: Vec2 = [num(), num()];
        const c2: Vec2 = [num(), num()];
        const e: Vec2 = [num(), num()];
        for (let k = 1; k <= 12; k++) {
          const t = k / 12;
          const u = 1 - t;
          cur.push([
            u * u * u * p[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * e[0],
            u * u * u * p[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * e[1],
          ]);
        }
        p = e;
        break;
      }
      case "Q": {
        const c: Vec2 = [num(), num()];
        const e: Vec2 = [num(), num()];
        for (let k = 1; k <= 10; k++) {
          const t = k / 10;
          const u = 1 - t;
          cur.push([u * u * p[0] + 2 * u * t * c[0] + t * t * e[0], u * u * p[1] + 2 * u * t * c[1] + t * t * e[1]]);
        }
        p = e;
        break;
      }
      case "A": {
        const rx = num();
        const ry = num();
        const rotDeg = num();
        const large = num();
        const sweep = num();
        const e: Vec2 = [num(), num()];
        cur.push(...arcToPoints(p, e, rx, ry, rotDeg, !!large, !!sweep));
        p = e;
        break;
      }
      case "Z":
        cur.push(start);
        p = start;
        break;
      default:
        i++;
    }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

function arcToPoints(p0: Vec2, p1: Vec2, rx: number, ry: number, phiDeg: number, large: boolean, sweep: boolean): Vec2[] {
  if (rx === 0 || ry === 0) return [p1];
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (p0[0] - p1[0]) / 2;
  const dy = (p0[1] - p1[1]) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const sign = large === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const co = sign * Math.sqrt(Math.max(0, num / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
  const cx1 = (co * rx * y1) / ry;
  const cy1 = (-co * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (p0[0] + p1[0]) / 2;
  const cy = sin * cx1 + cos * cy1 + (p0[1] + p1[1]) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(4, Math.ceil(Math.abs(dt) / (Math.PI / 24)));
  const pts: Vec2[] = [];
  for (let k = 1; k <= n; k++) {
    const t = t1 + (dt * k) / n;
    pts.push([cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos]);
  }
  return pts;
}

// ---------------------------------------------------------------- vektory

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => mul(a, 1 / (len(a) || 1));
const V = (v: r.Vector): Vec3 => [v.x, v.y, v.z];

// ---------------------------------------------------------------- kamery pohledů

/** d = směr k pozorovateli, x = vodorovná osa obrazu; svislá osa = d × x. */
type Cam = { d: Vec3; x: Vec3 };
const CAMS: Record<ViewKey | "iso", Cam> = {
  front: { d: [0, -1, 0], x: [1, 0, 0] },
  back: { d: [0, 1, 0], x: [-1, 0, 0] },
  left: { d: [-1, 0, 0], x: [0, -1, 0] }, // pohled zleva (pozorovatel v −X)
  right: { d: [1, 0, 0], x: [0, 1, 0] }, // pohled zprava (pozorovatel v +X)
  top: { d: [0, 0, 1], x: [1, 0, 0] },
  bottom: { d: [0, 0, -1], x: [1, 0, 0] },
  iso: { d: unit([1, -1, 1]), x: unit([1, 1, 0]) },
};

type View = {
  key: string;
  cam: Cam;
  polys: Poly[];
  /** rozsah v souřadnicích obrazu (SVG: y dolů) */
  x0: number;
  y0: number;
  w: number;
  h: number;
};

type Placed = View & { px: number; py: number; s: number };

const upOf = (c: Cam) => cross(c.d, c.x);
/** 3D bod → souřadnice obrazu (SVG, y dolů) */
const proj = (c: Cam, p: Vec3): Vec2 => [dot(p, c.x), -dot(p, upOf(c))];
/** obraz → list */
const toSheet = (v: Placed, q: Vec2): Vec2 => [v.px + (q[0] - v.x0) * v.s, v.py + (q[1] - v.y0) * v.s];
const at = (v: Placed, p: Vec3) => toSheet(v, proj(v.cam, p));

function projectView(shape: r.Shape3D, key: string, cam: Cam, withHidden: boolean, layer: Layer = "visible"): View {
  const camera = new r.ProjectionCamera([0, 0, 0], cam.d, cam.x);
  const p = r.drawProjection(shape, camera);
  const polys: Poly[] = [];
  const collect = (d: r.Drawing, l: Layer) => {
    let paths: string[] = [];
    try {
      paths = (d.toSVGPaths() as unknown as (string | string[])[]).flat();
    } catch {
      paths = [];
    }
    for (const path of paths) for (const pts of pathToPolylines(path)) polys.push({ pts, layer: l });
  };
  collect(p.visible, layer);
  if (withHidden) collect(p.hidden, "hidden");
  return { key, cam, polys, ...extent(polys.filter((x) => x.layer !== "hidden").length ? polys.filter((x) => x.layer !== "hidden") : polys) };
}

function extent(polys: Poly[]) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const pl of polys)
    for (const [x, y] of pl.pts) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  if (!Number.isFinite(x0)) return { x0: 0, y0: 0, w: 0, h: 0 };
  return { x0, y0, w: x1 - x0, h: y1 - y0 };
}

// ---------------------------------------------------------------- kružnice (osy, průměry)

type Circle = { c: Vec3; r: number; a: Vec3; /** hrana ohraničuje válcovou plochu */ cyl: boolean };

/** zaokrouhlení bez „-0“ (kvůli klíčům) */
const k3 = (v: number, d: number) => (Math.abs(v) < 0.5 * 10 ** -d ? 0 : v).toFixed(d);

function circleOf(e: r.Edge): Omit<Circle, "cyl"> | null {
  if (e.geomType !== "CIRCLE" || !e.isClosed) return null;
  const p0 = V(e.pointAt(0));
  const p1 = V(e.pointAt(1 / 3));
  const p2 = V(e.pointAt(2 / 3));
  const c = circumcenter(p0, p1, p2);
  if (!c) return null;
  const a = unit(cross(sub(p1, p0), sub(p2, p0)));
  // normalizace směru osy (kvůli seskupení)
  const k = [0, 1, 2].reduce((m, i) => (Math.abs(a[i]) > Math.abs(a[m]) ? i : m), 0);
  return { c, r: len(sub(p0, c)), a: a[k] < 0 ? mul(a, -1) : a };
}

const circleKey = (c: Omit<Circle, "cyl">) => `${c.c.map((v) => k3(v, 3)).join()}|${k3(c.r, 3)}`;

function circlesOf(shape: r.Shape3D): Circle[] {
  const out: Circle[] = [];
  const onCyl = new Set<string>();
  try {
    for (const f of shape.faces) {
      if (f.geomType !== "CYLINDRE") continue;
      for (const e of f.edges) {
        try {
          const c = circleOf(e);
          if (c) onCyl.add(circleKey(c));
        } catch {
          /* bez geometrie */
        }
      }
    }
  } catch {
    /* plochy nedostupné */
  }
  let edges: r.Edge[] = [];
  try {
    edges = shape.edges;
  } catch {
    return out;
  }
  for (const e of edges) {
    try {
      const c = circleOf(e);
      if (c) out.push({ ...c, cyl: onCyl.has(circleKey(c)) });
    } catch {
      /* hrana bez geometrie */
    }
  }
  return out;
}

function circumcenter(a: Vec3, b: Vec3, c: Vec3): Vec3 | null {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const n = cross(ab, ac);
  const n2 = dot(n, n);
  if (n2 < 1e-12) return null;
  const t1 = mul(cross(n, ab), dot(ac, ac));
  const t2 = mul(cross(ac, n), dot(ab, ab));
  return add(a, mul(add(t1, t2), 1 / (2 * n2)));
}

// ---------------------------------------------------------------- řez

const PLANE_N: Record<PlaneName, Vec3> = { XY: [0, 0, 1], XZ: [0, 1, 0], YZ: [1, 0, 0] };
/** kamera řezu a strana, ze které se materiál odebere (strana pozorovatele) */
const SECTION_CAM: Record<PlaneName, Cam> = {
  XZ: CAMS.front, // pozorovatel v −Y, odebírá se y < offset
  YZ: CAMS.left, // pozorovatel v −X, odebírá se x < offset
  XY: CAMS.top, // pozorovatel v +Z, odebírá se z > offset
};

type SectionData = { view: View; loops: Vec2[][] };

function makeSection(shape: r.Shape3D, plane: PlaneName, offset: number): SectionData | null {
  const n = PLANE_N[plane];
  const cam = SECTION_CAM[plane];
  const [[x0, y0, z0], [x1, y1, z1]] = shape.boundingBox.bounds as [Vec3, Vec3];
  const pad = Math.hypot(x1 - x0, y1 - y0, z1 - z0) + 10;
  const lo: Vec3 = [x0 - pad, y0 - pad, z0 - pad];
  const hi: Vec3 = [x1 + pad, y1 + pad, z1 + pad];
  // odebíraná strana = strana pozorovatele (ve směru d)
  const viewerPositive = dot(cam.d, n) > 0;
  const k = n.indexOf(1);
  const bLo = [...lo] as Vec3;
  const bHi = [...hi] as Vec3;
  if (viewerPositive) bLo[k] = offset;
  else bHi[k] = offset;
  if (offset <= [x0, y0, z0][k] || offset >= [x1, y1, z1][k]) return null;
  const cut = shape.clone().cut(r.makeBox(bLo, bHi)) as r.Shape3D;
  const view = projectView(cut, "section", cam, false);
  const loops: Vec2[][] = [];
  const tol = Math.max(1e-4, pad * 1e-6);
  for (const f of cut.faces) {
    try {
      if (f.geomType !== "PLANE") continue;
      const c = V(f.center);
      if (Math.abs(dot(c, n) - offset) > tol * 10) continue;
      const fn = V(f.normalAt(f.center));
      if (Math.abs(Math.abs(dot(fn, n)) - 1) > 1e-6) continue;
      for (const e of f.edges) {
        const nseg = e.geomType === "LINE" ? 1 : 40;
        const pts: Vec2[] = [];
        for (let i = 0; i <= nseg; i++) pts.push(proj(cam, V(e.pointAt(i / nseg))));
        loops.push(pts);
      }
    } catch {
      /* plocha bez geometrie */
    }
  }
  if (!loops.length) return null;
  return { view, loops };
}

/** Šrafování 45° (ISO 128-50) – sudo-lichým pravidlem přes úsečky obrysu, v souřadnicích listu. */
export function hatch(segsPolys: Vec2[][], spacing = 2.5, angleDeg = 45): Vec2[][] {
  const a = (angleDeg * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  // otočit tak, aby šrafy byly vodorovné
  const rot = ([x, y]: Vec2): Vec2 => [x * ca + y * sa, -x * sa + y * ca];
  const unrot = ([x, y]: Vec2): Vec2 => [x * ca - y * sa, x * sa + y * ca];
  const segs: [Vec2, Vec2][] = [];
  let ymin = Infinity,
    ymax = -Infinity;
  for (const pl of segsPolys)
    for (let i = 1; i < pl.length; i++) {
      const p = rot(pl[i - 1]);
      const q = rot(pl[i]);
      segs.push([p, q]);
      ymin = Math.min(ymin, p[1], q[1]);
      ymax = Math.max(ymax, p[1], q[1]);
    }
  const out: Vec2[][] = [];
  if (!segs.length) return out;
  const start = Math.ceil(ymin / spacing) * spacing;
  for (let y = start; y <= ymax; y += spacing) {
    const xs: number[] = [];
    for (const [p, q] of segs) {
      if ((p[1] <= y && q[1] > y) || (q[1] <= y && p[1] > y)) xs.push(p[0] + ((y - p[1]) / (q[1] - p[1])) * (q[0] - p[0]));
    }
    xs.sort((m, n) => m - n);
    for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > 1e-6) out.push([unrot([xs[i], y]), unrot([xs[i + 1], y])]);
  }
  return out;
}

// ---------------------------------------------------------------- formát čísel

const fmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString("cs-CZ");

// ---------------------------------------------------------------- hlavní funkce

const ISO_KEYS: ViewKey[] = ["front", "top", "left", "right", "back", "bottom"];
type Slot = "center" | "above" | "below" | "left" | "right" | "far";

function slotOf(key: ViewKey, projection: "E" | "A"): Slot {
  if (key === "front") return "center";
  if (key === "back") return "far";
  if (projection === "E") return ({ top: "below", bottom: "above", left: "right", right: "left" } as const)[key];
  return ({ top: "above", bottom: "below", left: "left", right: "right" } as const)[key];
}

const M_LEFT = 20; // ISO 5457: okraj pro vazbu
const M = 10;
const TB = { w: 180, h: 38 };
const GAP = 24; // mezera mezi pohledy (místo pro kóty)
const DIM_ROOM = 14;

export function makeDrawing(shape: r.Shape3D, meta: DrawingMeta, options: Partial<DrawingOptions> = {}): DrawingResult {
  // výška pásu nad spodním okrajem: razítko + kusovník
  const TBH = TB.h + bomHeight(meta.bom);
  const opts: DrawingOptions = { ...defaultDrawingOptions, ...options, views: { ...defaultDrawingOptions.views, ...(options.views ?? {}) } };
  const warnings: string[] = [];

  // --- projekce
  const keys = ISO_KEYS.filter((k) => opts.views[k]);
  if (!keys.length) keys.push("front");
  const views = new Map<ViewKey, View>();
  for (const k of keys) {
    const v = projectView(shape, k, CAMS[k], opts.hidden);
    if (v.w > 0 || v.h > 0) views.set(k, v);
  }
  let section: SectionData | null = null;
  if (opts.section) {
    try {
      section = makeSection(shape, opts.section.plane, opts.section.offset);
      if (!section) warnings.push("Rovina řezu neprotíná těleso – upravte odsazení.");
    } catch {
      warnings.push("Řez se nepodařilo vytvořit.");
    }
  }
  let iso: View | null = null;
  if (opts.views.iso) {
    try {
      iso = projectView(shape, "iso", CAMS.iso, false, "thin");
      if (!iso.w) iso = null;
    } catch {
      iso = null;
    }
  }

  // --- rozvržení: mřížka (sloupce left | center | right | far…, řádky above | center | below)
  const bySlot = new Map<Slot, View>();
  for (const [k, v] of views) bySlot.set(slotOf(k, opts.projection), v);
  const far: View[] = [];
  if (bySlot.get("far")) far.push(bySlot.get("far")!);
  if (section) far.push(section.view);
  const centerView = bySlot.get("center") ?? null;

  const blockSize = (s: number) => {
    const wc = Math.max(centerView?.w ?? 0, bySlot.get("above")?.w ?? 0, bySlot.get("below")?.w ?? 0) * s;
    const wl = (bySlot.get("left")?.w ?? 0) * s;
    const wr = (bySlot.get("right")?.w ?? 0) * s;
    const wf = far.map((v) => v.w * s);
    const cols = [wl, wc, wr, ...wf].filter((w) => w > 0);
    const W = cols.reduce((a, b) => a + b, 0) + GAP * Math.max(0, cols.length - 1);
    const hRow = Math.max(centerView?.h ?? 0, bySlot.get("left")?.h ?? 0, bySlot.get("right")?.h ?? 0, ...far.map((v) => v.h)) * s;
    const ha = (bySlot.get("above")?.h ?? 0) * s;
    const hb = (bySlot.get("below")?.h ?? 0) * s;
    const rows = [ha, hRow, hb].filter((h) => h > 0);
    const H = rows.reduce((a, b) => a + b, 0) + GAP * Math.max(0, rows.length - 1);
    return { W, H, wl, wc, wr, wf, ha, hb, hRow };
  };

  const sheetDims = (n: SheetName): [number, number] => {
    const [a, b] = SHEETS[n];
    return opts.orientation === "portrait" ? [b, a] : [a, b];
  };
  const availOf = (n: SheetName) => {
    const [W, H] = sheetDims(n);
    return { x: M_LEFT + DIM_ROOM, y: M + DIM_ROOM, w: W - M_LEFT - M - 2 * DIM_ROOM, h: H - 2 * M - TBH - 2 * DIM_ROOM - 4 };
  };
  const fits = (n: SheetName, s: number) => {
    const b = blockSize(s);
    const a = availOf(n);
    return b.W <= a.w && b.H <= a.h;
  };
  const bestScale = (n: SheetName) => STANDARD_SCALES.find((s) => fits(n, s)) ?? null;

  let sheet: SheetName;
  let scale: number;
  if (opts.sheet !== "auto") {
    sheet = opts.sheet;
    if (opts.scale === "auto") scale = bestScale(sheet) ?? STANDARD_SCALES[STANDARD_SCALES.length - 1];
    else {
      scale = opts.scale;
      if (!fits(sheet, scale)) warnings.push(`Pohledy se v měřítku ${scaleLabel(scale)} nevejdou na list ${sheet}.`);
    }
  } else if (opts.scale !== "auto") {
    scale = opts.scale;
    sheet = SHEET_ORDER.find((n) => fits(n, scale)) ?? "A0";
    if (!fits(sheet, scale)) warnings.push(`Pohledy se v měřítku ${scaleLabel(scale)} nevejdou ani na A0.`);
  } else {
    const pick = SHEET_ORDER.find((n) => (bestScale(n) ?? 0) >= 0.5);
    sheet = pick ?? "A0";
    scale = bestScale(sheet) ?? STANDARD_SCALES[STANDARD_SCALES.length - 1];
  }
  const [SW, SH] = sheetDims(sheet);
  const avail = availOf(sheet);
  const B = blockSize(scale);

  // umístění bloku: s izometrií vlevo nahoře (izometrie dostane zbytek), jinak na střed
  const bx = iso ? avail.x : avail.x + Math.max(0, (avail.w - B.W) / 2);
  const by = iso ? avail.y : avail.y + Math.max(0, (avail.h - B.H) / 2);
  const colX: Record<string, number> = {};
  let cx = bx;
  for (const [name, w] of [["left", B.wl], ["center", B.wc], ["right", B.wr], ...B.wf.map((w, i) => [`far${i}`, w] as [string, number])] as [string, number][]) {
    if (w <= 0) continue;
    colX[name] = cx;
    colX[name + "W"] = w;
    cx += w + GAP;
  }
  const rowY: Record<string, number> = {};
  let cy = by;
  for (const [name, h] of [["above", B.ha], ["center", B.hRow], ["below", B.hb]] as [string, number][]) {
    if (h <= 0) continue;
    rowY[name] = cy;
    rowY[name + "H"] = h;
    cy += h + GAP;
  }
  const placed = new Map<string, Placed>();
  const place = (v: View, col: string, row: string) => {
    const w = v.w * scale;
    const h = v.h * scale;
    const px = (colX[col] ?? bx) + ((colX[col + "W"] ?? w) - w) / 2;
    const py = (rowY[row] ?? by) + ((rowY[row + "H"] ?? h) - h) / 2;
    const p: Placed = { ...v, px, py, s: scale };
    placed.set(v.key, p);
    return p;
  };
  // centrální sloupec: zarovnat X s hlavním pohledem (stejná šířka), řádek: zarovnat Y
  if (centerView) place(centerView, "center", "center");
  for (const [slot, col, row] of [["above", "center", "above"], ["below", "center", "below"], ["left", "left", "center"], ["right", "right", "center"]] as [Slot, string, string][]) {
    const v = bySlot.get(slot);
    if (v) place(v, col, row);
  }
  far.forEach((v, i) => place(v, `far${i}`, "center"));

  // přesné zarovnání pohledů do promítacích čar podle hlavního pohledu
  const main = centerView ? placed.get(centerView.key)! : null;
  if (main) {
    for (const p of placed.values()) {
      if (p === main) continue;
      const slot = p.key === "section" ? "far" : slotOf(p.key as ViewKey, opts.projection);
      // svislá osa obrazu = Z u pohledů z boku/zezadu/řezů XZ, YZ → stejné y0
      if ((slot === "left" || slot === "right" || slot === "far") && sameUp(p.cam, main.cam)) p.py = main.py + (p.y0 - main.y0) * scale;
      // vodorovná osa = X u pohledů shora/zdola → stejné x0
      if ((slot === "above" || slot === "below") && sameX(p.cam, main.cam)) p.px = main.px + (p.x0 - main.x0) * scale;
    }
  }

  // --- geometrie listu
  const polys: Poly[] = [];
  const texts: DText[] = [];
  for (const p of placed.values()) for (const pl of p.polys) polys.push({ layer: pl.layer, pts: pl.pts.map((q) => toSheet(p, q)) });

  // řez: šrafy + označení
  const sec = placed.get("section");
  if (section && sec && opts.section) {
    const loops = section.loops.map((l) => l.map((q) => toSheet(sec, q)));
    for (const h of hatch(loops, Math.max(1.5, Math.min(4, Math.sqrt(sec.w * sec.h * scale * scale) / 25)))) polys.push({ layer: "hatch", pts: h });
    texts.push({ x: sec.px + (sec.w * scale) / 2, y: sec.py - 6, s: "A–A", size: 5, anchor: "middle", bold: true, layer: "text" });
    cuttingPlane(opts.section.plane, opts.section.offset, placed, polys, texts, warnings);
  }

  // izometrie do největšího volného místa
  if (iso) {
    const blockR = bx + B.W;
    const blockB = by + B.H;
    const tbX = SW - M - TB.w;
    const frameR = SW - M - 6;
    const frameB = SH - M - 10;
    const cands: { x: number; y: number; w: number; h: number }[] = [
      { x: blockR + GAP, y: avail.y, w: frameR - blockR - GAP, h: SH - M - TBH - 8 - avail.y },
      { x: avail.x, y: blockB + GAP, w: tbX - 8 - avail.x, h: frameB - blockB - GAP },
      { x: avail.x, y: blockB + GAP, w: frameR - avail.x, h: SH - M - TBH - 8 - blockB - GAP },
    ];
    // prázdné rohové buňky mřížky
    for (const row of ["above", "below"])
      for (const col of ["left", "right"]) {
        if (rowY[row] == null || colX[col] == null) continue;
        cands.push({ x: colX[col], y: rowY[row], w: colX[col + "W"], h: rowY[row + "H"] });
      }
    if (rowY.above == null && colX.right != null) cands.push({ x: colX.right, y: avail.y, w: frameR - colX.right, h: (rowY.center ?? by) - GAP - avail.y });
    let best: { x: number; y: number; w: number; h: number; s: number } | null = null;
    for (const c of cands) {
      if (c.w < 25 || c.h < 25) continue;
      const s = Math.min(scale, (c.w * 0.9) / iso.w, (c.h * 0.9) / iso.h);
      if (!best || s > best.s) best = { ...c, s };
    }
    if (best && best.s > 0) {
      const p: Placed = { ...iso, s: best.s, px: best.x + (best.w - iso.w * best.s) / 2, py: best.y + (best.h - iso.h * best.s) / 2 };
      for (const pl of p.polys) polys.push({ layer: "thin", pts: pl.pts.map((q) => toSheet(p, q)) });
    }
  }

  // osy a kóty
  const circles = opts.centerLines || opts.dimensions === "auto" ? circlesOf(shape) : [];
  const ortho = [...placed.values()];
  if (opts.centerLines) for (const p of ortho) centerLines(p, circles, polys);
  if (opts.dimensions !== "none") overallDims(placed, polys, texts, opts.projection);
  if (opts.dimensions === "auto") diameterDims(ortho, circles, polys, texts);

  // rám, centrovací značky, razítko
  frame(SW, SH, polys);
  titleBlock(SW, SH, sheet, scale, opts.projection, meta, polys, texts);
  if (meta.bom?.length) partsList(SW - M - TB.w, SH - M - TB.h, meta.bom, polys, texts);

  return {
    sheet: { name: sheet, w: SW, h: SH },
    views: [...placed.values()].map((p) => ({ key: p.key, px: p.px, py: p.py, s: p.s, x0: p.x0, y0: p.y0, w: p.w, h: p.h })),
    scale: scaleLabel(scale),
    scaleValue: scale,
    polys,
    texts,
    svg: toSvg(SW, SH, polys, texts),
    dxf: toDxf(SH, polys, texts),
    warnings,
  };
}

const sameUp = (a: Cam, b: Cam) => Math.abs(dot(upOf(a), upOf(b)) - 1) < 1e-6;
const sameX = (a: Cam, b: Cam) => Math.abs(dot(a.x, b.x) - 1) < 1e-6;

// ---------------------------------------------------------------- kótovací prvky

function arrow(polys: Poly[], x: number, y: number, dx: number, dy: number) {
  const l = 3;
  const w = 0.55;
  polys.push({ layer: "dim", fill: true, pts: [[x, y], [x + dx * l - dy * w, y + dy * l + dx * w], [x + dx * l + dy * w, y + dy * l - dx * w], [x, y]] });
}

/** Lineární kóta mezi body p1, p2 (list), kótovací čára posunutá o `off` ve směru normály n. */
function linearDim(polys: Poly[], texts: DText[], p1: Vec2, p2: Vec2, n: Vec2, off: number, value: number, prefix = "") {
  const a: Vec2 = [p1[0] + n[0] * off, p1[1] + n[1] * off];
  const b: Vec2 = [p2[0] + n[0] * off, p2[1] + n[1] * off];
  const gap = 1;
  const over = 2;
  const ext = (p: Vec2, q: Vec2) => {
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (L < gap + 0.1) return;
    const ux = (q[0] - p[0]) / L;
    const uy = (q[1] - p[1]) / L;
    polys.push({ layer: "dim", pts: [[p[0] + ux * gap, p[1] + uy * gap], [q[0] + ux * over, q[1] + uy * over]] });
  };
  if (off !== 0) {
    ext(p1, a);
    ext(p2, b);
  }
  polys.push({ layer: "dim", pts: [a, b] });
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const ux = (b[0] - a[0]) / L;
  const uy = (b[1] - a[1]) / L;
  arrow(polys, a[0], a[1], ux, uy);
  arrow(polys, b[0], b[1], -ux, -uy);
  let ang = (Math.atan2(uy, ux) * 180) / Math.PI;
  if (ang > 90.01) ang -= 180;
  if (ang < -89.99) ang += 180;
  // text nad kótovací čárou (normála směrem „nahoru“ v listu)
  const rad = (ang * Math.PI) / 180;
  const nx = Math.sin(rad);
  const ny = -Math.cos(rad);
  texts.push({ x: (a[0] + b[0]) / 2 + nx * 1, y: (a[1] + b[1]) / 2 + ny * 1, s: prefix + fmt(value), size: 3.5, anchor: "middle", rotate: Math.abs(ang) < 1e-6 ? 0 : ang, layer: "dim" });
}

function overallDims(placed: Map<string, Placed>, polys: Poly[], texts: DText[], projection: "E" | "A") {
  void projection;
  const box = (p: Placed) => ({ x: p.px, y: p.py, w: p.w * p.s, h: p.h * p.s });
  const front = placed.get("front");
  let depthDone = false;
  if (front && front.w) {
    const b = box(front);
    linearDim(polys, texts, [b.x, b.y], [b.x + b.w, b.y], [0, -1], 9, front.w);
    linearDim(polys, texts, [b.x, b.y + b.h], [b.x, b.y], [-1, 0], 9, front.h);
  }
  for (const k of ["left", "right"]) {
    const p = placed.get(k);
    if (!p || depthDone) continue;
    const b = box(p);
    linearDim(polys, texts, [b.x, b.y], [b.x + b.w, b.y], [0, -1], 9, p.w);
    depthDone = true;
    if (!front) linearDim(polys, texts, [b.x, b.y + b.h], [b.x, b.y], [-1, 0], 9, p.h);
  }
  for (const k of ["top", "bottom"]) {
    const p = placed.get(k);
    if (!p) continue;
    const b = box(p);
    if (!depthDone) {
      linearDim(polys, texts, [b.x, b.y + b.h], [b.x, b.y], [-1, 0], 9, p.h);
      depthDone = true;
    }
    if (!front) linearDim(polys, texts, [b.x, b.y], [b.x + b.w, b.y], [0, -1], 9, p.w);
    break;
  }
}

function centerLines(p: Placed, circles: Circle[], polys: Poly[]) {
  const d = p.cam.d;
  const s = p.s;
  const ext = 2.5;
  const faceOn = new Map<string, { c: Vec2; r: number }>();
  const axes = new Map<string, { a: Vec3; base: Vec3; tmin: number; tmax: number; rmax: number }>();
  for (const c of circles) {
    const ad = Math.abs(dot(c.a, d));
    if (ad > 0.999) {
      const q = at(p, c.c);
      const key = `${q[0].toFixed(2)},${q[1].toFixed(2)}`;
      const prev = faceOn.get(key);
      if (!prev || prev.r < c.r) faceOn.set(key, { c: q, r: c.r });
    } else if (ad < 1e-3) {
      // osa leží v rovině pohledu → kreslí se osa válce
      const t = dot(c.c, c.a);
      const base = sub(c.c, mul(c.a, t));
      const key = `${c.a.map((v) => k3(v, 3)).join()}|${base.map((v) => k3(v, 2)).join()}`;
      const g = axes.get(key);
      if (g) {
        g.tmin = Math.min(g.tmin, t);
        g.tmax = Math.max(g.tmax, t);
        g.rmax = Math.max(g.rmax, c.r);
      } else axes.set(key, { a: c.a, base, tmin: t, tmax: t, rmax: c.r });
    }
  }
  for (const { c, r: rad } of faceOn.values()) {
    const L = rad * s + ext;
    if (rad * s < 1) continue;
    polys.push({ layer: "center", pts: [[c[0] - L, c[1]], [c[0] + L, c[1]]] }, { layer: "center", pts: [[c[0], c[1] - L], [c[0], c[1] + L]] });
  }
  for (const g of axes.values()) {
    if (g.tmax - g.tmin < 1e-6 || g.rmax * s < 1) continue;
    const p0 = at(p, add(g.base, mul(g.a, g.tmin)));
    const p1 = at(p, add(g.base, mul(g.a, g.tmax)));
    const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
    const ux = (p1[0] - p0[0]) / L;
    const uy = (p1[1] - p0[1]) / L;
    polys.push({ layer: "center", pts: [[p0[0] - ux * ext, p0[1] - uy * ext], [p1[0] + ux * ext, p1[1] + uy * ext]] });
  }
}

/**
 * Průměry. Soustružené díly (na jedné ose 3+ různých průměrů) se kótují z boku „Ø“ přes válec
 * (válcová plocha = dvě stejné kružnice na ose); ostatní kružnice (díry, čepy) odkazovou čarou „n× Ø d“ v čelném pohledu.
 */
function diameterDims(views: Placed[], circles: Circle[], polys: Poly[], texts: DText[]) {
  const lineKey = (c: Circle) => {
    const base = sub(c.c, mul(c.a, dot(c.c, c.a)));
    return `${c.a.map((v) => k3(v, 3)).join()}|${base.map((v) => k3(v, 2)).join()}`;
  };
  const radKey = (c: Circle) => `${k3(c.r, 2)}|${lineKey(c)}`;
  // počet různých průměrů na ose → soustružený díl
  const radii = new Map<string, Set<string>>();
  for (const c of circles) {
    const k = lineKey(c);
    const set = radii.get(k) ?? new Set<string>();
    set.add((Math.round(c.r * 20) / 20).toFixed(2));
    radii.set(k, set);
  }
  const turned = (c: Circle) => (radii.get(lineKey(c))?.size ?? 0) > 2;
  const done = new Set<string>();
  const order = ["front", "top", "left", "right", "bottom", "back", "section"];
  const sorted = [...views].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));

  // 1) soustružené osy – válce z boku
  for (const p of sorted) {
    if (p.key === "section") continue;
    const groups = new Map<string, { c: Circle; tmin: number; tmax: number; n: number }>();
    for (const c of circles) {
      if (!turned(c) || !c.cyl || Math.abs(dot(c.a, p.cam.d)) > 1e-3 || c.r * p.s < 1.5) continue;
      const k = radKey(c);
      if (done.has(k)) continue;
      const t = dot(c.c, c.a);
      const g = groups.get(k);
      if (g) {
        g.tmin = Math.min(g.tmin, t);
        g.tmax = Math.max(g.tmax, t);
        g.n++;
      } else groups.set(k, { c, tmin: t, tmax: t, n: 1 });
    }
    let n = 0;
    for (const [k, g] of [...groups.entries()].sort((a, b) => b[1].c.r - a[1].c.r)) {
      if (g.n < 2 || g.tmax - g.tmin < 1e-3) continue;
      if (n++ >= 8) break;
      done.add(k);
      const perp = unit(cross(p.cam.d, g.c.a));
      const t = (g.tmin + g.tmax) / 2;
      const base = sub(g.c.c, mul(g.c.a, dot(g.c.c, g.c.a)));
      const mid = add(base, mul(g.c.a, t));
      const a = at(p, add(mid, mul(perp, -g.c.r)));
      const b = at(p, add(mid, mul(perp, g.c.r)));
      linearDim(polys, texts, a, b, [0, 0], 0, 2 * g.c.r, "Ø");
    }
  }

  // 2) čelně viditelné kružnice (díry, čepy) – odkazová čára
  const ANG = [-45, -135, 45, 135];
  for (const p of sorted) {
    const groups = new Map<string, Circle[]>();
    for (const c of circles) {
      if (turned(c) || !c.cyl || Math.abs(dot(c.a, p.cam.d)) < 0.999 || c.r * p.s < 1.2) continue;
      if (done.has(radKey(c))) continue;
      const gk = c.r.toFixed(2);
      const list = groups.get(gk) ?? [];
      // stejná kružnice ve stejném místě obrazu (horní a dolní hrana díry) jen jednou
      const q = at(p, c.c);
      if (!list.some((x) => Math.hypot(at(p, x.c)[0] - q[0], at(p, x.c)[1] - q[1]) < 0.01)) list.push(c);
      groups.set(gk, list);
    }
    const used = new Map<string, number>(); // střed → počet odkazů (soustředné kružnice do jiných směrů)
    let n = 0;
    for (const list of [...groups.values()].sort((a, b) => b[0].r - a[0].r)) {
      if (n++ >= 8) break;
      const c = list.reduce((m, x) => {
        const q = at(p, x.c);
        const mq = at(p, m.c);
        return q[0] - q[1] > mq[0] - mq[1] ? x : m;
      }, list[0]);
      for (const x of circles) if (Math.abs(x.r - c.r) < 0.005 && Math.abs(dot(x.a, p.cam.d)) > 0.999) done.add(radKey(x));
      const q = at(p, c.c);
      const ck = `${q[0].toFixed(1)},${q[1].toFixed(1)}`;
      const rank = used.get(ck) ?? 0;
      used.set(ck, rank + 1);
      const deg = ANG[rank % ANG.length];
      const ar = (deg * Math.PI) / 180;
      const ux = Math.cos(ar);
      const uy = Math.sin(ar);
      const R = c.r * p.s;
      const e: Vec2 = [q[0] + ux * R, q[1] + uy * R];
      const knee: Vec2 = [e[0] + ux * 9, e[1] + uy * 9];
      const label = `${list.length > 1 ? `${list.length}× ` : ""}Ø${fmt(2 * c.r)}`;
      const tw = label.length * 2.05 + 2;
      const right = ux >= 0;
      polys.push({ layer: "dim", pts: [e, knee, [knee[0] + (right ? tw : -tw), knee[1]]] });
      arrow(polys, e[0], e[1], ux, uy);
      texts.push({ x: knee[0] + (right ? 1 : -1), y: knee[1] - 1, s: label, size: 3.5, anchor: right ? "start" : "end", layer: "dim" });
    }
  }
}

/** Čára řezu A–A v nadřazeném pohledu (tenká čerchovaná se silnými konci, šipky ve směru pohledu). */
function cuttingPlane(plane: PlaneName, offset: number, placed: Map<string, Placed>, polys: Poly[], texts: DText[], warnings: string[]) {
  const n = PLANE_N[plane];
  const cam = SECTION_CAM[plane];
  const parent = [...placed.values()].find((p) => p.key !== "section" && Math.abs(dot(p.cam.d, n)) < 1e-6);
  if (!parent) {
    warnings.push("Čáru řezu nelze zakreslit – zapněte pohled, ve kterém je rovina řezu vidět jako čára.");
    return;
  }
  // přímka v obraze rodiče: body p, pro které p·n = offset
  const nu = dot(n, parent.cam.x);
  const nw = dot(n, upOf(parent.cam));
  // směr přímky v obraze (u, w): kolmý na (nu, nw)
  const dir2: Vec2 = [-nw, nu];
  const p0: Vec2 = [nu * offset, nw * offset]; // bod na přímce (u, w)
  // rozsah: přes celý pohled
  const corners: Vec2[] = [
    [parent.x0, parent.y0],
    [parent.x0 + parent.w, parent.y0 + parent.h],
  ];
  const span = Math.hypot(parent.w, parent.h) / 2 + 6 / parent.s;
  const midU = (corners[0][0] + corners[1][0]) / 2;
  const midW = -(corners[0][1] + corners[1][1]) / 2;
  // projekce středu pohledu na přímku
  const t0 = (midU - p0[0]) * dir2[0] + (midW - p0[1]) * dir2[1];
  const ends: Vec2[] = [-1, 1].map((sg) => {
    const t = t0 + sg * span;
    const u = p0[0] + dir2[0] * t;
    const w = p0[1] + dir2[1] * t;
    return toSheet(parent, [u, -w]);
  });
  // ořez na obdélník pohledu + 6 mm
  const bx0 = parent.px - 6;
  const by0 = parent.py - 6;
  const bx1 = parent.px + parent.w * parent.s + 6;
  const by1 = parent.py + parent.h * parent.s + 6;
  const clip = clipSegment(ends[0], ends[1], bx0, by0, bx1, by1);
  if (!clip) {
    warnings.push("Čára řezu leží mimo pohled.");
    return;
  }
  const [a, b] = clip;
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const ux = (b[0] - a[0]) / L;
  const uy = (b[1] - a[1]) / L;
  polys.push({ layer: "cut", pts: [a, b] });
  const thick = 6;
  polys.push({ layer: "cut", width: 0.5, pts: [a, [a[0] + ux * thick, a[1] + uy * thick]] });
  polys.push({ layer: "cut", width: 0.5, pts: [b, [b[0] - ux * thick, b[1] - uy * thick]] });
  // směr pohledu (od pozorovatele k materiálu) = −d řezu promítnutý do rodiče
  const vd = mul(cam.d, -1);
  let ax = dot(vd, parent.cam.x);
  let ay = -dot(vd, upOf(parent.cam));
  const al = Math.hypot(ax, ay) || 1;
  ax /= al;
  ay /= al;
  for (const e of [a, [a[0] + ux * 3, a[1] + uy * 3] as Vec2, b, [b[0] - ux * 3, b[1] - uy * 3] as Vec2].filter((_, i) => i % 2 === 1)) {
    const tip: Vec2 = [e[0] + ax * 8, e[1] + ay * 8];
    polys.push({ layer: "cut", width: 0.35, pts: [e, tip] });
    arrow(polys, tip[0], tip[1], -ax, -ay);
    texts.push({ x: tip[0] + ax * 2.5 + (ux === 0 ? 2.5 : 0), y: tip[1] + ay * 2.5 + 2, s: "A", size: 5, anchor: "middle", bold: true, layer: "text" });
  }
}

function clipSegment(p: Vec2, q: Vec2, x0: number, y0: number, x1: number, y1: number): [Vec2, Vec2] | null {
  let t0 = 0,
    t1 = 1;
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const chk = (pp: number, qq: number) => {
    if (pp === 0) return qq >= 0;
    const t = qq / pp;
    if (pp < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  if (chk(-dx, p[0] - x0) && chk(dx, x1 - p[0]) && chk(-dy, p[1] - y0) && chk(dy, y1 - p[1]))
    return [
      [p[0] + dx * t0, p[1] + dy * t0],
      [p[0] + dx * t1, p[1] + dy * t1],
    ];
  return null;
}

// ---------------------------------------------------------------- rám a razítko

function rect(polys: Poly[], x: number, y: number, w: number, h: number, layer: Layer = "frame", width?: number) {
  polys.push({ layer, width, pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]] });
}

function frame(W: number, H: number, polys: Poly[]) {
  rect(polys, M_LEFT, M, W - M_LEFT - M, H - 2 * M, "frame", 0.7);
  // centrovací značky (ISO 5457)
  const cxm = (M_LEFT + W - M) / 2;
  const cym = H / 2;
  polys.push({ layer: "frame", width: 0.7, pts: [[cxm, 0], [cxm, M + 5]] }, { layer: "frame", width: 0.7, pts: [[cxm, H], [cxm, H - M - 5]] });
  polys.push({ layer: "frame", width: 0.7, pts: [[0, cym], [M_LEFT + 5, cym]] }, { layer: "frame", width: 0.7, pts: [[W, cym], [W - M - 5, cym]] });
}

function projectionSymbol(polys: Poly[], x: number, y: number, projection: "E" | "A") {
  // komolý kužel: lichoběžník + dvě soustředné kružnice (ISO 5456-2), výška 8 mm
  const h = 7;
  const trap = (tx: number, wideLeft: boolean) => {
    const big = h;
    const small = h * 0.5;
    const L = 9;
    const [lh, rh] = wideLeft ? [big, small] : [small, big];
    polys.push({ layer: "title", width: 0.35, pts: [[tx, y + (h - lh) / 2], [tx + L, y + (h - rh) / 2], [tx + L, y + (h + rh) / 2], [tx, y + (h + lh) / 2], [tx, y + (h - lh) / 2]] });
    polys.push({ layer: "center", pts: [[tx - 1.5, y + h / 2], [tx + L + 1.5, y + h / 2]] });
  };
  const circ = (ccx: number) => {
    for (const rr of [h / 2, h / 4]) {
      const pts: Vec2[] = [];
      for (let i = 0; i <= 36; i++) pts.push([ccx + rr * Math.cos((i / 36) * 2 * Math.PI), y + h / 2 + rr * Math.sin((i / 36) * 2 * Math.PI)]);
      polys.push({ layer: "title", width: 0.35, pts });
    }
    polys.push({ layer: "center", pts: [[ccx - h / 2 - 1.5, y + h / 2], [ccx + h / 2 + 1.5, y + h / 2]] }, { layer: "center", pts: [[ccx, y - 1.5], [ccx, y + h + 1.5]] });
  };
  if (projection === "E") {
    trap(x, true);
    circ(x + 9 + 4 + h / 2);
  } else {
    circ(x + h / 2);
    trap(x + h + 4, false);
  }
}

function titleBlock(W: number, H: number, sheet: SheetName, scale: number, projection: "E" | "A", meta: DrawingMeta, polys: Poly[], texts: DText[]) {
  const x = W - M - TB.w;
  const y = H - M - TB.h;
  const T = (tx: number, ty: number, s: string, size: number, bold = false, brand = false) => texts.push({ x: tx, y: ty, s, size, bold, brand, layer: "text" });
  rect(polys, x, y, TB.w, TB.h, "frame", 0.7);
  const L = 55; // levý blok
  polys.push({ layer: "title", pts: [[x + L, y], [x + L, y + TB.h]] });
  // řádky pravé části
  const r1 = 13;
  const r2 = 25.5;
  polys.push({ layer: "title", pts: [[x + L, y + r1], [x + TB.w, y + r1]] }, { layer: "title", pts: [[x + L, y + r2], [x + TB.w, y + r2]] });
  const vline = (vx: number, y0: number, y1: number) => polys.push({ layer: "title", pts: [[x + vx, y + y0], [x + vx, y + y1]] });
  vline(115, r1, r2);
  for (const vx of [75, 92, 117, 145, 166]) vline(vx, r2, TB.h);
  const cell = (cx: number, cy: number, label: string, value: string, size = 3.2, bold = false) => {
    T(x + cx + 1.5, y + cy + 3.2, label, 2);
    if (value) T(x + cx + 1.5, y + cy + 3.2 + size + 2.6, value, size, bold);
  };
  // levý blok – firma
  T(x + 3, y + 8.5, "Mnástrojárna s.r.o.", 4.6, true, true);
  T(x + 3, y + 13.5, "Váš partner ve strojírenství", 2.6);
  T(x + 3, y + 18, "www.mnastrojarna.cz", 2.4);
  polys.push({ layer: "title", pts: [[x, y + 21], [x + L, y + 21]] });
  T(x + 3, y + 25, "Promítání", 2);
  projectionSymbol(polys, x + 4, y + 27.5, projection);
  T(x + 30, y + 33, projection === "E" ? "ISO E" : "ISO A", 3, true);
  // pravá část
  cell(L, 0, "Název", (meta.name || "Bez názvu").slice(0, 46), 4.2, true);
  cell(L, r1, "Číslo výkresu", (meta.number ?? "").slice(0, 26), 3.4, true);
  cell(115, r1, "Materiál", (meta.material ?? "").slice(0, 28));
  cell(L, r2, "Měřítko", scaleLabel(scale), 3.2, true);
  cell(75, r2, "Formát", sheet);
  cell(92, r2, "Hmotnost", meta.massKg != null ? `${fmt(meta.massKg)} kg` : "—");
  cell(117, r2, "Kreslil", (meta.author ?? "").slice(0, 16));
  cell(145, r2, "Datum", meta.date ?? new Date().toLocaleDateString("cs-CZ"), 2.8);
  cell(166, r2, "Rev.", meta.revision ?? "–");
  // poznámka nad razítkem a list
  const ny = y - bomHeight(meta.bom);
  T(x, ny - 5.5, `Nepředepsané tolerance ${meta.tolerance || "ISO 2768-mK"} · Rozměry v mm · Ostré hrany srazit 0,5×45°`, 2.5);
  T(x, ny - 1.8, "Nekótované rozměry dle 3D modelu (STEP) · List 1/1", 2.5);
}

// ---------------------------------------------------------------- kusovník (ISO 7573)

const BOM_ROW = 7;
/** sloupce: Pozice | Název | Číslo výkresu/normy | Ks | Materiál | Hmotnost (součet = šířka razítka) */
const BOM_COLS: [string, number][] = [
  ["Poz.", 12],
  ["Název", 52],
  ["Číslo výkresu / normy", 40],
  ["Ks", 12],
  ["Materiál", 36],
  ["Hmotnost", 28],
];

const bomHeight = (bom?: BomItem[]) => (bom?.length ? (bom.length + 1) * BOM_ROW : 0);

/** Kusovník nad razítkem: hlavička dole, položky rostou nahoru (poz. 1 nejníže). */
function partsList(x: number, yBottom: number, bom: BomItem[], polys: Poly[], texts: DText[]) {
  const items = [...bom].sort((a, b) => a.pos - b.pos);
  const h = (items.length + 1) * BOM_ROW;
  const y0 = yBottom - h;
  rect(polys, x, y0, TB.w, h, "frame", 0.7);
  for (let i = 1; i <= items.length; i++) {
    const yy = y0 + i * BOM_ROW;
    // silná čára nad hlavičkou
    polys.push({ layer: "title", width: i === items.length ? 0.5 : undefined, pts: [[x, yy], [x + TB.w, yy]] });
  }
  let cx = x;
  const colX: number[] = [];
  for (const [, w] of BOM_COLS) {
    colX.push(cx);
    cx += w;
    if (cx < x + TB.w - 1e-6) polys.push({ layer: "title", pts: [[cx, y0], [cx, yBottom]] });
  }
  const cellText = (col: number, rowBottom: number, s: string, bold = false, size = 2.8) => {
    const [, w] = BOM_COLS[col];
    const center = col === 0 || col === 3;
    const max = Math.floor((w - 2) / (size * 0.52));
    const str = s.length > max ? s.slice(0, Math.max(1, max - 1)) + "…" : s;
    texts.push({ x: center ? colX[col] + w / 2 : colX[col] + 1.5, y: rowBottom - 2.2, s: str, size, bold, anchor: center ? "middle" : "start", layer: "text" });
  };
  BOM_COLS.forEach(([label], i) => cellText(i, yBottom, label, true, 2.5));
  items.forEach((it, i) => {
    const rb = yBottom - (i + 1) * BOM_ROW;
    cellText(0, rb, String(it.pos));
    cellText(1, rb, it.name + (it.note ? ` (${it.note})` : ""));
    cellText(2, rb, it.number ?? "");
    cellText(3, rb, fmt(it.qty));
    cellText(4, rb, it.material ?? "");
    cellText(5, rb, it.massKg != null ? `${fmt(it.massKg)} kg` : "");
  });
}

/** Kusovník jako CSV pro Excel (středníky, UTF-8 s BOM, CRLF). */
export function bomToCsv(bom: BomItem[]): string {
  const q = (v: string | number | undefined) => {
    const s = v == null ? "" : String(v);
    return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const num = (n?: number) => (n == null ? "" : String(Math.round(n * 1000) / 1000).replace(".", ","));
  const rows = [["Pozice", "Název", "Číslo výkresu / normy", "Ks", "Materiál", "Hmotnost [kg]", "Poznámka"].join(";")];
  for (const it of [...bom].sort((a, b) => a.pos - b.pos)) rows.push([q(it.pos), q(it.name), q(it.number), num(it.qty), q(it.material), num(it.massKg), q(it.note)].join(";"));
  return "﻿" + rows.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------- SVG

const STYLE: Record<Layer, { w: number; dash?: string; color: string }> = {
  visible: { w: 0.5, color: "#111" },
  hidden: { w: 0.25, dash: "3 1.5", color: "#333" },
  center: { w: 0.18, dash: "12 3 1.5 3", color: "#333" },
  cut: { w: 0.18, dash: "12 3 1.5 3", color: "#111" },
  dim: { w: 0.18, color: "#111" },
  hatch: { w: 0.18, color: "#333" },
  frame: { w: 0.5, color: "#111" },
  thin: { w: 0.3, color: "#222" },
  title: { w: 0.25, color: "#111" },
};
export const LAYER_STYLE = STYLE;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function toSvg(W: number, H: number, polys: Poly[], texts: DText[]) {
  const f = (n: number) => (Math.round(n * 1000) / 1000).toString();
  const out: string[] = [];
  for (const p of polys) {
    const st = STYLE[p.layer];
    const pts = p.pts.map(([x, y]) => `${f(x)},${f(y)}`).join(" ");
    if (p.fill) out.push(`<polygon points="${pts}" fill="${st.color}" stroke="none"/>`);
    else {
      const dash = st.dash && p.width == null ? ` stroke-dasharray="${st.dash}"` : "";
      out.push(`<polyline fill="none" stroke="${st.color}" stroke-width="${p.width ?? st.w}"${dash} points="${pts}"/>`);
    }
  }
  for (const t of texts) {
    const rot = t.rotate ? ` transform="rotate(${f(t.rotate)} ${f(t.x)} ${f(t.y)})"` : "";
    out.push(
      `<text x="${f(t.x)}" y="${f(t.y)}" font-size="${t.size}"${t.bold ? ' font-weight="700"' : ""} text-anchor="${t.anchor ?? "start"}"${rot} fill="${t.brand ? "#E03930" : "#111"}">${esc(t.s)}</text>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" font-family="Roboto, Arial, Helvetica, sans-serif" stroke-linecap="round" stroke-linejoin="round"><rect width="${W}" height="${H}" fill="#fff"/>${out.join("")}</svg>`;
}

// ---------------------------------------------------------------- DXF (R12, mm)

const DXF_LAYER: Record<Layer, string> = {
  visible: "OBRYS",
  thin: "OBRYS",
  hidden: "SKRYTE",
  center: "OSY",
  cut: "OSY",
  dim: "KOTY",
  hatch: "SRAFY",
  frame: "RAM",
  title: "RAM",
};

/** Ne-ASCII znaky jako \U+XXXX (AutoCAD, ZWCAD, LibreCAD, DraftSight). */
const dxfText = (s: string) => s.replace(/[^\x20-\x7e]/g, (c) => `\\U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`);

/** DXF R12 (AC1009) – vrstvy, typy čar, textový styl; souřadnice v mm, počátek vlevo dole. */
export function toDxf(H: number, polys: Poly[], texts: DText[]) {
  const o: string[] = [];
  const add = (...kv: (string | number)[]) => {
    for (const v of kv) o.push(String(v));
  };
  const f = (n: number) => (Math.round(n * 1e4) / 1e4).toString();
  add(0, "SECTION", 2, "HEADER");
  add(9, "$ACADVER", 1, "AC1009");
  add(9, "$INSUNITS", 70, 4);
  add(9, "$MEASUREMENT", 70, 1);
  add(9, "$LTSCALE", 40, 1);
  add(9, "$DWGCODEPAGE", 3, "ANSI_1250");
  add(0, "ENDSEC");
  add(0, "SECTION", 2, "TABLES");
  // typy čar
  const ltypes: [string, string, number[]][] = [
    ["CONTINUOUS", "Solid line", []],
    ["HIDDEN", "Hidden __ __ __", [3, -1.5]],
    ["CENTER", "Center ____ _ ____ _", [12, -3, 1.5, -3]],
  ];
  add(0, "TABLE", 2, "LTYPE", 70, ltypes.length);
  for (const [name, desc, pat] of ltypes) {
    add(0, "LTYPE", 2, name, 70, 0, 3, desc, 72, 65, 73, pat.length, 40, f(pat.reduce((a, b) => a + Math.abs(b), 0)));
    for (const p of pat) add(49, f(p));
  }
  add(0, "ENDTAB");
  const layers: [string, number, string][] = [
    ["0", 7, "CONTINUOUS"],
    ["OBRYS", 7, "CONTINUOUS"],
    ["SKRYTE", 8, "HIDDEN"],
    ["OSY", 5, "CENTER"],
    ["KOTY", 3, "CONTINUOUS"],
    ["SRAFY", 9, "CONTINUOUS"],
    ["RAM", 7, "CONTINUOUS"],
    ["TEXT", 7, "CONTINUOUS"],
  ];
  add(0, "TABLE", 2, "LAYER", 70, layers.length);
  for (const [name, color, lt] of layers) add(0, "LAYER", 2, name, 70, 0, 62, color, 6, lt);
  add(0, "ENDTAB");
  add(0, "TABLE", 2, "STYLE", 70, 1);
  add(0, "STYLE", 2, "ISO", 70, 0, 40, 0, 41, 1, 50, 0, 71, 0, 42, 3.5, 3, "isocp.shx", 4, "");
  add(0, "ENDTAB");
  add(0, "ENDSEC");
  add(0, "SECTION", 2, "ENTITIES");
  for (const p of polys) {
    const layer = DXF_LAYER[p.layer];
    if (p.fill && p.pts.length >= 3) {
      const [a, b, c] = p.pts;
      add(0, "SOLID", 8, layer, 10, f(a[0]), 20, f(H - a[1]), 30, 0, 11, f(b[0]), 21, f(H - b[1]), 31, 0, 12, f(c[0]), 22, f(H - c[1]), 32, 0, 13, f(c[0]), 23, f(H - c[1]), 33, 0);
      continue;
    }
    if (p.pts.length === 2) {
      const [[x1, y1], [x2, y2]] = p.pts;
      add(0, "LINE", 8, layer, 10, f(x1), 20, f(H - y1), 30, 0, 11, f(x2), 21, f(H - y2), 31, 0);
      continue;
    }
    if (p.pts.length < 2) continue;
    // POLYLINE se souvislým generováním typu čáry (70: 128)
    add(0, "POLYLINE", 8, layer, 66, 1, 10, 0, 20, 0, 30, 0, 70, 128);
    for (const [x, y] of p.pts) add(0, "VERTEX", 8, layer, 10, f(x), 20, f(H - y), 30, 0);
    add(0, "SEQEND", 8, layer);
  }
  for (const t of texts) {
    const al = t.anchor === "middle" ? 1 : t.anchor === "end" ? 2 : 0;
    const layer = t.layer === "dim" ? "KOTY" : "TEXT";
    add(0, "TEXT", 8, layer, 10, f(t.x), 20, f(H - t.y), 30, 0, 40, f(t.size * 0.72), 1, dxfText(t.s), 50, f(-(t.rotate ?? 0)), 7, "ISO");
    if (al) add(72, al, 11, f(t.x), 21, f(H - t.y), 31, 0);
  }
  add(0, "ENDSEC", 0, "EOF");
  return o.join("\n") + "\n";
}

// ---------------- uživatelské kóty a poznámky (asociativní) ----------------

import type { DrawingAnnotation, GdtSymbol } from "./types";

const fmtVal = (n: number) => (Math.round(n * 100) / 100).toLocaleString("cs-CZ");

/** souřadnice pohledu → list; `view: "sheet"` = už v mm listu */
export function annToSheet(views: PlacedView[], view: string, q: Vec2): Vec2 {
  if (view === "sheet") return q;
  const v = views.find((x) => x.key === view);
  if (!v) return q;
  return [v.px + (q[0] - v.x0) * v.s, v.py + (q[1] - v.y0) * v.s];
}
/** list → souřadnice pohledu */
export function sheetToAnn(v: PlacedView, q: Vec2): Vec2 {
  return [(q[0] - v.px) / v.s + v.x0, (q[1] - v.py) / v.s + v.y0];
}
/** který pohled obsahuje bod listu (s okrajem) */
export function viewAt(views: PlacedView[], q: Vec2, margin = 12): PlacedView | null {
  let best: PlacedView | null = null;
  let bd = Infinity;
  for (const v of views) {
    const w = v.w * v.s;
    const h = v.h * v.s;
    const dx = Math.max(v.px - q[0], 0, q[0] - (v.px + w));
    const dy = Math.max(v.py - q[1], 0, q[1] - (v.py + h));
    const d = Math.hypot(dx, dy);
    if (d <= margin && d < bd) {
      bd = d;
      best = v;
    }
  }
  return best;
}

export const GDT_LABEL: Record<GdtSymbol, string> = {
  straight: "Přímost",
  flat: "Rovinnost",
  circ: "Kruhovitost",
  cyl: "Válcovitost",
  prof: "Tvar plochy",
  par: "Rovnoběžnost",
  perp: "Kolmost",
  angle: "Sklon",
  pos: "Poloha",
  conc: "Soustřednost",
  sym: "Souměrnost",
  runout: "Házení",
};

function arrowAt(polys: Poly[], tip: Vec2, dir: Vec2, layer: Layer = "dim") {
  const l = 3;
  const w = 0.8;
  const d = Math.hypot(dir[0], dir[1]) || 1;
  const ux = dir[0] / d;
  const uy = dir[1] / d;
  polys.push({ layer, fill: true, pts: [tip, [tip[0] - ux * l - uy * w, tip[1] - uy * l + ux * w], [tip[0] - ux * l + uy * w, tip[1] - uy * l - ux * w], tip] });
}

function circlePts(c: Vec2, r: number, n = 24): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) out.push([c[0] + r * Math.cos((2 * Math.PI * i) / n), c[1] + r * Math.sin((2 * Math.PI * i) / n)]);
  return out;
}

/** značka geometrické tolerance ISO 1101 jako geometrie (čáry) – funguje v SVG/DXF/DWG/PDF bez speciálního písma */
function gdtGlyph(polys: Poly[], c: Vec2, sym: GdtSymbol) {
  const r = 2;
  const L = (pts: Vec2[]) => polys.push({ layer: "dim", pts });
  const [x, y] = c;
  switch (sym) {
    case "straight": L([[x - r, y], [x + r, y]]); break;
    case "flat": L([[x - r, y + r * 0.6], [x - r * 0.2, y - r * 0.6], [x + r, y - r * 0.6], [x + r * 0.2, y + r * 0.6], [x - r, y + r * 0.6]]); break;
    case "circ": L(circlePts(c, r * 0.9)); break;
    case "cyl": L(circlePts(c, r * 0.8)); L([[x - r * 1.3, y + r], [x - r * 0.8, y - r]]); L([[x + r * 0.8, y + r], [x + r * 1.3, y - r]]); break;
    case "prof": { const pts = circlePts([x, y + r * 0.3], r * 0.9).filter((p) => p[1] <= y + r * 0.35); L([[x - r * 0.9, y + r * 0.3], ...pts.sort((a, b) => a[0] - b[0]), [x + r * 0.9, y + r * 0.3], [x - r * 0.9, y + r * 0.3]]); break; }
    case "par": L([[x - r * 0.7, y + r], [x - r * 0.1, y - r]]); L([[x + r * 0.1, y + r], [x + r * 0.7, y - r]]); break;
    case "perp": L([[x - r, y + r * 0.8], [x + r, y + r * 0.8]]); L([[x, y + r * 0.8], [x, y - r]]); break;
    case "angle": L([[x - r, y + r * 0.8], [x + r, y + r * 0.8], [x - r * 0.6, y - r]]); break;
    case "pos": L(circlePts(c, r * 0.7)); L([[x - r * 1.2, y], [x + r * 1.2, y]]); L([[x, y - r * 1.2], [x, y + r * 1.2]]); break;
    case "conc": L(circlePts(c, r * 0.9)); L(circlePts(c, r * 0.45)); break;
    case "sym": L([[x - r, y - r * 0.7], [x + r, y - r * 0.7]]); L([[x - r * 0.6, y], [x + r * 0.6, y]]); L([[x - r, y + r * 0.7], [x + r, y + r * 0.7]]); break;
    case "runout": L([[x - r * 0.9, y + r], [x + r * 0.7, y - r * 0.9]]); arrowAt(polys, [x + r * 0.9, y - r], [1, -1]); break;
  }
}

/** Geometrie (čáry + texty v mm listu) pro uživatelské poznámky a kóty. */
export function annotationGeometry(d: Pick<DrawingResult, "views" | "scaleValue">, annotations: DrawingAnnotation[]): { polys: Poly[]; texts: DText[] } {
  const polys: Poly[] = [];
  const texts: DText[] = [];
  const S = (view: string, q: Vec2) => annToSheet(d.views, view, q);
  const modelLen = (view: string, a: Vec2, b: Vec2) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    return view === "sheet" ? len / d.scaleValue : len; // souřadnice pohledu jsou v mm modelu
  };
  for (const a of annotations) {
    switch (a.type) {
      case "dim": {
        const A = S(a.view, a.a);
        const B = S(a.view, a.b);
        let A2: Vec2;
        let B2: Vec2;
        let value: number;
        let u: Vec2;
        if (a.kind === "horizontal") {
          const y = A[1] + a.offset;
          A2 = [A[0], y];
          B2 = [B[0], y];
          value = Math.abs(modelLen(a.view, [a.a[0], 0], [a.b[0], 0]));
          u = [Math.sign(B[0] - A[0]) || 1, 0];
        } else if (a.kind === "vertical") {
          const x = A[0] + a.offset;
          A2 = [x, A[1]];
          B2 = [x, B[1]];
          value = Math.abs(modelLen(a.view, [0, a.a[1]], [0, a.b[1]]));
          u = [0, Math.sign(B[1] - A[1]) || 1];
        } else {
          const dx = B[0] - A[0];
          const dy = B[1] - A[1];
          const l = Math.hypot(dx, dy) || 1;
          u = [dx / l, dy / l];
          const n: Vec2 = [-u[1], u[0]];
          A2 = [A[0] + n[0] * a.offset, A[1] + n[1] * a.offset];
          B2 = [B[0] + n[0] * a.offset, B[1] + n[1] * a.offset];
          value = modelLen(a.view, a.a, a.b);
        }
        // vynášecí čáry (s přesahem 1,5 mm) a kótovací čára
        const ext = (P: Vec2, P2: Vec2) => {
          const dx = P2[0] - P[0];
          const dy = P2[1] - P[1];
          const l = Math.hypot(dx, dy) || 1;
          polys.push({ layer: "dim", pts: [[P[0] + (dx / l) * 1, P[1] + (dy / l) * 1], [P2[0] + (dx / l) * 1.5, P2[1] + (dy / l) * 1.5]] });
        };
        ext(A, A2);
        ext(B, B2);
        polys.push({ layer: "dim", pts: [A2, B2] });
        const span = Math.hypot(B2[0] - A2[0], B2[1] - A2[1]);
        const inside = span > 8;
        arrowAt(polys, A2, inside ? [-u[0], -u[1]] : [u[0], u[1]]);
        arrowAt(polys, B2, inside ? [u[0], u[1]] : [-u[0], -u[1]]);
        const label = a.text ?? `${a.prefix ?? ""}${fmtVal(value)}${a.suffix ?? ""}`;
        let ang = (Math.atan2(u[1], u[0]) * 180) / Math.PI;
        if (ang > 90 || ang <= -90) ang += 180;
        const rad = (ang * Math.PI) / 180;
        const nx = Math.sin(rad);
        const ny = -Math.cos(rad); // kolmo „nad“ čáru (SVG y dolů)
        const mid: Vec2 = [(A2[0] + B2[0]) / 2 + nx * 1.2, (A2[1] + B2[1]) / 2 + ny * 1.2];
        texts.push({ x: mid[0], y: mid[1], s: label, size: 3.5, anchor: "middle", rotate: Math.abs(ang) < 0.01 ? undefined : ang, layer: "dim" });
        break;
      }
      case "note": {
        const at = S(a.view, a.at);
        const w = Math.max(6, a.text.length * 3.5 * 0.58 + 2);
        if (a.leader) {
          const tip = S(a.view, a.leader);
          polys.push({ layer: "dim", pts: [tip, at, [at[0] + w, at[1]]] });
          arrowAt(polys, tip, [tip[0] - at[0], tip[1] - at[1]]);
        }
        texts.push({ x: at[0] + 1, y: at[1] - 1, s: a.text, size: 3.5, layer: "text" });
        break;
      }
      case "roughness": {
        const t = S(a.view, a.at); // hrot značky leží na povrchu
        const short: Vec2 = [t[0] - 2.9, t[1] - 5];
        const long: Vec2 = [t[0] + 5.8, t[1] - 10];
        polys.push({ layer: "dim", pts: [short, t, long] });
        polys.push({ layer: "dim", pts: [long, [long[0] + 12, long[1]]] });
        texts.push({ x: long[0] + 1, y: long[1] + 4.2, s: a.ra, size: 3, layer: "text" });
        if (a.leader) {
          const tip = S(a.view, a.leader);
          polys.push({ layer: "dim", pts: [tip, t] });
          arrowAt(polys, tip, [tip[0] - t[0], tip[1] - t[1]]);
        }
        break;
      }
      case "gdt": {
        const at = S(a.view, a.at);
        const H = 7;
        const cells = [7, Math.max(9, a.value.length * 3.5 * 0.6 + 3), ...(a.datum ? [7] : [])];
        let x = at[0];
        const y = at[1];
        const rect = (w: number) => polys.push({ layer: "dim", pts: [[x, y], [x + w, y], [x + w, y + H], [x, y + H], [x, y]] });
        rect(cells[0]);
        gdtGlyph(polys, [x + cells[0] / 2, y + H / 2], a.symbol);
        x += cells[0];
        rect(cells[1]);
        texts.push({ x: x + cells[1] / 2, y: y + H / 2 + 1.25, s: a.value, size: 3.5, anchor: "middle", layer: "text" });
        x += cells[1];
        if (a.datum) {
          rect(cells[2]);
          texts.push({ x: x + cells[2] / 2, y: y + H / 2 + 1.25, s: a.datum, size: 3.5, anchor: "middle", bold: true, layer: "text" });
        }
        if (a.leader) {
          const tip = S(a.view, a.leader);
          polys.push({ layer: "dim", pts: [tip, [at[0], y + H / 2]] });
          arrowAt(polys, tip, [tip[0] - at[0], tip[1] - y - H / 2]);
        }
        break;
      }
      case "datum": {
        const at = S(a.view, a.at); // vrchol trojúhelníku na povrchu
        polys.push({ layer: "dim", fill: true, pts: [at, [at[0] - 1.8, at[1] - 3], [at[0] + 1.8, at[1] - 3], at] });
        polys.push({ layer: "dim", pts: [[at[0], at[1] - 3], [at[0], at[1] - 10]] });
        polys.push({ layer: "dim", pts: [[at[0] - 3, at[1] - 16], [at[0] + 3, at[1] - 16], [at[0] + 3, at[1] - 10], [at[0] - 3, at[1] - 10], [at[0] - 3, at[1] - 16]] });
        texts.push({ x: at[0], y: at[1] - 11.7, s: a.label, size: 3.5, anchor: "middle", bold: true, layer: "text" });
        break;
      }
      case "text": {
        const at = S(a.view, a.at);
        texts.push({ x: at[0], y: at[1], s: a.text, size: a.size || 3.5, layer: "text" });
        break;
      }
    }
  }
  return { polys, texts };
}

/** Výkres + uživatelské poznámky → nový výsledek (polys/texts/svg/dxf přepočítané). */
export function withAnnotations(d: DrawingResult, annotations: DrawingAnnotation[]): DrawingResult {
  if (!annotations.length) return d;
  const g = annotationGeometry(d, annotations);
  const polys = [...d.polys, ...g.polys];
  const texts = [...d.texts, ...g.texts];
  return { ...d, polys, texts, svg: toSvg(d.sheet.w, d.sheet.h, polys, texts), dxf: toDxf(d.sheet.h, polys, texts) };
}
