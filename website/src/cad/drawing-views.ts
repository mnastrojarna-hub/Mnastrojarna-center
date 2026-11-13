/**
 * Další pohledy a řezy výkresu (vlna 7): pomocný pohled (ISO 128-30, metoda šipky – pohled kolmo na šikmou plochu nebo
 * podél hrany, skutečný tvar šikmé plochy), řez lomenou čarou – zalomený (rovnoběžné roviny spojené skoky) a natočený
 * (rameno řezu otočené do roviny hlavního ramena, ISO 128-44), částečný řez (vybraná oblast pohledu do hloubky) a přerušený
 * pohled (dlouhý díl zkrácený, kóty přes přerušení drží skutečnou délku).
 *
 * Pohledy se promítají přesně (HLR jádra s libovolným směrem – stejná mezipaměť projekcí jako hlavní pohledy, cad/drawing.ts),
 * řezy jsou booleovské operace s hranolem nad čarou řezu (výsledek se drží v mezipaměti podle tělesa a parametrů).
 * Tento modul nemá vlastní stav kromě mezipamětí; volá ho `makeDrawing` (cad/drawing.ts).
 */
import * as r from "replicad";
import { tr } from "./i18n";
import type { Vec2, Vec3 } from "./types";
import type { Cam, Layer, Poly, View, ViewEnt } from "./drawing";

// ---------------------------------------------------------------- volby (uložené v DrawingOptions)

/** Pomocný pohled: rodičovský pohled, hrana v něm (souřadnice pohledu) nebo směr / rovinná plocha modelu. */
export type AuxViewOpt = {
  id: string;
  /** písmeno pohledu (POHLED B) */
  label: string;
  /** klíč rodičovského pohledu (front, top…); u `dir` / `face` bez rodiče se vybere hlavní pohled, ve kterém je směr vidět */
  parent?: string;
  /** hrana v rodičovském pohledu (souřadnice pohledu, y dolů) – šikmá plocha viděná jako čára */
  edge?: [Vec2, Vec2];
  /** `normal` = pohled kolmo na hranu (skutečný tvar šikmé plochy), `along` = pohled podél hrany */
  mode?: "normal" | "along";
  /** směr k pozorovateli v souřadnicích modelu */
  dir?: Vec3;
  /** číslo rovinné plochy modelu (F1 = první plocha) – směr = její vnější normála */
  face?: number;
  /** pohled z opačné strany */
  flip?: boolean;
  /** střed pohledu na listu (mm listu, od levého horního rohu); bez = zarovnaně s rodičovským pohledem */
  at?: Vec2;
};

/** Řez lomenou čarou nakreslenou v rodičovském pohledu (souřadnice pohledu, y dolů). */
export type CutSectionOpt = {
  id: string;
  label: string;
  parent: string;
  /** `stepped` = zalomený řez (rovnoběžné úseky spojené skoky), `aligned` = natočený řez (3 body: konec hlavního ramena, vrchol, konec natočeného ramena) */
  kind: "stepped" | "aligned";
  pts: Vec2[];
  /** směr pohledu na opačnou stranu */
  flip?: boolean;
  at?: Vec2;
};

/** Částečný řez: uzavřená oblast v pohledu (souřadnice pohledu) a hloubka od přední strany materiálu [mm]. */
export type BrokenOutOpt = { id: string; view: string; pts: Vec2[]; depth: number; /** hranice jako hladká křivka (Catmull-Rom) */ spline?: boolean };

/** Přerušení pohledu: osa pohledu (x vodorovně, y svisle nahoru), interval v mm modelu, mezera na listu a tvar čáry. */
export type ViewBreakOpt = { id: string; view: string; axis: "x" | "y"; from: number; to: number; /** mezera mezi částmi [mm listu], výchozí 8 */ gap?: number; style?: "zigzag" | "wave" };

/**
 * Přerušení v souřadnicích obrazu pohledu: osa 0 = u (x), 1 = v (y dolů); interval (a, b) se odebere a části se přisunou
 * k sobě na mezeru `g` (jednotky pohledu). Souřadnice za přerušením se posunou – zobrazení je spojité a monotónní.
 */
export type Brk = { axis: 0 | 1; a: number; b: number; g: number; style?: "zigzag" | "wave" };

