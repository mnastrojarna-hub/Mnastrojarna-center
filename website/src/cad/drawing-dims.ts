/**
 * Chytré kóty (ČSN EN ISO 129-1): sada kót odvozená z prvků modelu a jeho geometrie – ne z každé promítnuté čáry.
 * Výsledek jsou UPRAVITELNÉ poznámky výkresu s klíčem `auto` (přegenerování nahradí jen je, uživatelské zůstanou).
 *
 * Pravidla:
 * - každý funkční rozměr právě jednou (bez duplicit téhož významu i napříč pohledy), žádné uzavřené řetězce
 *   (řetěz + celková délka → nejdelší článek jako pomocná kóta v závorce);
 * - prvek se kótuje v pohledu, kde je vidět ve skutečném tvaru, nikdy na skryté hraně;
 * - rotační (soustružené) díly: průměry osazení naskládané na jedné straně (nejmenší nejblíž), délky osazení řetězově
 *   na jedné čáře (nebo od základny), celková délka ve vnější řadě; zápich šířkou a Ø, sražení „1×45°“ a zaoblení „R2“
 *   jednou s počtem „2×“; vnější závit „M20×1,5“ místo Ø s délkou závitu;
 * - hranolové díly: celkové rozměry jednou; polohy děr od základních hran (od základny / řetězově) v pohledu, kde jsou díry
 *   kružnicemi; souměrné rozmístění od osy souměrnosti; kruhové pole: roztečná kružnice Ø + „rovnoměrně“ nebo úhel;
 * - díry: JEDEN popis s odkazem na skupinu stejných děr z parametrů prvku Díra („4× M8 ↧16“ + „Ø6,8 ↧20“,
 *   „⌴ Ø14 ↧8,5“, „⌵ Ø16,5 × 90°“);
 * - rozmístění: cad/drawing-dims-layout.ts (řady mimo obrys, texty bez překryvů; co se nevejde, se vynechá a nahlásí).
 */
import type * as r from "replicad";
import { camOf, makeDrawing, proj, type Cam, type DrawingMeta, type DrawingOptions, type DrawingResult, type PlacedView, type ViewEnt, type ViewKey, type ViewRotation } from "./drawing";
import { DimLayout, type CallReq, type LinReq, type Side } from "./drawing-dims-layout";
import { partGeom, type GAxis, type GCone, type GCyl, type PartGeom } from "./drawing-dims-geom";
import { threadByName } from "./defaults";
import { expectedDims } from "./dim-check";
import { cadLocale, tr } from "./i18n";
import { uid, type CadDoc, type DrawingAnnotation, type Feature, type SketchPlane, type Vec2, type Vec3 } from "./types";

export type SmartReport = {
  /** druh dílu podle geometrie */
  kind: "turned" | "prismatic";
  /** počet kót podle pohledu */
  perView: Record<string, number>;
  /** co se nepodařilo čistě umístit nebo okótovat (s důvodem) */
  skipped: string[];
  /** počet očekávaných rozměrů (Kontrola kót) – pro poměr kót / rozměrů */
  expected: number;
  /** kolik kót se nevešlo (málo místa kolem pohledů) */
  noRoom: number;
};
export type SmartDims = { /** otisk modelu a rozvržení – shoda = není co přegenerovat */ gen: string; annotations: DrawingAnnotation[]; report: SmartReport };
/** `rotation` = otočení hlavního pohledu (rady „zapněte pohled …“ podle otočených kamer) */
export type SmartOptions = { style?: "chain" | "baseline"; rotation?: ViewRotation };

type PV = PlacedView & { cam: Cam };
type HoleF = Extract<Feature, { type: "hole" }>;

// ---------------------------------------------------------------- vektory a formát

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => mul(a, 1 / (len(a) || 1));
const r3 = (n: number) => (Math.round(n * 1000) / 1000 || 0).toFixed(3);
/** číslo do popisu (desetinná čárka podle jazyka, bez oddělovače tisíců) */
export const fmtDim = (n: number) => (Math.round(n * 100) / 100).toLocaleString(cadLocale(), { useGrouping: false });
const upOf = (c: Cam) => cross(c.d, c.x);
const AXV: Record<string, Vec3> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };

/** vzdálenost bodu od osy a poloha podél ní */
const onAxis = (ax: GAxis, q: Vec3) => {
  const w = sub(q, ax.p);
  const t = dot(w, ax.dir);
  return { t, rad: len(sub(w, mul(ax.dir, t))) };
};
const sameAxis = (a: GAxis, b: GAxis, tol: number) => len(cross(a.dir, b.dir)) < 1e-4 && onAxis(a, b.p).rad < tol;

/** jednoduchý otisk textu (FNV-1a) */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** Otisk modelu a rozvržení listu – Chytré kóty se přegenerují, jen když se změní. */
export function smartGenKey(doc: CadDoc, views: Pick<PlacedView, "key" | "px" | "py" | "s">[], opts: SmartOptions): string {
  const model = JSON.stringify({ f: doc.features, v: doc.variables, c: doc.configs, a: doc.activeConfig });
  const lay = views.map((v) => `${v.key}:${v.px.toFixed(2)}:${v.py.toFixed(2)}:${v.s}`).join("|");
  return hashText(`${model}#${lay}#${opts.style ?? "chain"}`);
}

/** Bod skici (u; v) ve 3D (stejně jako replicad makePlane: XY → (u; v; d), XZ → (u; −d; v), YZ → (d; u; v)). */
export function sketchPoint(pl: SketchPlane, u: number, v: number): Vec3 {
  if (pl.kind === "custom") {
    const y = cross(pl.normal, pl.xDir);
    return add(pl.origin, add(mul(pl.xDir, u), mul(y, v)));
  }
  if (pl.name === "XY") return [u, v, pl.offset];
  if (pl.name === "XZ") return [u, -pl.offset, v];
  return [pl.offset, u, v];
}
const planeNormal = (pl: SketchPlane): Vec3 => (pl.kind === "custom" ? unit(pl.normal) : pl.name === "XY" ? [0, 0, 1] : pl.name === "XZ" ? [0, -1, 0] : [1, 0, 0]);

// ---------------------------------------------------------------- popisy děr

/** kolikrát se prvek opakuje (pole, která na něj odkazují) a body poloh */
function featureInstances(doc: CadDoc, f: HoleF): Vec3[] {
  let pts: Vec3[] = f.points?.length ? f.points.flatMap((p) => (p.kind === "xyz" ? [p.p as Vec3] : [])) : [f.position];
  if (!pts.length) pts = [f.position];
  for (const g of doc.features) {
    if (g.suppressed) continue;
    if (g.type === "pattern") {
      const ids = g.featureIds?.length ? g.featureIds : [g.featureId];
      if (!ids.includes(f.id)) continue;
      if (g.kind === "linear") {
        const d1 = unit(g.dirDef?.kind === "vector" ? g.dirDef.v : g.direction);
        const d2 = unit(g.dirDef2?.kind === "vector" ? g.dirDef2.v : g.direction2 ?? [0, 1, 0]);
        const n1 = Math.max(1, Math.round(g.count));
        const n2 = Math.max(1, Math.round(g.count2 ?? 1));
        const s1 = g.spacingMode === "total" && n1 > 1 ? g.spacing / (n1 - 1) : g.spacing;
        const s2 = g.spacing2 ?? g.spacing;
        pts = pts.flatMap((p) => {
          const out: Vec3[] = [];
          for (let a = 0; a < n1; a++) for (let b = 0; b < n2; b++) out.push(add(p, add(mul(d1, s1 * a), mul(d2, s2 * b))));
          return out;
        });
      } else if (g.kind === "circular") {
        const ax = AXV[g.axis] ?? [0, 0, 1];
        const n = Math.max(1, Math.round(g.count));
        pts = pts.flatMap((p) => {
          const out: Vec3[] = [];
          for (let k = 0; k < n; k++) {
            const deg = (g.angle >= 360 ? 360 / n : g.angle / Math.max(1, n - 1)) * k;
            out.push(rotateAbout(p, g.center, ax, (deg * Math.PI) / 180));
          }
          return out;
        });
      }
    } else if (g.type === "mirror" && doc.features.indexOf(g) > doc.features.indexOf(f)) {
      const k = g.plane === "YZ" ? 0 : g.plane === "XZ" ? 1 : 2;
      pts = pts.flatMap((p) => {
        const m = [...p] as Vec3;
        m[k] = 2 * g.offset - p[k];
        return g.keepOriginal ? [p, m] : [m];
      });
    }
  }
  return pts;
}

function rotateAbout(p: Vec3, c: Vec3, ax: Vec3, a: number): Vec3 {
  const v = sub(p, c);
  const k = unit(ax);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  // Rodrigues
  const r = add(add(mul(v, cos), mul(cross(k, v), sin)), mul(k, dot(k, v) * (1 - cos)));
  return add(c, r);
}

/** směr osy díry (jednotkový, bez ohledu na smysl vrtání) */
const holeDir = (f: HoleF): Vec3 => unit(f.dirDef?.kind === "vector" ? f.dirDef.v : AXV[f.axis] ?? [0, 0, 1]);

