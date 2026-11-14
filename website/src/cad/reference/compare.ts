/**
 * Porovnání 1:1: promítnutý pohled modelu (hrany pohledu z výkresu – stejný směr pohledu) proti geometrii pohledu
 * předlohy. Sesouhlasení: otočení po 90°, zrcadlení, posun (obálky, středy kružnic, doladění nejbližšími body).
 * Výsledek: pokrytí předlohy modelem a modelu předlohou v toleranci (výchozí 0,06 mm), seznam úseků mimo toleranci
 * s polohou, obrázek SVG s překryvem. Kontrola kót: definiční body kót předlohy → nejbližší geometrie modelu → hodnota.
 */
import { tr } from "../i18n";
import type { Vec2 } from "../draft/model";
import { curveSegs } from "./geom";
import type { GeomItem } from "./geom";
import type { Circ, RefCompare, RefDim, RefDimCheck, RefView, Seg } from "./types";

/** hrana pohledu modelu (jako ViewEnt z drawing.ts: souřadnice obrazu, osa Y dolů) */
export type ModelEnt = { t: "line"; a: Vec2; b: Vec2; hidden?: boolean } | { t: "arc"; c: Vec2; r: number; a0: number; da: number; hidden?: boolean };
/** geometrie k porovnání (mm, osa Y nahoru) */
export type Geo = { segs: Seg[]; circles: Circ[]; box: { x0: number; y0: number; x1: number; y1: number } };

const chordStep = (r: number, tol: number) => Math.max(0.02, Math.min(Math.PI / 18, 2 * Math.acos(Math.max(-1, 1 - Math.min(r, tol / 4) / Math.max(r, 1e-9)))));
function boxOfSegs(segs: Seg[]) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of segs)
    for (const p of [s.a, s.b]) {
      if (p[0] < x0) x0 = p[0];
      if (p[1] < y0) y0 = p[1];
      if (p[0] > x1) x1 = p[0];
      if (p[1] > y1) y1 = p[1];
    }
  return { x0, y0, x1, y1 };
}

/** hrany pohledu modelu → geometrie (Y nahoru); `hidden: false` = jen viditelné hrany */
export function modelGeo(ents: readonly ModelEnt[], o: { hidden?: boolean; tol?: number } = {}): Geo {
  const tol = o.tol ?? 0.06;
  const segs: Seg[] = [];
  const circles: Circ[] = [];
  const F = (p: Vec2): Vec2 => [p[0], -p[1]];
  for (const e of ents) {
    if (e.hidden && o.hidden === false) continue;
    if (e.t === "line") segs.push({ a: F(e.a), b: F(e.b), ...(e.hidden ? { hidden: true } : {}) });
    else {
      if (Math.abs(e.da) >= 2 * Math.PI - 1e-6 || Math.abs(e.da) > 0.5) circles.push({ c: F(e.c), r: e.r });
      const n = Math.max(2, Math.ceil(Math.abs(e.da) / chordStep(e.r, tol)));
      let prev: Vec2 | null = null;
      for (let i = 0; i <= n; i++) {
        const a = e.a0 + (e.da * i) / n;
        const p = F([e.c[0] + e.r * Math.cos(a), e.c[1] + e.r * Math.sin(a)]);
        if (prev) segs.push({ a: prev, b: p, ...(e.hidden ? { hidden: true } : {}) });
        prev = p;
      }
    }
  }
  return { segs, circles, box: boxOfSegs(segs) };
}

/** geometrie pohledu předlohy → mm skutečné velikosti (÷ měřítko geometrie pohledu) */
export function refGeo(items: readonly GeomItem[], view: RefView, o: { hidden?: boolean; tol?: number } = {}): Geo {
  const tol = o.tol ?? 0.06;
  const k = 1 / (view.geomScale || 1);
  const segs: Seg[] = [];
  const circles: Circ[] = [];
  const S = (p: Vec2): Vec2 => [p[0] * k, p[1] * k];
  for (const g of items) {
    // osy a tenké plné čáry (kóty, šrafy, osy v PDF) nejsou hrany tělesa
    if (g.lt === "center" || g.lt === "thin") continue;
    if (g.lt === "hidden" && o.hidden === false) continue;
    if (g.curve.k === "arc" && Math.abs(g.curve.sweep) > 0.5) circles.push({ c: S(g.curve.c), r: g.curve.r * k });
    const step = g.curve.k === "arc" ? Math.max(0.05, g.curve.r * chordStep(g.curve.r * k, tol)) : 1;
    for (const [a, b] of curveSegs(g.curve, step)) segs.push({ a: S(a), b: S(b), ...(g.lt === "hidden" ? { hidden: true } : {}), ...(g.thread ? { thread: true } : {}) });
  }
  return { segs, circles, box: boxOfSegs(segs) };
}