// ---------------------------------------------------------------- vektory

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => mul(a, 1 / (len(a) || 1));
const upOf = (c: Cam): Vec3 => cross(c.d, c.x);
/** bod obrazu pohledu (u, v dolů) → bod v rovině pohledu v modelu (hloubka 0) */
export const imgTo3 = (c: Cam, q: Vec2): Vec3 => add(mul(c.x, q[0]), mul(upOf(c), -q[1]));
/** směr v obraze → směr v modelu */
const dirTo3 = (c: Cam, q: Vec2): Vec3 => add(mul(c.x, q[0]), mul(upOf(c), -q[1]));
/** bod modelu → obraz (u, v dolů) */
export const projQ = (c: Cam, p: Vec3): Vec2 => [dot(p, c.x), -dot(p, upOf(c))];
const len2 = (q: Vec2) => Math.hypot(q[0], q[1]);
const unit2 = (q: Vec2): Vec2 => {
  const l = len2(q) || 1;
  return [q[0] / l, q[1] / l];
};
const V = (v: r.Vector): Vec3 => [v.x, v.y, v.z];

// ---------------------------------------------------------------- přerušený pohled: zobrazení souřadnic

/** sloučí překrývající se přerušení na téže ose a seřadí je */
export function normBrks(list: Brk[]): Brk[] {
  const out: Brk[] = [];
  for (const axis of [0, 1] as const) {
    const xs = list.filter((b) => b.axis === axis && b.b - b.a > 1e-9).sort((p, q) => p.a - q.a);
    for (const b of xs) {
      const last = out[out.length - 1];
      if (last && last.axis === axis && b.a <= last.b + 1e-9) {
        last.b = Math.max(last.b, b.b);
        last.g = Math.max(last.g, b.g);
      } else out.push({ ...b });
    }
  }
  return out;
}

/** souřadnice obrazu → zobrazená (zkrácená) souřadnice na jedné ose */
export function compress1(x: number, brks: Brk[], axis: 0 | 1): number {
  let shift = 0;
  for (const b of brks) {
    if (b.axis !== axis) continue;
    if (x >= b.b) shift += b.b - b.a - b.g;
    else if (x > b.a) return x - shift - (x - b.a) * (1 - b.g / (b.b - b.a));
    else break;
  }
  return x - shift;
}
/** zobrazená souřadnice → skutečná souřadnice obrazu (inverze compress1) */
export function decompress1(x: number, brks: Brk[], axis: 0 | 1): number {
  let shift = 0;
  for (const b of brks) {
    if (b.axis !== axis) continue;
    const a1 = b.a - shift; // začátek mezery v zobrazení
    if (x <= a1) break;
    if (x < a1 + b.g) return b.a + ((x - a1) / (b.g || 1)) * (b.b - b.a);
    shift += b.b - b.a - b.g;
  }
  return x + shift;
}
export const compressQ = (q: Vec2, brks?: Brk[]): Vec2 => (brks?.length ? [compress1(q[0], brks, 0), compress1(q[1], brks, 1)] : q);
export const decompressQ = (q: Vec2, brks?: Brk[]): Vec2 => (brks?.length ? [decompress1(q[0], brks, 0), decompress1(q[1], brks, 1)] : q);

/** je bod uvnitř některého odebraného intervalu (otevřeného) */
const inGap = (q: Vec2, brks: Brk[]) => brks.some((b) => q[b.axis] > b.a + 1e-9 && q[b.axis] < b.b - 1e-9);

/**
 * Odebere z lomené čáry části uvnitř přerušení (souřadnice obrazu zůstanou skutečné – zkrácení provede až zobrazení
 * `compressQ`). Čára přes přerušení se rozdělí na části končící na jeho hranách.
 */
export function clipBreaks(pts: Vec2[], brks?: Brk[]): Vec2[][] {
  if (!brks?.length) return [pts];
  const out: Vec2[][] = [];
  let cur: Vec2[] = [];
  const flush = () => {
    if (cur.length > 1) out.push(cur);
    cur = [];
  };
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i];
    const q = pts[i + 1];
    // body dělení úsečky na hranách přerušení
    const ts = [0, 1];
    for (const b of brks) {
      const d = q[b.axis] - p[b.axis];
      if (Math.abs(d) < 1e-12) continue;
      for (const c of [b.a, b.b]) {
        const t = (c - p[b.axis]) / d;
        if (t > 1e-9 && t < 1 - 1e-9) ts.push(t);
      }
    }
    ts.sort((x, y) => x - y);
    for (let k = 0; k + 1 < ts.length; k++) {
      const t0 = ts[k];
      const t1 = ts[k + 1];
      if (t1 - t0 < 1e-12) continue;
      const A: Vec2 = [p[0] + (q[0] - p[0]) * t0, p[1] + (q[1] - p[1]) * t0];
      const B: Vec2 = [p[0] + (q[0] - p[0]) * t1, p[1] + (q[1] - p[1]) * t1];
      const M: Vec2 = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
      if (inGap(M, brks)) {
        flush();
        continue;
      }
      const last = cur[cur.length - 1];
      if (!last || Math.hypot(last[0] - A[0], last[1] - A[1]) > 1e-9) {
        flush();
        cur.push(A);
      }
      cur.push(B);
    }
  }
  flush();
  return out;
}