/** Řádky popisu díry z parametrů prvku: „4× M8 ↧16“ + „Ø6,8 ↧20“, „4× Ø9 skrz“ + „⌴ Ø15 ↧9“, „⌵ Ø16,5 × 90°“. */
export function holeCallout(f: Pick<HoleF, "kind" | "diameter" | "depth" | "cbDiameter" | "cbDepth" | "csDiameter" | "csAngle" | "thread" | "threadDepth" | "end" | "tipAngle">, count: number, measuredDepth?: number): string[] {
  const n = count > 1 ? `${count}× ` : "";
  const kind = f.kind ?? (f.cbDiameter > f.diameter && f.cbDepth > 0 ? "counterbore" : "simple");
  const through = (f.end ? f.end.kind === "throughAll" || f.end.kind === "toNext" : !(f.depth > 0)) && f.end?.kind !== "toNext";
  const depth = f.end && f.end.kind !== "blind" && f.end.kind !== "throughAll" ? measuredDepth ?? 0 : f.depth;
  const deep = (d: number) => (d > 0 ? ` ↧${fmtDim(d)}` : "");
  const skrz = ` ${tr("skrz")}`;
  const lines: string[] = [];
  if (kind === "tapped" && f.thread) {
    const t = threadByName(f.thread);
    const name = t?.name ?? f.thread;
    const td = f.threadDepth && f.threadDepth > 0 ? f.threadDepth : 0;
    if (through) lines.push(`${n}${name}${skrz}`);
    else if (td > 0 && td < depth - 1e-6) lines.push(`${n}${name}${deep(td)}`, `Ø${fmtDim(t?.tap ?? f.diameter)}${deep(depth)}`);
    else lines.push(`${n}${name}${deep(depth)}`);
    return lines;
  }
  lines.push(`${n}Ø${fmtDim(f.diameter)}${through ? skrz : deep(depth)}`);
  if (kind === "counterbore" && f.cbDiameter > 0) lines.push(`⌴ Ø${fmtDim(f.cbDiameter)}${deep(f.cbDepth)}`);
  if (kind === "countersink" && (f.csDiameter ?? 0) > 0) lines.push(`⌵ Ø${fmtDim(f.csDiameter!)} × ${fmtDim(f.csAngle ?? 90)}°`);
  if (!through && f.tipAngle && Math.abs(f.tipAngle - 118) > 0.01) lines[0] += ` (${fmtDim(f.tipAngle)}°)`;
  return lines;
}

// ---------------------------------------------------------------- význam kóty (duplicity)

/** Význam délkové kóty: osa ve 3D + interval podél ní – stejná kóta v jiném pohledu má stejný klíč. */
export function linMeaning(cam: Cam, dir: "h" | "v", a: Vec2, b: Vec2, prefix = ""): string {
  let ax: Vec3 = dir === "h" ? cam.x : mul(upOf(cam), -1);
  let ca = dir === "h" ? a[0] : a[1];
  let cb = dir === "h" ? b[0] : b[1];
  const k = [0, 1, 2].reduce((m, i) => (Math.abs(ax[i]) > Math.abs(ax[m]) ? i : m), 0);
  if (ax[k] < 0) {
    ax = mul(ax, -1);
    ca = -ca;
    cb = -cb;
  }
  return `L${prefix.startsWith("Ø") || prefix.startsWith("M") ? "d" : ""}:${ax.map((v) => r3(v)).join(",")}:${r3(Math.min(ca, cb))}:${r3(Math.max(ca, cb))}`;
}

// ---------------------------------------------------------------- plánovač

type Ctx = {
  doc: CadDoc;
  g: PartGeom;
  views: PV[];
  lay: DimLayout;
  style: "chain" | "baseline";
  skipped: string[];
  /** významy již zadaných kót */
  seen: Set<string>;
  size: number;
  /** odložené délkové kóty (polohy a rozměry prvků): umístí se najednou od nejkratší (kratší blíž obrysu) */
  queue: { v: PV; req: Omit<LinReq, "view">; what: string; alt?: Partial<Record<Side, { a: Vec2; b: Vec2 }>> }[];
  /** odložené popisy děr a prvků: umístí se až po délkových kótách (pevné řady mají přednost, popis si najde jiný směr) */
  calls: { req: CallReq; what: string }[];
  noRoom: number;
  rot: ViewRotation;
  /** rotační díl: osa a čela (poloha příčných děr podél osy se kótuje od čela, ne od počátku modelu) */
  turn: { ax: GAxis; tMin: number; tMax: number; rMin: number; rMax: number } | null;
};

const P = (v: PV, p: Vec3): Vec2 => proj(v.cam, p);
const viewAlong = (c: Ctx, dir: Vec3) => c.views.filter((v) => Math.abs(dot(v.cam.d, dir)) > 0.999);
const viewSide = (c: Ctx, dir: Vec3) => c.views.filter((v) => v.key !== "section" && Math.abs(dot(v.cam.d, dir)) < 1e-3);
const VIEW_ORDER = ["front", "top", "left", "right", "bottom", "back", "section"];
const VIEW_KEYS: ViewKey[] = ["front", "back", "left", "right", "top", "bottom"];
/** pohledy, které na listu nejsou a díval by se jimi pozorovatel ve směru `dir` (podle otočených kamer) – rada „zapněte pohled …“ */
const missingViewsAlong = (c: Ctx, dir: Vec3) =>
  VIEW_KEYS.filter((k) => !c.views.some((v) => v.key === k) && Math.abs(Math.abs(dot(camOf(k, c.rot).d, dir)) - 1) < 1e-6).map((k) => tr(VIEW_NAME[k]));
const byOrder = (a: PV, b: PV) => VIEW_ORDER.indexOf(a.key) - VIEW_ORDER.indexOf(b.key);

/** viditelná (ne skrytá) kružnice / oblouk pohledu se středem c a poloměrem r */
function visibleArc(v: PV, c: Vec2, rad: number, tol = 0.02): boolean {
  return (v.ents ?? []).some((e) => e.t === "arc" && !e.hidden && Math.abs(e.r - rad) <= tol + 1e-4 * rad && Math.hypot(e.c[0] - c[0], e.c[1] - c[1]) <= tol + 1e-4 * rad);
}
/** bod leží na viditelné úsečce pohledu (vynášecí čára musí začínat na nakreslené hraně) */
function onVisibleLine(v: PV, p: Vec2, tol = 0.02): boolean {
  return (v.ents ?? []).some((e) => {
    if (e.t !== "line" || e.hidden) return false;
    const dx = e.b[0] - e.a[0];
    const dy = e.b[1] - e.a[1];
    const l2 = dx * dx + dy * dy;
    const u = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - e.a[0]) * dx + (p[1] - e.a[1]) * dy) / l2)) : 0;
    return Math.hypot(e.a[0] + u * dx - p[0], e.a[1] + u * dy - p[1]) <= tol;
  });
}
function hiddenArc(v: PV, c: Vec2, rad: number, tol = 0.02): boolean {
  return (v.ents ?? []).some((e) => e.t === "arc" && e.hidden && Math.abs(e.r - rad) <= tol && Math.hypot(e.c[0] - c[0], e.c[1] - c[1]) <= tol);
}

/** Přidá délkovou kótu (bez duplicity významu); vrátí umístění nebo null. */
function lin(c: Ctx, v: PV, req: Omit<LinReq, "view">, what: string, alt?: Partial<Record<Side, { a: Vec2; b: Vec2 }>>, quiet = false): { side: Side; row: number } | null | "dup" {
  const span = req.dir === "h" ? Math.abs(req.b[0] - req.a[0]) : Math.abs(req.b[1] - req.a[1]);
  if (span < 1e-3) return "dup";
  const m = linMeaning(v.cam, req.dir, req.a, req.b, req.prefix ?? req.text ?? "");
  if (c.seen.has(m)) return "dup";
  for (const [i, side] of req.sides.entries()) {
    const ab = alt?.[side] ?? { a: req.a, b: req.b };
    // nejnižší řada platí jen pro zamýšlenou (první) stranu – na druhé straně se řady počítají od obrysu (obsazené přeskočí placeLin)
    const res = c.lay.placeLin({ ...req, ...ab, view: v.key, sides: [side], minRow: i === 0 ? req.minRow : 0 });
    if (res) {
      c.seen.add(m);
      return res;
    }
  }
  if (!quiet) {
    c.skipped.push(tr("{0}: nevešlo se čistě na list ({1})", what, tr(VIEW_NAME[v.key] ?? v.key)));
    c.noRoom++;
  }
  return null;
}
/** Délková kóta do fronty (bez duplicity významu) – umístí ji `flushLin` společně s ostatními, kratší blíž obrysu. */
function linQ(c: Ctx, v: PV, req: Omit<LinReq, "view">, what: string, alt?: Partial<Record<Side, { a: Vec2; b: Vec2 }>>) {
  const span = req.dir === "h" ? Math.abs(req.b[0] - req.a[0]) : Math.abs(req.b[1] - req.a[1]);
  if (span < 1e-3) return;
  const m = linMeaning(v.cam, req.dir, req.a, req.b, req.prefix ?? req.text ?? "");
  if (c.seen.has(m) || c.queue.some((q) => linMeaning(q.v.cam, q.req.dir, q.req.a, q.req.b, q.req.prefix ?? q.req.text ?? "") === m)) return;
  c.queue.push({ v, req, what, alt });
}
function flushLin(c: Ctx) {
  const span = (q: Ctx["queue"][number]) => (q.req.dir === "h" ? Math.abs(q.req.b[0] - q.req.a[0]) : Math.abs(q.req.b[1] - q.req.a[1])) * q.v.s;
  const list = c.queue.splice(0).sort((a, b) => span(a) - span(b));
  for (const q of list) lin(c, q.v, q.req, q.what, q.alt);
}
/** popis do fronty – umístí ho `flushCalls` po délkových kótách */
function callQ(c: Ctx, req: CallReq, what: string) {
  c.calls.push({ req, what });
}
function flushCalls(c: Ctx) {
  for (const q of c.calls.splice(0)) call(c, q.req, q.what);
}
function call(c: Ctx, req: CallReq, what: string, quiet = false): boolean {
  const m = `C:${req.lines.join("|")}`;
  if (c.seen.has(m)) return true;
  if (c.lay.placeCall(req)) {
    c.seen.add(m);
    return true;
  }
  if (quiet) return false;
  c.skipped.push(tr("{0}: popis se nevešel čistě na list ({1})", what, tr(VIEW_NAME[req.view] ?? req.view)));
  c.noRoom++;
  return false;
}
const VIEW_NAME: Record<string, string> = { front: "přední", top: "horní", left: "levý", right: "pravý", back: "zadní", bottom: "spodní", section: "řez" };