/** mřížka úseků pro rychlé hledání nejbližšího bodu */
class SegGrid {
  private cells = new Map<string, number[]>();
  constructor(private segs: Seg[], private cs: number) {
    segs.forEach((s, i) => {
      const x0 = Math.floor(Math.min(s.a[0], s.b[0]) / cs);
      const x1 = Math.floor(Math.max(s.a[0], s.b[0]) / cs);
      const y0 = Math.floor(Math.min(s.a[1], s.b[1]) / cs);
      const y1 = Math.floor(Math.max(s.a[1], s.b[1]) / cs);
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++) {
          const k = `${x},${y}`;
          const c = this.cells.get(k);
          if (c) c.push(i);
          else this.cells.set(k, [i]);
        }
    });
  }
  /** nejbližší bod do vzdálenosti `r` (null = nic) */
  nearest(p: Vec2, r: number): { d: number; q: Vec2; i: number } | null {
    const n = Math.ceil(r / this.cs);
    const cx = Math.floor(p[0] / this.cs);
    const cy = Math.floor(p[1] / this.cs);
    let best: { d: number; q: Vec2; i: number } | null = null;
    const seen = new Set<number>();
    for (let x = cx - n; x <= cx + n; x++)
      for (let y = cy - n; y <= cy + n; y++) {
        const c = this.cells.get(`${x},${y}`);
        if (!c) continue;
        for (const i of c) {
          if (seen.has(i)) continue;
          seen.add(i);
          const s = this.segs[i];
          const dx = s.b[0] - s.a[0];
          const dy = s.b[1] - s.a[1];
          const L2 = dx * dx + dy * dy;
          const t = L2 > 0 ? Math.max(0, Math.min(1, ((p[0] - s.a[0]) * dx + (p[1] - s.a[1]) * dy) / L2)) : 0;
          const q: Vec2 = [s.a[0] + t * dx, s.a[1] + t * dy];
          const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
          if (d <= r && (!best || d < best.d)) best = { d, q, i };
        }
      }
    return best;
  }
}

/** sesouhlasení předlohy s modelem: p' = R(rot)·M(mirror)·p + (dx, dy) */
export type Align = { rot: number; mirror: boolean; dx: number; dy: number };
export function applyAlign(al: Align, p: Vec2): Vec2 {
  const x = al.mirror ? -p[0] : p[0];
  const y = p[1];
  const a = (al.rot * Math.PI) / 180;
  const c = Math.round(Math.cos(a) * 1e12) / 1e12;
  const s = Math.round(Math.sin(a) * 1e12) / 1e12;
  return [c * x - s * y + al.dx, s * x + c * y + al.dy];
}
const alignVec = (al: Align, v: Vec2): Vec2 => {
  const p = applyAlign({ ...al, dx: 0, dy: 0 }, v);
  return p;
};

/** body na úsecích po kroku (s délkou, kterou bod zastupuje) */
function samples(segs: Seg[], step: number): { p: Vec2; w: number; seg: number }[] {
  const out: { p: Vec2; w: number; seg: number }[] = [];
  segs.forEach((s, i) => {
    const L = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
    if (L <= 1e-9) return;
    const n = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      out.push({ p: [s.a[0] + t * (s.b[0] - s.a[0]), s.a[1] + t * (s.b[1] - s.a[1])], w: L / n, seg: i });
    }
  });
  return out;
}

