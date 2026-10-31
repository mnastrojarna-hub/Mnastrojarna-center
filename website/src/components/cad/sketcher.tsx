"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { evalExpr } from "@/cad/params";
import { arcGeom, circleFrom3, entityPath, findLoops, keyPoints, loopPolygon, prims, type Prim } from "@/cad/sketch";
import {
  allIntersections,
  angleBetween,
  chamferLines,
  circularPattern,
  d2 as dist,
  distToEntity,
  explode,
  extend,
  filletLines,
  linearPattern,
  nearestOnPrim,
  offsetEntity,
  offsetSide,
  transformEntity,
  trim,
  xfMirror,
  xfMove,
  xfRotate,
  xfScale,
} from "@/cad/sketch-ops";
import { constraintResiduals, measureDim, paramsOf, refCircle, refLine, refPoint, sketchDof, solveSketch } from "@/cad/sketch-solver";
import { uid, type Feature, type SketchConstraint, type SketchDim, type SketchEntity, type SketchRef, type Vec2 } from "@/cad/types";
import { cn } from "@/lib/cn";
import { CadIcon, type CadIconName } from "./cad-icons";
import { ContextMenu, type RGroup, type RItem, type RMenuEntry } from "./ribbon";

// ======================= typy a nastavení =======================

type ConType = SketchConstraint["type"];
export type SketchTool =
  | "select"
  | "line"
  | "polyline"
  | "centerline"
  | "rect"
  | "rectCenter"
  | "circle"
  | "circle3"
  | "arc"
  | "arcCenter"
  | "arcTangent"
  | "ellipse"
  | "spline"
  | "point"
  | "polygon"
  | "slot"
  | "trim"
  | "extend"
  | "offset"
  | "fillet"
  | "chamfer"
  | "mirror"
  | "move"
  | "copy"
  | "rotate"
  | "scale"
  | "patternLinear"
  | "patternCircular"
  | "explode"
  | "construction"
  | "dimension"
  | "measure"
  | `con-${ConType}`;

type SketchF = Extract<Feature, { type: "sketch" }>;
export type SketchPatch = { entities?: SketchEntity[]; constraints?: SketchConstraint[]; dims?: SketchDim[] };

type Props = {
  sketch: SketchF;
  onChange: (patch: SketchPatch, commit?: boolean) => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
  tool: SketchTool;
  setTool: (t: SketchTool) => void;
  snapGrid: boolean;
  setSnapGrid?: (v: boolean) => void;
  onFinish?: () => void;
};

/** Druhy uchopení (OSNAP) jako v ZW3D. */
export type SnapKind = "end" | "mid" | "center" | "quad" | "int" | "near" | "perp" | "tan" | "grid" | "origin";
export const SNAP_LABEL: Record<SnapKind, string> = {
  end: "Koncový bod",
  mid: "Střed úsečky",
  center: "Střed křivky",
  quad: "Kvadrant",
  int: "Průsečík",
  near: "Na křivce",
  perp: "Kolmo",
  tan: "Tečně",
  grid: "Mřížka",
  origin: "Počátek",
};
const SNAP_ORDER: SnapKind[] = ["end", "mid", "center", "quad", "int", "near", "perp", "tan", "origin"];
type SnapSettings = Record<SnapKind, boolean> & { infer: boolean; auto: boolean };
const SNAP_KEY = "mn-cad-snaps-v1";
const defaultSnaps: SnapSettings = { end: true, mid: true, center: true, quad: true, int: true, near: true, perp: true, tan: true, grid: true, origin: true, infer: true, auto: true };
function loadSnaps(): SnapSettings {
  try {
    return { ...defaultSnaps, ...JSON.parse(localStorage.getItem(SNAP_KEY) ?? "{}") };
  } catch {
    return defaultSnaps;
  }
}

export const CON_INFO: Record<ConType, { label: string; icon: CadIconName; glyph: string; hint: string }> = {
  horizontal: { label: "Vodorovně", icon: "cHorizontal", glyph: "H", hint: "úsečka nebo 2 body" },
  vertical: { label: "Svisle", icon: "cVertical", glyph: "V", hint: "úsečka nebo 2 body" },
  coincident: { label: "Totožnost", icon: "cCoincident", glyph: "●", hint: "2 body" },
  parallel: { label: "Rovnoběžně", icon: "cParallel", glyph: "∥", hint: "2 úsečky" },
  perpendicular: { label: "Kolmo", icon: "cPerpendicular", glyph: "⊥", hint: "2 úsečky" },
  tangent: { label: "Tečně", icon: "cTangent", glyph: "T", hint: "úsečka + oblouk / 2 oblouky" },
  equal: { label: "Stejná velikost", icon: "cEqual", glyph: "=", hint: "2 úsečky nebo 2 kružnice" },
  fixed: { label: "Pevně", icon: "cFixed", glyph: "⚓", hint: "bod nebo entita" },
  concentric: { label: "Soustředně", icon: "cConcentric", glyph: "◎", hint: "2 kružnice/oblouky" },
  midpoint: { label: "Ve středu", icon: "cMidpoint", glyph: "M", hint: "bod + úsečka" },
  pointOnCurve: { label: "Bod na křivce", icon: "cPointOnCurve", glyph: "⊙", hint: "bod + křivka" },
  symmetric: { label: "Symetrie", icon: "cSymmetric", glyph: "⋈", hint: "2 body + osa" },
  collinear: { label: "Kolineárně", icon: "cCollinear", glyph: "≡", hint: "2 úsečky" },
};

const TOOL_LABEL: Partial<Record<SketchTool, string>> = {
  select: "Výběr",
  line: "Úsečka",
  polyline: "Lomená čára",
  centerline: "Osa",
  rect: "Obdélník",
  rectCenter: "Obdélník ze středu",
  circle: "Kružnice",
  circle3: "Kružnice 3 body",
  arc: "Oblouk 3 body",
  arcCenter: "Oblouk středem",
  arcTangent: "Tečný oblouk",
  ellipse: "Elipsa",
  spline: "Spline",
  point: "Bod",
  polygon: "Mnohoúhelník",
  slot: "Drážka",
  trim: "Oříznout",
  extend: "Prodloužit",
  offset: "Odsadit",
  fillet: "Zaoblit roh",
  chamfer: "Srazit roh",
  mirror: "Zrcadlit",
  move: "Přesunout",
  copy: "Kopírovat",
  rotate: "Otočit",
  scale: "Měřítko",
  patternLinear: "Lineární pole",
  patternCircular: "Kruhové pole",
  explode: "Rozložit",
  construction: "Pomocná geometrie",
  dimension: "Kóta",
  measure: "Měřit",
};

const KEYS: Record<string, SketchTool> = { v: "select", l: "line", k: "polyline", x: "centerline", r: "rect", c: "circle", a: "arc", e: "ellipse", n: "spline", b: "point", p: "polygon", s: "slot", t: "trim", o: "offset", d: "dimension", m: "measure" };

/** Nástroje vyžadující nejdřív výběr entit. */
const SEL_TOOLS = new Set<SketchTool>(["mirror", "move", "copy", "rotate", "scale", "patternLinear", "patternCircular", "explode", "construction"]);

// ======================= pás karet skici =======================

/** Skupiny pásu karet pro režim skici (volá je cad-app). */
export function sketchRibbon(p: { tool: SketchTool; setTool: (t: SketchTool) => void; snapGrid: boolean; setSnapGrid: (v: boolean) => void; onExportDxf: () => void; onImportDxf: () => void }): RGroup[] {
  const T = (t: SketchTool, icon: CadIconName, kbd?: string, hint?: string): RItem => ({ id: t, label: TOOL_LABEL[t] ?? t, icon, tone: "sketch", kbd, hint, active: p.tool === t, onClick: () => p.setTool(t) });
  const E = (t: SketchTool, icon: CadIconName, kbd?: string, hint?: string): RItem => ({ ...T(t, icon, kbd, hint), tone: "feature" });
  const K = (c: ConType): RItem => ({ id: `con-${c}`, label: CON_INFO[c].label, icon: CON_INFO[c].icon, tone: "pattern", hint: CON_INFO[c].hint, active: p.tool === `con-${c}`, onClick: () => p.setTool(`con-${c}`) });
  return [
    {
      label: "Kreslení",
      big: 5,
      items: [
        T("select", "select", "V"),
        T("line", "line", "L", "řetěz úseček, Esc ukončí"),
        T("rect", "rect", "R"),
        T("circle", "circle", "C"),
        T("arc", "arc", "A", "začátek, konec, bod na oblouku"),
        T("polyline", "polyline", "K", "Enter/dvojklik ukončí"),
        T("centerline", "centerline", "X", "pomocná osa"),
        T("point", "point", "B"),
        T("rectCenter", "rectCenter"),
        T("circle3", "circle3"),
        T("polygon", "polygon", "P"),
        T("arcCenter", "arcCenter", undefined, "střed, začátek, konec"),
        T("arcTangent", "arcTangent", undefined, "navazuje tečně na konec úsečky/oblouku"),
        T("slot", "slot", "S"),
        T("ellipse", "ellipse", "E", "střed, hlavní poloosa, vedlejší poloosa"),
        T("spline", "spline", "N", "body křivky, Enter ukončí"),
      ],
    },
    {
      label: "Úpravy",
      big: 2,
      items: [
        E("trim", "trim", "T", "klikněte na úsek k odstranění"),
        E("offset", "offset", "O", "klikněte na entitu, pak stranu / zadejte vzdálenost"),
        E("extend", "extend", undefined, "klikněte u konce úsečky"),
        E("fillet", "fillet", undefined, "2 úsečky + poloměr"),
        E("chamfer", "chamfer", undefined, "2 úsečky + vzdálenost"),
        E("move", "move"),
        E("copy", "copy"),
        E("rotate", "rotate"),
        E("mirror", "mirror"),
        E("scale", "scale"),
        E("patternLinear", "pattern"),
        E("patternCircular", "patternCircular"),
        E("explode", "explode"),
        E("construction", "construction"),
      ],
    },
    {
      label: "Vazby",
      big: 0,
      items: (["horizontal", "vertical", "coincident", "parallel", "perpendicular", "tangent", "equal", "concentric", "midpoint", "pointOnCurve", "symmetric", "collinear", "fixed"] as ConType[]).map(K),
    },
    { label: "Kóty", items: [{ ...T("dimension", "dimension", "D", "inteligentní kóta – klikněte na entity"), tone: "tool" }] },
    {
      label: "Nástroje",
      big: 1,
      items: [
        { ...T("measure", "measure", "M"), tone: "tool" },
        { id: "grid", label: "Přichytit k mřížce", icon: "grid", tone: "view", kbd: "G", active: p.snapGrid, onClick: () => p.setSnapGrid(!p.snapGrid) },
        { id: "dxf", label: "Export skici DXF", icon: "export", tone: "file", onClick: p.onExportDxf },
        { id: "imp", label: "Import DXF…", icon: "open", tone: "file", onClick: p.onImportDxf },
      ],
    },
  ];
}

// ======================= geometrie pomocí =======================