/** Hlavní osa rotačního dílu (většina ploch souosá, obálka kolmo na osu kruhová) nebo null. */
export function turnedAxis(g: PartGeom): { ax: GAxis; R: number } | null {
  const size = Math.max(1e-6, ...g.bbox[1].map((v, i) => v - g.bbox[0][i]));
  const tol = 1e-4 * size + 1e-4;
  const total = g.cyls.reduce((a, x) => a + x.area, 0) + g.cones.reduce((a, x) => a + x.area, 0) + g.tori.reduce((a, x) => a + x.area, 0) + g.planes.reduce((a, x) => a + x.area, 0) + g.otherArea;
  let best: { ax: GAxis; R: number; area: number } | null = null;
  for (const cy of g.cyls) {
    if (!cy.ext) continue;
    if (best && sameAxis(best.ax, cy, tol)) continue;
    const ax: GAxis = { dir: cy.dir, p: cy.p };
    const k = [0, 1, 2].findIndex((i) => Math.abs(ax.dir[i]) > 0.9999);
    if (k < 0) continue; // jen osy rovnoběžné s osou souřadnic
    const co = (x: GAxis) => sameAxis(ax, x, tol);
    let area = 0;
    let R = 0;
    for (const x of g.cyls) if (co(x)) {
      area += x.area;
      if (x.ext) R = Math.max(R, x.r);
    }
    for (const x of g.cones) if (co(x)) area += x.area;
    for (const x of g.tori) if (co(x)) area += x.area;
    for (const p of g.planes) if (Math.abs(Math.abs(dot(p.n, ax.dir)) - 1) < 1e-4 && onAxis(ax, p.c).rad < Math.max(tol, 1e-3 * size)) area += p.area;
    // obálka kolmo na osu = kružnice o největším poloměru
    const perp = [0, 1, 2].filter((i) => i !== k);
    const ext = perp.map((i) => g.bbox[1][i] - g.bbox[0][i]);
    const mid = perp.map((i) => (g.bbox[1][i] + g.bbox[0][i]) / 2);
    const round = ext.every((e) => Math.abs(e - 2 * R) <= 0.02 * 2 * R + 1e-3) && perp.every((i, j) => Math.abs(mid[j] - ax.p[i]) <= 0.01 * R + 1e-3);
    if (!round || area / (total || 1) < 0.5) continue;
    if (!best || area > best.area) best = { ax, R, area };
  }
  return best ? { ax: best.ax, R: best.R } : null;
}

/** Celkový plán – vrátí požadavky už umístěné v rozvržení (`out.pads` = kolik místa kóty zabraly vedle pohledů). */
export function planSmartDims(g: PartGeom, doc: CadDoc, d: Pick<DrawingResult, "views" | "sheet" | "texts" | "polys" | "scaleValue">, opts: SmartOptions = {}, out?: { pads?: DrawingOptions["dimPads"] }): SmartDims {
  // jen pohledy hlavního dílu – pohledy dalších modelů na listu (`m:<id>`) zůstanou v rozvržení jako překážky
  const views = d.views.filter((v): v is PV => !!v.cam && !v.key.startsWith("m:")).sort(byOrder);
  const size = Math.max(1e-6, ...g.bbox[1].map((v, i) => v - g.bbox[0][i]));
  const c: Ctx = { doc, g, views, lay: new DimLayout(d), style: opts.style ?? "chain", skipped: [], seen: new Set(), size, queue: [], calls: [], noRoom: 0, rot: opts.rotation ?? 0, turn: null };
  const turned = turnedAxis(g);
  const holeAxes: GAxis[] = [];
  if (turned) turnedDims(c, turned.ax, turned.R);
  holeDims(c, turned?.ax ?? null, holeAxes, !turned);
  // prvky z vysunutých skic (kapsy, výstupky, drážky): rozměry, poloha, hloubka
  if (!turned) extrudeDims(c);
  // polohy a rozměry prvků najednou – kratší blíž obrysu, delší vně (vynášecí čáry se nekříží s kótovacími)
  flushLin(c);
  flushCalls(c);
  if (!turned) prismaticDims(c);
  // výsledek: poznámky s id a klíčem `auto`
  if (out) out.pads = c.lay.overhang();
  const annotations = c.lay.placed.map((p) => ({ ...p.ann, id: uid() }) as DrawingAnnotation);
  const perView: Record<string, number> = {};
  for (const a of annotations) if (a.type !== "centerline") perView[a.view] = (perView[a.view] ?? 0) + 1;
  return { gen: smartGenKey(doc, d.views, opts), annotations, report: { kind: turned ? "turned" : "prismatic", perView, skipped: c.skipped, expected: expectedDims(doc, g.bbox).length, noRoom: c.noRoom } };
}

/**
 * Pro jádro (worker): list bez zapečených kót s místem pro kóty + plán Chytrých kót. List a měřítko se volí jako bez kót
 * a místo mezi pohledy a kolem nich se dá podle toho, kolik se vejde. Když se kóty nevejdou, zkusí list s plným místem
 * kolem pohledů (větší formát / menší měřítko) a pak znovu s místem jen tam, kde kóty skutečně jsou; ponechá lepší výsledek.
 */
export function makeSmartDrawing(shape: r.Shape3D, doc: CadDoc, meta: DrawingMeta, opts: Partial<DrawingOptions> = {}, extra: Record<string, r.Shape3D> = {}): DrawingResult & { smart: SmartDims } {
  const g = partGeom(shape);
  const so: SmartOptions = { style: opts.dimStyle, rotation: opts.rotation };
  type Res = { d: DrawingResult; smart: SmartDims; pads?: DrawingOptions["dimPads"] };
  const run = (room: Partial<DrawingOptions>): Res => {
    const d = makeDrawing(shape, meta, { ...opts, dimensions: "none", ...room }, extra);
    const out: { pads?: DrawingOptions["dimPads"] } = {};
    try {
      return { d, smart: planSmartDims(g, doc, d, so, out), pads: out.pads };
    } catch (e) {
      // chyba plánovače nesmí shodit výkres – list bez kót a hlášení ve stavu výkresu
      return { d, smart: { gen: smartGenKey(doc, d.views, so), annotations: [], report: { kind: "prismatic", perView: {}, skipped: [tr("Chytré kóty se nepodařilo vytvořit: {0}", e instanceof Error ? e.message : String(e))], expected: 0, noRoom: 0 } } };
    }
  };
  // lepší výsledek: bez varování, méně nevešlých kót, menší formát, větší měřítko; při shodě dřívější pokus
  const rank = (x: Res) => [x.d.warnings.length, x.smart.report.noRoom, x.d.sheet.w * x.d.sheet.h, -x.d.scaleValue];
  let best: Res | null = null;
  const consider = (x: Res): Res => {
    const a = rank(x);
    const b = best ? rank(best) : null;
    const i = b ? a.findIndex((v, k) => Math.abs(v - b[k]) > 1e-9) : -1;
    if (!b || (i >= 0 && a[i] < b[i])) best = x;
    return x;
  };
  const done = () => ({ ...best!.d, smart: best!.smart });
  if (opts.dimRoom != null) {
    consider(run({ dimRoom: opts.dimRoom, dimRoomMin: 0 }));
    return done();
  }
  for (const room of [10, 24]) if (!consider(run({ dimRoom: room, dimRoomMin: 0 })).smart.report.noRoom) return done();
  const wide = consider(run({ dimRoom: 24, dimRoomMin: undefined }));
  // místo jen tam, kde kóty v předchozím pokusu skutečně jsou (okraj bez kót se smí zmenšit) – často se vejdou na menší formát
  if (wide.pads) consider(run({ dimRoom: 0, dimRoomMin: -6, dimPads: wide.pads }));
  return done();
}

// ---------------------------------------------------------------- rotační díl

type Seg1 = { t0: number; t1: number; r: number; cyl?: GCyl; cone?: GCone };