/**
 * Přerušení zadané na pohledu (osa x / y pohledu, interval v mm modelu, y nahoru) jako směr v modelu a interval podél něj –
 * použije se na všechny pravoúhlé pohledy, ve kterých tento směr leží (pohledy zůstanou v promítacích čarách).
 */
export function breakDir(cam: Cam, b: ViewBreakOpt): { dir: Vec3; lo: number; hi: number } {
  const dir = b.axis === "x" ? cam.x : upOf(cam);
  return { dir, lo: Math.min(b.from, b.to), hi: Math.max(b.from, b.to) };
}
/** přerušení (směr v modelu, interval) v obraze pohledu `cam`; null = směr v pohledu neleží */
export function brkInView(cam: Cam, dir: Vec3, lo: number, hi: number, g: number, style?: "zigzag" | "wave"): Brk | null {
  const sx = dot(dir, cam.x);
  const sy = dot(dir, upOf(cam));
  if (Math.abs(sx) > 0.999) return sx > 0 ? { axis: 0, a: lo, b: hi, g, style } : { axis: 0, a: -hi, b: -lo, g, style };
  // v = −p·up: interval podél up se v obraze otočí
  if (Math.abs(sy) > 0.999) return sy > 0 ? { axis: 1, a: -hi, b: -lo, g, style } : { axis: 1, a: lo, b: hi, g, style };
  return null;
}

/** Čáry přerušení (list): dvě rovnoběžné čáry na hranách mezery, přes celý pohled s přesahem; cikcak uprostřed nebo vlnovka. */
export function breakLines(a: Vec2, b: Vec2, style: "zigzag" | "wave" = "zigzag"): Vec2[] {
  const L = len2([b[0] - a[0], b[1] - a[1]]);
  if (L < 1e-6) return [a, b];
  const u: Vec2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const n: Vec2 = [-u[1], u[0]];
  const at = (t: number, o: number): Vec2 => [a[0] + u[0] * t + n[0] * o, a[1] + u[1] * t + n[1] * o];
  if (style === "wave") {
    // volná vlnovka (ISO 128: tenká čára od ruky) – sinusovka s amplitudou 1,2 mm a vlnou ~ 10 mm
    const waves = Math.max(1, Math.round(L / 10));
    const n0 = waves * 16;
    const pts: Vec2[] = [];
    for (let k = 0; k <= n0; k++) {
      const t = (k / n0) * L;
      pts.push(at(t, 1.2 * Math.sin((t / L) * waves * 2 * Math.PI)));
    }
    return pts;
  }
  // tenká čára s cikcakem uprostřed (ISO 128-20, typ 01.1 s cikcakem)
  const m = L / 2;
  const z = Math.min(3, L / 6);
  return [at(0, 0), at(m - z, 0), at(m - z / 2, 2.2), at(m + z / 2, -2.2), at(m + z, 0), at(L, 0)];
}

// ---------------------------------------------------------------- mnohoúhelníky