const transformGeo = (g: Geo, al: Align): Geo => {
  const segs = g.segs.map((s) => ({ ...s, a: applyAlign(al, s.a), b: applyAlign(al, s.b) }));
  return { segs, circles: g.circles.map((c) => ({ c: applyAlign(al, c.c), r: c.r })), box: boxOfSegs(segs) };
};

function score(ref: Geo, grid: SegGrid, al: Align, tol: number, step: number): number {
  const pts = samples(ref.segs, step);
  let tot = 0;
  let hit = 0;
  for (const s of pts) {
    tot += s.w;
    if (grid.nearest(applyAlign(al, s.p), tol)) hit += s.w;
  }
  return tot > 0 ? hit / tot : 0;
}

/** nejlepší sesouhlasení (otočení po 90°, zrcadlení, posun) – null = obálky si neodpovídají */
export function findAlign(ref: Geo, mod: Geo, tol: number, fixed?: Partial<Align>, o: { anySize?: boolean } = {}): Align | null {
  const rw = ref.box.x1 - ref.box.x0;
  const rh = ref.box.y1 - ref.box.y0;
  const mw = mod.box.x1 - mod.box.x0;
  const mh = mod.box.y1 - mod.box.y0;
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, 0.03 * Math.max(a, b));
  const grid = new SegGrid(mod.segs, Math.max(1, 20 * tol));
  const step = Math.max(0.5, Math.max(rw, rh) / 400);
  const cands: Align[] = [];
  for (const rot of fixed?.rot !== undefined ? [fixed.rot] : [0, 90, 180, 270]) {
    for (const mirror of fixed?.mirror !== undefined ? [fixed.mirror] : [false, true]) {
      const sw = rot % 180 === 0 ? rw : rh;
      const shh = rot % 180 === 0 ? rh : rw;
      // zadaný pohled předlohy (N.M): bez kontroly velikosti – rozhodne shoda (zbytek značek, jiná obálka)
      if (fixed?.dx === undefined && !o.anySize && !(near(sw, mw) && near(shh, mh))) continue;
      const base: Align = { rot, mirror, dx: 0, dy: 0 };
      if (fixed?.dx !== undefined) {
        cands.push({ ...base, dx: fixed.dx, dy: fixed.dy ?? 0 });
        continue;
      }
      const tb = transformGeo(ref, base).box;
      cands.push({ ...base, dx: (mod.box.x0 + mod.box.x1) / 2 - (tb.x0 + tb.x1) / 2, dy: (mod.box.y0 + mod.box.y1) / 2 - (tb.y0 + tb.y1) / 2 });
      cands.push({ ...base, dx: mod.box.x0 - tb.x0, dy: mod.box.y0 - tb.y0 });
      cands.push({ ...base, dx: mod.box.x1 - tb.x1, dy: mod.box.y1 - tb.y1 });
      // středy kružnic stejného poloměru – hlasování o posunu
      const votes = new Map<string, { n: number; dx: number; dy: number }>();
      const rc = ref.circles.slice(0, 200).map((c) => ({ c: applyAlign(base, c.c), r: c.r }));
      for (const a of rc)
        for (const b of mod.circles.slice(0, 200)) {
          if (Math.abs(a.r - b.r) > Math.max(tol, 0.01)) continue;
          const dx = b.c[0] - a.c[0];
          const dy = b.c[1] - a.c[1];
          const k = `${Math.round(dx * 20)},${Math.round(dy * 20)}`;
          const v = votes.get(k) ?? { n: 0, dx, dy };
          v.n++;
          votes.set(k, v);
        }
      for (const v of [...votes.values()].sort((x, y) => y.n - x.n).slice(0, 3)) cands.push({ ...base, dx: v.dx, dy: v.dy });
    }
  }
  if (!cands.length) return null;
  let best: Align | null = null;
  let bs = -1;
  for (const c of cands) {
    // při shodě přednost poloze bez otočení a zrcadlení (souměrný díl)
    const s = score(ref, grid, c, Math.max(tol, 0.5), step) + (c.rot === 0 ? 0.002 : 0) + (c.mirror ? 0 : 0.003);
    if (s > bs) {
      bs = s;
      best = c;
    }
  }
  if (!best) return null;
  // doladění posunu: průměrná odchylka nejbližších bodů (několik kroků, zmenšující se okruh)
  if (fixed?.dx === undefined) {
    const pts = samples(ref.segs, step);
    for (const r of [1, 0.5, 0.25, 0.25, 0.1]) {
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (const s of pts) {
        const p = applyAlign(best, s.p);
        const q = grid.nearest(p, Math.max(r, tol));
        if (!q) continue;
        sx += q.q[0] - p[0];
        sy += q.q[1] - p[1];
        n++;
      }
      if (n < 3) break;
      // posun jen ve směru, kde body opravdu nesedí (průměr kolmých odchylek)
      best = { ...best, dx: best.dx + sx / n, dy: best.dy + sy / n };
    }
  }
  return best;
}