function turnedDims(c: Ctx, ax: GAxis, Rmax: number) {
  const g = c.g;
  const tol = 1e-4 * c.size + 1e-4;
  const co = (x: GAxis) => sameAxis(ax, x, tol);
  // obrys: vnější válce a kužely souosé s osou
  const cyls = g.cyls.filter((x) => x.ext && co(x));
  const cones = g.cones.filter((x) => x.ext && co(x));
  const segs: Seg1[] = [];
  for (const x of cyls) {
    const hit = segs.find((s) => s.cyl && Math.abs(s.r - x.r) < 1e-3 && s.t0 <= x.t1 + 1e-3 && x.t0 <= s.t1 + 1e-3);
    if (hit) {
      hit.t0 = Math.min(hit.t0, x.t0);
      hit.t1 = Math.max(hit.t1, x.t1);
    } else segs.push({ t0: x.t0, t1: x.t1, r: x.r, cyl: x });
  }
  for (const x of cones) segs.push({ t0: x.t0, t1: x.t1, r: Math.max(x.r0, x.r1), cone: x });
  const allT = [...cyls.flatMap((x) => [x.t0, x.t1]), ...cones.flatMap((x) => [x.t0, x.t1]), ...g.planes.filter((p) => Math.abs(Math.abs(dot(p.n, ax.dir)) - 1) < 1e-4).map((p) => onAxis(ax, p.c).t)];
  const tMin = Math.min(...allT);
  const tMax = Math.max(...allT);
  const radiusAt = (t: number) => Math.max(0, ...segs.filter((s) => s.t0 - 1e-3 <= t && t <= s.t1 + 1e-3).map((s) => (s.cone ? coneR(s.cone, t) : s.r)));
  c.turn = { ax, tMin, tMax, rMin: radiusAt(tMin), rMax: radiusAt(tMax) };
  const sv = viewSide(c, ax.dir)[0];
  if (!sv) {
    c.skipped.push(tr("rotační díl: chybí pohled, ve kterém je osa v rovině průmětu (zapněte přední nebo boční pohled)"));
    return;
  }
  const A = (t: number) => add(ax.p, mul(ax.dir, t));
  const X0 = P(sv, A(0));
  const X1 = P(sv, A(1));
  const horiz = Math.abs(X1[0] - X0[0]) > 0.5;
  const sgn = horiz ? Math.sign(X1[0] - X0[0]) : Math.sign(X1[1] - X0[1]);
  /** bod (poloha t podél osy, radiálně s; s > 0 = dolů / vpravo v pohledu) */
  const Q = (t: number, s: number): Vec2 => {
    const b = P(sv, A(t));
    return horiz ? [b[0], b[1] + s] : [b[0] + s, b[1]];
  };
  const w = (t: number) => sgn * t; // poloha podél osy ve směru rostoucích souřadnic pohledu
  const loSide: Side = horiz ? "left" : "top";
  const hiSide: Side = horiz ? "right" : "bottom";
  const diaDir: "h" | "v" = horiz ? "v" : "h";
  const lenDir: "h" | "v" = horiz ? "h" : "v";
  const lenSides: Side[] = horiz ? ["bottom", "top"] : ["right", "left"];

  // závity (vnější) na této ose
  const threads = c.doc.features.filter((f): f is Extract<Feature, { type: "thread" }> => f.type === "thread" && !f.suppressed && !f.internal && Math.abs(Math.abs(dot(AXV[f.axis] ?? [0, 0, 1], ax.dir)) - 1) < 1e-6 && onAxis(ax, f.position).rad < 1e-3);

  // --- průměry: válce seřazené podél osy, přístupné z konce (všechno za nimi je menší) → naskládat na tu stranu
  const cylSegs = segs.filter((s) => s.cyl).sort((a, b) => a.t0 - b.t0);
  const stacks: Record<"lo" | "hi", { s: Seg1; i: number }[]> = { lo: [], hi: [] };
  const interior: { s: Seg1; i: number }[] = [];
  cylSegs.forEach((s, i) => {
    const below = segs.filter((o) => o !== s && o.t1 <= s.t0 + 1e-3);
    const above = segs.filter((o) => o !== s && o.t0 >= s.t1 - 1e-3);
    const clearLo = (sgn > 0 ? below : above).every((o) => o.r <= s.r + 1e-3);
    const clearHi = (sgn > 0 ? above : below).every((o) => o.r <= s.r + 1e-3);
    if (clearLo && clearHi) {
      // obě strany volné: blíž ke konci, při shodě ta s menším počtem
      const dLo = Math.min(Math.abs(w(s.t0) - Math.min(w(tMin), w(tMax))), Math.abs(w(s.t1) - Math.min(w(tMin), w(tMax))));
      const dHi = Math.min(Math.abs(Math.max(w(tMin), w(tMax)) - w(s.t0)), Math.abs(Math.max(w(tMin), w(tMax)) - w(s.t1)));
      (dLo < dHi - 1e-6 || (Math.abs(dLo - dHi) <= 1e-6 && stacks.lo.length <= stacks.hi.length) ? stacks.lo : stacks.hi).push({ s, i });
    } else if (clearLo) stacks.lo.push({ s, i });
    else if (clearHi) stacks.hi.push({ s, i });
    else interior.push({ s, i });
  });
  const diaLabel = (s: Seg1): { prefix: string; suffix?: string; what: string; thread?: Extract<Feature, { type: "thread" }> } => {
    const th = threads.find((f) => {
      const t = threadByName(f.designation);
      return t && Math.abs(t.d / 2 - s.r) < 0.02;
    });
    if (th) {
      const name = threadByName(th.designation)?.name ?? th.designation;
      const m = /^M(\d+(?:[.,]\d+)?)(.*)$/.exec(name);
      return { prefix: "M", suffix: m?.[2] || undefined, what: name, thread: th };
    }
    return { prefix: "Ø", what: `Ø${fmtDim(2 * s.r)}` };
  };
  // klíč kóty podle významu (průměr, u závitu označení; stejný průměr vícekrát = pořadí podél osy), ne podle pořadí v seznamu:
  // úpravy kót (tolerance) a smazané kóty se po změně modelu vážou ke kótě téhož významu
  const diaKey = new Map<Seg1, string>();
  for (const s of cylSegs) {
    const lab = diaLabel(s);
    const base = `dia:${lab.thread ? lab.what : r3(2 * s.r)}`;
    let k = base;
    for (let n = 2; [...diaKey.values()].includes(k); n++) k = `${base}#${n}`;
    diaKey.set(s, k);
  }
  const overflow: { s: Seg1; what: string; thread: boolean; req: Omit<LinReq, "view"> }[] = [];
  for (const key of ["lo", "hi"] as const) {
    const list = stacks[key].sort((a, b) => a.s.r - b.s.r);
    const side = key === "lo" ? loSide : hiSide;
    const other = key === "lo" ? hiSide : loSide;
    let row = 0;
    for (const { s } of list) {
      // konec válce, ze kterého vede vynášecí čára na tuto stranu
      const tEnd = (key === "lo") === sgn > 0 ? s.t0 : s.t1;
      const tEnd2 = tEnd === s.t0 ? s.t1 : s.t0;
      const lab = diaLabel(s);
      const req = { key: diaKey.get(s)!, dir: diaDir, a: Q(tEnd, -s.r), b: Q(tEnd, s.r), sides: [side], prefix: lab.prefix, ...(lab.suffix ? { suffix: lab.suffix } : {}), minRow: row };
      const res = lin(c, sv, req, lab.what, undefined, true);
      if (res && res !== "dup") row = res.row + 1;
      // na svou stranu se nevešlo: zkusí se druhá strana, až když jsou na ní její vlastní průměry (vně nich)
      if (!res) overflow.push({ s, what: lab.what, thread: !!lab.thread, req: { ...req, a: Q(tEnd2, -s.r), b: Q(tEnd2, s.r), sides: [other], minRow: 0 } });
    }
  }
  for (const { s, what, thread, req } of overflow.sort((a, b) => a.s.r - b.s.r)) {
    if (lin(c, sv, req, what, undefined, true)) continue;
    // ani tam: průměr na kružnici v čelním pohledu (popis s odkazem), jinak hlášení
    const fv = viewAlong(c, ax.dir).find((v) => visibleArc(v, P(v, ax.p), s.r));
    const lines = [thread ? what : `Ø${fmtDim(2 * s.r)}`];
    if (!fv || !call(c, { key: req.key, view: fv.key, tip: P(fv, ax.p), lines, ring: { c: P(fv, ax.p), r: s.r } }, lines[0], true)) {
      c.skipped.push(tr("{0}: nevešlo se čistě na list ({1})", what, tr(VIEW_NAME[sv.key] ?? sv.key)));
      c.noRoom++;
    }
  }
  // zápichy a průměry mezi většími osazeními: popis s odkazem na dno
  for (const { s } of interior) {
    const lab = diaLabel(s);
    const tm = (s.t0 + s.t1) / 2;
    call(c, { key: diaKey.get(s)!, view: sv.key, tip: Q(tm, -s.r), lines: [lab.what], prefer: horiz ? [0, -1] : [1, 0] }, lab.what);
    c.seen.add(linMeaning(sv.cam, diaDir, Q(tm, -s.r), Q(tm, s.r), lab.prefix));
  }

  // --- délky: polohy osazení (rovinné plochy kolmé na osu, s vnějším obrysem) a konce dílu
  const internalR = g.cyls.filter((x) => !x.ext && co(x)).map((x) => x.r);
  const shoulders = g.planes
    .filter((p) => Math.abs(Math.abs(dot(p.n, ax.dir)) - 1) < 1e-4 && onAxis(ax, p.c).rad < Math.max(tol, 1e-3 * Rmax))
    .filter((p) => {
      const radii = p.circles.filter((q) => onAxis(ax, q.c).rad < Math.max(tol, 1e-3 * Rmax)).map((q) => q.r);
      const rout = Math.max(0, ...radii);
      return !(rout > 0 && internalR.some((ri) => Math.abs(ri - rout) < 1e-3)) || rout <= 0;
    })
    .map((p) => onAxis(ax, p.c).t);
  const ts = uniq([tMin, tMax, ...shoulders].filter((t) => t >= tMin - 1e-6 && t <= tMax + 1e-6)).sort((a, b) => w(a) - w(b));
  const lenReq = (t0: number, t1: number, key: string, extra: Partial<LinReq> = {}) => {
    const r0 = radiusAt(t0);
    const r1 = radiusAt(t1);
    const bot = { a: Q(t0, r0), b: Q(t1, r1) };
    const top = { a: Q(t0, -r0), b: Q(t1, -r1) };
    const alt: Partial<Record<Side, { a: Vec2; b: Vec2 }>> = horiz ? { bottom: bot, top } : { right: bot, left: top };
    return { req: { key, dir: lenDir, ...alt[lenSides[0]]!, sides: lenSides, ...extra } as Omit<LinReq, "view">, alt };
  };
  let lenRows = 0;
  let lenSide: Side | null = null;
  const placeLen = (t0: number, t1: number, key: string, what: string, extra: Partial<LinReq> = {}) => {
    const { req, alt } = lenReq(t0, t1, key, extra);
    const sides = lenSide ? [lenSide, ...lenSides.filter((s) => s !== lenSide)] : lenSides;
    const res = lin(c, sv, { ...req, ...alt[sides[0]]!, sides, minRow: extra.minRow ?? 0 }, what, alt);
    if (res && res !== "dup") {
      lenSide ??= res.side;
      if (res.side === lenSide) lenRows = Math.max(lenRows, res.row + 1);
    }
    return res;
  };
  const L = Math.abs(tMax - tMin);
  if (ts.length > 2) {
    if (c.style === "baseline") {
      ts.slice(1).forEach((t, i) => placeLen(ts[0], t, `len:b:${spanKey(ts[0], t)}`, fmtDim(Math.abs(t - ts[0])), { minRow: i }));
    } else {
      // řetěz bez uzavření: nejdelší článek jako pomocná kóta v závorce
      const links = ts.slice(1).map((t, i) => ({ t0: ts[i], t1: t, i, l: Math.abs(t - ts[i]) }));
      const refLink = links.reduce((m, x) => (x.l > m.l ? x : m), links[0]);
      for (const k of links) placeLen(k.t0, k.t1, `len:c:${spanKey(k.t0, k.t1)}`, fmtDim(k.l), k === refLink ? { prefix: "(", suffix: ")" } : {});
      c.seen.add(`ref:${r3(refLink.t0)}:${r3(refLink.t1)}`);
    }
  }
  if (c.style !== "baseline" || ts.length <= 2) placeLen(ts[0], ts[ts.length - 1], "len:all", fmtDim(L), { minRow: lenRows });

  // délka závitu (pokud není totožná s článkem)
  for (const th of threads) {
    const st = onAxis(ax, th.position).t;
    const dirSign = Math.sign(dot(AXV[th.axis] ?? [0, 0, 1], ax.dir)) || 1;
    const t0 = st;
    const t1 = st + dirSign * th.length;
    const same = ts.some((a, i) => ts.some((b, j) => j > i && Math.abs(Math.min(a, b) - Math.min(t0, t1)) < 1e-3 && Math.abs(Math.max(a, b) - Math.max(t0, t1)) < 1e-3));
    if (same) continue;
    const opp = lenSides.filter((s) => s !== lenSide);
    const { req, alt } = lenReq(Math.min(t0, t1), Math.max(t0, t1), `thr:${th.id}`);
    lin(c, sv, { ...req, ...alt[opp[0]]!, sides: [...opp, ...(lenSide ? [lenSide] : [])] }, tr("délka závitu {0}", th.designation), alt);
  }

  // --- sražení (krátké kužely) a jiné kužely
  const chams = new Map<string, { n: number; cone: GCone }>();
  let tapers = 0;
  for (const x of cones) {
    const dl = Math.abs(x.t1 - x.t0);
    const dr = Math.abs(x.r1 - x.r0);
    const ang = (Math.atan2(dr, dl) * 180) / Math.PI;
    // sražení = krátký kužel s normalizovaným úhlem (15° … 60°); ostatní kužely jsou funkční tvar
    const std = [15, 20, 30, 45, 60].some((a) => Math.abs(ang - a) < 0.6);
    if (!std || Math.max(dl, dr) > Math.min(6, 0.15 * Math.max(x.r0, x.r1)) + 1e-6 || dl < 1e-6) {
      tapers++;
      continue;
    }
    const label = `${fmtDim(dl)}×${fmtDim(Math.round(ang * 10) / 10)}°`;
    const e = chams.get(label);
    if (e) e.n++;
    else chams.set(label, { n: 1, cone: x });
  }
  for (const [label, { n, cone }] of chams) {
    const tm = (cone.t0 + cone.t1) / 2;
    const rm = (cone.r0 + cone.r1) / 2;
    const toEnd = Math.abs(cone.t0 - tMin) + Math.abs(cone.t1 - tMin) < Math.abs(cone.t0 - tMax) + Math.abs(cone.t1 - tMax) ? -1 : 1;
    const lines = [`${n > 1 ? `${n}× ` : ""}${label}`];
    const prefer: Vec2 = horiz ? [toEnd * sgn, -1] : [1, toEnd * sgn];
    call(c, { key: `cham:${label}`, view: sv.key, tip: Q(tm, -rm), lines, prefer }, lines[0]);
  }
  if (tapers) c.skipped.push(tr("kuželové plochy ({0}): úhel a průměry kuželů kótujte ručně", tapers));

  // --- zaoblení (anuloidy): R s počtem
  const fils = new Map<string, { n: number; t: number; R: number; r: number }>();
  for (const x of g.tori) {
    if (!co(x)) continue;
    const k = fmtDim(x.r);
    const e = fils.get(k);
    if (e) e.n++;
    else fils.set(k, { n: 1, t: x.t, R: x.R, r: x.r });
  }
  for (const [k, f] of fils) {
    const arc = findArc(sv, Q(f.t, -f.R), f.r);
    const lines = [`${f.n > 1 ? `${f.n}× ` : ""}R${k}`];
    if (!arc) {
      c.skipped.push(tr("{0}: oblouk zaoblení v pohledu nenalezen", lines[0]));
      continue;
    }
    call(c, { key: `fil:${k}`, view: sv.key, tip: arc.mid, lines, prefer: arc.out }, lines[0]);
  }

  // --- vnitřní souosé díry (vrtání): popis v čelním pohledu, kde je kružnice vidět
  const bores = g.cyls.filter((x) => !x.ext && co(x)).sort((a, b) => a.r - b.r);
  const done = new Set<string>();
  for (const b of bores) {
    const k = fmtDim(b.r);
    if (done.has(k)) continue;
    done.add(k);
    // díru z prvku Díra popíše modul děr
    if (c.doc.features.some((f) => f.type === "hole" && !f.suppressed && Math.abs(holeR(f) - b.r) < 1e-3 && featureInstances(c.doc, f).some((p) => onAxis(ax, p).rad < 1e-3))) continue;
    const through = Math.abs(b.t0 - tMin) < 1e-3 && Math.abs(b.t1 - tMax) < 1e-3;
    const depth = Math.abs(b.t1 - b.t0);
    const lines = [`Ø${fmtDim(2 * b.r)}${through ? ` ${tr("skrz")}` : ` ↧${fmtDim(depth)}`}`];
    const fv = viewAlong(c, ax.dir).find((v) => visibleArc(v, P(v, ax.p), b.r));
    if (fv) {
      call(c, { key: `bore:${k}`, view: fv.key, tip: P(fv, ax.p), lines, ring: { c: P(fv, ax.p), r: b.r } }, lines[0]);
      continue;
    }
    // řez osou: vrtání je vidět – průměr jako u vnějších válců (vynášecí čáry přes šrafy)
    const sec = c.views.find((v) => v.key === "section" && Math.abs(dot(v.cam.d, ax.dir)) < 1e-3);
    if (sec) {
      const S0 = P(sec, A(0));
      const S1 = P(sec, A(1));
      const hz = Math.abs(S1[0] - S0[0]) > 0.5;
      const QS = (t: number, sv2: number): Vec2 => {
        const q = P(sec, A(t));
        return hz ? [q[0], q[1] + sv2] : [q[0] + sv2, q[1]];
      };
      // vynášecí čáry od čela, kde díra ústí, na straně kótovací čáry – ne od vzdáleného konce přes celou délku dílu
      // (v polovičním řezu by taková čára v nevyříznuté polovině vypadala jako hrana díry)
      const open = [b.t0, b.t1].filter((t) => Math.abs(t - tMin) < 1e-3 || Math.abs(t - tMax) < 1e-3);
      const ends = open.length ? open : [Math.abs(b.t1 - tMax) < Math.abs(b.t0 - tMin) ? b.t1 : b.t0];
      const at = (t: number) => P(sec, A(t))[hz ? 0 : 1];
      const hiEnd = ends.reduce((m, t) => (at(t) > at(m) ? t : m));
      const loEnd = ends.reduce((m, t) => (at(t) < at(m) ? t : m));
      const hiS: Side = hz ? "right" : "bottom";
      const loS: Side = hz ? "left" : "top";
      const sides: Side[] = at(hiEnd) >= (at(tMin) + at(tMax)) / 2 ? [hiS, loS] : [loS, hiS];
      const pts: Partial<Record<Side, { a: Vec2; b: Vec2 }>> = { [hiS]: { a: QS(hiEnd, -b.r), b: QS(hiEnd, b.r) }, [loS]: { a: QS(loEnd, -b.r), b: QS(loEnd, b.r) } };
      const res = lin(c, sec, { key: `bore:${k}`, dir: hz ? "v" : "h", ...pts[sides[0]]!, sides, prefix: "Ø" }, `Ø${fmtDim(2 * b.r)}`, pts);
      // hloubka: vynášecí čáry jen od hran, které jsou v řezu vidět (v polovičním řezu není dno díry v nevyříznuté polovině)
      if (res && !through) {
        const sr = [-b.r, b.r].find((q) => onVisibleLine(sec, QS(b.t0, q)) && onVisibleLine(sec, QS(b.t1, q)));
        const dSides: Side[] = (sr ?? -1) < 0 ? (hz ? ["top", "bottom"] : ["left", "right"]) : hz ? ["bottom", "top"] : ["right", "left"];
        if (sr != null) lin(c, sec, { key: `bore:${k}:d`, dir: hz ? "h" : "v", a: QS(b.t0, sr), b: QS(b.t1, sr), sides: dSides }, fmtDim(depth));
        else c.skipped.push(tr("{0}: hloubka vrtání není v řezu vidět – kótujte ji ručně", lines[0]));
      }
      continue;
    }
    const endViews = missingViewsAlong(c, ax.dir);
    c.skipped.push(endViews.length ? tr("vnitřní {0}: v pohledech jen skrytě – zapněte pohled {1} nebo řez osou (výkres řez …)", lines[0], endViews.join(" / ")) : tr("vnitřní {0}: v pohledech jen skrytě – zapněte řez osou (výkres řez …)", lines[0]));
  }
}