const fmt = (n: number, d = 2) => (Math.round(n * 10 ** d) / 10 ** d).toLocaleString("cs-CZ");
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const R4 = (p: Vec2): Vec2 => [r4(p[0]), r4(p[1])];
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const addv = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const mulv = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k];
const angDeg = (a: Vec2, b: Vec2) => (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;

function niceStep(x: number) {
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const n = x / p;
  return (n < 2 ? 1 : n < 5 ? 2 : 5) * p;
}

type Handle = { key: string; p: Vec2 };
function handlesOf(e: SketchEntity): Handle[] {
  switch (e.type) {
    case "line":
      return [{ key: "a", p: e.a }, { key: "b", p: e.b }];
    case "arc":
      return [{ key: "a", p: e.a }, { key: "b", p: e.b }, { key: "c", p: e.c }];
    case "polyline":
    case "spline":
      return e.points.map((p, i) => ({ key: `p${i}`, p }));
    case "circle":
      return [{ key: "c", p: [e.cx, e.cy] }, { key: "r", p: [e.cx + e.r, e.cy] }];
    case "rect":
      return [{ key: "c", p: [e.cx, e.cy] }, { key: "corner", p: keyPoints(e).c2 }];
    case "polygon":
      return [{ key: "c", p: [e.cx, e.cy] }, { key: "r", p: keyPoints(e).c0 }];
    case "slot":
      return [{ key: "c", p: [e.cx, e.cy] }, { key: "end", p: keyPoints(e).e1 }];
    case "point":
      return [{ key: "p", p: e.p }];
    case "ellipse":
      return [{ key: "c", p: [e.cx, e.cy] }, { key: "rx", p: keyPoints(e).q0 }, { key: "ry", p: keyPoints(e).q1 }];
  }
}

function applyHandle(e: SketchEntity, key: string, p: Vec2): SketchEntity {
  switch (e.type) {
    case "line":
    case "arc":
      return { ...e, [key]: p } as SketchEntity;
    case "polyline":
    case "spline": {
      const i = Number(key.slice(1));
      return { ...e, points: e.points.map((q, k) => (k === i ? p : q)) };
    }
    case "point":
      return { ...e, p };
    case "circle":
      return key === "c" ? { ...e, cx: p[0], cy: p[1] } : { ...e, r: r4(Math.max(0.01, dist([e.cx, e.cy], p))) };
    case "rect": {
      if (key === "c") return { ...e, cx: p[0], cy: p[1] };
      const t = (-e.angle * Math.PI) / 180;
      const v = sub(p, [e.cx, e.cy]);
      const lx = v[0] * Math.cos(t) - v[1] * Math.sin(t);
      const ly = v[0] * Math.sin(t) + v[1] * Math.cos(t);
      return { ...e, w: r4(Math.max(0.01, Math.abs(lx) * 2)), h: r4(Math.max(0.01, Math.abs(ly) * 2)) };
    }
    case "polygon":
      return key === "c" ? { ...e, cx: p[0], cy: p[1] } : { ...e, r: r4(Math.max(0.01, dist([e.cx, e.cy], p))), angle: r4(angDeg([e.cx, e.cy], p) - 90) };
    case "slot":
      return key === "c" ? { ...e, cx: p[0], cy: p[1] } : { ...e, length: r4(Math.max(e.width, dist([e.cx, e.cy], p) * 2 + e.width)), angle: r4(angDeg([e.cx, e.cy], p)) };
    case "ellipse": {
      if (key === "c") return { ...e, cx: p[0], cy: p[1] };
      if (key === "rx") return { ...e, rx: r4(Math.max(0.01, dist([e.cx, e.cy], p))), angle: r4(angDeg([e.cx, e.cy], p)) };
      return { ...e, ry: r4(Math.max(0.01, dist([e.cx, e.cy], p))) };
    }
  }
}

/** Odkazy, které entita nabízí (pro mazání závislých vazeb). */
function cleanup(entities: SketchEntity[], cons: SketchConstraint[], dims: SketchDim[]) {
  const ids = new Set(entities.map((e) => e.id));
  return { constraints: cons.filter((c) => c.refs.every((r) => ids.has(r.e))), dims: dims.filter((d) => d.refs.every((r) => ids.has(r.e))) };
}

/** Odkaz na entitu podle nejbližšího primitiva (strana obdélníku, segment lomené čáry…). */
function entityRef(e: SketchEntity, q: Vec2): SketchRef {
  if (e.type === "line" || e.type === "circle" || e.type === "arc" || e.type === "ellipse" || e.type === "point") return { e: e.id, k: "self" };
  let best: Prim | null = null;
  let bd = Infinity;
  for (const p of prims(e)) {
    const d = dist(nearestOnPrim(p, q), q);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return { e: e.id, k: best?.part ?? "self" };
}

type Pick = { kind: "point"; ref: SketchRef; p: Vec2 } | { kind: "line"; ref: SketchRef } | { kind: "circle"; ref: SketchRef } | { kind: "entity"; ref: SketchRef };

/** Které vazby lze použít na danou sadu výběrů. */
function matchConstraint(type: ConType, picks: Pick[]): SketchRef[] | "more" | null {
  const pts = picks.filter((p) => p.kind === "point");
  const lines = picks.filter((p) => p.kind === "line");
  const circs = picks.filter((p) => p.kind === "circle");
  const n = picks.length;
  const R = (ps: Pick[]) => ps.map((p) => p.ref);
  switch (type) {
    case "horizontal":
    case "vertical":
      if (n === 1 && lines.length === 1) return R(lines);
      if (n === 2 && pts.length === 2) return R(pts);
      return n < 2 && (pts.length === n) ? "more" : null;
    case "coincident":
      if (pts.length === 2 && n === 2) return R(pts);
      return n < 2 && pts.length === n ? "more" : null;
    case "parallel":
    case "perpendicular":
    case "collinear":
      if (lines.length === 2 && n === 2) return R(lines);
      return n < 2 && lines.length === n ? "more" : null;
    case "tangent":
      if (n === 2 && lines.length + circs.length === 2 && circs.length >= 1) return R(picks);
      return n < 2 && lines.length + circs.length === n ? "more" : null;
    case "equal":
      if (n === 2 && (lines.length === 2 || circs.length === 2)) return R(picks);
      return n < 2 && lines.length + circs.length === n ? "more" : null;
    case "fixed":
      if (n === 1) return R(picks);
      return "more";
    case "concentric":
      if (n === 2 && circs.length + pts.length === 2 && circs.length >= 1) return R(picks);
      return n < 2 ? "more" : null;
    case "midpoint":
      if (n === 2 && pts.length === 1 && lines.length === 1) return [pts[0].ref, lines[0].ref];
      return n < 2 ? "more" : null;
    case "pointOnCurve":
      if (n === 2 && pts.length === 1 && lines.length + circs.length === 1) return [pts[0].ref, (lines[0] ?? circs[0]).ref];
      return n < 2 ? "more" : null;
    case "symmetric":
      if (n === 3 && pts.length === 2 && lines.length === 1) return [pts[0].ref, pts[1].ref, lines[0].ref];
      return n < 3 ? "more" : null;
  }
}

function pickOfEntity(e: SketchEntity, q: Vec2): Pick {
  const ref = entityRef(e, q);
  if (e.type === "point") return { kind: "point", ref: { e: e.id, k: "p" }, p: e.p };
  if (e.type === "line" || /^[gs]\d+$/.test(ref.k)) return { kind: "line", ref };
  if (e.type === "circle" || e.type === "arc") return { kind: "circle", ref };
  return { kind: "entity", ref };
}

// ======================= vrstva entit (memo – nevykresluje se při pohybu myši) =======================

const EntityLayer = memo(function EntityLayer({ paths, entities, sel, hover, conflictIds, k }: { paths: Map<string, { d: string; closed: boolean }>; entities: SketchEntity[]; sel: Set<string>; hover: string | null; conflictIds: Set<string>; k: number }) {
  return (
    <g>
      {entities.map((e) => {
        const p = paths.get(e.id);
        if (!p) return null;
        const isSel = sel.has(e.id);
        const isHover = hover === e.id && !isSel;
        const bad = conflictIds.has(e.id);
        if (e.type === "point")
          return <circle key={e.id} cx={e.p[0]} cy={e.p[1]} r={3.2 / k} fill={isSel ? "#E03930" : isHover ? "#f59e0b" : "#1f2933"} />;
        return (
          <path
            key={e.id}
            d={p.d}
            fill="none"
            stroke={isSel ? "#E03930" : isHover ? "#f59e0b" : bad ? "#c2410c" : e.construction ? "#7a8796" : "#1f2933"}
            strokeWidth={isSel || isHover ? 2.4 : 1.6}
            strokeDasharray={e.construction ? "7 3 1.5 3" : undefined}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        );
      })}
    </g>
  );
});

// ======================= hlavní komponenta =======================

type Ask = { label: string; value: number; suffix?: string; at: Vec2; onOk: (v: number) => void; key?: string };
type DragS =
  | { kind: "pan"; from: Vec2; view: { cx: number; cy: number; scale: number } }
  | { kind: "handle"; id: string; key: string }
  | { kind: "move"; ids: string[]; from: Vec2; orig: SketchEntity[] }
  | { kind: "box"; from: Vec2; to: Vec2 }
  | { kind: "dimLabel"; id: string; from: Vec2; orig: Vec2 };

type Snap = { p: Vec2; kind: SnapKind | "free"; ref?: SketchRef; hv?: "h" | "v" | null; guides?: [Vec2, Vec2][] };

/**
 * Profesionální 2D skicář: uchopování (OSNAP), vazby s numerickým řešičem, řídicí kóty,
 * editační nástroje, kontextové menu. Souřadnice v mm, osa Y nahoru.
 */
export function Sketcher({ sketch, onChange, selected, onSelect, tool, setTool, snapGrid, setSnapGrid, onFinish }: Props) {
  const entities = sketch.entities;
  const constraints = useMemo(() => sketch.constraints ?? [], [sketch.constraints]);
  const dims = useMemo(() => sketch.dims ?? [], [sketch.dims]);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState({ cx: 0, cy: 0, scale: 4 });
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [snapState, setSnapState] = useState<Snap | null>(null);
  const [pts, setPts] = useState<Vec2[]>([]);
  const [ptRefs, setPtRefs] = useState<(SketchRef | undefined)[]>([]);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [sel, setSel] = useState<Set<string>>(() => new Set(selected ? [selected] : []));
  const [selAnn, setSelAnn] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [hoverAnn, setHoverAnn] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; entries: RMenuEntry[] } | null>(null);
  const [snaps, setSnaps] = useState<SnapSettings>(defaultSnaps);
  const [phase, setPhase] = useState(0); // fáze nástrojů s výběrem
  const [flash, setFlash] = useState<string | null>(null);
  const [measureRes, setMeasureRes] = useState<{ title: string; rows: [string, string][]; line?: [Vec2, Vec2] } | null>(null);
  const [status, setStatus] = useState<{ dof: number; conflicts: string[] }>({ dof: -1, conflicts: [] });
  const drag = useRef<DragS | null>(null);
  const downAt = useRef<[number, number, number] | null>(null);
  const fitted = useRef(false);
  const lastVal = useRef<Record<string, number>>({ fillet: 5, chamfer: 2, offset: 5, count: 4, ccount: 6 });

  useEffect(() => setSnaps(loadSnaps()), []);
  const setSnap = (k: keyof SnapSettings, v: boolean) =>
    setSnaps((s) => {
      const n = { ...s, [k]: v };
      try {
        localStorage.setItem(SNAP_KEY, JSON.stringify(n));
      } catch {
        /* soukromý režim */
      }
      return n;
    });
  const note = (m: string) => {
    setFlash(m);
    setTimeout(() => setFlash((f) => (f === m ? null : f)), 3200);
  };

  // synchronizace výběru s rodičem (pravý panel vlastností)
  const setSelection = useCallback(
    (ids: string[]) => {
      setSel(new Set(ids));
      onSelect(ids.length ? ids[ids.length - 1] : null);
      if (ids.length) setSelAnn(null);
    },
    [onSelect],
  );
  useEffect(() => {
    if (selected && !sel.has(selected)) setSel(new Set([selected]));
    if (!selected && sel.size === 1) setSel(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  // velikost
  // změna velikosti (např. otevření panelu vlastností) nesmí kresbu posunout: drží se levý horní roh
  const prevSize = useRef<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = svgRef.current!;
    const ro = new ResizeObserver(() => {
      const n = { w: el.clientWidth, h: el.clientHeight };
      const p = prevSize.current;
      prevSize.current = n;
      setSize(n);
      if (p && fitted.current && (p.w !== n.w || p.h !== n.h)) setView((v) => ({ ...v, cx: v.cx + (n.w - p.w) / 2 / v.scale, cy: v.cy - (n.h - p.h) / 2 / v.scale }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // cesty entit (mm) – počítají se jen při změně entit
  const paths = useMemo(() => {
    const m = new Map<string, { d: string; closed: boolean; pts: Vec2[] }>();
    for (const e of entities) {
      const { pts: p, closed } = entityPath(e);
      if (!p.length) continue;
      m.set(e.id, { d: "M" + p.map((q) => `${q[0].toFixed(4)},${q[1].toFixed(4)}`).join("L") + (closed ? "Z" : ""), closed, pts: closed ? [...p, p[0]] : p });
    }
    return m;
  }, [entities]);
  const allPrims = useMemo(() => entities.flatMap((e) => prims(e)), [entities]);
  const keyPts = useMemo(() => {
    const out: { p: Vec2; kind: SnapKind; ref: SketchRef }[] = [];
    for (const e of entities) {
      const k = keyPoints(e);
      for (const [key, p] of Object.entries(k)) {
        const kind: SnapKind = key === "center" ? "center" : key === "mid" || /^m\d/.test(key) ? "mid" : /^q\d/.test(key) ? "quad" : "end";
        out.push({ p, kind, ref: { e: e.id, k: key } });
      }
      if (e.type === "arc") out.push({ p: e.b, kind: "near", ref: { e: e.id, k: "b" } });
      if (e.type === "polyline") e.points.slice(1).forEach((p, i) => out.push({ p: [(p[0] + e.points[i][0]) / 2, (p[1] + e.points[i][1]) / 2], kind: "mid", ref: { e: e.id, k: `g${i}` } }));
    }
    return out;
  }, [entities]);
  const inters = useMemo(() => (entities.length < 400 ? allIntersections(entities) : []), [entities]);

  // úvodní zaměření
  const fit = useCallback(() => {
    const all = [...paths.values()].flatMap((p) => p.pts);
    if (!all.length) return setView({ cx: 0, cy: 0, scale: Math.min(size.w, size.h) / 160 });
    const xs = all.map((p) => p[0]);
    const ys = all.map((p) => p[1]);
    const w = Math.max(...xs) - Math.min(...xs) || 50;
    const h = Math.max(...ys) - Math.min(...ys) || 50;
    setView({ cx: (Math.max(...xs) + Math.min(...xs)) / 2, cy: (Math.max(...ys) + Math.min(...ys)) / 2, scale: Math.min(size.w / (w * 1.5), size.h / (h * 1.5)) });
  }, [paths, size]);
  useEffect(() => {
    if (fitted.current || !size.w || size.w === 800) return;
    fitted.current = true;
    fit();
  }, [size, fit]);

  // změna nástroje: reset rozpracovaných kroků; nástroje s výběrem se provedou hned
  useEffect(() => {
    setPts([]);
    setPtRefs([]);
    setPicks([]);
    setPhase(0);
    setAsk(null);
    if (tool !== "measure") setMeasureRes(null);
    if (tool.startsWith("con-") && sel.size) applyConstraintToSelection(tool.slice(4) as ConType);
    if (tool === "explode" && sel.size) {
      doExplode([...sel]);
      setTool("select");
    }
    if (tool === "construction" && sel.size) {
      toggleConstruction([...sel]);
      setTool("select");
    }
    if (SEL_TOOLS.has(tool) && sel.size) setPhase(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  // stav určenosti (debounce)
  useEffect(() => {
    if (drag.current) return;
    const t = setTimeout(() => {
      const m = new Map(entities.map((e) => [e.id, e]));
      const conf = new Set<string>();
      for (const c of constraints) if (constraintResiduals(m, c).some((v) => Math.abs(v) > 1e-4)) conf.add(c.id);
      for (const d of dims) if (d.driving) {
        const v = measureDim(m, d);
        if (v != null && Math.abs(v - d.value) > 1e-4) conf.add(d.id);
      }
      setStatus({ dof: sketchDof(entities, constraints, dims), conflicts: [...conf] });
    }, 160);
    return () => clearTimeout(t);
  }, [entities, constraints, dims]);

  // ---------- souřadnice ----------
  const toMm = useCallback(
    (clientX: number, clientY: number): Vec2 => {
      const r = svgRef.current!.getBoundingClientRect();
      return [view.cx + (clientX - r.left - size.w / 2) / view.scale, view.cy - (clientY - r.top - size.h / 2) / view.scale];
    },
    [view, size],
  );
  const toPx = useCallback((p: Vec2): Vec2 => [size.w / 2 + (p[0] - view.cx) * view.scale, size.h / 2 - (p[1] - view.cy) * view.scale], [view, size]);
  const gridStep = niceStep(24 / view.scale);
  const tol = 10 / view.scale;

  // ---------- změny + řešič ----------
  const commitEdit = useCallback(
    (next: SketchEntity[], cons = constraints, dms = dims, commit = true, weights?: Record<string, number>, quick = false): boolean => {
      const cl = cleanup(next, cons, dms);
      if (!cl.constraints.length && !cl.dims.some((d) => d.driving)) {
        onChange({ entities: next, constraints: cl.constraints, dims: cl.dims }, commit);
        return true;
      }
      const res = solveSketch(next, cl.constraints, cl.dims, { weights, dof: !quick, maxIter: quick ? 25 : 60 });
      onChange({ entities: res.entities, constraints: cl.constraints, dims: cl.dims }, commit);
      return res.ok;
    },
    [constraints, dims, onChange],
  );

  const addEntities = (es: SketchEntity[], extraCons: SketchConstraint[] = []) => {
    commitEdit([...entities, ...es], [...constraints, ...extraCons], dims);
    // řetězové nástroje nevybírají (panel by se otevíral při každém segmentu)
    if (es.length && !["line", "centerline", "polyline", "spline"].includes(tool)) setSelection([es[es.length - 1].id]);
  };

  // ---------- uchopování ----------
  const computeSnap = (raw: Vec2, opts: { exclude?: Set<string>; from?: Vec2 | null } = {}): Snap => {
    const ex = opts.exclude;
    const H: { best: Snap | null; bd: number } = { best: null, bd: tol };
    const consider = (p: Vec2, kind: SnapKind, ref?: SketchRef) => {
      const d = dist(p, raw);
      if (d < H.bd) {
        H.bd = d;
        H.best = { p, kind, ref };
      }
    };
    if (snaps.origin) consider([0, 0], "origin");
    for (const k of keyPts) {
      if (ex?.has(k.ref.e)) continue;
      if (k.kind === "near") continue;
      if (snaps[k.kind]) consider(k.p, k.kind, k.ref);
    }
    if (snaps.int) for (const p of inters) consider(p, "int");
    if (H.best) return H.best;
    const from = opts.from;
    // kolmo / tečně od posledního bodu
    if (from) {
      for (const pr of allPrims) {
        if (ex?.has(pr.id)) continue;
        if (snaps.perp) {
          let foot: Vec2 | null = null;
          if (pr.kind === "line") {
            const d = sub(pr.b, pr.a);
            const t = ((from[0] - pr.a[0]) * d[0] + (from[1] - pr.a[1]) * d[1]) / (d[0] * d[0] + d[1] * d[1] || 1e-12);
            if (t > 0 && t < 1) foot = addv(pr.a, mulv(d, t));
          } else {
            const v = sub(from, pr.c);
            const L = Math.hypot(...v);
            if (L > 1e-9) foot = addv(pr.c, mulv(v, pr.r / L));
          }
          if (foot && dist(foot, from) > 1e-6) consider(foot, "perp", { e: pr.id, k: "self" });
        }
        if (snaps.tan && pr.kind === "arc") {
          const v = sub(from, pr.c);
          const L = Math.hypot(...v);
          if (L > pr.r) {
            const base = Math.atan2(v[1], v[0]);
            const off = Math.acos(pr.r / L);
            for (const a of [base + off, base - off]) consider([pr.c[0] + pr.r * Math.cos(a), pr.c[1] + pr.r * Math.sin(a)], "tan", { e: pr.id, k: "self" });
          }
        }
      }
      if (H.best) return H.best;
    }
    // zarovnání (inference) vodorovně/svisle ke klíčovým bodům a k poslednímu bodu
    let q: Vec2 = raw;
    let kind: Snap["kind"] = "free";
    if (snapGrid && snaps.grid) {
      q = [Math.round(raw[0] / gridStep) * gridStep, Math.round(raw[1] / gridStep) * gridStep];
      kind = "grid";
    }
    const guides: [Vec2, Vec2][] = [];
    let hv: "h" | "v" | null = null;
    if (snaps.infer) {
      const ptol = 6 / view.scale;
      const cand = [...(from ? [from] : []), ...keyPts.filter((k) => !ex?.has(k.ref.e) && k.kind !== "near").map((k) => k.p).slice(0, 600)];
      let bx = ptol;
      let by = ptol;
      let gx: Vec2 | null = null;
      let gy: Vec2 | null = null;
      for (const c of cand) {
        if (Math.abs(raw[0] - c[0]) < bx) {
          bx = Math.abs(raw[0] - c[0]);
          gx = c;
        }
        if (Math.abs(raw[1] - c[1]) < by) {
          by = Math.abs(raw[1] - c[1]);
          gy = c;
        }
      }
      if (gx) {
        q = [gx[0], q[1]];
        guides.push([gx, [gx[0], q[1]]]);
        if (from && gx === from) hv = "v";
      }
      if (gy) {
        q = [q[0], gy[1]];
        guides.push([gy, [q[0], gy[1]]]);
        if (from && gy === from) hv = hv ? null : "h";
      }
      if (guides.length) kind = kind === "grid" ? "grid" : "free";
    }
    // na křivce (nejnižší priorita)
    if (snaps.near && !guides.length) {
      const N: { nb: number; np: Snap | null } = { nb: tol * 0.7, np: null };
      for (const pr of allPrims) {
        if (ex?.has(pr.id)) continue;
        const p = nearestOnPrim(pr, raw);
        const d = dist(p, raw);
        if (d < N.nb) {
          N.nb = d;
          N.np = { p, kind: "near", ref: { e: pr.id, k: "self" } };
        }
      }
      if (N.np) return N.np;
    }
    return { p: R4(q), kind, hv, guides };
  };

  // ---------- zásahy ----------
  const hitEntity = (p: Vec2, exclude?: Set<string>): string | null => {
    let best: string | null = null;
    let bd = 9 / view.scale;
    for (const e of entities) {
      if (exclude?.has(e.id)) continue;
      const d = distToEntity(e, p).d;
      if (d < bd) {
        bd = d;
        best = e.id;
      }
    }
    return best;
  };

  // anotace (vazby, kóty) – polohy v px se počítají při vykreslení a uloží pro zásah
  const annHits = useRef<{ id: string; x: number; y: number; w: number; h: number; kind: "con" | "dim" }[]>([]);
  const hitAnn = (clientX: number, clientY: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    const x = clientX - r.left;
    const y = clientY - r.top;
    return annHits.current.find((a) => x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.h) ?? null;
  };

  /** výběr pro kóty/vazby: bod jen u koncových bodů, středů a průsečíků; jinak celá entita */
  const POINT_PICK = new Set<Snap["kind"]>(["end", "center", "origin"]);
  const pickAt = (raw: Vec2): Pick | null => {
    const s = computeSnap(raw);
    if (s.ref && POINT_PICK.has(s.kind)) return { kind: "point", ref: s.ref, p: s.p };
    const id = hitEntity(raw);
    if (!id) return null;
    return pickOfEntity(entities.find((e) => e.id === id)!, raw);
  };

  // ---------- operace ----------
  const deleteSel = () => {
    if (selAnn) {
      onChange({ constraints: constraints.filter((c) => c.id !== selAnn), dims: dims.filter((d) => d.id !== selAnn) }, true);
      setSelAnn(null);
      return;
    }
    if (!sel.size) return;
    commitEdit(entities.filter((x) => !sel.has(x.id)));
    setSelection([]);
  };
  const toggleConstruction = (ids: string[]) => {
    const on = !entities.find((e) => e.id === ids[0])?.construction;
    commitEdit(entities.map((e) => (ids.includes(e.id) ? ({ ...e, construction: on } as SketchEntity) : e)));
  };
  const doExplode = (ids: string[]) => {
    const out: SketchEntity[] = [];
    for (const e of entities) out.push(...(ids.includes(e.id) ? explode(e) : [e]));
    commitEdit(out);
    setSelection([]);
  };
  const applyConstraint = (type: ConType, refs: SketchRef[]): boolean => {
    const c: SketchConstraint = { id: uid(), type, refs };
    if (type === "fixed") {
      const m = new Map(entities.map((e) => [e.id, e]));
      const r0 = refs[0];
      if (r0.k === "self" && entities.find((e) => e.id === r0.e)?.type !== "point") c.value = paramsOf(m.get(r0.e)!);
      else {
        const p = refPoint(m, r0.k === "self" ? { e: r0.e, k: "p" } : r0);
        if (!p) return false;
        c.refs = [r0.k === "self" ? { e: r0.e, k: "p" } : r0];
        c.value = [...p];
      }
    }
    const res = solveSketch(entities, [...constraints, c], dims);
    if (!res.ok) {
      note(`Vazbu „${CON_INFO[type].label}“ nelze přidat – je v konfliktu s jinými vazbami/kótami.`);
      return false;
    }
    onChange({ entities: res.entities, constraints: [...constraints, c], dims }, true);
    return true;
  };
  const applyConstraintToSelection = (type: ConType) => {
    const es = [...sel].map((id) => entities.find((e) => e.id === id)).filter(Boolean) as SketchEntity[];
    const pk = es.map((e) => pickOfEntity(e, keyPoints(e).mid ?? keyPoints(e).center ?? entityPath(e).pts[0] ?? [0, 0]));
    const m = matchConstraint(type, pk);
    if (Array.isArray(m)) {
      if (applyConstraint(type, m)) note(`Vazba „${CON_INFO[type].label}“ přidána.`);
      setTool("select");
    } else if (es.length === 1 && es[0].type === "line" && type === "fixed") {
      applyConstraint(type, [{ e: es[0].id, k: "self" }]);
      setTool("select");
    }
  };

  /** Vloží kótu: změří aktuální hodnotu, zeptá se na novou. */
  const placeDim = (type: SketchDim["type"], refs: SketchRef[], at: Vec2, anchor: Vec2) => {
    const m = new Map(entities.map((e) => [e.id, e]));
    const d: SketchDim = { id: uid(), type, refs, value: 0, driving: true, offset: sub(at, anchor) };
    const v = measureDim(m, d);
    if (v == null) return note("Tuto kombinaci nelze okótovat.");
    d.value = r4(v);
    const nextDims = [...dims, d];
    onChange({ dims: nextDims }, true);
    setAsk({
      label: type === "angle" ? "Úhel" : type === "radius" ? "Poloměr" : type === "diameter" ? "Průměr" : "Vzdálenost",
      value: d.value,
      suffix: type === "angle" ? "°" : "mm",
      at,
      onOk: (val) => setDimValue(d.id, val, nextDims),
    });
  };
  const setDimValue = (id: string, val: number, list = dims) => {
    const next = list.map((d) => (d.id === id ? { ...d, value: val, driving: true } : d));
    const res = solveSketch(entities, constraints, next);
    if (!res.ok) {
      note("Kóta by skicu přeurčila – ponechána jako referenční.");
      onChange({ dims: list.map((d) => (d.id === id ? { ...d, driving: false } : d)) }, true);
      return;
    }
    onChange({ entities: res.entities, constraints, dims: next }, true);
  };

  // ---------- kreslení: kliknutí ----------
  const lastAuto = (p: Snap, entityId: string, key: string): SketchConstraint[] => {
    if (!snaps.auto || !p.ref) return [];
    const me: SketchRef = { e: entityId, k: key };
    if (p.kind === "end" || p.kind === "center" || p.kind === "quad") return [{ id: uid(), type: "coincident", refs: [p.ref, me] }];
    if (p.kind === "mid" && entities.find((e) => e.id === p.ref!.e)?.type === "line") return [{ id: uid(), type: "midpoint", refs: [me, { e: p.ref.e, k: "self" }] }];
    if (p.kind === "near") {
      const t = entities.find((e) => e.id === p.ref!.e)?.type;
      if (t === "line" || t === "circle" || t === "arc") return [{ id: uid(), type: "pointOnCurve", refs: [me, p.ref] }];
    }
    return [];
  };

  const toolClick = (raw: Vec2, ev: React.PointerEvent) => {
    const from = pts.length ? pts[pts.length - 1] : null;
    const s = computeSnap(raw, { from });
    const p = s.p;
    const next = [...pts, p];
    const nextRefs = [...ptRefs, s.ref ? (s as Snap).ref : undefined];
    const autoFor = (id: string, key: string, idx: number): SketchConstraint[] => {
      const snapAt = idx === next.length - 1 ? s : null;
      if (snapAt) return lastAuto(snapAt, id, key);
      const rf = nextRefs[idx];
      return rf && snaps.auto ? [{ id: uid(), type: "coincident", refs: [rf, { e: id, k: key }] }] : [];
    };
    switch (tool) {
      case "line":
      case "centerline": {
        if (!pts.length) {
          setPts([p]);
          setPtRefs([s.ref]);
          return;
        }
        const a = pts[pts.length - 1];
        if (dist(a, p) < 1e-6) return;
        const id = uid();
        const cons: SketchConstraint[] = [...autoFor(id, "a", next.length - 2), ...autoFor(id, "b", next.length - 1)];
        // navázání na předchozí úsečku řetězu
        if (snaps.auto && s.hv) cons.push({ id: uid(), type: s.hv === "h" ? "horizontal" : "vertical", refs: [{ e: id, k: "self" }] });
        else if (snaps.auto && Math.abs(a[1] - p[1]) < 1e-9) cons.push({ id: uid(), type: "horizontal", refs: [{ e: id, k: "self" }] });
        else if (snaps.auto && Math.abs(a[0] - p[0]) < 1e-9) cons.push({ id: uid(), type: "vertical", refs: [{ e: id, k: "self" }] });
        const line: SketchEntity = { id, type: "line", a, b: p, construction: tool === "centerline" || undefined };
        addEntities([line], cons);
        if (tool === "centerline" || (pts.length > 1 && dist(p, pts[0]) < 1e-6)) {
          setPts([]);
          setPtRefs([]);
          return;
        }
        setPts([...pts, p]);
        setPtRefs([...ptRefs.slice(0, -1), ptRefs[ptRefs.length - 1], { e: id, k: "b" }]);
        return;
      }
      case "polyline":
      case "spline": {
        if (pts.length >= 2 && dist(p, pts[0]) < tol) return finishPoly(true);
        setPts(next);
        setPtRefs(nextRefs);
        if (ev.detail >= 2) finishPoly(false, next);
        return;
      }
      case "point": {
        const id = uid();
        addEntities([{ id, type: "point", p }], lastAuto(s, id, "p"));
        return;
      }
      case "rect":
      case "rectCenter": {
        if (next.length < 2) return setPts(next);
        const [a] = next;
        if (Math.abs(a[0] - p[0]) < 1e-6 || Math.abs(a[1] - p[1]) < 1e-6) return;
        const e: SketchEntity =
          tool === "rect"
            ? { id: uid(), type: "rect", cx: r4((a[0] + p[0]) / 2), cy: r4((a[1] + p[1]) / 2), w: r4(Math.abs(p[0] - a[0])), h: r4(Math.abs(p[1] - a[1])), r: 0, angle: 0 }
            : { id: uid(), type: "rect", cx: a[0], cy: a[1], w: r4(Math.abs(p[0] - a[0]) * 2), h: r4(Math.abs(p[1] - a[1]) * 2), r: 0, angle: 0 };
        addEntities([e], tool === "rectCenter" && nextRefs[0] && snaps.auto ? [{ id: uid(), type: "coincident", refs: [nextRefs[0]!, { e: e.id, k: "center" }] }] : []);
        setPts([]);
        setPtRefs([]);
        return;
      }
      case "circle": {
        if (next.length < 2) {
          setPts(next);
          setPtRefs(nextRefs);
          return;
        }
        if (dist(next[0], p) < 1e-6) return;
        const id = uid();
        addEntities([{ id, type: "circle", cx: next[0][0], cy: next[0][1], r: r4(dist(next[0], p)) }], nextRefs[0] && snaps.auto ? [{ id: uid(), type: "coincident", refs: [nextRefs[0]!, { e: id, k: "center" }] }] : []);
        setPts([]);
        setPtRefs([]);
        return;
      }
      case "circle3": {
        if (next.length < 3) return setPts(next);
        const cc = circleFrom3(next[0], next[1], p);
        if (!cc) return note("Body leží na přímce.");
        addEntities([{ id: uid(), type: "circle", cx: r4(cc.c[0]), cy: r4(cc.c[1]), r: r4(cc.r) }]);
        setPts([]);
        return;
      }
      case "arc": {
        if (next.length < 3) {
          setPts(next);
          setPtRefs(nextRefs);
          return;
        }
        if (!circleFrom3(next[0], p, next[1])) return;
        const id = uid();
        addEntities([{ id, type: "arc", a: next[0], b: p, c: next[1] }], [...(nextRefs[0] && snaps.auto ? [{ id: uid(), type: "coincident" as const, refs: [nextRefs[0]!, { e: id, k: "a" }] }] : []), ...(nextRefs[1] && snaps.auto ? [{ id: uid(), type: "coincident" as const, refs: [nextRefs[1]!, { e: id, k: "c" }] }] : [])]);
        setPts([]);
        setPtRefs([]);
        return;
      }
      case "arcCenter": {
        if (next.length < 3) return setPts(next);
        const arc = arcFromCenter(next[0], next[1], p);
        if (arc) addEntities([arc]);
        setPts([]);
        return;
      }
      case "arcTangent": {
        if (!pts.length) {
          if (!s.ref || s.kind !== "end") return note("Začněte na konci úsečky nebo oblouku.");
          setPts([p]);
          setPtRefs([s.ref]);
          return;
        }
        const arc = tangentArc(entities, ptRefs[0], pts[0], p);
        if (!arc) return note("Tečný oblouk nelze vytvořit.");
        const cons: SketchConstraint[] = [];
        if (ptRefs[0] && snaps.auto) {
          cons.push({ id: uid(), type: "coincident", refs: [ptRefs[0], { e: arc.id, k: "a" }] });
          cons.push({ id: uid(), type: "tangent", refs: [{ e: ptRefs[0].e, k: "self" }, { e: arc.id, k: "self" }] });
        }
        addEntities([arc], entities.find((e) => e.id === ptRefs[0]?.e)?.type === "line" ? cons : cons.slice(0, 1));
        setPts([]);
        setPtRefs([]);
        return;
      }
      case "ellipse": {
        if (next.length < 3) return setPts(next);
        const [c, a] = next;
        const rx = dist(c, a);
        const ang = angDeg(c, a);
        const t = (ang * Math.PI) / 180;
        const ry = Math.abs(-(p[0] - c[0]) * Math.sin(t) + (p[1] - c[1]) * Math.cos(t));
        if (rx < 1e-6 || ry < 1e-6) return;
        addEntities([{ id: uid(), type: "ellipse", cx: c[0], cy: c[1], rx: r4(rx), ry: r4(ry), angle: r4(ang) }]);
        setPts([]);
        return;
      }
      case "polygon": {
        if (next.length < 2) return setPts(next);
        addEntities([{ id: uid(), type: "polygon", cx: next[0][0], cy: next[0][1], r: r4(dist(next[0], p)), sides: 6, angle: r4(angDeg(next[0], p) - 90) }]);
        setPts([]);
        return;
      }
      case "slot": {
        if (next.length < 3) return setPts(next);
        const [a, b] = next;
        const len = dist(a, b);
        const dx = (b[0] - a[0]) / (len || 1);
        const dy = (b[1] - a[1]) / (len || 1);
        const w = Math.abs((p[0] - a[0]) * -dy + (p[1] - a[1]) * dx) * 2 || 10;
        addEntities([{ id: uid(), type: "slot", cx: r4((a[0] + b[0]) / 2), cy: r4((a[1] + b[1]) / 2), length: r4(len + w), width: r4(w), angle: r4(angDeg(a, b)) }]);
        setPts([]);
        return;
      }
    }
  };

  const finishPoly = (closed: boolean, list = pts) => {
    if (list.length >= 2) {
      const id = uid();
      const e: SketchEntity = tool === "spline" ? { id, type: "spline", points: list, closed } : { id, type: "polyline", points: list, closed: closed && list.length >= 3 };
      addEntities([e]);
    }
    setPts([]);
    setPtRefs([]);
  };

  // ---------- editační nástroje: kliknutí ----------
  const editClick = (raw: Vec2, ev: React.PointerEvent) => {
    const id = hitEntity(raw);
    const e = id ? entities.find((x) => x.id === id) : undefined;
    switch (tool) {
      case "trim": {
        if (!id) return;
        const r = trim(entities, id, raw);
        if (r) commitEdit(r);
        return;
      }
      case "extend": {
        if (!id) return;
        const r = extend(entities, id, raw);
        if (r) commitEdit(r);
        else note("Úsečku nelze k ničemu prodloužit.");
        return;
      }
      case "offset": {
        if (!picks.length) {
          if (!e) return;
          setPicks([{ kind: "entity", ref: { e: e.id, k: "self" } }]);
          return;
        }
        const src = entities.find((x) => x.id === picks[0].ref.e);
        if (!src) return;
        const d = distToEntity(src, raw).d * offsetSide(src, raw);
        const o = offsetEntity(src, r4(d));
        if (o) addEntities([o]);
        setPicks([]);
        return;
      }
      case "fillet":
      case "chamfer": {
        if (!e || e.type !== "line") return note("Vyberte úsečku.");
        if (!picks.length) return setPicks([{ kind: "line", ref: { e: e.id, k: "self" } }]);
        if (picks[0].ref.e === e.id) return;
        const id1 = picks[0].ref.e;
        setAsk({
          label: tool === "fillet" ? "Poloměr" : "Vzdálenost",
          value: lastVal.current[tool],
          at: raw,
          onOk: (v) => {
            lastVal.current[tool] = v;
            const r = tool === "fillet" ? filletLines(entities, id1, e.id, v) : chamferLines(entities, id1, e.id, v);
            if (!r) return note("Roh nelze upravit (hodnota je příliš velká nebo úsečky jsou rovnoběžné).");
            // vazby rohu nahradit: totožnost konců s novou entitou (+ tečnost u zaoblení)
            const added = r.find((x) => !entities.some((o) => o.id === x.id))!;
            const l1 = r.find((x) => x.id === id1) as Extract<SketchEntity, { type: "line" }>;
            const l2 = r.find((x) => x.id === e.id) as Extract<SketchEntity, { type: "line" }>;
            const ends = added.type === "arc" ? [added.a, added.c] : added.type === "line" ? [added.a, added.b] : [];
            const keyNear = (l: Extract<SketchEntity, { type: "line" }>, p: Vec2) => (dist(l.a, p) < dist(l.b, p) ? "a" : "b");
            const nk = added.type === "arc" ? ["a", "c"] : ["a", "b"];
            const cons = constraints.filter((c) => !(c.type === "coincident" && c.refs.every((rf) => rf.e === id1 || rf.e === e.id)));
            cons.push({ id: uid(), type: "coincident", refs: [{ e: id1, k: keyNear(l1, ends[0]) }, { e: added.id, k: nk[0] }] });
            cons.push({ id: uid(), type: "coincident", refs: [{ e: e.id, k: keyNear(l2, ends[1]) }, { e: added.id, k: nk[1] }] });
            if (added.type === "arc") cons.push({ id: uid(), type: "tangent", refs: [{ e: id1, k: "self" }, { e: added.id, k: "self" }] }, { id: uid(), type: "tangent", refs: [{ e: e.id, k: "self" }, { e: added.id, k: "self" }] });
            commitEdit(r, snaps.auto ? cons : constraints.filter((c) => !(c.type === "coincident" && c.refs.every((rf) => rf.e === id1 || rf.e === e.id))));
          },
        });
        setPicks([]);
        return;
      }
      case "dimension":
        return dimClick(raw);
      case "measure":
        return measureClick(raw);
    }
    if (tool.startsWith("con-")) {
      const pk = pickAt(raw);
      if (!pk) return;
      const all = [...picks, pk];
      const m = matchConstraint(tool.slice(4) as ConType, all);
      if (m === "more") return setPicks(all);
      if (!m) {
        setPicks([]);
        return note(`Vazba „${CON_INFO[tool.slice(4) as ConType].label}“: ${CON_INFO[tool.slice(4) as ConType].hint}.`);
      }
      applyConstraint(tool.slice(4) as ConType, m);
      setPicks([]);
      return;
    }
    if (SEL_TOOLS.has(tool)) return selToolClick(raw, ev);
  };

  const selToolClick = (raw: Vec2, ev: React.PointerEvent) => {
    if (phase === 0) {
      const id = hitEntity(raw);
      if (id) setSelection(sel.has(id) ? [...sel].filter((x) => x !== id) : [...sel, id]);
      return;
    }
    const ids = [...sel];
    const chosen = entities.filter((e) => sel.has(e.id));
    const s = computeSnap(raw, { exclude: new Set(ids), from: pts[pts.length - 1] ?? null });
    const p = s.p;
    switch (tool) {
      case "mirror": {
        const id = hitEntity(raw, new Set(ids));
        const ax = id ? entities.find((x) => x.id === id) : undefined;
        if (!ax || ax.type !== "line") return note("Klikněte na úsečku nebo osu zrcadlení.");
        const T = xfMirror(ax.a, ax.b);
        const copies = chosen.map((x) => transformEntity(x, T, true));
        const sym: SketchConstraint[] = [];
        addEntities(copies, sym);
        setTool("select");
        return;
      }
      case "move":
      case "copy": {
        if (!pts.length) return setPts([p]);
        const T = xfMove(sub(p, pts[0]));
        if (tool === "move") commitEdit(entities.map((x) => (sel.has(x.id) ? transformEntity(x, T) : x)));
        else addEntities(chosen.map((x) => transformEntity(x, T, true)));
        if (tool === "copy" && ev.shiftKey) return;
        setTool("select");
        return;
      }
      case "rotate":
      case "scale": {
        if (pts.length < 2) return setPts([...pts, p]);
        const [c, r0] = pts;
        if (tool === "rotate") commitEdit(entities.map((x) => (sel.has(x.id) ? transformEntity(x, xfRotate(c, angDeg(c, p) - angDeg(c, r0))) : x)));
        else {
          const k = dist(c, p) / (dist(c, r0) || 1);
          if (k > 1e-6) commitEdit(entities.map((x) => (sel.has(x.id) ? transformEntity(x, xfScale(c, k)) : x)));
        }
        setTool("select");
        return;
      }
      case "patternLinear": {
        if (!pts.length) return setPts([p]);
        const step = sub(p, pts[0]);
        setAsk({
          label: "Počet kusů",
          value: lastVal.current.count,
          suffix: "ks",
          at: raw,
          onOk: (v) => {
            lastVal.current.count = Math.max(2, Math.round(v));
            addEntities(linearPattern(chosen, step, Math.max(2, Math.round(v))));
            setTool("select");
          },
        });
        return;
      }
      case "patternCircular": {
        setAsk({
          label: "Počet kusů (360°)",
          value: lastVal.current.ccount,
          suffix: "ks",
          at: raw,
          onOk: (v) => {
            lastVal.current.ccount = Math.max(2, Math.round(v));
            addEntities(circularPattern(chosen, p, Math.max(2, Math.round(v))));
            setTool("select");
          },
        });
        return;
      }
    }
  };

  /** Kóta z vybraných entit/bodů a polohy popisku (pro umístění i náhled). */
  const dimFromPicks = (ps: Pick[], at: Vec2): { type: SketchDim["type"]; refs: SketchRef[]; anchor: Vec2 } | null => {
    const m = new Map(entities.map((x) => [x.id, x]));
    const [a, b] = ps;
    if (ps.length === 1) {
      if (a.kind === "circle") {
        const c = refCircle(m, a.ref);
        return c ? { type: m.get(a.ref.e)?.type === "arc" ? "radius" : "diameter", refs: [a.ref], anchor: c.c } : null;
      }
      if (a.kind === "line") {
        const l = refLine(m, a.ref);
        return l ? { type: "length", refs: [a.ref], anchor: [(l[0][0] + l[1][0]) / 2, (l[0][1] + l[1][1]) / 2] } : null;
      }
      return null;
    }
    if (a.kind === "line" && b.kind === "line") {
      const la = refLine(m, a.ref);
      const lb = refLine(m, b.ref);
      if (!la || !lb) return null;
      const ang = angleBetween(la[0], la[1], lb[0], lb[1]);
      return { type: ang < 0.01 || ang > 179.99 ? "distance" : "angle", refs: [a.ref, b.ref], anchor: la[0] };
    }
    if (a.kind === "point" && b.kind === "point") {
      const [pa, pb] = [a.p, b.p];
      const [minx, maxx, miny, maxy] = [Math.min(pa[0], pb[0]), Math.max(pa[0], pb[0]), Math.min(pa[1], pb[1]), Math.max(pa[1], pb[1])];
      const type: SketchDim["type"] = at[0] > minx && at[0] < maxx && (at[1] > maxy || at[1] < miny) ? "horizontal" : at[1] > miny && at[1] < maxy && (at[0] > maxx || at[0] < minx) ? "vertical" : "distance";
      return { type, refs: [a.ref, b.ref], anchor: [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2] };
    }
    const pt = a.kind === "point" ? a : b.kind === "point" ? b : null;
    const ln = a.kind === "line" ? a : b.kind === "line" ? b : null;
    if (pt?.kind === "point" && ln) return { type: "distance", refs: [pt.ref, ln.ref], anchor: pt.p };
    return null;
  };

  const dimClick = (raw: Vec2) => {
    if (!picks.length) {
      const pk = pickAt(raw);
      if (pk && pk.kind !== "entity") setPicks([pk]);
      return;
    }
    // druhý výběr (jiná entita / bod), nebo umístění kóty
    if (picks.length === 1 && picks[0].kind !== "circle") {
      const pk = pickAt(raw);
      if (pk && pk.kind !== "entity" && pk.kind !== "circle" && !(pk.ref.e === picks[0].ref.e && pk.ref.k === picks[0].ref.k)) {
        setPicks([picks[0], pk]);
        return;
      }
      if (picks[0].kind === "point") return note("Vyberte druhý bod nebo úsečku.");
    }
    const d = dimFromPicks(picks, raw);
    if (d) placeDim(d.type, d.refs, raw, d.anchor);
    else note("Tuto kombinaci nelze okótovat.");
    setPicks([]);
  };

  const measureClick = (raw: Vec2) => {
    const pk = pickAt(raw);
    if (!pk) return;
    const all = picks.length >= 2 ? [pk] : [...picks, pk];
    setPicks(all);
    setMeasureRes(measureOf(all));
  };
  const measureOf = (ps: Pick[]): typeof measureRes => {
    const m = new Map(entities.map((x) => [x.id, x]));
    if (ps.length === 1) {
      const p = ps[0];
      if (p.kind === "point") return { title: "Bod", rows: [["X", fmt(p.p[0], 3)], ["Y", fmt(p.p[1], 3)]] };
      if (p.kind === "line") {
        const l = refLine(m, p.ref)!;
        return { title: "Úsečka", rows: [["Délka", `${fmt(dist(l[0], l[1]), 3)} mm`], ["Úhel k ose X", `${fmt(((angDeg(l[0], l[1]) % 360) + 360) % 360, 2)}°`]] };
      }
      if (p.kind === "circle") {
        const c = refCircle(m, p.ref)!;
        return { title: "Kružnice / oblouk", rows: [["Poloměr", `${fmt(c.r, 3)} mm`], ["Průměr", `${fmt(c.r * 2, 3)} mm`], ["Obvod", `${fmt(2 * Math.PI * c.r, 3)} mm`], ["Střed", `${fmt(c.c[0], 2)} ; ${fmt(c.c[1], 2)}`]] };
      }
      return { title: "Entita", rows: [] };
    }
    const [a, b] = ps;
    const P = (x: Pick): Vec2 | null => (x.kind === "point" ? x.p : null);
    const pa = P(a);
    const pb = P(b);
    if (pa && pb) return { title: "Vzdálenost bodů", line: [pa, pb], rows: [["Vzdálenost", `${fmt(dist(pa, pb), 3)} mm`], ["ΔX", fmt(Math.abs(pb[0] - pa[0]), 3)], ["ΔY", fmt(Math.abs(pb[1] - pa[1]), 3)], ["Úhel", `${fmt(angDeg(pa, pb), 2)}°`]] };
    if (a.kind === "line" && b.kind === "line") {
      const la = refLine(m, a.ref)!;
      const lb = refLine(m, b.ref)!;
      const ang = angleBetween(la[0], la[1], lb[0], lb[1]);
      const rows: [string, string][] = [["Úhel", `${fmt(ang, 3)}° (${fmt(180 - ang, 3)}°)`]];
      if (ang < 0.01 || ang > 179.99) rows.push(["Vzdálenost (rovnoběžné)", `${fmt(distToEntity(m.get(a.ref.e)!, lb[0]).d, 3)} mm`]);
      return { title: "Dvě úsečky", rows };
    }
    const pt = pa ?? pb;
    const other = pa ? b : a;
    if (pt) {
      const r = distToEntity(m.get(other.ref.e)!, pt);
      return { title: "Bod – entita", line: [pt, r.p], rows: [["Nejmenší vzdálenost", `${fmt(r.d, 3)} mm`]] };
    }
    const ca = refCircle(m, a.ref);
    const cb = refCircle(m, b.ref);
    if (ca && cb) return { title: "Dvě kružnice", line: [ca.c, cb.c], rows: [["Vzdálenost středů", `${fmt(dist(ca.c, cb.c), 3)} mm`], ["Mezera", `${fmt(dist(ca.c, cb.c) - ca.r - cb.r, 3)} mm`]] };
    return { title: "Měření", rows: [] };
  };

  // ---------- myš ----------
  const onPointerDown = (ev: React.PointerEvent) => {
    if (ask) setAsk(null); // klik mimo zadávací pole = ponechat aktuální hodnotu
    (ev.target as Element).setPointerCapture?.(ev.pointerId);
    downAt.current = [ev.clientX, ev.clientY, ev.button];
    const raw = toMm(ev.clientX, ev.clientY);
    if (ev.button === 1 || ev.button === 2) {
      drag.current = { kind: "pan", from: [ev.clientX, ev.clientY], view };
      return;
    }
    if (tool !== "select") return;
    const ann = hitAnn(ev.clientX, ev.clientY);
    if (ann) {
      setSelAnn(ann.id);
      setSelection([]);
      setSelAnn(ann.id);
      const d = dims.find((x) => x.id === ann.id);
      if (d) drag.current = { kind: "dimLabel", id: d.id, from: raw, orig: d.offset ?? [0, 0] };
      return;
    }
    // úchyt vybrané entity
    for (const id of sel) {
      const e = entities.find((x) => x.id === id);
      if (!e) continue;
      const h = handlesOf(e).find((hh) => dist(hh.p, raw) * view.scale < 8);
      if (h) {
        drag.current = { kind: "handle", id, key: h.key };
        return;
      }
    }
    const id = hitEntity(raw);
    if (id) {
      const multi = ev.shiftKey || ev.ctrlKey || ev.metaKey;
      const ids = multi ? (sel.has(id) ? [...sel].filter((x) => x !== id) : [...sel, id]) : sel.has(id) ? [...sel] : [id];
      setSelection(ids);
      setSelAnn(null);
      drag.current = { kind: "move", ids, from: raw, orig: entities.filter((e) => ids.includes(e.id)) };
      return;
    }
    setSelAnn(null);
    drag.current = { kind: "box", from: raw, to: raw };
  };

  const onPointerMove = (ev: React.PointerEvent) => {
    const raw = toMm(ev.clientX, ev.clientY);
    const d = drag.current;
    if (d?.kind === "pan") {
      setView({ ...d.view, cx: d.view.cx - (ev.clientX - d.from[0]) / view.scale, cy: d.view.cy + (ev.clientY - d.from[1]) / view.scale });
      return;
    }
    if (d?.kind === "box") {
      drag.current = { ...d, to: raw };
      setCursor(raw);
      return;
    }
    if (d?.kind === "dimLabel") {
      onChange({ dims: dims.map((x) => (x.id === d.id ? { ...x, offset: addv(d.orig, sub(raw, d.from)) } : x)) }, false);
      return;
    }
    if (d?.kind === "handle") {
      const s = computeSnap(raw, { exclude: new Set([d.id]) });
      setSnapState(s);
      setCursor(s.p);
      const next = entities.map((e) => (e.id === d.id ? applyHandle(e, d.key, s.p) : e));
      commitEdit(next, constraints, dims, false, { [d.id]: 1 }, true);
      return;
    }
    if (d?.kind === "move") {
      let delta: Vec2 = sub(raw, d.from);
      if (snapGrid && snaps.grid) delta = [Math.round(delta[0] / gridStep) * gridStep, Math.round(delta[1] / gridStep) * gridStep];
      const moved = new Map(d.orig.map((e) => [e.id, transformEntity(e, xfMove(delta))]));
      const w = Object.fromEntries(d.ids.map((i) => [i, 1]));
      commitEdit(entities.map((e) => moved.get(e.id) ?? e), constraints, dims, false, w, true);
      return;
    }
    // bez tažení: uchopení + zvýraznění
    const from = pts.length ? pts[pts.length - 1] : null;
    const drawTool = !["select", "trim", "extend", "offset", "fillet", "chamfer", "dimension", "measure", "mirror", "construction", "explode"].includes(tool) && !tool.startsWith("con-") && !(SEL_TOOLS.has(tool) && phase === 0);
    if (drawTool || tool === "dimension" || tool === "measure" || tool.startsWith("con-")) {
      const s = computeSnap(raw, { from: drawTool ? from : null, exclude: SEL_TOOLS.has(tool) ? sel : undefined });
      setSnapState(s);
      setCursor(s.p);
    } else {
      setSnapState(null);
      setCursor(raw);
    }
    const ann = tool === "select" ? hitAnn(ev.clientX, ev.clientY) : null;
    setHoverAnn(ann?.id ?? null);
    setHover(ann ? null : hitEntity(raw));
  };

  const onPointerUp = (ev: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    const dn = downAt.current;
    downAt.current = null;
    const clicked = dn && Math.hypot(ev.clientX - dn[0], ev.clientY - dn[1]) < 4;
    if (dn && dn[2] === 2 && clicked) return openContext(ev);
    if (d?.kind === "box") {
      const [a, b] = [d.from, d.to];
      if (dist(a, b) * view.scale > 4) {
        const crossing = b[0] < a[0];
        const [x0, x1, y0, y1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[1], b[1])];
        const inside = (p: Vec2) => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1;
        const ids = entities
          .filter((e) => {
            const p = paths.get(e.id)?.pts ?? [];
            return crossing ? p.some(inside) : p.length > 0 && p.every(inside);
          })
          .map((e) => e.id);
        setSelection(ev.shiftKey ? [...new Set([...sel, ...ids])] : ids);
      } else if (!ev.shiftKey) setSelection([]);
      setCursor(null);
      return;
    }
    if (d?.kind === "handle" || d?.kind === "move") {
      commitEdit(entities, constraints, dims, true);
      return;
    }
    if (d?.kind === "dimLabel") {
      onChange({ dims }, true);
      return;
    }
    if (!clicked || !dn || dn[2] !== 0 || tool === "select") return;
    const raw = toMm(ev.clientX, ev.clientY);
    const isEdit = ["trim", "extend", "offset", "fillet", "chamfer", "dimension", "measure"].includes(tool) || tool.startsWith("con-") || SEL_TOOLS.has(tool);
    if (isEdit) editClick(raw, ev);
    else toolClick(raw, ev);
  };

  const onDoubleClick = (ev: React.MouseEvent) => {
    if (tool === "polyline" || tool === "spline") return finishPoly(false);
    const ann = hitAnn(ev.clientX, ev.clientY);
    const d = ann ? dims.find((x) => x.id === ann.id) : null;
    if (d) {
      const m = new Map(entities.map((x) => [x.id, x]));
      setAsk({ label: "Hodnota kóty", value: r4(measureDim(m, d) ?? d.value), suffix: d.type === "angle" ? "°" : "mm", at: toMm(ev.clientX, ev.clientY), onOk: (v) => setDimValue(d.id, v) });
    }
  };

  const onWheel = (ev: React.WheelEvent) => {
    const before = toMm(ev.clientX, ev.clientY);
    const k = Math.exp(-ev.deltaY * 0.0015);
    const scale = Math.min(800, Math.max(0.01, view.scale * k));
    const r = svgRef.current!.getBoundingClientRect();
    setView({ scale, cx: before[0] - (ev.clientX - r.left - size.w / 2) / scale, cy: before[1] + (ev.clientY - r.top - size.h / 2) / scale });
  };

  // ---------- kontextové menu ----------
  const openContext = (ev: React.PointerEvent) => {
    const raw = toMm(ev.clientX, ev.clientY);
    if (tool !== "select" && (pts.length || picks.length)) {
      // pravé tlačítko ukončí rozpracovaný krok (jako v ZW3D)
      if (tool === "polyline" || tool === "spline") finishPoly(false);
      setPts([]);
      setPtRefs([]);
      setPicks([]);
      return;
    }
    if (SEL_TOOLS.has(tool) && phase === 0 && sel.size) {
      if (tool === "explode") {
        doExplode([...sel]);
        setTool("select");
      } else if (tool === "construction") {
        toggleConstruction([...sel]);
        setTool("select");
      } else setPhase(1);
      return;
    }
    const ann = hitAnn(ev.clientX, ev.clientY);
    const id = ann ? null : hitEntity(raw);
    let current = [...sel];
    if (id && !sel.has(id)) {
      current = [id];
      setSelection(current);
    }
    const entries: RMenuEntry[] = [];
    if (ann) {
      const d = dims.find((x) => x.id === ann.id);
      setSelAnn(ann.id);
      if (d) {
        entries.push({ divider: true, label: "Kóta" });
        entries.push({ id: "edit", label: "Upravit hodnotu…", icon: "edit", onClick: () => setAsk({ label: "Hodnota kóty", value: d.value, suffix: d.type === "angle" ? "°" : "mm", at: raw, onOk: (v) => setDimValue(d.id, v) }) });
        entries.push({ id: "drv", label: d.driving ? "Změnit na referenční" : "Změnit na řídicí", icon: "dimension", onClick: () => (d.driving ? onChange({ dims: dims.map((x) => (x.id === d.id ? { ...x, driving: false } : x)) }, true) : setDimValue(d.id, measureDim(new Map(entities.map((x) => [x.id, x])), d) ?? d.value)) });
      } else entries.push({ divider: true, label: `Vazba: ${CON_INFO[constraints.find((c) => c.id === ann.id)?.type ?? "fixed"].label}` });
      entries.push({ id: "del", label: "Smazat", icon: "trash", tone: "cut", kbd: "Del", onClick: () => onChange({ constraints: constraints.filter((c) => c.id !== ann.id), dims: dims.filter((x) => x.id !== ann.id) }, true) });
    } else if (current.length) {
      const es = entities.filter((e) => current.includes(e.id));
      const pk = es.map((e) => pickOfEntity(e, raw));
      entries.push({ divider: true, label: es.length === 1 ? TYPE_LABEL[es[0].type] : `${es.length} entit` });
      entries.push({ id: "del", label: "Smazat", icon: "trash", tone: "cut", kbd: "Del", onClick: () => { commitEdit(entities.filter((x) => !current.includes(x.id))); setSelection([]); } });
      entries.push({ id: "cons", label: es[0].construction ? "Normální geometrie" : "Pomocná geometrie", icon: "construction", onClick: () => toggleConstruction(current) });
      entries.push({ id: "copy", label: "Kopírovat…", icon: "copy", onClick: () => setTool("copy") });
      entries.push({ id: "move", label: "Přesunout…", icon: "move", onClick: () => setTool("move") });
      entries.push({ id: "rot", label: "Otočit…", icon: "rotate", onClick: () => setTool("rotate") });
      entries.push({ id: "mir", label: "Zrcadlit…", icon: "mirror", onClick: () => setTool("mirror") });
      entries.push({ id: "sc", label: "Měřítko…", icon: "scale", onClick: () => setTool("scale") });
      if (es.length === 1) entries.push({ id: "off", label: "Odsadit…", icon: "offset", onClick: () => { setTool("offset"); setTimeout(() => setPicks([{ kind: "entity", ref: { e: es[0].id, k: "self" } }]), 0); } });
      if (es.some((e) => ["rect", "polygon", "slot", "polyline"].includes(e.type))) entries.push({ id: "exp", label: "Rozložit na úsečky a oblouky", icon: "explode", onClick: () => doExplode(current) });
      entries.push({ id: "dim", label: "Okótovat", icon: "dimension", onClick: () => setTool("dimension") });
      const applicable = (Object.keys(CON_INFO) as ConType[]).filter((t) => Array.isArray(matchConstraint(t, pk)));
      if (applicable.length) {
        entries.push({ divider: true, label: "Vazby" });
        for (const t of applicable) entries.push({ id: `c-${t}`, label: CON_INFO[t].label, icon: CON_INFO[t].icon, tone: "pattern", onClick: () => { const m = matchConstraint(t, pk); if (Array.isArray(m)) applyConstraint(t, m); } });
      }
    } else {
      entries.push({ divider: true, label: "Uchopování" });
      const on = (v: boolean, l: string) => `${v ? "✓" : "○"}  ${l}`;
      for (const k of SNAP_ORDER) entries.push({ id: `s-${k}`, label: on(snaps[k], SNAP_LABEL[k]), icon: "magnet", onClick: () => setSnap(k, !snaps[k]) });
      entries.push({ id: "s-infer", label: on(snaps.infer, "Zarovnání (vodítka)"), icon: "magnet", onClick: () => setSnap("infer", !snaps.infer) });
      entries.push({ id: "s-auto", label: on(snaps.auto, "Automatické vazby"), icon: "cCoincident", onClick: () => setSnap("auto", !snaps.auto) });
      if (setSnapGrid) entries.push({ id: "grid", label: on(snapGrid, "Přichytit k mřížce"), icon: "grid", kbd: "G", onClick: () => setSnapGrid(!snapGrid) });
      entries.push({ divider: true });
      entries.push({ id: "fit", label: "Zobrazit vše", icon: "fit", kbd: "F", onClick: fit });
      entries.push({ id: "all", label: "Vybrat vše", icon: "select", kbd: "Ctrl+A", onClick: () => setSelection(entities.map((e) => e.id)) });
      if (tool !== "select") entries.push({ id: "cancel", label: "Zrušit příkaz", icon: "x", kbd: "Esc", onClick: () => setTool("select") });
      if (onFinish) entries.push({ id: "finish", label: "Dokončit skicu", icon: "check", tone: "pattern", onClick: onFinish });
    }
    setCtx({ x: ev.clientX, y: ev.clientY, entries });
  };

  // ---------- klávesy ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input,textarea,select")) return;
      if (ask) return;
      if (e.key === "Escape") {
        if (pts.length || picks.length) {
          setPts([]);
          setPtRefs([]);
          setPicks([]);
        } else if (tool !== "select") setTool("select");
        else {
          setSelection([]);
          setSelAnn(null);
        }
        return;
      }
      if (e.key === "Enter") {
        if (tool === "polyline" || tool === "spline") return finishPoly(false);
        if (SEL_TOOLS.has(tool) && phase === 0 && sel.size) {
          if (tool === "explode") {
            doExplode([...sel]);
            setTool("select");
          } else if (tool === "construction") {
            toggleConstruction([...sel]);
            setTool("select");
          } else setPhase(1);
        }
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSel();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelection(entities.map((x) => x.id));
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "f") return fit();
      if (k === "g" && setSnapGrid) return setSnapGrid(!snapGrid);
      if (k === "h" && sel.size) return applyConstraintToSelection("horizontal");
      if (KEYS[k]) setTool(KEYS[k]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ======================= vykreslení =======================
  const { loops, openCount } = useMemo(() => findLoops(entities), [entities]);
  const fillPath = useMemo(() => loops.map((l) => "M" + loopPolygon(l).map((p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`).join("L") + "Z").join(" "), [loops]);
  const conflictSet = useMemo(() => new Set(status.conflicts), [status.conflicts]);
  const conflictEntities = useMemo(() => {
    const s = new Set<string>();
    for (const c of constraints) if (conflictSet.has(c.id)) c.refs.forEach((r) => s.add(r.e));
    for (const d of dims) if (conflictSet.has(d.id)) d.refs.forEach((r) => s.add(r.e));
    return s;
  }, [constraints, dims, conflictSet]);

  // mřížka (px)
  const gridLines: React.ReactNode[] = [];
  const x0 = view.cx - size.w / 2 / view.scale;
  const x1 = view.cx + size.w / 2 / view.scale;
  const y0 = view.cy - size.h / 2 / view.scale;
  const y1 = view.cy + size.h / 2 / view.scale;
  for (let x = Math.ceil(x0 / gridStep) * gridStep; x <= x1; x += gridStep) {
    const major = Math.abs(Math.round(x / gridStep) % 5) === 0;
    const px = toPx([x, 0])[0];
    gridLines.push(<line key={"x" + x} x1={px} x2={px} y1={0} y2={size.h} stroke={major ? "#d9e1ea" : "#edf1f5"} strokeWidth={1} />);
  }
  for (let y = Math.ceil(y0 / gridStep) * gridStep; y <= y1; y += gridStep) {
    const major = Math.abs(Math.round(y / gridStep) % 5) === 0;
    const py = toPx([0, y])[1];
    gridLines.push(<line key={"y" + y} y1={py} y2={py} x1={0} x2={size.w} stroke={major ? "#d9e1ea" : "#edf1f5"} strokeWidth={1} />);
  }
  const o = toPx([0, 0]);
  const T = `matrix(${view.scale},0,0,${-view.scale},${size.w / 2 - view.cx * view.scale},${size.h / 2 + view.cy * view.scale})`;
  const P = (p: Vec2) => toPx(p).map((v) => v.toFixed(1)).join(",");

  // anotace
  const annNodes: React.ReactNode[] = [];
  const hits: typeof annHits.current = [];
  const emap = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);
  {
    const stack = new Map<string, number>();
    for (const c of constraints) {
      const r0 = c.refs[0];
      if (!r0) continue;
      let anchor: Vec2 | null = null;
      const l = refLine(emap, r0);
      const pt = refPoint(emap, r0.k === "self" ? { e: r0.e, k: emap.get(r0.e)?.type === "point" ? "p" : "center" } : r0);
      const ci = refCircle(emap, r0);
      if (l) anchor = [(l[0][0] + l[1][0]) / 2, (l[0][1] + l[1][1]) / 2];
      else if (ci && r0.k === "self") anchor = [ci.c[0], ci.c[1] + ci.r];
      else anchor = pt;
      if (!anchor) continue;
      const key = `${anchor[0].toFixed(2)},${anchor[1].toFixed(2)}`;
      const n = stack.get(key) ?? 0;
      stack.set(key, n + 1);
      const [ax, ay] = toPx(anchor);
      const x = ax + 8 + n * 17;
      const y = ay - 22;
      const bad = conflictSet.has(c.id);
      const isSel = selAnn === c.id;
      const isHov = hoverAnn === c.id;
      hits.push({ id: c.id, x, y, w: 15, h: 15, kind: "con" });
      annNodes.push(
        <g key={c.id}>
          <title>{CON_INFO[c.type].label}</title>
          <rect x={x} y={y} width={15} height={15} rx={3} fill={bad ? "#fee2e2" : isSel ? "#E03930" : isHov ? "#fde68a" : "#e8f5ec"} stroke={bad ? "#dc2626" : isSel ? "#E03930" : "#16a34a"} strokeWidth={1} />
          <text x={x + 7.5} y={y + 11} textAnchor="middle" fontSize={9.5} fontWeight={700} fill={isSel ? "#fff" : bad ? "#b91c1c" : "#15803d"} fontFamily="Roboto, Arial">
            {CON_INFO[c.type].glyph}
          </text>
        </g>,
      );
    }
    for (const d of dims) {
      const node = renderDim(d, emap, toPx, view.scale, selAnn === d.id || hoverAnn === d.id, conflictSet.has(d.id));
      if (!node) continue;
      hits.push({ id: d.id, ...node.box, kind: "dim" });
      annNodes.push(<g key={d.id}>{node.el}</g>);
    }
  }
  annHits.current = hits;

  // náhled nástroje
  const preview = (() => {
    const c = cursor;
    if (!c) return null;
    const stroke = { fill: "none", stroke: "#2563eb", strokeWidth: 1.5, strokeDasharray: "5 4" } as const;
    const label = (p: Vec2, s: string) => {
      const [x, y] = toPx(p);
      return (
        <g>
          <rect x={x + 12} y={y + 10} width={s.length * 6.6 + 12} height={19} rx={4} fill="#1f2933" opacity={0.92} />
          <text x={x + 18} y={y + 23} fill="#fff" fontSize={11} fontFamily="ui-monospace,monospace">
            {s}
          </text>
        </g>
      );
    };
    const ghost = (es: SketchEntity[]) => es.map((e) => <polyline key={e.id} points={entityPath(e).pts.map(P).join(" ")} {...stroke} />);
    if (SEL_TOOLS.has(tool) && phase === 1) {
      const chosen = entities.filter((e) => sel.has(e.id));
      if ((tool === "move" || tool === "copy") && pts.length) return <g>{ghost(chosen.map((e) => transformEntity(e, xfMove(sub(c, pts[0])), true)))}{label(c, `Δ ${fmt(c[0] - pts[0][0])} ; ${fmt(c[1] - pts[0][1])}`)}</g>;
      if (tool === "rotate" && pts.length === 2) {
        const a = angDeg(pts[0], c) - angDeg(pts[0], pts[1]);
        return <g>{ghost(chosen.map((e) => transformEntity(e, xfRotate(pts[0], a), true)))}{label(c, `${fmt(a)}°`)}</g>;
      }
      if (tool === "scale" && pts.length === 2) {
        const k = dist(pts[0], c) / (dist(pts[0], pts[1]) || 1);
        return <g>{ghost(chosen.map((e) => transformEntity(e, xfScale(pts[0], k), true)))}{label(c, `× ${fmt(k, 3)}`)}</g>;
      }
      if (tool === "patternLinear" && pts.length) return <g>{ghost(linearPattern(chosen, sub(c, pts[0]), lastVal.current.count))}{label(c, `krok ${fmt(dist(pts[0], c))} mm`)}</g>;
      if (tool === "patternCircular") return <g>{ghost(circularPattern(chosen, c, lastVal.current.ccount))}</g>;
      if (tool === "mirror") {
        const id = hitEntity(c, sel);
        const ax = id ? entities.find((x) => x.id === id) : undefined;
        if (ax?.type === "line") return <g>{ghost(chosen.map((e) => transformEntity(e, xfMirror(ax.a, ax.b), true)))}</g>;
      }
      return null;
    }
    if (tool === "offset" && picks.length) {
      const src = entities.find((x) => x.id === picks[0].ref.e);
      if (!src) return null;
      const d = distToEntity(src, c).d * offsetSide(src, c);
      const o2 = offsetEntity(src, d);
      return o2 ? <g>{ghost([o2])}{label(c, `${fmt(Math.abs(d))} mm`)}</g> : null;
    }
    if (tool === "dimension" && picks.length && !(picks.length === 1 && picks[0].kind === "point")) {
      const d = dimFromPicks(picks, c);
      if (d) {
        const tmp: SketchDim = { id: "_preview", type: d.type, refs: d.refs, value: 0, driving: false, offset: sub(c, d.anchor) };
        const node = renderDim(tmp, emap, toPx, view.scale, true, false);
        if (node) return <g opacity={0.75}>{node.el}</g>;
      }
      return null;
    }
    if (tool === "measure" && measureRes?.line) {
      const [a, b] = measureRes.line;
      return <polyline points={[a, b].map(P).join(" ")} {...stroke} stroke="#9333ea" />;
    }
    if (!pts.length) return null;
    const last = pts[pts.length - 1];
    switch (tool) {
      case "line":
      case "centerline":
        return (
          <g>
            <polyline points={[last, c].map(P).join(" ")} {...stroke} />
            {label(c, `${fmt(dist(last, c))} mm · ${fmt(((angDeg(last, c) % 360) + 360) % 360)}°`)}
          </g>
        );
      case "polyline":
        return <polyline points={[...pts, c].map(P).join(" ")} {...stroke} />;
      case "spline":
        return <polyline points={entityPath({ id: "_", type: "spline", points: [...pts, c], closed: false }).pts.map(P).join(" ")} {...stroke} />;
      case "rect":
      case "rectCenter": {
        const a = pts[0];
        const q: Vec2 = tool === "rect" ? a : [2 * a[0] - c[0], 2 * a[1] - c[1]];
        return (
          <g>
            <polygon points={[q, [c[0], q[1]] as Vec2, c, [q[0], c[1]] as Vec2].map(P).join(" ")} {...stroke} fill="rgba(37,99,235,.05)" />
            {label(c, `${fmt(Math.abs(c[0] - q[0]))} × ${fmt(Math.abs(c[1] - q[1]))}`)}
          </g>
        );
      }
      case "circle":
      case "polygon": {
        const r = dist(pts[0], c);
        const [cx, cy] = toPx(pts[0]);
        return (
          <g>
            <circle cx={cx} cy={cy} r={r * view.scale} {...stroke} fill="rgba(37,99,235,.05)" />
            <line x1={cx} y1={cy} x2={toPx(c)[0]} y2={toPx(c)[1]} stroke="#2563eb" strokeDasharray="2 3" />
            {label(c, tool === "circle" ? `Ø ${fmt(r * 2)}` : `R ${fmt(r)}`)}
          </g>
        );
      }
      case "circle3": {
        if (pts.length < 2) return <polyline points={[...pts, c].map(P).join(" ")} {...stroke} />;
        const cc = circleFrom3(pts[0], pts[1], c);
        if (!cc) return null;
        const [cx, cy] = toPx(cc.c);
        return <g><circle cx={cx} cy={cy} r={cc.r * view.scale} {...stroke} />{label(c, `Ø ${fmt(cc.r * 2)}`)}</g>;
      }
      case "arc": {
        if (pts.length === 1) return <polyline points={[pts[0], c].map(P).join(" ")} {...stroke} />;
        const cc = circleFrom3(pts[0], c, pts[1]);
        return (
          <g>
            <polyline points={entityPath({ id: "_", type: "arc", a: pts[0], b: c, c: pts[1] }).pts.map(P).join(" ")} {...stroke} />
            {cc && label(c, `R ${fmt(cc.r)}`)}
          </g>
        );
      }
      case "arcCenter": {
        if (pts.length === 1) return <g><polyline points={[pts[0], c].map(P).join(" ")} {...stroke} />{label(c, `R ${fmt(dist(pts[0], c))}`)}</g>;
        const a = arcFromCenter(pts[0], pts[1], c);
        return a ? <polyline points={entityPath(a).pts.map(P).join(" ")} {...stroke} /> : null;
      }
      case "arcTangent": {
        const a = tangentArc(entities, ptRefs[0], pts[0], c);
        return a ? <g><polyline points={entityPath(a).pts.map(P).join(" ")} {...stroke} />{label(c, `R ${fmt(circleFrom3(a.a, a.b, a.c)?.r ?? 0)}`)}</g> : null;
      }
      case "ellipse": {
        if (pts.length === 1) return <polyline points={[pts[0], c].map(P).join(" ")} {...stroke} />;
        const [ce, a] = pts;
        const t = (angDeg(ce, a) * Math.PI) / 180;
        const ry = Math.abs(-(c[0] - ce[0]) * Math.sin(t) + (c[1] - ce[1]) * Math.cos(t));
        return <polygon points={entityPath({ id: "_", type: "ellipse", cx: ce[0], cy: ce[1], rx: dist(ce, a), ry: Math.max(ry, 0.01), angle: angDeg(ce, a) }).pts.map(P).join(" ")} {...stroke} />;
      }
      case "slot":
        return <polyline points={[...pts, c].map(P).join(" ")} {...stroke} />;
    }
    return null;
  })();

  // vybraný prvek – úchyty
  const handles = [...sel].flatMap((id) => {
    const e = entities.find((x) => x.id === id);
    return e && tool === "select" ? handlesOf(e).map((h) => ({ ...h, id })) : [];
  });

  const box = drag.current?.kind === "box" ? drag.current : null;
  const snapGlyph = snapState && cursor && tool !== "select" && snapState.kind !== "free" ? snapState : null;

  const prompt = promptFor(tool, pts.length, picks.length, phase, sel.size);
  const dofText = status.conflicts.length ? `Konflikt (${status.conflicts.length})` : status.dof === 0 ? "Plně určeno" : status.dof > 0 ? `Zbývá ${status.dof} st. volnosti` : "…";

  return (
    <div className="absolute inset-0 select-none" onContextMenu={(e) => e.preventDefault()}>
      <svg
        ref={svgRef}
        className="h-full w-full"
        style={{ cursor: tool === "select" ? (hover || hoverAnn ? "pointer" : "default") : "crosshair", background: "#fbfcfd" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          setCursor(null);
          setHover(null);
        }}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
      >
        {gridLines}
        <line x1={o[0]} x2={o[0] + 60} y1={o[1]} y2={o[1]} stroke="#E03930" strokeWidth={1.5} />
        <line x1={o[0]} x2={o[0]} y1={o[1]} y2={o[1] - 60} stroke="#16a34a" strokeWidth={1.5} />
        <circle cx={o[0]} cy={o[1]} r={3} fill="#1f2933" />
        <g transform={T}>
          <path d={fillPath} fill="rgba(37,99,235,.07)" fillRule="evenodd" />
          <EntityLayer paths={paths} entities={entities} sel={sel} hover={hover} conflictIds={conflictEntities} k={view.scale} />
        </g>
        {/* koncové body úseček a oblouků */}
        {entities.flatMap((e) =>
          e.type === "line" || e.type === "arc" || e.type === "polyline" || e.type === "spline"
            ? (e.type === "polyline" || e.type === "spline" ? e.points : [e.a, e.type === "line" ? e.b : e.c]).map((p, i) => {
                const [x, y] = toPx(p);
                return <circle key={e.id + i} cx={x} cy={y} r={2.4} fill="#fff" stroke={e.construction ? "#7a8796" : "#1f2933"} strokeWidth={1.1} />;
              })
            : [],
        )}
        {annNodes}
        {handles.map((h) => {
          const [x, y] = toPx(h.p);
          return <rect key={h.id + h.key} x={x - 4.5} y={y - 4.5} width={9} height={9} rx={1.5} fill="#fff" stroke="#E03930" strokeWidth={1.6} />;
        })}
        {pts.map((p, i) => {
          const [x, y] = toPx(p);
          return <circle key={i} cx={x} cy={y} r={3.2} fill="#2563eb" />;
        })}
        {picks.map((p, i) => {
          if (p.kind === "point") {
            const [x, y] = toPx(p.p);
            return <circle key={"pk" + i} cx={x} cy={y} r={5} fill="none" stroke="#9333ea" strokeWidth={2} />;
          }
          const pp = paths.get(p.ref.e);
          return pp ? <polyline key={"pk" + i} points={pp.pts.map(P).join(" ")} fill="none" stroke="#9333ea" strokeWidth={3} opacity={0.6} /> : null;
        })}
        {preview}
        {snapState?.guides?.map(([a, b], i) => <line key={"g" + i} x1={toPx(a)[0]} y1={toPx(a)[1]} x2={toPx(b)[0]} y2={toPx(b)[1]} stroke="#0e7490" strokeDasharray="3 4" strokeWidth={1} />)}
        {snapGlyph && <SnapGlyph at={toPx(snapGlyph.p)} kind={snapGlyph.kind as SnapKind} />}
        {box && (
          <rect
            x={Math.min(toPx(box.from)[0], toPx(box.to)[0])}
            y={Math.min(toPx(box.from)[1], toPx(box.to)[1])}
            width={Math.abs(toPx(box.to)[0] - toPx(box.from)[0])}
            height={Math.abs(toPx(box.to)[1] - toPx(box.from)[1])}
            fill={box.to[0] < box.from[0] ? "rgba(22,163,74,.08)" : "rgba(37,99,235,.08)"}
            stroke={box.to[0] < box.from[0] ? "#16a34a" : "#2563eb"}
            strokeDasharray={box.to[0] < box.from[0] ? "5 3" : undefined}
          />
        )}
      </svg>

      {/* panel uchopení */}
      <div className="absolute left-3 top-3 flex items-center gap-0.5 rounded-md border border-[#cfd6de] bg-white/95 p-0.5 shadow-sm backdrop-blur" onPointerDown={(e) => e.stopPropagation()}>
        {SNAP_ORDER.map((k) => (
          <button
            key={k}
            type="button"
            title={`Uchopení: ${SNAP_LABEL[k]}`}
            onClick={() => setSnap(k, !snaps[k])}
            className={cn("grid h-6 w-6 place-items-center rounded", snaps[k] ? "bg-[#dbeafe] text-[#1d4ed8]" : "text-[#9aa5b1] hover:bg-[#eef2f6]")}
          >
            <svg viewBox="-8 -8 16 16" className="h-4 w-4">
              <GlyphShape kind={k} />
            </svg>
          </button>
        ))}
        <span className="mx-0.5 h-4 w-px bg-[#d5dbe2]" />
        <button type="button" title="Zarovnání (vodítka)" onClick={() => setSnap("infer", !snaps.infer)} className={cn("rounded px-1.5 text-[10.5px] font-semibold", snaps.infer ? "bg-[#cffafe] text-[#0e7490]" : "text-[#9aa5b1]")}>
          ⋯
        </button>
        <button type="button" title="Automatické vazby při kreslení" onClick={() => setSnap("auto", !snaps.auto)} className={cn("rounded px-1.5 text-[10.5px] font-semibold", snaps.auto ? "bg-[#dcfce7] text-[#15803d]" : "text-[#9aa5b1]")}>
          AV
        </button>
      </div>

      {/* výsledek měření */}
      {tool === "measure" && measureRes && (
        <div className="absolute right-3 top-3 w-60 rounded-md border border-[#cfd6de] bg-white/95 p-3 text-[12px] shadow-lg backdrop-blur">
          <p className="mb-1.5 flex items-center gap-1.5 font-semibold">
            <CadIcon name="measure" tone="tool" className="h-4 w-4" />
            {measureRes.title}
          </p>
          {measureRes.rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 border-b border-[#edf1f5] py-0.5 last:border-0">
              <span className="text-[#6b7785]">{k}</span>
              <span className="font-mono">{v}</span>
            </div>
          ))}
        </div>
      )}

      {/* zadání hodnoty */}
      {ask && <AskBox key={ask.key ?? `${ask.label}-${ask.at.join(",")}`} ask={ask} pos={toPx(ask.at)} close={() => setAsk(null)} />}

      {flash && <div className="pointer-events-none absolute left-1/2 top-14 -translate-x-1/2 rounded-md bg-[#1f2933] px-3 py-1.5 text-[12px] text-white shadow-lg">{flash}</div>}

      {/* výzva + stav */}
      <div className="pointer-events-none absolute bottom-3 left-3 right-3 flex flex-wrap items-center gap-1.5 font-mono text-[10.5px] text-[#26303b]">
        <span className="rounded border border-[#c9d1da] bg-white/90 px-2 py-0.5">
          X {cursor ? fmt(cursor[0]) : "—"} · Y {cursor ? fmt(cursor[1]) : "—"}
        </span>
        <span className="rounded border border-[#c9d1da] bg-white/90 px-2 py-0.5">mřížka {fmt(gridStep)}</span>
        <span className="rounded border border-[#c9d1da] bg-white/90 px-2 py-0.5">
          {loops.length} profil{loops.length === 1 ? "" : loops.length > 1 && loops.length < 5 ? "y" : "ů"}
          {openCount ? ` · ${openCount} otevř.` : ""}
        </span>
        <span className={cn("rounded border px-2 py-0.5", status.conflicts.length ? "border-red-300 bg-red-50 text-red-700" : status.dof === 0 ? "border-green-300 bg-green-50 text-green-700" : "border-[#c9d1da] bg-white/90")}>
          {dofText}
        </span>
        <span className="flex-1" />
        {prompt && <span className="rounded bg-[#2563eb] px-2.5 py-0.5 font-sans text-[11.5px] text-white shadow">{prompt}</span>}
      </div>

      {ctx && <ContextMenu x={ctx.x} y={ctx.y} entries={ctx.entries} close={() => setCtx(null)} />}
    </div>
  );
}

const TYPE_LABEL: Record<SketchEntity["type"], string> = { line: "Úsečka", arc: "Oblouk", rect: "Obdélník", circle: "Kružnice", polygon: "Mnohoúhelník", slot: "Drážka", polyline: "Lomená čára", point: "Bod", ellipse: "Elipsa", spline: "Spline" };

function promptFor(tool: SketchTool, n: number, picks: number, phase: number, selN: number): string {
  if (SEL_TOOLS.has(tool) && phase === 0) return selN ? `Vybráno ${selN} – Enter / pravé tl. pokračuje` : "Vyberte entity (Shift přidává), pak Enter";
  switch (tool) {
    case "select":
      return "";
    case "line":
    case "centerline":
      return n ? "Další bod · Esc / pravé tl. ukončí řetěz" : "Počáteční bod úsečky";
    case "polyline":
    case "spline":
      return n ? "Další bod · Enter / dvojklik ukončí · klik na 1. bod uzavře" : "První bod";
    case "rect":
      return n ? "Protější roh" : "První roh";
    case "rectCenter":
      return n ? "Roh" : "Střed obdélníku";
    case "circle":
      return n ? "Bod na kružnici (poloměr)" : "Střed kružnice";
    case "circle3":
      return `Bod ${n + 1} ze 3 na kružnici`;
    case "arc":
      return n === 0 ? "Začátek oblouku" : n === 1 ? "Konec oblouku" : "Bod na oblouku";
    case "arcCenter":
      return n === 0 ? "Střed" : n === 1 ? "Začátek (poloměr)" : "Konec (proti směru hodin)";
    case "arcTangent":
      return n ? "Konec tečného oblouku" : "Konec úsečky / oblouku, na který navázat";
    case "ellipse":
      return n === 0 ? "Střed elipsy" : n === 1 ? "Konec hlavní poloosy" : "Vedlejší poloosa";
    case "point":
      return "Umístěte bod";
    case "polygon":
      return n ? "Vrchol (opsaná kružnice)" : "Střed mnohoúhelníku";
    case "slot":
      return n === 0 ? "Střed prvního oblouku" : n === 1 ? "Střed druhého oblouku" : "Šířka drážky";
    case "trim":
      return "Klikněte na úsek k odstranění";
    case "extend":
      return "Klikněte u konce úsečky, která se má prodloužit";
    case "offset":
      return picks ? "Klikněte na stranu a vzdálenost odsazení" : "Vyberte entitu k odsazení";
    case "fillet":
    case "chamfer":
      return picks ? "Druhá úsečka" : "První úsečka";
    case "mirror":
      return "Klikněte na osu zrcadlení (úsečku)";
    case "move":
    case "copy":
      return n ? "Cílový bod" : "Základní bod";
    case "rotate":
      return n === 0 ? "Střed otáčení" : n === 1 ? "Referenční bod" : "Cílový směr";
    case "scale":
      return n === 0 ? "Střed měřítka" : n === 1 ? "Referenční bod" : "Nová poloha bodu";
    case "patternLinear":
      return n ? "Krok pole (vzdálenost a směr)" : "Základní bod";
    case "patternCircular":
      return "Střed kruhového pole";
    case "dimension":
      return picks ? "Druhá entita/bod, nebo umístění kóty" : "Klikněte na entitu nebo bod";
    case "measure":
      return "Klikněte na body nebo entity (2 výběry)";
    default:
      if (tool.startsWith("con-")) {
        const c = CON_INFO[tool.slice(4) as ConType];
        return `${c.label}: ${c.hint}${picks ? ` (vybráno ${picks})` : ""}`;
      }
      return "";
  }
}

// ======================= pomocné tvary =======================

function arcFromCenter(c: Vec2, s: Vec2, e: Vec2): SketchEntity | null {
  const r = dist(c, s);
  if (r < 1e-6) return null;
  const a0 = Math.atan2(s[1] - c[1], s[0] - c[0]);
  let a1 = Math.atan2(e[1] - c[1], e[0] - c[0]);
  while (a1 <= a0 + 1e-6) a1 += Math.PI * 2;
  const P = (t: number): Vec2 => R4([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]);
  return { id: uid(), type: "arc", a: R4(s), b: P((a0 + a1) / 2), c: P(a1) };
}

function tangentArc(entities: SketchEntity[], ref: SketchRef | undefined, s: Vec2, e: Vec2): Extract<SketchEntity, { type: "arc" }> | null {
  const src = ref ? entities.find((x) => x.id === ref.e) : undefined;
  let t: Vec2 | null = null;
  if (src?.type === "line") t = ref!.k === "b" ? sub(src.b, src.a) : sub(src.a, src.b);
  else if (src?.type === "arc") {
    const g = arcGeom(src.a, src.b, src.c);
    if (g) {
      const rr = sub(s, g.c);
      // tečna ve směru pokračování oblouku
      const ccwAtEnd = (ref!.k === "c") === (dist(src.a, [g.c[0] + g.r * Math.cos(g.a0), g.c[1] + g.r * Math.sin(g.a0)]) < 1e-6);
      t = ccwAtEnd ? [-rr[1], rr[0]] : [rr[1], -rr[0]];
    }
  }
  if (!t) return null;
  const tl = Math.hypot(...t);
  const u: Vec2 = [t[0] / tl, t[1] / tl];
  const n: Vec2 = [-u[1], u[0]];
  const v = sub(e, s);
  const den = 2 * (n[0] * v[0] + n[1] * v[1]);
  if (Math.abs(den) < 1e-9) return null;
  const k = (v[0] * v[0] + v[1] * v[1]) / den;
  const c = addv(s, mulv(n, k));
  const r = Math.abs(k);
  const a0 = Math.atan2(s[1] - c[1], s[0] - c[0]);
  let a1 = Math.atan2(e[1] - c[1], e[0] - c[0]);
  const ccw = k > 0;
  if (ccw) while (a1 <= a0) a1 += Math.PI * 2;
  else while (a1 >= a0) a1 -= Math.PI * 2;
  const m = (a0 + a1) / 2;
  return { id: uid(), type: "arc", a: R4(s), b: R4([c[0] + r * Math.cos(m), c[1] + r * Math.sin(m)]), c: R4(e) };
}

function GlyphShape({ kind }: { kind: SnapKind }) {
  const st = { fill: "none", stroke: "currentColor", strokeWidth: 1.6 } as const;
  switch (kind) {
    case "end":
      return <rect x={-5} y={-5} width={10} height={10} {...st} />;
    case "mid":
      return <path d="M0 -6L6 5H-6Z" {...st} />;
    case "center":
      return (
        <g {...st}>
          <circle r={5} />
          <path d="M-3 0H3M0 -3V3" />
        </g>
      );
    case "quad":
      return <path d="M0 -6L6 0L0 6L-6 0Z" {...st} />;
    case "int":
      return <path d="M-5 -5L5 5M5 -5L-5 5" {...st} />;
    case "near":
      return <path d="M-5 -5H5L-5 5H5Z" {...st} />;
    case "perp":
      return <path d="M-5 5H5M-2 5V-5M-2 1H2V5" {...st} />;
    case "tan":
      return (
        <g {...st}>
          <circle r={3.5} cy={1.5} />
          <path d="M-6 -2H6" />
        </g>
      );
    case "origin":
      return (
        <g {...st}>
          <rect x={-5} y={-5} width={10} height={10} />
          <circle r={1.6} fill="currentColor" />
        </g>
      );
    default:
      return <path d="M-5 0H5M0 -5V5" {...st} />;
  }
}

function SnapGlyph({ at, kind }: { at: Vec2; kind: SnapKind }) {
  return (
    <g transform={`translate(${at[0]},${at[1]})`} color="#0e7490" pointerEvents="none">
      <GlyphShape kind={kind} />
      <g transform="translate(10,-12)">
        <rect x={0} y={-10} width={SNAP_LABEL[kind].length * 6.2 + 10} height={15} rx={3} fill="#ecfeff" stroke="#0e7490" strokeWidth={0.8} />
        <text x={5} y={1} fontSize={10.5} fill="#0e7490" fontFamily="Roboto, Arial">
          {SNAP_LABEL[kind]}
        </text>
      </g>
    </g>
  );
}

function AskBox({ ask, pos, close }: { ask: Ask; pos: Vec2; close: () => void }) {
  const [v, setV] = useState(String(ask.value).replace(".", ","));
  const inp = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      inp.current?.focus();
      inp.current?.select();
    }, 0);
    return () => clearTimeout(t);
  }, []);
  const ok = () => {
    let n = NaN;
    try {
      n = evalExpr(v.replace(/,/g, "."));
    } catch {
      n = Number(v.replace(",", "."));
    }
    if (Number.isFinite(n)) {
      close();
      ask.onOk(n);
    }
  };
  return (
    <div className="absolute z-20 flex items-center gap-1.5 rounded-md border border-[#2563eb] bg-white p-1.5 shadow-xl" style={{ left: Math.max(4, pos[0] + 14), top: Math.max(4, pos[1] - 18) }} onPointerDown={(e) => e.stopPropagation()}>
      <span className="pl-1 text-[11px] font-semibold text-[#2563eb]">{ask.label}</span>
      <input
        ref={inp}
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") ok();
          if (e.key === "Escape") close();
        }}
        className="w-24 rounded border border-[#cfd6de] px-1.5 py-0.5 font-mono text-[12.5px] outline-none focus:border-[#2563eb]"
      />
      {ask.suffix && <span className="text-[11px] text-[#6b7785]">{ask.suffix}</span>}
      <button type="button" onClick={ok} className="rounded bg-[#2563eb] px-2 py-0.5 text-[11.5px] font-semibold text-white">
        OK
      </button>
    </div>
  );
}

// ======================= kóty =======================

function arrowHead(x: number, y: number, ux: number, uy: number, col: string, key: string) {
  const L = 8;
  const W = 2.8;
  return <path key={key} d={`M${x},${y}L${x + ux * L - uy * W},${y + uy * L + ux * W}L${x + ux * L + uy * W},${y + uy * L - ux * W}Z`} fill={col} />;
}

/** Vykreslení kóty v px; vrací prvky + obdélník popisku pro zásah. */
function renderDim(d: SketchDim, m: Map<string, SketchEntity>, toPx: (p: Vec2) => Vec2, scale: number, hot: boolean, bad: boolean): { el: React.ReactNode; box: { x: number; y: number; w: number; h: number } } | null {
  const v = measureDim(m, d);
  if (v == null) return null;
  const col = bad ? "#dc2626" : hot ? "#E03930" : d.driving ? "#1d4ed8" : "#6b7785";
  const txt = (d.type === "radius" ? "R" : d.type === "diameter" ? "Ø" : "") + fmt(d.driving ? d.value : v, 2) + (d.type === "angle" ? "°" : "");
  const label = d.driving ? txt : `(${txt})`;
  const off = d.offset ?? [0, 10];
  const els: React.ReactNode[] = [];
  let tp: Vec2;
  const line = (a: Vec2, b: Vec2, k: string, dash?: string) => els.push(<line key={k} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={col} strokeWidth={0.9} strokeDasharray={dash} />);
  if (d.type === "radius" || d.type === "diameter") {
    const c = refCircle(m, d.refs[0]);
    if (!c) return null;
    const dir = Math.hypot(...off) > 1e-9 ? off : [1, 1];
    const L = Math.hypot(dir[0], dir[1]);
    const u: Vec2 = [dir[0] / L, dir[1] / L];
    const onC = toPx([c.c[0] + u[0] * c.r, c.c[1] + u[1] * c.r]);
    const cpx = toPx(c.c);
    tp = toPx(addv(c.c, off));
    line(d.type === "diameter" ? toPx([c.c[0] - u[0] * c.r, c.c[1] - u[1] * c.r]) : cpx, tp, "l");
    const su: Vec2 = [onC[0] - cpx[0], onC[1] - cpx[1]];
    const sl = Math.hypot(...su) || 1;
    els.push(arrowHead(onC[0], onC[1], -su[0] / sl, -su[1] / sl, col, "a"));
  } else if (d.type === "angle") {
    const la = refLine(m, d.refs[0]);
    const lb = refLine(m, d.refs[1]);
    if (!la || !lb) return null;
    const x = intersectLines(la, lb) ?? la[0];
    const rad = Math.max(8 / scale, Math.hypot(...off));
    const a1 = Math.atan2(la[1][1] - la[0][1], la[1][0] - la[0][0]);
    const a2 = Math.atan2(lb[1][1] - lb[0][1], lb[1][0] - lb[0][0]);
    let s = a1;
    let e = a2;
    let sw = ((e - s) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    if (sw > Math.PI) {
      [s, e] = [e, s];
      sw = 2 * Math.PI - sw;
    }
    const pts: Vec2[] = Array.from({ length: 17 }, (_, i) => toPx([x[0] + rad * Math.cos(s + (sw * i) / 16), x[1] + rad * Math.sin(s + (sw * i) / 16)]));
    els.push(<polyline key="arc" points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke={col} strokeWidth={0.9} />);
    tp = toPx([x[0] + rad * 1.25 * Math.cos(s + sw / 2), x[1] + rad * 1.25 * Math.sin(s + sw / 2)]);
  } else {
    // lineární kóty: body p1, p2
    let p1: Vec2 | null = null;
    let p2: Vec2 | null = null;
    const [r0, r1] = d.refs;
    if (d.type === "length" || (d.type === "distance" && !r1)) {
      const l = refLine(m, r0);
      if (l) [p1, p2] = l;
    } else {
      const la = refLine(m, r0);
      const lb = r1 ? refLine(m, r1) : null;
      const pa = refPoint(m, r0);
      const pb = r1 ? refPoint(m, r1) : null;
      if (la && lb) {
        p1 = [(lb[0][0] + lb[1][0]) / 2, (lb[0][1] + lb[1][1]) / 2];
        p2 = footOn(p1, la);
      } else if (pa && lb && !la) {
        p1 = pa;
        p2 = footOn(pa, lb);
      } else if (pb && la && !lb) {
        p1 = pb;
        p2 = footOn(pb, la);
      } else if (pa && pb) {
        p1 = pa;
        p2 = pb;
      }
    }
    if (!p1 || !p2) return null;
    let u: Vec2;
    if (d.type === "horizontal") u = [1, 0];
    else if (d.type === "vertical") u = [0, 1];
    else {
      const dd = sub(p2, p1);
      const L = Math.hypot(...dd) || 1;
      u = [dd[0] / L, dd[1] / L];
    }
    const n: Vec2 = [-u[1], u[0]];
    const mid: Vec2 = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
    const o = off[0] * n[0] + off[1] * n[1];
    const along = off[0] * u[0] + off[1] * u[1];
    const base = (p: Vec2) => {
      const t = (p[0] - mid[0]) * u[0] + (p[1] - mid[1]) * u[1];
      return addv(addv(mid, mulv(u, t)), mulv(n, o));
    };
    const q1 = base(p1);
    const q2 = base(p2);
    line(toPx(p1), toPx(addv(q1, mulv(n, Math.sign(o) * (3 / scale)))), "e1");
    line(toPx(p2), toPx(addv(q2, mulv(n, Math.sign(o) * (3 / scale)))), "e2");
    const A = toPx(q1);
    const B = toPx(q2);
    line(A, B, "dl");
    const ux = B[0] - A[0];
    const uy = B[1] - A[1];
    const ul = Math.hypot(ux, uy) || 1;
    els.push(arrowHead(A[0], A[1], ux / ul, uy / ul, col, "a1"), arrowHead(B[0], B[1], -ux / ul, -uy / ul, col, "a2"));
    tp = toPx(addv(addv(mid, mulv(n, o)), mulv(u, along)));
    tp = [tp[0], tp[1] - 6];
  }
  const w = label.length * 6.6 + 8;
  const box = { x: tp[0] - w / 2, y: tp[1] - 9, w, h: 16 };
  els.push(
    <g key="t">
      <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={3} fill="#fbfcfd" opacity={0.92} stroke={hot ? col : "none"} strokeWidth={0.8} />
      <text x={tp[0]} y={tp[1] + 3} textAnchor="middle" fontSize={11} fontWeight={600} fill={col} fontFamily="Roboto, Arial">
        {label}
      </text>
    </g>,
  );
  return { el: els, box };
}

function footOn(p: Vec2, l: [Vec2, Vec2]): Vec2 {
  const d = sub(l[1], l[0]);
  const t = ((p[0] - l[0][0]) * d[0] + (p[1] - l[0][1]) * d[1]) / (d[0] * d[0] + d[1] * d[1] || 1e-12);
  return addv(l[0], mulv(d, t));
}

function intersectLines(a: [Vec2, Vec2], b: [Vec2, Vec2]): Vec2 | null {
  const r = sub(a[1], a[0]);
  const s = sub(b[1], b[0]);
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-12) return null;
  const t = ((b[0][0] - a[0][0]) * s[1] - (b[0][1] - a[0][1]) * s[0]) / den;
  return addv(a[0], mulv(r, t));
}