/** porovnání: pokrytí, úseky mimo toleranci, obrázek */
/**
 * Volnější tolerance u závitů normálií: předloha kreslí jádro závitu d1 (M8: Ø6,647), model má vrták (Ø6,8) –
 * rozdíl poloměru do 0,15 mm se u úseků závitu počítá jako shoda (a v protokolu se uvede).
 */
export const THREAD_TOL = 0.15;

export function compareGeo(ref: Geo, mod: Geo, o: { tol?: number; align?: Partial<Align>; view: string; refView: string; refOrigin?: Vec2; anySize?: boolean }): RefCompare | null {
  const tol = o.tol ?? 0.06;
  const al = findAlign(ref, mod, tol, o.align, { anySize: o.anySize });
  if (!al) return null;
  const R = transformGeo(ref, al);
  const gridM = new SegGrid(mod.segs, Math.max(1, 20 * tol));
  const gridR = new SegGrid(R.segs, Math.max(1, 20 * tol));
  const step = Math.min(0.5, Math.max(tol * 4, 0.1));
  const thTol = Math.max(tol, THREAD_TOL);
  const hasThread = R.segs.some((x) => x.thread);
  /** `refSide` = vzorky předlohy proti modelu; úsek závitu předlohy (nebo vzorek modelu u něj) do 0,15 mm = shoda */
  const run = (pts: { p: Vec2; w: number; seg: number }[], other: SegGrid, refSide: boolean) => {
    let tot = 0;
    let hit = 0;
    let lenient = 0;
    const miss: { p: Vec2; w: number; seg: number; d: number }[] = [];
    for (const s of pts) {
      tot += s.w;
      const q = other.nearest(s.p, tol);
      if (q) hit += s.w;
      else {
        const q2 = hasThread && thTol > tol ? other.nearest(s.p, thTol) : null;
        if (q2 && (refSide ? R.segs[s.seg].thread : R.segs[q2.i].thread)) {
          hit += s.w;
          lenient += s.w;
          continue;
        }
        const far = other.nearest(s.p, 10);
        miss.push({ ...s, d: far ? far.d : 10 });
      }
    }
    return { tot, hit, miss, lenient };
  };
  const rs = run(samples(R.segs, step), gridM, true);
  const ms = run(samples(mod.segs, step), gridR, false);
  // souvislé úseky mimo toleranci (sousední vzorky do 2 kroků)
  const clusters = (miss: { p: Vec2; w: number; d: number }[]) => {
    const out: { pts: Vec2[]; len: number; d: number }[] = [];
    const used = new Array(miss.length).fill(false);
    const cs = step * 2.5;
    const grid = new Map<string, number[]>();
    miss.forEach((m, i) => {
      const k = `${Math.floor(m.p[0] / cs)},${Math.floor(m.p[1] / cs)}`;
      (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
    });
    for (let i = 0; i < miss.length; i++) {
      if (used[i]) continue;
      const stack = [i];
      used[i] = true;
      const c = { pts: [] as Vec2[], len: 0, d: 0 };
      while (stack.length) {
        const j = stack.pop()!;
        const m = miss[j];
        c.pts.push(m.p);
        c.len += m.w;
        c.d = Math.max(c.d, m.d);
        const gx = Math.floor(m.p[0] / cs);
        const gy = Math.floor(m.p[1] / cs);
        for (let x = gx - 1; x <= gx + 1; x++)
          for (let y = gy - 1; y <= gy + 1; y++)
            for (const k of grid.get(`${x},${y}`) ?? []) {
              if (used[k]) continue;
              if (Math.hypot(miss[k].p[0] - m.p[0], miss[k].p[1] - m.p[1]) <= cs) {
                used[k] = true;
                stack.push(k);
              }
            }
      }
      out.push(c);
    }
    return out.filter((c) => c.len >= Math.max(step, 2 * tol)).sort((a, b) => b.len - a.len);
  };
  const inv = (p: Vec2): Vec2 => {
    // poloha v souřadnicích pohledu předlohy od levého dolního rohu (mm skutečné velikosti)
    const x0 = p[0] - al.dx;
    const y0 = p[1] - al.dy;
    const a = (-al.rot * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    let x = c * x0 - s * y0;
    const y = s * x0 + c * y0;
    if (al.mirror) x = -x;
    return [x - ref.box.x0, y - ref.box.y0];
  };
  const mm: RefCompare["mismatches"] = [];
  const centre = (pts: Vec2[]): Vec2 => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p[0]);
      y0 = Math.min(y0, p[1]);
      x1 = Math.max(x1, p[0]);
      y1 = Math.max(y1, p[1]);
    }
    return [(x0 + x1) / 2, (y0 + y1) / 2];
  };
  for (const c of clusters(rs.miss).slice(0, 12)) {
    const mid = centre(c.pts);
    mm.push({ side: "ref", at: inv(mid).map((v) => Math.round(v * 100) / 100) as Vec2, length: Math.round(c.len * 100) / 100, dist: Math.round(c.d * 1000) / 1000 });
  }
  for (const c of clusters(ms.miss).slice(0, 12)) {
    const mid = centre(c.pts);
    mm.push({ side: "model", at: inv(mid).map((v) => Math.round(v * 100) / 100) as Vec2, length: Math.round(c.len * 100) / 100, dist: Math.round(c.d * 1000) / 1000 });
  }
  const pct = (a: number, b: number) => (b > 0 ? Math.round((1000 * a) / b) / 10 : 0);
  const svg = overlaySvg(R, mod, clusters(rs.miss), clusters(ms.miss), o.refView, o.view);
  return {
    view: o.view,
    refView: o.refView,
    tolerance: tol,
    coverage: pct(rs.hit, rs.tot),
    modelCoverage: pct(ms.hit, ms.tot),
    align: { rot: al.rot, mirror: al.mirror, dx: Math.round(al.dx * 1000) / 1000, dy: Math.round(al.dy * 1000) / 1000 },
    mismatches: mm,
    svg,
    refLength: Math.round(rs.tot * 10) / 10,
    modelLength: Math.round(ms.tot * 10) / 10,
    ...(rs.lenient > 0 ? { threadLength: Math.round(rs.lenient * 10) / 10, threadTol: thTol } : {}),
  };
}