/** interval podél osy jako část klíče kóty (nezávislý na pořadí článků) */
const spanKey = (a: number, b: number) => `${r3(Math.min(a, b))}:${r3(Math.max(a, b))}`;
const coneR = (x: GCone, t: number) => (Math.abs(x.t1 - x.t0) < 1e-9 ? Math.max(x.r0, x.r1) : x.r0 + ((x.r1 - x.r0) * (t - x.t0)) / (x.t1 - x.t0));
const holeR = (f: HoleF) => (f.kind === "tapped" && f.thread ? (threadByName(f.thread)?.tap ?? f.diameter) / 2 : f.diameter / 2);
const uniq = (xs: number[]) => xs.filter((x, i) => xs.findIndex((y) => Math.abs(y - x) < 1e-3) === i);

/** oblouk pohledu poloměru r se středem blízko c (zaoblení) → jeho střední bod a směr ven */
function findArc(v: PV, c: Vec2, rad: number): { mid: Vec2; out: Vec2 } | null {
  let best: Extract<ViewEnt, { t: "arc" }> | null = null;
  let bd = Infinity;
  for (const e of v.ents ?? []) {
    if (e.t !== "arc" || e.hidden || Math.abs(e.r - rad) > 0.02 + 0.01 * rad) continue;
    const dd = Math.hypot(e.c[0] - c[0], e.c[1] - c[1]);
    if (dd < bd) {
      bd = dd;
      best = e;
    }
  }
  if (!best || bd > Math.max(0.05, 0.05 * rad) + 0.02) return null;
  const a = best.a0 + best.da / 2;
  const out: Vec2 = [Math.cos(a), Math.sin(a)];
  return { mid: [best.c[0] + best.r * out[0], best.c[1] + best.r * out[1]], out };
}

