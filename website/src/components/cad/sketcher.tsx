"use client";

import { cadLocale, tr } from "@/cad/i18n";
import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
import { analyzeSketch, measureDim, paramsOf, refCircle, refLine, refPoint, solveSketch, type EntityState, type SketchAnalysis } from "@/cad/sketch-solver";
import {
  arcMidForRadius,
  autoConstraints,
  chainOf,
  chainSide,
  circleFrom2,
  defaultOpts,
  dynSpec,
  inferLine,
  offsetChain,
  parseInput,
  parseNum,
  polarPoint,
  polygonFrom,
  powerTrim,
  projectModelLines,
  rectFrom3,
  resolveInput,
  slotArcEntities,
  splitAt,
  splitCircle,
  tangentArcEnd,
  tangentAt,
  type AutoKind,
  type AutoRef,
  type DrawOpts,
} from "@/cad/sketch-tools";
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
  | "rect3"
  | "circle"
  | "circle2"
  | "circle3"
  | "arc"
  | "arcCenter"
  | "arcTangent"
  | "ellipse"
  | "spline"
  | "point"
  | "polygon"
  | "slot"
  | "slotArc"
  | "trim"
  | "extend"
  | "split"
  | "project"
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
  /** hrany modelu (dvojice bodů x,y,z ve světových souřadnicích) – pro promítnutí do roviny skici */
  modelLines?: Float32Array | null;
  /** štítky bodů (O = počátek, P1… = konce, středy a rohy entit) – výběr a kreslení bez trefování (AI agenti, dotyk) */
  hints?: boolean;
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

// ---- sdílený stav uchopení (skicář i pás karet) – malý externí store, aby přepínače v pásu ukazovaly živý stav ----
let snapStore: SnapSettings = defaultSnaps;
let snapHydrated = false;
const snapListeners = new Set<() => void>();
export function getSketchSnaps(): SnapSettings {
  return snapStore;
}
export function setSketchSnap(k: keyof SnapSettings, v: boolean) {
  snapStore = { ...snapStore, [k]: v };
  try {
    localStorage.setItem(SNAP_KEY, JSON.stringify(snapStore));
  } catch {
    /* soukromý režim */
  }
  snapListeners.forEach((l) => l());
}
export function subscribeSketchSnaps(l: () => void) {
  snapListeners.add(l);
  return () => {
    snapListeners.delete(l);
  };
}
function hydrateSnaps() {
  if (snapHydrated) return;
  snapHydrated = true;
  snapStore = loadSnaps();
  snapListeners.forEach((l) => l());
}
/** Aktuální nastavení uchopení (pro pás karet: `sketchRibbon({ …, snaps: useSketchSnaps(), setSnap: setSketchSnap })`). */
export function useSketchSnaps(): SnapSettings {
  return useSyncExternalStore(subscribeSketchSnaps, getSketchSnaps, () => defaultSnaps);
}

export const CON_INFO: Record<ConType, { label: string; icon: CadIconName; glyph: string; hint: string }> = {
  horizontal: { label: tr("Vodorovně"), icon: "cHorizontal", glyph: "H", hint: tr("úsečka nebo 2 body") },
  vertical: { label: tr("Svisle"), icon: "cVertical", glyph: "V", hint: tr("úsečka nebo 2 body") },
  coincident: { label: tr("Totožnost"), icon: "cCoincident", glyph: "●", hint: tr("2 body") },
  parallel: { label: tr("Rovnoběžně"), icon: "cParallel", glyph: "∥", hint: tr("2 úsečky") },
  perpendicular: { label: tr("Kolmo"), icon: "cPerpendicular", glyph: "⊥", hint: tr("2 úsečky") },
  tangent: { label: tr("Tečně"), icon: "cTangent", glyph: "T", hint: tr("úsečka + oblouk / 2 oblouky") },
  equal: { label: tr("Stejná velikost"), icon: "cEqual", glyph: "=", hint: tr("2 úsečky nebo 2 kružnice") },
  fixed: { label: tr("Pevně"), icon: "cFixed", glyph: "⚓", hint: tr("bod nebo entita") },
  concentric: { label: tr("Soustředně"), icon: "cConcentric", glyph: "◎", hint: tr("2 kružnice/oblouky") },
  midpoint: { label: tr("Ve středu"), icon: "cMidpoint", glyph: "M", hint: tr("bod + úsečka") },
  pointOnCurve: { label: tr("Bod na křivce"), icon: "cPointOnCurve", glyph: "⊙", hint: tr("bod + křivka") },
  symmetric: { label: tr("Symetrie"), icon: "cSymmetric", glyph: "⋈", hint: tr("2 body + osa") },
  collinear: { label: tr("Kolineárně"), icon: "cCollinear", glyph: "≡", hint: tr("2 úsečky") },
};