/** bod uvnitř mnohoúhelníku (sudo-liché pravidlo) */
export function inPolygon(q: Vec2, poly: Vec2[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a[1] > q[1] !== b[1] > q[1] && q[0] < ((b[0] - a[0]) * (q[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

/** Ořízne lomenou čáru mnohoúhelníkem: `inside` = ponechá části uvnitř, jinak vně. */
export function clipToPolygon(pts: Vec2[], poly: Vec2[], inside: boolean): Vec2[][] {
  const out: Vec2[][] = [];
  let cur: Vec2[] = [];
  const flush = () => {
    if (cur.length > 1) out.push(cur);
    cur = [];
  };
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i];
    const q = pts[i + 1];
    const ts = [0, 1];
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k];
      const b = poly[(k + 1) % poly.length];
      const ex = b[0] - a[0];
      const ey = b[1] - a[1];
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-14) continue;
      const t = ((a[0] - p[0]) * ey - (a[1] - p[1]) * ex) / den;
      const s = ((a[0] - p[0]) * dy - (a[1] - p[1]) * dx) / den;
      if (t > 1e-9 && t < 1 - 1e-9 && s >= -1e-9 && s <= 1 + 1e-9) ts.push(t);
    }
    ts.sort((x, y) => x - y);
    for (let k = 0; k + 1 < ts.length; k++) {
      const t0 = ts[k];
      const t1 = ts[k + 1];
      if (t1 - t0 < 1e-12) continue;
      const A: Vec2 = [p[0] + dx * t0, p[1] + dy * t0];
      const B: Vec2 = [p[0] + dx * t1, p[1] + dy * t1];
      if (inPolygon([(A[0] + B[0]) / 2, (A[1] + B[1]) / 2], poly) !== inside) {
        flush();
        continue;
      }
      const last = cur[cur.length - 1];
      if (!last || Math.hypot(last[0] - A[0], last[1] - A[1]) > 1e-9) {
        flush();
        cur.push(A);
      }
      cur.push(B);
    }
  }
  flush();
  return out;
}