// ---------------------------------------------------------------- díry (popisy + polohy)

type HoleInst = { line: GAxis; head: number };
type HoleGroup = { /** řádky popisu pro jednu díru (počet se doplní) */ lines: string[]; f: HoleF; inst: HoleInst[]; dir: Vec3; head: number };

function holeDims(c: Ctx, mainAx: GAxis | null, out: GAxis[], positions: boolean) {
  const g = c.g;
  const tol = 1e-4 * c.size + 1e-3;
  const holes = c.doc.features.filter((f): f is HoleF => f.type === "hole" && !f.suppressed);
  const groups = new Map<string, HoleGroup>();
  const claimed = new Set<GCyl>();
  for (const f of holes) {
    const dir = holeDir(f);
    const rd = holeR(f);
    const cands = g.cyls.filter((x) => !x.ext && Math.abs(x.r - rd) < 1e-3 && Math.abs(Math.abs(dot(x.dir, dir)) - 1) < 1e-4 && !claimed.has(x));
    const exp = featureInstances(c.doc, f);
    const lines: GAxis[] = [];
    for (const p of exp) {
      const hit = cands.find((x) => onAxis(x, p).rad < Math.max(tol, 0.01));
      if (hit && !lines.some((l) => sameAxis(l, hit, tol))) lines.push({ dir: hit.dir, p: hit.p });
    }
    for (const x of cands) if (lines.some((l) => sameAxis(l, x, tol))) claimed.add(x);
    if (!lines.length) {
      c.skipped.push(tr("{0}: díra v geometrii nenalezena", f.name));
      continue;
    }
    const kind = f.kind ?? (f.cbDiameter > f.diameter && f.cbDepth > 0 ? "counterbore" : "simple");
    const head = kind === "counterbore" ? f.cbDiameter / 2 : kind === "countersink" ? (f.csDiameter ?? 0) / 2 : rd;
    // hloubka ukončení „k ploše / k bodu“ z geometrie (délka válce)
    const cyl = cands.find((x) => sameAxis(x, lines[0], tol));
    const measured = cyl ? Math.abs(cyl.t1 - cyl.t0) + (kind === "counterbore" ? f.cbDepth : 0) : undefined;
    const base = holeCallout(f, 1, measured);
    const key = `${base.join("|")}#${dir.map((v) => r3(Math.abs(v))).join()}`;
    const e = groups.get(key);
    const inst = lines.map((l) => ({ line: l, head }));
    if (e) e.inst.push(...inst.filter((x) => !e.inst.some((y) => sameAxis(y.line, x.line, tol))));
    else groups.set(key, { lines: base, f, inst, dir, head });
    out.push(...lines);
  }
  if (!groups.size) return;
  // polohy děr – po skupinách (stejná rozteč se pozná jen uvnitř skupiny), duplicity hlídá význam kóty
  const center = (v: PV) => (positions ? null : mainAx ? P(v, mainAx.p) : null);
  // rotační díl: osa je datum jen radiálně, podél osy se poloha kótuje od čela (ne od bodu osy v počátku modelu)
  const axialOf = (v: PV): Axial | null => {
    const t = c.turn;
    if (positions || !t) return null;
    const k: 0 | 1 | null = Math.abs(Math.abs(dot(v.cam.x, t.ax.dir)) - 1) < 1e-6 ? 0 : Math.abs(Math.abs(dot(upOf(v.cam), t.ax.dir)) - 1) < 1e-6 ? 1 : null;
    if (k === null) return null;
    const at = (tt: number) => P(v, add(t.ax.p, mul(t.ax.dir, tt)))[k];
    return { axis: k, faces: [{ at: at(t.tMin), r: t.rMin }, { at: at(t.tMax), r: t.rMax }] };
  };
  for (const grp of groups.values()) {
    const n = grp.inst.length;
    const label = grp.lines.map((l, i) => (i === 0 && n > 1 ? `${n}× ${l}` : l));
    const fvs = viewAlong(c, grp.dir).sort(byOrder);
    let fv: PV | null = null;
    let hiddenOnly = false;
    for (const v of fvs) {
      const vis = grp.inst.filter((h) => visibleArc(v, P(v, h.line.p), grp.head) || visibleArc(v, P(v, h.line.p), holeR(grp.f)));
      if (vis.length) {
        fv = v;
        break;
      }
      if (grp.inst.some((h) => hiddenArc(v, P(v, h.line.p), grp.head))) hiddenOnly = true;
    }
    if (!fv) {
      // pohledy ve směru osy díry, které na listu nejsou
      const want = missingViewsAlong(c, grp.dir);
      c.skipped.push(hiddenOnly ? tr("{0}: díra je v pohledu vidět jen skrytě – zapněte pohled {1}", label[0], want.join(" / ") || "—") : tr("{0}: chybí pohled ve směru osy díry – zapněte pohled {1}", label[0], want.join(" / ") || "—"));
      continue;
    }
    // kruhové pole: středy na kružnici kolem společného středu
    const pts2 = grp.inst.map((h) => P(fv!, h.line.p));
    let mainCenter: Vec2 | null = null;
    if (mainAx && Math.abs(Math.abs(dot(mainAx.dir, grp.dir)) - 1) < 1e-4) mainCenter = P(fv, mainAx.p);
    // kruhové rozmístění: prvek opakuje kruhové pole, nebo díry leží na kružnici kolem osy rotačního dílu
    const onCircle = n >= 3 ? circleThrough(pts2) : null;
    const circPattern = c.doc.features.some((p) => p.type === "pattern" && !p.suppressed && p.kind === "circular" && (p.featureIds?.length ? p.featureIds : [p.featureId]).includes(grp.f.id));
    const circ = onCircle && (circPattern || (mainCenter && Math.hypot(mainCenter[0] - onCircle.c[0], mainCenter[1] - onCircle.c[1]) < 1e-3)) ? onCircle : null;
    const rings = grp.inst.map((h) => ({ c: P(fv!, h.line.p), r: grp.head }));
    const callLines = [...label];
    if (circ) {
      // rovnoměrně po celém obvodu?
      const angs = pts2.map((q) => Math.atan2(q[1] - circ.c[1], q[0] - circ.c[0])).sort((a, b) => a - b);
      const gaps = angs.map((a, i) => (i ? a - angs[i - 1] : a + 2 * Math.PI - angs[angs.length - 1]));
      const step = (2 * Math.PI) / n;
      const equal = gaps.every((x) => Math.abs(x - step) < 1e-3);
      callLines[0] += ` ${equal ? tr("rovnoměrně") : ""}`.trimEnd();
      const pcdKey = `pcd:${fmtDim(2 * circ.r)}`;
      if (!c.seen.has(pcdKey)) {
        c.seen.add(pcdKey);
        const pcdLines = [`Ø${fmtDim(2 * circ.r)}`];
        if (!equal) {
          const minGap = Math.min(...gaps);
          pcdLines.push(`${fmtDim((minGap * 180) / Math.PI)}°`);
        }
        callQ(c, { key: pcdKey, view: fv.key, tip: circ.c, lines: pcdLines, circle: { c: circ.c, r: circ.r }, ring: { c: circ.c, r: circ.r } }, pcdLines[0]);
      }
      if (!mainCenter || Math.hypot(mainCenter[0] - circ.c[0], mainCenter[1] - circ.c[1]) > 1e-3) positionDims(c, fv, [circ.c], center(fv), axialOf(fv));
    } else positionDims(c, fv, pts2, center(fv), axialOf(fv));
    callQ(c, { key: `hole:${grp.f.id}`, view: fv.key, tip: rings[0].c, lines: callLines, rings }, callLines[0]);
  }
}