/** obrázek SVG: model černě, předloha modře, úseky mimo toleranci tlustě oranžově (předloha) a červeně (model) */
function overlaySvg(R: Geo, M: Geo, refMiss: { pts: Vec2[] }[], modMiss: { pts: Vec2[] }[], refView: string, view: string): string {
  const b = { x0: Math.min(R.box.x0, M.box.x0), y0: Math.min(R.box.y0, M.box.y0), x1: Math.max(R.box.x1, M.box.x1), y1: Math.max(R.box.y1, M.box.y1) };
  const pad = Math.max(2, 0.04 * Math.max(b.x1 - b.x0, b.y1 - b.y0));
  const W = b.x1 - b.x0 + 2 * pad;
  const H = b.y1 - b.y0 + 2 * pad;
  const f = (v: number) => Math.round(v * 100) / 100;
  const X = (p: Vec2) => `${f(p[0] - b.x0 + pad)},${f(b.y1 + pad - p[1])}`;
  const path = (segs: Seg[]) => segs.map((s) => `M${X(s.a)}L${X(s.b)}`).join("");
  const lw = Math.max(W, H) / 800;
  const runs = (rs: { pts: Vec2[] }[]) => rs.map((r) => r.pts.map((p) => `M${X(p)}l0.01,0`).join("")).join("");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(W)} ${f(H)}" width="${Math.round(Math.min(1600, W * 4))}" data-ref-view="${refView}" data-view="${view}">`,
    `<rect width="100%" height="100%" fill="#fff"/>`,
    `<path d="${path(M.segs)}" stroke="#222" stroke-width="${f(lw * 1.6)}" fill="none"/>`,
    `<path d="${path(R.segs)}" stroke="#1f6fd1" stroke-width="${f(lw)}" fill="none" opacity="0.85"/>`,
    `<path d="${runs(refMiss)}" stroke="#f08c00" stroke-width="${f(lw * 6)}" stroke-linecap="round" fill="none"/>`,
    `<path d="${runs(modMiss)}" stroke="#e03930" stroke-width="${f(lw * 6)}" stroke-linecap="round" fill="none"/>`,
    `<text x="${f(pad)}" y="${f(pad * 0.8)}" font-size="${f(pad * 0.6)}" font-family="sans-serif" fill="#444">${tr("předloha {0} (modře) × model {1} (černě); mimo toleranci: oranžově předloha, červeně model", refView, view)}</text>`,
    `</svg>`,
  ].join("");
}