/** Uzavřená hladká křivka (Catmull-Rom) přes body – hranice částečného řezu „od ruky“. */
export function closedSpline(pts: Vec2[], per = 10): Vec2[] {
  const n = pts.length;
  if (n < 3) return [...pts];
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    for (let k = 0; k < per; k++) {
      const t = k / per;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  return out;
}

/** hranice částečného řezu v souřadnicích pohledu (uzavřená – bez opakování prvního bodu) */
export const brokenOutPolygon = (b: BrokenOutOpt): Vec2[] => (b.spline ? closedSpline(b.pts) : b.pts);

/** Ořez mnohoúhelníku polorovinou {q : (q − o)·n ≤ 0} (Sutherland–Hodgman). */
export function clipHalfplane(poly: Vec2[], o: Vec2, n: Vec2): Vec2[] {
  const out: Vec2[] = [];
  const f = (q: Vec2) => (q[0] - o[0]) * n[0] + (q[1] - o[1]) * n[1];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const fa = f(a);
    const fb = f(b);
    if (fa <= 0) out.push(a);
    if (fa * fb < 0) {
      const t = fa / (fa - fb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

// ---------------------------------------------------------------- kamery pomocných pohledů a řezů

/**
 * Kamera pohledu ve směru `d` (k pozorovateli) sousedního s rodičovským pohledem `parent` (metoda šipky): osa sklopení
 * je kolmá na `d` i na směr rodiče, obraz je natočený tak, že směr k pozorovateli rodiče míří v novém pohledu ve směru
 * šipky (`arrow` = obraz směru pohledu v rodiči) – při zarovnaném umístění pohled odpovídá promítání (E i A).
 */
export function neighborCam(parent: Cam, d: Vec3): { cam: Cam; arrow: Vec2 } {
  d = unit(d);
  const D0 = parent.d;
  const cd = dot(D0, d);
  if (Math.abs(cd) > 0.999) throw new Error(tr("směr pomocného pohledu je shodný se směrem rodičovského pohledu – vyberte šikmou hranu nebo jiný pohled"));
  const Dp = unit(sub(D0, mul(d, cd)));
  const f = unit(cross(d, D0));
  const arrow = unit2(projQ(parent, mul(d, -1)));
  const tau = dot(Dp, cross(d, f)) >= 0 ? 1 : -1;
  const x = unit(add(mul(f, -tau * arrow[1]), mul(Dp, arrow[0])));
  return { cam: { d, x }, arrow };
}

/** Směr pomocného pohledu z hrany rodičovského pohledu: kolmo na hranu (ven z obrysu) nebo podél ní. */
export function auxDirFromEdge(parent: Cam, edge: [Vec2, Vec2], center: Vec2, mode: "normal" | "along" = "normal", flip = false): Vec3 {
  const e: Vec2 = [edge[1][0] - edge[0][0], edge[1][1] - edge[0][1]];
  if (len2(e) < 1e-9) throw new Error(tr("hrana pomocného pohledu má nulovou délku"));
  const m: Vec2 = [(edge[0][0] + edge[1][0]) / 2, (edge[0][1] + edge[1][1]) / 2];
  const out: Vec2 = [m[0] - center[0], m[1] - center[1]];
  let w: Vec2 = mode === "along" ? unit2(e) : unit2([-e[1], e[0]]);
  // pozorovatel stojí vně obrysu: směr od středu pohledu k hraně (u „podél“ ke konci hrany dál od středu)
  if (w[0] * out[0] + w[1] * out[1] < 0) w = [-w[0], -w[1]];
  if (flip) w = [-w[0], -w[1]];
  return unit(dirTo3(parent, w));
}

// ---------------------------------------------------------------- kernel: tvorba řezů

type Shape3 = r.Shape3D;
const cutCache = new WeakMap<object, Map<string, Shape3 | null>>();
function cached(shape: Shape3, key: string, make: () => Shape3 | null): Shape3 | null {
  let m = cutCache.get(shape);
  if (!m) cutCache.set(shape, (m = new Map()));
  if (m.has(key)) return m.get(key) ?? null;
  let s: Shape3 | null = null;
  try {
    s = make();
  } catch {
    s = null;
  }
  m.set(key, s);
  return s;
}

/** rozsah tělesa podél směru */
function spanAlong(shape: Shape3, d: Vec3): [number, number] {
  const [[x0, y0, z0], [x1, y1, z1]] = shape.boundingBox.bounds as [Vec3, Vec3];
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) {
    const t = dot([x, y, z], d);
    lo = Math.min(lo, t);
    hi = Math.max(hi, t);
  }
  return [lo, hi];
}
const diag = (shape: Shape3) => {
  const [[x0, y0, z0], [x1, y1, z1]] = shape.boundingBox.bounds as [Vec3, Vec3];
  return Math.hypot(x1 - x0, y1 - y0, z1 - z0);
};

/** hranol: mnohoúhelník v obraze pohledu `cam` vytažený podél směru pohledu od t0 do t1 */
function prism(cam: Cam, poly: Vec2[], t0: number, t1: number): Shape3 {
  const pts = poly.map((q) => add(imgTo3(cam, q), mul(cam.d, t0)));
  const face = r.makePolygon(pts as [number, number, number][]);
  return r.basicFaceExtrusion(face, new r.Vector(mul(cam.d, t1 - t0))) as unknown as Shape3;
}

/** Rovinné plochy tělesa ležící v rovině (normála n, n·p = c) – obrysy pro šrafování v obraze `cam`; `keep` = další podmínka na střed plochy. */
function planeLoops(shape: Shape3, n: Vec3, c: number, cam: Cam, keep?: (center: Vec3) => boolean): Vec2[][] {
  const loops: Vec2[][] = [];
  const tol = Math.max(1e-4, diag(shape) * 1e-6) * 10;
  for (const f of shape.faces) {
    try {
      if (f.geomType !== "PLANE") continue;
      const ctr = V(f.center);
      if (Math.abs(dot(ctr, n) - c) > tol) continue;
      const fn = V(f.normalAt(f.center));
      if (Math.abs(Math.abs(dot(fn, n)) - 1) > 1e-6) continue;
      if (keep && !keep(ctr)) continue;
      for (const e of f.edges) {
        const nseg = e.geomType === "LINE" ? 1 : 40;
        const pts: Vec2[] = [];
        for (let i = 0; i <= nseg; i++) pts.push(projQ(cam, V(e.pointAt(i / nseg))));
        loops.push(pts);
      }
    } catch {
      /* plocha bez geometrie */
    }
  }
  return loops;
}

/** Vynechá úseky lomených čar ležící na přímce (bod `o`, směr `u`) – čáry skoků řezu se v řezu nekreslí (ISO 128-44). */
export function dropOnLine(polys: Poly[], o: Vec2, u: Vec2, tol = 1e-3): Poly[] {
  const n = unit2([-u[1], u[0]]);
  const on = (p: Vec2) => Math.abs((p[0] - o[0]) * n[0] + (p[1] - o[1]) * n[1]) < tol;
  const out: Poly[] = [];
  for (const pl of polys) {
    if (pl.layer !== "visible" && pl.layer !== "hidden") {
      out.push(pl);
      continue;
    }
    let cur: Vec2[] = [pl.pts[0]];
    for (let i = 1; i < pl.pts.length; i++) {
      if (on(pl.pts[i - 1]) && on(pl.pts[i])) {
        if (cur.length > 1) out.push({ ...pl, pts: cur });
        cur = [pl.pts[i]];
      } else cur.push(pl.pts[i]);
    }
    if (cur.length > 1) out.push({ ...pl, pts: cur });
  }
  return out;
}

export type ProjectFn = (shape: Shape3, key: string, cam: Cam, hidden: boolean) => View;

/** Výsledek pomocného pohledu / řezu: pohled (obraz), obrysy šrafování a údaje pro šipky a zarovnání v rodiči. */
export type ExtraViewData = {
  kind: "aux" | "cut";
  key: string;
  label: string;
  parent: string;
  view: View;
  /** obrysy řezných ploch (souřadnice obrazu) */
  loops: Vec2[][];
  /** směr šipky v rodiči (obraz rodiče, y dolů) */
  arrow: Vec2;
  /** kotevní bod: v obraze rodiče a v obraze nového pohledu (zarovnání) */
  anchorParent: Vec2;
  anchorView: Vec2;
  /** kotevní bod leží na geometrii (hrana / plocha) – šipka míří přímo na ni; jinak (zadaný směr) vně obrysu rodiče */
  onEdge?: boolean;
  /** čára řezu v rodiči (souřadnice obrazu rodiče) a šipky na koncích (u natočeného řezu každé rameno vlastní) */
  path?: Vec2[];
  arrows?: { at: Vec2; dir: Vec2 }[];
  at?: Vec2;
};

const keyOf = (o: object) => JSON.stringify(o);

/** Pomocný pohled: směr (z hrany / směru / plochy) → přesná projekce (HLR s vlastním směrem, mezipaměť projekcí). */
export function auxView(shape: Shape3, a: AuxViewOpt, parentKey: string, parent: View, hidden: boolean, project: ProjectFn): ExtraViewData {
  let d: Vec3;
  let anchor2: Vec2;
  const center: Vec2 = [parent.x0 + parent.w / 2, parent.y0 + parent.h / 2];
  if (a.edge) {
    d = auxDirFromEdge(parent.cam, a.edge, center, a.mode ?? "normal", a.flip);
    anchor2 = [(a.edge[0][0] + a.edge[1][0]) / 2, (a.edge[0][1] + a.edge[1][1]) / 2];
  } else if (a.face != null) {
    const f = shape.faces[a.face - 1];
    if (!f) throw new Error(tr("plocha F{0} v tělese není – těleso má {1} ploch", a.face, shape.faces.length));
    if (f.geomType !== "PLANE") throw new Error(tr("pomocný pohled: plocha F{0} není rovinná", a.face));
    const c = V(f.center);
    d = unit(V(f.normalAt(f.center)));
    if (a.flip) d = mul(d, -1);
    anchor2 = projQ(parent.cam, c);
  } else if (a.dir) {
    if (len(a.dir) < 1e-9) throw new Error(tr("pomocný pohled: směr má nulovou délku"));
    d = unit(a.flip ? mul(a.dir, -1) : a.dir);
    anchor2 = center;
  } else throw new Error(tr("pomocný pohled potřebuje hranu, směr nebo plochu"));
  const { cam, arrow } = neighborCam(parent.cam, d);
  const view = project(shape, `aux:${a.label}`, cam, hidden);
  const p3 = imgTo3(parent.cam, anchor2);
  return { kind: "aux", key: `aux:${a.label}`, label: a.label, parent: parentKey, view, loops: [], arrow, anchorParent: anchor2, anchorView: projQ(cam, p3), onEdge: !!a.edge || a.face != null, at: a.at };
}

/** Pro `dir` / `face` bez rodiče: pohled, ve kterém je směr nejvíc „z boku“ (směr leží co nejvíc v rovině pohledu). */
export function pickParent(views: { key: string; cam: Cam }[], d: Vec3): string | null {
  let best: string | null = null;
  let bv = Infinity;
  for (const v of views) {
    const c = Math.abs(dot(v.cam.d, unit(d)));
    if (c < bv - 1e-9) {
      bv = c;
      best = v.key;
    }
  }
  return bv < 0.999 ? best : null;
}

/**
 * Zalomený / natočený řez: odebere materiál na straně pozorovatele lomené čáry (hranol přes celé těleso podél směru
 * rodičovského pohledu), u natočeného řezu otočí část za šikmým ramenem do roviny hlavního ramena. Šrafují se plochy
 * ležící v rovinách ramen; čáry skoků (zalomení) a hrany dělení u natočeného řezu se v řezu nekreslí.
 */
export function cutSection(shape: Shape3, c: CutSectionOpt, parent: View, hidden: boolean, project: ProjectFn): ExtraViewData {
  const P = parent.cam;
  const pts = c.pts;
  if (pts.length < 2) throw new Error(tr("řez potřebuje alespoň dva body čáry řezu"));
  if (c.kind === "aligned" && pts.length !== 3) throw new Error(tr("natočený řez: zadejte 3 body – konec hlavního ramena, vrchol (střed otočení) a konec natočeného ramena"));
  const E = 2 * diag(shape) + 10;
  const [tlo, thi] = spanAlong(shape, P.d);
  const T0 = tlo - 5;
  const T1 = thi + 5;
  const key = `cut:${c.label}`;
  // hlavní rameno a směr pohledu (šipka): kolmo na hlavní rameno, výchozí „doleva“ od směru čáry (u vodorovné čáry nahoru)
  const main: [Vec2, Vec2] = c.kind === "aligned" ? [pts[1], pts[0]] : [pts[0], pts[1]];
  const u1 = unit2([main[1][0] - main[0][0], main[1][1] - main[0][1]]);
  let arrow: Vec2 = c.kind === "aligned" ? [-u1[1], u1[0]] : [u1[1], -u1[0]];
  if (c.flip) arrow = [-arrow[0], -arrow[1]];
  const s1: Vec2 = [-arrow[0], -arrow[1]]; // strana pozorovatele (odebíraný materiál)
  const d = unit(dirTo3(P, s1));
  const { cam } = neighborCam(P, d);
  const n3 = d; // normála hlavní roviny řezu (k pozorovateli)
  let body: Shape3 | null;
  let loops: Vec2[][];
  let drops: { o: Vec2; u: Vec2 }[] = [];
  const imgD = projQ(cam, P.d); // obraz směru rodiče v řezu (čáry skoků a dělení leží v tomto směru)
  const arrows: { at: Vec2; dir: Vec2 }[] = [];
  if (c.kind === "stepped") {
    for (let i = 0; i + 1 < pts.length; i++) if (len2([pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]]) < 1e-9) throw new Error(tr("řez: dva shodné body čáry řezu"));
    const first = u1;
    const last = unit2([pts[pts.length - 1][0] - pts[pts.length - 2][0], pts[pts.length - 1][1] - pts[pts.length - 2][1]]);
    const a0: Vec2 = [pts[0][0] - first[0] * E, pts[0][1] - first[1] * E];
    const an: Vec2 = [pts[pts.length - 1][0] + last[0] * E, pts[pts.length - 1][1] + last[1] * E];
    const poly: Vec2[] = [a0, ...pts, an, [an[0] + s1[0] * E, an[1] + s1[1] * E], [a0[0] + s1[0] * E, a0[1] + s1[1] * E]];
    body = cached(shape, keyOf({ k: "step", P, poly, T0, T1 }), () => shape.clone().cut(prism(P, poly, T0, T1)) as Shape3);
    if (!body) throw new Error(tr("řez {0}–{0} se nepodařilo vytvořit", c.label));
    // šrafují se plochy v rovinách ramen kolmých na směr pohledu (skoky jsou vidět z boku)
    loops = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const dir = unit2([pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]]);
      const ln = unit(dirTo3(P, [-dir[1], dir[0]]));
      if (Math.abs(dot(ln, n3)) < 0.1) continue;
      const o3 = imgTo3(P, pts[i]);
      const lo = Math.min(0, dot(sub(imgTo3(P, pts[i + 1]), o3), dirTo3(P, dir)));
      const hi = Math.max(0, dot(sub(imgTo3(P, pts[i + 1]), o3), dirTo3(P, dir)));
      // krajní ramena pokračují za koncové body (čára řezu přesahuje obrys)
      const tMin = i === 0 ? -Infinity : lo - 1e-6;
      const tMax = i === pts.length - 2 ? Infinity : hi + 1e-6;
      loops.push(
        ...planeLoops(body, ln, dot(ln, o3), cam, (ctr) => {
          const t = dot(sub(ctr, o3), dirTo3(P, dir));
          return t >= tMin && t <= tMax;
        }),
      );
    }
    for (let i = 1; i + 1 < pts.length; i++) drops.push({ o: projQ(cam, imgTo3(P, pts[i])), u: imgD });
    arrows.push({ at: pts[0], dir: arrow }, { at: pts[pts.length - 1], dir: arrow });
  } else {
    const Vx = pts[1];
    const u2 = unit2([pts[2][0] - Vx[0], pts[2][1] - Vx[1]]);
    const crossZ = u1[0] * u2[1] - u1[1] * u2[0];
    if (Math.abs(crossZ) < 1e-6 && u1[0] * u2[0] + u1[1] * u2[1] > 0) throw new Error(tr("natočený řez: ramena leží na sobě – zvolte jiný bod"));
    // úhel otočení (v obraze rodiče) ze směru u2 do −u1 a strana pozorovatele šikmého ramena
    const th = Math.atan2(u2[0] * -u1[1] - u2[1] * -u1[0], u2[0] * -u1[0] + u2[1] * -u1[1]);
    const rot = (q: Vec2, a: number): Vec2 => [q[0] * Math.cos(a) - q[1] * Math.sin(a), q[0] * Math.sin(a) + q[1] * Math.cos(a)];
    const s2 = rot(s1, -th);
    const quad = (u: Vec2, s: Vec2): Vec2[] => [Vx, [Vx[0] + u[0] * E, Vx[1] + u[1] * E], [Vx[0] + u[0] * E - s[0] * E, Vx[1] + u[1] * E - s[1] * E], [Vx[0] - s[0] * E, Vx[1] - s[1] * E]];
    const q1 = quad(u1, s1);
    const q2 = quad(u2, s2);
    const V3 = imgTo3(P, Vx);
    body = cached(shape, keyOf({ k: "align", P, q1, q2, T0, T1 }), () => {
      const p1 = shape.clone().intersect(prism(P, q1, T0, T1)) as Shape3;
      const p2 = shape.clone().intersect(prism(P, q2, T0, T1)) as Shape3;
      // otočení v obraze o +th (z u2 do −u1) = otočení v modelu o −th kolem směru pohledu rodiče
      const p2r = p2.rotate((-th * 180) / Math.PI, V3, P.d) as Shape3;
      return r.makeCompound([p1, p2r]) as unknown as Shape3;
    });
    if (!body) throw new Error(tr("řez {0}–{0} se nepodařilo vytvořit", c.label));
    loops = planeLoops(body, n3, dot(n3, V3), cam);
    drops = [{ o: projQ(cam, V3), u: imgD }];
    arrows.push({ at: pts[0], dir: arrow }, { at: pts[2], dir: [-s2[0], -s2[1]] });
  }
  const view = project(body, key, cam, hidden);
  for (const dr of drops) view.polys = dropOnLine(view.polys, dr.o, dr.u, Math.max(1e-3, 1e-5 * (view.w + view.h)));
  const a3 = imgTo3(P, pts[0]);
  return { kind: "cut", key, label: c.label, parent: c.parent, view, loops, arrow, anchorParent: pts[0], anchorView: projQ(cam, a3), path: pts, arrows, at: c.at };
}