/** kružnice přes body (všechny stejně daleko od těžiště) */
function circleThrough(pts: Vec2[]): { c: Vec2; r: number } | null {
  const n = pts.length;
  const cx = pts.reduce((a, p) => a + p[0], 0) / n;
  const cy = pts.reduce((a, p) => a + p[1], 0) / n;
  const rs = pts.map((p) => Math.hypot(p[0] - cx, p[1] - cy));
  const rm = rs.reduce((a, b) => a + b, 0) / n;
  if (rm < 1e-6 || rs.some((x) => Math.abs(x - rm) > 1e-3 * Math.max(1, rm))) return null;
  return { c: [cx, cy], r: rm };
}

/** rotační díl v pohledu: osa obrazu (0 = x, 1 = y) podél osy dílu a čela (souřadnice v pohledu, poloměr obrysu u čela) */
type Axial = { axis: 0 | 1; faces: { at: number; r: number }[] };

/**
 * Kóty poloh bodů v pohledu: souměrné rozmístění → rozteče dvojic od osy souměrnosti (nejmenší nejblíž),
 * jinak od základní hrany (levá / spodní hrana obrysu) od základny nebo řetězově. `center` = střed rotačního dílu (datum
 * radiálně); `axial` = podél osy rotačního dílu se poloha kótuje od bližšího čela.
 */
function positionDims(c: Ctx, v: PV, pts: Vec2[], center: Vec2 | null, axial: Axial | null = null) {
  if (!pts.length) return;
  const vx0 = v.x0;
  const vx1 = v.x0 + v.w;
  const vy0 = v.y0;
  const vy1 = v.y0 + v.h;
  for (const axis of [0, 1] as const) {
    const dir: "h" | "v" = axis === 0 ? "h" : "v";
    const lo = axis === 0 ? vx0 : vy1; // základní hrana: levá / spodní (y dolů → největší y)
    const mid = center ? center[axis] : axis === 0 ? (vx0 + vx1) / 2 : (vy0 + vy1) / 2;
    const vals = uniq(pts.map((p) => p[axis])).sort((a, b) => (axis === 0 ? a - b : b - a));
    const sideList: Side[] = axis === 0 ? ["bottom", "top"] : ["left", "right"];
    const ptAt = (val: number) => pts.find((p) => Math.abs(p[axis] - val) < 1e-3)!;
    const symmetric = vals.every((x) => vals.some((y) => Math.abs(x + y - 2 * mid) < 1e-3));
    const what = tr("poloha díry");
    if (center && axial?.axis === axis) {
      // od čela bližšího dírám: první od čela, další řetězově (nebo od čela); stejné rozteče jednou kótou „n× rozteč“
      const dist = (f: Axial["faces"][number]) => Math.min(...vals.map((x) => Math.abs(x - f.at)));
      const face = axial.faces.reduce((m, f) => (dist(f) < dist(m) - 1e-9 ? f : m));
      const order = [...vals].filter((x) => Math.abs(x - face.at) > 1e-3).sort((a, b) => Math.abs(a - face.at) - Math.abs(b - face.at));
      const oc = center[1 - axis];
      const facePt = (side: Side): Vec2 => (axis === 0 ? [face.at, side === "top" ? oc - face.r : oc + face.r] : [side === "right" ? oc + face.r : oc - face.r, face.at]);
      const fromFace = (x: number) => {
        const b = ptAt(x);
        const alt = { [sideList[0]]: { a: facePt(sideList[0]), b }, [sideList[1]]: { a: facePt(sideList[1]), b } } as Partial<Record<Side, { a: Vec2; b: Vec2 }>>;
        linQ(c, v, { key: `pos:${v.key}:${axis}:f${r3(face.at)}:${r3(x)}`, dir, a: facePt(sideList[0]), b, sides: sideList }, what, alt);
      };
      const steps = order.slice(1).map((x, i) => Math.abs(x - order[i]));
      if (order.length >= 3 && steps.every((g) => Math.abs(g - steps[0]) < 1e-3)) {
        fromFace(order[0]);
        const total = Math.abs(order[order.length - 1] - order[0]);
        linQ(c, v, { key: `pos:${v.key}:${axis}:p${r3(order[0])}`, dir, a: ptAt(order[0]), b: ptAt(order[1]), sides: sideList, prefix: `${steps.length}× `, suffix: ` (=${fmtDim(total)})` }, what);
        continue;
      }
      order.forEach((x, i) => {
        if (c.style === "baseline" || i === 0) fromFace(x);
        else linQ(c, v, { key: `pos:${v.key}:${axis}:${r3(x)}`, dir, a: ptAt(order[i - 1]), b: ptAt(x), sides: sideList }, what);
      });
      continue;
    }
    // osa souměrnosti (u hranolového dílu se kreslí – souměrné kótování se o ni opírá)
    const symAxis = () => {
      const k = `sym:${v.key}:${axis}:${r3(mid)}`;
      if (center || c.seen.has(k)) return;
      c.seen.add(k);
      const e = 3 / v.s;
      c.lay.placeAxis(k, v.key, axis === 0 ? [mid, vy0 - e] : [vx0 - e, mid], axis === 0 ? [mid, vy1 + e] : [vx1 + e, mid]);
    };
    // stejné rozteče (3 a více): jedna kóta „n× rozteč (=celkem)“ + poloha první od hrany (nebo osa souměrnosti)
    const gaps = vals.slice(1).map((x, i) => Math.abs(x - vals[i]));
    if (vals.length >= 3 && gaps.every((g) => Math.abs(g - gaps[0]) < 1e-3)) {
      const total = Math.abs(vals[vals.length - 1] - vals[0]);
      linQ(c, v, { key: `pos:${v.key}:${axis}:p${r3(vals[0])}`, dir, a: ptAt(vals[0]), b: ptAt(vals[1]), sides: sideList, prefix: `${gaps.length}× `, suffix: ` (=${fmtDim(total)})` }, what);
      if (symmetric) symAxis();
      else if (center) linQ(c, v, { key: `pos:${v.key}:${axis}:c${r3(vals[0])}`, dir, a: axis === 0 ? [mid, center[1]] : [center[0], mid], b: ptAt(vals[0]), sides: sideList }, what);
      else if (Math.abs(vals[0] - lo) > 1e-3) {
        const ep = (side: Side): Vec2 => (axis === 0 ? [lo, side === "top" ? vy0 : vy1] : [side === "right" ? vx1 : vx0, lo]);
        linQ(c, v, { key: `pos:${v.key}:${axis}:${r3(vals[0])}`, dir, a: ep(sideList[0]), b: ptAt(vals[0]), sides: sideList }, what, { [sideList[0]]: { a: ep(sideList[0]), b: ptAt(vals[0]) }, [sideList[1]]: { a: ep(sideList[1]), b: ptAt(vals[0]) } });
      }
      continue;
    }
    if (symmetric) {
      symAxis();
      const pairs = vals.filter((x) => (axis === 0 ? x < mid - 1e-3 : x > mid + 1e-3)).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
      for (const x of pairs) {
        const y = 2 * mid - x;
        const a = ptAt(x);
        const b = ptAt(y);
        linQ(c, v, { key: `pos:${v.key}:${axis}:s${r3(x)}`, dir, a, b, sides: sideList }, what);
      }
      continue;
    }
    if (center) {
      // od středu (rotační díl)
      for (const x of vals) {
        if (Math.abs(x - mid) < 1e-3) continue;
        const p = ptAt(x);
        const a: Vec2 = axis === 0 ? [mid, center[1]] : [center[0], mid];
        linQ(c, v, { key: `pos:${v.key}:${axis}:c${r3(x)}`, dir, a, b: p, sides: sideList }, what);
      }
      continue;
    }
    // od základní hrany: řetězově nebo od základny
    const edgePt = (side: Side): Vec2 => (axis === 0 ? [lo, side === "top" ? vy0 : vy1] : [side === "right" ? vx1 : vx0, lo]);
    let prev: number = lo;
    for (const x of vals) {
      if (Math.abs(x - lo) < 1e-3) continue;
      const b = ptAt(x);
      if (c.style === "baseline" || Math.abs(prev - lo) < 1e-9) {
        const alt = { [sideList[0]]: { a: edgePt(sideList[0]), b }, [sideList[1]]: { a: edgePt(sideList[1]), b } } as Partial<Record<Side, { a: Vec2; b: Vec2 }>>;
        linQ(c, v, { key: `pos:${v.key}:${axis}:${r3(x)}`, dir, a: edgePt(sideList[0]), b, sides: sideList }, what, alt);
      } else {
        const a = ptAt(prev);
        linQ(c, v, { key: `pos:${v.key}:${axis}:${r3(x)}`, dir, a, b, sides: sideList }, what);
      }
      prev = x;
    }
  }
}

// ---------------------------------------------------------------- hranolový díl