const TOOL_LABEL: Partial<Record<SketchTool, string>> = {
  select: "Výběr",
  line: "Úsečka",
  polyline: "Lomená čára",
  centerline: "Osa",
  rect: "Obdélník",
  rectCenter: "Obdélník ze středu",
  rect3: "Obdélník 3 body",
  circle: "Kružnice",
  circle2: "Kružnice 2 body",
  circle3: "Kružnice 3 body",
  arc: "Oblouk 3 body",
  arcCenter: "Oblouk středem",
  arcTangent: "Tečný oblouk",
  ellipse: "Elipsa",
  spline: "Spline",
  point: "Bod",
  polygon: "Mnohoúhelník",
  slot: "Drážka",
  slotArc: "Drážka obloukem",
  trim: "Oříznout",
  extend: "Prodloužit",
  split: "Rozdělit",
  project: "Promítnout hrany",
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

/**
 * Skupiny pásu karet pro režim skici (volá je cad-app). Volitelné `snaps` + `setSnap` (z `useSketchSnaps()` /
 * `setSketchSnap`) přidají skupinu přepínačů uchopení s živým stavem; bez nich zůstává panel uchopení ve skicáři.
 */
export function sketchRibbon(p: { tool: SketchTool; setTool: (t: SketchTool) => void; snapGrid: boolean; setSnapGrid: (v: boolean) => void; onExportDxf: () => void; onImportDxf: () => void; snaps?: SnapSettings; setSnap?: (k: keyof SnapSettings, v: boolean) => void }): RGroup[] {
  const T = (t: SketchTool, icon: CadIconName, kbd?: string, hint?: string): RItem => ({ id: t, label: tr(TOOL_LABEL[t] ?? t), icon, tone: "sketch", kbd, hint, active: p.tool === t, onClick: () => p.setTool(t) });
  const E = (t: SketchTool, icon: CadIconName, kbd?: string, hint?: string): RItem => ({ ...T(t, icon, kbd, hint), tone: "feature" });
  const K = (c: ConType): RItem => ({ id: `con-${c}`, label: CON_INFO[c].label, icon: CON_INFO[c].icon, tone: "pattern", hint: CON_INFO[c].hint, active: p.tool === `con-${c}`, onClick: () => p.setTool(`con-${c}`) });
  const snapGroup: RGroup[] =
    p.snaps && p.setSnap
      ? [
          {
            label: tr("Uchopení"),
            big: 0,
            items: [
              ...SNAP_ORDER.map((k): RItem => ({ id: `snap-${k}`, label: tr(SNAP_LABEL[k]), icon: "magnet", tone: "view", active: p.snaps![k], onClick: () => p.setSnap!(k, !p.snaps![k]) })),
              { id: "snap-infer", label: tr("Zarovnání (vodítka)"), icon: "magnet", tone: "view", active: p.snaps.infer, onClick: () => p.setSnap!("infer", !p.snaps!.infer) },
              { id: "snap-auto", label: tr("Automatické vazby"), icon: "cCoincident", tone: "pattern", active: p.snaps.auto, onClick: () => p.setSnap!("auto", !p.snaps!.auto) },
            ],
          },
        ]
      : [];
  const groups: RGroup[] = [
    {
      label: tr("Kreslení"),
      big: 5,
      items: [
        T("select", "select", "V"),
        T("line", "line", "L", tr("řetěz úseček, Esc ukončí")),
        T("rect", "rect", "R"),
        T("circle", "circle", "C"),
        T("arc", "arc", "A", tr("začátek, konec, bod na oblouku")),
        T("polyline", "polyline", "K", tr("Enter/dvojklik ukončí")),
        T("centerline", "centerline", "X", tr("pomocná osa")),
        T("point", "point", "B"),
        T("rectCenter", "rectCenter"),
        T("circle3", "circle3"),
        T("polygon", "polygon", "P"),
        T("arcCenter", "arcCenter", undefined, tr("střed, začátek, konec")),
        T("arcTangent", "arcTangent", undefined, tr("navazuje tečně na konec úsečky/oblouku")),
        T("slot", "slot", "S"),
        T("ellipse", "ellipse", "E", tr("střed, hlavní poloosa, vedlejší poloosa")),
        T("spline", "spline", "N", tr("body křivky, Enter ukončí")),
        T("rect3", "rect", undefined, tr("natočený obdélník: 2 rohy první strany + výška")),
        T("circle2", "circle", undefined, tr("dva body na průměru")),
        T("slotArc", "slot", undefined, tr("střed, začátek a konec osy, šířka")),
      ],
    },
    {
      label: tr("Úpravy"),
      big: 2,
      items: [
        E("trim", "trim", "T", tr("klik na úsek, nebo táhněte přes více úseků (výkonný ořez)")),
        E("offset", "offset", "O", tr("entita nebo řetězec, strana myší, vzdálenost číslem")),
        E("extend", "extend", undefined, tr("klikněte u konce úsečky")),
        E("split", "split", undefined, tr("rozdělit úsečku/oblouk v bodě, kružnici 2 body")),
        E("project", "face", undefined, tr("promítnout hrany modelu do roviny skici")),
        E("fillet", "fillet", undefined, tr("2 úsečky + poloměr")),
        E("chamfer", "chamfer", undefined, tr("2 úsečky + vzdálenost")),
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
      label: tr("Vazby"),
      big: 0,
      items: (["horizontal", "vertical", "coincident", "parallel", "perpendicular", "tangent", "equal", "concentric", "midpoint", "pointOnCurve", "symmetric", "collinear", "fixed"] as ConType[]).map(K),
    },
    { label: tr("Kóty"), items: [{ ...T("dimension", "dimension", "D", tr("inteligentní kóta – klikněte na entity")), tone: "tool" }] },
    {
      label: tr("Nástroje"),
      big: 1,
      items: [
        { ...T("measure", "measure", "M"), tone: "tool" },
        { id: "grid", label: tr("Přichytit k mřížce"), icon: "grid", tone: "view", kbd: "G", active: p.snapGrid, onClick: () => p.setSnapGrid(!p.snapGrid) },
        { id: "dxf", label: tr("Export skici DXF"), icon: "export", tone: "file", onClick: p.onExportDxf },
        { id: "imp", label: tr("Import DXF…"), icon: "open", tone: "file", onClick: p.onImportDxf },
      ],
    },
  ];
  // pořadí jako v desktopových CADech: kreslení → vazby a kóty → úpravy → nástroje; uchopení (přepínače) až na konci
  const by = (l: string) => groups.find((g) => g.label === l)!;
  return [by(tr("Kreslení")), by(tr("Vazby")), by(tr("Kóty")), by(tr("Úpravy")), by(tr("Nástroje")), ...snapGroup];
}

// ======================= geometrie pomocí =======================

const fmt = (n: number, d = 2) => (Math.round(n * 10 ** d) / 10 ** d).toLocaleString(cadLocale());
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const R4 = (p: Vec2): Vec2 => [r4(p[0]), r4(p[1])];
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const addv = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
const mulv = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k];
const angDeg = (a: Vec2, b: Vec2) => (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
const unitv = (a: Vec2): Vec2 => {
  const l = Math.hypot(a[0], a[1]) || 1;
  return [a[0] / l, a[1] / l];
};
const perpv = (a: Vec2): Vec2 => [-a[1], a[0]];
const rotv = (p: Vec2, c: Vec2, deg: number): Vec2 => {
  const t = (deg * Math.PI) / 180;
  const x = p[0] - c[0];
  const y = p[1] - c[1];
  return [c[0] + x * Math.cos(t) - y * Math.sin(t), c[1] + x * Math.sin(t) + y * Math.cos(t)];
};
/** Kolmá vzdálenost bodu od přímky a→b (se znaménkem: kladně vlevo). */
const sideDist = (p: Vec2, a: Vec2, b: Vec2) => {
  const n = perpv(unitv(sub(b, a)));
  return (p[0] - a[0]) * n[0] + (p[1] - a[1]) * n[1];
};

/** Volby kreslení (pás skici je bez vlastního stavu, proto přepínače ve skicáři + localStorage). */
const OPTS_KEY = "mn-cad-sketch-opts-v1";
function loadOpts(): DrawOpts {
  try {
    return { ...defaultOpts, ...JSON.parse(localStorage.getItem(OPTS_KEY) ?? "{}") };
  } catch {
    return defaultOpts;
  }
}

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

/** Barva podle stavu určenosti (jako SolidWorks): nedourčená modře, plně určená černě, přeurčená/konflikt červeně. */
const STATE_COLOR: Record<EntityState, string> = { free: "#1d4ed8", full: "#1f2933", over: "#dc2626" };
const STATE_COLOR_CONS: Record<EntityState, string> = { free: "#8fa3c4", full: "#7a8796", over: "#dc2626" };

const EntityLayer = memo(function EntityLayer({ paths, entities, sel, hover, states, k }: { paths: Map<string, { d: string; closed: boolean }>; entities: SketchEntity[]; sel: Set<string>; hover: string | null; states: Map<string, EntityState>; k: number }) {
  return (
    <g>
      {entities.map((e) => {
        const p = paths.get(e.id);
        if (!p) return null;
        const isSel = sel.has(e.id);
        const isHover = hover === e.id && !isSel;
        const st = states.get(e.id) ?? "free";
        const base = e.construction ? STATE_COLOR_CONS[st] : STATE_COLOR[st];
        if (e.type === "point")
          return <circle key={e.id} cx={e.p[0]} cy={e.p[1]} r={3.2 / k} fill={isSel ? "#E03930" : isHover ? "#f59e0b" : base} />;
        return (
          <path
            key={e.id}
            d={p.d}
            fill="none"
            stroke={isSel ? "#E03930" : isHover ? "#f59e0b" : base}
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
  | { kind: "dimLabel"; id: string; from: Vec2; orig: Vec2 }
  | { kind: "trimPath"; path: Vec2[] };

type DynState = { texts: string[]; locked: boolean[]; active: number };
const emptyDyn: DynState = { texts: [], locked: [], active: 0 };
const emptyStatus: SketchAnalysis = { dof: -1, conflicts: [], redundant: [], states: new Map(), status: "under" };

type Snap = { p: Vec2; kind: SnapKind | "free"; ref?: SketchRef; hv?: "h" | "v" | null; guides?: [Vec2, Vec2][] };

/**
 * Profesionální 2D skicář: uchopování (OSNAP), vazby s numerickým řešičem, řídicí kóty,
 * editační nástroje, kontextové menu. Souřadnice v mm, osa Y nahoru.
 */
export function Sketcher({ sketch, onChange, selected, onSelect, tool, setTool, snapGrid, setSnapGrid, onFinish, modelLines, hints }: Props) {
  const entities = sketch.entities;
  const constraints = useMemo(() => sketch.constraints ?? [], [sketch.constraints]);
  const dims = useMemo(() => sketch.dims ?? [], [sketch.dims]);
  const emap = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);
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
  const snaps = useSketchSnaps();
  const [phase, setPhase] = useState(0); // fáze nástrojů s výběrem
  const [flash, setFlash] = useState<string | null>(null);
  const [measureRes, setMeasureRes] = useState<{ title: string; rows: [string, string][]; line?: [Vec2, Vec2] } | null>(null);
  const [status, setStatus] = useState<SketchAnalysis>(emptyStatus);
  const [opts, setOpts] = useState<DrawOpts>(defaultOpts);
  const [dyn, setDyn] = useState<DynState>(emptyDyn);
  const [trimPreview, setTrimPreview] = useState<Vec2[] | null>(null);
  const drag = useRef<DragS | null>(null);
  const downAt = useRef<[number, number, number] | null>(null);
  const fitted = useRef(false);
  const lastVal = useRef<Record<string, number>>({ fillet: 5, chamfer: 2, offset: 5, count: 4, ccount: 6 });
  /** poslední poloha kurzoru (mm) a poslední zadaný bod – pro Enter bez pohybu myši a relativní zadání „@“ */
  const lastRaw = useRef<Vec2 | null>(null);
  const lastPt = useRef<Vec2 | null>(null);
  /** klíče hodnot zadaných číslem v předchozích krocích téže entity (např. poloměr oblouku středem) – pro kóty při kreslení */
  const typedKeys = useRef<Set<string>>(new Set());

  useEffect(() => {
    hydrateSnaps();
    setOpts(loadOpts());
  }, []);
  const setSnap = setSketchSnap;
  const setOpt = <K extends keyof DrawOpts>(k: K, v: DrawOpts[K]) =>
    setOpts((o) => {
      const n = { ...o, [k]: v };
      try {
        localStorage.setItem(OPTS_KEY, JSON.stringify(n));
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
    typedKeys.current.clear();
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

  // stav určenosti po entitách (debounce) – stupně volnosti, nadbytečné vazby, konflikty
  useEffect(() => {
    if (drag.current) return;
    const t = setTimeout(() => setStatus(analyzeSketch(entities, constraints, dims)), 160);
    return () => clearTimeout(t);
  }, [entities, constraints, dims]);

  // číselné zadání: nový krok nástroje = prázdná pole
  const specKey = `${tool}|${pts.length}|${picks.length}|${phase}`;
  useEffect(() => setDyn(emptyDyn), [specKey]);

  // ---------- souřadnice ----------
  const toMm = useCallback(
    (clientX: number, clientY: number): Vec2 => {
      const r = svgRef.current!.getBoundingClientRect();
      return [view.cx + (clientX - r.left - size.w / 2) / view.scale, view.cy - (clientY - r.top - size.h / 2) / view.scale];
    },
    [view, size],
  );
  const toPx = useCallback((p: Vec2): Vec2 => [size.w / 2 + (p[0] - view.cx) * view.scale, size.h / 2 - (p[1] - view.cy) * view.scale], [view, size]);
  /** štítky bodů skici (O, P1…) – leží přesně na bodu a nepřijímají kliknutí, klik na štítek = klik na bod (uchopení) */
  const sketchHints = useMemo(() => {
    if (!hints) return [] as { id: string; x: number; y: number; title: string }[];
    const pts: { p: Vec2; title: string }[] = [{ p: [0, 0], title: tr("počátek skici [0; 0]") }];
    const f2 = (v: number) => (Math.round(v * 100) / 100).toString().replace(".", ",");
    const lab = (p: Vec2, what: string) => `${what} [${f2(p[0])}; ${f2(p[1])}]`;
    entities.forEach((e, i) => {
      const n = i + 1;
      if (e.type === "rect") {
        const ca = Math.cos((e.angle * Math.PI) / 180);
        const sa = Math.sin((e.angle * Math.PI) / 180);
        const corner = (sx: number, sy: number): Vec2 => [e.cx + (sx * e.w) / 2 * ca - (sy * e.h) / 2 * sa, e.cy + (sx * e.w) / 2 * sa + (sy * e.h) / 2 * ca];
        pts.push({ p: [e.cx, e.cy], title: lab([e.cx, e.cy], tr("obdélník {0} – střed", n)) });
        for (const [sx, sy, name] of [[-1, -1, tr("levý dolní roh")], [1, -1, tr("pravý dolní roh")], [1, 1, tr("pravý horní roh")], [-1, 1, tr("levý horní roh")]] as [number, number, string][]) pts.push({ p: corner(sx, sy), title: lab(corner(sx, sy), tr("obdélník {0} – {1}", n, name)) });
      } else if (e.type === "circle") {
        pts.push({ p: [e.cx, e.cy], title: lab([e.cx, e.cy], tr("kružnice {0} Ø{1} – střed", n, f2(2 * e.r))) });
        for (const [dx, dy, name] of [[1, 0, tr("pravý kvadrant")], [-1, 0, tr("levý kvadrant")], [0, 1, tr("horní kvadrant")], [0, -1, tr("dolní kvadrant")]] as [number, number, string][]) pts.push({ p: [e.cx + dx * e.r, e.cy + dy * e.r], title: lab([e.cx + dx * e.r, e.cy + dy * e.r], tr("kružnice {0} – {1}", n, name)) });
      } else if (e.type === "polygon" || e.type === "ellipse") pts.push({ p: [e.cx, e.cy], title: lab([e.cx, e.cy], tr("{0} {1} – střed", e.type === "polygon" ? "mnohoúhelník" : "elipsa", n)) });
      else if (e.type === "slot") {
        const ca = Math.cos((e.angle * Math.PI) / 180);
        const sa = Math.sin((e.angle * Math.PI) / 180);
        pts.push({ p: [e.cx, e.cy], title: lab([e.cx, e.cy], tr("drážka {0} – střed", n)) });
        for (const sgn of [-1, 1]) { const q: Vec2 = [e.cx + (sgn * e.length) / 2 * ca, e.cy + (sgn * e.length) / 2 * sa]; pts.push({ p: q, title: lab(q, tr("drážka {0} – střed oblouku", n)) }); }
      } else if (e.type === "line") {
        pts.push({ p: e.a, title: lab(e.a, tr("úsečka {0} – začátek", n)) });
        pts.push({ p: e.b, title: lab(e.b, tr("úsečka {0} – konec", n)) });
        const m: Vec2 = [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2];
        pts.push({ p: m, title: lab(m, tr("úsečka {0} – střed", n)) });
      } else if (e.type === "polyline" || e.type === "spline") e.points.forEach((q, k) => pts.push({ p: q, title: lab(q, tr("{0} {1} – bod {2}", e.type === "polyline" ? "čára" : "spline", n, k + 1)) }));
      else if (e.type === "arc") {
        pts.push({ p: e.a, title: lab(e.a, tr("oblouk {0} – začátek", n)) });
        pts.push({ p: e.c, title: lab(e.c, tr("oblouk {0} – konec", n)) });
        pts.push({ p: e.b, title: lab(e.b, tr("oblouk {0} – bod na oblouku", n)) });
      } else if (e.type === "point") pts.push({ p: e.p, title: lab(e.p, `bod ${n}`) });
    });
    const out: { id: string; x: number; y: number; title: string }[] = [];
    const seen = new Set<string>();
    pts.forEach((q, i) => {
      if (out.length >= 200) return;
      const [x, y] = toPx(q.p);
      if (x < 4 || y < 4 || x > size.w - 4 || y > size.h - 4) return;
      const key = `${Math.round(x)}|${Math.round(y)}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ id: i === 0 ? "O" : `P${out.length}`, x, y, title: q.title });
    });
    return out;
  }, [hints, entities, toPx, size]);
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

  const addEntities = (es: SketchEntity[], extraCons: SketchConstraint[] = [], extraDims: SketchDim[] = []) => {
    commitEdit([...entities, ...es], [...constraints, ...extraCons], [...dims, ...extraDims]);
    setDyn(emptyDyn);
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
      note(tr("Vazbu „{0}“ nelze přidat – je v konfliktu s jinými vazbami/kótami.", CON_INFO[type].label));
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
      if (applyConstraint(type, m)) note(tr("Vazba „{0}“ přidána.", CON_INFO[type].label));
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
    if (v == null) return note(tr("Tuto kombinaci nelze okótovat."));
    d.value = r4(v);
    const nextDims = [...dims, d];
    onChange({ dims: nextDims }, true);
    setAsk({
      label: type === "angle" ? tr("Úhel") : type === "radius" ? tr("Poloměr") : type === "diameter" ? tr("Průměr") : type === "arcLength" ? tr("Délka oblouku") : tr("Vzdálenost"),
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
      note(tr("Kóta by skicu přeurčila – ponechána jako referenční."));
      onChange({ dims: list.map((d) => (d.id === id ? { ...d, driving: false } : d)) }, true);
      return;
    }
    onChange({ entities: res.entities, constraints, dims: next }, true);
  };

  // ---------- číselné zadání u kurzoru + odvozené vazby ----------
  const spec = dynSpec(tool, pts.length, picks.length, phase, opts);
  const dynT = (key: string) => {
    const i = spec.findIndex((f) => f.key === key);
    return i >= 0 ? (dyn.texts[i] ?? "") : "";
  };
  const dynNum = (key: string): number | null => {
    const t = dynT(key);
    if (!t.trim()) return null;
    const v = parseNum(t);
    return Number.isFinite(v) ? v : null;
  };
  const dynTyped = dyn.texts.some((t) => t.trim());
  /** rozbor prvního pole: „x;y“, „@dx;dy“, „délka<úhel“ – u obdélníku dvojice znamená šířka × výška */
  const firstInput = spec[0] && dynT(spec[0].key).trim() ? parseInput(dynT(spec[0].key)) : null;
  const pairWH: [number, number] | null = firstInput && (firstInput.kind === "abs" || firstInput.kind === "rel") && (tool === "rect" || tool === "rectCenter") && pts.length >= 1 ? [Math.abs(firstInput.v[0]), Math.abs(firstInput.v[1])] : null;

  type Resolved = { p: Vec2; kinds: AutoKind[]; ref?: string; typed: boolean; snap: Snap };
  /** Výsledný bod kliknutí/náhledu: uchopení → zadané hodnoty u kurzoru → odvozené vazby (H/V, rovnoběžně, kolmo, tečně). */
  const resolvePoint = (s0: Snap): Resolved => {
    const n = pts.length;
    const from = n ? pts[n - 1] : null;
    const c0 = pts[0];
    let p = s0.p;
    let typed = false;
    const ci = firstInput;
    const keys = new Set(spec.map((f) => f.key));
    if (ci && ci.kind !== "num" && !pairWH && (keys.has("x") || keys.has("len") || keys.has("w"))) {
      // „x;y“ / „@dx;dy“ / „délka<úhel“ v prvním poli
      const q = resolveInput(ci, from ?? lastPt.current);
      if (q) {
        p = q;
        typed = true;
      }
    } else if (dynTyped) {
      typed = true;
      const dir = (c: Vec2) => (dist(p, c) > 1e-9 ? unitv(sub(p, c)) : ([1, 0] as Vec2));
      if (keys.has("x") || keys.has("y")) p = [dynNum("x") ?? p[0], dynNum("y") ?? p[1]];
      else if (keys.has("len") && from) p = polarPoint(from, p, dynNum("len"), dynNum("ang"));
      else if ((tool === "rect" || tool === "rectCenter") && c0) {
        const k = tool === "rect" ? 1 : 0.5;
        const w = pairWH?.[0] ?? dynNum("w");
        const h = pairWH?.[1] ?? dynNum("h");
        p = [w != null ? c0[0] + (p[0] >= c0[0] ? 1 : -1) * w * k : p[0], h != null ? c0[1] + (p[1] >= c0[1] ? 1 : -1) * h * k : p[1]];
      } else if (tool === "rect3" && c0) {
        if (n === 1) p = polarPoint(c0, p, dynNum("w"), dynNum("ang"));
        else {
          const h = dynNum("h");
          if (h != null && n >= 2) p = addv(pts[1], mulv(perpv(unitv(sub(pts[1], c0))), (sideDist(p, c0, pts[1]) >= 0 ? 1 : -1) * h));
        }
      } else if ((keys.has("r") || keys.has("d")) && c0) {
        const v = dynNum("r") ?? dynNum("d");
        if (v != null && v > 0) {
          if (tool === "circle") p = addv(c0, mulv(dir(c0), opts.diameter ? v / 2 : v));
          else if (tool === "arc" && n >= 2) p = arcMidForRadius(c0, pts[1], v, sideDist(p, c0, pts[1]) >= 0 ? -1 : 1) ?? p;
          else if (tool === "arcTangent") {
            const src = ptRefs[0] ? emap.get(ptRefs[0].e) : undefined;
            const t = src && ptRefs[0] ? tangentAt(src, ptRefs[0].k) : null;
            if (t) p = tangentArcEnd(c0, t, v, sideDist(p, c0, addv(c0, t)) >= 0 ? 1 : -1, p);
          } else p = addv(c0, mulv(dir(c0), v)); // kružnice 2 body, oblouk středem, mnohoúhelník, drážka obloukem
        }
      } else if (keys.has("sweep") && c0 && n >= 2) {
        const sw = dynNum("sweep");
        if (sw != null) p = rotv(pts[1], c0, sw);
      } else if (keys.has("w") && c0 && n >= 2) {
        const w = dynNum("w");
        if (w != null && w > 0) {
          if (tool === "slot") p = addv(c0, mulv(perpv(unitv(sub(pts[1], c0))), (sideDist(p, c0, pts[1]) >= 0 ? 1 : -1) * (w / 2)));
          else if (tool === "slotArc") {
            const Rm = dist(c0, pts[1]);
            p = addv(c0, mulv(dir(c0), Rm + (dist(p, c0) >= Rm ? 1 : -1) * (w / 2)));
          }
        }
      } else if (keys.has("rx") && c0) p = polarPoint(c0, p, dynNum("rx"), dynNum("ang"));
      else if (keys.has("ry") && c0 && n >= 2) {
        const ry = dynNum("ry");
        if (ry != null && ry > 0) p = addv(c0, mulv(perpv(unitv(sub(pts[1], c0))), (sideDist(p, c0, pts[1]) >= 0 ? 1 : -1) * ry));
      }
    }
    let snap: Snap = dist(p, s0.p) > 1e-9 ? { p, kind: "free" } : s0;
    let kinds: AutoKind[] = [];
    let ref: string | undefined;
    const lineTool = tool === "line" || tool === "centerline" || tool === "polyline";
    if (lineTool && from && snaps.auto && dist(p, from) > 1e-9) {
      const angTyped = dynNum("ang") != null || (ci != null && ci.kind !== "num");
      if ((snap.kind === "free" || snap.kind === "grid") && !angTyped) {
        const refs: AutoRef[] = [];
        const pr = ptRefs[n - 1];
        const pe = pr ? emap.get(pr.e) : undefined;
        if (pe?.type === "line") refs.push({ id: pe.id, dir: sub(pe.b, pe.a), kind: "line" });
        else if (pe?.type === "arc" && pr) {
          const t = tangentAt(pe, pr.k);
          if (t) refs.push({ id: pe.id, dir: t, kind: "tangent" });
        }
        const hid = hitEntity(s0.p);
        const he = hid ? emap.get(hid) : undefined;
        if (he?.type === "line" && he.id !== pe?.id) refs.push({ id: he.id, dir: sub(he.b, he.a), kind: "line" });
        const res = inferLine(from, p, refs);
        if (dist(res.p, p) > 1e-9) snap = { p: res.p, kind: "free" };
        p = res.p;
        kinds = res.kinds;
        ref = res.ref;
      } else if (Math.abs(p[1] - from[1]) < 1e-9) kinds = ["horizontal"];
      else if (Math.abs(p[0] - from[0]) < 1e-9) kinds = ["vertical"];
    }
    return { p: R4(p), kinds, ref, typed, snap: { ...snap, p: R4(p) } };
  };

  /** Potvrzení zadaných hodnot klávesou Enter (bod se dopočítá z hodnot a poslední polohy kurzoru). */
  const confirmDyn = (): boolean => {
    if (!spec.length || !dynTyped) return false;
    const raw = lastRaw.current ?? pts[pts.length - 1] ?? [0, 0];
    const fake = { detail: 1, shiftKey: false } as React.PointerEvent;
    if (tool === "offset") applyOffset(raw, dynNum("d"));
    else if (SEL_TOOLS.has(tool)) selToolClick(raw, fake);
    else toolClick(raw, fake);
    return true;
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
    const rp = resolvePoint(computeSnap(raw, { from }));
    const s = rp.snap;
    const p = rp.p;
    const next = [...pts, p];
    const nextRefs = [...ptRefs, s.ref];
    const autoFor = (id: string, key: string, idx: number): SketchConstraint[] => {
      const snapAt = idx === next.length - 1 ? s : null;
      if (snapAt) return lastAuto(snapAt, id, key);
      const rf = nextRefs[idx];
      return rf && snaps.auto ? [{ id: uid(), type: "coincident", refs: [rf, { e: id, k: key }] }] : [];
    };
    /** totožnost klíčového bodu nové entity s uchopeným bodem i-tého kliknutí */
    const coinc = (id: string, key: string, idx: number): SketchConstraint[] => (nextRefs[idx] && snaps.auto ? [{ id: uid(), type: "coincident", refs: [nextRefs[idx]!, { e: id, k: key }] }] : []);
    /** bod na křivce: uchopený bod i-tého kliknutí leží na nové kružnici/oblouku */
    const onCurve = (id: string, idx: number): SketchConstraint[] => (nextRefs[idx] && snaps.auto && idx !== next.length - 1 ? [{ id: uid(), type: "pointOnCurve", refs: [nextRefs[idx]!, { e: id, k: "self" }] }] : idx === next.length - 1 && s.ref && snaps.auto && (s.kind === "end" || s.kind === "center" || s.kind === "int" || s.kind === "quad") ? [{ id: uid(), type: "pointOnCurve", refs: [s.ref, { e: id, k: "self" }] }] : []);
    const cornerKey = (e: Extract<SketchEntity, { type: "rect" }>, q: Vec2) => {
      const k = keyPoints(e);
      return (["c0", "c1", "c2", "c3"] as const).reduce<"c0" | "c1" | "c2" | "c3">((b, kk) => (dist(k[kk], q) < dist(k[b], q) ? kk : b), "c0");
    };
    const refKind = (rid: string) => {
      const t = emap.get(rid)?.type;
      return t === "line" || t === "arc" ? t : null;
    };
    /** řídicí kóty z číselného zadání („Kótovat při kreslení“) */
    const hasNum = (k: string) => {
      if (pairWH && (k === "w" || k === "h")) return true;
      const t = dynT(k);
      if (!t.trim()) return false;
      const c = parseInput(t);
      return !!c && c.kind === "num";
    };
    const dimsFor = (e: SketchEntity): SketchDim[] => {
      if (!opts.autoDim || (!rp.typed && !typedKeys.current.size)) return [];
      const has = (k: string) => typedKeys.current.has(k) || hasNum(k);
      const off = 14 / view.scale;
      const D = (type: SketchDim["type"], refs: SketchRef[], value: number, offset: Vec2): SketchDim => ({ id: uid(), type, refs, value: r4(value), driving: true, offset });
      const sideOff = (a: Vec2, b: Vec2, k = -1): Vec2 => mulv(perpv(unitv(sub(b, a))), k * off);
      const useDia = opts.diameter || tool === "circle2";
      switch (e.type) {
        case "line":
          return has("len") ? [D("length", [{ e: e.id, k: "self" }], dist(e.a, e.b), sideOff(e.a, e.b, 1))] : [];
        case "circle":
          return has("r") || has("d") ? [D(useDia ? "diameter" : "radius", [{ e: e.id, k: "self" }], useDia ? 2 * e.r : e.r, [e.r * 0.75, e.r * 0.75])] : [];
        case "arc": {
          const g = circleFrom3(e.a, e.b, e.c);
          return g && has("r") ? [D("radius", [{ e: e.id, k: "self" }], g.r, mulv(unitv(sub(e.b, g.c)), g.r * 1.3))] : [];
        }
        case "rect": {
          const k = keyPoints(e);
          const out: SketchDim[] = [];
          if (has("w")) out.push(D("length", [{ e: e.id, k: "s0" }], e.w, sideOff(k.c0, k.c1)));
          if (has("h")) out.push(D("length", [{ e: e.id, k: "s1" }], e.h, sideOff(k.c1, k.c2)));
          return out;
        }
        case "polygon":
          return has("r") && !opts.circumscribed ? [D("radius", [{ e: e.id, k: "self" }], e.r, [e.r * 0.75, e.r * 0.75])] : [];
        default:
          return [];
      }
    };
    const finish = (es: SketchEntity[], cons: SketchConstraint[] = [], dms: SketchDim[] = []) => {
      addEntities(es, cons, dms);
      typedKeys.current.clear();
      lastPt.current = p;
      setPts([]);
      setPtRefs([]);
    };
    const step = () => {
      for (const f of spec) if (hasNum(f.key)) typedKeys.current.add(f.key);
      setPts(next);
      setPtRefs(nextRefs);
      lastPt.current = p;
    };
    switch (tool) {
      case "line":
      case "centerline": {
        if (!pts.length) return step();
        const a = pts[pts.length - 1];
        if (dist(a, p) < 1e-6) return;
        const id = uid();
        const cons: SketchConstraint[] = [...autoFor(id, "a", next.length - 2), ...autoFor(id, "b", next.length - 1)];
        if (snaps.auto) cons.push(...autoConstraints(id, rp, refKind));
        const line: SketchEntity = { id, type: "line", a, b: p, construction: tool === "centerline" || undefined };
        addEntities([line], cons, dimsFor(line));
        lastPt.current = p;
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
        step();
        if (ev.detail >= 2) finishPoly(false, next);
        return;
      }
      case "point": {
        const id = uid();
        addEntities([{ id, type: "point", p }], lastAuto(s, id, "p"));
        lastPt.current = p;
        return;
      }
      case "rect":
      case "rectCenter": {
        if (next.length < 2) return step();
        const [a] = next;
        if (Math.abs(a[0] - p[0]) < 1e-6 || Math.abs(a[1] - p[1]) < 1e-6) return;
        const e: Extract<SketchEntity, { type: "rect" }> =
          tool === "rect"
            ? { id: uid(), type: "rect", cx: r4((a[0] + p[0]) / 2), cy: r4((a[1] + p[1]) / 2), w: r4(Math.abs(p[0] - a[0])), h: r4(Math.abs(p[1] - a[1])), r: 0, angle: 0 }
            : { id: uid(), type: "rect", cx: a[0], cy: a[1], w: r4(Math.abs(p[0] - a[0]) * 2), h: r4(Math.abs(p[1] - a[1]) * 2), r: 0, angle: 0 };
        const cons = tool === "rectCenter" ? coinc(e.id, "center", 0) : [...coinc(e.id, cornerKey(e, a), 0), ...coinc(e.id, cornerKey(e, p), 1)];
        return finish([e], cons, dimsFor(e));
      }
      case "rect3": {
        if (next.length < 3) return step();
        const e = rectFrom3(next[0], next[1], p);
        if (!e) return note(tr("Body obdélníku leží na přímce."));
        return finish([e], [...coinc(e.id, cornerKey(e, next[0]), 0), ...coinc(e.id, cornerKey(e, next[1]), 1)], dimsFor(e));
      }
      case "circle": {
        if (next.length < 2) return step();
        if (dist(next[0], p) < 1e-6) return;
        const id = uid();
        const e: SketchEntity = { id, type: "circle", cx: next[0][0], cy: next[0][1], r: r4(dist(next[0], p)) };
        return finish([e], [...coinc(id, "center", 0), ...onCurve(id, 1)], dimsFor(e));
      }
      case "circle2": {
        if (next.length < 2) return step();
        const e = circleFrom2(next[0], p);
        if (!e) return;
        return finish([e], [...onCurve(e.id, 0), ...onCurve(e.id, 1)], dimsFor(e));
      }
      case "circle3": {
        if (next.length < 3) return step();
        const cc = circleFrom3(next[0], next[1], p);
        if (!cc) return note(tr("Body leží na přímce."));
        const id = uid();
        return finish([{ id, type: "circle", cx: r4(cc.c[0]), cy: r4(cc.c[1]), r: r4(cc.r) }], [...onCurve(id, 0), ...onCurve(id, 1), ...onCurve(id, 2)]);
      }
      case "arc": {
        if (next.length < 3) return step();
        if (!circleFrom3(next[0], p, next[1])) return;
        const id = uid();
        const e: SketchEntity = { id, type: "arc", a: next[0], b: p, c: next[1] };
        return finish([e], [...coinc(id, "a", 0), ...coinc(id, "c", 1)], dimsFor(e));
      }
      case "arcCenter": {
        if (next.length < 3) return step();
        const arc = arcFromCenter(next[0], next[1], p);
        if (!arc) return;
        return finish([arc], [...coinc(arc.id, "center", 0), ...coinc(arc.id, "a", 1)], dimsFor(arc));
      }
      case "arcTangent": {
        if (!pts.length) {
          if (!s.ref || s.kind !== "end") return note(tr("Začněte na konci úsečky nebo oblouku."));
          return step();
        }
        const arc = tangentArc(entities, ptRefs[0], pts[0], p);
        if (!arc) return note(tr("Tečný oblouk nelze vytvořit."));
        const cons: SketchConstraint[] = [];
        if (ptRefs[0] && snaps.auto) {
          cons.push({ id: uid(), type: "coincident", refs: [ptRefs[0], { e: arc.id, k: "a" }] });
          cons.push({ id: uid(), type: "tangent", refs: [{ e: ptRefs[0].e, k: "self" }, { e: arc.id, k: "self" }] });
        }
        const srcType = ptRefs[0] ? emap.get(ptRefs[0].e)?.type : undefined;
        return finish([arc], srcType === "line" || srcType === "arc" ? cons : cons.slice(0, 1), dimsFor(arc));
      }
      case "ellipse": {
        if (next.length < 3) return step();
        const [c, a] = next;
        const rx = dist(c, a);
        const ang = angDeg(c, a);
        const t = (ang * Math.PI) / 180;
        const ry = Math.abs(-(p[0] - c[0]) * Math.sin(t) + (p[1] - c[1]) * Math.cos(t));
        if (rx < 1e-6 || ry < 1e-6) return;
        const id = uid();
        return finish([{ id, type: "ellipse", cx: c[0], cy: c[1], rx: r4(rx), ry: r4(ry), angle: r4(ang) }], coinc(id, "center", 0));
      }
      case "polygon": {
        if (next.length < 2) return step();
        const sides = Math.max(3, Math.round(dynNum("sides") ?? opts.sides));
        if (sides !== opts.sides) setOpt("sides", sides);
        const e = polygonFrom(next[0], p, sides, opts.circumscribed);
        if (!e) return;
        return finish([e], coinc(e.id, "center", 0), dimsFor(e));
      }
      case "slot": {
        if (next.length < 3) return step();
        const [a, b] = next;
        const len = dist(a, b);
        if (len < 1e-6) return;
        const w = Math.abs(sideDist(p, a, b)) * 2 || 10;
        const id = uid();
        return finish([{ id, type: "slot", cx: r4((a[0] + b[0]) / 2), cy: r4((a[1] + b[1]) / 2), length: r4(len + w), width: r4(w), angle: r4(angDeg(a, b)) }], [...coinc(id, "e0", 0), ...coinc(id, "e1", 1)]);
      }
      case "slotArc": {
        if (next.length < 4) return step();
        const [c, st, en] = next;
        const w = Math.abs(dist(p, c) - dist(st, c)) * 2;
        const r = slotArcEntities(c, st, en, w);
        if (!r) return note(tr("Šířka drážky musí být menší než dvojnásobek poloměru osy."));
        const cons = [...r.constraints, ...(nextRefs[0] && snaps.auto ? [{ id: uid(), type: "coincident" as const, refs: [nextRefs[0]!, { e: r.entities[0].id, k: "center" }] }] : [])];
        return finish(r.entities, cons);
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
  /** Řetězec k odsazení (je-li zapnut a entita je úsečka/oblouk s návazností). */
  const offsetChainOf = (src: SketchEntity) => {
    if (!opts.chain || (src.type !== "line" && src.type !== "arc")) return null;
    const ch = chainOf(entities, src.id);
    return ch.segs.length > 1 ? ch : null;
  };
  /** Odsazení vybrané entity / řetězce: strana podle kurzoru, vzdálenost z kurzoru nebo zadaná číslem. */
  const applyOffset = (raw: Vec2, typedD: number | null) => {
    const src = picks.length ? emap.get(picks[0].ref.e) : undefined;
    if (!src) return;
    const ch = offsetChainOf(src);
    if (ch) {
      const dAbs = Math.abs(typedD ?? Math.min(...ch.segs.map((sg) => distToEntity(emap.get(sg.id)!, raw).d)));
      if (dAbs < 1e-6) return note(tr("Zadejte vzdálenost odsazení."));
      const out = offsetChain(ch.segs, ch.closed, chainSide(ch.segs, raw) * dAbs, src.construction);
      if (!out) return note(tr("Odsazení je větší než poloměr oblouku v řetězci."));
      lastVal.current.offset = dAbs;
      addEntities(out);
    } else {
      const dAbs = Math.abs(typedD ?? distToEntity(src, raw).d);
      if (dAbs < 1e-6) return note(tr("Zadejte vzdálenost odsazení."));
      const o = offsetEntity(src, r4(dAbs * offsetSide(src, raw)));
      if (!o) return note(tr("Entitu nelze o tuto vzdálenost odsadit (větší než poloměr)."));
      lastVal.current.offset = dAbs;
      addEntities([o]);
    }
    setPicks([]);
  };

  const editClick = (raw: Vec2, ev: React.PointerEvent) => {
    const id = hitEntity(raw);
    const e = id ? entities.find((x) => x.id === id) : undefined;
    switch (tool) {
      case "trim": {
        if (!id) return;
        const r = trim(entities, id, raw);
        if (r) commitEdit(r);
        else note(tr("Tento úsek nelze oříznout (kružnice potřebuje 2 průsečíky)."));
        return;
      }
      case "extend": {
        if (!id) return;
        const r = extend(entities, id, raw);
        if (r) commitEdit(r);
        else note(tr("Úsečku nelze k ničemu prodloužit."));
        return;
      }
      case "split": {
        const sn = computeSnap(raw);
        const sid = hitEntity(sn.p) ?? id;
        const se = sid ? emap.get(sid) : undefined;
        if (!se) return;
        if (se.type === "circle") {
          if (!pts.length) {
            setPts([sn.p]);
            return note(tr("Kružnice: klikněte na druhý bod rozdělení."));
          }
          const r = splitCircle(entities, se.id, pts[0], sn.p);
          setPts([]);
          if (r) commitEdit(r);
          else note(tr("Body rozdělení kružnice jsou totožné."));
          return;
        }
        const r = splitAt(entities, se.id, sn.p);
        if (r) commitEdit(r);
        else note(se.type === "line" || se.type === "arc" ? tr("Klikněte dovnitř křivky, ne na její konec.") : tr("Rozdělit lze úsečku, oblouk nebo kružnici – tvary nejdřív rozložte."));
        return;
      }
      case "offset": {
        if (!picks.length) {
          if (!e) return;
          setPicks([{ kind: "entity", ref: { e: e.id, k: "self" } }]);
          return;
        }
        applyOffset(raw, dynNum("d"));
        return;
      }
      case "fillet":
      case "chamfer": {
        if (!e || e.type !== "line") return note(tr("Vyberte úsečku."));
        if (!picks.length) return setPicks([{ kind: "line", ref: { e: e.id, k: "self" } }]);
        if (picks[0].ref.e === e.id) return;
        const id1 = picks[0].ref.e;
        setAsk({
          label: tool === "fillet" ? tr("Poloměr") : tr("Vzdálenost"),
          value: lastVal.current[tool],
          at: raw,
          onOk: (v) => {
            lastVal.current[tool] = v;
            const r = tool === "fillet" ? filletLines(entities, id1, e.id, v) : chamferLines(entities, id1, e.id, v);
            if (!r) return note(tr("Roh nelze upravit (hodnota je příliš velká nebo úsečky jsou rovnoběžné)."));
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
        return note(tr("Vazba „{0}“: {1}.", CON_INFO[tool.slice(4) as ConType].label, CON_INFO[tool.slice(4) as ConType].hint));
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
    const p = resolvePoint(s).p;
    switch (tool) {
      case "mirror": {
        const id = hitEntity(raw, new Set(ids));
        const ax = id ? entities.find((x) => x.id === id) : undefined;
        if (!ax || ax.type !== "line") return note(tr("Klikněte na úsečku nebo osu zrcadlení."));
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
        if (tool === "rotate") commitEdit(entities.map((x) => (sel.has(x.id) ? transformEntity(x, xfRotate(c, dynNum("ang") ?? angDeg(c, p) - angDeg(c, r0))) : x)));
        else {
          const k = dynNum("k") ?? dist(c, p) / (dist(c, r0) || 1);
          if (k > 1e-6) commitEdit(entities.map((x) => (sel.has(x.id) ? transformEntity(x, xfScale(c, k)) : x)));
        }
        setDyn(emptyDyn);
        setTool("select");
        return;
      }
      case "patternLinear": {
        if (!pts.length) return setPts([p]);
        const step = sub(p, pts[0]);
        setAsk({
          label: tr("Počet kusů"),
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
          label: tr("Počet kusů (360°)"),
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
      if (picks[0].kind === "point") return note(tr("Vyberte druhý bod nebo úsečku."));
    }
    const d = dimFromPicks(picks, raw);
    if (d) placeDim(d.type, d.refs, raw, d.anchor);
    else note(tr("Tuto kombinaci nelze okótovat."));
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
      if (p.kind === "point") return { title: tr("Bod"), rows: [["X", fmt(p.p[0], 3)], ["Y", fmt(p.p[1], 3)]] };
      if (p.kind === "line") {
        const l = refLine(m, p.ref)!;
        return { title: tr("Úsečka"), rows: [[tr("Délka"), `${fmt(dist(l[0], l[1]), 3)} mm`], [tr("Úhel k ose X"), `${fmt(((angDeg(l[0], l[1]) % 360) + 360) % 360, 2)}°`]] };
      }
      if (p.kind === "circle") {
        const c = refCircle(m, p.ref)!;
        return { title: tr("Kružnice / oblouk"), rows: [[tr("Poloměr"), `${fmt(c.r, 3)} mm`], [tr("Průměr"), `${fmt(c.r * 2, 3)} mm`], [tr("Obvod"), `${fmt(2 * Math.PI * c.r, 3)} mm`], [tr("Střed"), `${fmt(c.c[0], 2)} ; ${fmt(c.c[1], 2)}`]] };
      }
      return { title: tr("Entita"), rows: [] };
    }
    const [a, b] = ps;
    const P = (x: Pick): Vec2 | null => (x.kind === "point" ? x.p : null);
    const pa = P(a);
    const pb = P(b);
    if (pa && pb) return { title: tr("Vzdálenost bodů"), line: [pa, pb], rows: [[tr("Vzdálenost"), `${fmt(dist(pa, pb), 3)} mm`], ["ΔX", fmt(Math.abs(pb[0] - pa[0]), 3)], ["ΔY", fmt(Math.abs(pb[1] - pa[1]), 3)], [tr("Úhel"), `${fmt(angDeg(pa, pb), 2)}°`]] };
    if (a.kind === "line" && b.kind === "line") {
      const la = refLine(m, a.ref)!;
      const lb = refLine(m, b.ref)!;
      const ang = angleBetween(la[0], la[1], lb[0], lb[1]);
      const rows: [string, string][] = [[tr("Úhel"), `${fmt(ang, 3)}° (${fmt(180 - ang, 3)}°)`]];
      if (ang < 0.01 || ang > 179.99) rows.push([tr("Vzdálenost (rovnoběžné)"), `${fmt(distToEntity(m.get(a.ref.e)!, lb[0]).d, 3)} mm`]);
      return { title: tr("Dvě úsečky"), rows };
    }
    const pt = pa ?? pb;
    const other = pa ? b : a;
    if (pt) {
      const r = distToEntity(m.get(other.ref.e)!, pt);
      return { title: tr("Bod – entita"), line: [pt, r.p], rows: [[tr("Nejmenší vzdálenost"), `${fmt(r.d, 3)} mm`]] };
    }
    const ca = refCircle(m, a.ref);
    const cb = refCircle(m, b.ref);
    if (ca && cb) return { title: tr("Dvě kružnice"), line: [ca.c, cb.c], rows: [[tr("Vzdálenost středů"), `${fmt(dist(ca.c, cb.c), 3)} mm`], [tr("Mezera"), `${fmt(dist(ca.c, cb.c) - ca.r - cb.r, 3)} mm`]] };
    return { title: tr("Měření"), rows: [] };
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
    if (tool === "trim" && ev.button === 0) {
      // výkonný ořez: tažení přes víc úseků (klik bez pohybu = běžný ořez)
      drag.current = { kind: "trimPath", path: [raw] };
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
    lastRaw.current = raw;
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
    if (d?.kind === "trimPath") {
      d.path.push(raw);
      setCursor(raw);
      setHover(hitEntity(raw));
      if (d.path.length > 2) setTrimPreview([...d.path]);
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
    const drawTool = !["select", "trim", "extend", "offset", "fillet", "chamfer", "dimension", "measure", "mirror", "construction", "explode", "split", "project"].includes(tool) && !tool.startsWith("con-") && !(SEL_TOOLS.has(tool) && phase === 0);
    if (drawTool || tool === "dimension" || tool === "measure" || tool === "split" || tool.startsWith("con-")) {
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
    if (d?.kind === "trimPath") {
      setTrimPreview(null);
      if (!clicked && d.path.length > 1) {
        const r = powerTrim(entities, d.path);
        if (r) commitEdit(r);
        else note(tr("Tažení neprotnulo žádnou křivku."));
        return;
      }
    }
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
    if (tool === "project") return;
    const isEdit = ["trim", "extend", "split", "offset", "fillet", "chamfer", "dimension", "measure"].includes(tool) || tool.startsWith("con-") || SEL_TOOLS.has(tool);
    if (isEdit) editClick(raw, ev);
    else toolClick(raw, ev);
  };

  const onDoubleClick = (ev: React.MouseEvent) => {
    if (tool === "polyline" || tool === "spline") return finishPoly(false);
    const ann = hitAnn(ev.clientX, ev.clientY);
    const d = ann ? dims.find((x) => x.id === ann.id) : null;
    if (d) {
      const m = new Map(entities.map((x) => [x.id, x]));
      setAsk({ label: tr("Hodnota kóty"), value: r4(measureDim(m, d) ?? d.value), suffix: d.type === "angle" ? "°" : "mm", at: toMm(ev.clientX, ev.clientY), onOk: (v) => setDimValue(d.id, v) });
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
        entries.push({ divider: true, label: tr("Kóta") });
        entries.push({ id: "edit", label: tr("Upravit hodnotu…"), icon: "edit", onClick: () => setAsk({ label: tr("Hodnota kóty"), value: d.value, suffix: d.type === "angle" ? "°" : "mm", at: raw, onOk: (v) => setDimValue(d.id, v) }) });
        entries.push({ id: "drv", label: d.driving ? tr("Změnit na referenční") : tr("Změnit na řídicí"), icon: "dimension", onClick: () => (d.driving ? onChange({ dims: dims.map((x) => (x.id === d.id ? { ...x, driving: false } : x)) }, true) : setDimValue(d.id, measureDim(new Map(entities.map((x) => [x.id, x])), d) ?? d.value)) });
      } else entries.push({ divider: true, label: tr("Vazba: {0}", CON_INFO[constraints.find((c) => c.id === ann.id)?.type ?? "fixed"].label) });
      entries.push({ id: "del", label: tr("Smazat"), icon: "trash", tone: "cut", kbd: "Del", onClick: () => onChange({ constraints: constraints.filter((c) => c.id !== ann.id), dims: dims.filter((x) => x.id !== ann.id) }, true) });
    } else if (current.length) {
      const es = entities.filter((e) => current.includes(e.id));
      const pk = es.map((e) => pickOfEntity(e, raw));
      entries.push({ divider: true, label: es.length === 1 ? tr(TYPE_LABEL[es[0].type]) : tr("{0} entit", es.length) });
      entries.push({ id: "del", label: tr("Smazat"), icon: "trash", tone: "cut", kbd: "Del", onClick: () => { commitEdit(entities.filter((x) => !current.includes(x.id))); setSelection([]); } });
      entries.push({ id: "cons", label: es[0].construction ? tr("Normální geometrie") : tr("Pomocná geometrie"), icon: "construction", onClick: () => toggleConstruction(current) });
      entries.push({ id: "copy", label: tr("Kopírovat…"), icon: "copy", onClick: () => setTool("copy") });
      entries.push({ id: "move", label: tr("Přesunout…"), icon: "move", onClick: () => setTool("move") });
      entries.push({ id: "rot", label: tr("Otočit…"), icon: "rotate", onClick: () => setTool("rotate") });
      entries.push({ id: "mir", label: tr("Zrcadlit…"), icon: "mirror", onClick: () => setTool("mirror") });
      entries.push({ id: "sc", label: tr("Měřítko…"), icon: "scale", onClick: () => setTool("scale") });
      if (es.length === 1) entries.push({ id: "off", label: tr("Odsadit…"), icon: "offset", onClick: () => { setTool("offset"); setTimeout(() => setPicks([{ kind: "entity", ref: { e: es[0].id, k: "self" } }]), 0); } });
      if (es.some((e) => ["rect", "polygon", "slot", "polyline"].includes(e.type))) entries.push({ id: "exp", label: tr("Rozložit na úsečky a oblouky"), icon: "explode", onClick: () => doExplode(current) });
      if (es.length === 1 && (es[0].type === "line" || es[0].type === "arc" || es[0].type === "circle")) entries.push({ id: "split", label: tr("Rozdělit v bodě…"), icon: "split", onClick: () => setTool("split") });
      entries.push({ id: "dim", label: tr("Okótovat"), icon: "dimension", kbd: "D", onClick: () => setTool("dimension") });
      if (es.length === 1 && es[0].type === "arc") {
        const arc = es[0];
        entries.push({ id: "alen", label: tr("Kóta délky oblouku"), icon: "dimension", onClick: () => placeDim("arcLength", [{ e: arc.id, k: "self" }], raw, circleFrom3(arc.a, arc.b, arc.c)?.c ?? raw) });
      }
      const applicable = (Object.keys(CON_INFO) as ConType[]).filter((t) => Array.isArray(matchConstraint(t, pk)));
      if (applicable.length) {
        entries.push({ divider: true, label: tr("Vazby") });
        for (const t of applicable) entries.push({ id: `c-${t}`, label: CON_INFO[t].label, icon: CON_INFO[t].icon, tone: "pattern", onClick: () => { const m = matchConstraint(t, pk); if (Array.isArray(m)) applyConstraint(t, m); } });
      }
    } else {
      entries.push({ divider: true, label: tr("Uchopování") });
      const on = (v: boolean, l: string) => `${v ? "✓" : "○"}  ${l}`;
      for (const k of SNAP_ORDER) entries.push({ id: `s-${k}`, label: on(snaps[k], tr(SNAP_LABEL[k])), icon: "magnet", onClick: () => setSnap(k, !snaps[k]) });
      entries.push({ id: "s-infer", label: on(snaps.infer, tr("Zarovnání (vodítka)")), icon: "magnet", onClick: () => setSnap("infer", !snaps.infer) });
      entries.push({ id: "s-auto", label: on(snaps.auto, tr("Automatické vazby")), icon: "cCoincident", onClick: () => setSnap("auto", !snaps.auto) });
      if (setSnapGrid) entries.push({ id: "grid", label: on(snapGrid, tr("Přichytit k mřížce")), icon: "grid", kbd: "G", onClick: () => setSnapGrid(!snapGrid) });
      entries.push({ divider: true });
      entries.push({ id: "fit", label: tr("Zobrazit vše"), icon: "fit", kbd: "F", onClick: fit });
      entries.push({ id: "all", label: tr("Vybrat vše"), icon: "select", kbd: "Ctrl+A", onClick: () => setSelection(entities.map((e) => e.id)) });
      if (tool !== "select") entries.push({ id: "cancel", label: tr("Zrušit příkaz"), icon: "x", kbd: "Esc", onClick: () => setTool("select") });
      if (onFinish) entries.push({ id: "finish", label: tr("Dokončit skicu"), icon: "check", tone: "pattern", onClick: onFinish });
    }
    setCtx({ x: ev.clientX, y: ev.clientY, entries });
  };

  // ---------- klávesy ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input,textarea,select")) return;
      if (ask) return;
      // číselné zadání u kurzoru: psaní hodnot, Tab = další pole (zámek), Enter = potvrdit, Esc = smazat
      if (spec.length && !(e.ctrlKey || e.metaKey || e.altKey)) {
        const cur = dyn.texts[dyn.active] ?? "";
        const sepLike = (e.key === "x" || e.key === "X") && cur.trim().length > 0 && spec.length > 1;
        if (/^[0-9.,;@<+*/()\-]$/.test(e.key)) {
          e.preventDefault();
          setDyn((d) => {
            const texts = [...d.texts];
            texts[d.active] = (texts[d.active] ?? "") + e.key;
            return { ...d, texts };
          });
          return;
        }
        if (e.key === "Tab" || sepLike) {
          e.preventDefault();
          setDyn((d) => {
            const locked = [...d.locked];
            if ((d.texts[d.active] ?? "").trim()) locked[d.active] = true;
            return { ...d, locked, active: (d.active + 1) % spec.length };
          });
          return;
        }
        if (e.key === "Backspace" && cur.length) {
          e.preventDefault();
          setDyn((d) => {
            const texts = [...d.texts];
            texts[d.active] = cur.slice(0, -1);
            return { ...d, texts };
          });
          return;
        }
        if (e.key === "Enter" && dynTyped) {
          e.preventDefault();
          confirmDyn();
          return;
        }
        if (e.key === "Escape" && dynTyped) {
          setDyn(emptyDyn);
          return;
        }
      }
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
      if (k === "d" && sel.size === 1 && !pts.length && !picks.length) {
        // D nad vybranou (právě nakreslenou) entitou = kóta hned: úsečka → délka, kružnice → průměr, oblouk → poloměr,
        // obdélník / mnohoúhelník → délka první strany; další klik kótu umístí
        const e = emap.get([...sel][0]);
        if (e && e.type !== "point" && e.type !== "spline" && e.type !== "ellipse") {
          const kp = keyPoints(e);
          const at = e.type === "line" ? kp.mid : e.type === "rect" ? kp.m0 : e.type === "polygon" ? ([(kp.c0[0] + kp.c1[0]) / 2, (kp.c0[1] + kp.c1[1]) / 2] as Vec2) : e.type === "polyline" ? ([(e.points[0][0] + e.points[1][0]) / 2, (e.points[0][1] + e.points[1][1]) / 2] as Vec2) : kp.center;
          const pk = pickOfEntity(e, at ?? [0, 0]);
          if (pk.kind !== "entity") {
            setTool("dimension");
            setTimeout(() => setPicks([pk]), 0);
            return;
          }
        }
      }
      if (KEYS[k]) setTool(KEYS[k]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ======================= vykreslení =======================
  const { loops, openCount } = useMemo(() => findLoops(entities), [entities]);
  const fillPath = useMemo(() => loops.map((l) => "M" + loopPolygon(l).map((p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`).join("L") + "Z").join(" "), [loops]);
  const conflictSet = useMemo(() => new Set([...status.conflicts, ...status.redundant]), [status.conflicts, status.redundant]);
  // promítnutí hran modelu (náhled i vložení)
  const projected = useMemo(
    () => (tool === "project" && modelLines && modelLines.length ? projectModelLines(modelLines, sketch.plane, { inPlaneOnly: !opts.projAll, construction: opts.projConstruction || undefined }) : []),
    [tool, modelLines, sketch.plane, opts.projAll, opts.projConstruction],
  );
  const doProject = () => {
    if (!projected.length) return;
    // promítnuté hrany jsou vázané na model → pevné (plně určené), jako „převést entity“ v SolidWorks
    const fixed: SketchConstraint[] = projected.map((e) => ({ id: uid(), type: "fixed", refs: [{ e: e.id, k: "self" }], value: paramsOf(e) }));
    addEntities(projected, fixed);
    note(tr("Promítnuto {0} hran.", projected.length));
    setTool("select");
  };
  // zvýraznění řetězce při odsazení
  const chainIds = useMemo(() => {
    if (tool !== "offset" || !picks.length || !opts.chain) return [] as string[];
    const src = emap.get(picks[0].ref.e);
    if (!src || (src.type !== "line" && src.type !== "arc")) return [];
    const ch = chainOf(entities, src.id);
    return ch.segs.length > 1 ? ch.segs.map((s) => s.id) : [];
  }, [tool, picks, opts.chain, emap, entities]);

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

  // výsledný bod kurzoru po zadání hodnot a odvození vazeb (náhled musí odpovídat kliknutí)
  const resolved = cursor && snapState && tool !== "select" ? resolvePoint(snapState) : null;
  const cursorPt = resolved?.p ?? cursor;

  /** živá hodnota pole zadání (z polohy kurzoru), dokud uživatel nic nenapsal */
  const liveValue = (key: string): string => {
    const c = cursorPt;
    if (!c) return "";
    const n = pts.length;
    const from = n ? pts[n - 1] : null;
    const c0 = pts[0];
    const perpTo = (a: Vec2, b: Vec2) => Math.abs(sideDist(c, a, b));
    switch (key) {
      case "x":
        return fmt(c[0]);
      case "y":
        return fmt(c[1]);
      case "len":
        return from ? fmt(dist(from, c)) : "";
      case "ang":
        return from ? fmt(((angDeg(from, c) % 360) + 360) % 360) : "";
      case "w":
        if (!c0) return "";
        if (tool === "rectCenter") return fmt(Math.abs(c[0] - c0[0]) * 2);
        if (tool === "rect3") return fmt(dist(c0, c));
        if (tool === "slot" && n >= 2) return fmt(perpTo(c0, pts[1]) * 2);
        if (tool === "slotArc" && n >= 2) return fmt(Math.abs(dist(c, c0) - dist(pts[1], c0)) * 2);
        return fmt(Math.abs(c[0] - c0[0]));
      case "h":
        if (!c0) return "";
        if (tool === "rectCenter") return fmt(Math.abs(c[1] - c0[1]) * 2);
        if (tool === "rect3" && n >= 2) return fmt(perpTo(c0, pts[1]));
        return fmt(Math.abs(c[1] - c0[1]));
      case "r": {
        if (!c0) return "";
        if (tool === "circle") return fmt(dist(c0, c) * (opts.diameter ? 2 : 1));
        if (tool === "arc" && n >= 2) return fmt(circleFrom3(c0, c, pts[1])?.r ?? 0);
        if (tool === "arcTangent") {
          const a = tangentArc(entities, ptRefs[0], c0, c);
          return a ? fmt(circleFrom3(a.a, a.b, a.c)?.r ?? 0) : "";
        }
        return fmt(dist(c0, c));
      }
      case "d": {
        if (tool === "offset") {
          const src = picks.length ? emap.get(picks[0].ref.e) : undefined;
          return src ? fmt(chainIds.length ? Math.min(...chainIds.map((id) => distToEntity(emap.get(id)!, c).d)) : distToEntity(src, c).d) : "";
        }
        return c0 ? fmt(dist(c0, c)) : "";
      }
      case "sweep":
        return c0 && n >= 2 ? fmt(((angDeg(c0, c) - angDeg(c0, pts[1]) + 720) % 360)) : "";
      case "sides":
        return String(opts.sides);
      case "rx":
        return c0 ? fmt(dist(c0, c)) : "";
      case "ry":
        return c0 && n >= 2 ? fmt(perpTo(c0, pts[1])) : "";
      case "k":
        return c0 && n >= 2 ? fmt(dist(c0, c) / (dist(c0, pts[1]) || 1), 3) : "";
    }
    return "";
  };

  // náhled nástroje
  const preview = (() => {
    const c = cursorPt;
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
      if ((tool === "move" || tool === "copy") && pts.length) return <g>{ghost(chosen.map((e) => transformEntity(e, xfMove(sub(c, pts[0])), true)))}{label(c, tr("Δ {0} ; {1}", fmt(c[0] - pts[0][0]), fmt(c[1] - pts[0][1])))}</g>;
      if (tool === "rotate" && pts.length === 2) {
        const a = dynNum("ang") ?? angDeg(pts[0], c) - angDeg(pts[0], pts[1]);
        return <g>{ghost(chosen.map((e) => transformEntity(e, xfRotate(pts[0], a), true)))}{label(c, `${fmt(a)}°`)}</g>;
      }
      if (tool === "scale" && pts.length === 2) {
        const k = dynNum("k") ?? dist(pts[0], c) / (dist(pts[0], pts[1]) || 1);
        return <g>{ghost(chosen.map((e) => transformEntity(e, xfScale(pts[0], k), true)))}{label(c, `× ${fmt(k, 3)}`)}</g>;
      }
      if (tool === "patternLinear" && pts.length) return <g>{ghost(linearPattern(chosen, sub(c, pts[0]), lastVal.current.count))}{label(c, tr("krok {0} mm", fmt(dist(pts[0], c))))}</g>;
      if (tool === "patternCircular") return <g>{ghost(circularPattern(chosen, c, lastVal.current.ccount))}</g>;
      if (tool === "mirror") {
        const id = hitEntity(c, sel);
        const ax = id ? entities.find((x) => x.id === id) : undefined;
        if (ax?.type === "line") return <g>{ghost(chosen.map((e) => transformEntity(e, xfMirror(ax.a, ax.b), true)))}</g>;
      }
      return null;
    }
    if (tool === "offset" && picks.length) {
      const src = emap.get(picks[0].ref.e);
      if (!src) return null;
      const dT = dynNum("d");
      const ch = offsetChainOf(src);
      if (ch) {
        const dAbs = Math.abs(dT ?? Math.min(...ch.segs.map((sg) => distToEntity(emap.get(sg.id)!, c).d)));
        const out = offsetChain(ch.segs, ch.closed, chainSide(ch.segs, c) * dAbs, src.construction);
        return out ? <g>{ghost(out)}{label(c, tr("{0} mm · řetězec {1}", fmt(dAbs), ch.segs.length))}</g> : label(c, tr("odsazení > poloměr"));
      }
      const d = Math.abs(dT ?? distToEntity(src, c).d) * offsetSide(src, c);
      const o2 = offsetEntity(src, d);
      return o2 ? <g>{ghost([o2])}{label(c, `${fmt(Math.abs(d))} mm`)}</g> : null;
    }
    if (tool === "project") return projected.length ? <g opacity={0.7}>{ghost(projected).map((n, i) => <g key={i} stroke="#6b7785">{n}</g>)}</g> : null;
    if (tool === "trim" && trimPreview && trimPreview.length > 1) return <polyline points={trimPreview.map(P).join(" ")} fill="none" stroke="#dc2626" strokeWidth={1.5} strokeDasharray="4 3" />;
    if (tool === "split" && pts.length === 1) return <circle cx={toPx(pts[0])[0]} cy={toPx(pts[0])[1]} r={4} fill="#9333ea" />;
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
            {label(c, tr("{0} mm · {1}°", fmt(dist(last, c)), fmt(((angDeg(last, c) % 360) + 360) % 360)))}
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
      case "rect3": {
        if (pts.length === 1) return <g><polyline points={[pts[0], c].map(P).join(" ")} {...stroke} />{label(c, tr("{0} mm · {1}°", fmt(dist(pts[0], c)), fmt(((angDeg(pts[0], c) % 360) + 360) % 360)))}</g>;
        const r3 = rectFrom3(pts[0], pts[1], c);
        return r3 ? <g><polygon points={entityPath(r3).pts.map(P).join(" ")} {...stroke} fill="rgba(37,99,235,.05)" />{label(c, `${fmt(r3.w)} × ${fmt(r3.h)}`)}</g> : <polyline points={[pts[0], pts[1]].map(P).join(" ")} {...stroke} />;
      }
      case "circle":
      case "circle2":
      case "polygon": {
        const r = dist(pts[0], c);
        const [cx, cy] = toPx(pts[0]);
        if (tool === "polygon") {
          const pg = polygonFrom(pts[0], c, opts.sides, opts.circumscribed);
          return (
            <g>
              <circle cx={cx} cy={cy} r={r * view.scale} {...stroke} strokeDasharray="2 4" />
              {pg && <polygon points={entityPath(pg).pts.map(P).join(" ")} {...stroke} fill="rgba(37,99,235,.05)" />}
              {label(c, tr("{0} stran · R {1} ({2})", opts.sides, fmt(r), opts.circumscribed ? tr("vepsaná") : tr("opsaná")))}
            </g>
          );
        }
        if (tool === "circle2") {
          const c2 = circleFrom2(pts[0], c);
          return c2 ? <g><circle cx={toPx([c2.cx, c2.cy])[0]} cy={toPx([c2.cx, c2.cy])[1]} r={c2.r * view.scale} {...stroke} fill="rgba(37,99,235,.05)" />{label(c, `Ø ${fmt(r)}`)}</g> : null;
        }
        return (
          <g>
            <circle cx={cx} cy={cy} r={r * view.scale} {...stroke} fill="rgba(37,99,235,.05)" />
            <line x1={cx} y1={cy} x2={toPx(c)[0]} y2={toPx(c)[1]} stroke="#2563eb" strokeDasharray="2 3" />
            {label(c, opts.diameter ? `Ø ${fmt(r * 2)}` : `R ${fmt(r)}`)}
          </g>
        );
      }
      case "slotArc": {
        if (pts.length === 1) return <g><polyline points={[pts[0], c].map(P).join(" ")} {...stroke} />{label(c, `R ${fmt(dist(pts[0], c))}`)}</g>;
        if (pts.length === 2) {
          const a = arcFromCenter(pts[0], pts[1], c);
          return a ? <g><polyline points={entityPath(a).pts.map(P).join(" ")} {...stroke} />{label(c, `${fmt(((angDeg(pts[0], c) - angDeg(pts[0], pts[1]) + 720) % 360))}°`)}</g> : null;
        }
        const w = Math.abs(dist(c, pts[0]) - dist(pts[1], pts[0])) * 2;
        const sa = slotArcEntities(pts[0], pts[1], pts[2], w);
        return sa ? <g>{ghost(sa.entities)}{label(c, tr("šířka {0}", fmt(w)))}</g> : label(c, tr("šířka > poloměr"));
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
  const dofText =
    status.status === "over"
      ? status.conflicts.length
        ? tr("Přeurčeno – konflikt ({0})", status.conflicts.length)
        : tr("Přeurčeno – nadbytečné vazby ({0})", status.redundant.length)
      : status.dof === 0
        ? tr("Plně určeno")
        : status.dof > 0
          ? tr("Nedourčeno ({0} st. volnosti)", status.dof)
          : "…";

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
          <EntityLayer paths={paths} entities={entities} sel={sel} hover={hover} states={status.states} k={view.scale} />
        </g>
        {chainIds.map((id) => {
          const pp = paths.get(id);
          return pp ? <polyline key={"ch" + id} points={pp.pts.map(P).join(" ")} fill="none" stroke="#9333ea" strokeWidth={3} opacity={0.35} /> : null;
        })}
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
        {/* náhled odvozených vazeb u kurzoru (žluté ikony jako v SolidWorks) */}
        {resolved && resolved.kinds.length > 0 && cursorPt && (
          <g transform={`translate(${toPx(cursorPt)[0] + 14},${toPx(cursorPt)[1] - 32})`} pointerEvents="none">
            {resolved.kinds.map((k, i) => (
              <g key={k} transform={`translate(${i * 18},0)`}>
                <title>{CON_INFO[k].label}</title>
                <rect width={16} height={16} rx={3} fill="#fef3c7" stroke="#d97706" strokeWidth={1} />
                <text x={8} y={12} textAnchor="middle" fontSize={10} fontWeight={700} fill="#92400e" fontFamily="Roboto, Arial">
                  {CON_INFO[k].glyph}
                </text>
              </g>
            ))}
          </g>
        )}
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
            title={tr("Uchopení: {0}", tr(SNAP_LABEL[k]))}
            onClick={() => setSnap(k, !snaps[k])}
            className={cn("grid h-6 w-6 place-items-center rounded", snaps[k] ? "bg-[#dbeafe] text-[#1d4ed8]" : "text-[#9aa5b1] hover:bg-[#eef2f6]")}
          >
            <svg viewBox="-8 -8 16 16" className="h-4 w-4">
              <GlyphShape kind={k} />
            </svg>
          </button>
        ))}
        <span className="mx-0.5 h-4 w-px bg-[#d5dbe2]" />
        <button type="button" title={tr("Zarovnání (vodítka)")} onClick={() => setSnap("infer", !snaps.infer)} className={cn("rounded px-1.5 text-[10.5px] font-semibold", snaps.infer ? "bg-[#cffafe] text-[#0e7490]" : "text-[#9aa5b1]")}>
          ⋯
        </button>
        <Tgl on={snaps.auto} title={tr("Automatické vazby při kreslení (vodorovně, svisle, totožnost, bod na křivce, střed, rovnoběžně, kolmo, tečně)")} onClick={() => setSnap("auto", !snaps.auto)}>
          AV
        </Tgl>
        <Tgl on={opts.autoDim} title={tr("Kótovat při kreslení – hodnoty zadané číslem u kurzoru vloží řídicí kótu")} onClick={() => setOpt("autoDim", !opts.autoDim)} className="bg-[#dbeafe] text-[#1d4ed8]">
          {tr("Kóty")}
        </Tgl>
        {(tool === "circle" || tool === "circle2") && (
          <Tgl on title={opts.diameter ? tr("Zadávat průměr (přepnout na poloměr)") : tr("Zadávat poloměr (přepnout na průměr)")} onClick={() => setOpt("diameter", !opts.diameter)} className="bg-[#ede9fe] text-[#6d28d9]">
            {opts.diameter ? "Ø" : "R"}
          </Tgl>
        )}
        {tool === "polygon" && (
          <>
            <Tgl on title={tr("Vepsaný: bod = vrchol (poloměr opsané kružnice) · Opsaný: bod = střed strany (poloměr vepsané kružnice)")} onClick={() => setOpt("circumscribed", !opts.circumscribed)} className="bg-[#ede9fe] text-[#6d28d9]">
              {opts.circumscribed ? tr("Opsaný") : tr("Vepsaný")}
            </Tgl>
            <input
              type="number"
              min={3}
              max={64}
              value={opts.sides}
              title={tr("Počet stran")}
              onChange={(e) => setOpt("sides", Math.max(3, Math.min(64, Math.round(Number(e.target.value) || 6))))}
              className="h-5 w-10 rounded border border-[#cfd6de] px-1 text-[10.5px]"
            />
          </>
        )}
        {tool === "offset" && (
          <Tgl on={opts.chain} title={tr("Odsadit celý navazující řetězec úseček a oblouků")} onClick={() => setOpt("chain", !opts.chain)} className="bg-[#ede9fe] text-[#6d28d9]">
            {tr("Řetězec")}
          </Tgl>
        )}
      </div>

      {/* promítnutí hran modelu */}
      {tool === "project" && (
        <div className="absolute right-3 top-3 w-64 rounded-md border border-[#cfd6de] bg-white/95 p-3 text-[12px] shadow-lg backdrop-blur" onPointerDown={(e) => e.stopPropagation()}>
          <p className="mb-1.5 flex items-center gap-1.5 font-semibold">
            <CadIcon name="face" tone="feature" className="h-4 w-4" />
            {tr("Promítnout hrany modelu")}
          </p>
          {!modelLines?.length ? (
            <p className="text-[#6b7785]">{tr("Model zatím nemá žádné hrany (nejdřív vytvořte těleso).")}</p>
          ) : (
            <>
              <label className="flex cursor-pointer items-center gap-2 py-0.5">
                <input type="radio" name="proj" checked={!opts.projAll} onChange={() => setOpt("projAll", false)} /> {tr("Jen hrany v rovině skici (±0,01 mm)")}
              </label>
              <label className="flex cursor-pointer items-center gap-2 py-0.5">
                <input type="radio" name="proj" checked={opts.projAll} onChange={() => setOpt("projAll", true)} /> {tr("Všechny hrany (kolmý průmět)")}
              </label>
              <label className="mt-1 flex cursor-pointer items-center gap-2 py-0.5">
                <input type="checkbox" checked={opts.projConstruction} onChange={(e) => setOpt("projConstruction", e.target.checked)} /> {tr("Jako pomocná geometrie")}
              </label>
              <p className="mt-1 text-[#6b7785]">{projected.length} {tr("úseček · vloží se jako pevné (plně určené)")}</p>
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={doProject} disabled={!projected.length} className="rounded bg-[#2563eb] px-2.5 py-1 text-[11.5px] font-semibold text-white disabled:opacity-40">
                  {tr("Promítnout")}
                </button>
                <button type="button" onClick={() => setTool("select")} className="rounded border border-[#cfd6de] px-2.5 py-1 text-[11.5px]">
                  {tr("Zrušit")}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* číselné zadání u kurzoru */}
      {spec.length > 0 && (cursorPt || dynTyped) && tool !== "select" && (() => {
        const base = cursorPt ?? lastRaw.current ?? pts[pts.length - 1] ?? [0, 0];
        const [px, py] = toPx(base);
        return (
          <div className="pointer-events-none absolute z-10 flex items-center gap-1 rounded-md border border-[#2563eb]/60 bg-white/95 px-1.5 py-1 font-mono text-[11px] shadow-md" style={{ left: Math.max(4, px + 18), top: Math.max(4, py + 24) }}>
            {spec.map((f, i) => {
              const t = dyn.texts[i] ?? "";
              const act = i === dyn.active;
              return (
                <span key={f.key} className={cn("flex items-center gap-1 rounded px-1", act && "bg-[#dbeafe] ring-1 ring-[#2563eb]")}>
                  <span className="text-[#6b7785]">{f.label}</span>
                  <span className={cn("min-w-[3ch]", t ? "font-semibold text-[#1d4ed8]" : "text-[#9aa5b1]")}>
                    {t || liveValue(f.key)}
                    {act && <span className="animate-pulse text-[#2563eb]">|</span>}
                  </span>
                  {f.suffix && <span className="text-[#9aa5b1]">{f.suffix}</span>}
                  {dyn.locked[i] && (
                    <svg viewBox="0 0 12 12" className="h-3 w-3 text-[#1d4ed8]" aria-label={tr("zamčeno")}>
                      <rect x={2} y={5} width={8} height={6} rx={1} fill="currentColor" />
                      <path d="M4 5V3.5a2 2 0 0 1 4 0V5" fill="none" stroke="currentColor" strokeWidth={1.4} />
                    </svg>
                  )}
                </span>
              );
            })}
            <span className="ml-1 text-[9.5px] text-[#9aa5b1]">{tr("Tab · Enter")}</span>
          </div>
        );
      })()}

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

      {/* štítky bodů skici (pointer-events: none – klik na štítek dopadne na plátno a uchopí bod) */}
      {hints && sketchHints.length > 0 && (
        <div data-sketch-hints className="pointer-events-none absolute inset-0 overflow-hidden">
          {sketchHints.map((h) => (
            <div key={h.id} data-sketch-hint={h.id} title={h.title} className="absolute -translate-x-1/2 -translate-y-1/2 rounded bg-[#2563eb]/85 px-1 font-mono text-[10px] font-semibold leading-[14px] text-white shadow" style={{ left: h.x, top: h.y }}>
              {h.id}
            </div>
          ))}
        </div>
      )}
      {/* výzva + stav */}
      <div className="pointer-events-none absolute bottom-3 left-3 right-3 flex flex-wrap items-center gap-1.5 font-mono text-[10.5px] text-[#26303b]">
        <span className="rounded border border-[#c9d1da] bg-white/90 px-2 py-0.5">
          X {cursor ? fmt(cursor[0]) : "—"} {tr("· Y")}{" "}{cursor ? fmt(cursor[1]) : "—"}
        </span>
        <span className="rounded border border-[#c9d1da] bg-white/90 px-2 py-0.5">{tr("mřížka")}{" "}{fmt(gridStep)}</span>
        <span className="rounded border border-[#c9d1da] bg-white/90 px-2 py-0.5">
          {loops.length} profil{loops.length === 1 ? "" : loops.length > 1 && loops.length < 5 ? "y" : tr("ů")}
          {openCount ? tr(" · {0} otevř.", openCount) : ""}
        </span>
        <span
          title={tr("Barvy entit: modře nedourčená · černě plně určená · červeně přeurčená nebo v konfliktu")}
          className={cn("rounded border px-2 py-0.5", status.status === "over" ? "border-red-300 bg-red-50 text-red-700" : status.status === "full" ? "border-green-300 bg-green-50 text-green-700" : "border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]")}
        >
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
  if (SEL_TOOLS.has(tool) && phase === 0) return selN ? tr("Vybráno {0} – Enter / pravé tl. pokračuje", selN) : tr("Vyberte entity (Shift přidává), pak Enter");
  switch (tool) {
    case "select":
      return "";
    case "line":
    case "centerline":
      return n ? tr("Další bod · Esc / pravé tl. ukončí řetěz") : tr("Počáteční bod úsečky");
    case "polyline":
    case "spline":
      return n ? tr("Další bod · Enter / dvojklik ukončí · klik na 1. bod uzavře") : tr("První bod");
    case "rect":
      return n ? tr("Protější roh (nebo šířka Tab výška, Enter)") : tr("První roh (nebo X;Y, Enter)");
    case "rectCenter":
      return n ? tr("Roh (nebo šířka Tab výška, Enter)") : tr("Střed obdélníku");
    case "rect3":
      return n === 0 ? tr("První roh") : n === 1 ? tr("Druhý roh (směr a šířka první strany)") : tr("Výška obdélníku");
    case "circle":
      return n ? tr("Bod na kružnici (nebo zadejte průměr/poloměr, Enter)") : tr("Střed kružnice");
    case "circle2":
      return n ? tr("Druhý bod průměru") : tr("První bod průměru");
    case "circle3":
      return tr("Bod {0} ze 3 na kružnici", n + 1);
    case "arc":
      return n === 0 ? tr("Začátek oblouku") : n === 1 ? tr("Konec oblouku") : tr("Bod na oblouku");
    case "arcCenter":
      return n === 0 ? tr("Střed") : n === 1 ? tr("Začátek (poloměr)") : tr("Konec (proti směru hodin)");
    case "arcTangent":
      return n ? tr("Konec tečného oblouku") : tr("Konec úsečky / oblouku, na který navázat");
    case "ellipse":
      return n === 0 ? tr("Střed elipsy") : n === 1 ? tr("Konec hlavní poloosy") : tr("Vedlejší poloosa");
    case "point":
      return tr("Umístěte bod");
    case "polygon":
      return n ? tr("Vrchol / střed strany (nebo poloměr Tab počet stran, Enter)") : tr("Střed mnohoúhelníku");
    case "slot":
      return n === 0 ? tr("Střed prvního oblouku") : n === 1 ? tr("Střed druhého oblouku (nebo délka Tab úhel)") : tr("Šířka drážky");
    case "slotArc":
      return n === 0 ? tr("Střed oblouku osy drážky") : n === 1 ? tr("Začátek osy (poloměr)") : n === 2 ? tr("Konec osy (proti směru hodin)") : tr("Šířka drážky");
    case "trim":
      return tr("Klikněte na úsek k odstranění, nebo táhněte přes více úseků");
    case "extend":
      return tr("Klikněte u konce úsečky, která se má prodloužit");
    case "split":
      return n ? tr("Druhý bod rozdělení kružnice") : tr("Klikněte na křivku v místě rozdělení (kružnice: 2 body)");
    case "project":
      return tr("Zvolte hrany vpravo nahoře a potvrďte „Promítnout“");
    case "offset":
      return picks ? tr("Strana myší, vzdálenost klikem nebo číslem + Enter") : tr("Vyberte entitu (řetězec) k odsazení");
    case "fillet":
    case "chamfer":
      return picks ? tr("Druhá úsečka") : tr("První úsečka");
    case "mirror":
      return tr("Klikněte na osu zrcadlení (úsečku)");
    case "move":
    case "copy":
      return n ? tr("Cílový bod") : tr("Základní bod");
    case "rotate":
      return n === 0 ? tr("Střed otáčení") : n === 1 ? tr("Referenční bod") : tr("Cílový směr");
    case "scale":
      return n === 0 ? tr("Střed měřítka") : n === 1 ? tr("Referenční bod") : tr("Nová poloha bodu");
    case "patternLinear":
      return n ? tr("Krok pole (vzdálenost a směr)") : tr("Základní bod");
    case "patternCircular":
      return tr("Střed kruhového pole");
    case "dimension":
      return picks ? tr("Druhá entita/bod, nebo umístění kóty") : tr("Klikněte na entitu nebo bod");
    case "measure":
      return tr("Klikněte na body nebo entity (2 výběry)");
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

/** Malý přepínač v panelu uchopení / voleb kreslení. */
function Tgl({ on, title, onClick, children, className }: { on: boolean; title: string; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button type="button" title={title} onClick={onClick} className={cn("rounded px-1.5 text-[10.5px] font-semibold", on ? (className ?? "bg-[#dcfce7] text-[#15803d]") : "text-[#9aa5b1] hover:bg-[#eef2f6]")}>
      {children}
    </button>
  );
}

function SnapGlyph({ at, kind }: { at: Vec2; kind: SnapKind }) {
  return (
    <g transform={`translate(${at[0]},${at[1]})`} color="#0e7490" pointerEvents="none">
      <GlyphShape kind={kind} />
      <g transform="translate(10,-12)">
        <rect x={0} y={-10} width={tr(SNAP_LABEL[kind]).length * 6.2 + 10} height={15} rx={3} fill="#ecfeff" stroke="#0e7490" strokeWidth={0.8} />
        <text x={5} y={1} fontSize={10.5} fill="#0e7490" fontFamily="Roboto, Arial">
          {tr(SNAP_LABEL[kind])}
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
  const txt = (d.type === "radius" ? "R" : d.type === "diameter" ? "Ø" : d.type === "arcLength" ? "⌒" : "") + fmt(d.driving ? d.value : v, 2) + (d.type === "angle" ? "°" : "");
  const label = d.driving ? txt : `(${txt})`;
  const off = d.offset ?? [0, 10];
  const els: React.ReactNode[] = [];
  let tp: Vec2;
  const line = (a: Vec2, b: Vec2, k: string, dash?: string) => els.push(<line key={k} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={col} strokeWidth={0.9} strokeDasharray={dash} />);
  if (d.type === "radius" || d.type === "diameter" || d.type === "arcLength") {
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