/**
 * Částečný řez v pohledu: materiál uvnitř oblasti se odebere od přední strany do hloubky `depth`; uvnitř oblasti se
 * kreslí obraz řezu, vně původní pohled, hranice tenkou čarou od ruky a řezné plochy (v hloubce řezu) se šrafují.
 */
export function brokenOut(shape: Shape3, b: BrokenOutOpt, view: View, hidden: boolean, project: ProjectFn): { view: View; loops: Vec2[][]; boundary: Vec2[] } {
  const poly = brokenOutPolygon(b);
  if (poly.length < 3) throw new Error(tr("částečný řez: oblast potřebuje alespoň 3 body"));
  if (!(b.depth > 0)) throw new Error(tr("částečný řez: hloubka musí být kladná"));
  const cam = view.cam;
  const [, front] = spanAlong(shape, cam.d);
  const tCut = front - b.depth;
  const body = cached(shape, keyOf({ k: "bo", cam, poly, tCut }), () => shape.clone().cut(prism(cam, poly, tCut, front + 10)) as Shape3);
  if (!body) throw new Error(tr("částečný řez se nepodařilo vytvořit"));
  const cutView = project(body, `${view.key}#bo`, cam, hidden);
  const polys: Poly[] = [];
  for (const pl of view.polys) for (const part of clipToPolygon(pl.pts, poly, false)) polys.push({ ...pl, pts: part });
  for (const pl of cutView.polys) for (const part of clipToPolygon(pl.pts, poly, true)) polys.push({ ...pl, pts: part });
  const boundary = [...poly, poly[0]];
  polys.push({ layer: "thin" as Layer, pts: boundary });
  const mid = (e: ViewEnt): Vec2 => (e.t === "line" ? [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2] : e.c);
  const ents = [...view.ents.filter((e) => !inPolygon(mid(e), poly)), ...cutView.ents.filter((e) => inPolygon(mid(e), poly))];
  const loops = planeLoops(body, cam.d, tCut, cam, (ctr) => inPolygon(projQ(cam, ctr), poly));
  return { view: { ...view, polys, ents }, loops, boundary };
}