function prismaticDims(c: Ctx) {
  const g = c.g;
  const [lo, hi] = g.bbox;
  // hlavní pohled: ten, ve kterém je nejvíc popisů (díry) – jinak přední
  const count = (k: string) => c.lay.placed.filter((p) => p.ann.view === k).length;
  const views = [...c.views].filter((v) => v.key !== "section").sort((a, b) => count(b.key) - count(a.key) || byOrder(a, b));
  const main = views[0];
  if (!main) return;
  // celkové rozměry – každá osa jednou; nejdřív v hlavním pohledu (vnější řada), zbylá osa jinde
  const axes: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const order = [main, ...views.filter((v) => v !== main)];
  for (let k = 0; k < 3; k++) {
    const A = axes[k];
    const L = hi[k] - lo[k];
    if (!(L > 1e-6)) continue;
    let ok = false;
    let shown: PV | null = null;
    for (const v of order) {
      const isH = Math.abs(Math.abs(dot(v.cam.x, A)) - 1) < 1e-6;
      const isV = Math.abs(Math.abs(dot(upOf(v.cam), A)) - 1) < 1e-6;
      if (!isH && !isV) continue;
      const dir: "h" | "v" = isH ? "h" : "v";
      const x0 = v.x0;
      const x1 = v.x0 + v.w;
      const y0 = v.y0;
      const y1 = v.y0 + v.h;
      const sides: Side[] = dir === "h" ? ["bottom", "top"] : ["left", "right"];
      const alt: Partial<Record<Side, { a: Vec2; b: Vec2 }>> =
        dir === "h" ? { bottom: { a: [x0, y1], b: [x1, y1] }, top: { a: [x0, y0], b: [x1, y0] } } : { left: { a: [x0, y1], b: [x0, y0] }, right: { a: [x1, y1], b: [x1, y0] } };
      const used = c.lay.placed.filter((p) => p.ann.view === v.key && p.side && sides.includes(p.side));
      const minRow = used.length ? Math.max(...used.map((p) => (p.row ?? 0) + 1)) : 0;
      shown ??= v;
      // tiše: nevejde-li se v tomto pohledu, zkusí se další; hlásí se jen, když se nevešel nikde
      const res = lin(c, v, { key: `ov:${"xyz"[k]}`, dir, ...alt[sides[0]]!, sides, minRow }, fmtDim(L), alt, true);
      if (res) {
        ok = true;
        break;
      }
    }
    if (!ok && shown) {
      c.skipped.push(tr("{0}: nevešlo se čistě na list ({1})", fmtDim(L), tr(VIEW_NAME[shown.key] ?? shown.key)));
      c.noRoom++;
    } else if (!ok) c.skipped.push(tr("celkový rozměr {0}: žádný pohled ho neukazuje v pravé délce", fmtDim(L)));
  }
  // zaoblení a sražení hran (prvky Zaoblení / Sražení)
  edgeFeatureDims(c);
}

/** Kapsy, výstupky a průchozí okna z vysunutých skic (obdélník, kružnice, drážka) v pohledu ve směru vysunutí. */
function extrudeDims(c: Ctx) {
  const feats = c.doc.features;
  const firstSolid = feats.find((f) => !f.suppressed && (f.type === "extrude" || f.type === "box" || f.type === "revolve" || f.type === "cylinder"));
  for (const f of feats) {
    if (f.suppressed || f.type !== "extrude" || f === firstSolid) continue;
    const sk = feats.find((x): x is Extract<Feature, { type: "sketch" }> => x.type === "sketch" && x.id === f.sketchId);
    if (!sk) continue;
    const n = planeNormal(sk.plane);
    const v = viewAlong(c, n).sort(byOrder)[0];
    if (!v) continue;
    const blind = !f.extent || f.extent.kind === "blind";
    const dist = f.extent?.kind === "blind" ? f.extent.d : f.distance;
    const depthTxt = f.mode === "cut" && blind ? ` ↧${fmtDim(dist)}` : "";
    for (const e of sk.entities) {
      if (e.construction) continue;
      if (e.type === "circle") {
        const cc = P(v, sketchPoint(sk.plane, e.cx, e.cy));
        const lines = [`Ø${fmtDim(2 * e.r)}${depthTxt}`];
        callQ(c, { key: `ext:${f.id}:${e.id}`, view: v.key, tip: cc, lines, ring: { c: cc, r: e.r } }, lines[0]);
        positionDims(c, v, [cc], null);
      } else if (e.type === "rect" || e.type === "slot") {
        const wdt = e.type === "rect" ? e.w : e.length;
        const hgt = e.type === "rect" ? e.h : e.width;
        const ang = ((e.angle ?? 0) * Math.PI) / 180;
        if (Math.abs(Math.sin(2 * ang)) > 1e-6) {
          c.skipped.push(tr("{0}: natočený obrys kótujte ručně", f.name));
          continue;
        }
        const corners = [
          [e.cx - wdt / 2, e.cy - hgt / 2],
          [e.cx + wdt / 2, e.cy + hgt / 2],
        ].map(([u, w]) => P(v, sketchPoint(sk.plane, u, w)));
        const x0 = Math.min(corners[0][0], corners[1][0]);
        const x1 = Math.max(corners[0][0], corners[1][0]);
        const y0 = Math.min(corners[0][1], corners[1][1]);
        const y1 = Math.max(corners[0][1], corners[1][1]);
        const what = f.name;
        linQ(c, v, { key: `ext:${f.id}:${e.id}:w`, dir: "h", a: [x0, y0], b: [x1, y0], sides: ["top", "bottom"] }, what, { bottom: { a: [x0, y1], b: [x1, y1] } });
        linQ(c, v, { key: `ext:${f.id}:${e.id}:h`, dir: "v", a: [x1, y1], b: [x1, y0], sides: ["right", "left"] }, what, { left: { a: [x0, y1], b: [x0, y0] } });
        positionDims(c, v, [[x0, y1], [x1, y0]], null);
        if (depthTxt) callQ(c, { key: `ext:${f.id}:${e.id}:d`, view: v.key, tip: [(x0 + x1) / 2, y0], lines: [depthTxt.trim()], prefer: [0.7, -0.7] }, `${f.name} ${depthTxt.trim()}`);
        if (e.type === "rect" && e.r > 0) {
          const arc = findArc(v, [x1 - e.r, y0 + e.r], e.r);
          const lines = [`4× R${fmtDim(e.r)}`];
          if (arc) callQ(c, { key: `ext:${f.id}:${e.id}:r`, view: v.key, tip: arc.mid, lines, prefer: arc.out }, lines[0]);
        }
      }
    }
  }
}

/** Zaoblení a sražení hran: jeden popis s počtem hran, odkaz na oblouk / šikmou hranu v pohledu, kde jsou vidět. */
function edgeFeatureDims(c: Ctx) {
  for (const f of c.doc.features) {
    if (f.suppressed || (f.type !== "fillet" && f.type !== "chamfer")) continue;
    // počet z geometrie: plochy zaoblení (část válce / anuloid poloměru R), plochy sražení 45° (u jediného prvku Sražení);
    // výběr hran pravidlem může obsahovat i hrany, na které se prvek nepoužil (švy děr)
    const nEdges = Array.isArray(f.edges) ? f.edges.length : 0;
    let n = nEdges;
    if (f.type === "fillet") {
      const part = c.g.cyls.filter((x) => Math.abs(x.r - f.radius) < 1e-3 && x.area < 0.6 * 2 * Math.PI * x.r * Math.max(1e-9, x.t1 - x.t0)).length + c.g.tori.filter((x) => Math.abs(x.r - f.radius) < 1e-3).length;
      if (part > 0 && c.doc.features.filter((x) => x.type === "fillet" && !x.suppressed && Math.abs(x.radius - f.radius) < 1e-6).length === 1) n = part;
    } else if (c.doc.features.filter((x) => x.type === "chamfer" && !x.suppressed).length === 1) {
      const s2 = Math.SQRT1_2;
      const ch = c.g.planes.filter((p) => p.n.filter((v) => Math.abs(Math.abs(v) - s2) < 1e-4).length === 2).length + c.g.cones.length;
      if (ch > 0) n = ch;
    }
    const cnt = n > 1 ? `${n}× ` : "";
    if (f.type === "fillet") {
      const lines = [`${cnt}R${fmtDim(f.radius)}`];
      let placed = false;
      for (const v of c.views) {
        const arc = (v.ents ?? []).find((e) => e.t === "arc" && !e.hidden && Math.abs(e.r - f.radius) < 0.02 + 0.01 * f.radius && Math.abs(e.da) < Math.PI + 1e-6);
        if (!arc || arc.t !== "arc") continue;
        const a = arc.a0 + arc.da / 2;
        const out: Vec2 = [Math.cos(a), Math.sin(a)];
        placed = call(c, { key: `fil:${f.id}`, view: v.key, tip: [arc.c[0] + arc.r * out[0], arc.c[1] + arc.r * out[1]], lines, prefer: out }, lines[0]);
        break;
      }
      if (!placed && !c.seen.has(`C:${lines.join("|")}`)) c.skipped.push(tr("{0}: oblouk zaoblení v pohledu nenalezen", lines[0]));
    } else {
      const d = f.distance;
      const lines = [`${cnt}${fmtDim(d)}×45°`];
      let placed = false;
      for (const v of c.views) {
        const e = (v.ents ?? []).find((x) => x.t === "line" && !x.hidden && Math.abs(Math.hypot(x.b[0] - x.a[0], x.b[1] - x.a[1]) - d * Math.SQRT2) < 0.02 && Math.abs(Math.abs(x.b[0] - x.a[0]) - Math.abs(x.b[1] - x.a[1])) < 0.02);
        if (!e || e.t !== "line") continue;
        const mid: Vec2 = [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2];
        placed = call(c, { key: `cham:${f.id}`, view: v.key, tip: mid, lines }, lines[0]);
        break;
      }
      if (!placed && !c.seen.has(`C:${lines.join("|")}`)) c.skipped.push(tr("{0}: sražení v pohledu nenalezeno", lines[0]));
    }
  }
}