/**
 * Kontrola kót předlohy proti modelu: definiční body kóty (sesouhlasené do souřadnic modelu) se přichytí k nejbližší
 * geometrii modelu a hodnota se změří ve směru kóty; kruhové kóty podle kružnice modelu u středu. Definiční bod ve
 * VIRTUÁLNÍM rohu (sražený / zaoblený roh, počátek souřadnicových kót) se přichytí k hraně kolmé na směr měření, jejíž
 * přímka jím prochází – na hodnotě kóty se podílí jen souřadnice ve směru měření.
 * ✓ = model má hodnotu z textu kóty (± 0,005), nebo hodnotu geometrie předlohy, jejíž text je jen zaokrouhlený;
 * ✓ s poznámkou = v toleranci kóty; ✗ = jinak (i když model odpovídá geometrii předlohy, která si s textem odporuje);
 * bez bodu = definiční bod v modelu nenalezen; nekontrolováno = úhel, závit, sražení.
 */
export function checkDims(dims: readonly RefDim[], view: RefView, mod: Geo, al: Align, o: { tol?: number; scale?: number } = {}): RefDimCheck[] {
  const tol = o.tol ?? 0.06;
  const k = 1 / (o.scale || view.geomScale || 1);
  const grid = new SegGrid(mod.segs, Math.max(1, 20 * tol));
  const snapR = Math.max(0.5, 10 * tol);
  const T = (p: Vec2) => applyAlign(al, [p[0] * k, p[1] * k]);
  /** hrany modelu kolmé na směr `u`: (souřadnice ve směru u, úsek) */
  const perp = (u: Vec2) =>
    mod.segs
      .map((sg) => {
        const dx = sg.b[0] - sg.a[0];
        const dy = sg.b[1] - sg.a[1];
        const L = Math.hypot(dx, dy);
        return L > 1e-6 && Math.abs((dx * u[0] + dy * u[1]) / L) <= 0.02 ? { c: (sg.a[0] * u[0] + sg.a[1] * u[1] + sg.b[0] * u[0] + sg.b[1] * u[1]) / 2, sg } : null;
      })
      .filter((x): x is { c: number; sg: Seg } => !!x);
  const segDist = (p: Vec2, sg: Seg) => {
    const dx = sg.b[0] - sg.a[0];
    const dy = sg.b[1] - sg.a[1];
    const L2 = dx * dx + dy * dy;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((p[0] - sg.a[0]) * dx + (p[1] - sg.a[1]) * dy) / L2)) : 0;
    return Math.hypot(p[0] - sg.a[0] - t * dx, p[1] - sg.a[1] - t * dy);
  };
  const out: RefDimCheck[] = [];
  for (const d of dims) {
    if (d.value === undefined || d.thread || d.chamfer || d.kind === "angular" || d.kind === "angular3" || d.kind === "arc") {
      out.push({ dim: d, ok: false, how: "unchecked", note: tr("nekontroluje se (úhel, závit, sražení)") });
      continue;
    }
    let model: number | undefined;
    let virtual = false;
    if ((d.kind === "diameter" || d.kind === "radius") && d.center) {
      const c = T(d.center);
      const want = d.kind === "diameter" ? d.value / 2 : d.value;
      let best: Circ | null = null;
      for (const m of mod.circles) if (Math.hypot(m.c[0] - c[0], m.c[1] - c[1]) <= Math.max(2, snapR) && (!best || Math.abs(m.r - want) < Math.abs(best.r - want))) best = m;
      if (best) model = d.kind === "diameter" ? 2 * best.r : best.r;
    } else if (d.p1 && d.p2) {
      const a = ((d.dirDeg ?? 0) * Math.PI) / 180;
      const u = alignVec(al, [Math.cos(a), Math.sin(a)]);
      let pp: { c: number; sg: Seg }[] | null = null;
      // definiční bod na hraně, nebo ve středu díry (rozteče děr); jinak virtuální roh na přímce hrany kolmé na směr měření
      const snap = (p: Vec2): Vec2 | null => {
        const q = grid.nearest(p, snapR);
        let best: { d: number; q: Vec2 } | null = q ? { d: q.d, q: q.q } : null;
        // střed díry: i posunutá díra (do 2 mm) se najde – kóta pak ukáže skutečnou rozteč modelu místo „bez bodu“
        for (const c of mod.circles) {
          const dd = Math.hypot(c.c[0] - p[0], c.c[1] - p[1]);
          if (dd <= Math.max(2, snapR) && (!best || dd < best.d || (q && q.d > tol && dd < 2))) best = { d: dd, q: c.c };
        }
        if (best) return best.q;
        pp ??= perp(u);
        const pu = p[0] * u[0] + p[1] * u[1];
        let line: { off: number; dist: number; c: number } | null = null;
        for (const x of pp) {
          const off = Math.abs(x.c - pu);
          if (off > snapR) continue;
          const dist = segDist(p, x.sg);
          if (dist > 20) continue;
          if (!line || off < line.off - 1e-9 || (Math.abs(off - line.off) <= 1e-9 && dist < line.dist)) line = { off, dist, c: x.c };
        }
        if (!line) return null;
        virtual = true;
        return [p[0] + (line.c - pu) * u[0], p[1] + (line.c - pu) * u[1]];
      };
      const q1 = snap(T(d.p1));
      const q2 = snap(T(d.p2));
      if (q1 && q2) model = Math.abs((q2[0] - q1[0]) * u[0] + (q2[1] - q1[1]) * u[1]);
    }
    if (model === undefined) {
      out.push({ dim: d, ok: false, how: "none", note: tr("bod kóty v modelu nenalezen") });
      continue;
    }
    const m = Math.round(model * 1e4) / 1e4;
    const eq = (x: number) => Math.abs(x - m) <= 0.005 + 1e-9;
    const vnote = virtual ? tr("bod ve virtuálním rohu (průsečík hran)") : undefined;
    if (eq(d.value)) out.push({ dim: d, model: m, ok: true, how: "value", ...(vnote ? { note: vnote } : {}) });
    else if (d.measured !== undefined && eq(d.measured) && d.check !== "mismatch") out.push({ dim: d, model: m, ok: true, how: "geometry", note: tr("text předlohy je zaokrouhlený – geometrie předlohy {0}", d.measured) });
    else if (d.tol && m >= d.value + d.tol.lower - 1e-9 && m <= d.value + d.tol.upper + 1e-9) out.push({ dim: d, model: m, ok: true, how: "tolerance", note: tr("v toleranci, ne jmenovitá hodnota") });
    else if (d.measured !== undefined && eq(d.measured)) out.push({ dim: d, model: m, ok: false, how: "value", note: tr("předloha si odporuje: text {0}, geometrie předlohy {1} – model odpovídá geometrii, ne textu kóty; ověřte u zákazníka", d.text, d.measured) });
    else out.push({ dim: d, model: m, ok: false, how: "value" });
  }
  return out;
}
